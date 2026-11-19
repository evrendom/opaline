import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { getAdapter } from "@rudel/agent-adapters";
import type { IngestSessionInput } from "@rudel/api-routes";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	type TranscriptSource,
} from "@rudel/api-routes/transcript-records";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getClickhouse,
} from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { ClickHouseWriteFencedError } from "../lib/clickhouse-write-fence.js";
import { enqueueClickHousePurge } from "../services/clickhouse-purge.service.js";
import { assertNoClickHousePurgeTombstone } from "../services/clickhouse-purge-tombstone.service.js";
import { reconcileDerivedTranscriptRecords } from "../services/derived-records-reconciliation.service.js";
import {
	RETIREMENT_GRACE_MS,
	retireGenerations,
} from "../services/generation-retirement/retirement.js";
import { transcriptRecordsStore } from "../services/generation-retirement/stores.js";
import {
	backfillTranscriptRecords,
	previewTranscriptRecordsBackfill,
} from "../services/transcript-records-backfill.service.js";
import {
	buildTranscriptRecordRow,
	buildTranscriptRecordsReceiptRow,
	hashTranscriptContent,
	readTranscriptRecordsReceipt,
	writeTranscriptRecords,
} from "../services/transcript-records-ingest.service.js";
import {
	readRecord,
	readSessionFacts,
	readSessionMap,
	readTurn,
} from "../services/transcript-records-reader.service.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

setDefaultTimeout(120_000);

const RUN_ID = crypto.randomUUID();
const CUT_MARKER = /…(?: \[truncated \d+ of \d+ chars\])?$/u;
// Relative to now so the fixtures stay inside the ingest window and the raw
// table's TTL no matter when the suite runs.
const BASE_TIME_MS =
	Math.floor((Date.now() - 2 * 60 * 60 * 1_000) / 1_000) * 1_000;
const SESSION_DATE = at(0);

function at(offsetSeconds: number): string {
	return new Date(BASE_TIME_MS + offsetSeconds * 1_000).toISOString();
}
const clickhouse = getClickhouse();

const organizationId = `org_records_${RUN_ID}`;
const userId = `user_records_${RUN_ID}`;
const otherUserId = `user_records_other_${RUN_ID}`;
const otherOrganizationId = `org_records_other_${RUN_ID}`;
const scope = { organizationId, userId };

const createdApiUserIds: string[] = [];
const createdRecordsOrganizationIds: string[] = [];
let enabledServer: ApiTestServer | undefined;
let disabledServer: ApiTestServer | undefined;

afterAll(async () => {
	await enabledServer?.stop();
	await disabledServer?.stop();
	const ids = [
		organizationId,
		otherOrganizationId,
		...createdApiUserIds,
		...createdRecordsOrganizationIds,
	];
	for (const table of [
		"rudel.transcript_records",
		"rudel.claude_sessions",
		"rudel.codex_sessions",
		"rudel.session_analytics",
		"rudel.usage_events",
		"rudel.skill_receipts",
		"rudel.skill_uses",
		"rudel.skill_version_contents",
		"rudel.session_git_observations",
	]) {
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id IN {ids:Array(String)} SETTINGS lightweight_deletes_sync = 3`,
			query_params: { ids },
		});
	}
	for (const id of createdApiUserIds) {
		await sqlClient`DELETE FROM organization WHERE id = ${id}`;
		await sqlClient`DELETE FROM "user" WHERE id = ${id}`;
	}
});

function line(value: unknown): string {
	return JSON.stringify(value);
}

function claudeSession() {
	const main = [
		line({
			message: {
				content:
					"<system_instruction>workspace rules</system_instruction>\n\nmake the login tests pass",
				role: "user",
			},
			timestamp: at(1),
			type: "user",
		}),
		line({
			message: {
				content: [
					{
						id: "t-test",
						input: { command: "bun run test:integration" },
						name: "Bash",
						type: "tool_use",
					},
					{
						id: "t-edit-ok",
						input: {
							file_path: "src/login.ts",
							new_string: "b",
							old_string: "a",
						},
						name: "Edit",
						type: "tool_use",
					},
					{
						id: "t-edit-bad",
						input: {
							file_path: "src/missing.ts",
							new_string: "b",
							old_string: "a",
						},
						name: "Edit",
						type: "tool_use",
					},
					{
						id: "t-task",
						input: { description: "explore", prompt: "look around" },
						name: "Task",
						type: "tool_use",
					},
				],
				role: "assistant",
			},
			timestamp: at(5),
			type: "assistant",
		}),
		line({
			message: {
				content: [
					{
						content: `Exit code 1\n${"noise ".repeat(400)}FAILED login.test.ts`,
						is_error: true,
						tool_use_id: "t-test",
						type: "tool_result",
					},
					{ content: "ok", tool_use_id: "t-edit-ok", type: "tool_result" },
					{
						content: "String to replace not found",
						is_error: true,
						tool_use_id: "t-edit-bad",
						type: "tool_result",
					},
				],
				role: "user",
			},
			timestamp: at(9),
			type: "user",
		}),
		line({
			message: {
				content: [
					{ content: "done", tool_use_id: "t-task", type: "tool_result" },
				],
				role: "user",
			},
			timestamp: at(10),
			toolUseResult: { agentId: "agent-explorer" },
			type: "user",
		}),
		line({
			message: { content: "now run the linter héllo 日本語", role: "user" },
			timestamp: at(300),
			type: "user",
		}),
		line({
			message: {
				content: [
					{
						id: "t-lint",
						input: { command: "bun run lint" },
						name: "Bash",
						type: "tool_use",
					},
					{
						id: "t-sed",
						input: { command: "sed -i '' 's/a/b/' src/format.ts" },
						name: "Bash",
						type: "tool_use",
					},
				],
				role: "assistant",
			},
			timestamp: at(302),
			type: "assistant",
		}),
		line({
			message: {
				content: [
					{ content: "clean", tool_use_id: "t-lint", type: "tool_result" },
					{ content: "", tool_use_id: "t-sed", type: "tool_result" },
				],
				role: "user",
			},
			timestamp: at(304),
			type: "user",
		}),
	].join("\n");
	const subagent = [
		line({
			message: { content: "explore the repository", role: "user" },
			timestamp: at(6),
			type: "user",
		}),
		line({
			message: {
				content: [{ text: "found it", type: "text" }],
				role: "assistant",
			},
			timestamp: at(7),
			type: "assistant",
		}),
	].join("\n");
	return { main, subagents: { "agent-explorer": subagent } };
}

async function writeSession(input: {
	readonly content: string;
	readonly assertWritable?: () => Promise<void>;
	readonly omitReceipt?: boolean;
	readonly organizationId?: string;
	readonly now?: () => Date;
	readonly revision: string;
	readonly sessionId: string;
	readonly source?: TranscriptSource;
	readonly subagents?: Record<string, string>;
	readonly textBudgetChars?: number;
	readonly textMaxChars?: number;
	readonly userId?: string;
}) {
	const stats = createSplitStats();
	const drafts = splitSessionTranscript(
		{
			content: input.content,
			sessionDate: SESSION_DATE,
			source: input.source ?? "claude_code",
			subagents: input.subagents,
			textBudgetChars: input.textBudgetChars,
			textMaxChars: input.textMaxChars,
		},
		stats,
	);
	if (input.omitReceipt) {
		// Simulates a crash before the receipt: rows exist but are not readable.
		const rows = [...drafts].map((draft) =>
			buildTranscriptRecordRow(
				{
					organizationId: input.organizationId ?? organizationId,
					revision: input.revision,
					sessionDate: SESSION_DATE,
					sessionId: input.sessionId,
					source: input.source ?? "claude_code",
					userId: input.userId ?? userId,
				},
				draft,
			),
		);
		await clickhouse.insert({
			asyncInsert: false,
			table: "rudel.transcript_records",
			values: rows,
		});
		return;
	}
	await writeTranscriptRecords(clickhouse, {
		now: input.now,
		assertWritable: input.assertWritable ?? (async () => {}),
		contentSha256: hashTranscriptContent(input.content, input.subagents),
		drafts,
		organizationId: input.organizationId ?? organizationId,
		revision: input.revision,
		sessionDate: SESSION_DATE,
		sessionId: input.sessionId,
		source: input.source ?? "claude_code",
		summary: () => summarizeSplit(stats),
		userId: input.userId ?? userId,
	});
}

/** Distinct generations that still have rows for one session, oldest first. */
async function readStoredRevisions(
	sessionId: string,
	organization = organizationId,
	user = userId,
): Promise<string[]> {
	const rows = await clickhouse.query<{ revision: string }>({
		query: `
			SELECT DISTINCT toString(revision) AS revision
			FROM rudel.transcript_records
			WHERE organization_id = {organization:String}
				AND user_id = {user:String}
				AND session_id = {sessionId:String}
			ORDER BY revision
		`,
		query_params: { organization, sessionId, user },
	});
	return rows.map((row) => row.revision);
}

async function optimizeFinal(): Promise<void> {
	await clickhouse.execute({
		query: "OPTIMIZE TABLE rudel.transcript_records FINAL",
	});
}

/** Runs `afterQuery` once, right after the wrapped executor's nth read. */
function publishingAfterQuery(
	nth: number,
	afterQuery: () => Promise<void>,
): ClickHouseExecutor {
	let reads = 0;
	return {
		close: () => clickhouse.close(),
		execute: (statement) => clickhouse.execute(statement),
		insert: (params) => clickhouse.insert(params),
		async query<T>(statement: Parameters<typeof clickhouse.query>[0]) {
			const rows = await clickhouse.query<T>(statement);
			reads++;
			if (reads === nth) await afterQuery();
			return rows;
		},
	};
}

function publishingAfterFirstQuery(
	afterFirstQuery: () => Promise<void>,
): ClickHouseExecutor {
	return publishingAfterQuery(1, afterFirstQuery);
}

describe("transcript record readers", () => {
	const sessionId = `records_${RUN_ID}_main`;
	const session = claudeSession();

	test("facts count only observed data and exclude failed mutations", async () => {
		await writeSession({
			content: session.main,
			revision: "100",
			sessionId,
			subagents: session.subagents,
		});

		const [facts] = await readSessionFacts(scope, [sessionId]);

		assert(facts);
		expect(facts).toMatchObject({
			indexed: true,
			revision: "100",
			source: "claude_code",
			subagents: { agentIds: ["agent-explorer"], spawned: 1 },
			tests: { failed: 1, run: 1 },
			toolErrors: 2,
			turns: 2,
		});
		expect(facts.filesChanged).toEqual({
			count: 2,
			paths: ["src/format.ts", "src/login.ts"],
		});
		expect(facts.commands).toMatchObject({
			lint: { count: 1, failed: 0 },
			test: { count: 1, failed: 1 },
		});
		expect(facts.receipt?.contentSha256).toBe(
			hashTranscriptContent(session.main, session.subagents),
		);
	});

	test("the session map has one row per turn without reading text", async () => {
		const map = await readSessionMap(scope, sessionId);

		expect(map.indexed).toBe(true);
		expect(map.turns.map((turn) => turn.turnIdx)).toEqual([1, 2]);
		expect(map.turns[0]).toMatchObject({
			filesChanged: { count: 1, paths: ["src/login.ts"] },
			promptExcerpt: "make the login tests pass",
			subagentSpawns: 1,
			toolErrors: 2,
		});
		expect(map.turns[0]?.commands.test).toEqual({ count: 1, failed: 1 });
		expect(map.turns[1]).toMatchObject({
			filesChanged: { count: 1, paths: ["src/format.ts"] },
			promptExcerpt: "now run the linter héllo 日本語",
			toolErrors: 0,
		});
		const first = map.turns[0];
		const second = map.turns[1];
		assert(first && second);
		expect(first.startedAt < second.startedAt).toBe(true);
		const bytes = Buffer.from(session.main, "utf8");
		const turnBytes = bytes
			.subarray(second.byteStart, second.byteEnd)
			.toString("utf8");
		expect(
			turnBytes.startsWith('{"message":{"content":"now run the linter'),
		).toBe(true);
	});

	test("subagent streams have their own map", async () => {
		const map = await readSessionMap(scope, sessionId, {
			agentId: "agent-explorer",
		});

		expect(map.turns).toHaveLength(1);
		expect(map.turns[0]?.promptExcerpt).toBe("explore the repository");
	});

	test("compact turns list actions with exit codes and failed output tails", async () => {
		const turn = await readTurn(scope, sessionId, 1, "compact", 4_000);

		expect(turn.found).toBe(true);
		expect(turn.prompt?.text).toBe("make the login tests pass");
		const bash = turn.actions.find((action) => action.tool === "Bash");
		expect(bash).toMatchObject({
			commandClass: "test",
			exitCode: 1,
			status: "error",
			target: "bun run test:integration",
		});
		expect(
			turn.actions
				.filter((action) => action.tool === "Edit")
				.map((action) => action.status),
		).toEqual(["ok", "error"]);
		expect(turn.failures[0]?.excerpt).toContain("FAILED login.test.ts");
		expect(turn.changedFiles.map((file) => file.path)).toEqual([
			"src/login.ts",
		]);
	});

	test("error, diff, and raw views", async () => {
		const errors = await readTurn(scope, sessionId, 1, "errors", 4_000);
		expect(errors.failures.map((failure) => failure.tool)).toEqual([
			"Bash",
			"Edit",
		]);

		const diff = await readTurn(scope, sessionId, 2, "diff", 4_000);
		expect(diff.changes).toHaveLength(1);
		expect(diff.changes[0]).toMatchObject({
			operation: "edit",
			origin: "shell",
			path: "src/format.ts",
		});
		expect(diff.changes[0]?.command).toContain("sed -i");
		const nativeDiff = await readTurn(scope, sessionId, 1, "diff", 4_000);
		expect(nativeDiff.changes.map((change) => change.path)).toEqual([
			"src/login.ts",
		]);
		expect(JSON.parse(nativeDiff.changes[0]?.input ?? "")).toMatchObject({
			new_string: "b",
			old_string: "a",
		});

		const raw = await readTurn(scope, sessionId, 1, "raw", 500);
		expect(raw.truncated).toBe(true);
		expect(raw.records.map((record) => record.kind)).toContain("tool_result");
		expect(
			raw.records.reduce((total, record) => total + record.text.length, 0),
		).toBeLessThanOrEqual(500);
		expect(raw.records.map((record) => record.kind)).toEqual([
			"user_prompt",
			// The workspace rules that came with the prompt.
			"injected_context",
			"tool_call",
			"tool_call",
			"file_change",
			"tool_call",
			"file_change",
			"tool_call",
			"tool_result",
			"tool_result",
			"tool_result",
			"tool_result",
		]);
		expect(
			raw.records
				.filter((record) => record.kind === "tool_result")
				.every((record) => record.text.length > 0),
		).toBe(true);
		expect(
			raw.records
				.filter((record) => record.textTruncated)
				.every((record) => CUT_MARKER.test(record.text)),
		).toBe(true);
		expect(
			raw.records.reduce(
				(total, record) =>
					total +
					24 +
					record.kind.length +
					record.subtype.length +
					record.tool.length +
					record.commandClass.length +
					record.filePath.length +
					record.callId.length +
					record.text.length,
				0,
			),
		).toBeLessThanOrEqual(500);
	});

	test("raw reads preserve order, bound every string, and mark cuts at each budget", async () => {
		const complete = await readTurn(scope, sessionId, 1, "raw", 10_000);
		expect(complete.truncated).toBe(false);
		for (const maxChars of [200, 500, 1_000, 4_000]) {
			const raw = await readTurn(scope, sessionId, 1, "raw", maxChars);
			expect(
				raw.records.map((record) => [record.recordIdx, record.blockIdx]),
			).toEqual(
				complete.records
					.slice(0, raw.records.length)
					.map((record) => [record.recordIdx, record.blockIdx]),
			);
			expect(
				raw.records.reduce(
					(total, record) =>
						total +
						24 +
						record.kind.length +
						record.subtype.length +
						record.tool.length +
						record.commandClass.length +
						record.filePath.length +
						record.callId.length +
						record.text.length,
					0,
				),
			).toBeLessThanOrEqual(maxChars);
			expect(
				raw.records.every(
					(record) => record.textChars === 0 || record.text.length > 0,
				),
			).toBe(true);
			expect(
				raw.records
					.filter((record) => record.textTruncated)
					.every((record) => CUT_MARKER.test(record.text)),
			).toBe(true);
			if (maxChars >= 500)
				expect(raw.records).toHaveLength(complete.records.length);
		}
	});

	test("raw reads keep prompts and results whole when extraction's text budget is exhausted", async () => {
		const cappedSessionId = `${sessionId}_raw_heads`;
		await writeSession({
			content: session.main,
			revision: "100",
			sessionId: cappedSessionId,
			textBudgetChars: 0,
		});
		const raw = await readTurn(scope, cappedSessionId, 1, "raw", 4_000);
		expect(raw.records).toHaveLength(12);
		expect(raw.records[0]?.text).toBe("make the login tests pass");
		const failedResult = raw.records.find(
			(record) => record.kind === "tool_result" && record.callId === "t-test",
		);
		assert(failedResult);
		expect(failedResult.text).toBe(
			`Exit code 1\n${"noise ".repeat(400)}FAILED login.test.ts`,
		);
		expect(failedResult.textTruncated).toBe(false);
		expect(raw.truncated).toBe(false);
	});

	test("record reads fall back to the exact raw line when storage capped the text", async () => {
		const rawSessionId = `${sessionId}_raw_fallback`;
		const output = Array.from(
			{ length: 400 },
			(_, index) => `line ${index} ✓ 日本`,
		).join("\n");
		const childReport = `Subagent report: ${"finding ".repeat(300)}done`;
		const main = [
			line({
				message: { content: "run the long suite", role: "user" },
				timestamp: at(1),
				type: "user",
			}),
			line({
				message: {
					content: [
						{
							id: "t-long",
							input: { command: "bun test" },
							name: "Bash",
							type: "tool_use",
						},
					],
					role: "assistant",
				},
				timestamp: at(2),
				type: "assistant",
			}),
			line({
				message: {
					content: [
						{ content: output, tool_use_id: "t-long", type: "tool_result" },
					],
					role: "user",
				},
				timestamp: at(3),
				type: "user",
			}),
		].join("\n");
		const child = [
			line({
				agentId: "agent-raw",
				isSidechain: true,
				message: { content: "Report the findings.", role: "user" },
				timestamp: at(4),
				type: "user",
			}),
			line({
				agentId: "agent-raw",
				isSidechain: true,
				message: {
					content: [{ text: childReport, type: "text" }],
					role: "assistant",
				},
				timestamp: at(5),
				type: "assistant",
			}),
		].join("\n");
		await getAdapter("claude_code").ingest(
			clickhouse,
			{
				content: main,
				projectPath: "/test/raw-fallback",
				sessionId: rawSessionId,
				source: "claude_code",
				subagents: [{ agentId: "agent-raw", content: child }],
			},
			{
				ingestedAt: new Date(BASE_TIME_MS),
				organizationId,
				revision: "500",
				timestamps: { lastInteractionDate: at(5), sessionDate: SESSION_DATE },
				userId,
			},
		);
		await writeSession({
			content: main,
			revision: "500",
			sessionId: rawSessionId,
			subagents: { "agent-raw": child },
			textMaxChars: 100,
		});

		const characters = Array.from(output);
		const middle = await readRecord(scope, rawSessionId, 3, 4_000, 4_050);
		expect(middle).toMatchObject({
			kind: "tool_result",
			textChars: characters.length,
			textFromRaw: true,
			textTruncatedInStorage: false,
			text: characters.slice(4_000, 4_050).join(""),
		});
		// Within the stored prefix nothing extra is read.
		const stored = await readRecord(scope, rawSessionId, 3, 0, 20);
		expect(stored).toMatchObject({
			textFromRaw: false,
			text: characters.slice(0, 20).join(""),
		});
		const childText = await readRecord(scope, rawSessionId, 2, 2_000, 2_404, {
			agentId: "agent-raw",
		});
		expect(childText).toMatchObject({
			kind: "assistant_text",
			textFromRaw: true,
			text: Array.from(childReport).slice(2_000, 2_404).join(""),
		});

		// A generation whose raw revision is gone keeps its stored, capped text.
		const orphanSessionId = `${sessionId}_raw_fallback_orphan`;
		await writeSession({
			content: main,
			revision: "501",
			sessionId: orphanSessionId,
			textMaxChars: 100,
		});
		const orphan = await readRecord(scope, orphanSessionId, 3, 4_000, 4_050);
		expect(orphan).toMatchObject({
			found: true,
			text: "",
			textFromRaw: false,
			textTruncatedInStorage: true,
		});
	});

	test("realistic Codex and Claude subagents expose delegated turns through all readers", async () => {
		for (const [source, fixture, promptLine] of [
			["codex", "codex-subagent-turns.jsonl", 4],
			["claude_code", "claude-subagent-turns.jsonl", 1],
		] as const) {
			const childSessionId = `${sessionId}_${source}_native_child`;
			const content = await Bun.file(
				new URL(
					`../../../../../packages/api-routes/src/session-transcript/__fixtures__/${fixture}`,
					import.meta.url,
				),
			).text();
			await writeSession({
				content,
				source,
				revision: "100",
				sessionId: childSessionId,
			});
			const [facts] = await readSessionFacts(scope, [childSessionId]);
			expect(facts).toMatchObject({
				turns: 2,
				parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
			});
			const map = await readSessionMap(scope, childSessionId);
			expect(
				map.turns
					.filter((turn) => turn.turnIdx > 0)
					.map((turn) => turn.turnIdx),
			).toEqual([1, 2]);
			const turn = await readTurn(scope, childSessionId, 1, "raw", 500);
			expect(
				turn.records.find((record) => record.kind === "user_prompt"),
			).toMatchObject({
				recordIdx: promptLine,
				subtype: "delegation",
				text: "Inspect the synthetic parser.",
			});
			expect(
				turn.records.filter((record) => record.kind === "tool_result"),
			).toHaveLength(1);
			const prompt = await readRecord(
				scope,
				childSessionId,
				promptLine,
				0,
				100,
			);
			expect(prompt).toMatchObject({
				kind: "user_prompt",
				subtype: "delegation",
				turnIdx: 1,
				text: "Inspect the synthetic parser.",
			});
		}
	});

	test("record reads return exact character slices", async () => {
		const map = await readSessionMap(scope, sessionId);
		const prompt = await readTurn(scope, sessionId, 2, "raw", 4_000);
		const promptRecord = prompt.records.find(
			(record) => record.kind === "user_prompt",
		);
		assert(promptRecord);

		const slice = await readRecord(
			scope,
			sessionId,
			promptRecord.recordIdx,
			4,
			11,
		);

		expect(map.turns).toHaveLength(2);
		expect(slice).toMatchObject({
			found: true,
			kind: "user_prompt",
			text: "run the",
			textTruncatedInStorage: false,
		});
		const multibyte = await readRecord(
			scope,
			sessionId,
			promptRecord.recordIdx,
			19,
			29,
		);
		expect(multibyte.text).toBe("héllo 日本語");
	});

	test("another user or organization never sees the session", async () => {
		const foreignUser = await readSessionFacts(
			{ organizationId, userId: otherUserId },
			[sessionId],
		);
		const foreignOrganization = await readSessionFacts(
			{ organizationId: otherOrganizationId, userId },
			[sessionId],
		);
		const foreignMap = await readSessionMap(
			{ organizationId, userId: otherUserId },
			sessionId,
		);
		const foreignTurn = await readTurn(
			{ organizationId: otherOrganizationId, userId },
			sessionId,
			1,
			"raw",
			4_000,
		);

		expect(foreignUser[0]?.indexed).toBe(false);
		expect(foreignOrganization[0]?.indexed).toBe(false);
		expect(foreignMap.indexed).toBe(false);
		expect(foreignTurn.found).toBe(false);
	});

	test("rewriting a revision is idempotent and a newer revision replaces it", async () => {
		const [before] = await readSessionFacts(scope, [sessionId]);
		await writeSession({
			content: session.main,
			revision: "100",
			sessionId,
			subagents: session.subagents,
		});
		const [rewritten] = await readSessionFacts(scope, [sessionId]);
		expect(rewritten?.records).toBe(before?.records ?? -1);
		expect(rewritten?.turns).toBe(2);

		const grown = `${session.main}\n${line({
			message: { content: "one more thing", role: "user" },
			timestamp: at(600),
			type: "user",
		})}`;
		await writeSession({
			content: grown,
			revision: "200",
			sessionId,
			subagents: session.subagents,
		});

		const [facts] = await readSessionFacts(scope, [sessionId]);
		expect(facts).toMatchObject({ revision: "200", turns: 3 });
	});

	test("a revision without a receipt is invisible until it completes", async () => {
		await writeSession({
			content: `${session.main}\n${line({
				message: { content: "half written", role: "user" },
				timestamp: at(1200),
				type: "user",
			})}`,
			omitReceipt: true,
			revision: "300",
			sessionId,
			subagents: session.subagents,
		});

		const [facts] = await readSessionFacts(scope, [sessionId]);
		const receipt = await readTranscriptRecordsReceipt(clickhouse, {
			organizationId,
			sessionId,
			userId,
		});

		expect(facts?.revision).toBe("200");
		expect(receipt?.revision).toBe("200");
	});

	test("an incomplete newer generation can never merge away the committed one", async () => {
		const crashSessionId = `${sessionId}_crash`;
		await writeSession({
			content: session.main,
			revision: "100",
			sessionId: crashSessionId,
			subagents: session.subagents,
		});
		const [before] = await readSessionFacts(scope, [crashSessionId]);
		assert(before);

		// The newer revision overlaps every record identity of revision 100 and
		// crashes before its receipt. Merging must leave revision 100 untouched.
		await writeSession({
			content: `${session.main}\n${line({
				message: { content: "half written", role: "user" },
				timestamp: at(1200),
				type: "user",
			})}`,
			omitReceipt: true,
			revision: "200",
			sessionId: crashSessionId,
			subagents: session.subagents,
		});
		await optimizeFinal();

		const [after] = await readSessionFacts(scope, [crashSessionId]);
		expect(after).toMatchObject({
			indexed: true,
			records: before.records,
			revision: "100",
			turns: 2,
		});
		expect(after?.filesChanged).toEqual(before.filesChanged);
		const prompt = await readTurn(scope, crashSessionId, 2, "raw", 4_000);
		expect(
			prompt.records.find((record) => record.kind === "user_prompt")?.text,
		).toBe("now run the linter héllo 日本語");
		expect(await readStoredRevisions(crashSessionId)).toEqual(["100", "200"]);
	});

	test("publishing keeps superseded generations; the batched retirement removes them after the grace", async () => {
		const generationSessionId = `${sessionId}_generations`;
		const generationOrganizationId = `org_records_generations_${RUN_ID}`;
		createdRecordsOrganizationIds.push(generationOrganizationId);
		const publish = (revision: string) =>
			writeSession({
				content: `${session.main}\n${line({
					message: { content: `revision ${revision}`, role: "user" },
					timestamp: at(900),
					type: "user",
				})}`,
				organizationId: generationOrganizationId,
				revision,
				sessionId: generationSessionId,
				subagents: session.subagents,
			});

		await publish("100");
		await publish("200");
		await publish("300");
		await publish("400");
		expect(
			await readStoredRevisions(generationSessionId, generationOrganizationId),
		).toEqual(["100", "200", "300", "400"]);

		const later = Date.now() + 2 * RETIREMENT_GRACE_MS;
		expect(
			await retireGenerations(clickhouse, transcriptRecordsStore, {
				deadline: { deadlineAt: later + 600_000, now: () => later },
				organizationId: generationOrganizationId,
			}),
		).toMatchObject({ retired: 3, deleteStatements: 1, hasMore: false });
		expect(
			await readStoredRevisions(generationSessionId, generationOrganizationId),
		).toEqual(["400"]);
		const [facts] = await readSessionFacts(
			{ organizationId: generationOrganizationId, userId },
			[generationSessionId],
		);
		expect(facts).toMatchObject({ revision: "400", turns: 3 });
	});

	test("two publications between a record's metadata and text reads leave the read intact", async () => {
		const leaseSessionId = `${sessionId}_two_publications`;
		const publish = (revision: string, prompt: string) =>
			writeSession({
				content: session.main.replace("make the login tests pass", prompt),
				revision,
				sessionId: leaseSessionId,
				subagents: session.subagents,
			});
		await publish("100", "make the login tests pass");

		// readRecord reads: 1 resolves the generation, 2 reads block metadata, 3
		// reads the text. Two generations are published between 2 and 3.
		const record = await readRecord(scope, leaseSessionId, 1, 0, 25, {
			executor: publishingAfterQuery(2, async () => {
				await publish("200", "second opening prompt");
				await publish("300", "third opening prompt");
			}),
		});

		expect(record).toMatchObject({
			found: true,
			kind: "user_prompt",
			text: "make the login tests pass",
		});
		expect(await readStoredRevisions(leaseSessionId)).toEqual([
			"100",
			"200",
			"300",
		]);
		const fresh = await readRecord(scope, leaseSessionId, 1, 0, 25);
		expect(fresh.text).toBe("third opening prompt");
	});

	test("rebuilding a generation after a confirmed fence deletion indexes every record", async () => {
		const retrySessionId = `${sessionId}_fence_retry`;
		const controlSessionId = `${sessionId}_fence_control`;
		await writeSession({
			content: session.main,
			revision: "100",
			sessionId: controlSessionId,
			subagents: session.subagents,
		});
		const [control] = await readSessionFacts(scope, [controlSessionId]);
		assert(control);
		let checks = 0;

		await expect(
			writeSession({
				assertWritable: async () => {
					checks++;
					if (checks === 2) throw new ClickHouseWriteFencedError();
				},
				content: session.main,
				revision: "100",
				sessionId: retrySessionId,
				subagents: session.subagents,
			}),
		).rejects.toBeInstanceOf(ClickHouseWriteFencedError);
		expect(await readStoredRevisions(retrySessionId)).toEqual([]);

		// Same raw revision, inside ClickHouse's deduplication window.
		await writeSession({
			content: session.main,
			revision: "100",
			sessionId: retrySessionId,
			subagents: session.subagents,
		});

		const [rebuilt] = await readSessionFacts(scope, [retrySessionId]);
		expect(rebuilt).toMatchObject({
			indexed: true,
			records: control.records,
			revision: "100",
		});
		expect(rebuilt?.receipt?.rowCount).toBe(control.receipt?.rowCount);
	});

	test("a read stays on the generation it resolved when a newer one is published", async () => {
		const pinnedSessionId = `${sessionId}_pinned`;
		await writeSession({
			content: session.main,
			revision: "100",
			sessionId: pinnedSessionId,
			subagents: session.subagents,
		});
		const rewritten = session.main.replace(
			"make the login tests pass",
			"a completely different first prompt",
		);
		const racing = publishingAfterFirstQuery(() =>
			writeSession({
				content: rewritten,
				revision: "200",
				sessionId: pinnedSessionId,
				subagents: session.subagents,
			}),
		);

		const during = await readTurn(scope, pinnedSessionId, 1, "compact", 4_000, {
			executor: racing,
		});
		const after = await readTurn(scope, pinnedSessionId, 1, "compact", 4_000);

		expect(during).toMatchObject({ found: true, revision: "100" });
		expect(during.prompt?.text).toBe("make the login tests pass");
		expect(after).toMatchObject({ found: true, revision: "200" });
		expect(after.prompt?.text).toBe("a completely different first prompt");
	});

	test("facts, maps, and record reads also stay on one generation", async () => {
		const raceSessionId = `${sessionId}_race`;
		await writeSession({
			content: session.main,
			revision: "100",
			sessionId: raceSessionId,
			subagents: session.subagents,
		});
		const grown = `${session.main}\n${line({
			message: { content: "one more thing", role: "user" },
			timestamp: at(600),
			type: "user",
		})}`;
		const publishGrown = () =>
			writeSession({
				content: grown,
				revision: "200",
				sessionId: raceSessionId,
				subagents: session.subagents,
			});

		const [facts] = await readSessionFacts(scope, [raceSessionId], {
			executor: publishingAfterFirstQuery(publishGrown),
		});

		expect(facts).toMatchObject({ revision: "100", turns: 2 });
		const [newest] = await readSessionFacts(scope, [raceSessionId]);
		expect(newest).toMatchObject({ revision: "200", turns: 3 });
		const map = await readSessionMap(scope, raceSessionId, {
			executor: publishingAfterFirstQuery(async () => {
				await writeSession({
					content: `${grown}\n${line({
						message: { content: "and another", role: "user" },
						timestamp: at(700),
						type: "user",
					})}`,
					revision: "300",
					sessionId: raceSessionId,
					subagents: session.subagents,
				});
			}),
		});
		expect(map).toMatchObject({ revision: "200" });
		expect(map.turns).toHaveLength(3);
		const record = await readRecord(scope, raceSessionId, 1, 0, 25, {
			executor: publishingAfterFirstQuery(() =>
				writeSession({
					content: grown.replace(
						"make the login tests pass",
						"different opening prompt",
					),
					revision: "400",
					sessionId: raceSessionId,
					subagents: session.subagents,
				}),
			),
		});
		expect(record).toMatchObject({
			found: true,
			kind: "user_prompt",
			text: "make the login tests pass",
		});
		const fresh = await readRecord(scope, raceSessionId, 1, 0, 25);
		expect(fresh.text).toBe("different opening prompt");
	});

	test("compact reads charge actions, paths, and targets against maxChars", async () => {
		const budgetSessionId = `${sessionId}_budget`;
		const calls = Array.from({ length: 300 }, (_, index) => ({
			id: `budget-${index}`,
			input: { command: `echo ${"x".repeat(150)} ${index}` },
			name: "Bash",
			type: "tool_use",
		}));
		await writeSession({
			content: [
				line({
					message: { content: "run many commands", role: "user" },
					timestamp: at(1),
					type: "user",
				}),
				line({
					message: { content: calls, role: "assistant" },
					timestamp: at(2),
					type: "assistant",
				}),
			].join("\n"),
			revision: "100",
			sessionId: budgetSessionId,
		});

		const turn = await readTurn(scope, budgetSessionId, 1, "compact", 600);

		const emitted =
			(turn.prompt?.text.length ?? 0) +
			turn.actions.reduce(
				(total, action) =>
					total +
					action.target.length +
					action.tool.length +
					action.filePath.length +
					action.commandClass.length,
				0,
			);
		expect(turn.truncated).toBe(true);
		expect(turn.actions.length).toBeLessThan(300);
		expect(emitted).toBeLessThanOrEqual(600);
	});

	test("record reads keep the subtype that explains where a record came from", async () => {
		const delegated = await readRecord(scope, sessionId, 1, 0, 40, {
			agentId: "agent-explorer",
		});

		expect(delegated).toMatchObject({
			found: true,
			kind: "user_prompt",
			subtype: "delegation",
		});
	});

	test("unknown sessions report indexed false", async () => {
		const [facts] = await readSessionFacts(scope, [`missing_${RUN_ID}`]);

		expect(facts).toMatchObject({ indexed: false, turns: 0 });
	});

	test("parser v6 facts round-trip through the fact columns", async () => {
		const factsSessionId = `records_${RUN_ID}_facts`;
		const content = await Bun.file(
			new URL(
				"../../../../../packages/api-routes/src/session-transcript/__fixtures__/l1-facts/claude-2.1.jsonl",
				import.meta.url,
			),
		).text();
		await writeSession({ content, revision: "100", sessionId: factsSessionId });

		const rows = await clickhouse.query<{
			agent_version: string;
			call_id: string;
			denial_kind: string;
			duration_ms: number | null;
			entrypoint: string;
			facts: Record<string, string>;
			git_operation: string[];
			interrupted: boolean | null;
			mcp_server: string;
			parser_version: number;
		}>({
			query: `
				SELECT call_id, agent_version, entrypoint, denial_kind, duration_ms,
					interrupted, git_operation, mcp_server, facts, parser_version
				FROM rudel.transcript_records FINAL
				WHERE organization_id = {organization:String}
					AND user_id = {user:String}
					AND session_id = {sessionId:String}
					AND kind = 'tool_result'
					AND call_id IN ('toolu_pr', 'toolu_rm', 'toolu_fetch', 'toolu_mcp')
				ORDER BY call_id
			`,
			query_params: {
				organization: organizationId,
				sessionId: factsSessionId,
				user: userId,
			},
		});

		expect(rows).toMatchObject([
			{ call_id: "toolu_fetch", duration_ms: 4943, interrupted: null },
			{ call_id: "toolu_mcp", mcp_server: "posthog" },
			{
				agent_version: "2.1.292",
				call_id: "toolu_pr",
				entrypoint: "sdk-ts",
				facts: {
					"git.pr.number": "42",
					"git.pr.url": "https://github.com/acme/app/pull/42",
				},
				git_operation: ["branch", "pr"],
				interrupted: false,
				parser_version: TRANSCRIPT_RECORDS_PARSER_VERSION,
			},
			{ call_id: "toolu_rm", denial_kind: "permission-rule", facts: {} },
		]);
	});
});

describe("transcript records backfill", () => {
	const sources: readonly TranscriptSource[] = ["claude_code", "codex"];
	test.each([
		...sources,
	])("%s census and snapshot use numeric revisions under default alias precedence", async (source) => {
		const [setting] = await clickhouse.query<{ value: string }>({
			query:
				"SELECT value FROM system.settings WHERE name = 'prefer_column_name_to_alias' LIMIT 1",
		});
		expect(setting?.value).toBe("0");
		const regressionOrganizationId = `org_records_numeric_${source}_${RUN_ID}`;
		const sessionId = `records_numeric_${source}_${RUN_ID}`;
		createdRecordsOrganizationIds.push(regressionOrganizationId);
		for (const revision of ["9", "10"]) {
			const prompt =
				revision === "9" ? "old".repeat(1_000) : "latest revision 10";
			const content = line(
				source === "claude_code"
					? {
							message: { content: prompt, role: "user" },
							timestamp: at(3),
							type: "user",
						}
					: {
							payload: {
								content: [{ text: prompt, type: "input_text" }],
								role: "user",
								type: "message",
							},
							timestamp: at(3),
							type: "response_item",
						},
			);
			await getAdapter(source).ingest(
				clickhouse,
				{
					content,
					projectPath: "/test/numeric-revisions",
					sessionId,
					source,
					subagents: [],
				},
				{
					ingestedAt: new Date(BASE_TIME_MS + 3_600_000),
					organizationId: regressionOrganizationId,
					revision,
					timestamps: {
						lastInteractionDate: at(3),
						sessionDate: revision === "9" ? at(0) : at(2),
					},
					userId,
				},
			);
		}
		const run = await backfillTranscriptRecords(clickhouse, {
			assertWritable: (target) =>
				assertNoClickHousePurgeTombstone(target, { database: sqlClient }),
			batchMaxBytes: 64 * 1024,
			batchMaxRows: 10,
			cutoff: new Date(BASE_TIME_MS + 86_400_000),
			maxRows: 100,
			maxSessionBytes: 1_024,
			maxSessions: 10,
			organizationId: regressionOrganizationId,
			sessionTimeoutMs: 120_000,
		});
		expect(run).toMatchObject({
			completedCount: 1,
			failedCount: 0,
			rawSessionCount: 1,
			skippedCount: 0,
			supersededCount: 0,
		});
		const [facts] = await readSessionFacts(
			{ organizationId: regressionOrganizationId, userId },
			[sessionId],
		);
		expect(facts).toMatchObject({ indexed: true, revision: "10", turns: 1 });
	});

	test("a capped backfill cannot delete ingest's concurrent receipt for the same revision", async () => {
		const fixture = await createBackfillFixture("concurrent_cap");
		const run = await backfillTranscriptRecords(
			publishingAfterQuery(3, () => writeSession(fixture)),
			{ ...fixture.options, maxRows: 3 },
		);
		expect(run).toMatchObject({
			completedCount: 0,
			failedCount: 0,
			skippedCount: 1,
		});
		expect(run.issues[0]?.code).toBe("expansion_limit");
		const receipt = await readTranscriptRecordsReceipt(clickhouse, fixture);
		expect(receipt).toMatchObject({
			revision: fixture.revision,
			receipt: { rowCount: 4 },
		});
		const [facts] = await readSessionFacts(fixture, [fixture.sessionId]);
		expect(facts).toMatchObject({
			indexed: true,
			revision: fixture.revision,
			records: 4,
			turns: 1,
		});
	});

	test("a cap failure after a data flush preserves the concurrent generation's complete tail", async () => {
		const fixture = await createBackfillFixture(
			"flushed_concurrent_cap",
			2_002,
		);
		let published = false;
		const run = await backfillTranscriptRecords(clickhouse, {
			...fixture.options,
			assertWritable: async (target) => {
				if (!published) {
					published = true;
					await writeSession(fixture);
				}
				await assertNoClickHousePurgeTombstone(target, { database: sqlClient });
			},
			maxRows: 2_001,
		});
		expect(published).toBe(true);
		expect(run).toMatchObject({
			completedCount: 0,
			failedCount: 0,
			skippedCount: 1,
		});
		expect(run.issues[0]?.code).toBe("expansion_limit");
		expect(
			await readTranscriptRecordsReceipt(clickhouse, fixture),
		).toMatchObject({
			revision: fixture.revision,
			receipt: { rowCount: 2_002 },
		});
		const tail = await readRecord(fixture, fixture.sessionId, 2_002, 0, 100);
		expect(tail).toMatchObject({ found: true, text: "prompt 2002" });
	});

	test("the final data INSERT consumes the same session deadline and prevents a late receipt", async () => {
		const fixture = await createBackfillFixture("final_insert_deadline");
		let clock = BASE_TIME_MS;
		let inserts = 0;
		let insertSignal: AbortSignal | undefined;
		const executor: ClickHouseExecutor = {
			...clickhouse,
			async insert(params) {
				inserts++;
				insertSignal = params.abortSignal;
				await clickhouse.insert(params);
				clock += 20_000;
			},
		};
		const run = await backfillTranscriptRecords(executor, {
			...fixture.options,
			now: () => new Date(clock),
			sessionTimeoutMs: 10_000,
		});
		expect(run).toMatchObject({
			completedCount: 0,
			failedCount: 0,
			skippedCount: 1,
		});
		expect(run.issues[0]?.code).toBe("session_deadline");
		expect(inserts).toBe(1);
		expect(insertSignal?.aborted).toBe(true);
		expect(await readTranscriptRecordsReceipt(clickhouse, fixture)).toBeNull();
		expect(
			await readStoredRevisions(
				fixture.sessionId,
				fixture.organizationId,
				fixture.userId,
			),
		).toEqual([fixture.revision]);
	});

	test("a final fence that consumes the remaining deadline cannot start the receipt INSERT", async () => {
		const fixture = await createBackfillFixture("receipt_fence_deadline");
		let clock = BASE_TIME_MS;
		let fences = 0;
		const run = await backfillTranscriptRecords(clickhouse, {
			...fixture.options,
			assertWritable: async (target) => {
				await assertNoClickHousePurgeTombstone(target, { database: sqlClient });
				fences++;
				clock += 5_000;
			},
			now: () => new Date(clock),
			sessionTimeoutMs: 10_000,
		});
		expect(fences).toBe(2);
		expect(run).toMatchObject({
			completedCount: 0,
			failedCount: 0,
			skippedCount: 1,
		});
		expect(run.issues[0]?.code).toBe("session_deadline");
		expect(await readTranscriptRecordsReceipt(clickhouse, fixture)).toBeNull();
	});

	test("caller cancellation after a data INSERT aborts backfill without publishing a receipt", async () => {
		const fixture = await createBackfillFixture("cancelled_insert");
		const controller = new AbortController();
		const reason = new Error("cancelled backfill");
		let insertSignal: AbortSignal | undefined;
		const executor: ClickHouseExecutor = {
			...clickhouse,
			async insert(params) {
				insertSignal = params.abortSignal;
				await clickhouse.insert(params);
				controller.abort(reason);
			},
		};
		await expect(
			backfillTranscriptRecords(executor, {
				...fixture.options,
				signal: controller.signal,
			}),
		).rejects.toBe(reason);
		expect(insertSignal?.aborted).toBe(true);
		expect(await readTranscriptRecordsReceipt(clickhouse, fixture)).toBeNull();
	});

	test("is bounded, idempotent, and resumes by receipt", async () => {
		const backfillOrganizationId = `org_records_backfill_${RUN_ID}`;
		const backfillUserId = `user_records_backfill_${RUN_ID}`;
		const sessionId = `records_${RUN_ID}_backfill`;
		const session = claudeSession();
		const input: IngestSessionInput = {
			content: session.main,
			projectPath: "/test/transcript-records-backfill",
			sessionId,
			source: "claude_code",
			subagents: Object.entries(session.subagents).map(
				([agentId, content]) => ({
					agentId,
					content,
				}),
			),
		};
		await getAdapter("claude_code").ingest(clickhouse, input, {
			ingestedAt: new Date(BASE_TIME_MS + 3_600_000),
			organizationId: backfillOrganizationId,
			revision: "5000",
			timestamps: {
				lastInteractionDate: SESSION_DATE,
				sessionDate: SESSION_DATE,
			},
			userId: backfillUserId,
		});
		const options = {
			assertWritable: (
				target: Parameters<typeof assertNoClickHousePurgeTombstone>[0],
			) => assertNoClickHousePurgeTombstone(target, { database: sqlClient }),
			batchMaxBytes: 64 * 1024 * 1024,
			batchMaxRows: 10,
			cutoff: new Date(BASE_TIME_MS + 86_400_000),
			maxRows: 1_000_000,
			maxSessionBytes: 64 * 1024 * 1024,
			maxSessions: 100,
			organizationId: backfillOrganizationId,
			sessionTimeoutMs: 120_000,
		};

		const preview = await previewTranscriptRecordsBackfill(clickhouse, options);
		expect(preview).toMatchObject({
			candidateCount: 1,
			status: "preview",
			wouldWriteCount: 1,
		});
		const empty = await readSessionFacts(
			{ organizationId: backfillOrganizationId, userId: backfillUserId },
			[sessionId],
		);
		expect(empty[0]?.indexed).toBe(false);

		const run = await backfillTranscriptRecords(clickhouse, options);
		expect(run).toMatchObject({ completedCount: 1, failedCount: 0 });
		expect(run.rowsWritten).toBeGreaterThan(0);

		const [facts] = await readSessionFacts(
			{ organizationId: backfillOrganizationId, userId: backfillUserId },
			[sessionId],
		);
		expect(facts).toMatchObject({ indexed: true, revision: "5000", turns: 2 });

		const rerun = await backfillTranscriptRecords(clickhouse, options);
		expect(rerun).toMatchObject({ alreadyCompleteCount: 1, completedCount: 0 });

		await expect(
			backfillTranscriptRecords(clickhouse, { ...options, maxSessions: 0 }),
		).rejects.toThrow("maxSessions");

		await clickhouse.execute({
			query: `DELETE FROM rudel.transcript_records WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
			query_params: { organizationId: backfillOrganizationId },
		});
		await clickhouse.execute({
			query: `DELETE FROM rudel.claude_sessions WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
			query_params: { organizationId: backfillOrganizationId },
		});
	});
});

describe("durable transcript record retirement", () => {
	test("a quiet session's retirement is capped at 100 generations and resumes on the next sweep", async () => {
		const retirementOrganizationId = `org_records_retirement_cap_${RUN_ID}`;
		const sessionId = `records_${RUN_ID}_retirement_cap`;
		createdRecordsOrganizationIds.push(retirementOrganizationId);
		const content = line({
			type: "user",
			timestamp: SESSION_DATE,
			message: { role: "user", content: "bounded retirement" },
		});
		const rows = Array.from({ length: 103 }, (_, revisionIndex) => {
			const identity = {
				organizationId: retirementOrganizationId,
				sessionId,
				userId,
				revision: String(revisionIndex + 1),
				sessionDate: SESSION_DATE,
				source: "claude_code" as const,
			};
			const stats = createSplitStats();
			const records = [
				...splitSessionTranscript(
					{ content, sessionDate: SESSION_DATE, source: "claude_code" },
					stats,
				),
			].map((draft) => buildTranscriptRecordRow(identity, draft));
			return [
				...records,
				buildTranscriptRecordsReceiptRow(identity, {
					...summarizeSplit(stats),
					contentSha256: hashTranscriptContent(content),
					parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
					publishedAt: SESSION_DATE,
				}),
			];
		}).flat();
		await clickhouse.insert({
			asyncInsert: false,
			table: "rudel.transcript_records",
			values: rows,
		});
		const clock = BASE_TIME_MS + RETIREMENT_GRACE_MS;
		const sweep = () =>
			retireGenerations(clickhouse, transcriptRecordsStore, {
				organizationId: retirementOrganizationId,
				deadline: { deadlineAt: clock + 600_000, now: () => clock },
			});
		expect(await sweep()).toMatchObject({
			retired: 100,
			sessions: 1,
			hasMore: true,
		});
		expect(
			(await readStoredRevisions(sessionId, retirementOrganizationId)).sort(),
		).toEqual(["1", "103", "2"]);
		expect(await sweep()).toMatchObject({
			retired: 2,
			sessions: 1,
			hasMore: false,
		});
		expect(
			await readStoredRevisions(sessionId, retirementOrganizationId),
		).toEqual(["103"]);
		expect(await sweep()).toMatchObject({
			retired: 0,
			sessions: 0,
			hasMore: false,
		});
	});

	test("a shared cancellation signal reaches concurrent ClickHouse requests", async () => {
		const controller = new AbortController();
		const pending = Promise.allSettled(
			[1, 2].map(() =>
				clickhouse.query({
					abortSignal: controller.signal,
					clickhouse_settings: {
						max_execution_time: 2,
						cancel_http_readonly_queries_on_client_close: 1,
					},
					query: "SELECT sleep(1) LIMIT 1",
				}),
			),
		);
		const timer = setTimeout(
			() => controller.abort(new Error("cancelled requests")),
			50,
		);
		const results = await pending;
		clearTimeout(timer);
		expect(results.map((result) => result.status)).toEqual([
			"rejected",
			"rejected",
		]);
	});

	test("the hourly retirement deletes several sessions' generations with one keyed statement, keeping each committed one", async () => {
		const retirementOrganizationId = `org_records_batched_${RUN_ID}`;
		createdRecordsOrganizationIds.push(retirementOrganizationId);
		const sessionIds = ["a", "b", "c"].map(
			(suffix) => `records_${RUN_ID}_batched_${suffix}`,
		);
		let clock = BASE_TIME_MS;
		for (const sessionId of sessionIds) {
			for (const revision of ["100", "200", "300"]) {
				await writeSession({
					content: line({
						type: "user",
						message: { role: "user", content: `revision ${revision}` },
						timestamp: SESSION_DATE,
					}),
					now: () => new Date(clock),
					organizationId: retirementOrganizationId,
					revision,
					sessionId,
				});
			}
		}
		await writeSession({
			content: line({
				type: "user",
				message: { role: "user", content: "crashed" },
				timestamp: SESSION_DATE,
			}),
			omitReceipt: true,
			organizationId: retirementOrganizationId,
			revision: "50",
			sessionId: sessionIds[0] ?? "",
		});
		const statements: ClickHouseStatement[] = [];
		const recording: ClickHouseExecutor = {
			...clickhouse,
			async execute(statement) {
				statements.push(statement);
				await clickhouse.execute(statement);
			},
		};
		const retire = () =>
			retireGenerations(recording, transcriptRecordsStore, {
				deadline: { deadlineAt: clock + 600_000, now: () => clock },
				organizationId: retirementOrganizationId,
			});
		clock += RETIREMENT_GRACE_MS - 1;
		expect(await retire()).toMatchObject({ retired: 0, deleteStatements: 0 });
		clock++;
		expect(await retire()).toMatchObject({
			retired: 7,
			deleteStatements: 1,
			hasMore: false,
		});
		expect(statements).toHaveLength(1);
		expect(statements[0]?.query).toContain(
			"organization_id = {organizationId:String} AND (user_id, session_id, revision, parser_version) IN {keys:Array(Tuple(String, String, UInt64, UInt16))}",
		);
		expect(statements[0]?.query_id).toMatch(
			/^opaline-delete-transcript_records-[0-9a-f]{20}-1$/u,
		);
		for (const sessionId of sessionIds) {
			expect(
				await readStoredRevisions(sessionId, retirementOrganizationId),
			).toEqual(["300"]);
		}
		expect(await retire()).toMatchObject({ retired: 0, deleteStatements: 0 });
	});

	test("maintenance revisits quiet sessions after grace, bounds each pass, and resumes without another upload", async () => {
		const retirementOrganizationId = `org_records_retirement_${RUN_ID}`;
		createdRecordsOrganizationIds.push(retirementOrganizationId);
		const sessionIds = ["a", "b"].map(
			(suffix) => `records_${RUN_ID}_retirement_${suffix}`,
		);
		let clock = BASE_TIME_MS;
		for (const sessionId of sessionIds) {
			for (const revision of ["100", "200"]) {
				await writeSession({
					content: line({
						type: "user",
						message: { role: "user", content: `revision ${revision}` },
						timestamp: SESSION_DATE,
					}),
					now: () => new Date(clock),
					organizationId: retirementOrganizationId,
					revision,
					sessionId,
				});
			}
		}
		const sweep = () =>
			retireGenerations(clickhouse, transcriptRecordsStore, {
				deadline: { deadlineAt: clock + 600_000, now: () => clock },
				maxSessions: 1,
				organizationId: retirementOrganizationId,
			});
		clock += RETIREMENT_GRACE_MS - 1;
		expect(await sweep()).toMatchObject({
			retired: 0,
			sessions: 0,
			hasMore: false,
		});
		for (const sessionId of sessionIds) {
			expect(
				await readStoredRevisions(sessionId, retirementOrganizationId),
			).toEqual(["100", "200"]);
		}
		clock++;
		expect(await sweep()).toMatchObject({
			retired: 1,
			sessions: 1,
			hasMore: true,
		});
		expect(
			await readStoredRevisions(sessionIds[0] ?? "", retirementOrganizationId),
		).toEqual(["200"]);
		expect(
			await readStoredRevisions(sessionIds[1] ?? "", retirementOrganizationId),
		).toEqual(["100", "200"]);
		expect(await sweep()).toMatchObject({
			retired: 1,
			sessions: 1,
		});
		expect(await sweep()).toMatchObject({
			retired: 0,
			sessions: 0,
			hasMore: false,
		});
		for (const sessionId of sessionIds) {
			expect(
				await readStoredRevisions(sessionId, retirementOrganizationId),
			).toEqual(["200"]);
			const [facts] = await readSessionFacts(
				{ organizationId: retirementOrganizationId, userId },
				[sessionId],
			);
			expect(facts).toMatchObject({ indexed: true, revision: "200" });
		}
	});
});

async function createBackfillFixture(label: string, records = 4) {
	const fixture = {
		content: Array.from({ length: records }, (_, index) => index + 1)
			.map((index) =>
				line({
					type: "user",
					message: { role: "user", content: `prompt ${index}` },
					timestamp: at(index),
				}),
			)
			.join("\n"),
		organizationId: `org_records_${label}_${RUN_ID}`,
		revision: "9000",
		sessionId: `records_${RUN_ID}_${label}`,
		userId: `user_records_${label}_${RUN_ID}`,
	};
	createdRecordsOrganizationIds.push(fixture.organizationId);
	await getAdapter("claude_code").ingest(
		clickhouse,
		{
			content: fixture.content,
			projectPath: "/test/transcript-records-review",
			sessionId: fixture.sessionId,
			source: "claude_code",
			subagents: [],
		},
		{
			ingestedAt: new Date(BASE_TIME_MS + 3_600_000),
			organizationId: fixture.organizationId,
			revision: fixture.revision,
			timestamps: {
				lastInteractionDate: SESSION_DATE,
				sessionDate: SESSION_DATE,
			},
			userId: fixture.userId,
		},
	);
	return {
		...fixture,
		options: {
			assertWritable: (
				target: Parameters<typeof assertNoClickHousePurgeTombstone>[0],
			) => assertNoClickHousePurgeTombstone(target, { database: sqlClient }),
			batchMaxBytes: 64 * 1024 * 1024,
			batchMaxRows: 10,
			cutoff: new Date(BASE_TIME_MS + 86_400_000),
			maxRows: 10_000,
			maxSessionBytes: 64 * 1024 * 1024,
			maxSessions: 100,
			organizationId: fixture.organizationId,
			sessionTimeoutMs: 120_000,
		},
	};
}

describe("transcript records backfill and deletion", () => {
	test("never writes records for an account whose deletion is in progress", async () => {
		const fencedOrganizationId = `org_records_fenced_${RUN_ID}`;
		const fencedUserId = `user_records_fenced_${RUN_ID}`;
		const sessionId = `records_${RUN_ID}_fenced`;
		const session = claudeSession();
		await getAdapter("claude_code").ingest(
			clickhouse,
			{
				content: session.main,
				projectPath: "/test/transcript-records-fenced",
				sessionId,
				source: "claude_code",
				subagents: [],
			},
			{
				ingestedAt: new Date(BASE_TIME_MS + 3_600_000),
				organizationId: fencedOrganizationId,
				revision: "7000",
				timestamps: {
					lastInteractionDate: SESSION_DATE,
					sessionDate: SESSION_DATE,
				},
				userId: fencedUserId,
			},
		);
		await sqlClient.begin((transaction) =>
			enqueueClickHousePurge(
				{ targetId: fencedUserId, targetType: "account" },
				transaction,
			),
		);

		const run = await backfillTranscriptRecords(clickhouse, {
			assertWritable: (target) =>
				assertNoClickHousePurgeTombstone(target, { database: sqlClient }),
			batchMaxBytes: 64 * 1024 * 1024,
			batchMaxRows: 10,
			cutoff: new Date(BASE_TIME_MS + 86_400_000),
			maxRows: 1_000_000,
			maxSessionBytes: 64 * 1024 * 1024,
			maxSessions: 100,
			organizationId: fencedOrganizationId,
			sessionTimeoutMs: 120_000,
		});

		expect(run).toMatchObject({
			completedCount: 0,
			failedCount: 0,
			fencedCount: 1,
		});
		expect(
			await readStoredRevisions(sessionId, fencedOrganizationId, fencedUserId),
		).toEqual([]);
		await sqlClient`DELETE FROM clickhouse_purge_job WHERE target_id = ${fencedUserId}`;
		for (const table of ["rudel.transcript_records", "rudel.claude_sessions"]) {
			await clickhouse.execute({
				query: `DELETE FROM ${table} WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
				query_params: { organizationId: fencedOrganizationId },
			});
		}
	});

	test("reports an oversized expansion as a bounded skip and leaves no rows", async () => {
		const boundedOrganizationId = `org_records_bounded_${RUN_ID}`;
		const boundedUserId = `user_records_bounded_${RUN_ID}`;
		const sessionId = `records_${RUN_ID}_bounded`;
		const session = claudeSession();
		await getAdapter("claude_code").ingest(
			clickhouse,
			{
				content: session.main,
				projectPath: "/test/transcript-records-bounded",
				sessionId,
				source: "claude_code",
				subagents: [],
			},
			{
				ingestedAt: new Date(BASE_TIME_MS + 3_600_000),
				organizationId: boundedOrganizationId,
				revision: "8000",
				timestamps: {
					lastInteractionDate: SESSION_DATE,
					sessionDate: SESSION_DATE,
				},
				userId: boundedUserId,
			},
		);

		const run = await backfillTranscriptRecords(clickhouse, {
			assertWritable: (target) =>
				assertNoClickHousePurgeTombstone(target, { database: sqlClient }),
			batchMaxBytes: 64 * 1024 * 1024,
			batchMaxRows: 10,
			cutoff: new Date(BASE_TIME_MS + 86_400_000),
			maxRows: 3,
			maxSessionBytes: 64 * 1024 * 1024,
			maxSessions: 100,
			organizationId: boundedOrganizationId,
			sessionTimeoutMs: 120_000,
		});

		expect(run).toMatchObject({
			completedCount: 0,
			failedCount: 0,
			skippedCount: 1,
		});
		expect(run.issues[0]?.code).toBe("expansion_limit");
		expect(
			await readStoredRevisions(
				sessionId,
				boundedOrganizationId,
				boundedUserId,
			),
		).toEqual([]);
		for (const table of ["rudel.transcript_records", "rudel.claude_sessions"]) {
			await clickhouse.execute({
				query: `DELETE FROM ${table} WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
				query_params: { organizationId: boundedOrganizationId },
			});
		}
	});

	test("a write that loses the race to deletion is removed again", async () => {
		const raceOrganizationId = `org_records_purge_race_${RUN_ID}`;
		const raceUserId = `user_records_purge_race_${RUN_ID}`;
		const sessionId = `records_${RUN_ID}_purge_race`;
		const session = claudeSession();
		let checks = 0;

		await expect(
			writeTranscriptRecords(clickhouse, {
				assertWritable: async () => {
					checks++;
					if (checks === 2) {
						await sqlClient.begin((transaction) =>
							enqueueClickHousePurge(
								{ targetId: raceUserId, targetType: "account" },
								transaction,
							),
						);
					}
					await assertNoClickHousePurgeTombstone(
						{
							organizationId: raceOrganizationId,
							userId: raceUserId,
						},
						{ database: sqlClient },
					);
				},
				contentSha256: hashTranscriptContent(session.main),
				drafts: splitSessionTranscript({
					content: session.main,
					sessionDate: SESSION_DATE,
					source: "claude_code",
				}),
				organizationId: raceOrganizationId,
				revision: "100",
				sessionDate: SESSION_DATE,
				sessionId,
				source: "claude_code",
				summary: () => summarizeSplit(createSplitStats()),
				userId: raceUserId,
			}),
		).rejects.toThrow("fenced");

		expect(
			await readStoredRevisions(sessionId, raceOrganizationId, raceUserId),
		).toEqual([]);
		await sqlClient`DELETE FROM clickhouse_purge_job WHERE target_id = ${raceUserId}`;
	});
});

describe("derived transcript data reconciliation", () => {
	test("repairs a raw revision that was never indexed and records whose git observations were missed", async () => {
		const reconcileOrganizationId = `org_records_reconcile_${RUN_ID}`;
		createdRecordsOrganizationIds.push(reconcileOrganizationId);
		const unindexed = `reconcile_unindexed_${RUN_ID}`;
		const withoutGit = `reconcile_without_git_${RUN_ID}`;
		const recent = `reconcile_recent_${RUN_ID}`;
		const content = [
			line({
				message: { content: "commit the fix", role: "user" },
				timestamp: at(1),
				type: "user",
			}),
			line({
				message: {
					content: [
						{
							id: "t-commit",
							input: { command: 'git commit -m "fix login"' },
							name: "Bash",
							type: "tool_use",
						},
					],
					role: "assistant",
				},
				timestamp: at(2),
				type: "assistant",
			}),
			line({
				message: {
					content: [
						{
							content: "[main 1a2b3c4] fix login\n 1 file changed",
							tool_use_id: "t-commit",
							type: "tool_result",
						},
					],
					role: "user",
				},
				timestamp: at(3),
				type: "user",
			}),
		].join("\n");
		const now = Date.now();
		for (const [sessionId, ingestedAt] of [
			[unindexed, now - 3_600_000],
			[withoutGit, now - 3_600_000],
			// Ingest may still be extracting this one: left alone.
			[recent, now - 60_000],
		] as const) {
			await getAdapter("claude_code").ingest(
				clickhouse,
				{
					content,
					projectPath: "/test/reconcile",
					sessionId,
					source: "claude_code",
					subagents: [],
				},
				{
					ingestedAt: new Date(ingestedAt),
					organizationId: reconcileOrganizationId,
					revision: "900",
					timestamps: { lastInteractionDate: at(3), sessionDate: SESSION_DATE },
					userId,
				},
			);
		}
		await writeSession({
			content,
			organizationId: reconcileOrganizationId,
			revision: "900",
			sessionId: withoutGit,
		});
		const options = {
			assertWritable: (target: { organizationId: string; userId: string }) =>
				assertNoClickHousePurgeTombstone(target, { database: sqlClient }),
			deadline: { deadlineAt: Date.now() + 60_000, now: Date.now },
			organizationId: reconcileOrganizationId,
		};

		const first = await reconcileDerivedTranscriptRecords(options);

		expect(first).toMatchObject({
			candidates: 2,
			gitObservations: { failed: 0, skipped: 0, written: 1 },
			hasMore: false,
			transcriptRecords: { failed: 0, skipped: 0, written: 1 },
		});
		const receipts = await clickhouse.query<{
			session_id: string;
			records: string;
			observations: string;
		}>({
			query: `SELECT session_id,
					toString(max(revision)) AS records,
					toString((SELECT max(revision) FROM rudel.session_git_observations o
						WHERE o.organization_id = {organizationId:String} AND o.session_id = r.session_id AND o.kind = 'receipt')) AS observations
				FROM rudel.transcript_records r
				WHERE organization_id = {organizationId:String} AND kind = 'receipt'
				GROUP BY session_id ORDER BY session_id`,
			query_params: { organizationId: reconcileOrganizationId },
		});
		expect(receipts).toEqual([
			{ observations: "900", records: "900", session_id: unindexed },
			{ observations: "900", records: "900", session_id: withoutGit },
		]);
		const [observed] = await clickhouse.query<{ commits: string }>({
			query: `SELECT toString(countIf(kind != 'receipt')) AS commits FROM rudel.session_git_observations
				WHERE organization_id = {organizationId:String} AND session_id = {sessionId:String}`,
			query_params: {
				organizationId: reconcileOrganizationId,
				sessionId: unindexed,
			},
		});
		expect(Number(observed?.commits)).toBeGreaterThan(0);

		// Everything current: nothing left to repair.
		expect(await reconcileDerivedTranscriptRecords(options)).toMatchObject({
			candidates: 0,
			hasMore: false,
		});
	});

	test("counts subagent bytes against the session cap before either repair and charges every repair to the run budget", async () => {
		const capOrganizationId = `org_records_reconcile_cap_${RUN_ID}`;
		const budgetOrganizationId = `org_records_reconcile_budget_${RUN_ID}`;
		createdRecordsOrganizationIds.push(capOrganizationId, budgetOrganizationId);
		const content = [
			line({
				message: { content: "run the tests", role: "user" },
				timestamp: at(1),
				type: "user",
			}),
			line({
				message: { content: "All tests pass.", role: "assistant" },
				timestamp: at(2),
				type: "assistant",
			}),
		].join("\n");
		const mainBytes = Buffer.byteLength(content);
		const subagentContent = Array.from({ length: 8 }, () => content).join("\n");
		const ingestRaw = async (
			organizationId: string,
			sessionId: string,
			subagents: { agentId: string; content: string }[],
		) => {
			await getAdapter("claude_code").ingest(
				clickhouse,
				{
					content,
					projectPath: "/test/reconcile",
					sessionId,
					source: "claude_code",
					subagents,
				},
				{
					ingestedAt: new Date(Date.now() - 3_600_000),
					organizationId,
					revision: "900",
					timestamps: { lastInteractionDate: at(2), sessionDate: SESSION_DATE },
					userId,
				},
			);
		};
		const options = (organizationId: string) => ({
			assertWritable: (target: { organizationId: string; userId: string }) =>
				assertNoClickHousePurgeTombstone(target, { database: sqlClient }),
			deadline: { deadlineAt: Date.now() + 60_000, now: Date.now },
			organizationId,
		});

		// A small main transcript whose subagents exceed the cap, missing its
		// records; and one missing only git observations. Both are backfill-only.
		const heavy = [{ agentId: "worker", content: subagentContent }];
		const unindexedHeavy = `reconcile_heavy_unindexed_${RUN_ID}`;
		const gitOnlyHeavy = `reconcile_heavy_git_only_${RUN_ID}`;
		await ingestRaw(capOrganizationId, unindexedHeavy, heavy);
		await ingestRaw(capOrganizationId, gitOnlyHeavy, heavy);
		await writeSession({
			content,
			organizationId: capOrganizationId,
			revision: "900",
			sessionId: gitOnlyHeavy,
			subagents: { worker: subagentContent },
		});
		const capped = {
			...options(capOrganizationId),
			maxSessionBytes: mainBytes * 2,
		};
		for (let run = 0; run < 2; run++) {
			// Never repaired, and never re-entering the candidates on later runs.
			expect(await reconcileDerivedTranscriptRecords(capped)).toMatchObject({
				candidates: 0,
				gitObservations: { failed: 0, skipped: 0, written: 0 },
				oversized: 2,
				transcriptRecords: { failed: 0, skipped: 0, written: 0 },
			});
		}

		// Two git-only repairs within a budget for one: the second waits.
		for (const suffix of ["a", "b"]) {
			const sessionId = `reconcile_budget_${suffix}_${RUN_ID}`;
			await ingestRaw(budgetOrganizationId, sessionId, []);
			await writeSession({
				content,
				organizationId: budgetOrganizationId,
				revision: "900",
				sessionId,
			});
		}
		expect(
			await reconcileDerivedTranscriptRecords({
				...options(budgetOrganizationId),
				maxRunBytes: Math.floor(mainBytes * 1.5),
			}),
		).toMatchObject({
			candidates: 2,
			gitObservations: { failed: 0, skipped: 0, written: 1 },
			hasMore: true,
			oversized: 0,
		});
	});
});

describe("transcript records through the real API", () => {
	test("ingest writes records, duplicate uploads repair nothing twice, and the kill switch disables extraction", async () => {
		enabledServer = await startApiTestServer({
			TRANSCRIPT_RECORDS_EXTRACTION_ENABLED: "true",
		});
		disabledServer = await startApiTestServer({
			TRANSCRIPT_RECORDS_EXTRACTION_ENABLED: "false",
		});
		const enabledUser = await createApiUser(enabledServer.baseUrl, "enabled");
		const disabledUser = await createApiUser(
			disabledServer.baseUrl,
			"disabled",
		);
		createdApiUserIds.push(enabledUser.userId, disabledUser.userId);
		const session = claudeSession();
		const input: IngestSessionInput = {
			content: session.main,
			projectPath: "/test/transcript-records-api",
			sessionId: `records_${RUN_ID}_api`,
			source: "claude_code",
			subagents: Object.entries(session.subagents).map(
				([agentId, content]) => ({
					agentId,
					content,
				}),
			),
			upload_mode: "manual",
		};

		const first = await ingest(
			enabledServer.baseUrl,
			enabledUser.bearerToken,
			input,
		);
		expect(first.status).toBe(200);
		const enabledScope = {
			organizationId: enabledUser.userId,
			userId: enabledUser.userId,
		};
		const [facts] = await readSessionFacts(enabledScope, [input.sessionId]);
		expect(facts).toMatchObject({
			indexed: true,
			tests: { failed: 1, run: 1 },
			turns: 2,
		});
		const firstRecords = facts?.records;

		const second = await ingest(
			enabledServer.baseUrl,
			enabledUser.bearerToken,
			input,
		);
		expect(second.status).toBe(200);
		const [again] = await readSessionFacts(enabledScope, [input.sessionId]);
		expect(again?.records).toBe(firstRecords ?? -1);

		// Git observations missed after the records were published (no admission
		// slot, a failure): the next duplicate upload repairs them alone.
		const gitReceipts = async () =>
			(
				await clickhouse.query<{ receipts: string }>({
					query: `SELECT toString(count()) AS receipts FROM rudel.session_git_observations
						WHERE organization_id = {organizationId:String} AND session_id = {sessionId:String} AND kind = 'receipt'`,
					query_params: {
						organizationId: enabledUser.userId,
						sessionId: input.sessionId,
					},
				})
			)[0]?.receipts;
		expect(await gitReceipts()).toBe("1");
		await clickhouse.execute({
			query:
				"DELETE FROM rudel.session_git_observations WHERE organization_id = {organizationId:String} AND session_id = {sessionId:String} SETTINGS lightweight_deletes_sync = 3",
			query_params: {
				organizationId: enabledUser.userId,
				sessionId: input.sessionId,
			},
		});
		expect(await gitReceipts()).toBe("0");
		const third = await ingest(
			enabledServer.baseUrl,
			enabledUser.bearerToken,
			input,
		);
		expect(third.status).toBe(200);
		expect(await gitReceipts()).toBe("1");
		const [unchanged] = await readSessionFacts(enabledScope, [input.sessionId]);
		expect(unchanged?.records).toBe(firstRecords ?? -1);

		const disabled = await ingest(
			disabledServer.baseUrl,
			disabledUser.bearerToken,
			input,
		);
		expect(disabled.status).toBe(200);
		const [none] = await readSessionFacts(
			{ organizationId: disabledUser.userId, userId: disabledUser.userId },
			[input.sessionId],
		);
		expect(none?.indexed).toBe(false);
	});
});

async function createApiUser(
	baseUrl: string,
	label: string,
): Promise<{ bearerToken: string; userId: string }> {
	const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
		body: JSON.stringify({
			email: `transcript-records-${label}-${RUN_ID}@example.com`,
			name: `Transcript Records ${label}`,
			password: "transcript-records-test-password",
		}),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
	expect(response.ok).toBe(true);
	const body: unknown = await response.json();
	assert(isRecord(body) && typeof body.token === "string");
	const me = await fetch(`${baseUrl}/rpc/me`, {
		body: "{}",
		headers: {
			Authorization: `Bearer ${body.token}`,
			"Content-Type": "application/json",
		},
		method: "POST",
	});
	expect(me.ok).toBe(true);
	const meBody: unknown = await me.json();
	assert(isRecord(meBody) && isRecord(meBody.json));
	assert(typeof meBody.json.id === "string");
	return { bearerToken: body.token, userId: meBody.json.id };
}

async function ingest(
	baseUrl: string,
	bearerToken: string,
	input: IngestSessionInput,
) {
	const response = await fetch(`${baseUrl}/rpc/ingestSession`, {
		body: JSON.stringify({ json: input }),
		headers: {
			Authorization: `Bearer ${bearerToken}`,
			"Content-Type": "application/json",
		},
		method: "POST",
	});
	return { body: await response.json(), status: response.status };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
