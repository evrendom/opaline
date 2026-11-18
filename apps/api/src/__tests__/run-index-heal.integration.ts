import "./helpers/local-integration-guard.js";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
} from "@rudel/api-routes/transcript-records";
import postgres from "postgres";
import { getClickhouse } from "../clickhouse.js";
import { sessionScopeId } from "../services/l1-edges/l1-edge-ids.js";
import { enqueueL1EdgeScope } from "../services/l1-edges/l1-edge-queue.service.js";
import { runL1EdgePass } from "../services/l1-edges/l1-edge-reconciliation.service.js";
import {
	readRunIndexHealConfig,
	readRunIndexHealStatus,
	runRunIndexHealTick,
} from "../services/l1-edges/run-index-heal.service.js";
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
const RUN = `run_index_heal_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const organizationId = `${RUN}_org`;
const userId = `${RUN}_user`;
const clickhouse = getClickhouse();
const session = (name: string) => ({
	userId,
	source: "claude_code",
	sessionId: `${RUN}_${name}`,
});

afterAll(async () => {
	for (const table of ["rudel.transcript_records", "rudel.run_index"])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
			query_params: { organizationId },
		});
	await sqlClient.unsafe("DELETE FROM organization WHERE id = $1", [
		organizationId,
	]);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = $1', [userId]);
	await sqlClient.end();
});

async function publish(
	sessionId: string,
	hoursAgo: number,
	parserVersion = TRANSCRIPT_RECORDS_PARSER_VERSION,
) {
	const sessionDate = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
	const content = await Bun.file(
		new URL(
			"../../../../packages/api-routes/src/session-transcript/__fixtures__/l1-facts/claude-2.1.jsonl",
			import.meta.url,
		),
	).text();
	const identity = {
		organizationId,
		userId,
		sessionId,
		source: "claude_code" as const,
		revision: "1",
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
				parserVersion,
				publishedAt: new Date().toISOString(),
				rowCount: rows.length,
			}),
		],
	});
}

const pass = () =>
	runL1EdgePass({
		sql: sqlClient,
		budgetMs: 60_000,
		organizationId,
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

const pendingRunIndexScopes = async () =>
	(
		await sqlClient.unsafe<{ scope_id: string; priority: number }[]>(
			`SELECT scope_id, priority FROM l1_edge_scope
			 WHERE organization_id = $1 AND scope_kind = 'run_index' AND request_count > built_request_count
			 ORDER BY scope_id`,
			[organizationId],
		)
	).map((row) => ({ ...row, priority: Number(row.priority) }));

const config = {
	...readRunIndexHealConfig({ L1_EDGES_WORKER_ENABLED: "true" }),
	maxPerTick: 1,
	maxPending: 1_000_000,
	maxRecentFailures: 1_000_000,
	maxLoad: 1_000_000,
};

const tick = (
	options: Partial<Parameters<typeof runRunIndexHealTick>[0]> = {},
) =>
	runRunIndexHealTick({
		sql: sqlClient,
		executor: clickhouse,
		config,
		deadline: { deadlineAt: Date.now() + 120_000, now: Date.now },
		organizationIds: [organizationId],
		...options,
	});

test("the run index heal queues stale sessions newest first, one tick at a time, until none is stale", async () => {
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, 'Heal', $2, false)`,
		[userId, `${userId}@example.com`],
	);
	await sqlClient.unsafe(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'Heal', $1)",
		[organizationId],
	);
	const built = session("built");
	const older = session("older");
	const newer = session("newer");
	const waiting = session("waiting");
	await publish(built.sessionId, 1);
	await publish(older.sessionId, 48);
	await publish(newer.sessionId, 2);
	await publish(waiting.sessionId, 0.5);
	await enqueueL1EdgeScope(sqlClient, {
		kind: "run_index",
		organizationId,
		...built,
	});
	expect(await pass()).toBe(1);
	await enqueueL1EdgeScope(sqlClient, {
		kind: "run_index",
		organizationId,
		...waiting,
	});

	const status = await readRunIndexHealStatus({
		sql: sqlClient,
		executor: clickhouse,
		config,
	});
	expect(
		"organizations" in status.census &&
			status.census.organizations.find(
				(organization) => organization.organizationId === organizationId,
			),
	).toMatchObject({ sessions: 4, stale: 3, indexStale: 3, parserStale: 0 });

	const first = await tick();
	expect(first).toMatchObject({
		status: "ran",
		queued: 1,
		alreadyQueued: 1,
		staleBefore: 3,
		remaining: 2,
	});
	expect(await pendingRunIndexScopes()).toEqual(
		[
			{ scope_id: sessionScopeId(newer), priority: 1 },
			{ scope_id: sessionScopeId(waiting), priority: 0 },
		].sort((a, b) => a.scope_id.localeCompare(b.scope_id)),
	);

	expect(await tick()).toMatchObject({ queued: 1, alreadyQueued: 2 });
	expect(
		(await pendingRunIndexScopes()).map((scope) => scope.scope_id),
	).toContain(sessionScopeId(older));
	expect(await tick()).toMatchObject({ queued: 0, alreadyQueued: 3 });

	expect(await pass()).toBe(3);
	expect(await tick()).toMatchObject({
		status: "ran",
		queued: 0,
		staleBefore: 0,
		remaining: 0,
	});
});

test("with reparse on, a stale index is queued before a newer session on the current index is reparsed", async () => {
	const parsed = session("parsed");
	const stale = session("stale");
	await publish(parsed.sessionId, 3, TRANSCRIPT_RECORDS_PARSER_VERSION - 1);
	await publish(stale.sessionId, 5, TRANSCRIPT_RECORDS_PARSER_VERSION - 1);
	await enqueueL1EdgeScope(sqlClient, {
		kind: "run_index",
		organizationId,
		...parsed,
	});
	expect(await pass()).toBe(1);

	const reparsed: string[] = [];
	const result = await tick({
		config: { ...config, reparse: true, maxReparsePerTick: 1 },
		reparser: {
			reparse: async (row) => {
				reparsed.push(row.session_id);
				return { outcome: "written", bytes: 1 };
			},
		},
	});
	expect(result).toMatchObject({
		status: "ran",
		staleBefore: 2,
		queued: 1,
		reparsed: 1,
	});
	expect(reparsed).toEqual([parsed.sessionId]);
	expect(
		(await pendingRunIndexScopes()).map((scope) => scope.scope_id),
	).toEqual([sessionScopeId(stale)]);
});
