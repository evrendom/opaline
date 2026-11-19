import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { RudelSessionSavedOutputsRowSchema } from "@rudel/ch-schema/generated";
import {
	extractSessionSavedOutputs,
	MAX_MISSING_TASK_IDS,
	MAX_TASK_OUTPUT_REFERENCES,
	parseStagedSessionSavedOutputs,
	type SavedOutputCapture,
	type SessionSavedOutputRow,
} from "./session-saved-outputs.service.js";

const TASKS = "claude-task-outputs";
const TOOLS = "claude-tool-results";
const CAPTURE_ID = "4f0f0e3e-6c1b-4a5e-9d55-2f3a3f8f0c11";
const PARENT_ID = "0b6f4f43-2d8e-4c4f-8f4f-6b1f0d7d1a22";

function blobId(text: string): string {
	return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function available(text: string, extra: Record<string, unknown> = {}) {
	const bytes = new TextEncoder().encode(text).byteLength;
	return {
		status: "available",
		blobId: blobId(text),
		sourceByteLength: bytes,
		storedByteLength: bytes,
		encoding: "utf-8",
		secretFilter: { filterVersion: 3, counts: {}, redactedBytes: 0 },
		...extra,
	};
}

function file(rootId: string, path: string, content: unknown) {
	return {
		rootId,
		path,
		name: path.split("/").at(-1),
		parentPath: null,
		mode: 0o100644,
		modifiedAtMs: 1_790_000_000_123.75,
		categories: [],
		gitProvenance: "outside-repository",
		evidenceReason: null,
		kind: "file",
		size: 10,
		hash: { status: "omitted", reason: "not-file" },
		content,
	};
}

function capture(
	localContext: Record<string, unknown> | undefined,
	blobs: readonly string[] = [],
	completedAt = "2026-10-16T10:00:00.000Z",
): SavedOutputCapture {
	return {
		organizationId: "org_1",
		userId: "user_1",
		stagedAt: new Date("2026-10-16T10:00:05.000Z"),
		manifest:
			localContext === undefined
				? { contextIndex: { facets: [], skills: [] } }
				: { contextIndex: { facets: [], skills: [] }, localContext },
		input: {
			capture: {
				baseGitCommit: null,
				contextId: CAPTURE_ID,
				headGitCommit: null,
				parentContextId: null,
				timing: {
					captureCompletedAt: completedAt,
					captureStartedAt: "2026-10-16T09:59:59.000Z",
					firstActionAt: null,
					firstActionBasis: "unavailable",
					firstActionRelationship: "unknown",
					lifecycle: "end",
				},
				transcriptWatermark: null,
			},
			objects: blobs.map((text) => ({
				byteLength: new TextEncoder().encode(text).byteLength,
				contentEncoding: "identity",
				filterVersion: 3,
				kind: "source-blob",
				mediaType: "text/plain; charset=utf-8",
				objectId: blobId(text),
				sha256: blobId(text).slice("sha256:".length),
			})),
			session: {
				agentId: null,
				parentAgentId: null,
				runId: "run",
				segmentId: "segment",
				sessionId: "session_1",
				source: "claude_code",
			},
		},
	};
}

function byPath(rows: readonly SessionSavedOutputRow[]) {
	return new Map(rows.map((row) => [`${row.root_id}:${row.path}`, row]));
}

const RANK = 2n ** 48n;
const CAPTURED_MS = BigInt(Date.parse("2026-10-16T10:00:00.000Z"));

describe("extractSessionSavedOutputs", () => {
	test("old CLIs: no localContext, no saved output roots, no references", () => {
		expect(extractSessionSavedOutputs(capture(undefined))).toEqual([]);
		expect(
			extractSessionSavedOutputs(
				capture({
					entries: [file("repository", "README.md", available("readme"))],
				}),
			),
		).toEqual([]);
		expect(extractSessionSavedOutputs(capture({}))).toEqual([]);
		expect(
			extractSessionSavedOutputs({ ...capture({}), manifest: "not json" }),
		).toEqual([]);
	});

	test("every status of a task output, with the starting call's reference", () => {
		const rows = byPath(
			extractSessionSavedOutputs(
				capture(
					{
						entries: [
							file(TASKS, "bwhole1.output", available("whole log")),
							file(
								TASKS,
								"rerooted/btail2.output",
								available("tail of log", {
									truncation: { kept: "tail", originalByteLength: 900_000 },
								}),
							),
							file(TASKS, "breuse3.output", {
								...available("earlier"),
								status: "reused",
								parentCaptureId: PARENT_ID,
							}),
							file(TASKS, "bomit4.output", {
								status: "omitted",
								reason: "total-content-cap",
								detail: null,
							}),
							{
								...file(TASKS, "aagent5.output", undefined),
								kind: "symlink",
								target: "/somewhere/agent-x.jsonl",
								targetScope: "external",
								followed: false,
							},
							{ ...file(TASKS, "rerooted", undefined), kind: "directory" },
						],
						taskOutputReferences: {
							references: [
								// A Read and a notification before the starting result.
								{
									taskId: "bwhole1",
									path: "bwhole1.output",
									agentId: null,
									recordIndex: 40,
									toolUseId: "toolu_start1",
									source: "read",
								},
								{
									taskId: "bwhole1",
									path: "bwhole1.output",
									agentId: "agent-a",
									recordIndex: 12,
									toolUseId: "toolu_start1",
									source: "result",
								},
								{
									taskId: "btail2",
									path: "rerooted/btail2.output",
									agentId: null,
									recordIndex: 7,
									toolUseId: null,
									source: "notification",
								},
							],
							omitted: 0,
							missingTaskIds: [],
							missingTaskIdsOmitted: 0,
						},
					},
					["whole log", "tail of log"],
				),
			),
		);
		expect(rows.size).toBe(5);
		expect(rows.get(`${TASKS}:bwhole1.output`)).toMatchObject({
			kind: "task_output",
			task_id: "bwhole1",
			tool_use_id: "toolu_start1",
			agent_id: "agent-a",
			record_idx: 12,
			entry_kind: "file",
			status: "captured",
			blob_object_id: blobId("whole log"),
			blob_capture_id: CAPTURE_ID,
			source_bytes: "9",
			stored_bytes: "9",
			original_bytes: "0",
			truncated: false,
			file_modified_at: "2026-09-21 14:13:20.123",
			capture_id: CAPTURE_ID,
			captured_at: "2026-10-16 10:00:00.000",
			capture_reason: "",
			version: String(3n * RANK + CAPTURED_MS),
			written_at: "2026-10-16 10:00:05.000",
		});
		expect(rows.get(`${TASKS}:rerooted/btail2.output`)).toMatchObject({
			task_id: "btail2",
			tool_use_id: "",
			record_idx: 7,
			status: "truncated",
			truncated: true,
			original_bytes: "900000",
		});
		expect(rows.get(`${TASKS}:breuse3.output`)).toMatchObject({
			status: "reused",
			blob_object_id: blobId("earlier"),
			blob_capture_id: PARENT_ID,
			record_idx: 0,
		});
		expect(rows.get(`${TASKS}:bomit4.output`)).toMatchObject({
			status: "omitted",
			omitted_reason: "total-content-cap",
			blob_object_id: "",
			version: String(2n * RANK + CAPTURED_MS),
		});
		expect(rows.get(`${TASKS}:aagent5.output`)).toMatchObject({
			entry_kind: "symlink",
			status: "symlink",
			blob_object_id: "",
		});
		for (const row of rows.values())
			expect(RudelSessionSavedOutputsRowSchema.parse(row)).toEqual(row);
	});

	test("missing task ids: one row each, unless the output is on disk under another path", () => {
		const rows = extractSessionSavedOutputs(
			capture({
				entries: [file(TASKS, "rerooted/bthere.output", available(""))],
				taskOutputReferences: {
					references: [
						{
							taskId: "bgone",
							path: "bgone.output",
							agentId: null,
							recordIndex: 3,
							toolUseId: "toolu_gone",
							source: "result",
						},
					],
					omitted: 0,
					missingTaskIds: ["bgone", "bthere", "bgone", "bnoref", "../etc"],
					missingTaskIdsOmitted: 0,
				},
			}),
		);
		const missing = rows.filter((row) => row.status === "missing");
		expect(
			missing.map((row) => [row.path, row.task_id, row.tool_use_id]),
		).toEqual([
			["bgone.output", "bgone", "toolu_gone"],
			["bnoref.output", "bnoref", ""],
		]);
		expect(missing[0]).toMatchObject({
			root_id: TASKS,
			kind: "task_output",
			entry_kind: "",
			record_idx: 3,
			file_modified_at: null,
			version: String(1n * RANK + CAPTURED_MS),
		});
		// The empty text has no object of its own.
		expect(rows.find((row) => row.task_id === "bthere")).toMatchObject({
			status: "captured",
			stored_bytes: "0",
		});
	});

	test("tool results take the first reference that names their tool call", () => {
		const rows = byPath(
			extractSessionSavedOutputs(
				capture(
					{
						entries: [
							file(TOOLS, "toolu_big.txt", available("big output")),
							file(TOOLS, "unreferenced.json", available("other")),
						],
						toolResultReferences: {
							references: [
								{
									path: "toolu_big.txt",
									agentId: null,
									recordIndex: 5,
									toolUseId: null,
								},
								{
									path: "toolu_big.txt",
									agentId: "agent-b",
									recordIndex: 9,
									toolUseId: "toolu_big",
								},
							],
							omitted: 0,
						},
					},
					["big output", "other"],
				),
			),
		);
		expect(rows.get(`${TOOLS}:toolu_big.txt`)).toMatchObject({
			kind: "tool_result",
			task_id: "",
			tool_use_id: "toolu_big",
			agent_id: "agent-b",
			record_idx: 9,
			status: "captured",
		});
		expect(rows.get(`${TOOLS}:unreferenced.json`)).toMatchObject({
			tool_use_id: "",
			record_idx: 0,
		});
	});

	test("a sweep capture is marked", () => {
		const [row] = extractSessionSavedOutputs(
			capture(
				{
					captureReason: "task-output-sweep",
					entries: [file(TASKS, "bswept.output", available("swept"))],
				},
				["swept"],
			),
		);
		expect(row?.capture_reason).toBe("task-output-sweep");
		const [unknown] = extractSessionSavedOutputs(
			capture(
				{
					captureReason: "something-else",
					entries: [file(TASKS, "bswept.output", available("swept"))],
				},
				["swept"],
			),
		);
		expect(unknown?.capture_reason).toBe("");
	});

	test("a blob the upload does not carry is omitted, not captured", () => {
		const [row] = extractSessionSavedOutputs(
			capture({ entries: [file(TASKS, "blost.output", available("lost"))] }),
		);
		expect(row).toMatchObject({
			status: "omitted",
			omitted_reason: "blob-not-uploaded",
			blob_object_id: "",
		});
	});

	test("malformed entries and references are ignored", () => {
		const rows = extractSessionSavedOutputs(
			capture(
				{
					entries: [
						"not an entry",
						null,
						file(TASKS, "../escape.output", available("x")),
						file(TASKS, "/abs.output", available("x")),
						file(TASKS, "a//b.output", available("x")),
						file(TASKS, "bad-blob.output", {
							...available("x"),
							blobId: "md5:1",
						}),
						file(TASKS, "git.output", {
							status: "git-object",
							objectId: "a".repeat(40),
							objectFormat: "sha1",
							commit: "b".repeat(40),
							sourceByteLength: 1,
						}),
						file(TASKS, "negative.output", {
							...available("x"),
							storedByteLength: -1,
						}),
						{ ...file(TASKS, "nokind.output", available("x")), kind: "other" },
						file(TASKS, "bgood.output", available("good")),
					],
					taskOutputReferences: {
						references: [
							{ taskId: "bgood", path: "bgood.output" },
							{
								taskId: "bgood",
								path: "bgood.output",
								agentId: null,
								recordIndex: 0,
								toolUseId: "toolu_zero_line",
								source: "result",
							},
							{
								taskId: "bgood",
								path: "bgood.output",
								agentId: null,
								recordIndex: 2,
								toolUseId: "toolu_good",
								source: "bogus",
							},
						],
						missingTaskIds: "bgone",
					},
					toolResultReferences: { references: "nope" },
				},
				["x", "good"],
			),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			path: "bgood.output",
			status: "captured",
			tool_use_id: "",
			record_idx: 0,
		});
	});

	test("references and missing ids are bounded", () => {
		const references = Array.from(
			{ length: MAX_TASK_OUTPUT_REFERENCES + 1 },
			(_, index) => ({
				taskId: `bmiss${index}`,
				path: `bmiss${index}.output`,
				agentId: null,
				recordIndex: index + 1,
				toolUseId: `toolu_${index}`,
				source: "result",
			}),
		);
		const missingTaskIds = references.map((reference) => reference.taskId);
		const rows = extractSessionSavedOutputs(
			capture({
				taskOutputReferences: {
					references,
					omitted: 0,
					missingTaskIds,
					missingTaskIdsOmitted: 0,
				},
			}),
		);
		expect(rows).toHaveLength(MAX_MISSING_TASK_IDS);
		expect(rows.every((row) => row.status === "missing")).toBe(true);
		// Only the first 512 references are read.
		const last = extractSessionSavedOutputs(
			capture({
				taskOutputReferences: {
					references,
					missingTaskIds: [`bmiss${MAX_TASK_OUTPUT_REFERENCES}`],
				},
			}),
		);
		expect(last[0]?.tool_use_id).toBe("");
	});

	test("version ranks content over none, then the later capture", () => {
		const at = (completedAt: string, content: unknown) =>
			BigInt(
				extractSessionSavedOutputs(
					capture(
						{ entries: [file(TASKS, "blog.output", content)] },
						["log"],
						completedAt,
					),
				)[0]?.version ?? "0",
			);
		const earlyCaptured = at("2026-10-16T10:00:00.000Z", available("log"));
		const laterCaptured = at("2026-10-16T11:00:00.000Z", available("log"));
		const laterOmitted = at("2026-10-16T12:00:00.000Z", {
			status: "omitted",
			reason: "file-content-cap",
			detail: null,
		});
		const laterMissing = BigInt(
			extractSessionSavedOutputs(
				capture(
					{
						taskOutputReferences: { references: [], missingTaskIds: ["blog"] },
					},
					[],
					"2026-10-16T13:00:00.000Z",
				),
			)[0]?.version ?? "0",
		);
		expect(laterCaptured).toBeGreaterThan(earlyCaptured);
		expect(earlyCaptured).toBeGreaterThan(laterOmitted);
		expect(laterOmitted).toBeGreaterThan(laterMissing);
	});
});

describe("parseStagedSessionSavedOutputs", () => {
	test("keeps valid rows, counts invalid ones, accepts nothing staged", () => {
		const [row] = extractSessionSavedOutputs(
			capture({ entries: [file(TASKS, "bok.output", available("ok"))] }, [
				"ok",
			]),
		);
		expect(parseStagedSessionSavedOutputs(null)).toEqual({
			rows: [],
			invalid: 0,
		});
		expect(parseStagedSessionSavedOutputs({})).toEqual({
			rows: [],
			invalid: 1,
		});
		expect(
			parseStagedSessionSavedOutputs([row, { ...row, record_idx: "x" }]),
		).toEqual({ rows: [row as SessionSavedOutputRow], invalid: 1 });
	});
});
