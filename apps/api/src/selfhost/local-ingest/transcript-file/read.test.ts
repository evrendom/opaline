import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { slimTranscriptText } from "@rudel/api-routes/transcript-slim";
import { checkTranscript, type FileIdentity, readSession } from "./index.js";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "opaline-session-file-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("a compressed Codex rollout reads as the transcript it holds", async () => {
	const text = '{"type":"session_meta","payload":{"id":"abc"}}\n';
	writeFileSync(join(root, "a.jsonl"), text);
	writeFileSync(join(root, "a.jsonl.zst"), zstdCompressSync(Buffer.from(text)));
	expect((await readSession(join(root, "a.jsonl"), null)).content).toBe(text);
	expect((await readSession(join(root, "a.jsonl.zst"), null)).content).toBe(
		text,
	);
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

const pngSha256 = (seed: number) =>
	createHash("sha256")
		.update(Buffer.from(pngBase64(seed, 300_000), "base64"))
		.digest("hex");

test("reading a transcript slimmed line by line gives the bytes and images of slimming it whole", async () => {
	for (const ending of ["", "\n"]) {
		const text = transcript() + ending;
		writeFileSync(join(root, "s.jsonl"), text);
		writeFileSync(
			join(root, "s.jsonl.zst"),
			zstdCompressSync(Buffer.from(text)),
		);
		for (const name of ["s.jsonl", "s.jsonl.zst"]) {
			const session = await readSession(join(root, name), null);
			expect(session.content).toBe(slimTranscriptText(text));
			expect(session.content.length).toBeLessThan(text.length / 2);
			expect(
				session.images().map(({ sha256, mediaType, bytes, references }) => ({
					sha256,
					mediaType,
					bytes: bytes.byteLength,
					references,
				})),
			).toEqual([
				{
					sha256: pngSha256(1),
					mediaType: "image/png",
					bytes: 300_000,
					references: [
						["", 1],
						["", 4],
					],
				},
				{
					sha256: pngSha256(2),
					mediaType: "image/png",
					bytes: 300_000,
					references: [["", 4]],
				},
			]);
		}
	}
});

const record = (index: number) =>
	`${JSON.stringify({ type: "user", index, text: "y".repeat(500) })}\n`;

async function stored(path: string): Promise<FileIdentity> {
	const [identity] = (await readSession(path, null)).files();
	if (!identity) throw new Error("no identity");
	return identity;
}

async function changeSince(path: string, since: FileIdentity) {
	const check = await checkTranscript(path, since, {
		final: true,
		now: Date.now(),
		partialLineGraceMs: 0,
	});
	if (check.kind !== "ready") throw new Error(check.kind);
	return check.change;
}

test("an appended transcript reads whole and names its complete new lines", async () => {
	const path = join(root, "live.jsonl");
	const before = Array.from({ length: 20 }, (_, i) => record(i)).join("");
	writeFileSync(path, before);
	const since = await stored(path);
	appendFileSync(path, `${record(20)}${record(21)}{"partial":`);
	const session = await readSession(path, await changeSince(path, since));
	expect(session.content).toBe(
		slimTranscriptText(`${before}${record(20)}${record(21)}{"partial":`),
	);
	expect(session.revision).toEqual({
		kind: "appended",
		fromByte: Buffer.byteLength(before),
		fromLine: 20,
		lines: [record(20).trimEnd(), record(21).trimEnd()],
	});
	const [identity] = session.files();
	expect(identity?.size).toBe(
		Buffer.byteLength(`${before}${record(20)}${record(21)}{"partial":`),
	);
});

test("a read of unchanged bytes is unchanged; an edit is a rewrite; a split line reads whole", async () => {
	const path = join(root, "edited.jsonl");
	writeFileSync(path, `${record(1)}${record(2)}`);
	const since = await stored(path);
	expect(
		(await readSession(path, { kind: "unchanged", since })).revision,
	).toEqual({ kind: "unchanged" });
	writeFileSync(path, `${record(1)}${record(9)}${record(3)}`);
	expect(
		(await readSession(path, { kind: "appended", since })).revision,
	).toEqual({ kind: "whole", reason: "rewritten" });
	writeFileSync(path, `${record(1)}{"partial":`);
	const partial = await stored(path);
	appendFileSync(path, `true}\n${record(2)}`);
	expect(
		(await readSession(path, await changeSince(path, partial))).revision,
	).toEqual({ kind: "whole", reason: "unaligned" });
});

test("a grown compressed transcript reads whole", async () => {
	const path = join(root, "rollout.jsonl.zst");
	writeFileSync(path, zstdCompressSync(Buffer.from(record(1))));
	const since = await stored(path);
	appendFileSync(path, zstdCompressSync(Buffer.from(record(2))));
	const change = await changeSince(path, since);
	expect(change).toMatchObject({ kind: "whole", reason: "compressed" });
	const session = await readSession(path, change);
	expect(session.revision).toEqual({ kind: "whole", reason: "compressed" });
});

test("bytes written after the read are what the next check finds appended", async () => {
	const path = join(root, "growing.jsonl");
	writeFileSync(path, record(1));
	const session = await readSession(path, null);
	appendFileSync(path, record(2));
	const [identity] = session.files();
	if (!identity) throw new Error("no identity");
	expect(identity.size).toBe(Buffer.byteLength(record(1)));
	expect(await changeSince(path, identity)).toMatchObject({
		kind: "appended",
	});
});

test("subagent transcripts are read, slimmed and identified with their session", async () => {
	const projects = join(root, "projects", "-repo");
	const sessionPath = join(projects, "abc.jsonl");
	mkdirSync(join(projects, "abc", "subagents"), { recursive: true });
	writeFileSync(
		sessionPath,
		`${JSON.stringify({ type: "user", toolUseResult: { agentId: "sub1" } })}\n`,
	);
	const subagentText = `${JSON.stringify({ type: "assistant", text: "hi" })}\n`;
	writeFileSync(
		join(projects, "abc", "subagents", "agent-sub1.jsonl"),
		subagentText,
	);
	const session = await readSession(sessionPath, null);
	expect(session.files()).toHaveLength(1);
	expect(await session.subagents()).toEqual([
		{ agentId: "sub1", content: slimTranscriptText(subagentText) },
	]);
	expect(session.files().map((file) => file.size)).toEqual([
		Buffer.byteLength(await Bun.file(sessionPath).text()),
		Buffer.byteLength(subagentText),
	]);
});
