import { describe, expect, test } from "bun:test";
import {
	AnalysisFindInputSchema,
	type AnalysisGitEvent,
} from "@rudel/api-routes";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import {
	deriveSessionEdges,
	L1_EDGE_RESOLVER_VERSION,
} from "../l1-edges/l1-edge-derivation.js";
import {
	ciRunNodeId,
	commitNodeId,
	pullRequestNodeId,
	sessionScopeId,
	splitL1NodeId,
} from "../l1-edges/l1-edge-ids.js";
import { findAnalysis } from "./find.service.js";
import {
	type EdgeScopeState,
	type EdgeStateSource,
	edgeLinker,
	intersectCoverage,
	loadPullRequestTouches,
	PULL_REQUEST_EDGE_CAP,
	type PullRequestTouch,
	pullRequestNotes,
	runCreatedMs,
	selectWitnesses,
	sessionEdgeStatus,
	settledForReverse,
	shadowDifferences,
	touchEvidence,
	touchWitnesses,
} from "./git-edge-links.js";
import {
	assembleGitEvents,
	type ChecksAfter,
	type CiRunRow,
	emptyGitHubFacts,
	evidenceSeeds,
	type GitHubAccess,
	type GitHubFacts,
	linkAtQueryTime,
	type PageToLink,
	type PullRequestRow,
	queryObservations,
	type RepositoryCoverage,
	resolveRepository,
	type Seed,
	type SessionCommit,
} from "./git-links.js";
import type { AnalysisSession } from "./scope.js";

const organizationId = "org";
const session = { userId: "u1", source: "claude_code", sessionId: "s1" };
const sessionRemote = "github.com/opalinehq/athena";
const sha = "d4e5f6a000000000000000000000000000000001";
const merge = "e0e0e0e000000000000000000000000000000002";
const athena = "github.com:opalinehq/athena.git";
const generation = {
	revision: "1",
	parserVersion: 773,
	transcriptParserVersion: 5,
	current: true,
};
const transcript = { sessionId: "s1", revision: "9", parserVersion: 5 };
const collected: RepositoryCoverage = {
	included: true,
	prFrom: "2024-10-01",
	ciFrom: "2025-01-01",
	coveredThrough: "2026-10-08T00:00:00Z",
	reason: null,
};
const visible: GitHubAccess = {
	visibility: "visible",
	bindings: [
		{ repositoryId: "101", fullName: "opalinehq/athena" },
		{ repositoryId: "202", fullName: "contributor/athena" },
	],
	repositories: new Map([["101", collected]]),
};
const analysisSession: AnalysisSession = {
	session_id: "s1",
	user_id: "u1",
	source: "claude_code",
	model: "",
	repository: sessionRemote,
	parentSessionId: null,
	rootSessionId: "s1",
	depth: 0,
};

interface World {
	/** The page's events (as find reads them). */
	seeds: Seed[];
	facts: GitHubFacts;
	/** The live access find reads; the worker's sees the same bindings. */
	access?: GitHubAccess;
	/** The access the worker built with (default: the live one, visible). */
	builtWith?: GitHubAccess;
	/** The session evidence the worker read (default: the page's events). */
	built?: Seed[];
	checks?: Map<string, ChecksAfter>;
	session?: Partial<EdgeScopeState> | null;
	repositories?: Map<string, EdgeScopeState>;
	/** Changes the stored rows (other revisions, older details). */
	edit?: (store: { edges: Row[]; resolutions: Row[] }) => void;
	/** Statements containing this fail, with a message that must never be logged. */
	failOn?: string;
}

/**
 * A page and the stores behind it: session edges and resolutions as the
 * worker derives them, GitHub-side edges projected from the same facts, the
 * current PR and CI rows, and the build records. ClickHouse statements are
 * answered from these stores by what their parameters ask for.
 */
function harness(world: World) {
	const access = world.access ?? visible;
	const builtWith = world.builtWith ?? { ...access, visibility: "visible" };
	const built = world.built ?? world.seeds;
	const derived = deriveSessionEdges({
		session,
		resolved: built.map((seed) => ({
			seed,
			...resolveRepository(seed, sessionRemote, builtWith),
		})),
		facts: world.facts,
		runStarts: new Map([["|3", 40]]),
	});
	const owner = {
		organization_id: organizationId,
		user_id: session.userId,
		source: session.source,
		session_id: session.sessionId,
	};
	// Session rows at the completed build's revision (7), GitHub ones at 3.
	const edges: Row[] = [
		...derived.edges.map((edge) => ({
			...owner,
			...edge,
			is_active: 1,
			revision: 7,
		})),
		...gitHubEdges(world.facts),
	];
	const resolutions: Row[] = derived.resolutions.map((row) => ({
		...owner,
		...row,
		is_active: 1,
		revision: 7,
	}));
	world.edit?.({ edges, resolutions });
	const coverageOf = (repositoryId: string) => {
		const entry = builtWith.repositories.get(repositoryId);
		return {
			included: entry?.included ?? false,
			prFrom: entry?.prFrom ?? null,
			ciFrom: entry?.ciFrom ?? null,
			coveredThrough: entry?.coveredThrough ?? null,
		};
	};
	const touched = new Set([
		...derived.repositoryKeys.filter((id) => !id.startsWith("name:")),
		...derived.edges
			.filter((edge) => edge.to_kind !== "commit")
			.map((edge) => splitL1NodeId(edge.to_id)[0] ?? ""),
	]);
	const sessionState: EdgeScopeState | undefined =
		world.session === null
			? undefined
			: {
					builtRevision: 7,
					resolverVersion: L1_EDGE_RESOLVER_VERSION,
					input: {
						transcript: {
							revision: transcript.revision,
							parserVersion: transcript.parserVersion,
						},
						generation,
						truncated: false,
					},
					coverage: Object.fromEntries(
						[...touched].map((id) => [id, coverageOf(id)]),
					),
					frozenReason: null,
					builtAt: "2026-10-07T13:00:00.000Z",
					rebuilding: false,
					...world.session,
				};
	const repositories =
		world.repositories ??
		new Map(
			builtWith.bindings.map(({ repositoryId }) => [
				repositoryId,
				{
					builtRevision: 3,
					resolverVersion: L1_EDGE_RESOLVER_VERSION,
					input: {},
					coverage: {
						[repositoryId]: {
							...coverageOf(repositoryId),
							readAt: "2026-10-08T00:00:00.000Z",
						},
					},
					frozenReason: null,
					builtAt: "2026-10-08T00:00:00.000Z",
					rebuilding: false,
				},
			]),
		);
	const state: EdgeStateSource = {
		scopes: async (_organization, kind, ids) =>
			new Map(
				ids.flatMap((id) => {
					const found =
						kind === "session"
							? id === sessionScopeId(session)
								? sessionState
								: undefined
							: repositories.get(id);
					return found ? [[id, found] as const] : [];
				}),
			),
	};
	const statements: string[] = [];
	const executor = fakeClickHouse(
		{
			edges,
			resolutions,
			pullRequests: [...world.facts.pullRequests.values()],
			runs: allRuns(world.facts),
		},
		statements,
		world.failOn,
	);
	const page: PageToLink = {
		executor,
		organizationId,
		batches: [
			{
				scope: { organizationId, userId: session.userId },
				generations: [transcript],
				sessions: [analysisSession],
			},
		],
		sessions: new Map([["s1", analysisSession]]),
		generations: new Map([["s1", generation]]),
		access,
		seeds: world.seeds,
		checks: world.checks ?? new Map(),
	};
	const atQuery = () =>
		assembleGitEvents(
			world.seeds.map((seed) => ({
				seed,
				...resolveRepository(seed, sessionRemote, access),
			})),
			world.facts,
			page.checks,
			page.sessions,
			access,
			new Map([
				[
					"s1",
					built
						.filter((seed) => seed.kind === "commit_created")
						.map(
							(seed): SessionCommit => ({
								shortSha: seed.shortSha,
								atMs: seed.atMs,
							}),
						),
				],
			]),
		);
	return {
		statements,
		atQuery,
		queryTime: () => linkAtQueryTime(page),
		fromEdges: async (
			shadow: {
				rate: number;
				random: () => number;
				onShadow?: (comparison: Promise<void>) => void;
				executor?: ClickHouseExecutor;
			} = {
				rate: 0,
				random: Math.random,
			},
		) =>
			(
				await edgeLinker({
					state,
					shadowRate: shadow.rate,
					random: shadow.random,
					onShadow: shadow.onShadow,
					shadowExecutor: shadow.executor,
				})(page)
			).events,
	};
}

const withoutEdges = (events: readonly AnalysisGitEvent[]) =>
	events.map(({ edges: _edges, ...event }) => event);

describe("links from edges", () => {
	test("a push links exactly as at query time: SHA, branch PR, membership, PR CI and a merged PR's merge-commit CI", async () => {
		const facts = pushFacts({
			merged_at: "2026-10-07 14:00:00",
			state: "closed",
		});
		const world = harness({
			seeds: [commitSeed(), pushSeed()],
			facts,
			checks: new Map([
				[
					JSON.stringify(["s1", "", 10]),
					{
						count: 1,
						unconfirmed: 0,
						sameCall: 0,
						first: { record: 14, atMs: Date.parse("2026-10-07T12:05:00Z") },
					},
				],
			]),
		});
		const events = await world.fromEdges();
		expect(withoutEdges(events)).toEqual(withoutEdges(world.atQuery()));
		expect(events.map((event) => event.edges)).toEqual([
			{
				linkedBy: "edges",
				status: "current",
				builtAt: "2026-10-07T13:00:00.000Z",
			},
			{
				linkedBy: "edges",
				status: "current",
				builtAt: "2026-10-07T13:00:00.000Z",
			},
		]);
		const [, push] = events;
		expect(push).toMatchObject({
			sha: { value: sha, candidates: 1, complete: true },
			ciRunCount: 3,
			ciRunCountThrough: "2026-10-08T00:00:00.000Z",
			pullRequests: [{ number: 133, bases: ["branch", "commit"] }],
		});
		expect(
			push?.ciRuns.map((run) => [
				run.runId,
				run.edges.map((edge) => edge.basis),
			]),
		).toEqual([
			["3", ["merge_commit"]],
			["2", ["pull_request"]],
			["1", ["pushed_sha", "pull_request"]],
		]);
		// No statement reads the GitHub tables the query-time path resolves from.
		expect(
			world.statements.some((statement) =>
				statement.includes("github_pull_request_commits"),
			),
		).toBe(false);
	});

	test("an open PR's test merge commit is not followed: the one expected difference of a push", async () => {
		const world = harness({
			seeds: [commitSeed(), pushSeed()],
			facts: pushFacts(),
		});
		const [, push] = await world.fromEdges();
		const [, queried] = world.atQuery();
		if (!push || !queried) throw new Error("expected events");
		expect(push.ciRuns.map((run) => run.runId)).toEqual(["2", "1"]);
		expect(queried.ciRuns.map((run) => run.runId)).toEqual(["3", "2", "1"]);
		expect(shadowDifferences(push, queried)).toEqual([
			"expected:open_pr_merge_commit",
		]);
	});

	test("a CI check links the run attempts, commit and branch it names", async () => {
		const facts = emptyGitHubFacts();
		facts.namedRuns.set("101|7001", [
			ciRun({ run_id: "7001", attempt: 1 }),
			ciRun({ run_id: "7001", attempt: 2, conclusion: "failure" }),
		]);
		facts.pullRequests.set("101|133", pullRequest(133));
		facts.branchPullRequests.set("101|feat/links", ["101|133"]);
		const world = harness({
			seeds: [
				seed({
					kind: "ci_check",
					prRepo: "opalinehq/athena",
					runId: "7001",
					branch: "feat/links",
					commitHash: sha,
					turn: 3,
				}),
			],
			facts,
		});
		const events = await world.fromEdges();
		expect(withoutEdges(events)).toEqual(withoutEdges(world.atQuery()));
		expect(
			events[0]?.ciRuns.map((run) => [
				run.runId,
				run.attempt,
				run.edges[0]?.basis,
			]),
		).toEqual([
			["7001", 2, "named_run"],
			["7001", 1, "named_run"],
		]);
	});

	test("a named run whose edge does not record its creation (older rules) is looked up by id, never by the check's date", async () => {
		const facts = emptyGitHubFacts();
		facts.namedRuns.set("101|7001", [
			// Months before the check that names it.
			ciRun({ run_id: "7001", created_at: "2026-05-01 09:00:00" }),
		]);
		const world = harness({
			seeds: [
				seed({
					kind: "ci_check",
					prRepo: "opalinehq/athena",
					runId: "7001",
					turn: 3,
				}),
			],
			facts,
			edit: (store) => {
				for (const row of store.edges)
					if (row.relation === "ci_named") row.details = "{}";
			},
		});
		const events = await world.fromEdges();
		expect(withoutEdges(events)).toEqual(withoutEdges(world.atQuery()));
		expect(events[0]?.ciRuns.map((run) => run.runId)).toEqual(["7001"]);
		const runReads = world.statements.filter((sql) =>
			sql.includes("rudel.github_ci_runs"),
		);
		expect(runReads).toHaveLength(1);
		expect(runReads[0]).not.toContain("created_at >=");
		expect(
			runCreatedMs({
				relation: "ci_named",
				details: "{}",
				observed_text: "2026-10-07 12:00:00.000",
			}),
		).toBeNull();
		expect(
			runCreatedMs({
				relation: "ci_on_sha",
				details: "{}",
				observed_text: "2026-05-01 09:00:00",
			}),
		).toBe(Date.parse("2026-05-01T09:00:00Z"));
	});

	test("unresolved SHAs, new-branch pushes, collecting and unbound repositories stay unknown, as at query time", async () => {
		const facts = emptyGitHubFacts();
		facts.shaCandidates.set("101|abc1234", [
			`abc1234${"a".repeat(33)}`,
			`abc1234${"b".repeat(33)}`,
		]);
		const world = harness({
			seeds: [
				seed({ kind: "commit_created", shortSha: "abc1234", record: 2 }),
				seed({
					kind: "push_range",
					branch: "feature",
					remote: athena,
					record: 3,
				}),
				seed({
					kind: "pr_url",
					prRepo: "contributor/athena",
					prNumber: 4,
					record: 4,
				}),
				seed({
					kind: "push_range",
					pushTo: "d4e5f6a",
					remote: "github.com:someone/else.git",
					record: 5,
				}),
			],
			facts,
		});
		const events = await world.fromEdges();
		expect(withoutEdges(events)).toEqual(withoutEdges(world.atQuery()));
		expect(
			events.map((event) => [
				event.edges?.linkedBy,
				event.github.status,
				event.sha?.candidates ?? null,
				event.ciRunCountUnknown,
			]),
		).toEqual([
			["edges", "linked", 2, "sha_unresolved"],
			["edges", "linked", null, "push_without_sha"],
			["edges", "collecting", null, "github_status"],
			["edges", "unbound", null, "github_status"],
		]);
	});

	test("captures and snapshots follow their own commit; a capture's base commit links nothing", async () => {
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
					baseCommit: merge,
					headCommit: sha,
					capturedAt: "2026-10-07T12:09:00.000Z",
				},
			],
		);
		if (!capture || !snapshot) throw new Error("expected evidence seeds");
		const facts = emptyGitHubFacts();
		facts.pullRequests.set("101|140", pullRequest(140));
		facts.shaRuns.set(`101|${sha}`, [ciRun({ run_id: "9" })]);
		facts.shaRuns.set(`101|${merge}`, [
			ciRun({ run_id: "10", head_sha: merge }),
		]);
		const world = harness({ seeds: [capture, snapshot], facts });
		const events = await world.fromEdges();
		expect(withoutEdges(events)).toEqual(withoutEdges(world.atQuery()));
		expect(
			events.map((event) => [
				event.kind,
				event.edges?.linkedBy,
				event.ciRuns.map((run) => run.runId),
				event.pullRequests.map((pr) => pr.bases),
			]),
		).toEqual([
			["evidence_capture", "edges", ["9"], []],
			["evidence_snapshot", "edges", ["9"], [["snapshot"]]],
		]);
	});

	test("a branch check whose search was capped has no count, as at query time", async () => {
		const facts = emptyGitHubFacts();
		facts.branchRuns.set("101|main", [
			ciRun({ run_id: "in", created_at: "2026-10-07 09:00:00" }),
		]);
		facts.branchRunsCappedAt.set(
			"101|main",
			Date.parse("2026-10-07T09:00:00Z"),
		);
		const world = harness({
			seeds: [
				seed({ kind: "ci_check", prRepo: "opalinehq/athena", branch: "main" }),
			],
			facts,
		});
		const events = await world.fromEdges();
		expect(withoutEdges(events)).toEqual(withoutEdges(world.atQuery()));
		expect(events[0]).toMatchObject({
			ciRunsObserved: 1,
			ciRunCount: null,
			ciRunCountUnknown: "search_capped",
		});
	});

	test("a fork push counts its base repository's CI only when the base is fully collected too", async () => {
		const fork: GitHubAccess = {
			visibility: "visible",
			bindings: visible.bindings,
			repositories: new Map([
				["202", collected],
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
		const facts = emptyGitHubFacts();
		facts.shaCandidates.set("202|d4e5f6a", [sha]);
		facts.pullRequests.set(
			"101|8",
			pullRequest(8, { head_ref: "feature", head_repository_id: "202" }),
		);
		facts.branchPullRequests.set("202|feature", ["101|8"]);
		const world = harness({
			seeds: [
				seed({
					kind: "push_range",
					pushTo: "d4e5f6a",
					branch: "feature",
					remote: "github.com:contributor/athena.git",
				}),
			],
			facts,
			access: fork,
		});
		const events = await world.fromEdges();
		expect(withoutEdges(events)).toEqual(withoutEdges(world.atQuery()));
		expect(events[0]).toMatchObject({
			pullRequests: [{ number: 8, repositoryId: "101" }],
			ciRunCountUnknown: "repository_incomplete",
			edges: { linkedBy: "edges" },
		});
	});

	test("counts stop at the coverage the edges were built against; later runs are listed, not counted", async () => {
		const facts = pushFacts();
		const earlier: GitHubAccess = {
			...visible,
			repositories: new Map([
				["101", { ...collected, coveredThrough: "2026-10-07T12:20:00Z" }],
			]),
		};
		const world = harness({
			seeds: [commitSeed(), pushSeed()],
			facts,
			builtWith: earlier,
		});
		const [, push] = await world.fromEdges();
		expect(push).toMatchObject({
			// The live coverage is shown; the count's boundary is the earlier one.
			github: { coveredThrough: "2026-10-08T00:00:00Z" },
			ciRunsObserved: 2,
			ciRunCount: 1,
			ciRunCountThrough: "2026-10-07T12:20:00.000Z",
		});
	});
});

describe("falling back to query time", () => {
	const world = (overrides: Partial<World>) =>
		harness({
			seeds: [commitSeed(), pushSeed()],
			facts: pushFacts(),
			...overrides,
		});

	test("with the worker off (no session of the page has a scope) the page is exactly the query-time one, with no link metadata", async () => {
		const off = world({ session: null });
		const events = await off.fromEdges();
		expect(events).toEqual(await off.queryTime());
		// Not even an `edges: null`: the JSON is the old one.
		expect(events.every((event) => !("edges" in event))).toBe(true);
		// Nothing about edges was read beyond the build records.
		expect(off.statements.some((sql) => sql.includes("l1_edge"))).toBe(false);
	});

	test("a session queued but never built, or with edges of another generation, is linked at query time and says why", async () => {
		expect(
			(await world({ session: { builtRevision: null } }).fromEdges()).map(
				(event) => event.edges,
			),
		).toEqual([
			{
				linkedBy: "query",
				status: "not_built",
				builtAt: "2026-10-07T13:00:00.000Z",
			},
			{
				linkedBy: "query",
				status: "not_built",
				builtAt: "2026-10-07T13:00:00.000Z",
			},
		]);
		const stale = await world({
			session: {
				input: {
					transcript: { revision: "8", parserVersion: 5 },
					generation,
					truncated: false,
				},
			},
		}).fromEdges();
		expect(stale.map((event) => event.edges?.status)).toEqual([
			"stale",
			"stale",
		]);
		expect(stale.every((event) => event.edges?.linkedBy === "query")).toBe(
			true,
		);
	});

	test("a repository without GitHub-side edges, or a binding that changed since the build, falls back per event", async () => {
		const unbuilt = await world({ repositories: new Map() }).fromEdges();
		expect(unbuilt.map((event) => event.edges?.status)).toEqual([
			"not_built",
			"not_built",
		]);
		// The worker resolved the remote to another repository id than the live binding.
		const rebound = await world({
			builtWith: {
				...visible,
				bindings: [{ repositoryId: "303", fullName: "opalinehq/athena" }],
			},
		}).fromEdges();
		expect(rebound.map((event) => event.edges)).toMatchObject([
			{ linkedBy: "query", status: "stale" },
			{ linkedBy: "query", status: "stale" },
		]);
	});

	test("rows a build wrote after the completed one (in flight or failed) never count as current", async () => {
		const published = await world({}).fromEdges();
		expect(published.map((event) => event.edges?.status)).toEqual([
			"current",
			"current",
		]);
		// A rebuild in flight wrote one edge at revision 8 > the built 7: its
		// pinned rows may have been merged away, so the session falls back.
		const edgeInFlight = await world({
			session: { rebuilding: true },
			edit: (store) => {
				const [first] = store.edges.filter((row) => row.revision === 7);
				if (first) store.edges.push({ ...first, revision: 8 });
			},
		}).fromEdges();
		expect(edgeInFlight.map((event) => event.edges)).toMatchObject([
			{ linkedBy: "query", status: "stale" },
			{ linkedBy: "query", status: "stale" },
		]);
		// A failed build left only a resolution of revision 9.
		const resolutionLeft = await world({
			edit: (store) => {
				const [first] = store.resolutions;
				if (first)
					store.resolutions.push({
						...first,
						status: "not_found",
						revision: 9,
					});
			},
		}).fromEdges();
		expect(resolutionLeft.map((event) => event.edges?.linkedBy)).toEqual([
			"query",
			"query",
		]);
		// A request waiting with nothing written yet: the pinned rows still hold.
		const queued = await world({ session: { rebuilding: true } }).fromEdges();
		expect(queued.map((event) => event.edges?.status)).toEqual([
			"current",
			"current",
		]);
	});

	test("an older edge version below the pin is read as the build left it: a retracted edge stays retracted", async () => {
		const retracted = await world({
			session: { builtRevision: 8 },
			edit: (store) => {
				// Build 8 retracted the push's branch PR; build 7's row is still
				// unmerged. A retraction as the worker wrote it before it kept
				// generations: the key only, generation columns at their defaults.
				const head = store.edges.find(
					(row) => row.relation === "pr_branch_head",
				);
				if (head)
					store.edges.push({
						organization_id: head.organization_id,
						user_id: head.user_id,
						source: head.source,
						session_id: head.session_id,
						from_kind: head.from_kind,
						from_id: head.from_id,
						relation: head.relation,
						to_kind: head.to_kind,
						to_id: head.to_id,
						evidence_id: head.evidence_id,
						evidence_revision: "0",
						evidence_parser_version: 0,
						transcript_parser_version: 0,
						details: "",
						observed_at: "1970-01-01 00:00:00.000",
						revision: 8,
						is_active: 0,
					});
				for (const row of [...store.edges, ...store.resolutions])
					if (row.revision === 7 && row !== head)
						Object.assign(row, { revision: 8 });
			},
		}).fromEdges();
		const [, push] = retracted;
		expect(push?.edges?.linkedBy).toBe("edges");
		expect(push?.pullRequests.map((pr) => pr.bases)).toEqual([["commit"]]);
	});

	test("frozen edges are used and say so unless the build was truncated; hidden GitHub outcomes look nothing up", async () => {
		const frozen = await world({
			session: { frozenReason: "transcript generation expired; edges kept" },
		}).fromEdges();
		expect(frozen.map((event) => event.edges?.status)).toEqual([
			"frozen",
			"frozen",
		]);
		const truncated = await world({
			session: {
				frozenReason: "transcript generation expired; edges kept",
				input: {
					transcript: { revision: "9", parserVersion: 5 },
					generation,
					truncated: true,
				},
			},
		}).fromEdges();
		expect(truncated.map((event) => event.edges)).toMatchObject([
			{ linkedBy: "query", status: "stale" },
			{ linkedBy: "query", status: "stale" },
		]);
		const hidden = await world({
			access: { visibility: "hidden", bindings: [], repositories: new Map() },
		}).fromEdges();
		expect(
			hidden.map((event) => ["edges" in event, event.github.status]),
		).toEqual([
			[false, "not_visible"],
			[false, "not_visible"],
		]);
	});
});

describe("edge freshness", () => {
	const built: EdgeScopeState = {
		builtRevision: 4,
		resolverVersion: L1_EDGE_RESOLVER_VERSION,
		input: {
			transcript: { revision: "9", parserVersion: 5 },
			generation,
			truncated: false,
		},
		coverage: {},
		frozenReason: null,
		builtAt: "2026-10-07T13:00:00.000Z",
		rebuilding: false,
	};
	const read = {
		generation,
		transcript: { revision: "9", parserVersion: 5 },
	};
	test.each([
		["the build read what find reads", built, read, "current"],
		["never built", undefined, read, "not_built"],
		[
			"queued, never completed",
			{ ...built, builtRevision: null },
			read,
			"not_built",
		],
		[
			"expired transcript, edges kept",
			{ ...built, frozenReason: "expired" },
			read,
			"frozen",
		],
		[
			"expired transcript, edges of a truncated build kept",
			{
				...built,
				frozenReason: "expired",
				input: { ...(built.input as object), truncated: true },
			},
			read,
			"stale",
		],
		[
			"a request waits for the same generation",
			{ ...built, rebuilding: true },
			read,
			"current",
		],
		["older rules", { ...built, resolverVersion: 1 }, read, "stale"],
		[
			"hit its evidence caps",
			{ ...built, input: { ...(built.input as object), truncated: true } },
			read,
			"stale",
		],
		[
			"a newer transcript generation",
			built,
			{ ...read, transcript: { revision: "10", parserVersion: 5 } },
			"stale",
		],
		[
			"a newer observation extraction",
			built,
			{ ...read, generation: { ...generation, parserVersion: 774 } },
			"stale",
		],
		[
			"no observations either way",
			{
				...built,
				input: { transcript: null, generation: null, truncated: false },
			},
			{ generation: null, transcript: null },
			"current",
		],
		[
			"an input from before A0",
			{ ...built, input: { generation } },
			read,
			"stale",
		],
	] as const)("%s → %s", (_name, state, expected, status) => {
		expect(sessionEdgeStatus(state, expected)).toBe(status);
	});

	test.each([
		["built under the current rules", built, true],
		["no scope row at all", undefined, false],
		["queued, never built", { ...built, builtRevision: null }, false],
		[
			"being rebuilt (a newer generation queues one)",
			{ ...built, rebuilding: true },
			false,
		],
		["older rules", { ...built, resolverVersion: 1 }, false],
		[
			"truncated",
			{ ...built, input: { ...(built.input as object), truncated: true } },
			false,
		],
		["frozen with complete edges", { ...built, frozenReason: "expired" }, true],
	] as const)("pullRequest can vouch for a session %s: %p", (_name, state, settled) => {
		expect(settledForReverse(state)).toBe(settled);
	});

	test("coverage is what every source covers: the latest start, the earliest end, unknown when any is", () => {
		expect(
			intersectCoverage([
				{
					prFrom: "2024-10-01",
					ciFrom: null,
					coveredThrough: "2026-10-08T00:00:00Z",
				},
				{
					prFrom: "2024-11-01",
					ciFrom: "2025-01-01",
					coveredThrough: "2026-10-07 12:00:00",
				},
			]),
		).toEqual({
			prFrom: "2024-11-01T00:00:00.000Z",
			ciFrom: "2025-01-01T00:00:00.000Z",
			coveredThrough: "2026-10-07T12:00:00.000Z",
		});
		expect(
			intersectCoverage([
				{ prFrom: "2024-10-01", ciFrom: null, coveredThrough: null },
				{ prFrom: null, ciFrom: null, coveredThrough: "2026-10-07T12:00:00Z" },
			]),
		).toEqual({ prFrom: null, ciFrom: null, coveredThrough: null });
	});
});

describe("shadow comparison", () => {
	test("classifies a SHA only query time dates as expected, and unexplained runs as differences", async () => {
		const world = harness({
			seeds: [commitSeed(), pushSeed()],
			facts: pushFacts({ merged_at: "2026-10-07 14:00:00" }),
		});
		const [, push] = await world.fromEdges();
		if (!push) throw new Error("expected a push");
		expect(shadowDifferences(push, push)).toEqual([]);
		expect(
			shadowDifferences(
				{
					...push,
					ciRunCount: null,
					ciRunCountThrough: null,
					ciRunCountUnknown: "target_history_unknown",
				},
				push,
			),
		).toEqual(["expected:created_in_session"]);
		expect(
			shadowDifferences(
				{ ...push, ciRuns: push.ciRuns.slice(1), ciRunsObserved: 2 },
				push,
			),
		).toEqual(["ci_runs"]);
	});
});

describe("shadow sampling", () => {
	test("a sampled page is also linked at query time, detached; an unsampled one reads no GitHub table", async () => {
		const world = harness({
			seeds: [commitSeed(), pushSeed()],
			facts: pushFacts(),
		});
		const queryTime = (statements: readonly string[]) =>
			statements.filter((statement) =>
				statement.includes("rudel.github_pull_request_commits"),
			).length;
		let comparison: Promise<void> | undefined;
		const sampled = await world.fromEdges({
			rate: 0.5,
			random: () => 0.1,
			onShadow: (running) => {
				comparison = running;
			},
		});
		await comparison;
		expect(queryTime(world.statements)).toBeGreaterThan(0);
		world.statements.length = 0;
		const unsampled = await world.fromEdges({ rate: 0.5, random: () => 0.9 });
		expect(queryTime(world.statements)).toBe(0);
		// The comparison never changes what is returned.
		expect(sampled).toEqual(unsampled);
	});

	test("a failing comparison never fails the find", async () => {
		const world = harness({
			seeds: [commitSeed(), pushSeed()],
			facts: pushFacts(),
			failOn: "rudel.github_pull_request_commits",
		});
		let comparison: Promise<void> | undefined;
		const events = await world.fromEdges({
			rate: 1,
			random: () => 0,
			onShadow: (running) => {
				comparison = running;
			},
		});
		expect(events.map((event) => event.edges?.linkedBy)).toEqual([
			"edges",
			"edges",
		]);
		await expect(comparison).resolves.toBeUndefined();
	});

	test("the comparison runs on its own executor and cancellation, never the request's", async () => {
		const world = harness({
			seeds: [commitSeed(), pushSeed()],
			facts: pushFacts(),
		});
		const signals: (AbortSignal | undefined)[] = [];
		const own = {
			query: async (statement: { abortSignal?: AbortSignal }) => {
				signals.push(statement.abortSignal);
				throw new Error("param_secret=token-123 refused");
			},
		} as unknown as ClickHouseExecutor;
		let comparison: Promise<void> | undefined;
		await world.fromEdges({
			rate: 1,
			random: () => 0,
			executor: own,
			onShadow: (running) => {
				comparison = running;
			},
		});
		const pageStatements = world.statements.length;
		await expect(comparison).resolves.toBeUndefined();
		// Its statements carry its own signal; the page's executor saw none of them.
		expect(signals.length).toBeGreaterThan(0);
		expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
		expect(world.statements).toHaveLength(pageStatements);
	});
});

function touch(fields: Partial<PullRequestTouch> = {}): PullRequestTouch {
	return {
		session,
		relation: "pr_named",
		evidenceId: "obs::10:0:pr_url",
		generation: { revision: "1", parserVersion: 773 },
		agentId: "",
		turn: 3,
		matchedValue: "133",
		atMs: Date.parse("2026-09-15T10:00:00Z"),
		revision: 7,
		...fields,
	};
}

/** A by-target edge row as the worker writes it, for the reverse fakes. */
function targetRow(fields: Row = {}): Row {
	const user = String(fields.user_id ?? "u1");
	const sessionId = String(fields.session_id ?? "s1");
	return {
		from_id: `${encodeURIComponent(user)}/claude_code/${encodeURIComponent(sessionId)}//4`,
		user_id: "u1",
		source: "claude_code",
		session_id: "s1",
		evidence_id: "obs::10:0:push_range",
		relation: "pr_branch_head",
		from_kind: "run",
		to_kind: "pull_request",
		to_id: pullRequestNodeId("101", 133),
		agent_id: "",
		turn_idx: 1,
		matched_value: "feat/links",
		evidence_revision: "1",
		evidence_parser_version: 773,
		revision: 7,
		at_ms: Date.parse("2026-09-15T10:00:00Z"),
		details: "{}",
		is_active: 1,
		...fields,
	};
}

/**
 * Answers the reverse reads from by-target rows by their parameters, as
 * ClickHouse would: sessions by owner, each session's rows at its pin (the
 * latest version of each key at or below it, then active ones), and the
 * newest revision per session. Session-analytics statements return
 * `sessions(params)`; everything else nothing.
 */
function reverseClickHouse(
	store: { rows: Row[]; commits?: string[]; createdAt?: string },
	statements: { query: string; params: Record<string, unknown> }[],
	sessions: (params: Row) => Row[] = () => [],
): ClickHouseExecutor {
	const query = async (statement: {
		query: string;
		query_params?: Row;
	}): Promise<Row[]> => {
		const sql = statement.query;
		const params = statement.query_params ?? {};
		statements.push({ query: sql, params });
		const owned = store.rows.filter(
			(row) => params.userId === undefined || row.user_id === params.userId,
		);
		const inChunk = (row: Row) => {
			const users = (params.sUsers as string[]) ?? [];
			return users.some(
				(user, index) =>
					user === row.user_id &&
					(params.sSources as string[])[index] === row.source &&
					(params.sSessions as string[])[index] === row.session_id,
			);
		};
		if (sql.includes("SELECT DISTINCT from_id"))
			return (store.commits ?? []).map((from_id) => ({ from_id }));
		if (sql.includes("SELECT DISTINCT user_id, source, session_id"))
			return [
				...new Map(
					owned.map((row) => [
						JSON.stringify([row.user_id, row.source, row.session_id]),
						{
							user_id: row.user_id,
							source: row.source,
							session_id: row.session_id,
						},
					]),
				).values(),
			];
		if (sql.includes("max(revision)")) {
			const newest = new Map<string, Row>();
			for (const row of owned.filter(inChunk)) {
				const key = JSON.stringify([row.user_id, row.source, row.session_id]);
				const known = newest.get(key);
				if (!known || Number(known.newest) < Number(row.revision))
					newest.set(key, {
						user_id: row.user_id,
						source: row.source,
						session_id: row.session_id,
						newest: String(row.revision),
					});
			}
			return [...newest.values()];
		}
		if (sql.includes("LIMIT 1 BY to_kind")) {
			const pinOf = (row: Row) => {
				const index = ((params.pinKeys as string[]) ?? []).indexOf(
					[row.user_id, row.source, row.session_id].join("\u001f"),
				);
				return index < 0 ? 0 : Number((params.pinValues as string[])[index]);
			};
			const latest = new Map<string, Row>();
			for (const row of owned.filter(inChunk)) {
				if (Number(row.revision) > pinOf(row)) continue;
				const key = JSON.stringify([
					row.to_kind,
					row.to_id,
					row.relation,
					row.from_kind,
					row.from_id,
					row.evidence_id,
				]);
				const known = latest.get(key);
				if (!known || Number(known.revision) < Number(row.revision))
					latest.set(key, row);
			}
			return [...latest.values()]
				.filter((row) => row.is_active === 1)
				.sort((left, right) => Number(right.at_ms) - Number(left.at_ms))
				.slice(0, Number(params.cap))
				.map((row) => ({
					...row,
					evidence_revision_text: row.evidence_revision,
					revision_text: String(row.revision),
				}));
		}
		if (sql.includes("created_text"))
			return store.createdAt ? [{ created_text: store.createdAt }] : [];
		if (sql.includes("rudel.session_analytics")) return sessions(params);
		return [];
	};
	return { query } as unknown as ClickHouseExecutor;
}

function scopeStates(built: Record<string, number | null>): EdgeStateSource {
	return {
		scopes: async (_organization, kind, ids) =>
			new Map(
				kind === "session"
					? ids.flatMap((id) => {
							const sessionId = id.split("/").at(-1) ?? "";
							return sessionId in built
								? [
										[
											id,
											{
												builtRevision: built[sessionId] ?? null,
												resolverVersion: L1_EDGE_RESOLVER_VERSION,
												input: {
													transcript: null,
													generation: null,
													truncated: false,
												},
												coverage: {},
												frozenReason: null,
												builtAt: "2026-10-07T13:00:00.000Z",
												rebuilding: false,
											},
										] as const,
									]
								: [];
						})
					: [],
			),
	};
}

describe("pull request → sessions", () => {
	const athenaBinding = { repositoryId: "101", fullName: "opalinehq/athena" };

	test("follows the PR's and its commits' edges by target for the member's sessions, as each completed build published them", async () => {
		const statements: { query: string; params: Record<string, unknown> }[] = [];
		const commit = commitNodeId("101", sha);
		const rows = [
			targetRow(),
			targetRow({
				evidence_id: "obs::11:0:commit_created",
				relation: "commit_created",
				to_kind: "commit",
				to_id: commit,
				matched_value: "d4e5f6a",
				at_ms: Date.parse("2026-09-15T11:00:00Z"),
			}),
			// Build 8 (unpublished) replaced the branch edge; build 7's row is still there.
			targetRow({ revision: 8, matched_value: "feat/other" }),
			// Build 8 retracted the commit edge: unpublished, so build 7's edge stands.
			targetRow({
				evidence_id: "obs::11:0:commit_created",
				relation: "commit_created",
				to_kind: "commit",
				to_id: commit,
				revision: 8,
				is_active: 0,
				evidence_revision: "0",
				evidence_parser_version: 0,
			}),
			// Another member's session: never read for this member.
			targetRow({ user_id: "u2", session_id: "s2" }),
			// A session whose only build never completed.
			targetRow({ session_id: "s3" }),
		];
		const touches = await loadPullRequestTouches(
			reverseClickHouse(
				{ rows, commits: [commit], createdAt: "2026-09-01 10:00:00.000" },
				statements,
			),
			organizationId,
			"u1",
			athenaBinding,
			133,
			scopeStates({ s1: 7, s2: 7, s3: null }),
		);
		expect(
			touches.edges.map((edge) => [
				edge.session.sessionId,
				edge.relation,
				edge.matchedValue,
				edge.revision,
			]),
		).toEqual([
			["s1", "commit_created", "d4e5f6a", 7],
			["s1", "pr_branch_head", "feat/links", 7],
		]);
		// s1 has rows above its pin: what is shown may be incomplete.
		expect(touches.incomplete.map((one) => one.sessionId)).toEqual(["s1"]);
		expect(touches.unpublished.map((one) => one.sessionId)).toEqual(["s3"]);
		expect(touches.createdAt).toBe("2026-09-01 10:00:00.000");
		expect(touches.truncated).toBe(false);
		for (const statement of statements.filter((one) =>
			one.query.includes("user_id"),
		))
			expect(statement.params.userId).toBe("u1");
		// No session read uses FINAL: an unpublished version must not hide a published one.
		for (const statement of statements.filter(
			(one) =>
				one.query.includes("session_id") &&
				one.query.includes("l1_edges_by_target"),
		))
			expect(statement.query).not.toContain("FINAL");
		expect(
			statements.find((one) => one.query.includes("LIMIT 1 BY to_kind"))?.query,
		).toContain("JSONExtractString(details, 'role') != 'base'");
	});

	test("stops at the edge cap, newest first", async () => {
		const statements: { query: string; params: Record<string, unknown> }[] = [];
		const rows = Array.from({ length: PULL_REQUEST_EDGE_CAP + 1 }, (_, index) =>
			targetRow({
				session_id: `s${index % 3}`,
				evidence_id: `obs::${index}:0:push_range`,
				from_kind: index % 2 ? "run" : "session",
				turn_idx: index % 2 ? 2 : 0,
				at_ms: 1_000_000 + index,
			}),
		);
		const touches = await loadPullRequestTouches(
			reverseClickHouse({ rows }, statements),
			organizationId,
			null,
			athenaBinding,
			133,
			scopeStates({ s0: 7, s1: 7, s2: 7 }),
		);
		expect(touches.truncated).toBe(true);
		expect(touches.edges).toHaveLength(PULL_REQUEST_EDGE_CAP);
		expect(touches.edges[0]?.atMs).toBe(1_000_000 + PULL_REQUEST_EDGE_CAP);
		// Evidence of no run (a session node) has no turn.
		expect(
			touches.edges.find(
				(edge) =>
					edge.evidenceId === `obs::${PULL_REQUEST_EDGE_CAP - 2}:0:push_range`,
			)?.turn,
		).toBeNull();
	});

	test("each observation keeps the generation its edge was built from", () => {
		expect(touchEvidence([touch()])).toEqual(
			new Map([
				[
					"s1",
					new Map([
						["obs::10:0:pr_url", { revision: "1", parserVersion: 773 }],
					]),
				],
			]),
		);
	});

	test("a touch whose transcript expired, or whose generation find no longer reads, is an auditable witness", () => {
		const capture = touch({
			evidenceId: "capture:context-1",
			relation: "commit_captured",
			generation: { revision: "0", parserVersion: 0 },
			turn: null,
		});
		const visibleSessions = new Set([sessionScopeId(session)]);
		expect(
			touchWitnesses([touch(), capture], visibleSessions, new Map()),
		).toEqual([
			{
				sessionId: "s1",
				agentId: "",
				turn: 3,
				relation: "pr_named",
				matchedValue: "133",
				at: "2026-09-15T10:00:00.000Z",
				evidenceId: "obs::10:0:pr_url",
				generation: { revision: "1", parserVersion: 773 },
				reason: "transcript_unavailable",
			},
		]);
		expect(
			touchWitnesses(
				[touch()],
				visibleSessions,
				new Map([["s1", { revision: "2", parserVersion: 773 }]]),
			).map((witness) => witness.reason),
		).toEqual(["other_generation"]);
		// Read in its own generation: an event, not a witness. Hidden sessions never are.
		expect(
			touchWitnesses(
				[touch()],
				visibleSessions,
				new Map([["s1", { revision: "1", parserVersion: 773 }]]),
			),
		).toEqual([]);
		expect(touchWitnesses([touch()], new Set(), new Map())).toEqual([]);
	});

	test("witnesses follow the runs refs or model select; a model they cannot be checked against is unknown", () => {
		const visibleSessions = new Set([sessionScopeId(session)]);
		const witnesses = touchWitnesses(
			[
				touch({ turn: 1, evidenceId: "obs::5:0:pr_url" }),
				touch({ turn: 2, evidenceId: "obs::6:0:pr_url" }),
				touch({ turn: null, evidenceId: "obs::1:0:codex_session_meta" }),
			],
			visibleSessions,
			new Map(),
		);
		const key = (ref: { sessionId: string; agentId: string; turn: number }) =>
			`${ref.sessionId}|${ref.agentId}|${ref.turn}`;
		expect(
			selectWitnesses(witnesses, {
				refs: new Set(["s1||1"]),
				modelRuns: null,
				runKey: key,
			}),
		).toMatchObject({ kept: [{ turn: 1 }], unattributed: 0 });
		// The transcripts are gone: no run's model can be checked.
		expect(
			selectWitnesses(witnesses, {
				refs: null,
				modelRuns: new Set(),
				runKey: key,
			}),
		).toEqual({ kept: [], unattributed: 3 });
		expect(
			selectWitnesses(witnesses, { refs: null, modelRuns: null, runKey: key })
				.kept,
		).toHaveLength(3);
		// Both given: a named run must also be one the model selected.
		expect(
			selectWitnesses(witnesses, {
				refs: new Set(["s1||2"]),
				modelRuns: new Set(["s1||1"]),
				runKey: key,
			}).kept,
		).toEqual([]);
		expect(
			selectWitnesses(witnesses, {
				refs: new Set(["s1||1", "s1||2"]),
				modelRuns: new Set(["s1||1"]),
				runKey: key,
			}).kept,
		).toMatchObject([{ turn: 1 }]);
	});

	test("notes count only the sessions the caller sees, and say what is unknown", () => {
		const own = session;
		const other = { userId: "u2", source: "codex", sessionId: "s2" };
		const edges = [
			touch({ relation: "pr_named" }),
			touch({ relation: "commit_pushed", evidenceId: "obs::11:0:push_range" }),
			touch({ session: other, relation: "commit_created" }),
		];
		const notes = pullRequestNotes({
			touches: {
				repository: { repositoryId: "101", fullName: "opalinehq/athena" },
				number: 133,
				createdAt: null,
				edges,
				unpublished: [{ ...own, sessionId: "s3" }],
				incomplete: [own],
				truncated: true,
			},
			edges,
			visible: new Set([sessionScopeId(own)]),
			sessionScopes: new Map(),
			repositoryScope: undefined,
			unsettled: {
				count: 0,
				of: 10_000,
				from: "2026-08-18",
				to: "2026-10-08",
				capped: true,
			},
			witnesses: 1,
			unattributed: 2,
			model: "gpt-5",
		});
		expect(notes).toEqual([
			"pullRequest opalinehq/athena#133: 1 sessions you can see touch it through 2 edges (commit_pushed 1, pr_named 1)",
			"1 of these edges have no readable evidence row (transcript_unavailable, or other_generation when the edge came from an older observation generation): they are listed as witnesses, not as events",
			"2 more retained edges come from runs whose model is unknown (their transcript is no longer indexed, or the evidence belongs to no run), so whether they used model=gpt-5 is unknown: they are not listed",
			"1 sessions you can see have edges to it only from builds that never completed: whether they touch opalinehq/athena#133 is unknown",
			"1 sessions you can see are being rebuilt or had a rebuild fail after their last completed one: what is shown for them may be incomplete (unknown)",
			"opalinehq/athena has no GitHub-side edges built yet: the PR's commits are unknown, so sessions that only created, pushed or mentioned them are missing (unknown, not absent)",
			// The census was capped: said even though none of the checked sessions is unknown.
			"only the newest 10000 sessions you can see from 2026-08-18 to 2026-10-08 were checked for edges that vouch for them; older ones may also touch opalinehq/athena#133 (unknown, truncated)",
			"the lookup stopped at 5000 edges or 1000 commits (taken in SHA order, not by time): older sessions, and sessions touching unsearched commits, may be missing (truncated)",
		]);
		expect(notes.join("\n")).not.toContain("commit_created");
	});
});

describe("observations of a pull request's evidence", () => {
	const batch = {
		scope: { organizationId, userId: "u1" },
		generations: [transcript],
		sessions: [analysisSession],
	};
	const generations = new Map([["s1", generation]]);
	const recording = () => {
		const statements: Record<string, unknown>[] = [];
		const executor = {
			query: async (statement: { query_params?: Record<string, unknown> }) => {
				statements.push(statement.query_params ?? {});
				const params = statement.query_params ?? {};
				return ((params.onlyRecords as number[]) ?? []).map((record) => ({
					session_id: "s1",
					agent_id: "",
					record_idx: record,
					block_idx: 0,
					call_id: "",
					kind: "push_range",
					label: "observed",
					short_sha: "",
					branch: "",
					push_from_sha: "",
					push_to_sha: "",
					push_source_branch: "",
					pr_repo: "",
					pr_number: 0,
					commit_hash: "",
					repository_url: "",
					run_id: "",
					ts_ms: 1_000 + record,
				}));
			},
		} as unknown as ClickHouseExecutor;
		return { statements, executor };
	};

	test("are matched only in the generation their edge was built from", async () => {
		const { statements, executor } = recording();
		const only = new Map([
			[
				"s1",
				new Map([
					["obs::10:0:push_range", { revision: "1", parserVersion: 773 }],
					// Built from the previous generation: its place may now hold another row.
					["obs::11:0:push_range", { revision: "0", parserVersion: 773 }],
				]),
			],
		]);
		const rows = await queryObservations(executor, batch, generations, {
			after: undefined,
			limit: 10,
			only,
		});
		expect(rows.map((row) => row.record_idx)).toEqual([10]);
		expect(statements[0]?.onlyRecords).toEqual([10]);
		const none = recording();
		expect(
			await queryObservations(none.executor, batch, generations, {
				after: undefined,
				limit: 10,
				only: new Map([
					[
						"s1",
						new Map([
							["obs::11:0:push_range", { revision: "0", parserVersion: 773 }],
						]),
					],
				]),
			}),
		).toEqual([]);
		expect(none.statements).toEqual([]);
	});

	test("many kept observations are split by URL size and merged in scan order", async () => {
		const { statements, executor } = recording();
		const agent = "a".repeat(300);
		const ids = Array.from(
			{ length: 2_000 },
			(_, index) =>
				[
					`obs:${agent}:${index + 1}:0:push_range`,
					{ revision: "1", parserVersion: 773 },
				] as const,
		);
		const rows = await queryObservations(executor, batch, generations, {
			after: undefined,
			limit: 5,
			only: new Map([["s1", new Map(ids)]]),
		});
		expect(statements.length).toBeGreaterThan(1);
		for (const params of statements)
			expect(encodeURIComponent(JSON.stringify(params)).length).toBeLessThan(
				400 * 1024,
			);
		expect(rows.map((row) => row.record_idx)).toEqual([
			2_000, 1_999, 1_998, 1_997, 1_996,
		]);
	});
});

describe("find pullRequest=…", () => {
	const statements: { query: string; params: Record<string, unknown> }[] = [];
	let rows: Row[] = [];
	let inventory: Row[] = [];
	const analyticsRow = (sessionId: string, userId = "u1") => ({
		session_id: sessionId,
		user_id: userId,
		source: "claude_code",
		model: "",
		repository: "",
		session_ms: Date.parse("2026-09-15T09:00:00Z"),
	});
	const executor = reverseClickHouse(
		{
			get rows() {
				return rows;
			},
		},
		statements,
		(params) =>
			"pickUsers" in params
				? (params.pickSessions as string[]).map((id, index) =>
						analyticsRow(id, (params.pickUsers as string[])[index]),
					)
				: inventory,
	);
	const github = (access: GitHubAccess) => ({
		access: async () => access,
		evidence: async () => ({ snapshots: [], captures: [] }),
	});
	const find = (
		scope: { userId: string | null },
		access: GitHubAccess,
		edges: EdgeStateSource | null = scopeStates({ s1: 7, s2: 7 }),
		extra: Record<string, unknown> = {},
	) => {
		statements.length = 0;
		return findAnalysis(
			{ organizationId, ...scope },
			AnalysisFindInputSchema.parse({
				source: "git",
				pullRequest: "https://github.com/OpalineHQ/athena/pull/133",
				...extra,
			}),
			{ executor, github: github(access), edges },
		);
	};

	test("scopes find to the sessions whose published edges touch it, the member's own only, whatever their date", async () => {
		rows = [
			targetRow(),
			// Written only by a build that has not completed: not a fact yet.
			targetRow({ session_id: "s2", revision: 8 }),
		];
		inventory = [analyticsRow("s1"), analyticsRow("s9")];
		const output = await find({ userId: "u1" }, visible);
		const pick = statements.find(
			(row) =>
				row.query.includes("rudel.session_analytics") &&
				"pickUsers" in row.params,
		);
		expect(pick?.params).toMatchObject({
			userId: "u1",
			pickUsers: ["u1"],
			pickSessions: ["s1"],
		});
		// No default seven-day window: the touching sessions are found by edges.
		expect(pick?.query).not.toContain("BETWEEN {from:Date}");
		expect(output.header).toMatchObject({
			from: "2026-09-15",
			to: "2026-09-15",
			sessionsInScope: 1,
			truncated: true,
		});
		// s1's transcript is not indexed: its touch is a witness, not lost.
		expect(output.source === "git" && output.witnesses).toMatchObject([
			{ sessionId: "s1", reason: "transcript_unavailable", turn: 1 },
		]);
		expect(output.header.notes.join("\n")).toContain(
			"1 of the 2 sessions you can see from",
		);
		expect(output.header.notes.join("\n")).toContain(
			"1 sessions you can see are being rebuilt",
		);

		// refs naming another run of the same session leave the witness out.
		const otherRun = await find({ userId: "u1" }, visible, undefined, {
			refs: [{ sessionId: "s1", turn: 2 }],
		});
		expect(otherRun.source === "git" && otherRun.witnesses).toEqual([]);

		const dated = await find({ userId: null }, visible, undefined, {
			from: "2026-09-01",
			to: "2026-09-30",
		});
		const datedPick = statements.find(
			(row) =>
				row.query.includes("rudel.session_analytics") &&
				"pickUsers" in row.params,
		);
		expect(datedPick?.query).toContain("BETWEEN {from:Date}");
		expect(dated.header).toMatchObject({
			from: "2026-09-01",
			to: "2026-09-30",
		});
	});

	test("a capped census says so even when every checked session is settled", async () => {
		rows = [targetRow()];
		inventory = Array.from({ length: 10_001 }, (_, index) =>
			analyticsRow(`s${index === 0 ? 1 : index + 100}`),
		);
		const everyoneSettled: EdgeStateSource = {
			scopes: async (_organization, kind, ids) =>
				new Map(
					kind === "session"
						? ids.map((id) => [
								id,
								{
									builtRevision: 7,
									resolverVersion: L1_EDGE_RESOLVER_VERSION,
									input: {
										transcript: null,
										generation: null,
										truncated: false,
									},
									coverage: {},
									frozenReason: null,
									builtAt: null,
									rebuilding: false,
								},
							])
						: [],
				),
		};
		const output = await find({ userId: null }, visible, everyoneSettled);
		expect(output.header.truncated).toBe(true);
		expect(output.header.notes.join("\n")).toContain(
			"only the newest 10000 sessions you can see",
		);
		expect(output.header.notes.join("\n")).not.toContain(
			"have no edges that vouch",
		);
	});

	test("thousands of long session ids are read in statements that each fit the URL budget", async () => {
		const owner = crypto.randomUUID();
		rows = Array.from({ length: 3_000 }, (_, index) =>
			targetRow({
				user_id: owner,
				session_id: `${"o'neil-".repeat(12)}${index}-${crypto.randomUUID()}`,
				at_ms: 1_000 + index,
			}),
		);
		inventory = [];
		const built: EdgeStateSource = {
			scopes: async (_organization, kind, ids) =>
				new Map(
					kind === "session"
						? ids.map((id) => [
								id,
								{
									builtRevision: 7,
									resolverVersion: L1_EDGE_RESOLVER_VERSION,
									input: {
										transcript: null,
										generation: null,
										truncated: false,
									},
									coverage: {},
									frozenReason: null,
									builtAt: null,
									rebuilding: false,
								},
							])
						: [],
				),
		};
		await find({ userId: null }, visible, built);
		const bounded = statements.filter(
			(row) =>
				"pickUsers" in row.params ||
				"sUsers" in row.params ||
				"onlySessions" in row.params,
		);
		expect(
			bounded.filter((row) => "pickUsers" in row.params).length,
		).toBeGreaterThan(1);
		expect(
			bounded
				.filter((row) => "pickUsers" in row.params)
				.flatMap((row) => row.params.pickSessions as string[]),
		).toHaveLength(3_000);
		for (const row of bounded)
			expect(urlBytes(row.params)).toBeLessThan(400 * 1024);
	});

	test("an unbound repository, hidden GitHub outcomes or edges switched off answer unknown without reading sessions", async () => {
		const unbound = await find(
			{ userId: null },
			{
				...visible,
				bindings: [{ repositoryId: "202", fullName: "contributor/athena" }],
			},
		);
		expect(unbound.header.notes).toEqual([
			"OpalineHQ/athena has no active GitHub binding in this workspace: which sessions touched #133 is unknown",
		]);
		expect(statements).toEqual([]);
		const hidden = await find(
			{ userId: null },
			{ visibility: "hidden", bindings: [], repositories: new Map() },
		);
		expect(hidden.header.notes[0]).toContain("not visible");
		const off = await find({ userId: null }, visible, null);
		expect(off.header.notes[0]).toContain("does not read at the moment");
		expect(off.source === "git" && off.events).toEqual([]);
		expect(statements).toEqual([]);
	});

	test("a git find without pullRequest has no witnesses field at all", async () => {
		statements.length = 0;
		const output = await findAnalysis(
			{ organizationId, userId: null },
			AnalysisFindInputSchema.parse({ source: "git" }),
			{ executor, github: github(visible), edges: null },
		);
		expect("witnesses" in output).toBe(false);
	});
});

/** What clickhouse-js puts in the URL for these parameters (formatQueryParams, URLSearchParams). */
function urlBytes(params: Record<string, unknown>): number {
	const literal = (value: unknown): string =>
		Array.isArray(value)
			? `[${value.map(literal).join(",")}]`
			: typeof value === "string"
				? `'${value.replace(/[\t\n\r'\\]/gu, (char) => `\\${char === "\t" ? "t" : char === "\n" ? "n" : char === "\r" ? "r" : char}`)}'`
				: String(value);
	return new URLSearchParams(
		Object.entries(params).map(([name, value]): [string, string] => [
			`param_${name}`,
			Array.isArray(value) || typeof value !== "string"
				? literal(value)
				: value,
		]),
	).toString().length;
}

function pushFacts(pr: Partial<PullRequestRow> = {}): GitHubFacts {
	const facts = emptyGitHubFacts();
	facts.shaCandidates.set("101|d4e5f6a", [sha]);
	facts.memberships.set(`101|${sha}`, [
		{ prNumber: 133, lastSeenHeadSha: "c".repeat(40) },
	]);
	facts.pullRequests.set(
		"101|133",
		pullRequest(133, { merge_commit_sha: merge, ...pr }),
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
	return facts;
}

function commitSeed(): Seed {
	return seed({
		kind: "commit_created",
		record: 6,
		shortSha: "d4e5f6a",
		atMs: Date.parse("2026-10-07T11:50:00Z"),
		turn: 3,
	});
}

function pushSeed(): Seed {
	return seed({
		kind: "push_range",
		record: 10,
		pushFrom: "a1b2c3d",
		pushTo: "d4e5f6a",
		branch: "feat/links",
		sourceBranch: "feat/links",
		remote: athena,
		turn: 3,
	});
}

/** GitHub-side edges as a repository build projects them from the same facts. */
function gitHubEdges(facts: GitHubFacts) {
	const base = {
		organization_id: organizationId,
		basis: "github",
		user_id: "",
		source: "",
		session_id: "",
		agent_id: "",
		turn_idx: 0,
		evidence_revision: "0",
		evidence_parser_version: 0,
		transcript_parser_version: 0,
		candidate_count: 1,
		is_active: 1,
		revision: 3,
	};
	const split = (value: string) => {
		const index = value.indexOf("|");
		return [value.slice(0, index), value.slice(index + 1)] as const;
	};
	const runNode = (run: CiRunRow) =>
		ciRunNodeId(run.repository_id, run.kind, run.run_id, run.attempt);
	return [
		...[...facts.memberships].flatMap(([entry, memberships]) => {
			const [repositoryId, commit] = split(entry);
			return memberships.map((membership) => ({
				...base,
				repository_id: repositoryId,
				from_kind: "commit",
				from_id: commitNodeId(repositoryId, commit),
				relation: "commit_in_pr",
				to_kind: "pull_request",
				to_id: pullRequestNodeId(repositoryId, membership.prNumber),
				evidence_id: `gh_pr_commit:${commit}:${membership.prNumber}`,
				observed_at: "2026-10-07 12:00:00.000",
				matched_value: commit,
				match_rule: "membership",
				details: JSON.stringify({
					lastSeenHeadSha: membership.lastSeenHeadSha,
				}),
			}));
		}),
		...[...facts.pullRequests.values()].flatMap((pr) =>
			pr.merged_at && pr.merge_commit_sha
				? [
						{
							...base,
							repository_id: pr.repository_id,
							from_kind: "commit",
							from_id: commitNodeId(pr.repository_id, pr.merge_commit_sha),
							relation: "commit_in_pr",
							to_kind: "pull_request",
							to_id: pullRequestNodeId(pr.repository_id, pr.number),
							evidence_id: `gh_pr_merge:${pr.number}`,
							observed_at: pr.merged_at,
							matched_value: pr.merge_commit_sha,
							match_rule: "merge_commit",
							details: "{}",
						},
					]
				: [],
		),
		...[...facts.shaRuns].flatMap(([entry, runs]) => {
			const [repositoryId, commit] = split(entry);
			return runs.map((run) => ({
				...base,
				repository_id: repositoryId,
				from_kind: "commit",
				from_id: commitNodeId(repositoryId, commit),
				relation: "ci_on_sha",
				to_kind: "ci_run",
				to_id: runNode(run),
				evidence_id: `gh_run:${run.kind}:${run.run_id}:${run.attempt}`,
				observed_at: run.created_at,
				matched_value: commit,
				match_rule: "head_sha",
				details: "{}",
			}));
		}),
		...[...facts.pullRequestRuns].flatMap(([entry, runs]) => {
			const [repositoryId, number] = split(entry);
			return runs.map((run) => ({
				...base,
				repository_id: repositoryId,
				from_kind: "pull_request",
				from_id: pullRequestNodeId(repositoryId, Number(number)),
				relation: "ci_for_pr",
				to_kind: "ci_run",
				to_id: runNode(run),
				evidence_id: `gh_run_pr:${number}:${run.kind}:${run.run_id}:${run.attempt}`,
				observed_at: run.created_at,
				matched_value: number,
				match_rule: run.link_basis,
				details: "{}",
			}));
		}),
	];
}

function allRuns(facts: GitHubFacts): CiRunRow[] {
	const runs = new Map<string, CiRunRow>();
	for (const map of [
		facts.shaRuns,
		facts.pullRequestRuns,
		facts.namedRuns,
		facts.branchRuns,
	])
		for (const rows of map.values())
			for (const run of rows)
				runs.set(
					ciRunNodeId(run.repository_id, run.kind, run.run_id, run.attempt),
					{
						...run,
						pr_number: 0,
						link_basis: "",
					},
				);
	return [...runs.values()];
}

type Row = Record<string, unknown>;

/**
 * Answers the edge reads from in-memory rows by their parameters, as
 * ClickHouse would: GitHub-side reads with FINAL and `is_active = 1`, session
 * reads at each session's pinned revision (the latest version of each key at
 * or below it, then active ones); the query-time reads get nothing.
 */
function fakeClickHouse(
	store: {
		edges: Row[];
		resolutions: Row[];
		pullRequests: PullRequestRow[];
		runs: CiRunRow[];
	},
	statements: string[],
	failOn?: string,
): ClickHouseExecutor {
	const zip = (params: Row, names: readonly string[]) =>
		new Set(
			((params[names[0] ?? ""] as unknown[]) ?? []).map((_, index) =>
				JSON.stringify(
					names.map((name) => String((params[name] as unknown[])[index])),
				),
			),
		);
	const has = (tuples: Set<string>, values: readonly unknown[]) =>
		tuples.has(JSON.stringify(values.map(String)));
	const ranges = (params: Row) =>
		Object.keys(params)
			.filter((name) => name.startsWith("rangeFrom"))
			.map((name) => [
				String(params[name]),
				String(params[name.replace("From", "To")]),
			]);
	const counted = (rows: Row[], keys: readonly string[]) => {
		const groups = new Map<string, Row>();
		for (const row of rows) {
			const group = JSON.stringify(keys.map((name) => row[name]));
			const known = groups.get(group);
			if (known) known.n = Number(known.n) + 1;
			else
				groups.set(group, {
					...Object.fromEntries(keys.map((name) => [name, row[name]])),
					n: 1,
				});
		}
		return [...groups.values()];
	};
	const limited = (rows: Row[], keys: readonly string[], cap: number) => {
		const seen = new Map<string, number>();
		return rows
			.sort((left, right) =>
				String(left.to_id).localeCompare(String(right.to_id)),
			)
			.filter((row) => {
				const group = JSON.stringify(keys.map((name) => row[name]));
				const count = (seen.get(group) ?? 0) + 1;
				seen.set(group, count);
				return count <= cap;
			})
			.map((row) => ({ ...row, observed_text: row.observed_at }));
	};
	const pinOf = (params: Row, row: Row) => {
		const index = ((params.pinKeys as string[]) ?? []).indexOf(
			[row.user_id, row.source, row.session_id].join("\u001f"),
		);
		return index < 0 ? 0 : Number((params.pinValues as string[])[index]);
	};
	const pinned = (rows: Row[], params: Row, keys: readonly string[]) => {
		const latest = new Map<string, Row>();
		for (const row of rows) {
			if (Number(row.revision) > pinOf(params, row)) continue;
			const key = JSON.stringify(keys.map((name) => row[name]));
			const known = latest.get(key);
			if (!known || Number(known.revision) < Number(row.revision))
				latest.set(key, row);
		}
		return [...latest.values()].filter((row) => row.is_active === 1);
	};
	const newest = (rows: Row[]) => {
		const groups = new Map<string, Row>();
		for (const row of rows) {
			const key = JSON.stringify([row.user_id, row.source, row.session_id]);
			const known = groups.get(key);
			if (!known || Number(known.newest) < Number(row.revision))
				groups.set(key, {
					user_id: row.user_id,
					source: row.source,
					session_id: row.session_id,
					newest: String(row.revision),
				});
		}
		return [...groups.values()];
	};
	const inRanges = (params: Row, row: Row) =>
		(row.from_kind === "run" || row.from_kind === "session") &&
		ranges(params).some(
			([from = "", to = ""]) =>
				String(row.from_id) >= from && String(row.from_id) < to,
		);
	const edgeKey = [
		"from_kind",
		"from_id",
		"relation",
		"to_kind",
		"to_id",
		"evidence_id",
	];
	const query = async (statement: {
		query: string;
		query_params?: Row;
	}): Promise<Row[]> => {
		const sql = statement.query;
		const params = statement.query_params ?? {};
		statements.push(sql);
		if (failOn && sql.includes(failOn))
			throw new Error("param_secret=token-123 refused");
		const active = store.edges.filter((edge) => edge.is_active === 1);
		if (sql.includes("rudel.l1_edges_by_target"))
			return active
				.filter(
					(edge) =>
						edge.relation === "commit_in_pr" &&
						edge.match_rule === "merge_commit" &&
						(params.pullRequests as string[]).includes(String(edge.to_id)),
				)
				.map((edge) => ({ to_id: edge.to_id, from_id: edge.from_id }));
		if (
			sql.includes("rudel.l1_edge_resolutions") &&
			sql.includes("max(revision)")
		) {
			const sessions = zip(params, ["sUsers", "sSources", "sSessions"]);
			return newest(
				store.resolutions.filter((row) =>
					has(sessions, [row.user_id, row.source, row.session_id]),
				),
			);
		}
		if (sql.includes("rudel.l1_edge_resolutions")) {
			const tuples = zip(params, ["eUsers", "eSources", "eSessions", "eIds"]);
			return pinned(
				store.resolutions.filter((row) =>
					has(tuples, [
						row.user_id,
						row.source,
						row.session_id,
						row.evidence_id,
					]),
				),
				params,
				["user_id", "source", "session_id", "evidence_id", "target"],
			).map((row) => ({ ...row, revision_text: row.evidence_revision }));
		}
		if (sql.includes("rudel.l1_edges") && sql.includes("max(revision)"))
			return newest(store.edges.filter((row) => inRanges(params, row)));
		if (sql.includes("rudel.l1_edges") && sql.includes("{fromKind:String}")) {
			const rows = active.filter(
				(edge) =>
					edge.from_kind === params.fromKind &&
					(params.fromIds as string[]).includes(String(edge.from_id)) &&
					(params.relations as string[]).includes(String(edge.relation)) &&
					(edge.relation !== "commit_in_pr" ||
						edge.match_rule === "membership") &&
					(params.repositoryIds as string[]).includes(
						String(edge.repository_id),
					),
			);
			return sql.includes("count() AS n")
				? counted(rows, ["from_id", "relation"])
				: limited(rows, ["from_id", "relation"], Number(params.cap));
		}
		if (sql.includes("rudel.l1_edges") && sql.includes("'commit_created'")) {
			const generations = zip(params, [
				"gUsers",
				"gSources",
				"gSessions",
				"gRevisions",
				"gParsers",
			]);
			const created = new Map<string, Row>();
			const inGeneration = (edge: Row) =>
				has(generations, [
					edge.user_id,
					edge.source,
					edge.session_id,
					edge.evidence_revision,
					edge.evidence_parser_version,
				]);
			const generationFirst =
				sql.indexOf("{gRevisions") < sql.indexOf("LIMIT 1 BY");
			const candidates = store.edges.filter(
				(row) =>
					inRanges(params, row) &&
					row.relation === "commit_created" &&
					(params.commits as string[]).includes(String(row.to_id)),
			);
			for (const edge of generationFirst
				? pinned(candidates.filter(inGeneration), params, edgeKey)
				: pinned(candidates, params, edgeKey).filter(inGeneration)) {
				const ms = Date.parse(`${String(edge.observed_at).replace(" ", "T")}Z`);
				const group = JSON.stringify([
					edge.user_id,
					edge.source,
					edge.session_id,
					edge.to_id,
				]);
				const known = created.get(group);
				if (!known || Number(known.first_ms) > ms)
					created.set(group, {
						user_id: edge.user_id,
						source: edge.source,
						session_id: edge.session_id,
						to_id: edge.to_id,
						first_ms: ms,
					});
			}
			return [...created.values()];
		}
		if (sql.includes("rudel.l1_edges")) {
			const tuples = zip(params, [
				"eUsers",
				"eSources",
				"eSessions",
				"eIds",
				"eRevisions",
				"eParsers",
			]);
			const inGeneration = (edge: Row) =>
				has(tuples, [
					edge.user_id,
					edge.source,
					edge.session_id,
					edge.evidence_id,
					edge.evidence_revision,
					edge.evidence_parser_version,
				]);
			// Where the statement filters the generation: before picking each
			// key's latest version (inside it) or after it.
			const generationFirst =
				sql.indexOf("{eRevisions") < sql.indexOf("LIMIT 1 BY");
			const candidates = store.edges.filter((row) => inRanges(params, row));
			const rows = generationFirst
				? pinned(candidates.filter(inGeneration), params, edgeKey)
				: pinned(candidates, params, edgeKey).filter(inGeneration);
			const keys = [
				"user_id",
				"source",
				"session_id",
				"evidence_id",
				"relation",
			];
			return sql.includes("count() AS n")
				? counted(rows, keys)
				: limited(rows, keys, Number(params.cap));
		}
		if (
			sql.includes("rudel.github_pull_requests") &&
			!sql.includes("branchRepos")
		) {
			const pairs = zip(params, ["numberRepos", "numberValues"]);
			return store.pullRequests
				.filter((pr) => has(pairs, [pr.repository_id, pr.number]))
				.map(({ created_at, merged_at, closed_at, ...pr }) => ({
					...pr,
					created_text: created_at,
					merged_text: merged_at,
					closed_text: closed_at,
				}));
		}
		if (sql.includes("rudel.github_ci_runs") && sql.includes("runKinds")) {
			const tuples = zip(params, [
				"runRepos",
				"runKinds",
				"runIds",
				"runAttempts",
			]);
			return store.runs
				.filter((run) =>
					has(tuples, [run.repository_id, run.kind, run.run_id, run.attempt]),
				)
				.map(({ kind, created_at, started_at, completed_at, ...run }) => ({
					...run,
					run_kind: kind,
					created_text: created_at,
					started_text: started_at,
					completed_text: completed_at,
				}));
		}
		return [];
	};
	return { query } as unknown as ClickHouseExecutor;
}

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
		generation,
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
