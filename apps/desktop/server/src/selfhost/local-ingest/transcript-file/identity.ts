import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";

export const FINGERPRINT_BYTES = 4096;

export interface FileStat {
	readonly device: string;
	readonly inode: string;
	readonly size: number;
	readonly mtimeMs: number;
}

export interface FileIdentity extends FileStat {
	readonly headSha256: string;
	readonly tailSha256: string;
}

export interface Fingerprint {
	readonly headSha256: string;
	readonly tailSha256: string;
}

export type WholeReason =
	| "new"
	| "replaced"
	| "rewritten"
	| "truncated"
	| "compressed"
	| "unaligned";

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

export function sha256(buffer: Buffer): string {
	return createHash("sha256").update(buffer).digest("hex");
}

export function tailStart(size: number): number {
	return Math.max(0, size - FINGERPRINT_BYTES);
}

export async function fingerprintAt(
	path: string,
	size: number,
): Promise<Fingerprint | null> {
	const headLength = Math.min(FINGERPRINT_BYTES, size);
	const start = tailStart(size);
	const [head, tail] = await Promise.all([
		readWindow(path, 0, headLength),
		readWindow(path, start, size - start),
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

export type StatComparison =
	| { readonly kind: "unchanged" }
	| { readonly kind: "whole"; readonly reason: WholeReason }
	| { readonly kind: "grown" | "touched" };

export function compareStat(
	stored: FileIdentity | null,
	current: FileStat,
): StatComparison {
	if (!stored) return { kind: "whole", reason: "new" };
	if (stored.device !== current.device || stored.inode !== current.inode)
		return { kind: "whole", reason: "replaced" };
	if (current.size === stored.size && current.mtimeMs === stored.mtimeMs)
		return { kind: "unchanged" };
	if (current.size < stored.size) return { kind: "whole", reason: "truncated" };
	return { kind: current.size === stored.size ? "touched" : "grown" };
}

export function samePrefix(
	stored: FileIdentity,
	found: Fingerprint | null,
): boolean {
	return (
		found !== null &&
		found.headSha256 === stored.headSha256 &&
		found.tailSha256 === stored.tailSha256
	);
}
