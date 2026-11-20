import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { createZstdDecompress } from "node:zlib";
import {
	createTranscriptSlimmer,
	stripAndCollectInlineImages,
} from "@rudel/api-routes/transcript-slim";
import {
	FINGERPRINT_BYTES,
	type FileIdentity,
	type Fingerprint,
	samePrefix,
	sha256,
	tailStart,
	type WholeReason,
} from "./identity.js";
import type { ImageCollector } from "./images.js";

const NEWLINE = 0x0a;

export type ReadRevision =
	| { readonly kind: "unchanged" }
	| {
			readonly kind: "appended";
			readonly fromByte: number;
			readonly fromLine: number;
			readonly lines: readonly string[];
	  }
	| { readonly kind: "whole"; readonly reason: WholeReason };

class WindowCapture {
	private readonly parts: Buffer[] = [];

	constructor(
		private readonly start: number,
		private readonly end: number,
	) {}

	take(chunk: Buffer, at: number): void {
		const from = Math.max(this.start, at);
		const to = Math.min(this.end, at + chunk.length);
		if (from < to)
			this.parts.push(Buffer.from(chunk.subarray(from - at, to - at)));
	}

	digest(): string {
		return sha256(Buffer.concat(this.parts));
	}
}

class TailCapture {
	private tail = Buffer.alloc(0);

	take(chunk: Buffer): void {
		this.tail =
			chunk.length >= FINGERPRINT_BYTES
				? Buffer.from(chunk.subarray(chunk.length - FINGERPRINT_BYTES))
				: Buffer.concat([this.tail, chunk]).subarray(-FINGERPRINT_BYTES);
	}

	digest(): string {
		return sha256(this.tail);
	}
}

interface OpenedFile {
	readonly chunks: AsyncIterable<Buffer>;
	readonly finish: () => Promise<FileIdentity>;
	readonly fingerprintAt: (size: number) => Fingerprint | null;
	readonly close: () => Promise<void>;
}

async function openFile(
	path: string,
	since: FileIdentity | null,
): Promise<OpenedFile> {
	const handle = await open(path, "r");
	try {
		const before = await handle.stat({ bigint: true });
		const head = new WindowCapture(0, FINGERPRINT_BYTES);
		const tail = new TailCapture();
		const sinceHead = since
			? new WindowCapture(0, Math.min(FINGERPRINT_BYTES, since.size))
			: null;
		const sinceTail = since
			? new WindowCapture(tailStart(since.size), since.size)
			: null;
		let size = 0;
		async function* chunks(): AsyncGenerator<Buffer> {
			for await (const chunk of handle.createReadStream({
				autoClose: false,
			}) as AsyncIterable<Buffer>) {
				head.take(chunk, size);
				sinceHead?.take(chunk, size);
				sinceTail?.take(chunk, size);
				tail.take(chunk);
				size += chunk.length;
				yield chunk;
			}
		}
		return {
			chunks: chunks(),
			async finish() {
				const after = await handle.stat({ bigint: true });
				return {
					device: before.dev.toString(),
					inode: before.ino.toString(),
					size,
					mtimeMs: Number(after.mtimeMs),
					headSha256: head.digest(),
					tailSha256: tail.digest(),
				};
			},
			fingerprintAt: (at) =>
				sinceHead && sinceTail && since && at === since.size && size >= at
					? { headSha256: sinceHead.digest(), tailSha256: sinceTail.digest() }
					: null,
			close: () => handle.close(),
		};
	} catch (error) {
		await handle.close();
		throw error;
	}
}

function decompressed(
	path: string,
	chunks: AsyncIterable<Buffer>,
): AsyncIterable<Buffer> {
	if (!path.endsWith(".zst")) return chunks;
	const source = Readable.from(chunks);
	const decompress = createZstdDecompress();
	source.on("error", (error) => decompress.destroy(error));
	return source.pipe(decompress);
}

interface Position {
	lineStart: number;
}

async function* segments(
	chunks: AsyncIterable<Buffer>,
	position: Position,
): AsyncGenerator<string> {
	let pending: Buffer[] = [];
	let offset = 0;
	position.lineStart = 0;
	for await (const chunk of chunks) {
		let start = 0;
		for (;;) {
			const end = chunk.indexOf(NEWLINE, start);
			if (end === -1) break;
			const piece = chunk.subarray(start, end);
			yield pending.length === 0
				? piece.toString("utf8")
				: Buffer.concat([...pending, piece]).toString("utf8");
			pending = [];
			start = end + 1;
			position.lineStart = offset + start;
		}
		if (start < chunk.length) pending.push(chunk.subarray(start));
		offset += chunk.length;
	}
	yield Buffer.concat(pending).toString("utf8");
}

export interface LineSink {
	readonly add: (segment: string) => void;
	readonly lines: () => readonly string[];
}

export function slimmedLines(
	agentId: string,
	images: ImageCollector,
): LineSink {
	const slimmer = createTranscriptSlimmer();
	const parts: string[] = [];
	return {
		add(segment) {
			const { text, images: found } = stripAndCollectInlineImages(segment);
			images.add(agentId, parts.length + 1, found);
			parts.push(slimmer.slimRecord(text));
		},
		lines: () => parts,
	};
}

export function rawLines(): LineSink {
	const parts: string[] = [];
	return {
		add: (segment) => parts.push(segment),
		lines: () => parts,
	};
}

function revisionOf(
	path: string,
	since: FileIdentity | null,
	identity: FileIdentity,
	sinceFingerprint: Fingerprint | null,
	fromLine: number,
	lines: readonly string[],
): ReadRevision {
	if (!since) return { kind: "whole", reason: "new" };
	if (since.device !== identity.device || since.inode !== identity.inode)
		return { kind: "whole", reason: "replaced" };
	if (identity.size < since.size) return { kind: "whole", reason: "truncated" };
	if (!samePrefix(since, sinceFingerprint))
		return { kind: "whole", reason: "rewritten" };
	if (identity.size === since.size) return { kind: "unchanged" };
	if (path.endsWith(".zst")) return { kind: "whole", reason: "compressed" };
	if (fromLine === -1) return { kind: "whole", reason: "unaligned" };
	return {
		kind: "appended",
		fromByte: since.size,
		fromLine,
		lines: lines.slice(fromLine, lines.length - 1),
	};
}

export interface FileRead {
	readonly lines: readonly string[];
	readonly identity: FileIdentity;
	readonly revision: ReadRevision;
}

export async function readLines(
	path: string,
	since: FileIdentity | null,
	sink: LineSink,
): Promise<FileRead> {
	const file = await openFile(path, since);
	try {
		const position: Position = { lineStart: 0 };
		let index = 0;
		let fromLine = -1;
		for await (const segment of segments(
			decompressed(path, file.chunks),
			position,
		)) {
			if (since && fromLine === -1 && position.lineStart === since.size)
				fromLine = index;
			sink.add(segment);
			index += 1;
		}
		const identity = await file.finish();
		const lines = sink.lines();
		return {
			lines,
			identity,
			revision: revisionOf(
				path,
				since,
				identity,
				since ? file.fingerprintAt(since.size) : null,
				fromLine,
				lines,
			),
		};
	} finally {
		await file.close();
	}
}

export function slimText(
	content: string,
	agentId: string,
	images: ImageCollector,
): string {
	const sink = slimmedLines(agentId, images);
	for (const segment of content.split("\n")) sink.add(segment);
	return sink.lines().join("\n");
}
