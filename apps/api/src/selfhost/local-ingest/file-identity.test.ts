import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	appendFile,
	mkdtemp,
	rm,
	truncate,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectFileChange,
	endsWithNewline,
	FINGERPRINT_BYTES,
	fingerprintAt,
	type IngestedIdentity,
	statTranscript,
} from "./file-identity.js";

let directory: string;
let path: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "file-identity-"));
	path = join(directory, "session.jsonl");
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

const line = (index: number) =>
	`${JSON.stringify({ index, text: "x".repeat(300) })}\n`;

async function ingested(): Promise<IngestedIdentity> {
	const stat = await statTranscript(path);
	if (!stat) throw new Error("no file");
	const fingerprint = await fingerprintAt(path, stat.size);
	if (!fingerprint) throw new Error("no fingerprint");
	return {
		device: stat.device,
		inode: stat.inode,
		ingestedSize: stat.size,
		ingestedMtimeMs: stat.mtimeMs,
		...fingerprint,
	};
}

async function current() {
	const stat = await statTranscript(path);
	if (!stat) throw new Error("no file");
	return stat;
}

test("a file never ingested is new; an untouched one is unchanged", async () => {
	await writeFile(path, line(1));
	expect(await detectFileChange(path, null, await current())).toBe("new");
	const stored = await ingested();
	expect(await detectFileChange(path, stored, await current())).toBe(
		"unchanged",
	);
});

test("appended lines are an append, also past the fingerprint window", async () => {
	await writeFile(path, Array.from({ length: 40 }, (_, i) => line(i)).join(""));
	const stored = await ingested();
	expect(stored.ingestedSize).toBeGreaterThan(FINGERPRINT_BYTES);
	await appendFile(path, line(41));
	expect(await detectFileChange(path, stored, await current())).toBe(
		"appended",
	);
});

test("a small file that grows is an append, not a rewrite", async () => {
	await writeFile(path, line(1));
	const stored = await ingested();
	await appendFile(path, line(2));
	expect(await detectFileChange(path, stored, await current())).toBe(
		"appended",
	);
});

test("an edit inside the ingested bytes is a rewrite", async () => {
	await writeFile(path, `${line(1)}${line(2)}`);
	const stored = await ingested();
	await writeFile(path, `${line(1)}${line(3)}${line(4)}`.replace("3", "9"));
	const changed = await current();
	expect(changed.inode).toBe(stored.inode);
	expect(await detectFileChange(path, stored, changed)).toBe("rewritten");
});

test("a shorter file is truncated; a recreated file is replaced", async () => {
	await writeFile(path, `${line(1)}${line(2)}`);
	const stored = await ingested();
	await truncate(path, 10);
	expect(await detectFileChange(path, stored, await current())).toBe(
		"truncated",
	);
	await rm(path);
	await writeFile(join(directory, "other"), "keep the inode busy");
	await writeFile(path, `${line(1)}${line(2)}${line(3)}`);
	const recreated = await current();
	if (recreated.inode !== stored.inode)
		expect(await detectFileChange(path, stored, recreated)).toBe("replaced");
});

test("a touch without new bytes stays unchanged", async () => {
	await writeFile(path, line(1));
	const stored = await ingested();
	const later = new Date(Date.now() + 5_000);
	await utimes(path, later, later);
	expect(await detectFileChange(path, stored, await current())).toBe(
		"unchanged",
	);
});

test("a partial last line is detected", async () => {
	await writeFile(path, `${line(1)}{"partial":`);
	expect(await endsWithNewline(path, (await current()).size)).toBe(false);
	await appendFile(path, "true}\n");
	expect(await endsWithNewline(path, (await current()).size)).toBe(true);
});
