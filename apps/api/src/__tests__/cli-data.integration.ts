import "./helpers/local-integration-guard.js";
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { DataChunk } from "@rudel/api-routes/cli-data";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
} from "@rudel/api-routes/transcript-records";
import postgres from "postgres";
import { getClickhouse } from "../clickhouse.js";
import { getClickHouseLines } from "../clickhouse-lines.js";
import {
	createAgentQueryLimiter,
	createPostgresAgentQuerySlots,
} from "../services/analysis/agent-query-slots.js";
import { withCallQuota } from "../services/analysis/sql-gateway.js";
import { createMemorySqlQuota } from "../services/analysis/sql-results.js";
import { pullPlan } from "../services/cli-data/pull-plan.js";
import { pullTable } from "../services/cli-data/pull-table.js";
import { exportSql } from "../services/cli-data/sql-export.js";
import {
	type CliDataContext,
	watchedQuota,
} from "../services/cli-data/statements.js";
import { enqueueL1EdgeScope } from "../services/l1-edges/l1-edge-queue.service.js";
import { runL1EdgePass } from "../services/l1-edges/l1-edge-reconciliation.service.js";
import type { SessionReader } from "../services/session-visibility.js";
import {
	buildTranscriptRecordRow,
	buildTranscriptRecordsReceiptRow,
	hashTranscriptContent,
} from "../services/transcript-records-ingest.service.js";

setDefaultTimeout(180_000);
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", {
	max: 2,
	prepare: false,
});
const RUN = `cli_data_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const memberId = `${RUN}_member`;
const colleagueId = `${RUN}_colleague`;
const mine = `${RUN}_mine`;
const theirs = `${RUN}_theirs`;
const clickhouse = getClickhouse();
const SESSION_DATE = new Date(Date.now() - 3_600_000).toISOString();
const DAY = SESSION_DATE.slice(0, 10);

const line = (sessionId: string, at: number, body: Record<string, unknown>) =>
	JSON.stringify({
		sessionId,
		cwd: "/repo",
		version: "2.1.292",
		entrypoint: "cli",
		isSidechain: false,
		timestamp: new Date(Date.parse(SESSION_DATE) + at * 1_000).toISOString(),
		...body,
	});
const transcript = (sessionId: string, prompts: readonly string[]) =>
	prompts
		.flatMap((text, index) => [
			line(sessionId, index * 10, {
				type: "user",
				message: { role: "user", content: text },
			}),
			line(sessionId, index * 10 + 1, {
				type: "assistant",
				requestId: `req_${index}`,
				message: {
					id: `msg_${index}`,
					role: "assistant",
					model: "claude-sonnet-4-6",
					content: [{ type: "text", text: `Done: ${text}` }],
					usage: { input_tokens: 10, output_tokens: 5 },
				},
			}),
		])
		.join("\n");

async function publish(
	sessionId: string,
	userId: string,
	content: string,
	revision: string,
) {
	const identity = {
		organizationId: workspace,
		userId,
		sessionId,
		source: "claude_code" as const,
		revision,
		sessionDate: SESSION_DATE,
	};
	const stats = createSplitStats();
	const rows = [
		...splitSessionTranscript(
			{
				content,
				sessionDate: SESSION_DATE,
				source: "claude_code",
				subagents: {},
			},
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
}

const contextFor = (reader: SessionReader): CliDataContext => {
	const watched = watchedQuota(
		createMemorySqlQuota({ queries: 100, windowMs: 3_600_000 }),
	);
	return {
		caller: { workspaceId: workspace, reader },
		env: withCallQuota({
			executor: clickhouse,
			lines: getClickHouseLines(),
			quota: watched.quota,
			limiter: createAgentQueryLimiter(
				createPostgresAgentQuerySlots(sqlClient),
			),
			githubRepositories: async () => [],
			githubBindings: async () => [],
			functions: [],
		}),
		quotaRefusedAt: watched.refusedAt,
	};
};
const ownOnly: SessionReader = {
	userId: memberId,
	role: "member",
	ownSessionsOnly: true,
};
const everyone: SessionReader = { ...ownOnly, ownSessionsOnly: false };

async function drain(chunks: AsyncIterable<DataChunk>) {
	let text = "";
	let done: DataChunk | undefined;
	for await (const chunk of chunks)
		if (chunk.type === "lines") text += chunk.text;
		else done = chunk;
	return { lines: text.split("\n").filter(Boolean), done };
}

beforeAll(async () => {
	await sqlClient`INSERT INTO organization (id, name, slug) VALUES (${workspace}, ${workspace}, ${workspace})`;
	for (const id of [memberId, colleagueId])
		await sqlClient`INSERT INTO "user" (id, name, email, email_verified) VALUES (${id}, ${id}, ${`${id}@example.com`}, false)`;
	await publish(mine, memberId, transcript(mine, ["old prompt"]), "1");
	await publish(
		mine,
		memberId,
		transcript(mine, ["first prompt", "second prompt", "third prompt"]),
		"2",
	);
	await publish(theirs, colleagueId, transcript(theirs, ["their prompt"]), "1");
	for (const [sessionId, userId] of [
		[mine, memberId],
		[theirs, colleagueId],
	] as const)
		await enqueueL1EdgeScope(sqlClient, {
			kind: "run_index",
			organizationId: workspace,
			userId,
			source: "claude_code",
			sessionId,
		});
	await sqlClient.unsafe(
		"DELETE FROM l1_edge_scope WHERE organization_id <> $1",
		[workspace],
	);
	await runL1EdgePass({
		sql: sqlClient,
		budgetMs: 60_000,
		sources: {
			executor: clickhouse,
			access: async () => ({
				visibility: "visible" as const,
				bindings: [],
				repositories: new Map(),
			}),
			evidence: async () => ({ snapshots: [], captures: [] }),
		},
	});
});

afterAll(async () => {
	for (const table of ["rudel.transcript_records", "rudel.run_index"])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {workspace:String} SETTINGS lightweight_deletes_sync = 2`,
			query_params: { workspace },
		});
	await sqlClient.unsafe(
		"DELETE FROM l1_edge_scope WHERE organization_id = $1",
		[workspace],
	);
	await sqlClient.unsafe("DELETE FROM organization WHERE id = $1", [workspace]);
	for (const id of [memberId, colleagueId])
		await sqlClient.unsafe('DELETE FROM "user" WHERE id = $1', [id]);
	await sqlClient.end();
});

test("the plan sizes each session's committed generation, and a member kept to their own sessions plans only theirs", async () => {
	const [committed] = await clickhouse.query<{ records: number }>({
		query: `SELECT count() AS records FROM rudel.transcript_records FINAL
			WHERE organization_id = {workspace:String} AND session_id = {session:String}
				AND revision = 2 AND record_idx < {receipt:UInt32}`,
		query_params: {
			workspace,
			session: mine,
			receipt: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
		},
	});
	const all = await pullPlan(
		contextFor(everyone),
		{ id: workspace, slug: workspace },
		{ from: DAY },
	);
	expect(all.sessions.map((session) => session.sessionId).sort()).toEqual(
		[mine, theirs].sort(),
	);
	expect(
		all.sessions.find((session) => session.sessionId === mine)?.records,
	).toBe(Number(committed?.records));
	const own = await pullPlan(
		contextFor(ownOnly),
		{ id: workspace, slug: workspace },
		{ from: DAY },
	);
	expect(own.sessions.map((session) => session.sessionId)).toEqual([mine]);
});

test("records stream the committed generation in order and leave out a session the caller may not read", async () => {
	const { lines, done } = await drain(
		pullTable(contextFor(ownOnly), "records", [mine, theirs]),
	);
	const records = lines.map(
		(text) =>
			JSON.parse(text) as {
				session_id: string;
				record_idx: number;
				text: string;
			},
	);
	expect(new Set(records.map((record) => record.session_id))).toEqual(
		new Set([mine]),
	);
	const order = records.map((record) => record.record_idx);
	expect(order).toEqual([...order].sort((left, right) => left - right));
	const texts = records.map((record) => record.text).join("\n");
	expect(texts).toContain("third prompt");
	expect(texts).not.toContain("old prompt");
	expect(done).toMatchObject({
		type: "done",
		rows: records.length,
		notices: [expect.stringContaining("1 of 2 sessions")],
	});
});

test("runs stream every run of the readable sessions", async () => {
	const { lines, done } = await drain(
		pullTable(contextFor(everyone), "runs", [mine, theirs]),
	);
	const runs = lines.map((text) => JSON.parse(text) as { session_id: string });
	expect(runs.filter((run) => run.session_id === mine)).toHaveLength(3);
	expect(runs.filter((run) => run.session_id === theirs)).toHaveLength(1);
	expect(done).toMatchObject({ rows: 4, notices: [] });
});

test("sql streams past the sql tool's 200-row cap through ClickHouse, as JSONL and CSV", async () => {
	const query =
		"SELECT arrayJoin(range(450)) AS n FROM (SELECT session_id FROM runs LIMIT 1)";
	const jsonl = await drain(exportSql(contextFor(everyone), query, "jsonl"));
	expect(jsonl.lines).toHaveLength(450);
	expect(JSON.parse(jsonl.lines[449] as string)).toEqual({ n: 449 });
	expect(jsonl.done).toMatchObject({ rows: 450, columns: ["n"] });
	const csv = await drain(exportSql(contextFor(everyone), query, "csv"));
	expect(csv.lines[0]).toBe("n");
	expect(csv.lines).toHaveLength(451);
	expect(csv.done).toMatchObject({ rows: 450 });
});
