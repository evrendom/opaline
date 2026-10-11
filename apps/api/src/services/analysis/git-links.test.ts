import { describe, expect, test } from "bun:test";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import {
	addTurns,
	assembleGitEvents,
	type CiRunRow,
	emptyGitHubFacts,
	evidenceSeeds,
	type GitHubAccess,
	gitHubNeeds,
	githubFullName,
	loadGitHubFacts,
	type PullRequestRow,
	type Resolved,
	resolveRepository,
	type Seed,
} from "./git-links.js";
import type { ScopeBatch } from "./scope.js";
import { PARAM_BYTES_PER_STATEMENT, paramValueBytes } from "./sql.js";

const athena = { repositoryId: "101", fullName: "opalinehq/athena" };
const visible: GitHubAccess = {
	visibility: "visible",
	bindings: [athena, { repositoryId: "202", fullName: "contributor/athena" }],
	repositories: new Map([
		[
			"101",
			{
				included: true,
				prFrom: "2024-10-01",
				ciFrom: "2025-01-01",
				coveredThrough: "2026-10-08T00:00:00Z",
				reason: null,
			},
		],
	]),
};
const sha = "d4e5f6a000000000000000000000000000000001";
const merge = "e0e0e0e000000000000000000000000000000002";

describe("githubFullName", () => {
	test("reads owner/name from remotes, PR repositories and --repo values", () => {
		for (const value of [
			"github.com:opalinehq/athena.git",
			"https://github.com/opalinehq/athena.git",
			"https://x-access-token@github.com/opalinehq/athena",
			"git@github.com:opalinehq/athena.git",
			"ssh://git@github.com/opalinehq/athena.git",
			"github.com/opalinehq/athena",
			"opalinehq/athena",
		])
			expect(githubFullName(value)).toBe("opalinehq/athena");
		expect(githubFullName("gitlab.com/opalinehq/athena")).toBeNull();
		expect(githubFullName("/Users/me/athena")).toBeNull();
		expect(githubFullName("")).toBeNull();
	});
});

describe("repository resolution", () => {
	test("an event's own repository wins and is never replaced by the session's", () => {
		expect(
			resolveRepository(
				seed({ kind: "push_range", remote: "github.com:opalinehq/athena.git" }),
				"github.com/opalinehq/cli",
				visible,
			),
		).toMatchObject({
			repository: { id: "101", basis: "event" },
			github: { status: "linked", prFrom: "2024-10-01", ciFrom: "2025-01-01" },
		});
		expect(
			resolveRepository(
				seed({ kind: "push_range", remote: "github.com:someone/else.git" }),
				"github.com/opalinehq/athena",
				visible,
			),
		).toEqual({
			repository: null,
			github: {
				status: "unbound",
				reason: null,
				prFrom: null,
				ciFrom: null,
				coveredThrough: null,
			},
		});
		expect(
			resolveRepository(
				seed({ kind: "push_range", remote: "gitlab.com:opalinehq/athena.git" }),
				"github.com/opalinehq/athena",
				visible,
			).github.status,
		).toBe("not_github");
	});

	test("the session remote names the repository only when the event names none", () => {
		expect(
			resolveRepository(
				seed({ kind: "commit_created", shortSha: "abc1234" }),
				"github.com/OpalineHQ/athena",
				visible,
			).repository,
		).toMatchObject({ id: "101", basis: "session" });
		expect(
			resolveRepository(
				seed({ kind: "commit_created", shortSha: "abc1234" }),
				"/test/analysis",
				visible,
			).github.status,
		).toBe("no_repository");
	});

	test("hidden GitHub and repositories still being collected are reported, not hidden", () => {
		expect(
			resolveRepository(
				seed({ kind: "push_range", remote: "github.com:opalinehq/athena.git" }),
				"",
				{ visibility: "hidden", bindings: [], repositories: new Map() },
			).github.status,
		).toBe("not_visible");
		expect(
			resolveRepository(
				seed({
					kind: "push_range",
					remote: "github.com:contributor/athena.git",
				}),
				"",
				visible,
			).github,
		).toEqual({
			status: "collecting",
			reason: "not yet in the workspace's GitHub collection",
			prFrom: null,
			ciFrom: null,
			coveredThrough: null,
		});
	});
});

describe("session, pull request and CI links", () => {
	test("a push links its SHA, its branch PR, the PR's CI, merge-commit CI and later checks, keeping every edge", () => {
		const push = seed({
			kind: "push_range",
			record: 10,
			pushFrom: "a1b2c3d",
			pushTo: "d4e5f6a",
			branch: "feat/links",
			sourceBranch: "feat/links",
			remote: "github.com:opalinehq/athena.git",
			turn: 3,
		});
		const resolved = [{ seed: push, ...resolveRepository(push, "", visible) }];
		const needs = gitHubNeeds(resolved);
		expect([...needs.prefixes]).toEqual(["101|d4e5f6a"]);
		expect([...needs.branches]).toEqual(["101|feat/links"]);
		// A push reads its SHA's runs, not its branch's.
		expect(needs.branchRuns.size).toBe(0);

		const facts = emptyGitHubFacts();
		facts.shaCandidates.set("101|d4e5f6a", [sha]);
		facts.memberships.set(`101|${sha}`, [
			{ prNumber: 133, lastSeenHeadSha: "c".repeat(40) },
		]);
		facts.pullRequests.set(
			"101|133",
			pullRequest(133, { merge_commit_sha: merge }),
		);
		facts.branchPullRequests.set("101|feat/links", ["101|133"]);
		facts.shaRuns.set(`101|${sha}`, [
			ciRun({
				run_id: "1",
				conclusion: "failure",
				created_at: "2026-10-07 12:01:00",
			}),
		]);
		facts.pullRequestRuns.set("101|133", [
			ciRun({
				run_id: "1",
				conclusion: "failure",
				pr_number: 133,
				link_basis: "provider",
			}),
			ciRun({
				run_id: "2",
				head_sha: "f".repeat(40),
				conclusion: "success",
				created_at: "2026-10-07 12:30:00",
				pr_number: 133,
				link_basis: "head-sha",
			}),
		]);
		facts.shaRuns.set(`101|${merge}`, [
			ciRun({
				run_id: "3",
				head_sha: merge,
				event: "push",
				head_branch: "main",
				conclusion: "failure",
				created_at: "2026-10-07 13:00:00",
			}),
		]);
		const [event] = assembleGitEvents(
			resolved,
			facts,
			new Map([
				[
					JSON.stringify(["s1", "", 10]),
					{
						count: 1,
						unconfirmed: 1,
						sameCall: 1,
						first: { record: 14, atMs: Date.parse("2026-10-07T12:05:00Z") },
					},
				],
			]),
			new Map(),
			visible,
			new Map([
				[
					"s1",
					[{ shortSha: "d4e5f6a", atMs: Date.parse("2026-10-07T11:50:00Z") }],
				],
			]),
		);
		expect(event).toMatchObject({
			turn: 3,
			sha: { value: sha, candidates: 1, complete: true },
			github: { status: "linked" },
			ciRunCount: 3,
			ciRunCountThrough: "2026-10-08T00:00:00.000Z",
			ciRunCountUnknown: null,
			ciRunsObserved: 3,
			ciConclusions: { failure: 2, success: 1 },
			checksAfter: {
				count: 1,
				unconfirmed: 1,
				sameCall: 1,
				first: { record: 14, at: "2026-10-07T12:05:00.000Z" },
			},
		});
		expect(event?.pullRequests).toMatchObject([
			{
				number: 133,
				bases: ["branch", "commit"],
				commitInHead: false,
				mergeCommitSha: merge,
			},
		]);
		expect(
			event?.ciRuns.map((run) => [
				run.runId,
				run.edges.map((edge) => [edge.basis, edge.linkBasis, edge.prNumber]),
			]),
		).toEqual([
			["3", [["merge_commit", null, 133]]],
			["2", [["pull_request", "head-sha", 133]]],
			[
				"1",
				[
					["pushed_sha", null, null],
					["pull_request", "provider", 133],
				],
			],
		]);
	});

	test("a CI check links the run, commit and branch it names", () => {
		const check = seed({
			kind: "ci_check",
			prRepo: "opalinehq/athena",
			runId: "7001",
			branch: "feat/links",
			commitHash: sha,
		});
		const resolved = [
			{ seed: check, ...resolveRepository(check, "", visible) },
		];
		const needs = gitHubNeeds(resolved);
		expect([...needs.runIds]).toEqual(["101|7001"]);
		expect([...needs.fullShas]).toEqual([`101|${sha}`]);
		expect([...needs.branches]).toEqual(["101|feat/links"]);
		const facts = emptyGitHubFacts();
		facts.namedRuns.set("101|7001", [
			ciRun({ run_id: "7001", attempt: 1 }),
			ciRun({ run_id: "7001", attempt: 2, conclusion: "failure" }),
		]);
		facts.pullRequests.set("101|133", pullRequest(133));
		facts.branchPullRequests.set("101|feat/links", ["101|133"]);
		const [event] = assembleGitEvents(
			resolved,
			facts,
			new Map(),
			new Map(),
			visible,
		);
		expect(
			event?.ciRuns.map((run) => [run.runId, run.attempt, run.edges[0]?.basis]),
		).toEqual([
			["7001", 2, "named_run"],
			["7001", 1, "named_run"],
		]);
		expect(event?.pullRequests.map((pr) => [pr.number, pr.bases])).toEqual([
			[133, ["branch"]],
		]);
	});

	test("a pushed branch matches PRs whose head lives in the pushed repository only", () => {
		const push = seed({
			kind: "push_range",
			pushTo: "d4e5f6a",
			branch: "feature",
			remote: "github.com:opalinehq/athena.git",
		});
		const facts = emptyGitHubFacts();
		facts.pullRequests.set("101|7", pullRequest(7, { head_ref: "feature" }));
		facts.pullRequests.set(
			"101|8",
			pullRequest(8, { head_ref: "feature", head_repository_id: "202" }),
		);
		facts.branchPullRequests.set("101|feature", ["101|7"]);
		facts.branchPullRequests.set("202|feature", ["101|8"]);
		const [event] = assembleGitEvents(
			[{ seed: push, ...resolveRepository(push, "", visible) }],
			facts,
			new Map(),
			new Map(),
			visible,
		);
		expect(event?.pullRequests.map((pr) => pr.number)).toEqual([7]);
	});

	test("unresolved SHAs, new-branch pushes and incomplete collection leave counts unknown, not zero", () => {
		const facts = emptyGitHubFacts();
		facts.shaCandidates.set("101|abc1", ["abc1aaa", "abc1bbb"]);
		const commit = seed({ kind: "commit_created", shortSha: "abc1" });
		const newBranch = seed({
			kind: "push_range",
			branch: "feature",
			remote: "github.com:opalinehq/athena.git",
		});
		const collecting = seed({
			kind: "pr_url",
			prRepo: "contributor/athena",
			prNumber: 4,
		});
		const [ambiguous, unpushed, partial] = assembleGitEvents(
			[commit, newBranch, collecting].map((item) => ({
				seed: item,
				...resolveRepository(item, "github.com/opalinehq/athena", visible),
			})),
			facts,
			new Map(),
			new Map(),
			visible,
		);
		expect(ambiguous).toMatchObject({
			sha: { value: null, candidates: 2, complete: true },
			ciRunCount: null,
			ciRunCountUnknown: "sha_unresolved",
			ciRunsObserved: 0,
			checksAfter: null,
		});
		expect(unpushed).toMatchObject({
			sha: null,
			ciRunCount: null,
			ciRunCountUnknown: "push_without_sha",
		});
		expect(partial).toMatchObject({
			github: { status: "collecting" },
			ciRunCount: null,
			ciRunCountUnknown: "github_status",
		});
		const unbound: Resolved = {
			seed: seed({
				kind: "push_range",
				pushTo: "d4e5f6a",
				remote: "github.com:someone/else.git",
			}),
			repository: null,
			github: {
				status: "unbound",
				reason: null,
				prFrom: null,
				ciFrom: null,
				coveredThrough: null,
			},
		};
		const [unknown] = assembleGitEvents(
			[unbound],
			facts,
			new Map(),
			new Map([["s1", { parentSessionId: "parent" }]]),
			visible,
		);
		expect(unknown).toMatchObject({
			sha: { value: null, candidates: null },
			ciRunCount: null,
			ciRunsObserved: 0,
			pullRequests: [],
			parentSessionId: "parent",
		});
	});

	test("captures and snapshots name their repository and commit directly and keep their origin ids", () => {
		const [capture, snapshot] = evidenceSeeds(
			[
				{
					originId: "collection-1:pr-140",
					sessionId: "s1",
					repositoryId: "101",
					pullNumber: 140,
					commitSha: sha,
					observedAt: "2026-10-07T12:10:00.000Z",
					coverageComplete: true,
					ciCoverageComplete: false,
				},
			],
			[
				{
					originId: "context-1",
					sessionId: "s1",
					agentId: "",
					repositoryId: "101",
					remote: "opalinehq/athena",
					lifecycle: "end",
					baseCommit: "a".repeat(40),
					headCommit: sha,
					capturedAt: "2026-10-07T12:09:00.000Z",
				},
			],
		);
		if (!capture || !snapshot) throw new Error("expected evidence seeds");
		expect([
			capture.call,
			snapshot.call,
			capture.block,
			snapshot.block,
		]).toEqual(["capture:context-1", "snapshot:collection-1:pr-140", 0, 0]);
		const facts = emptyGitHubFacts();
		facts.pullRequests.set("101|140", pullRequest(140));
		facts.shaRuns.set(`101|${sha}`, [ciRun({ run_id: "9" })]);
		const events = assembleGitEvents(
			[capture, snapshot].map((item) => ({
				seed: item,
				...resolveRepository(item, "", visible),
			})),
			facts,
			new Map(),
			new Map(),
			visible,
		);
		expect(
			events.map((event) => [
				event.kind,
				event.label,
				event.repository?.basis,
				event.ciRuns.map((run) => run.runId),
			]),
		).toEqual([
			["evidence_capture", "end", "capture", ["9"]],
			["evidence_snapshot", "coverage=complete ci=partial", "capture", ["9"]],
		]);
		expect(events[1]?.pullRequests).toMatchObject([
			{ number: 140, bases: ["snapshot"] },
		]);
	});
});

describe("CI count completeness", () => {
	const count = (item: Seed, facts = emptyGitHubFacts(), access = visible) =>
		assembleGitEvents(
			[{ seed: item, ...resolveRepository(item, "", access) }],
			facts,
			new Map(),
			new Map(),
			access,
		)[0];

	test("a CI check that names nothing to look up has no count, not zero", () => {
		expect(
			count(seed({ kind: "ci_check", prRepo: "opalinehq/athena" })),
		).toMatchObject({
			ciRunCount: null,
			ciRunCountUnknown: "no_target",
			ciRunsObserved: 0,
		});
	});

	test("a PR or run the event names but GitHub collection lacks is not counted as zero", () => {
		const named = seed({
			kind: "pr_url",
			prRepo: "opalinehq/athena",
			prNumber: 9,
		});
		expect(count(named)).toMatchObject({
			ciRunCount: null,
			ciRunCountUnknown: "target_not_found",
		});
		const facts = emptyGitHubFacts();
		facts.pullRequests.set("101|9", pullRequest(9));
		expect(count(named, facts)).toMatchObject({
			ciRunCount: 0,
			ciRunCountUnknown: null,
		});
		expect(
			count(
				seed({ kind: "ci_check", prRepo: "opalinehq/athena", runId: "77" }),
			),
		).toMatchObject({ ciRunCountUnknown: "target_not_found" });
	});

	test("a SHA's runs are counted only from the commit the session created, up to the coverage boundary", () => {
		const capture = (capturedAt: string) =>
			evidenceSeeds(
				[],
				[
					{
						originId: "context",
						sessionId: "s1",
						agentId: "",
						repositoryId: "101",
						remote: "opalinehq/athena",
						lifecycle: "end",
						baseCommit: "",
						headCommit: sha,
						capturedAt,
					},
				],
			)[0] ?? seed({});
		const created = (at: string) =>
			new Map([["s1", [{ shortSha: "d4e5f6a", atMs: Date.parse(at) }]]]);
		const event = (
			capturedAt: string,
			facts: ReturnType<typeof emptyGitHubFacts>,
			commits = created("2026-10-06T09:00:00Z"),
		) => {
			const item = capture(capturedAt);
			return assembleGitEvents(
				[{ seed: item, ...resolveRepository(item, "", visible) }],
				facts,
				new Map(),
				new Map(),
				visible,
				commits,
			)[0];
		};
		const facts = emptyGitHubFacts();
		facts.shaRuns.set(`101|${sha}`, [
			ciRun({ run_id: "1", created_at: "2026-10-06 20:00:00" }),
			// After the boundary: listed, not counted.
			ciRun({ run_id: "2", created_at: "2026-10-08 01:00:00" }),
			// A rerun attempt of an older run, started after the boundary.
			ciRun({
				run_id: "1",
				attempt: 2,
				created_at: "2026-10-06 20:00:00",
				started_at: "2026-10-08 02:00:00",
			}),
		]);
		expect(event("2026-10-07T00:00:00.000Z", facts)).toMatchObject({
			ciRunsObserved: 3,
			ciRunCount: 1,
			ciRunCountThrough: "2026-10-08T00:00:00.000Z",
			ciRunCountUnknown: null,
		});
		// A recent run does not date an old SHA's earlier CI.
		expect(event("2026-10-07T00:00:00.000Z", facts, new Map())).toMatchObject({
			ciRunCount: null,
			ciRunCountThrough: null,
			ciRunCountUnknown: "target_history_unknown",
		});
		expect(
			event("2026-10-07T00:00:00.000Z", facts, created("2024-12-01T00:00:00Z")),
		).toMatchObject({ ciRunCount: null, ciRunCountUnknown: "before_coverage" });
		expect(event("2026-10-09T00:00:00.000Z", facts)).toMatchObject({
			ciRunCount: null,
			ciRunCountUnknown: "after_coverage",
		});
	});

	test("a recent look at an old PR, or an old SHA in a new PR, has no count", () => {
		const check = seed({
			kind: "ci_check",
			prRepo: "opalinehq/athena",
			prNumber: 12,
		});
		const facts = emptyGitHubFacts();
		facts.pullRequests.set(
			"101|12",
			pullRequest(12, { created_at: "2024-06-01 10:00:00" }),
		);
		expect(count(check, facts)).toMatchObject({
			pullRequests: [{ number: 12 }],
			ciRunCount: null,
			ciRunCountUnknown: "before_coverage",
		});
		const meta = seed({
			kind: "codex_session_meta",
			remote: "github.com:opalinehq/athena.git",
			commitHash: sha,
		});
		const fresh = emptyGitHubFacts();
		fresh.memberships.set(`101|${sha}`, [
			{ prNumber: 20, lastSeenHeadSha: sha },
		]);
		fresh.pullRequests.set(
			"101|20",
			pullRequest(20, { created_at: "2026-10-07 08:00:00", head_sha: sha }),
		);
		expect(count(meta, fresh)).toMatchObject({
			pullRequests: [{ number: 20, bases: ["commit"] }],
			ciRunCount: null,
			ciRunCountUnknown: "target_history_unknown",
		});
		// The session created the commit: no run on it can be older.
		const created = seed({
			kind: "commit_created",
			shortSha: "d4e5f6a",
			remote: "",
		});
		const resolved = emptyGitHubFacts();
		resolved.shaCandidates.set("101|d4e5f6a", [sha]);
		expect(
			assembleGitEvents(
				[
					{
						seed: created,
						...resolveRepository(
							created,
							"github.com/opalinehq/athena",
							visible,
						),
					},
				],
				resolved,
				new Map(),
				new Map(),
				visible,
			)[0],
		).toMatchObject({
			ciRunCount: 0,
			ciRunCountThrough: "2026-10-08T00:00:00.000Z",
			ciRunCountUnknown: null,
		});
	});

	test("a fork push counts its base repository's CI only when the base is fully collected too", () => {
		const fork: GitHubAccess = {
			visibility: "visible",
			bindings: visible.bindings,
			repositories: new Map([
				[
					"202",
					{
						included: true,
						prFrom: "2024-10-01",
						ciFrom: "2025-01-01",
						coveredThrough: "2026-10-08T00:00:00Z",
						reason: null,
					},
				],
				[
					"101",
					{
						included: false,
						prFrom: null,
						ciFrom: null,
						coveredThrough: null,
						reason: "github-403",
					},
				],
			]),
		};
		const push = seed({
			kind: "push_range",
			pushTo: "d4e5f6a",
			branch: "feature",
			remote: "github.com:contributor/athena.git",
		});
		const facts = emptyGitHubFacts();
		facts.shaCandidates.set("202|d4e5f6a", [sha]);
		facts.pullRequests.set(
			"101|8",
			pullRequest(8, { head_ref: "feature", head_repository_id: "202" }),
		);
		facts.branchPullRequests.set("202|feature", ["101|8"]);
		expect(count(push, facts, fork)).toMatchObject({
			github: { status: "linked" },
			pullRequests: [{ number: 8, repositoryId: "101" }],
			ciRunCount: null,
			ciRunCountUnknown: "repository_incomplete",
		});
	});

	test("a CI check that names only a branch lists that branch's runs of the day before it", () => {
		const check = seed({
			kind: "ci_check",
			prRepo: "opalinehq/athena",
			branch: "main",
		});
		const resolved = [
			{ seed: check, ...resolveRepository(check, "", visible) },
		];
		expect([...gitHubNeeds(resolved).branchRuns]).toEqual([
			[
				"101|main",
				{
					fromMs: Date.parse("2026-10-06T12:00:00.000Z"),
					toMs: Date.parse("2026-10-07T12:00:00.000Z"),
				},
			],
		]);
		const facts = emptyGitHubFacts();
		facts.branchRuns.set("101|main", [
			ciRun({ run_id: "after", created_at: "2026-10-07 12:00:01" }),
			ciRun({ run_id: "in", created_at: "2026-10-07 09:00:00" }),
			ciRun({ run_id: "before", created_at: "2026-10-06 11:59:59" }),
		]);
		expect(count(check, facts)).toMatchObject({
			ciRunCount: 1,
			ciRunCountUnknown: null,
			ciRuns: [
				{
					runId: "in",
					edges: [{ basis: "branch", linkBasis: null, prNumber: null }],
				},
			],
		});
		facts.branchRunsCappedAt.set(
			"101|main",
			Date.parse("2026-10-07T09:00:00Z"),
		);
		expect(count(check, facts)).toMatchObject({
			ciRunCount: null,
			ciRunCountUnknown: "search_capped",
		});
	});
});

describe("GitHub lookups", () => {
	test("SHA lookups read all collected history; a checked branch is read in its window with a ceiling", async () => {
		const statements: { query: string; params: Record<string, unknown> }[] = [];
		const executor = {
			query: async (statement: {
				query: string;
				query_params?: Record<string, unknown>;
			}) => {
				statements.push({
					query: statement.query,
					params: statement.query_params ?? {},
				});
				return [];
			},
		} as unknown as ClickHouseExecutor;
		const check = seed({
			kind: "ci_check",
			prRepo: "opalinehq/athena",
			branch: "main",
			commitHash: "abc1234",
		});
		await loadGitHubFacts(
			executor,
			"org",
			gitHubNeeds([{ seed: check, ...resolveRepository(check, "", visible) }]),
			["101", "202"],
		);
		const prefixes = statements.find((statement) =>
			statement.query.includes("SELECT DISTINCT repository_id, sha"),
		);
		expect(prefixes?.query).not.toContain("created_at");
		expect(prefixes?.params.prefixRepoSet).toEqual(["101"]);
		const branch = statements.find((statement) =>
			statement.query.includes("branchNames"),
		);
		expect(branch?.params).toMatchObject({
			branchRepos: ["101"],
			branchNames: ["main"],
			branchFrom: "2026-10-06 12:00:00.000",
			branchTo: "2026-10-07 12:00:00.000",
			branchCap: 2_001,
		});
		expect(branch?.query).toContain("LIMIT {branchCap:UInt32} BY");
	});

	test("every lookup is limited to the workspace's authorized repositories, so a fork PR is found through its base", async () => {
		const statements: { query: string; params: Record<string, unknown> }[] = [];
		const executor = {
			query: async (statement: {
				query: string;
				query_params?: Record<string, unknown>;
			}) => {
				statements.push({
					query: statement.query,
					params: statement.query_params ?? {},
				});
				return [];
			},
		} as unknown as ClickHouseExecutor;
		const push = seed({
			kind: "push_range",
			pushTo: "d4e5f6a",
			branch: "feature",
			remote: "github.com:contributor/athena.git",
		});
		await loadGitHubFacts(
			executor,
			"org",
			gitHubNeeds([{ seed: push, ...resolveRepository(push, "", visible) }]),
			["101", "202"],
		);
		expect(statements.length).toBeGreaterThan(0);
		for (const statement of statements)
			expect(statement.params.repositoryIds).toEqual(["101", "202"]);
		const pullRequests = statements.find((statement) =>
			statement.query.includes("head_repository_id = ''"),
		);
		expect(pullRequests?.params.branchRepos).toEqual(["202"]);
		expect(pullRequests?.query).toContain(
			"if(head_repository_id = '', repository_id, head_repository_id)",
		);
	});
});

describe("addTurns", () => {
	test("reads the turns of many observations in statements within the parameter budget", async () => {
		const sessionId = "019e4604-8fc2-7f12-9ef4-17b136f1125a";
		const seeds = Array.from({ length: 5000 }, (_, record) =>
			seed({ sessionId, agentId: "agent-1", record }),
		);
		const statements: Record<string, unknown>[] = [];
		const executor = {
			query: async (statement: { query_params?: Record<string, unknown> }) => {
				const params = statement.query_params ?? {};
				statements.push(params);
				return (params.keyRecords as number[]).map((record) => ({
					session_id: sessionId,
					agent_id: "agent-1",
					record_idx: record,
					block_idx: 0,
					turn_idx: record + 1,
				}));
			},
		} as unknown as ClickHouseExecutor;
		const batch = {
			scope: { organizationId: "org", userId: "user" },
			generations: [],
			sessions: [{ session_id: sessionId }],
		} as unknown as ScopeBatch;

		await addTurns(executor, [batch], seeds);

		expect(statements.length).toBeGreaterThan(1);
		for (const params of statements) {
			const bytes = Object.values(params)
				.filter(Array.isArray)
				.flat()
				.reduce<number>(
					(sum, value) => sum + paramValueBytes(value as string | number),
					0,
				);
			expect(bytes).toBeLessThanOrEqual(PARAM_BYTES_PER_STATEMENT);
		}
		expect(
			statements.reduce(
				(sum, params) => sum + (params.keyRecords as number[]).length,
				0,
			),
		).toBe(seeds.length);
		expect(seeds.every((entry) => entry.turn === entry.record + 1)).toBe(true);
	});
});

function seed(fields: Partial<Seed>): Seed {
	return {
		sessionId: "s1",
		agentId: "",
		record: 1,
		block: 0,
		call: "call",
		atMs: Date.parse("2026-10-07T12:00:00.000Z"),
		kind: "push_range",
		label: "observed",
		branch: "",
		sourceBranch: "",
		shortSha: "",
		pushFrom: "",
		pushTo: "",
		remote: "",
		prRepo: "",
		prNumber: 0,
		commitHash: "",
		baseCommit: "",
		runId: "",
		generation: {
			revision: "1",
			parserVersion: 773,
			transcriptParserVersion: 5,
			current: true,
		},
		turn: null,
		repositoryId: null,
		...fields,
	};
}

function pullRequest(
	number: number,
	fields: Partial<PullRequestRow> = {},
): PullRequestRow {
	return {
		repository_id: "101",
		number,
		head_repository_id: "101",
		title: `PR ${number}`,
		state: "open",
		draft: false,
		created_at: "2026-10-07 11:00:00",
		merged_at: null,
		closed_at: null,
		head_ref: "feat/links",
		head_sha: "f".repeat(40),
		merge_commit_sha: "",
		...fields,
	};
}

function ciRun(fields: Partial<CiRunRow>): CiRunRow {
	return {
		repository_id: "101",
		kind: "actions_run",
		run_id: "1",
		attempt: 1,
		workflow_name: "CI",
		event: "pull_request",
		head_branch: "feat/links",
		head_sha: sha,
		status: "completed",
		conclusion: "success",
		created_at: "2026-10-07 12:01:00",
		started_at: null,
		completed_at: null,
		pr_number: 0,
		link_basis: "",
		...fields,
	};
}
