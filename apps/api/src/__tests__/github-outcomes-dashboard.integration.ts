import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import assert from "node:assert/strict";
import {
	type CostDashboardInput,
	CostDashboardInputSchema,
	CostDashboardSchema,
} from "@rudel/api-routes";
import { z } from "zod";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import {
	readGitHubOutcomesReadiness,
	refreshPrTotalsReadiness,
} from "../services/github-outcomes-readiness.service.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";
import {
	seedGitHubPull,
	seedGitHubRepository,
	seedGitHubRun,
} from "./helpers/github-outcomes-fixture.js";

setDefaultTimeout(60000);
const run = crypto.randomUUID();
const users: { id: string; token: string }[] = [];
const servers: ApiTestServer[] = [];
let server: ApiTestServer;
const now = new Date();

beforeAll(async () => {
	server = await startApiTestServer({
		GITHUB_EVIDENCE_UI_ENABLED: "true",
		GITHUB_SWEEP_ENABLED: "false",
	});
	servers.push(server);
	for (const name of [
		"outcomes-owner",
		"outcomes-outsider",
		"outcomes-preview",
	]) {
		const response = await fetch(`${server.baseUrl}/api/auth/sign-up/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name,
				email: `${name}-${run}@example.test`,
				password: `test-${run}`,
			}),
		});
		expect(response.status, server.readOutput()).toBe(200);
		const result = z
			.object({ token: z.string(), user: z.object({ id: z.string() }) })
			.parse(await response.json());
		users.push({ id: result.user.id, token: result.token });
	}
	const owner = users[0];
	const outsider = users[1];
	assert(owner && outsider);
	await seedGitHubRepository(owner.id, "201", "opalinehq/athena", {
		ciFrom: "2026-09-01T00:00:00Z",
		now,
	});
	await seedGitHubRepository(outsider.id, "201", "other/athena", {
		ciFrom: "2026-09-01T00:00:00Z",
		now,
	});
	await seedGitHubPull(
		owner.id,
		"201",
		1,
		"2026-09-29T00:00:00Z",
		"2026-09-30T23:59:59Z",
		"linked-author",
		"77",
	);
	await seedGitHubPull(
		owner.id,
		"201",
		2,
		"2026-09-29T00:00:00Z",
		"2026-10-01T00:00:00Z",
		"unlinked-author",
		"78",
	);
	await seedGitHubPull(
		owner.id,
		"201",
		3,
		"2026-07-01T00:00:00Z",
		"2026-09-30T12:00:00Z",
	);
	await seedGitHubPull(owner.id, "201", 4, "2026-09-29T00:00:00Z", null);
	await seedGitHubPull(
		owner.id,
		"201",
		5,
		"2026-09-29T00:00:00Z",
		null,
		"octocat",
		"1",
		"closed",
	);
	await seedGitHubPull(
		outsider.id,
		"201",
		1,
		"2026-09-29T00:00:00Z",
		"2026-09-30T12:00:00Z",
	);
	await seedGitHubRun(owner.id, "201", "a", "2026-09-29T12:00:00Z", {
		conclusion: "failure",
		seconds: 60,
		pullNumber: 1,
		basis: "head-sha",
	});
	await seedGitHubRun(owner.id, "201", "a", "2026-09-29T12:00:00Z", {
		attempt: 2,
		seconds: 180,
		pullNumber: 1,
	});
	await seedGitHubRun(owner.id, "201", "external", "2026-09-29T13:00:00Z", {
		kind: "check_run",
		conclusion: "failure",
		pullNumber: 1,
	});
	await seedGitHubRun(owner.id, "201", "suite", "2026-09-29T13:00:00Z", {
		kind: "check_suite",
		conclusion: "failure",
		pullNumber: 1,
	});
	await seedGitHubRun(owner.id, "201", "pending", "2026-09-29T14:00:00Z", {
		conclusion: null,
		seconds: null,
		workflowId: "2",
		workflowName: "Deploy",
		event: "push",
	});
	await sqlClient.unsafe(
		`INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at) VALUES ($1, '77', 'github', $2, NOW(), NOW())`,
		[crypto.randomUUID(), owner.id],
	);
});

afterAll(async () => {
	for (const endpoint of servers) await endpoint.stop();
	for (const user of users) {
		for (const table of [
			"github_pull_requests",
			"github_ci_runs",
			"github_ci_run_pull_requests",
		])
			await getClickhouse().execute({
				query: `ALTER TABLE rudel.${table} DELETE WHERE workspace_id = {organizationId:String}`,
				query_params: { organizationId: user.id },
				clickhouse_settings: { mutations_sync: "1" },
			});
		await sqlClient.unsafe(`DELETE FROM organization WHERE id = $1`, [user.id]);
		await sqlClient.unsafe(`DELETE FROM "user" WHERE id = $1`, [user.id]);
	}
});

async function dashboard(
	filters: Partial<CostDashboardInput> = {},
	userIndex = 0,
	endpoint = server,
) {
	const user = users[userIndex];
	assert(user);
	const input = CostDashboardInputSchema.parse({
		startDate: "2026-09-29",
		endDate: "2026-10-01",
		requestedMetric: "mergedPullRequests",
		...filters,
	});
	const response = await fetch(
		`${endpoint.baseUrl}/rpc/analytics/overview/costs`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${user.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ json: input }),
		},
	);
	expect(response.status, await response.clone().text()).toBe(200);
	return z.object({ json: CostDashboardSchema }).parse(await response.json())
		.json;
}

test("all merged PRs count without session attribution, tenant isolation and UTC boundaries", async () => {
	const result = await dashboard();
	expect(result.metrics.mergedPullRequests?.total).toBe(3);
	expect(
		result.metrics.mergedPullRequests?.trend.map((point) => point.total),
	).toEqual([0, 2, 1]);
	expect((await dashboard({}, 1)).metrics.mergedPullRequests?.total).toBe(1);
	expect(
		result.metrics.mergedPullRequests?.breakdowns.githubAuthors.find(
			(author) => author.id === "linked-author",
		)?.label,
	).toBe("outcomes-owner");
	expect(
		result.metrics.mergedPullRequests?.breakdowns.githubAuthors.find(
			(author) => author.id === "unlinked-author",
		)?.label,
	).toBe("unlinked-author");
	expect(result.metrics.mergedPullRequests?.cycleTimeStats?.medianSeconds).toBe(
		172800,
	);
});

test("failed attempts, head-SHA links and external checks count; suites, no CI and unavailable do not", async () => {
	const result = await dashboard();
	expect(result.metrics.ciFailuresPerPullRequest?.numerator).toBe(2);
	expect(result.metrics.ciFailuresPerPullRequest?.denominator).toBe(1);
	expect(result.metrics.ciFailuresPerPullRequest?.total).toBe(2);
	expect(
		result.metrics.mergedPullRequests?.githubHistory?.ciUnavailablePullRequests,
	).toBe(1);
	expect(
		result.metrics.mergedPullRequests?.breakdowns.pullRequestCi.map((entry) => [
			entry.id,
			entry.value,
		]),
	).toEqual(
		expect.arrayContaining([
			["failed", 1],
			["noCi", 1],
			["unavailable", 1],
		]),
	);
	const unavailable = await dashboard({ pullRequestCi: ["unavailable"] });
	expect(unavailable.metrics.ciFailuresPerPullRequest?.denominator).toBe(0);
	const split = await dashboard({ splitBy: "pullRequestCi" });
	const failureSeries = split.metrics.ciFailuresPerPullRequest?.series.find(
		(entry) => entry.label === "Had CI failures",
	);
	assert(failureSeries);
	expect(
		split.metrics.ciFailuresPerPullRequest?.trend.find(
			(point) => point.date === "2026-09-30",
		)?.numeratorValues?.[failureSeries.id],
	).toBe(2);
});

test("member/model filters are inactive and split is coerced, repository and GitHub author filters apply", async () => {
	const result = await dashboard({
		members: ["nonmember"],
		models: ["nonmodel"],
		splitBy: "members",
	});
	expect(result.splitBy).toBe("none");
	expect(result.metrics.mergedPullRequests?.total).toBe(3);
	expect(result.metrics.ciFailuresPerPullRequest?.total).toBe(2);
	expect(
		(await dashboard({ repositories: ["missing"] })).metrics.mergedPullRequests
			?.total,
	).toBe(0);
	expect(
		(await dashboard({ githubAuthors: ["linked-author"] })).metrics
			.mergedPullRequests?.total,
	).toBe(1);
});

test.each([
	{ requestedMetric: "ciRuns", splitBy: "ciConclusions" },
	{ requestedMetric: "mergedPullRequests", splitBy: "githubAuthors" },
	{ requestedMetric: "mergedPullRequests", splitBy: "pullRequestCi" },
	{ requestedMetric: "ciRuns", splitBy: "repositories" },
] satisfies Partial<CostDashboardInput>[])("$requestedMetric split by $splitBy preserves every GitHub headline", async (filters) => {
	const result = await dashboard(filters);
	expect(result.metrics.mergedPullRequests?.total).toBe(3);
	expect(result.metrics.ciFailuresPerPullRequest?.total).toBe(2);
	expect(result.metrics.ciFailuresPerPullRequest?.denominator).toBe(1);
	expect(result.metrics.ciRuns?.total).toBe(3);
	expect(result.metrics.ciRuns?.ciMinutes?.total).toBe(4);
	if (filters.splitBy === "ciConclusions") {
		expect(result.metrics.mergedPullRequests?.series).toEqual([
			{ id: "total", label: "Merged PRs" },
		]);
		expect(
			result.metrics.mergedPullRequests?.trend.map((point) => point.total),
		).toEqual([0, 2, 1]);
	} else if (filters.splitBy !== "repositories") {
		expect(result.metrics.ciRuns?.series).toEqual([
			{ id: "total", label: "CI runs" },
		]);
		expect(result.metrics.ciRuns?.trend.map((point) => point.total)).toEqual([
			3, 0, 0,
		]);
	}
});

test("PR CI links include attempts before the requested merge-date range", async () => {
	const result = await dashboard({
		startDate: "2026-09-30",
		endDate: "2026-09-30",
	});
	expect(result.metrics.mergedPullRequests?.total).toBe(2);
	expect(result.metrics.ciFailuresPerPullRequest?.numerator).toBe(2);
	expect(result.metrics.ciFailuresPerPullRequest?.denominator).toBe(1);
	expect(result.metrics.ciRuns?.total).toBe(0);
});

test("split headlines use only their own GitHub filters", async () => {
	const result = await dashboard({
		requestedMetric: "ciRuns",
		splitBy: "ciConclusions",
		ciConclusions: ["failure"],
		githubAuthors: ["linked-author"],
	});
	expect(result.metrics.mergedPullRequests?.total).toBe(1);
	expect(result.metrics.ciFailuresPerPullRequest?.total).toBe(2);
	expect(result.metrics.ciRuns?.total).toBe(1);
	expect(result.metrics.ciRuns?.ciMinutes?.total).toBe(1);
});

test("CI runs use Actions attempts, self-excluding facets, exact percentiles and approximate minutes", async () => {
	const result = await dashboard({
		requestedMetric: "ciRuns",
		splitBy: "ciConclusions",
	});
	expect(result.metrics.ciRuns?.total).toBe(3);
	expect(result.metrics.ciRuns?.durationStats?.sampleCount).toBe(2);
	expect(result.metrics.ciRuns?.durationStats?.medianSeconds).toBe(120);
	expect(result.metrics.ciRuns?.durationStats?.p95Seconds).toBe(174);
	expect(result.metrics.ciRuns?.ciMinutes?.total).toBe(4);
	expect(
		result.metrics.ciRuns?.breakdowns.ciAttempts.find(
			(entry) => entry.id === "rerun",
		)?.value,
	).toBe(1);
	const filtered = await dashboard({
		requestedMetric: "ciRuns",
		ciConclusions: ["failure"],
	});
	expect(filtered.metrics.ciRuns?.total).toBe(1);
	expect(
		filtered.metrics.ciRuns?.breakdowns.ciConclusions.find(
			(entry) => entry.id === "success",
		)?.value,
	).toBe(1);
	expect(
		filtered.metrics.ciRuns?.breakdowns.ciEvents.find(
			(entry) => entry.id === "push",
		)?.value ?? 0,
	).toBe(0);
	const workflow = await dashboard({
		requestedMetric: "ciRuns",
		ciWorkflows: ["2"],
	});
	expect(workflow.metrics.ciRuns?.total).toBe(1);
	expect(
		workflow.metrics.ciRuns?.breakdowns.ciWorkflows.find(
			(entry) => entry.id === "1",
		)?.approximateMinutes,
	).toBe(4);
});

test("pending external coverage never turns missing CI into success or zero", async () => {
	const owner = users[0];
	assert(owner);
	await sqlClient.unsafe(
		`UPDATE github_repository_sweep SET status = 'pending' WHERE organization_id = $1 AND repository_id = '201' AND dataset = 'external'`,
		[owner.id],
	);
	await refreshPrTotalsReadiness(sqlClient, owner.id, now);
	const result = await dashboard({ repositories: ["201"] });
	expect(result.metrics.mergedPullRequests?.total).toBe(0);
	expect(
		result.metrics.mergedPullRequests?.githubHistory?.syncingRepositories,
	).toBe(1);
	expect(result.metrics.ciFailuresPerPullRequest?.denominator).toBe(0);
	await sqlClient.unsafe(
		`UPDATE github_repository_sweep SET status = 'complete' WHERE organization_id = $1 AND repository_id = '201' AND dataset = 'external'`,
		[owner.id],
	);
	await refreshPrTotalsReadiness(sqlClient, owner.id, now);
});

test("two years of repository history are accepted independent of sessions", async () => {
	const result = await dashboard({
		startDate: "2024-10-01",
		endDate: "2026-10-01",
	});
	expect(result.metrics.mergedPullRequests?.total).toBe(3);
	expect(
		result.metrics.mergedPullRequests?.githubHistory?.pullRequestsFrom,
	).toBe("2024-10-01");
});

test("complete repositories with no Actions are no CI, never unavailable or passing", async () => {
	const owner = users[0];
	assert(owner);
	await seedGitHubRepository(owner.id, "202", "opalinehq/no-actions", {
		ciFrom: null,
	});
	await seedGitHubPull(
		owner.id,
		"202",
		1,
		"2026-09-01T00:00:00Z",
		"2026-09-30T00:00:00Z",
	);
	const result = await dashboard({ repositories: ["202"] });
	expect(result.metrics.mergedPullRequests?.total).toBe(1);
	expect(
		result.metrics.mergedPullRequests?.breakdowns.pullRequestCi.find(
			(entry) => entry.id === "noCi",
		)?.value,
	).toBe(1);
	expect(
		result.metrics.mergedPullRequests?.githubHistory?.ciUnavailablePullRequests,
	).toBe(0);
	expect(result.metrics.ciFailuresPerPullRequest?.denominator).toBe(0);
	expect(result.metrics.ciRuns?.total).toBe(0);
	expect(result.metrics.ciRuns?.ciMinutes?.total).toBe(0);
	expect(result.metrics.ciRuns?.githubHistory?.ciFrom).toBe("2024-10-01");
});

test("runs are counted for repositories whose CI floor falls back to the PR floor", async () => {
	const owner = users[0];
	assert(owner);
	await seedGitHubRepository(owner.id, "205", "opalinehq/fallback-floor", {
		ciFrom: null,
	});
	await seedGitHubRun(owner.id, "205", "fallback-run", "2026-09-30T12:00:00Z", {
		conclusion: "success",
		seconds: 60,
	});
	const result = await dashboard({
		repositories: ["205"],
		requestedMetric: "ciRuns",
	});
	expect(result.metrics.ciRuns?.total).toBe(1);
	expect(result.metrics.ciRuns?.githubHistory?.ciFrom).toBe("2024-10-01");
});

test("removed, syncing and inaccessible bindings are excluded and readiness is sticky", async () => {
	const owner = users[0];
	assert(owner);
	await seedGitHubRepository(owner.id, "203", "opalinehq/syncing", {
		status: "pending",
	});
	await seedGitHubRepository(owner.id, "204", "opalinehq/forbidden", {
		status: "unavailable",
		error: "github-403",
	});
	const result = await dashboard({ repositories: ["201"] });
	expect(result.metrics.mergedPullRequests?.total).toBe(3);
	expect(
		result.metrics.mergedPullRequests?.githubHistory?.syncingRepositories,
	).toBe(1);
	expect(
		result.metrics.mergedPullRequests?.githubHistory?.unavailableRepositories,
	).toBe(1);
	expect(
		(await readGitHubOutcomesReadiness(sqlClient, owner.id))?.firstReadyAt,
	).not.toBeNull();
	await sqlClient.unsafe(
		`UPDATE github_repository_binding SET status = 'removed' WHERE organization_id = $1 AND repository_id = '202'`,
		[owner.id],
	);
	await refreshPrTotalsReadiness(sqlClient, owner.id);
	expect(
		(await dashboard({ repositories: ["202"] })).metrics.mergedPullRequests
			?.total,
	).toBe(0);
});

test("split coverage is ready; a gap and stale reconciliation exclude the repo without clearing first_ready_at", async () => {
	const outsider = users[1];
	assert(outsider);
	await sqlClient.unsafe(
		`DELETE FROM github_repository_sweep WHERE organization_id = $1 AND dataset = 'actions'`,
		[outsider.id],
	);
	for (const [start, end] of [
		["2026-09-01T00:00:00Z", "2026-09-14T23:59:59Z"],
		["2026-09-15T00:00:00Z", new Date(now.getTime() - 1000).toISOString()],
	])
		await sqlClient.unsafe(
			`INSERT INTO github_repository_sweep (organization_id, repository_id, dataset, window_start, window_end, status, retention_boundary, completed_at) VALUES ($1, '201', 'actions', $2, $3, 'complete', '2026-09-01T00:00:00Z', $4)`,
			[outsider.id, start ?? "", end ?? "", now.toISOString()],
		);
	await refreshPrTotalsReadiness(sqlClient, outsider.id, now);
	expect(
		(await readGitHubOutcomesReadiness(sqlClient, outsider.id))?.status,
	).toBe("ready");
	await sqlClient.unsafe(
		`UPDATE github_repository_sweep SET window_start = window_start + interval '1 second' WHERE organization_id = $1 AND dataset = 'actions' AND window_start = '2026-09-15T00:00:00Z'`,
		[outsider.id],
	);
	await refreshPrTotalsReadiness(sqlClient, outsider.id, now);
	expect(
		(await readGitHubOutcomesReadiness(sqlClient, outsider.id))?.status,
	).toBe("not_ready");
	expect(
		(await readGitHubOutcomesReadiness(sqlClient, outsider.id))?.firstReadyAt,
	).not.toBeNull();
	await refreshPrTotalsReadiness(
		sqlClient,
		outsider.id,
		new Date(now.getTime() + 49 * 3600000),
	);
	expect(
		(await readGitHubOutcomesReadiness(sqlClient, outsider.id))?.firstReadyAt,
	).not.toBeNull();
});

test("forced preview and global kill switch; disconnect clears sticky readiness", async () => {
	const preview = users[2];
	const outsider = users[1];
	assert(preview && outsider);
	await seedGitHubRepository(preview.id, "301", "opalinehq/preview", {
		status: "pending",
	});
	expect(
		(await dashboard({ requestedMetric: "ciRuns" }, 2)).requestedMetric,
	).toBe("cost");
	const forced = await startApiTestServer({
		GITHUB_EVIDENCE_UI_ENABLED: "true",
		GITHUB_SWEEP_ENABLED: "false",
		GITHUB_EVIDENCE_UI_FORCE_ORG_IDS: ` ${preview.id}, ${preview.id} `,
	});
	servers.push(forced);
	const pending = (await dashboard({ requestedMetric: "ciRuns" }, 2, forced))
		.metrics.ciRuns;
	expect(pending?.githubHistory?.preview).toBe(true);
	expect(pending?.githubHistory?.ciFrom).toBeNull();
	expect(pending?.githubHistory?.syncingRepositories).toBe(1);
	const disabled = await startApiTestServer({
		GITHUB_EVIDENCE_UI_ENABLED: "false",
		GITHUB_EVIDENCE_UI_FORCE_ORG_IDS: preview.id,
	});
	servers.push(disabled);
	const result = await dashboard({ requestedMetric: "ciRuns" }, 2, disabled);
	expect(result.requestedMetric).toBe("cost");
	expect(result.availableMetrics).not.toContain("ciRuns");
	await sqlClient.unsafe(
		`UPDATE github_app_installation SET status = 'deleted' WHERE organization_id = $1`,
		[outsider.id],
	);
	await refreshPrTotalsReadiness(sqlClient, outsider.id);
	expect(
		(await readGitHubOutcomesReadiness(sqlClient, outsider.id))?.firstReadyAt,
	).toBeNull();
	expect(
		(await dashboard({ requestedMetric: "ciRuns" }, 1)).requestedMetric,
	).toBe("cost");
});
