import "./helpers/local-integration-guard.js";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ORPCError } from "@orpc/server";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
} from "@rudel/api-routes/transcript-records";
import { getClickhouse } from "../clickhouse.js";
import { openRun } from "../services/analysis/run-view.service.js";
import { createMemorySqlQuota } from "../services/analysis/sql-results.js";
import { runNodeId } from "../services/l1-edges/l1-edge-ids.js";
import { buildRunIndex } from "../services/l1-edges/run-index.service.js";
import {
	buildTranscriptRecordRow,
	buildTranscriptRecordsReceiptRow,
	hashTranscriptContent,
} from "../services/transcript-records-ingest.service.js";

/**
 * Opening a record by its own id from the raw transcript (Claude Code
 * `uuid`, `transcript_records.record_uuid` from parser 12) with `run`,
 * against real ClickHouse: the run that holds it opens with the record
 * expanded, a resumed session that repeats the line is named too, and only
 * sessions the caller may read, in their committed generation, are searched.
 */

setDefaultTimeout(120_000);

const RUN = `record_uuid_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const member = `${RUN}_member`;
const other = `${RUN}_other`;
const original = `${RUN}_original`;
const resumed = `${RUN}_resumed`;
const hidden = `${RUN}_hidden`;
const clickhouse = getClickhouse();
const baseMs = Date.now() - 3_600_000;

/** A UUID unique to this test run, so other suites' rows never match. */
const uuid = (n: number) =>
	`${crypto.randomUUID().slice(0, 24)}${String(n).padStart(12, "0")}`;
const ID = {
	firstPrompt: uuid(1),
	firstAnswer: uuid(2),
	secondPrompt: uuid(3),
	call: uuid(4),
	result: uuid(5),
	answer: uuid(6),
	hidden: uuid(7),
	superseded: uuid(8),
	unknown: uuid(9),
};

const at = (seconds: number) =>
	new Date(baseMs + seconds * 1_000).toISOString();
const line = (
	session: string,
	seconds: number,
	id: string,
	parent: string | null,
	record: Record<string, unknown>,
) => ({
	parentUuid: parent,
	sessionId: session,
	cwd: "/repo",
	isSidechain: false,
	version: "2.1.293",
	uuid: id,
	timestamp: at(seconds),
	...record,
});
const prompt = (content: string) => ({
	type: "user",
	message: { role: "user", content },
});
const text = (content: string) => ({
	type: "assistant",
	message: { role: "assistant", content: [{ type: "text", text: content }] },
});
const conversation = (session: string, last: string = ID.answer) => [
	line(session, 0, ID.firstPrompt, null, prompt("list the files")),
	line(session, 5, ID.firstAnswer, ID.firstPrompt, text("There are two.")),
	line(session, 60, ID.secondPrompt, ID.firstAnswer, prompt("count them")),
	line(session, 65, ID.call, ID.secondPrompt, {
		type: "assistant",
		message: {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: `toolu_${session}`,
					name: "Bash",
					input: { command: "ls | wc -l" },
				},
			],
		},
	}),
	line(session, 66, ID.result, ID.call, {
		type: "user",
		sourceToolAssistantUUID: ID.call,
		message: {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: `toolu_${session}`,
					content: "2 files counted",
					is_error: false,
				},
			],
		},
		toolUseResult: { stdout: "2 files counted", stderr: "" },
	}),
	line(session, 70, last, ID.result, text("Two files.")),
];

async function ingest(
	userId: string,
	sessionId: string,
	records: readonly Record<string, unknown>[],
	options: { revision: string; offsetSeconds: number },
) {
	const content = records.map((record) => JSON.stringify(record)).join("\n");
	const sessionDate = at(options.offsetSeconds);
	const identity = {
		organizationId: workspace,
		userId,
		sessionId,
		source: "claude_code" as const,
		revision: options.revision,
		sessionDate,
	};
	const stats = createSplitStats();
	const rows = [
		...splitSessionTranscript(
			{ content, sessionDate, source: "claude_code" },
			stats,
		),
	].map((draft) => buildTranscriptRecordRow(identity, draft));
	await clickhouse.insert({
		table: "rudel.transcript_records",
		asyncInsert: false,
		values: [
			...rows,
			buildTranscriptRecordsReceiptRow(identity, {
				...summarizeSplit(stats),
				contentSha256: hashTranscriptContent(content),
				parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
				publishedAt: new Date().toISOString(),
				rowCount: rows.length,
			}),
		],
	});
	await clickhouse.insert({
		table: "rudel.session_analytics",
		asyncInsert: false,
		values: [
			{
				organization_id: workspace,
				user_id: userId,
				session_id: sessionId,
				source: "claude_code",
				session_date: sessionDate.replace("T", " ").replace("Z", ""),
				last_interaction_date: sessionDate.replace("T", " ").replace("Z", ""),
				project_path: "/test/record-uuid",
				git_remote: "github.com/opalinehq/athena",
				model_used: "claude-opus-5-5",
				revision: options.revision,
			},
		],
	});
	await buildRunIndex({
		executor: clickhouse,
		organizationId: workspace,
		session: { userId, source: "claude_code", sessionId },
		buildRevision: Number(options.revision),
		beforeWrite: async () => {},
	});
}

const owners = new Map([
	[original, member],
	[resumed, member],
	[hidden, other],
]);
const env = {
	executor: clickhouse,
	// The caller reads its own sessions only, as in a workspace limited to them.
	ownerOf: async (sessionId: string) => {
		const owner = owners.get(sessionId);
		if (!owner) throw new ORPCError("NOT_FOUND");
		if (owner !== member)
			throw new ORPCError("FORBIDDEN", {
				message: "You can only view your own sessions",
			});
		return owner;
	},
	quota: createMemorySqlQuota({ queries: 1_000, windowMs: 3_600_000 }),
};
const open = (id: string, expand?: string[]) =>
	openRun(workspace, { id, maxChars: 12_000, expand }, env);

afterAll(async () => {
	for (const table of [
		"rudel.transcript_records",
		"rudel.run_index",
		"rudel.run_requests",
		"rudel.run_setup",
		"rudel.session_analytics",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {workspace:String} SETTINGS lightweight_deletes_sync = 2`,
			query_params: { workspace },
		});
});

describe("a record opened by its own id", () => {
	test("run opens the run that holds the record, expanded, and names every readable session with it", async () => {
		// An older generation of the original carries an id the committed one does not.
		await ingest(member, original, conversation(original, ID.superseded), {
			revision: "1",
			offsetSeconds: 0,
		});
		await ingest(member, original, conversation(original), {
			revision: "2",
			offsetSeconds: 0,
		});
		// A resumed session repeats the original's lines, ids included.
		await ingest(
			member,
			resumed,
			[
				...conversation(resumed),
				line(resumed, 900, uuid(10), ID.answer, prompt("go on")),
			],
			{ revision: "1", offsetSeconds: 600 },
		);
		await ingest(
			other,
			hidden,
			[
				line(hidden, 0, ID.hidden, null, prompt("private work")),
				line(hidden, 5, uuid(11), ID.hidden, text("Done.")),
			],
			{ revision: "1", offsetSeconds: 0 },
		);

		const runId = runNodeId(
			{ userId: member, source: "claude_code", sessionId: original },
			"",
			3,
		);
		const view = await open(ID.result);
		const [location, header] = view.text.split("\n");
		expect(view.id).toBe(ID.result);
		// The tool result is line 5 of the second run; its parent ids name line 4.
		expect(location).toBe(
			`record ${ID.result} is session ${original} stream main r5 run 2 (run_id ${runId}); the same id is also session ${resumed} stream main r5 run 2`,
		);
		expect(header).toStartWith(`run ${runId} · claude_code · "count them"`);
		expect(view.text).toMatch(
			/\n▸ r5 tool_result[^\n]*, 15 characters\n2 files counted/u,
		);

		// Its id in upper case, with more ids to expand, opens the same run.
		const upper = await open(ID.call.toUpperCase(), ["r6"]);
		expect(upper.text.split("\n")[0]).toStartWith(
			`record ${ID.call.toUpperCase()} is session ${original} stream main r4 run 2 (run_id ${runId})`,
		);
		expect(upper.text).toMatch(/\n▸ r6 [^\n]*\nTwo files\./u);

		// The first run's prompt opens the first run.
		expect((await open(ID.firstPrompt)).text.split("\n")[1]).toStartWith(
			`run ${runNodeId({ userId: member, source: "claude_code", sessionId: original }, "", 1)} · claude_code · "list the files"`,
		);
	});

	test("ids only in sessions the caller may not read, in superseded generations or not recorded read as not found", async () => {
		for (const id of [ID.hidden, ID.superseded, ID.unknown]) {
			const refusal = await open(id).then(
				() => null,
				(error: unknown) => error,
			);
			expect(refusal).toBeInstanceOf(ORPCError);
			expect((refusal as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
			expect((refusal as Error).message).toBe(
				`No record with id ${id} in the sessions you may read. Sessions indexed before transcript parser 12 keep no record ids, so for them it is unknown, not missing: find the record with sql or search instead.`,
			);
		}
	});

	test("the lookup skips granules by the bloom filter index", async () => {
		const plan = await clickhouse.query<{ explain: string }>({
			query:
				"EXPLAIN indexes = 1 SELECT count() FROM rudel.transcript_records WHERE organization_id = {workspace:String} AND record_uuid IN {uuids:Array(String)}",
			query_params: { workspace, uuids: [ID.result] },
		});
		expect(plan.map((row) => row.explain).join("\n")).toContain(
			"record_uuid_bloom",
		);
	});
});
