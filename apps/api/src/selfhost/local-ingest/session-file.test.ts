import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { readSessionFile } from "./session-input.js";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "opaline-session-file-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("a compressed Codex rollout reads as the transcript it holds", async () => {
	const text = '{"type":"session_meta","payload":{"id":"abc"}}\n';
	writeFileSync(join(root, "a.jsonl"), text);
	writeFileSync(join(root, "a.jsonl.zst"), zstdCompressSync(Buffer.from(text)));
	expect(await readSessionFile(join(root, "a.jsonl"))).toBe(text);
	expect(await readSessionFile(join(root, "a.jsonl.zst"))).toBe(text);
});
