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
	backfillRunIndex,
	previewRunIndexBackfill,
} from "../services/l1-edges/run-index-backfill.service.js";
import {
	buildTranscriptRecordRow,
	buildTranscriptRecordsReceiptRow,
	hashTranscriptContent,
} from "../services/transcript-records-ingest.service.js";

setDefaultTimeout(180_000);
// Its own client: another suite in this process may close the shared one.
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", {
	max: 2,
	prepare: false,
});
const RUN = `run_index_backfill_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const organizationId = `${RUN}_org`;
const userId = `${RUN}_user`;
const clickhouse = getClickhouse();
const SESSION_DATE = new Date(Date.now() - 3_600_000).toISOString();
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

/** Publishes a committed transcript generation of the current parser. */
async function publish(sessionId: string, revision: string) {
	const content = await Bun.file(
		new URL(
			"../../../../../packages/api-routes/src/session-transcript/__fixtures__/l1-facts/claude-2.1.jsonl",
			import.meta.url,
		),
	).text();
	const identity = {
		organizationId,
		userId,
		sessionId,
		source: "claude_code" as const,
		revision,
		sessionDate: SESSION_DATE,
	};
	const stats = createSplitStats();
	const rows = [
		...splitSessionTranscript(
			{ content, sessionDate: SESSION_DATE, source: "claude_code" },
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

/** Builds this workspace's due scopes only. */
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

const runIndexScopes = async () =>
	(
		await sqlClient.unsafe<
			{ scope_id: string; priority: number; pending: boolean }[]
		>(
			`SELECT scope_id, priority, request_count > built_request_count AS pending
			 FROM l1_edge_scope WHERE organization_id = $1 AND scope_kind = 'run_index'
			 ORDER BY scope_id`,
			[organizationId],
		)
	).map((row) => ({ ...row, priority: Number(row.priority) }));

test("the run index backfill queues every transcript session without a current snapshot, with no edges needed", async () => {
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, 'Backfill', $2, false)`,
		[userId, `${userId}@example.com`],
	);
	await sqlClient.unsafe(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'Backfill', $1)",
		[organizationId],
	);
	// built: indexed at its committed generation. reparsed: indexed, then a
	// newer generation. missing: never indexed (no git evidence, so no edge
	// build would ever queue it). waiting: never indexed, already queued.
	const built = session("built");
	const reparsed = session("reparsed");
	const missing = session("missing");
	const waiting = session("waiting");
	for (const target of [built, reparsed, missing, waiting])
		await publish(target.sessionId, "1");
	for (const target of [built, reparsed])
		await enqueueL1EdgeScope(sqlClient, {
			kind: "run_index",
			organizationId,
			...target,
		});
	expect(await pass()).toBe(2);
	await publish(reparsed.sessionId, "2");
	await enqueueL1EdgeScope(sqlClient, {
		kind: "run_index",
		organizationId,
		...waiting,
	});

	const options = { organizationId, maxSessions: 100 };
	const before = await runIndexScopes();
	const preview = await previewRunIndexBackfill(clickhouse, sqlClient, options);
	expect(preview).toMatchObject({
		status: "preview",
		candidates: 3,
		byReason: { missing: 2, generation: 1 },
		alreadyQueued: 1,
		queued: 2,
		hasMore: false,
	});
	// A preview writes nothing.
	expect(await runIndexScopes()).toEqual(before);

	const run = await backfillRunIndex(clickhouse, sqlClient, options);
	expect(run).toMatchObject({ status: "queued", queued: 2, alreadyQueued: 1 });
	const queued = (await runIndexScopes()).filter((scope) => scope.pending);
	expect(queued.map((scope) => scope.scope_id).sort()).toEqual(
		[missing, reparsed, waiting].map(sessionScopeId).sort(),
	);
	// A new scope is queued at backfill priority; an existing one keeps the
	// more urgent priority it had.
	expect(
		queued.find((scope) => scope.scope_id === sessionScopeId(missing))
			?.priority,
	).toBe(1);
	// No session edge scope was needed or created.
	expect(
		await sqlClient.unsafe(
			"SELECT 1 FROM l1_edge_scope WHERE organization_id = $1 AND scope_kind = 'session'",
			[organizationId],
		),
	).toHaveLength(0);

	// Bounded: one session per run, continued with `next`.
	const first = await previewRunIndexBackfill(clickhouse, sqlClient, {
		organizationId,
		maxSessions: 1,
	});
	expect(first).toMatchObject({ candidates: 1, hasMore: true });
	expect(first.next).not.toBeNull();

	expect(await pass()).toBe(3);
	expect(
		await previewRunIndexBackfill(clickhouse, sqlClient, options),
	).toMatchObject({ candidates: 0, queued: 0 });
});
