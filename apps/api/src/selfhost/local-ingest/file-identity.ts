import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";

export const FINGERPRINT_BYTES = 4096;

export interface FileStat {
	readonly device: string;
	readonly inode: string;
	readonly size: number;
	readonly mtimeMs: number;
}

export interface IngestedIdentity {
	readonly device: string;
	readonly inode: string;
	readonly ingestedSize: number;
	readonly ingestedMtimeMs: number;
	readonly headSha256: string;
	readonly tailSha256: string;
}

export type FileChange =
	| "new"
	| "unchanged"
	| "appended"
	| "rewritten"
	| "replaced"
	| "truncated";

export async function statTranscript(path: string): Promise<FileStat | null> {
	try {
		const found = await stat(path, { bigint: true });
		if (!found.isFile()) return null;
		return {
			device: found.dev.toString(),
			inode: found.ino.toString(),
			size: Number(found.size),
			mtimeMs: Number(found.mtimeMs),
		};
	} catch {
		return null;
	}
}

async function readWindow(
	path: string,
	start: number,
	length: number,
): Promise<Buffer | null> {
	if (length <= 0) return Buffer.alloc(0);
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(path, "r");
		const buffer = Buffer.alloc(length);
		const { bytesRead } = await handle.read(buffer, 0, length, start);
		return bytesRead === length ? buffer : null;
	} catch {
		return null;
	} finally {
		await handle?.close();
	}
}

function sha256(buffer: Buffer): string {
	return createHash("sha256").update(buffer).digest("hex");
}

export async function fingerprintAt(
	path: string,
	size: number,
): Promise<{ headSha256: string; tailSha256: string } | null> {
	const headLength = Math.min(FINGERPRINT_BYTES, size);
	const tailStart = Math.max(0, size - FINGERPRINT_BYTES);
	const [head, tail] = await Promise.all([
		readWindow(path, 0, headLength),
		readWindow(path, tailStart, size - tailStart),
	]);
	return head && tail
		? { headSha256: sha256(head), tailSha256: sha256(tail) }
		: null;
}

export async function endsWithNewline(
	path: string,
	size: number,
): Promise<boolean> {
	if (size === 0) return true;
	const last = await readWindow(path, size - 1, 1);
	return last !== null && last[0] === 0x0a;
}

export async function detectFileChange(
	path: string,
	stored: IngestedIdentity | null,
	current: FileStat,
): Promise<FileChange> {
	if (!stored) return "new";
	if (stored.device !== current.device || stored.inode !== current.inode)
		return "replaced";
	if (
		current.size === stored.ingestedSize &&
		current.mtimeMs === stored.ingestedMtimeMs
	)
		return "unchanged";
	if (current.size < stored.ingestedSize) return "truncated";
	const before = await fingerprintAt(path, stored.ingestedSize);
	if (!before) return "rewritten";
	if (
		before.headSha256 !== stored.headSha256 ||
		before.tailSha256 !== stored.tailSha256
	)
		return "rewritten";
	return current.size === stored.ingestedSize ? "unchanged" : "appended";
}
