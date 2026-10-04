import { describe, expect, test } from "bun:test";
import {
	INGEST_AGGREGATE_CONTENT_MAX_BYTES,
	INGEST_DIRECT_CONTENT_MAX_BYTES,
	IngestSessionInputSchema,
	R2IngestCommitInputSchema,
	R2IngestInitInputSchema,
} from "../index.js";

const HASH = "a".repeat(64);

describe("R2 ingest contract", () => {
	test("accepts one main object plus unique subagents", () => {
		const result = R2IngestInitInputSchema.parse({
			objects: [
				{ agentId: "agent-b", byteLength: 20, kind: "subagent", sha256: HASH },
				{ byteLength: 10, kind: "main", sha256: HASH },
				{ agentId: "agent-a", byteLength: 30, kind: "subagent", sha256: HASH },
			],
			projectPath: "workspace\\project",
			sessionId: "session-1",
			source: "claude_code",
		});

		expect(result.projectPath).toBe("workspace/project");
		expect(result.objects).toHaveLength(3);
	});

	test("rejects missing main objects and duplicate subagent IDs", () => {
		const result = R2IngestInitInputSchema.safeParse({
			objects: [
				{
					agentId: "duplicate",
					byteLength: 10,
					kind: "subagent",
					sha256: HASH,
				},
				{
					agentId: "duplicate",
					byteLength: 20,
					kind: "subagent",
					sha256: HASH,
				},
			],
			projectPath: "/work/project",
			sessionId: "session-1",
			source: "codex",
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.map((issue) => issue.message)).toEqual([
				"Exactly one main transcript object is required",
				"Subagent agentId values must be unique",
			]);
		}
	});

	test("pins the R2 and direct per-session limits mirrored by the CLI", () => {
		expect(INGEST_AGGREGATE_CONTENT_MAX_BYTES).toBe(256 * 1024 * 1024);
		expect(INGEST_DIRECT_CONTENT_MAX_BYTES).toBe(128 * 1024 * 1024);
	});

	test("accepts R2 sessions above the direct limit up to the aggregate limit", () => {
		const result = R2IngestInitInputSchema.safeParse({
			objects: [
				{
					byteLength: INGEST_AGGREGATE_CONTENT_MAX_BYTES - 1,
					kind: "main",
					sha256: HASH,
				},
				{ agentId: "child", byteLength: 1, kind: "subagent", sha256: HASH },
			],
			projectPath: "/work/project",
			sessionId: "session-1",
			source: "claude_code",
		});

		expect(result.success).toBe(true);
	});

	test("parses materialized R2 content up to the aggregate limit", () => {
		const session = {
			projectPath: "/work/project",
			sessionId: "session-1",
			source: "claude_code",
		};
		const content = "x".repeat(INGEST_AGGREGATE_CONTENT_MAX_BYTES);

		expect(
			IngestSessionInputSchema.safeParse({ ...session, content }).success,
		).toBe(true);
		expect(
			IngestSessionInputSchema.safeParse({ ...session, content: `${content}x` })
				.success,
		).toBe(false);
	});

	test("rejects aggregate content above the existing ingest ceiling", () => {
		const result = R2IngestInitInputSchema.safeParse({
			objects: [
				{
					byteLength: INGEST_AGGREGATE_CONTENT_MAX_BYTES,
					kind: "main",
					sha256: HASH,
				},
				{ agentId: "overflow", byteLength: 1, kind: "subagent", sha256: HASH },
			],
			projectPath: "/work/project",
			sessionId: "session-1",
			source: "claude_code",
		});

		expect(result.success).toBe(false);
	});

	test("accepts bounded multipart completion receipts", () => {
		expect(
			R2IngestCommitInputSchema.parse({
				jobId: "00000000-0000-4000-8000-000000000001",
				objects: [
					{
						objectKey: "ingest/job/main.jsonl",
						parts: [{ etag: '"etag-1"', partNumber: 1 }],
						uploadId: "upload-1",
					},
				],
			}),
		).toMatchObject({ jobId: "00000000-0000-4000-8000-000000000001" });
	});
});
