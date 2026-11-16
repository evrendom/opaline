import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { slimTranscriptText } from "@rudel/api-routes/transcript-slim";
import {
	collectSessionImages,
	createImageCollector,
} from "./image-collection.js";
import { readSessionFile } from "./session-input.js";
import { readSlimmedSessionFile } from "./slim-reader.js";

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

function pngBase64(seed: number, size: number): string {
	const bytes = Buffer.alloc(size, seed);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	return bytes.toString("base64");
}

function transcript(): string {
	const image = (seed: number) => ({
		type: "image",
		source: {
			type: "base64",
			media_type: "image/png",
			data: pngBase64(seed, 300_000),
		},
	});
	const lines = [
		JSON.stringify({ type: "user", message: { content: [image(1)] } }),
		`${JSON.stringify({ type: "assistant", message: { content: "crlf" } })}\r`,
		"",
		JSON.stringify({
			type: "user",
			message: { content: [image(2), image(1)] },
		}),
		JSON.stringify({
			type: "assistant",
			message: { content: "x".repeat(200_000) },
		}),
		"not json at all",
		JSON.stringify({ type: "assistant", message: { content: "últimö ✓" } }),
	];
	return lines.join("\n");
}

test("reading a transcript slimmed line by line gives the bytes and images of slimming it whole", async () => {
	for (const ending of ["", "\n"]) {
		const text = transcript() + ending;
		writeFileSync(join(root, "s.jsonl"), text);
		writeFileSync(
			join(root, "s.jsonl.zst"),
			zstdCompressSync(Buffer.from(text)),
		);
		const expectedImages = collectSessionImages([
			{ agentId: "", content: text },
		]);
		expect(expectedImages).toHaveLength(2);
		for (const name of ["s.jsonl", "s.jsonl.zst"]) {
			expect(await readSessionFile(join(root, name))).toBe(text);
			const collector = createImageCollector();
			const slimmed = await readSlimmedSessionFile(join(root, name), collector);
			expect(slimmed).toBe(slimTranscriptText(text));
			expect(slimmed.length).toBeLessThan(text.length / 2);
			expect(collector.images()).toEqual(expectedImages);
		}
	}
});
