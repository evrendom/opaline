import "./helpers/local-integration-guard.js";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { TRANSCRIPT_RECORDS_PARSER_VERSION } from "@rudel/api-routes/transcript-records";
import postgres from "postgres";
import { getClickhouse } from "../clickhouse.js";
import {
	baseRow,
	gitObservationGenerationVersion,
} from "../services/git-observation-parser.js";
import {
	backfillL1Edges,
	decodeL1EdgeBackfillCursor,
} from "../services/l1-edges/l1-edge-backfill.service.js";
import { requeueStaleL1EdgeScopes } from "../services/l1-edges/l1-edge-census.service.js";
import { L1_EDGE_RESOLVER_VERSION } from "../services/l1-edges/l1-edge-derivation.js";
import { sessionScopeId } from "../services/l1-edges/l1-edge-ids.js";

setDefaultTimeout(120_000);
// Its own client: another suite in this process may close the shared one.
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", {
	max: 2,
	prepare: false,
});
const RUN = `l1_edge_census_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const organizationId = `${RUN}_org`;
const userId = `${RUN}_user`;
const clickhouse = getClickhouse();

afterAll(async () => {
	await clickhouse.execute({
		query:
			"DELETE FROM rudel.session_git_observations WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3",
		query_params: { organizationId },
	});
	await sqlClient.unsafe("DELETE FROM organization WHERE id = $1", [
		organizationId,
	]);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = $1', [userId]);
	await sqlClient.end();
});

const census = () =>
	requeueStaleL1EdgeScopes({
		sql: sqlClient,
		executor: clickhouse,
		organizationId,
		deadline: { deadlineAt: Date.now() + 60_000, now: Date.now },
	});

test("the edge census queues observed sessions without a current build, once", async () => {
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, 'Census', $2, false)`,
		[userId, `${userId}@example.com`],
	);
	await sqlClient.unsafe(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'Census', $1)",
		[organizationId],
	);
	const session = (name: string) => ({
		userId,
		source: "claude_code" as const,
		sessionId: `${RUN}_${name}`,
	});
	// One will be built under older rules, the other at the current generation.
	const older = session("a");
	const current = session("b");
	const sessions = [older, current];
	await clickhouse.insert({
		table: "rudel.session_git_observations",
		asyncInsert: false,
		values: sessions.map((session) => ({
			...baseRow(
				{
					organizationId,
					...session,
					revision: "1",
					transcriptParserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
				},
				{
					agent_id: "",
					record_idx: 4_294_967_295,
					block_idx: 0,
					call_id: "",
					ts: new Date().toISOString(),
				},
			),
			kind: "receipt",
			label: "",
		})),
	});

	// The edge backfill pages the same sessions by key, writing nothing in a preview.
	const first = await backfillL1Edges(
		clickhouse,
		sqlClient,
		{ organizationId, maxSessions: 1 },
		false,
	);
	expect(first).toMatchObject({ sessions: 1, hasMore: true });
	const second = await backfillL1Edges(
		clickhouse,
		sqlClient,
		{
			organizationId,
			maxSessions: 1,
			after: decodeL1EdgeBackfillCursor(first.next ?? ""),
		},
		false,
	);
	expect(second).toMatchObject({ sessions: 1, repositories: 0 });
	const last = await backfillL1Edges(
		clickhouse,
		sqlClient,
		{
			organizationId,
			maxSessions: 1,
			after: decodeL1EdgeBackfillCursor(second.next ?? first.next ?? ""),
		},
		false,
	);
	expect(last).toMatchObject({ sessions: 0, hasMore: false });

	expect(await census()).toMatchObject({
		sessionCandidates: 2,
		sessionsQueued: 2,
		byReason: { missing: 2 },
	});
	const scopes = await sqlClient.unsafe<
		{ scope_id: string; priority: number }[]
	>(
		"SELECT scope_id, priority FROM l1_edge_scope WHERE organization_id = $1 AND scope_kind = 'session' ORDER BY scope_id",
		[organizationId],
	);
	expect(
		scopes.map((scope) => [scope.scope_id, Number(scope.priority)]),
	).toEqual(sessions.map((session) => [sessionScopeId(session), 1]).sort());
	// Waiting for a build: left alone.
	expect(await census()).toMatchObject({ sessionsQueued: 0, alreadyQueued: 2 });

	await sqlClient.unsafe(
		`UPDATE l1_edge_scope SET built_request_count = request_count, built_revision = 1,
			resolver_version = $3, input = $4::text::jsonb
		 WHERE organization_id = $1 AND scope_kind = 'session' AND scope_id = $2`,
		[organizationId, sessionScopeId(older), L1_EDGE_RESOLVER_VERSION - 1, "{}"],
	);
	await sqlClient.unsafe(
		`UPDATE l1_edge_scope SET built_request_count = request_count, built_revision = 1,
			resolver_version = $3, input = $4::text::jsonb
		 WHERE organization_id = $1 AND scope_kind = 'session' AND scope_id = $2`,
		[
			organizationId,
			sessionScopeId(current),
			L1_EDGE_RESOLVER_VERSION,
			JSON.stringify({
				transcript: null,
				truncated: false,
				generation: {
					revision: "1",
					parserVersion: gitObservationGenerationVersion(
						TRANSCRIPT_RECORDS_PARSER_VERSION,
					),
					transcriptParserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
				},
			}),
		],
	);
	expect(await census()).toMatchObject({
		sessionsQueued: 1,
		byReason: { resolver_version: 1 },
		alreadyQueued: 0,
	});
});
