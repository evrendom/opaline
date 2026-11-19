import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { generateTranscriptCorpus } from "../src/generator.ts";
import type { TranscriptSource } from "../src/types.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
	);
});

describe("transcript generator", () => {
	test("is byte-for-byte deterministic and exact-size for both sources", async () => {
		const sources: readonly TranscriptSource[] = ["claude_code", "codex"];
		for (const source of sources) {
			const firstRoot = await createTemporaryRoot();
			const secondRoot = await createTemporaryRoot();
			const first = await generateTranscriptCorpus({
				entropy: "medium",
				outputDirectory: join(firstRoot, "corpus"),
				seed: "repeatable-seed",
				source,
				subagentCount: 3,
				timestampLines: 7,
				timestampStart: "2026-08-25T10:00:00.000Z",
				totalBytes: 512 * 1024,
			});
			const second = await generateTranscriptCorpus({
				entropy: "medium",
				outputDirectory: join(secondRoot, "corpus"),
				seed: "repeatable-seed",
				source,
				subagentCount: 3,
				timestampLines: 7,
				timestampStart: "2026-08-25T10:00:00.000Z",
				totalBytes: 512 * 1024,
			});

			expect(first.aggregateBytes).toBe(512 * 1024);
			expect(first.objects.map((object) => object.sha256)).toEqual(
				second.objects.map((object) => object.sha256),
			);
			const main = first.objects.find((object) => object.kind === "main");
			expect(main).toBeDefined();
			const mainContent = await Bun.file(
				join(firstRoot, "corpus", main?.path ?? "missing"),
			).text();
			expect(countTimestampLines(mainContent)).toBe(7);
		}
	});

	test("supports the contract maximum of 512 subagents", async () => {
		const root = await createTemporaryRoot();
		const manifest = await generateTranscriptCorpus({
			entropy: "low",
			outputDirectory: join(root, "corpus"),
			seed: "max-subagents",
			source: "claude_code",
			subagentCount: 512,
			timestampLines: 2,
			timestampStart: "2026-08-25T10:00:00.000Z",
			totalBytes: 2 * 1024 * 1024,
		});

		expect(manifest.objects).toHaveLength(513);
		expect(manifest.subagentCount).toBe(512);
		expect(manifest.aggregateBytes).toBe(2 * 1024 * 1024);
	});

	test("reserves main-object bytes for dense timestamp lines", async () => {
		const root = await createTemporaryRoot();
		const manifest = await generateTranscriptCorpus({
			entropy: "low",
			outputDirectory: join(root, "corpus"),
			seed: "dense-timestamps",
			source: "claude_code",
			subagentCount: 8,
			timestampLines: 1_000,
			timestampStart: "2026-08-25T10:00:00.000Z",
			totalBytes: 1024 * 1024,
		});
		const main = manifest.objects.find((object) => object.kind === "main");
		const mainContent = await Bun.file(
			join(root, "corpus", main?.path ?? "missing"),
		).text();

		expect(countTimestampLines(mainContent)).toBe(1_000);
		expect(manifest.aggregateBytes).toBe(1024 * 1024);
	});

	test("high entropy resists gzip compression", async () => {
		const root = await createTemporaryRoot();
		const manifest = await generateTranscriptCorpus({
			entropy: "high",
			outputDirectory: join(root, "corpus"),
			seed: "compression-pressure",
			source: "codex",
			subagentCount: 0,
			timestampLines: 8,
			timestampStart: "2026-08-25T10:00:00.000Z",
			totalBytes: 1024 * 1024,
		});
		const main = manifest.objects[0];
		expect(main).toBeDefined();
		const bytes = await Bun.file(
			join(root, "corpus", main?.path ?? "missing"),
		).bytes();
		const compressionRatio = gzipSync(bytes).byteLength / bytes.byteLength;

		expect(compressionRatio).toBeGreaterThan(0.75);
	});
});

async function createTemporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "opaline-load-test-unit-"));
	temporaryDirectories.push(root);
	return root;
}

function countTimestampLines(content: string): number {
	let count = 0;
	for (const line of content.split("\n")) {
		if (!line) continue;
		const value: unknown = JSON.parse(line);
		if (isRecord(value) && typeof value.timestamp === "string") count += 1;
	}
	return count;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
