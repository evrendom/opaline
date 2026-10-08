import "./helpers/local-integration-guard.js";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import postgres from "postgres";
import { getClickhouse } from "../clickhouse.js";
import {
	enqueueL1EdgeScope,
	recordL1EdgeDependencies,
} from "../services/l1-edges/l1-edge-queue.service.js";
import { runL1EdgePass } from "../services/l1-edges/l1-edge-reconciliation.service.js";

setDefaultTimeout(180_000);
// Its own client: another suite in this process may close the shared one.
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", {
	max: 2,
	prepare: false,
});
const RUN = `l1_github_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const organizationId = `${RUN}_org`;
const userId = `${RUN}_user`;
const repositoryId = `7${Date.now() % 1_000_000_000}`;
const clickhouse = getClickhouse();
const now = Date.now();
const timestamp = (offsetSeconds: number) =>
	new Date(now - 3_600_000 + offsetSeconds * 1_000)
		.toISOString()
		.replace("T", " ")
		.replace("Z", "");
const sha = `a1b2c3d${"0".repeat(32)}1`;
const mergeSha = `e0e0e0e${"0".repeat(32)}2`;
const github = {
	workspace_id: organizationId,
	provider: "github",
	repository_id: repositoryId,
	version: "1",
	synced_at: timestamp(10),
};

afterAll(async () => {
	for (const table of [
		"rudel.github_pull_requests",
		"rudel.github_pull_request_commits",
		"rudel.github_ci_runs",
		"rudel.github_ci_run_pull_requests",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE workspace_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
			query_params: { organizationId },
		});
	for (const table of ["rudel.l1_edges", "rudel.l1_edges_by_target"])
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

/** Builds this test's scopes only: other suites' extractions queue theirs too. */
const pass = async () => {
	await sqlClient.unsafe(
		"DELETE FROM l1_edge_scope WHERE organization_id <> $1",
		[organizationId],
	);
	return runL1EdgePass({
		sql: sqlClient,
		budgetMs: 60_000,
		sources: {
			executor: clickhouse,
			access: async () => ({
				visibility: "visible" as const,
				bindings: [{ repositoryId, fullName: "opalinehq/athena" }],
				repositories: new Map(),
			}),
			evidence: async () => ({ snapshots: [], captures: [] }),
		},
	});
};

test("a repository scope projects GitHub's commit, PR and CI links and re-queues the sessions that depend on it", async () => {
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, 'GitHub edges', $2, false)`,
		[userId, `${userId}@example.com`],
	);
	await sqlClient.unsafe(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'GitHub edges', $1)",
		[organizationId],
	);
	await clickhouse.insert({
		table: "rudel.github_pull_requests",
		asyncInsert: false,
		values: [
			{
				...github,
				number: 7,
				provider_pull_request_id: "p7",
				state: "closed",
				draft: 0,
				created_at: timestamp(1),
				updated_at: timestamp(5),
				merged_at: timestamp(5),
				head_sha: sha,
				head_ref: "feat/x",
				base_ref: "main",
				head_repository_id: repositoryId,
				merge_commit_sha: mergeSha,
				title: "feat: x",
			},
		],
	});
	await clickhouse.insert({
		table: "rudel.github_pull_request_commits",
		asyncInsert: false,
		values: [{ ...github, sha, pr_number: 7, last_seen_head_sha: sha }],
	});
	await clickhouse.insert({
		table: "rudel.github_ci_runs",
		asyncInsert: false,
		values: [
			{
				...github,
				kind: "actions_run",
				run_id: "9001",
				attempt: 1,
				created_at: timestamp(3),
				workflow_name: "CI",
				event: "pull_request",
				head_sha: sha,
				head_branch: "feat/x",
				status: "completed",
				conclusion: "success",
			},
		],
	});
	await clickhouse.insert({
		table: "rudel.github_ci_run_pull_requests",
		asyncInsert: false,
		values: [
			{
				...github,
				pr_number: 7,
				run_created_at: timestamp(3),
				kind: "actions_run",
				run_id: "9001",
				attempt: 1,
				basis: "provider",
			},
		],
	});

	// A built session that named this repository.
	const session = {
		kind: "session" as const,
		organizationId,
		userId,
		source: "claude_code",
		sessionId: `${RUN}_session`,
	};
	await enqueueL1EdgeScope(sqlClient, session);
	const scopeId = `${encodeURIComponent(userId)}/claude_code/${encodeURIComponent(session.sessionId)}`;
	await sqlClient.unsafe(
		"UPDATE l1_edge_scope SET built_request_count = request_count WHERE organization_id = $1",
		[organizationId],
	);
	await recordL1EdgeDependencies(sqlClient, { organizationId, scopeId }, [
		{ repositoryKey: repositoryId, openUntil: new Date(now + 86_400_000) },
	]);

	await enqueueL1EdgeScope(sqlClient, {
		kind: "repository",
		organizationId,
		repositoryId,
	});
	// The repository builds, then the session it re-queued.
	expect(await pass()).toBeGreaterThanOrEqual(1);
	const edges = await clickhouse.query<{
		from_id: string;
		relation: string;
		to_id: string;
		match_rule: string;
	}>({
		query: `SELECT from_id, relation, to_id, match_rule FROM rudel.l1_edges FINAL
			WHERE organization_id = {organizationId:String} AND is_active = 1
			ORDER BY relation, match_rule`,
		query_params: { organizationId },
	});
	expect(edges).toEqual([
		{
			from_id: `${repositoryId}/7`,
			relation: "ci_for_pr",
			to_id: `${repositoryId}/actions_run/9001/1`,
			match_rule: "provider",
		},
		{
			from_id: `${repositoryId}/${sha}`,
			relation: "ci_on_sha",
			to_id: `${repositoryId}/actions_run/9001/1`,
			match_rule: "head_sha",
		},
		{
			from_id: `${repositoryId}/${sha}`,
			relation: "commit_in_pr",
			to_id: `${repositoryId}/7`,
			match_rule: "membership",
		},
		{
			from_id: `${repositoryId}/${mergeSha}`,
			relation: "commit_in_pr",
			to_id: `${repositoryId}/7`,
			match_rule: "merge_commit",
		},
	]);
	const scopes = await sqlClient.unsafe<
		{ scope_kind: string; request_count: string; watermark: string | null }[]
	>(
		"SELECT scope_kind, request_count::text, watermark::text FROM l1_edge_scope WHERE organization_id = $1 ORDER BY scope_kind",
		[organizationId],
	);
	// The session was re-queued (a second request) and the repository has a watermark.
	expect(
		scopes.map((scope) => [scope.scope_kind, scope.request_count]),
	).toEqual([
		["repository", "1"],
		["session", "2"],
	]);
	expect(scopes[0]?.watermark).not.toBeNull();

	// A second projection only re-reads the overlap and writes the same edges.
	await enqueueL1EdgeScope(sqlClient, {
		kind: "repository",
		organizationId,
		repositoryId,
	});
	await pass();
	const [{ count } = { count: "-1" }] = await clickhouse.query<{
		count: string;
	}>({
		query: `SELECT count() AS count FROM rudel.l1_edges FINAL
			WHERE organization_id = {organizationId:String} AND is_active = 1`,
		query_params: { organizationId },
	});
	expect(Number(count)).toBe(4);
});
