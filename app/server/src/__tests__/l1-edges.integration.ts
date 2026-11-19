import "./helpers/local-integration-guard.js";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	type TranscriptRecordDraft,
} from "@rudel/api-routes/transcript-records";
import postgres from "postgres";
import { getClickhouse } from "../clickhouse.js";
import type { GitHubSource } from "../services/analysis/git-links.js";
import {
	baseRow,
	type GitObservationRecord,
	parseGitObservations,
} from "../services/git-observation-parser.js";
import { enqueueL1EdgeScope } from "../services/l1-edges/l1-edge-queue.service.js";
import { runL1EdgePass } from "../services/l1-edges/l1-edge-reconciliation.service.js";
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
const RUN = `l1_edges_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const organizationId = `${RUN}_org`;
const userId = `${RUN}_user`;
const sessionId = `${RUN}_session`;
const repositoryId = `8${Date.now() % 1_000_000_000}`;
const clickhouse = getClickhouse();
const baseMs = Date.now() - 3_600_000;
const at = (offset: number) => new Date(baseMs + offset * 1_000).toISOString();
const timestamp = (offset: number) =>
	at(offset).replace("T", " ").replace("Z", "");
const fullSha = `d4e5f6a${"0".repeat(32)}1`;
const github = {
	workspace_id: organizationId,
	provider: "github",
	repository_id: repositoryId,
	version: "1",
	synced_at: timestamp(5),
};
const source: Pick<GitHubSource, "access" | "evidence"> = {
	access: async () => ({
		visibility: "visible" as const,
		bindings: [{ repositoryId, fullName: "opalinehq/athena" }],
		repositories: new Map(),
	}),
	evidence: async () => ({ snapshots: [], captures: [] }),
};
/** Builds this test's scopes only: other suites' extractions queue theirs too. */
const pass = async () => {
	await sqlClient.unsafe(
		"DELETE FROM l1_edge_scope WHERE organization_id <> $1",
		[organizationId],
	);
	return runL1EdgePass({
		sql: sqlClient,
		budgetMs: 60_000,
		sources: { executor: clickhouse, ...source },
	});
};
const scope = {
	kind: "session" as const,
	organizationId,
	userId,
	source: "claude_code",
	sessionId,
};

afterAll(async () => {
	for (const table of [
		"rudel.transcript_records",
		"rudel.session_analytics",
		"rudel.session_git_observations",
		"rudel.l1_edges",
		"rudel.l1_edges_by_target",
		"rudel.l1_edge_resolutions",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
			query_params: { organizationId },
		});
	for (const table of [
		"rudel.github_pull_requests",
		"rudel.github_pull_request_commits",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE workspace_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
			query_params: { organizationId },
		});
	await sqlClient.unsafe(
		"DELETE FROM clickhouse_purge_job WHERE target_id = $1",
		[userId],
	);
	await sqlClient.unsafe("DELETE FROM organization WHERE id = $1", [
		organizationId,
	]);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = $1', [userId]);
	await sqlClient.end();
});

type Edge = {
	from_kind: string;
	from_id: string;
	relation: string;
	to_id: string;
	is_active: number;
};
const activeEdges = async () =>
	clickhouse.query<Edge>({
		query: `SELECT from_kind, from_id, relation, to_id, is_active FROM rudel.l1_edges FINAL
			WHERE organization_id = {organizationId:String} AND is_active = 1
			ORDER BY relation, to_id`,
		query_params: { organizationId },
	});

test("the worker writes a session's edges from its runs, readable by target, and retracts what no longer holds", async () => {
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, 'Edges', $2, false)`,
		[userId, `${userId}@example.com`],
	);
	await sqlClient.unsafe(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'Edges', $1)",
		[organizationId],
	);
	const transcript = [
		{
			type: "user",
			timestamp: at(0),
			message: { role: "user", content: "Commit, push and check CI" },
		},
		tool("commit", "git commit -m 'feat: links'"),
		result("commit", "[feat/links d4e5f6a] feat: links\n 1 file changed"),
		tool("push", "git push -u origin feat/links"),
		result(
			"push",
			"To github.com:opalinehq/athena.git\n   a1b2c3d..d4e5f6a  feat/links -> feat/links",
		),
		tool("checks", "gh pr checks 133 --repo opalinehq/athena"),
		result("checks", "build\tpass"),
	]
		.map((line) => JSON.stringify(line))
		.join("\n");
	const identity = {
		organizationId,
		userId,
		sessionId,
		source: "claude_code" as const,
		revision: "1",
		sessionDate: at(0),
	};
	const stats = createSplitStats();
	const drafts = [
		...splitSessionTranscript(
			{ content: transcript, sessionDate: at(0), source: "claude_code" },
			stats,
		),
	];
	const rows = drafts.map((draft) => buildTranscriptRecordRow(identity, draft));
	await clickhouse.insert({
		table: "rudel.transcript_records",
		asyncInsert: false,
		values: [
			...rows,
			buildTranscriptRecordsReceiptRow(identity, {
				...summarizeSplit(stats),
				contentSha256: hashTranscriptContent(transcript),
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
				organization_id: organizationId,
				user_id: userId,
				session_id: sessionId,
				source: "claude_code",
				session_date: timestamp(0),
				last_interaction_date: timestamp(10),
				project_path: "/test/edges",
				git_remote: "github.com/opalinehq/athena",
				model_used: "claude-opus-5-5",
				revision: "1",
			},
		],
	});
	const observationInput = {
		organizationId,
		userId,
		sessionId,
		source: "claude_code" as const,
		revision: "1",
		transcriptParserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
	};
	const observations = parseGitObservations({
		...observationInput,
		records: observationRecords(drafts),
	});
	expect(observations.map((row) => row.kind)).toEqual([
		"commit_created",
		"push_range",
		"ci_check",
	]);
	await clickhouse.insert({
		table: "rudel.session_git_observations",
		asyncInsert: false,
		values: [
			...observations,
			{
				...baseRow(observationInput, {
					agent_id: "",
					record_idx: 4_294_967_295,
					block_idx: 0,
					call_id: "",
					ts: at(0),
				}),
				kind: "receipt",
				label: "",
			},
		],
	});
	await clickhouse.insert({
		table: "rudel.github_pull_requests",
		asyncInsert: false,
		values: [
			{
				...github,
				number: 133,
				provider_pull_request_id: "p133",
				state: "open",
				draft: 0,
				created_at: timestamp(1),
				updated_at: timestamp(4),
				head_sha: fullSha,
				head_ref: "feat/links",
				base_ref: "main",
				head_repository_id: repositoryId,
				merge_commit_sha: "",
				title: "feat: links",
			},
		],
	});
	await clickhouse.insert({
		table: "rudel.github_pull_request_commits",
		asyncInsert: false,
		values: [
			{ ...github, sha: fullSha, pr_number: 133, last_seen_head_sha: fullSha },
		],
	});

	await enqueueL1EdgeScope(sqlClient, scope);
	expect(await pass()).toBeGreaterThanOrEqual(1);
	const runId = `${encodeURIComponent(userId)}/claude_code/${encodeURIComponent(sessionId)}//`;
	const edges = await activeEdges();
	expect(edges.map((edge) => [edge.relation, edge.to_id])).toEqual([
		["commit_created", `${repositoryId}/${fullSha}`],
		["commit_pushed", `${repositoryId}/${fullSha}`],
		["pr_branch_head", `${repositoryId}/133`],
		["pr_named", `${repositoryId}/133`],
	]);
	// Every edge comes from the run that starts at the prompt (record 1).
	expect(
		new Set(edges.map((edge) => `${edge.from_kind}:${edge.from_id}`)),
	).toEqual(new Set([`run:${runId}1`]));
	// The reverse copy answers which runs touched the PR.
	const reverse = await clickhouse.query<{ from_id: string; relation: string }>(
		{
			query: `SELECT from_id, relation FROM rudel.l1_edges_by_target FINAL
			WHERE organization_id = {organizationId:String} AND to_kind = 'pull_request' AND to_id = {pr:String} AND is_active = 1
			ORDER BY relation`,
			query_params: { organizationId, pr: `${repositoryId}/133` },
		},
	);
	expect(reverse).toEqual([
		{ from_id: `${runId}1`, relation: "pr_branch_head" },
		{ from_id: `${runId}1`, relation: "pr_named" },
	]);
	const [built] = await sqlClient.unsafe<
		{ done: boolean; edge_count: number }[]
	>(
		"SELECT request_count = built_request_count AS done, edge_count FROM l1_edge_scope WHERE organization_id = $1 AND scope_kind = 'session'",
		[organizationId],
	);
	expect(built).toEqual({ done: true, edge_count: 4 });

	// A rebuild is idempotent.
	await enqueueL1EdgeScope(sqlClient, scope);
	await pass();
	expect(await activeEdges()).toEqual(edges);

	// A newer transcript generation is published before its observations are
	// re-extracted: the build waits and keeps the edges rather than rebuilding
	// from stale observations.
	const republished = { ...identity, revision: "2" };
	await clickhouse.insert({
		table: "rudel.transcript_records",
		asyncInsert: false,
		values: [
			...drafts.map((draft) => buildTranscriptRecordRow(republished, draft)),
			buildTranscriptRecordsReceiptRow(republished, {
				...summarizeSplit(stats),
				contentSha256: hashTranscriptContent(transcript),
				parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
				publishedAt: new Date().toISOString(),
				rowCount: rows.length,
			}),
		],
	});
	await enqueueL1EdgeScope(sqlClient, scope);
	await pass();
	expect(await activeEdges()).toEqual(edges);
	const [deferred] = await sqlClient.unsafe<
		{ done: boolean; last_error: string | null }[]
	>(
		"SELECT request_count = built_request_count AS done, last_error FROM l1_edge_scope WHERE organization_id = $1 AND scope_kind = 'session'",
		[organizationId],
	);
	expect(deferred?.done).toBe(false);
	expect(deferred?.last_error).toContain("git observations lag");
	// The re-extraction lands and requeues the session; once the deferral's
	// backoff (30 seconds) passes, the build completes.
	const reextracted = { ...observationInput, revision: "2" };
	await clickhouse.insert({
		table: "rudel.session_git_observations",
		asyncInsert: false,
		values: [
			...parseGitObservations({
				...reextracted,
				records: observationRecords(drafts),
			}),
			{
				...baseRow(reextracted, {
					agent_id: "",
					record_idx: 4_294_967_295,
					block_idx: 0,
					call_id: "",
					ts: at(0),
				}),
				kind: "receipt",
				label: "",
			},
		],
	});
	await enqueueL1EdgeScope(sqlClient, scope);
	await sqlClient.unsafe(
		"UPDATE l1_edge_scope SET next_attempt_at = now() WHERE organization_id = $1",
		[organizationId],
	);
	await pass();
	expect(await activeEdges()).toEqual(edges);
	const [rebuilt] = await sqlClient.unsafe<{ done: boolean }[]>(
		"SELECT request_count = built_request_count AS done FROM l1_edge_scope WHERE organization_id = $1 AND scope_kind = 'session'",
		[organizationId],
	);
	expect(rebuilt?.done).toBe(true);

	// The PR leaves GitHub's data: its edges are retracted and the reason kept.
	await clickhouse.execute({
		query:
			"DELETE FROM rudel.github_pull_requests WHERE workspace_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3",
		query_params: { organizationId },
	});
	await enqueueL1EdgeScope(sqlClient, scope);
	await pass();
	expect((await activeEdges()).map((edge) => edge.relation)).toEqual([
		"commit_created",
		"commit_pushed",
	]);
	const reasons = await clickhouse.query<{ target: string; status: string }>({
		query: `SELECT target, status FROM rudel.l1_edge_resolutions FINAL
			WHERE organization_id = {organizationId:String} AND is_active = 1 AND status != 'linked'
			ORDER BY target`,
		query_params: { organizationId },
	});
	expect(reasons).toEqual([
		{ target: "branch_pull_request", status: "not_found" },
		{ target: "pull_request", status: "not_found" },
	]);

	// The account is being deleted: its edges go and its scope is dropped.
	await sqlClient.unsafe(
		`INSERT INTO clickhouse_purge_job (id, target_type, target_id, status, max_attempts)
		 VALUES ($1, 'account', $2, 'succeeded', 1)`,
		[crypto.randomUUID(), userId],
	);
	await enqueueL1EdgeScope(sqlClient, scope);
	await pass();
	expect(await activeEdges()).toEqual([]);
	const [{ count } = { count: -1 }] = await sqlClient.unsafe<
		{ count: number }[]
	>(
		// The fenced session scope is dropped; a built run index scope may stay
		// until the account is deleted, but none of its rows remain.
		"SELECT count(*)::int AS count FROM l1_edge_scope WHERE organization_id = $1 AND scope_kind = 'session'",
		[organizationId],
	);
	expect(count).toBe(0);
});

function observationRecords(
	drafts: readonly TranscriptRecordDraft[],
): GitObservationRecord[] {
	return drafts.map((draft) => ({
		agent_id: draft.agentId,
		record_idx: draft.recordIdx,
		block_idx: draft.blockIdx,
		call_id: draft.callId,
		kind: draft.kind,
		subtype: draft.subtype,
		tool_name: draft.toolName,
		is_error: draft.isError,
		exit_code: draft.exitCode,
		ts: draft.ts,
		text: draft.text,
		text_chars: draft.textChars,
		byte_start: String(draft.byteStart),
		byte_len: draft.byteLen,
	}));
}

function tool(id: string, command: string) {
	return {
		type: "assistant",
		timestamp: at(1),
		message: {
			role: "assistant",
			content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
		},
	};
}
function result(id: string, content: string) {
	return {
		type: "user",
		timestamp: at(2),
		message: {
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: id, content, is_error: false },
			],
		},
	};
}
