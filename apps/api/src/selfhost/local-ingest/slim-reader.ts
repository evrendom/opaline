import { createReadStream } from "node:fs";
import { createZstdDecompress } from "node:zlib";
import { createTranscriptSlimmer } from "@rudel/api-routes/transcript-slim";
import type { ImageCollector } from "./image-collection.js";

const NEWLINE = 0x0a;

function openSessionStream(path: string): AsyncIterable<Buffer> {
	const file = createReadStream(path);
	if (!path.endsWith(".zst")) return file;
	const decompress = createZstdDecompress();
	file.on("error", (error) => decompress.destroy(error));
	return file.pipe(decompress);
}

export async function* sessionFileSegments(
	path: string,
): AsyncGenerator<string> {
	let pending: Buffer[] = [];
	for await (const chunk of openSessionStream(path)) {
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
		}
		if (start < chunk.length) pending.push(chunk.subarray(start));
	}
	yield Buffer.concat(pending).toString("utf8");
}

function slimSegments(
	segments: Iterable<string>,
	agentId: string,
	collector: ImageCollector,
): string {
	const slimmer = createTranscriptSlimmer();
	const parts: string[] = [];
	let recordIdx = 0;
	for (const segment of segments) {
		recordIdx += 1;
		collector.add(agentId, recordIdx, segment);
		parts.push(slimmer.slimRecord(segment));
	}
	return parts.join("\n");
}

export async function readSlimmedSessionFile(
	path: string,
	collector: ImageCollector,
): Promise<string> {
	const slimmer = createTranscriptSlimmer();
	const parts: string[] = [];
	let recordIdx = 0;
	for await (const segment of sessionFileSegments(path)) {
		recordIdx += 1;
		collector.add("", recordIdx, segment);
		parts.push(slimmer.slimRecord(segment));
	}
	return parts.join("\n");
}

export function slimSessionText(
	content: string,
	agentId: string,
	collector: ImageCollector,
): string {
	return slimSegments(content.split("\n"), agentId, collector);
}
