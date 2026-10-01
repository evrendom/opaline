import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	sweepCheckSchema,
	sweepPullRequestSchema,
	sweepRunSchema,
	sweepStatusSchema,
} from "@rudel/repo-intelligence-source-github";
import postgres from "postgres";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { runClickHousePurgeWorkerOnce } from "./clickhouse-purge.service.js";
import {
	persistGitHubChecks,
	persistGitHubCommits,
	persistGitHubJobs,
	persistGitHubPullRequests,
	persistGitHubRuns,
	persistGitHubStatuses,
} from "./github-outcomes-persistence.service.js";
import { persistGitHubRepositoryInstallation } from "./github-repository-binding.service.js";
import {
	enqueueGitHubRepositorySweep,
	isGitHubSweepEnabled,
	runGitHubRepositorySweep,
} from "./github-repository-sweep.service.js";
import { recordGitHubWebhookDelivery } from "./github-webhook-delivery.service.js";
import { mapGitHubWebhookEvent } from "./github-webhook-events.js";
import {
	deleteOrgSessions,
	deleteUserSessions,
} from "./org-session.service.js";
import { deleteOrganizationPostgresData } from "./organization-deletion.service.js";
import { deleteUserPostgresData } from "./user-deletion.service.js";

setDefaultTimeout(120_000);

const NOW = new Date("2026-10-01T12:00:00Z");
const HEAD = "a".repeat(40);
const ids: string[] = [];
const users: string[] = [];
const config = { appId: "1", privateKeyPem: "fixture", slug: "fixture" };
type Route = (url: URL) => Response | Promise<Response>;

afterAll(async () => {
	for (const organizationId of ids) await deleteOrgSessions(organizationId);
	await sqlClient.unsafe(
		"DELETE FROM clickhouse_purge_job WHERE target_id = ANY($1::text[])",
		[[...ids, ...users]],
	);
	await sqlClient.unsafe(
		"DELETE FROM organization WHERE id = ANY($1::text[])",
		[ids],
	);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = ANY($1::text[])', [
		users,
	]);
});

test("halves 1,000-result windows and visits oldest CI first without an event filter", async () => {
	const scope = await seed();
	const windows: string[] = [];
	const route: Route = (url) => {
		if (url.pathname.endsWith("/actions/runs")) {
			const created = url.searchParams.get("created") ?? "";
			windows.push(created);
			const [from, to] = created.split("..").map((value) => Date.parse(value));
			return json({
				total_count: (to ?? 0) - (from ?? 0) > 86_400_000 ? 1000 : 1,
				workflow_runs: [run(windows.length, new Date(from ?? 0).toISOString())],
			});
		}
		return defaults(url);
	};
	await execute(scope.organizationId, route);
	expect(windows).toHaveLength(3);
	expect(windows[1]?.split("..")[0]).toBe(windows[0]?.split("..")[0]);
	expect(windows[2]?.split("..")[0]).not.toBe(windows[0]?.split("..")[0]);
	const [state] = await sqlClient.unsafe<Array<{ split: number }>>(
		`SELECT count(*)::int AS split FROM github_repository_sweep WHERE organization_id = $1 AND status = 'split'`,
		[scope.organizationId],
	);
	const [runs] = await queryFacts<{ count: number }>(
		"SELECT count() AS count FROM rudel.github_ci_runs FINAL WHERE workspace_id = {workspace:String}",
		scope.organizationId,
	);
	expect(state?.split).toBe(1);
	expect(runs?.count).toBe(2);
});

test("resumes after a crash mid-window without advancing past unwritten pages", async () => {
	const scope = await seed();
	let crash = true;
	const pages: number[] = [];
	const route: Route = (url) => {
		if (url.pathname.endsWith("/actions/runs")) {
			const page = Number(url.searchParams.get("page"));
			pages.push(page);
			if (page === 2 && crash) return json({ message: "fixture crash" }, 500);
			return json(
				{ total_count: 2, workflow_runs: [run(page)] },
				200,
				page === 1
					? {
							link: '<https://api.github.com/repos/o/r/actions/runs?page=2>; rel="next"',
						}
					: {},
			);
		}
		return defaults(url);
	};
	await expect(execute(scope.organizationId, route)).rejects.toThrow("500");
	const [progress] = await sqlClient.unsafe<
		Array<{ cursor: { page: number } }>
	>(
		`SELECT cursor FROM github_repository_sweep WHERE organization_id = $1 AND dataset = 'actions'`,
		[scope.organizationId],
	);
	expect(progress?.cursor.page).toBe(2);
	crash = false;
	await execute(scope.organizationId, route);
	expect(pages).toEqual([1, 2, 2]);
	const [count] = await queryFacts<{ count: number }>(
		`SELECT count() AS count FROM rudel.github_ci_runs FINAL WHERE workspace_id = {workspace:String}`,
		scope.organizationId,
	);
	expect(count?.count).toBe(2);
});

test("a window larger than one invocation advances acknowledged pages and completes", async () => {
	const scope = await seed();
	const pages: number[] = [];
	const route: Route = (url) => {
		if (!url.pathname.endsWith("/actions/runs")) return defaults(url);
		const page = Number(url.searchParams.get("page"));
		pages.push(page);
		return json(
			{ total_count: 3, workflow_runs: [run(page)] },
			200,
			page < 3
				? {
						link: `<https://api.github.com/repos/o/r/actions/runs?page=${page + 1}>; rel="next"`,
					}
				: {},
		);
	};
	for (const page of [1, 2]) {
		const result = await execute(scope.organizationId, route, sqlClient, 1);
		expect(result.requests).toBe(1);
		expect(result.hasMore).toBe(true);
		const [progress] = await sqlClient.unsafe<
			Array<{ page: number; status: string }>
		>(
			"SELECT (cursor->>'page')::int AS page, status FROM github_repository_sweep WHERE organization_id = $1 AND dataset = 'actions'",
			[scope.organizationId],
		);
		expect(progress).toEqual({ page: page + 1, status: "pending" });
		const [stored] = await queryFacts<{ count: number }>(
			"SELECT count() AS count FROM rudel.github_ci_runs FINAL WHERE workspace_id = {workspace:String}",
			scope.organizationId,
		);
		expect(stored?.count).toBe(page);
	}
	expect((await execute(scope.organizationId, route)).hasMore).toBe(false);
	expect(pages).toEqual([1, 2, 3]);
	const [complete] = await sqlClient.unsafe<Array<{ status: string }>>(
		"SELECT status FROM github_repository_sweep WHERE organization_id = $1 AND dataset = 'actions'",
		[scope.organizationId],
	);
	expect(complete?.status).toBe("complete");
});

test("stores earlier attempts and their failed jobs, linking fork PRs by head SHA", async () => {
	const scope = await seed();
	const paths: string[] = [];
	await execute(scope.organizationId, (url) => {
		paths.push(url.pathname);
		if (url.pathname.endsWith("/actions/runs"))
			return json({
				total_count: 1,
				workflow_runs: [
					run(12, undefined, { run_attempt: 3, event: "schedule" }),
				],
			});
		if (url.pathname.endsWith("/attempts/1"))
			return json(
				run(12, undefined, { run_attempt: 1, conclusion: "failure" }),
			);
		if (url.pathname.endsWith("/attempts/2"))
			return json(
				run(12, undefined, { run_attempt: 2, conclusion: "cancelled" }),
			);
		if (url.pathname.endsWith("/jobs"))
			return json({
				jobs: [
					{
						id: Number(url.pathname.includes("attempts/1") ? 100 : 101),
						run_id: 12,
						run_attempt: url.pathname.includes("attempts/1") ? 1 : 2,
						name: "test",
						status: "completed",
						conclusion: "failure",
						started_at: "2026-09-30T10:00:00Z",
						completed_at: "2026-09-30T10:01:00Z",
					},
				],
			});
		if (url.pathname.endsWith("/pulls")) return json([pr(1)]);
		if (url.pathname.endsWith("/check-runs"))
			return json({
				check_runs: [
					{
						id: 98,
						head_sha: HEAD,
						status: "completed",
						conclusion: "failure",
						started_at: "2026-09-30T10:00:00Z",
						completed_at: "2026-09-30T10:01:00Z",
						app: { id: 1, slug: "github-actions" },
					},
					{
						id: 99,
						head_sha: HEAD,
						status: "completed",
						conclusion: "success",
						started_at: "2026-09-30T10:00:00Z",
						completed_at: "2026-09-30T10:01:00Z",
						app: { id: 2, slug: "external" },
					},
				],
			});
		return defaults(url);
	});
	const attempts = await queryFacts<{
		attempt: number;
		pull_request_numbers: number[];
		event: string;
	}>(
		`SELECT attempt, event, (SELECT groupUniqArray(pr_number) FROM rudel.github_ci_run_pull_requests FINAL WHERE workspace_id = {workspace:String}) AS pull_request_numbers FROM rudel.github_ci_runs FINAL WHERE workspace_id = {workspace:String} AND kind = 'actions_run' ORDER BY attempt`,
		scope.organizationId,
	);
	expect(attempts.map(({ attempt }) => attempt)).toEqual([1, 2, 3]);
	expect(
		attempts.every(({ pull_request_numbers }) =>
			pull_request_numbers.includes(1),
		),
	).toBe(true);
	expect(attempts[2]?.event).toBe("schedule");
	const [jobs] = await queryFacts<{ count: number }>(
		`SELECT count() AS count FROM rudel.github_ci_jobs FINAL WHERE workspace_id = {workspace:String}`,
		scope.organizationId,
	);
	expect(jobs?.count).toBe(2);
	const [checks] = await queryFacts<{ count: number }>(
		`SELECT count() AS count FROM rudel.github_ci_runs FINAL WHERE workspace_id = {workspace:String} AND kind = 'check_run'`,
		scope.organizationId,
	);
	expect(checks?.count).toBe(1);
	expect(paths.indexOf("/repos/fixture/repo/pulls")).toBeGreaterThan(
		paths.indexOf("/repos/fixture/repo/actions/runs/12/attempts/2"),
	);
});

test("caps append-only PR commit memberships at 250", async () => {
	const scope = await seed();
	await execute(scope.organizationId, (url) => {
		if (url.pathname.endsWith("/pulls")) return json([pr(1, { commits: 300 })]);
		if (url.pathname.endsWith("/commits")) {
			const page = Number(url.searchParams.get("page"));
			return json(
				Array.from({ length: 100 }, (_, position) => ({
					sha: (page * 100 + position).toString(16).padStart(40, "0"),
					commit: {
						message: "never store",
						author: { email: "private@example.test" },
					},
				})),
				200,
				{
					link: `<https://api.github.com/repos/o/r/pulls/1/commits?page=${page + 1}>; rel="next"`,
				},
			);
		}
		return defaults(url);
	});
	const [count] = await queryFacts<{ count: number }>(
		`SELECT count() AS count FROM rudel.github_pull_request_commits FINAL WHERE workspace_id = {workspace:String}`,
		scope.organizationId,
	);

	expect(count?.count).toBe(250);
});

for (const status of [403, 404])
	test(`${status} means unavailable, never empty`, async () => {
		const scope = await seed();
		await execute(scope.organizationId, () =>
			json({ message: "denied" }, status),
		);
		const states = await sqlClient.unsafe<
			Array<{ status: string; error: string }>
		>(
			`SELECT status, error FROM github_repository_sweep WHERE organization_id = $1`,
			[scope.organizationId],
		);
		expect(
			states.every(
				(row) =>
					row.status === "unavailable" && row.error === `github-${status}`,
			),
		).toBe(true);
	});

test("retention cliff marks complete empty older windows unavailable", async () => {
	const scope = await seed(15);
	await execute(scope.organizationId, (url) => {
		if (url.pathname.endsWith("/actions/runs")) {
			const start = Date.parse(
				url.searchParams.get("created")?.split("..")[0] ?? "",
			);
			return json({
				total_count: start < Date.parse("2026-09-30T00:00:00Z") ? 0 : 1,
				workflow_runs:
					start < Date.parse("2026-09-30T00:00:00Z") ? [] : [run(2)],
			});
		}
		return defaults(url);
	});
	const windows = await sqlClient.unsafe<
		Array<{ status: string; error: string; retention_boundary: Date }>
	>(
		`SELECT status, error, retention_boundary FROM github_repository_sweep WHERE organization_id = $1 AND dataset = 'actions' ORDER BY window_start`,
		[scope.organizationId],
	);
	expect(windows[0]?.status).toBe("unavailable");
	expect(windows[0]?.error).toBe("provider-retention");
	expect(new Date(windows.at(-1)?.retention_boundary ?? "").toISOString()).toBe(
		"2026-09-30T10:00:00.000Z",
	);
});

test("repositories without Actions still collect external CI and keep retention unknown", async () => {
	const scope = await seed();
	await execute(scope.organizationId, (url) => {
		if (url.pathname.endsWith("/actions/runs"))
			return json({ total_count: 0, workflow_runs: [] });
		if (url.pathname.endsWith("/pulls")) return json([pr(1)]);
		if (url.pathname.endsWith("/statuses"))
			return json([
				{
					id: 99,
					state: "failure",
					context: "external",
					created_at: "2026-09-30T10:00:00Z",
					updated_at: "2026-09-30T10:01:00Z",
				},
			]);
		return defaults(url);
	});
	const [run] = await queryFacts<{
		kind: string;
		pull_request_numbers: number[];
	}>(
		`SELECT kind, (SELECT groupUniqArray(pr_number) FROM rudel.github_ci_run_pull_requests FINAL WHERE workspace_id = {workspace:String}) AS pull_request_numbers FROM rudel.github_ci_runs FINAL WHERE workspace_id = {workspace:String}`,
		scope.organizationId,
	);
	expect(run).toEqual({ kind: "status", pull_request_numbers: [1] });
	const [progress] = await sqlClient.unsafe<
		Array<{ status: string; retention_boundary: string | null }>
	>(
		"SELECT status, retention_boundary FROM github_repository_sweep WHERE organization_id = $1 AND dataset = 'actions'",
		[scope.organizationId],
	);
	expect(progress).toEqual({ status: "complete", retention_boundary: null });
});

test("provider updated_at resolves webhook/sweep races and sanitizes only allowed fields", async () => {
	const scope = await seed();
	const webhook = mapGitHubWebhookEvent("pull_request", {
		action: "closed",
		installation: { id: Number(scope.installationId) },
		repository: { id: 1 },
		pull_request: pr(1, {
			title: `ghp_${"A".repeat(36)} ${"x".repeat(700)}`,
			updated_at: "2026-10-01T10:00:00Z",
			additions: 12,
			deletions: 3,
			body: "private body",
			user: { id: 4, login: "developer", email: "never@example.test" },
		}),
	});
	expect(webhook?.intent.kind).toBe("refresh");
	if (!webhook) throw new Error("fixture webhook must parse");
	await recordGitHubWebhookDelivery({
		database: sqlClient,
		deliveryId: randomUUID(),
		event: "pull_request",
		action: webhook.action,
		intent: webhook.intent,
		now: () => NOW,
	});
	await sqlClient.begin(async (transaction) => {
		await persistGitHubPullRequests(
			scope,
			[
				sweepPullRequestSchema.parse(
					pr(1, { title: "older", updated_at: "2026-09-30T10:00:00Z" }),
				),
			],
			"sweep",
			NOW,
			transaction,
		);
	});
	const [stored] = await queryFacts<{
		title: string;
		additions: number;
		record: string;
	}>(
		`SELECT pr.title AS title, details.additions AS additions, toJSONString(tuple(pr.title, pr.author_login)) AS record FROM (SELECT * FROM rudel.github_pull_requests FINAL WHERE workspace_id = {workspace:String}) pr LEFT ALL JOIN (SELECT * FROM rudel.github_pull_request_details FINAL WHERE workspace_id = {workspace:String}) details USING (workspace_id, provider, repository_id, number)`,
		scope.organizationId,
	);
	expect(stored?.title).not.toBe("older");
	expect(stored?.title.length).toBeLessThanOrEqual(512);
	expect(stored?.title).not.toContain(`ghp_${"A".repeat(36)}`);
	expect(stored?.additions).toBe(12);
	expect(stored?.record).not.toContain("private body");
	expect(stored?.record).not.toContain("never@example.test");
	const newRun = sweepRunSchema.parse(
		run(5, undefined, {
			updated_at: "2026-10-01T10:00:00Z",
			conclusion: "failure",
		}),
	);
	await persistGitHubRuns(scope, [newRun], "webhook", NOW, sqlClient);
	await persistGitHubRuns(
		scope,
		[sweepRunSchema.parse(run(5))],
		"sweep",
		NOW,
		sqlClient,
	);
	const [ci] = await queryFacts<{ conclusion: string }>(
		`SELECT conclusion FROM rudel.github_ci_runs FINAL WHERE workspace_id = {workspace:String}`,
		scope.organizationId,
	);
	expect(ci?.conclusion).toBe("failure");
});

test("kill switch stops requests and preserves resumable progress; live lane wins", async () => {
	const scope = await seed();
	expect(isGitHubSweepEnabled({})).toBe(true);
	expect(isGitHubSweepEnabled({ GITHUB_SWEEP_ENABLED: "FALSE" })).toBe(true);
	const disabled = await runGitHubRepositorySweep({
		database: sqlClient,
		config,
		environment: { GITHUB_SWEEP_ENABLED: "false" },
	});
	expect(disabled).toEqual({ enabled: false, requests: 0, hasMore: false });
	await sqlClient.unsafe(
		`INSERT INTO github_evidence_collection (id, organization_id, repository_id, installation_id, commit_sha, source_version, coverage, status, retry_after) VALUES ($1, $2, '1', $3, $4, '1', '{}', 'queued', NOW() - INTERVAL '1 minute')`,
		[randomUUID(), scope.organizationId, scope.installationId, HEAD],
	);
	const yielded = await execute(scope.organizationId, defaults);
	expect(yielded.requests).toBe(0);
	expect(yielded.hasMore).toBe(true);
});

test("free text is capped at 512 Unicode characters and remains valid ClickHouse text", async () => {
	const scope = await seed();
	await persistGitHubPullRequests(
		scope,
		[
			sweepPullRequestSchema.parse(pr(1, { title: `${"x".repeat(511)}😀` })),
			sweepPullRequestSchema.parse(pr(2, { title: "a\u0000b\uD800c" })),
		],
		"sweep",
		NOW,
		sqlClient,
	);
	const rows = await queryFacts<{ title: string; length: number }>(
		`SELECT title, lengthUTF8(title) AS length FROM rudel.github_pull_requests FINAL WHERE workspace_id = {workspace:String} ORDER BY number`,
		scope.organizationId,
	);
	expect(rows[0]?.length).toBe(512);
	expect(rows[0]?.title.endsWith("😀")).toBe(true);
	expect(rows[1]?.title).toBe("ab�c");
});

test("durable installation rate budget reserves at least half for live traffic", async () => {
	const scope = await seed();
	const result = await execute(scope.organizationId, (url) => {
		const response = url.pathname.endsWith("/pulls")
			? json([pr(1)])
			: defaults(url);
		response.headers.set("x-ratelimit-remaining", "3");
		return response;
	});
	expect(result.requests).toBe(2);
	expect(result.hasMore).toBe(true);
	const resumed = await execute(scope.organizationId, defaults);
	expect(resumed.requests).toBe(0);
});

test("a due refresh on a superseded live attempt does not block a sweep", async () => {
	const scope = await seed();
	for (const attempt of [1, 2])
		await sqlClient.unsafe(
			`INSERT INTO github_evidence_collection (id, organization_id, repository_id, installation_id, initiated_by_user_id, commit_sha, status, attempt_number, refresh_due_at, source_version, coverage)
			 VALUES ($1, $2, '1', $3, $4, $5, 'complete', $6, $7, 'fixture', '{}')`,
			[
				randomUUID(),
				scope.organizationId,
				scope.installationId,
				scope.userId,
				HEAD,
				attempt,
				attempt === 1 ? new Date(0).toISOString() : null,
			],
		);
	const result = await execute(scope.organizationId, defaults);
	expect(result.requests).toBeGreaterThan(0);
	expect(result.hasMore).toBe(false);
});

test("rate-limit responses back off durably rather than busy-looping", async () => {
	const scope = await seed();
	const limited = await execute(scope.organizationId, () =>
		json({ message: "rate limited" }, 429),
	);
	expect(limited.requests).toBe(1);
	expect(limited.hasMore).toBe(true);
	const resumed = await execute(scope.organizationId, defaults);
	expect(resumed.requests).toBe(0);
});

test("initial quota discovery tolerates provider clock skew and scopes pending work", async () => {
	await seed();
	const scope = await seed();
	const result = await execute(scope.organizationId, (url) => {
		const response = defaults(url);
		response.headers.set(
			"x-ratelimit-reset",
			String(NOW.getTime() / 1000 + 3601),
		);
		return response;
	});
	expect(result.requests).toBe(2);
	expect(result.hasMore).toBe(false);
});

test("binding activation enqueues a sweep; disconnect hides but retains all facts", async () => {
	const scope = await seed();
	await execute(scope.organizationId, deletionFixture);
	await expectPopulated(scope.organizationId);
	await persistGitHubRepositoryInstallation({
		database: sqlClient,
		organizationId: scope.organizationId,
		installedByUserId: scope.userId,
		now: new Date(NOW.getTime() + 2 * 86_400_000),
		details: {
			installationId: scope.installationId,
			accountId: "1",
			accountLogin: "fixture",
			accountType: "Organization",
			repositorySelection: "all",
			permissions: {},
		},
		repositories: [
			{
				id: "1",
				nodeId: "node",
				owner: "fixture",
				name: "repo",
				fullName: "fixture/repo",
				defaultBranch: "main",
				isPrivate: true,
			},
		],
	});
	const [pending] = await sqlClient.unsafe<Array<{ count: number }>>(
		`SELECT count(*)::int FROM github_repository_sweep WHERE organization_id = $1 AND status = 'pending'`,
		[scope.organizationId],
	);
	expect(pending?.count).toBeGreaterThan(0);
	await recordGitHubWebhookDelivery({
		database: sqlClient,
		deliveryId: randomUUID(),
		event: "installation",
		action: "deleted",
		intent: {
			kind: "installation",
			installationId: scope.installationId,
			change: "deleted",
		},
		now: () => NOW,
	});
	await expectPopulated(scope.organizationId);
	const [binding] = await sqlClient.unsafe<Array<{ status: string }>>(
		"SELECT status FROM github_repository_binding WHERE organization_id = $1",
		[scope.organizationId],
	);
	expect(binding?.status).toBe("removed");
	await expect(
		persistGitHubRuns(
			scope,
			[sweepRunSchema.parse(run(2))],
			"sweep",
			NOW,
			sqlClient,
		),
	).rejects.toThrow("binding-inactive");
});

test("workspace and sole-member account deletion durably purge stage-1 facts", async () => {
	const organization = await seed();
	await execute(organization.organizationId, deletionFixture);
	await expectPopulated(organization.organizationId);
	await deleteOrganizationPostgresData({
		organizationId: organization.organizationId,
		userId: organization.userId,
	});
	await purgePending();
	await expectEmpty(organization.organizationId);
	const account = await seed();
	await execute(account.organizationId, deletionFixture);
	await expectPopulated(account.organizationId);
	await deleteUserPostgresData(account.userId, { sqlClient });
	await purgePending();
	await expectEmpty(account.organizationId);
});

test("installation concurrency is one across independent worker invocations", async () => {
	const scope = await seed();
	const connection = await sqlClient.reserve();
	const lock = `github-sweep-installation:${scope.installationId}`;
	try {
		await connection.unsafe(
			"SELECT pg_advisory_lock(hashtextextended($1, 0))",
			[lock],
		);
		const yielded = await execute(scope.organizationId, defaults);
		expect(yielded.requests).toBe(0);
		expect(yielded.hasMore).toBe(true);
	} finally {
		await connection.unsafe(
			"SELECT pg_advisory_unlock(hashtextextended($1, 0))",
			[lock],
		);
		connection.release();
	}
	const resumed = await execute(scope.organizationId, defaults);
	expect(resumed.requests).toBeGreaterThan(0);
});

test("daily reconciliation finds re-runs on old commits without refetching unchanged commit maps", async () => {
	const scope = await seed();
	await execute(scope.organizationId, deletionFixture);
	await enqueueGitHubRepositorySweep(
		scope,
		new Date(NOW.getTime() + 2 * 86_400_000),
		sqlClient,
	);
	const paths: string[] = [];
	await execute(scope.organizationId, (url) => {
		paths.push(url.pathname);
		if (url.pathname.endsWith("/actions/runs"))
			return json({
				total_count: 1,
				workflow_runs: [run(1, undefined, { run_attempt: 2 })],
			});
		if (url.pathname.endsWith("/attempts/1")) return json(run(1));
		return deletionFixture(url);
	});
	const [count] = await queryFacts<{ count: number }>(
		`SELECT count() AS count FROM rudel.github_ci_runs FINAL WHERE workspace_id = {workspace:String}`,
		scope.organizationId,
	);
	expect(count?.count).toBe(2);
	expect(paths.some((path) => path.endsWith("/commits"))).toBe(false);
});

test("incremental PRs stop at the previous complete pass start minus one hour", async () => {
	const scope = await seed();
	await execute(scope.organizationId, (url) =>
		url.pathname.endsWith("/pulls")
			? json([pr(1), pr(2), pr(3)])
			: defaults(url),
	);
	const nextPass = new Date(NOW.getTime() + 2 * 86_400_000);
	await enqueueGitHubRepositorySweep(scope, nextPass, sqlClient);
	const cutoff = new Date(NOW.getTime() - 3_600_000);
	const pages: number[] = [];
	const commits: string[] = [];
	await execute(
		scope.organizationId,
		(url) => {
			if (url.pathname.endsWith("/pulls")) {
				expect(url.searchParams.get("state")).toBe("all");
				expect(url.searchParams.get("sort")).toBe("updated");
				expect(url.searchParams.get("direction")).toBe("desc");
				const page = Number(url.searchParams.get("page"));
				pages.push(page);
				return json(
					page === 1
						? [pr(1, { updated_at: nextPass.toISOString() })]
						: [
								pr(2, { updated_at: cutoff.toISOString() }),
								pr(3, {
									updated_at: new Date(cutoff.getTime() - 1000).toISOString(),
								}),
								pr(4, { updated_at: nextPass.toISOString() }),
							],
					200,
					{
						link: `<https://api.github.com/repos/o/r/pulls?page=${page + 1}>; rel="next"`,
						"x-ratelimit-reset": String(nextPass.getTime() / 1000 + 1800),
					},
				);
			}
			if (url.pathname.endsWith("/commits")) commits.push(url.pathname);
			const response = defaults(url);
			response.headers.set(
				"x-ratelimit-reset",
				String(nextPass.getTime() / 1000 + 1800),
			);
			return response;
		},
		sqlClient,
		200,
		nextPass,
	);
	expect(pages).toEqual([1, 2]);
	expect(commits).toEqual([
		"/repos/fixture/repo/pulls/1/commits",
		"/repos/fixture/repo/pulls/2/commits",
	]);
	const [unseen] = await queryFacts<{ count: number }>(
		"SELECT count() AS count FROM rudel.github_pull_requests FINAL WHERE workspace_id = {workspace:String} AND number = 4",
		scope.organizationId,
	);
	expect(unseen?.count).toBe(0);
});

test("prepared Postgres connections persist a JSON object cursor, not a JSON string", async () => {
	const scope = await seed();
	const url = process.env.PG_CONNECTION_STRING;
	if (!url) throw new Error("PG_CONNECTION_STRING is required");
	const prepared = postgres(url);
	try {
		await execute(scope.organizationId, defaults, prepared);
		const [state] = await sqlClient.unsafe<
			Array<{ kind: string; page: number }>
		>(
			"SELECT jsonb_typeof(cursor) AS kind, (cursor->>'page')::int AS page FROM github_repository_sweep WHERE organization_id = $1 AND dataset = 'actions'",
			[scope.organizationId],
		);
		expect(state).toEqual({ kind: "object", page: 2 });
	} finally {
		await prepared.end();
	}
});

test("PR history is two calendar years even with recent or no sessions", async () => {
	const scope = await seed(2, true);
	const [window] = await sqlClient.unsafe<Array<{ window_start: Date }>>(
		"SELECT window_start FROM github_repository_sweep WHERE organization_id = $1 AND dataset = 'pulls'",
		[scope.organizationId],
	);
	expect(new Date(window?.window_start ?? "").toISOString()).toBe(
		"2024-10-01T12:00:00.000Z",
	);
	await sqlClient.unsafe(
		"DELETE FROM session_ownership WHERE organization_id = $1",
		[scope.organizationId],
	);
	await sqlClient.unsafe(
		"DELETE FROM github_repository_sweep WHERE organization_id = $1",
		[scope.organizationId],
	);
	await enqueueGitHubRepositorySweep(scope, NOW, sqlClient);
	const [withoutSessions] = await sqlClient.unsafe<
		Array<{ window_start: Date }>
	>(
		"SELECT window_start FROM github_repository_sweep WHERE organization_id = $1 AND dataset = 'pulls'",
		[scope.organizationId],
	);
	expect(new Date(withoutSessions?.window_start ?? "").toISOString()).toBe(
		"2024-10-01T12:00:00.000Z",
	);
});

test("each acknowledged page precedes its cursor commit; crash replay is idempotent", async () => {
	const scope = await seed();
	const suffix = randomUUID().replaceAll("-", "");
	const startedAt = new Date().toISOString();
	const trigger = `s1_crash_${suffix}`;
	await sqlClient.unsafe(
		`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id = '${scope.organizationId}' AND NEW.dataset = 'actions' THEN RAISE EXCEPTION 'simulated-after-clickhouse-ack'; END IF; RETURN NEW; END $$`,
	);
	await sqlClient.unsafe(
		`CREATE TRIGGER ${trigger} BEFORE UPDATE ON github_repository_sweep FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
	);
	const route: Route = (url) => {
		if (!url.pathname.endsWith("/actions/runs")) return defaults(url);
		const page = Number(url.searchParams.get("page"));
		return json(
			{ total_count: 2, workflow_runs: [run(page)] },
			200,
			page === 1
				? {
						link: '<https://api.github.com/repos/o/r/actions/runs?page=2>; rel="next"',
					}
				: {},
		);
	};
	try {
		await expect(execute(scope.organizationId, route)).rejects.toThrow(
			"simulated-after-clickhouse-ack",
		);
		const [acknowledged] = await queryFacts<{ count: number }>(
			"SELECT count() AS count FROM rudel.github_ci_runs FINAL WHERE workspace_id = {workspace:String}",
			scope.organizationId,
		);
		expect(acknowledged?.count).toBe(1);
		const [progress] = await sqlClient.unsafe<
			Array<{ status: string; cursor: object }>
		>(
			"SELECT status, cursor FROM github_repository_sweep WHERE organization_id = $1 AND dataset = 'actions'",
			[scope.organizationId],
		);
		expect(progress).toEqual({ status: "pending", cursor: {} });
		await getClickhouse().execute({ query: "SYSTEM FLUSH LOGS" });
		const [inserts] = await getClickhouse().query<{
			count: number;
			rows: number;
		}>({
			query:
				"SELECT count() AS count, sum(written_rows) AS rows FROM system.query_log WHERE type = 'QueryFinish' AND query_kind = 'Insert' AND startsWith(query, 'INSERT INTO rudel.github_ci_runs ') AND written_rows = 1 AND event_time_microseconds >= parseDateTime64BestEffort({from:String}, 6, 'UTC')",
			query_params: { from: startedAt },
		});
		expect(Number(inserts?.count)).toBe(1);
		expect(Number(inserts?.rows)).toBe(1);
	} finally {
		await sqlClient.unsafe(
			`DROP TRIGGER ${trigger} ON github_repository_sweep`,
		);
		await sqlClient.unsafe(`DROP FUNCTION ${trigger}()`);
	}
	await execute(scope.organizationId, route);
	const [replayed] = await queryFacts<{ count: number }>(
		"SELECT count() AS count FROM rudel.github_ci_runs FINAL WHERE workspace_id = {workspace:String}",
		scope.organizationId,
	);
	expect(replayed?.count).toBe(2);
});

test("webhook acknowledgement survives a Postgres delivery commit crash and older deliveries lose", async () => {
	const scope = await seed();
	const deliveryId = randomUUID();
	const event = mapGitHubWebhookEvent("pull_request", {
		action: "closed",
		installation: { id: Number(scope.installationId) },
		repository: { id: 1 },
		pull_request: pr(1, {
			updated_at: "2026-10-01T11:00:00Z",
			title: "canonical",
			additions: 0,
		}),
	});
	if (!event) throw new Error("fixture webhook must parse");
	const trigger = `s1_delivery_${randomUUID().replaceAll("-", "")}`;
	await sqlClient.unsafe(
		`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.delivery_id = '${deliveryId}' THEN RAISE EXCEPTION 'simulated-delivery-commit-crash'; END IF; RETURN NEW; END $$`,
	);
	await sqlClient.unsafe(
		`CREATE TRIGGER ${trigger} BEFORE UPDATE ON github_webhook_delivery FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
	);
	const input = {
		database: sqlClient,
		deliveryId,
		event: "pull_request",
		action: event.action,
		intent: event.intent,
		now: () => NOW,
	};
	try {
		await expect(recordGitHubWebhookDelivery(input)).rejects.toThrow(
			"simulated-delivery-commit-crash",
		);
		const [stored] = await queryFacts<{ title: string }>(
			"SELECT title FROM rudel.github_pull_requests FINAL WHERE workspace_id = {workspace:String}",
			scope.organizationId,
		);
		expect(stored?.title).toBe("canonical");
		const rows = await sqlClient.unsafe(
			"SELECT delivery_id FROM github_webhook_delivery WHERE delivery_id = $1",
			[deliveryId],
		);
		expect(rows).toHaveLength(0);
	} finally {
		await sqlClient.unsafe(
			`DROP TRIGGER ${trigger} ON github_webhook_delivery`,
		);
		await sqlClient.unsafe(`DROP FUNCTION ${trigger}()`);
	}
	expect((await recordGitHubWebhookDelivery(input)).status).toBe("recorded");
	expect((await recordGitHubWebhookDelivery(input)).status).toBe("duplicate");
	const older = mapGitHubWebhookEvent("pull_request", {
		action: "opened",
		installation: { id: Number(scope.installationId) },
		repository: { id: 1 },
		pull_request: pr(1, {
			updated_at: "2026-09-30T10:00:00Z",
			title: "older",
			additions: 12,
		}),
	});
	if (!older) throw new Error("older webhook must parse");
	await recordGitHubWebhookDelivery({
		...input,
		deliveryId: randomUUID(),
		intent: older.intent,
	});
	const [stored] = await queryFacts<{ title: string; version: string }>(
		"SELECT title, version FROM rudel.github_pull_requests FINAL WHERE workspace_id = {workspace:String}",
		scope.organizationId,
	);
	expect(stored?.title).toBe("canonical");
	expect(Number(stored?.version)).toBe(Date.parse("2026-10-01T11:00:00Z"));
	const [details] = await queryFacts<{ additions: number }>(
		"SELECT additions FROM rudel.github_pull_request_details FINAL WHERE workspace_id = {workspace:String}",
		scope.organizationId,
	);
	expect(details?.additions).toBe(0);
});

test("retention disappearance preserves every fact and never advances the coverage floor", async () => {
	const scope = await seed(15);
	await execute(scope.organizationId, (url) => {
		if (url.pathname.endsWith("/actions/runs")) {
			const start = Date.parse(
				url.searchParams.get("created")?.split("..")[0] ?? "",
			);
			return start < Date.parse("2026-09-30T00:00:00Z")
				? json({ total_count: 0, workflow_runs: [] })
				: deletionFixture(url);
		}
		return deletionFixture(url);
	});
	await expectPopulated(scope.organizationId);
	const [before] = await sqlClient.unsafe<Array<{ boundary: Date }>>(
		"SELECT min(retention_boundary) AS boundary FROM github_repository_sweep WHERE organization_id = $1 AND dataset = 'actions'",
		[scope.organizationId],
	);
	await enqueueGitHubRepositorySweep(
		scope,
		new Date(NOW.getTime() + 2 * 86_400_000),
		sqlClient,
	);
	await execute(scope.organizationId, (url) =>
		url.pathname.endsWith("/actions/runs")
			? json({ total_count: 0, workflow_runs: [] })
			: defaults(url),
	);
	await expectPopulated(scope.organizationId);
	const [after] = await sqlClient.unsafe<Array<{ boundary: Date }>>(
		"SELECT min(retention_boundary) AS boundary FROM github_repository_sweep WHERE organization_id = $1 AND dataset = 'actions'",
		[scope.organizationId],
	);
	expect(after?.boundary).toEqual(before?.boundary);
});

test("jobs use provider timing versions and commit memberships remain append-only across PRs", async () => {
	const scope = await seed();
	const job = {
		id: "1",
		run_id: "1",
		run_attempt: 2,
		name: "canonical",
		status: "completed",
		conclusion: "failure",
		created_at: "2026-09-30T09:00:00Z",
		started_at: "2026-09-30T10:00:00Z",
		completed_at: "2026-09-30T11:00:00Z",
		labels: [],
	};
	await persistGitHubJobs(scope, [job], NOW, sqlClient);
	await persistGitHubJobs(
		scope,
		[{ ...job, name: "older", completed_at: null }],
		new Date(NOW.getTime() + 1_000),
		sqlClient,
	);
	const [stored] = await queryFacts<{ name: string; version: string }>(
		"SELECT name, version FROM rudel.github_ci_jobs FINAL WHERE workspace_id = {workspace:String}",
		scope.organizationId,
	);
	expect(stored?.name).toBe("canonical");
	expect(Number(stored?.version)).toBe(Date.parse(job.completed_at));
	await persistGitHubCommits(scope, [{ sha: HEAD }], 1, HEAD, NOW, sqlClient);
	await persistGitHubCommits(
		scope,
		[{ sha: "b".repeat(40) }],
		1,
		"c".repeat(40),
		NOW,
		sqlClient,
	);
	await persistGitHubCommits(scope, [{ sha: HEAD }], 2, HEAD, NOW, sqlClient);
	const memberships = await queryFacts<{
		sha: string;
		pr_number: number;
		version: string;
	}>(
		"SELECT sha, pr_number, version FROM rudel.github_pull_request_commits FINAL WHERE workspace_id = {workspace:String}",
		scope.organizationId,
	);
	expect(memberships).toHaveLength(3);
	expect(memberships.filter((item) => item.sha === HEAD)).toHaveLength(2);
	expect(
		memberships.every((item) => Number(item.version) === NOW.getTime()),
	).toBe(true);
	const check = sweepCheckSchema.parse({
		id: 5,
		head_sha: HEAD,
		created_at: "2026-09-30T10:00:00Z",
		updated_at: "2026-09-30T11:00:00Z",
		status: "completed",
		conclusion: "failure",
		pull_requests: [{ number: 2 }],
		app: { id: 1, slug: "external" },
	});
	await persistGitHubChecks(
		scope,
		[check],
		"check_suite",
		"webhook",
		NOW,
		sqlClient,
	);
	await persistGitHubChecks(
		scope,
		[{ ...check, updated_at: "2026-09-30T10:01:00Z", conclusion: "success" }],
		"check_suite",
		"webhook",
		NOW,
		sqlClient,
	);
	const status = sweepStatusSchema.parse({
		id: 6,
		sha: HEAD,
		context: "external",
		state: "failure",
		created_at: "2026-09-30T10:00:00Z",
		updated_at: "2026-09-30T11:00:00Z",
	});
	await persistGitHubStatuses(scope, [status], HEAD, "webhook", NOW, sqlClient);
	await persistGitHubStatuses(
		scope,
		[{ ...status, updated_at: "2026-09-30T10:01:00Z", state: "success" }],
		HEAD,
		"webhook",
		NOW,
		sqlClient,
	);
	const ci = await queryFacts<{ conclusion: string; version: string }>(
		"SELECT conclusion, version FROM rudel.github_ci_runs FINAL WHERE workspace_id = {workspace:String}",
		scope.organizationId,
	);
	expect(ci).toHaveLength(2);
	expect(
		ci.every(
			(item) =>
				item.conclusion === "failure" &&
				Number(item.version) === Date.parse(status.updated_at),
		),
	).toBe(true);
});

test("free text removes controls before filtering reconstructed secrets and capping", async () => {
	const scope = await seed();
	const secret = `ghp_\u0000${"a".repeat(36)}`;
	const controlledSecret = `ghp_\u001F${"b".repeat(36)}`;
	await persistGitHubPullRequests(
		scope,
		[
			sweepPullRequestSchema.parse(
				pr(1, {
					title: `${secret}${"x".repeat(600)}`,
					labels: [{ name: controlledSecret }],
					user: { id: 1, login: secret },
				}),
			),
		],
		"webhook",
		NOW,
		sqlClient,
	);
	const [stored] = await queryFacts<{
		title: string;
		labels: string[];
		author_login: string;
	}>(
		"SELECT title, labels, author_login FROM rudel.github_pull_requests FINAL WHERE workspace_id = {workspace:String}",
		scope.organizationId,
	);
	expect(stored?.title.length).toBe(512);
	for (const value of [
		stored?.title,
		stored?.author_login,
		stored?.labels[0],
	]) {
		expect(value).toBeDefined();
		expect(value).not.toContain("ghp_");
		expect(value).not.toMatch(/\p{Cc}/u);
	}
});

test("queued check-run replay across midnight writes no unstable identities", async () => {
	const scope = await seed();
	const check = sweepCheckSchema.parse({
		id: 99,
		head_sha: HEAD,
		status: "queued",
		conclusion: null,
		completed_at: "2026-09-30T23:59:58Z",
		pull_requests: [{ number: 1 }],
	});
	for (const collectedAt of ["2026-09-30T23:59:59Z", "2026-10-01T00:00:01Z"])
		await persistGitHubChecks(
			scope,
			[check],
			"check_run",
			"webhook",
			new Date(collectedAt),
			sqlClient,
		);
	for (const table of ["github_ci_runs", "github_ci_run_pull_requests"]) {
		const [stored] = await queryFacts<{ count: number }>(
			`SELECT count() AS count FROM rudel.${table} FINAL WHERE workspace_id = {workspace:String}`,
			scope.organizationId,
		);
		expect(stored?.count).toBe(0);
	}
});

test("queued checks persist only when started and keep that identity on completion", async () => {
	const scope = await seed();
	const queued = sweepCheckSchema.parse({
		id: 99,
		head_sha: HEAD,
		status: "queued",
		conclusion: null,
		created_at: "2026-09-29T10:00:00Z",
		pull_requests: [{ number: 1 }],
	});
	await persistGitHubChecks(
		scope,
		[queued],
		"check_run",
		"sweep",
		NOW,
		sqlClient,
	);
	const [absent] = await queryFacts<{ count: number }>(
		"SELECT count() AS count FROM rudel.github_ci_runs FINAL WHERE workspace_id = {workspace:String}",
		scope.organizationId,
	);
	expect(absent?.count).toBe(0);
	const started = {
		...queued,
		status: "in_progress",
		started_at: "2026-09-30T23:59:59Z",
	};
	await persistGitHubChecks(
		scope,
		[started],
		"check_run",
		"sweep",
		NOW,
		sqlClient,
	);
	await persistGitHubChecks(
		scope,
		[
			{
				...started,
				status: "completed",
				conclusion: "success",
				completed_at: "2026-10-01T00:00:01Z",
			},
		],
		"check_run",
		"webhook",
		new Date(NOW.getTime() + 1000),
		sqlClient,
	);
	const runs = await queryFacts<{ created_at: string; status: string }>(
		"SELECT created_at, status FROM rudel.github_ci_runs FINAL WHERE workspace_id = {workspace:String}",
		scope.organizationId,
	);
	expect(runs).toEqual([
		{ created_at: "2026-09-30 23:59:59.000", status: "completed" },
	]);
	const links = await queryFacts<{ run_created_at: string }>(
		"SELECT run_created_at FROM rudel.github_ci_run_pull_requests FINAL WHERE workspace_id = {workspace:String}",
		scope.organizationId,
	);
	expect(links).toEqual([{ run_created_at: "2026-09-30 23:59:59.000" }]);
});

test("a workspace purge tombstone fences every fact writer", async () => {
	const scope = await seed();
	await sqlClient.unsafe(
		"INSERT INTO clickhouse_purge_job (id, target_type, target_id, max_attempts) VALUES ($1, 'organization', $2, 5)",
		[randomUUID(), scope.organizationId],
	);
	await expect(
		persistGitHubPullRequests(
			scope,
			[sweepPullRequestSchema.parse(pr(1))],
			"sweep",
			NOW,
			sqlClient,
		),
	).rejects.toThrow();
	await expect(
		persistGitHubCommits(scope, [{ sha: HEAD }], 1, HEAD, NOW, sqlClient),
	).rejects.toThrow();
	await expect(
		persistGitHubJobs(
			scope,
			[
				{
					id: "1",
					run_id: "1",
					run_attempt: 1,
					name: "test",
					status: "completed",
					conclusion: "failure",
					started_at: null,
					completed_at: null,
					created_at: NOW.toISOString(),
					labels: [],
				},
			],
			NOW,
			sqlClient,
		),
	).rejects.toThrow();
	await expect(
		execute(scope.organizationId, deletionFixture),
	).rejects.toThrow();
	const [progress] = await sqlClient.unsafe<
		Array<{ status: string; cursor: object }>
	>(
		"SELECT status, cursor FROM github_repository_sweep WHERE organization_id = $1 AND dataset = 'actions'",
		[scope.organizationId],
	);
	expect(progress).toEqual({ status: "pending", cursor: {} });
	await expectEmpty(scope.organizationId);
});

async function seed(days = 2, fullHistory = false) {
	const organizationId = `s1-${randomUUID()}`;
	const userId = `s1-${randomUUID()}`;
	const installationId = String(Math.floor(Math.random() * 1_000_000_000) + 1);
	ids.push(organizationId);
	users.push(userId);
	await sqlClient.unsafe(
		"INSERT INTO \"user\" (id, name, email) VALUES ($1, 'Sweep', $2)",
		[userId, `${userId}@example.test`],
	);
	await sqlClient.unsafe(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'Sweep', $1)",
		[organizationId],
	);
	await sqlClient.unsafe(
		"INSERT INTO member (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'owner')",
		[randomUUID(), organizationId, userId],
	);
	await sqlClient.unsafe(
		`INSERT INTO github_app_installation (installation_id, organization_id, account_id, account_login, account_type, repository_selection, permissions) VALUES ($1, $2, '1', 'fixture', 'Organization', 'all', '{}')`,
		[installationId, organizationId],
	);
	await sqlClient.unsafe(
		`INSERT INTO github_repository_binding (organization_id, repository_id, installation_id, node_id, owner, name, full_name, default_branch, is_private) VALUES ($1, '1', $2, 'node', 'fixture', 'repo', 'fixture/repo', 'main', true)`,
		[organizationId, installationId],
	);
	await sqlClient.unsafe(
		`INSERT INTO session_ownership (organization_id, session_id, user_id, last_session_date, last_ingested_at) VALUES ($1, 'session', $2, $3, $3)`,
		[
			organizationId,
			userId,
			new Date(NOW.getTime() - days * 86_400_000).toISOString(),
		],
	);
	const scope = { organizationId, repositoryId: "1", installationId, userId };
	await enqueueGitHubRepositorySweep(scope, NOW, sqlClient);
	if (!fullHistory) {
		await sqlClient.unsafe(
			"DELETE FROM github_repository_sweep WHERE organization_id = $1 AND dataset = 'actions'",
			[organizationId],
		);
		await sqlClient.unsafe(
			`UPDATE github_repository_sweep SET window_start = $2 WHERE organization_id = $1`,
			[
				organizationId,
				new Date(NOW.getTime() - days * 86_400_000).toISOString(),
			],
		);
		for (
			let start = NOW.getTime() - days * 86_400_000;
			start <= NOW.getTime();
			start += 7 * 86_400_000
		)
			await sqlClient.unsafe(
				`INSERT INTO github_repository_sweep (organization_id, repository_id, dataset, window_start, window_end) VALUES ($1, '1', 'actions', $2, $3)`,
				[
					organizationId,
					new Date(start).toISOString(),
					new Date(
						Math.min(NOW.getTime(), start + 7 * 86_400_000 - 1000),
					).toISOString(),
				],
			);
	}
	return scope;
}

async function execute(
	organizationId: string,
	route: Route,
	database = sqlClient,
	maxRequests = 200,
	now = NOW,
) {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) => route(new URL(request.url)),
	});
	const fixtureFetch: typeof globalThis.fetch = Object.assign(
		(input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			return fetch(`${server.url.origin}${url.pathname}${url.search}`, init);
		},
		{ preconnect: fetch.preconnect },
	);
	try {
		return await runGitHubRepositorySweep({
			database,
			config,
			environment: {},
			organizationId,
			fetch: fixtureFetch,
			createToken: async () => "fixture",
			now: () => now,
			budgetMs: 30_000,
			maxRequests,
		});
	} finally {
		await server.stop(true);
	}
}

async function queryFacts<T>(
	query: string,
	organizationId: string,
): Promise<T[]> {
	return getClickhouse().query<T>({
		query,
		query_params: { workspace: organizationId },
	});
}

async function expectEmpty(organizationId: string) {
	await expectFactCounts(organizationId, false);
}
async function expectPopulated(organizationId: string) {
	await expectFactCounts(organizationId, true);
}
async function expectFactCounts(organizationId: string, populated: boolean) {
	for (const table of [
		"github_pull_requests",
		"github_pull_request_details",
		"github_pull_request_commits",
		"github_ci_runs",
		"github_ci_jobs",
		"github_ci_run_pull_requests",
	]) {
		const [row] = await queryFacts<{ count: number }>(
			`SELECT count() AS count FROM rudel.${table} FINAL WHERE workspace_id = {workspace:String}`,
			organizationId,
		);
		if (populated) expect(row?.count).toBeGreaterThan(0);
		else expect(row?.count).toBe(0);
	}
}
async function purgePending() {
	while (
		await runClickHousePurgeWorkerOnce({
			sqlClient,
			now: () => new Date(),
			random: () => 0,
			leaseDurationMs: 60_000,
			executePurge: (target) =>
				target.targetType === "organization"
					? deleteOrgSessions(target.targetId)
					: deleteUserSessions(target.targetId),
		})
	) {}
}

function deletionFixture(url: URL): Response {
	if (url.pathname.endsWith("/actions/runs"))
		return json({
			total_count: 1,
			workflow_runs: [run(1, undefined, { conclusion: "failure" })],
		});
	if (url.pathname.endsWith("/pulls"))
		return json([pr(1, { commits: 1, additions: 0 })]);
	if (url.pathname.endsWith("/commits")) return json([{ sha: HEAD }]);
	if (url.pathname.endsWith("/jobs"))
		return json({
			jobs: [
				{
					id: 1,
					run_id: 1,
					run_attempt: 1,
					name: "test",
					status: "completed",
					conclusion: "failure",
					started_at: "2026-09-30T10:00:00Z",
					completed_at: "2026-09-30T10:01:00Z",
				},
			],
		});
	return defaults(url);
}

function json(
	value: unknown,
	status = 200,
	headers: Record<string, string> = {},
) {
	return Response.json(value, {
		status,
		headers: {
			"x-ratelimit-remaining": "5000",
			"x-ratelimit-reset": String(NOW.getTime() / 1000 + 1800),
			...headers,
		},
	});
}

function defaults(url: URL): Response {
	if (url.pathname.endsWith("/actions/runs"))
		return json({ total_count: 1, workflow_runs: [run(1)] });
	if (url.pathname.endsWith("/check-runs")) return json({ check_runs: [] });
	if (url.pathname.endsWith("/statuses")) return json([]);
	if (url.pathname.endsWith("/jobs")) return json({ jobs: [] });
	if (url.pathname.endsWith("/pulls") || url.pathname.endsWith("/commits"))
		return json([]);
	throw new Error(`Unexpected fixture request: ${url}`);
}

function run(
	id: number,
	created_at = "2026-09-30T10:00:00Z",
	extras: Record<string, unknown> = {},
) {
	return {
		id,
		workflow_id: 1,
		name: "CI",
		head_sha: HEAD,
		event: "push",
		status: "completed",
		conclusion: "success",
		run_attempt: 1,
		created_at,
		updated_at: "2026-09-30T10:01:00Z",
		pull_requests: [],
		head_commit: {
			message: "private commit",
			author: { email: "never@example.test" },
		},
		...extras,
	};
}

function pr(number: number, extras: Record<string, unknown> = {}) {
	return {
		id: number,
		number,
		state: "closed",
		draft: false,
		title: "Merged without any AI session",
		created_at: "2026-09-30T09:00:00Z",
		updated_at: "2026-09-30T10:00:00Z",
		merged_at: "2026-09-30T10:00:00Z",
		closed_at: "2026-09-30T10:00:00Z",
		head: { sha: HEAD, ref: "feature", repo: { id: 9 } },
		base: { ref: "main" },
		labels: [],
		...extras,
	};
}
