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
	checkTranscript,
	FINGERPRINT_BYTES,
	type FileIdentity,
	identifyTranscript,
	readSession,
	statTranscript,
	type TranscriptCheck,
} from "./index.js";

let directory: string;
let path: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "transcript-check-"));
	path = join(directory, "session.jsonl");
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

const line = (index: number) =>
	`${JSON.stringify({ index, text: "x".repeat(300) })}\n`;

async function ingested(): Promise<FileIdentity> {
	const [identity] = (await readSession(path, null)).files();
	if (!identity) throw new Error("no identity");
	return identity;
}

function check(
	stored: FileIdentity | null,
	options: { final?: boolean; now?: number } = {},
): Promise<TranscriptCheck> {
	return checkTranscript(path, stored, {
		final: options.final ?? true,
		now: options.now ?? Date.now(),
		partialLineGraceMs: 30_000,
	});
}

async function change(stored: FileIdentity | null) {
	const result = await check(stored);
	if (result.kind !== "ready") throw new Error(`not ready: ${result.kind}`);
	const { kind } = result.change;
	return result.change.kind === "whole" ? result.change.reason : kind;
}

test("a file never ingested is new; an untouched one is unchanged", async () => {
	await writeFile(path, line(1));
	expect(await change(null)).toBe("new");
	expect(await change(await ingested())).toBe("unchanged");
});

test("appended lines are an append, also past the fingerprint window", async () => {
	await writeFile(path, Array.from({ length: 40 }, (_, i) => line(i)).join(""));
	const stored = await ingested();
	expect(stored.size).toBeGreaterThan(FINGERPRINT_BYTES);
	await appendFile(path, line(41));
	expect(await change(stored)).toBe("appended");
});

test("a small file that grows is an append, not a rewrite", async () => {
	await writeFile(path, line(1));
	const stored = await ingested();
	await appendFile(path, line(2));
	expect(await change(stored)).toBe("appended");
});

test("an edit inside the ingested bytes is a rewrite", async () => {
	await writeFile(path, `${line(1)}${line(2)}`);
	const stored = await ingested();
	await writeFile(path, `${line(1)}${line(3)}${line(4)}`.replace("3", "9"));
	expect((await statTranscript(path))?.inode).toBe(stored.inode);
	expect(await change(stored)).toBe("rewritten");
});

test("a shorter file is truncated; a recreated file is replaced", async () => {
	await writeFile(path, `${line(1)}${line(2)}`);
	const stored = await ingested();
	await truncate(path, 10);
	expect(await change(stored)).toBe("truncated");
	await rm(path);
	await writeFile(join(directory, "other"), "keep the inode busy");
	await writeFile(path, `${line(1)}${line(2)}${line(3)}`);
	if ((await statTranscript(path))?.inode !== stored.inode)
		expect(await change(stored)).toBe("replaced");
});

test("a touch without new bytes stays unchanged", async () => {
	await writeFile(path, line(1));
	const stored = await ingested();
	const later = new Date(Date.now() + 5_000);
	await utimes(path, later, later);
	expect(await change(stored)).toBe("unchanged");
});

test("a recent partial last line waits for the writer unless the session ended", async () => {
	await writeFile(path, `${line(1)}{"partial":`);
	expect((await check(null, { final: false })).kind).toBe("writing");
	expect((await check(null, { final: true })).kind).toBe("ready");
	expect(
		(await check(null, { final: false, now: Date.now() + 60_000 })).kind,
	).toBe("ready");
	await appendFile(path, "true}\n");
	expect((await check(null, { final: false })).kind).toBe("ready");
});

test("a missing file is missing", async () => {
	expect((await check(null)).kind).toBe("missing");
});

test("the identity of an unread file is its fingerprint at the stat", async () => {
	await writeFile(path, line(1));
	const stat = await statTranscript(path);
	if (!stat) throw new Error("no stat");
	expect(await identifyTranscript(path, stat)).toEqual(await ingested());
});
