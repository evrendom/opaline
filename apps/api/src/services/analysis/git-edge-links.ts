import { getLogger } from "@logtape/logtape";
import type { AnalysisFindOutput, AnalysisGitEvent } from "@rudel/api-routes";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { L1_EDGE_RESOLVER_VERSION } from "../l1-edges/l1-edge-derivation.js";
import {
	ciRunNodeId,
	commitNodeId,
	evidenceIdOf,
	idPrefixRange,
	pullRequestNodeId,
	type SessionIdentity,
	sessionScopeId,
	splitL1NodeId,
} from "../l1-edges/l1-edge-ids.js";
import {
	L1_EDGE_RESOLUTIONS_TABLE,
	L1_EDGES_BY_TARGET_TABLE,
	L1_EDGES_TABLE,
} from "../l1-edges/l1-edge-tables.js";
import type { Generation } from "../transcript-generations/generations.js";
import {
	assembleGitEvents,
	BRANCH_RUNS_CAP,
	branchName,
	CI_RUN_COLUMNS,
	type CiRunRow,
	CiRunRowSchema,
	clickHouseTime,
	emptyGitHubFacts,
	type GitHubAccess,
	type GitHubBinding,
	type GitHubFacts,
	type GitPageLinker,
	githubTimeMs,
	key,
	linkAtQueryTime,
	type ObservationGeneration,
	type PageToLink,
	PULL_REQUEST_COLUMNS,
	type PullRequestRow,
	PullRequestRowSchema,
	type RepositoryCoverage,
	type Resolved,
	resolveRepository,
	type Seed,
	type SessionCommit,
	seedBranch,
	seedFullSha,
	seedPrefix,
} from "./git-links.js";
import {
	ANALYSIS_QUERY_SETTINGS,
	chunkByParamBytes,
	PARAM_BYTES_PER_STATEMENT,
	paramValueBytes,
	query,
} from "./sql.js";

/**
 * `find source=git` links from the stored L1 edges (ADR 0003): an event's
 * pull requests and CI runs are followed through the edges its session's
 * worker build wrote (run → commit → pull request → CI), never resolved
 * again. An event is linked from edges only when its session's build is
 * current for the evidence find reads (or frozen after its transcript
 * expired), its evidence row has an active resolution of the same
 * generation, the worker resolved it to the repository the live bindings
 * do, and every repository its links touch has GitHub-side edges with
 * recorded coverage. Every other event is linked at query time, as before
 * edges existed, and says why. Counts are bounded by the coverage the edges
 * were built against as well as the live one, so a link the worker could
 * not have seen is never counted as absent.
 */

type GitEvent = AnalysisGitEvent;
type EdgeInfo = NonNullable<GitEvent["edges"]>;
export type EdgeStatus = EdgeInfo["status"];

const logger = getLogger(["rudel", "api", "analysis", "git-edges"]);

/** Edges read per evidence row, relation, commit or pull request; beyond it a count is unknown. */
export const EDGES_PER_RELATION = BRANCH_RUNS_CAP;
/** Rows one statement may return; ClickHouse refuses more than `max_result_rows`. */
const ROWS_PER_STATEMENT = 50_000;
/** Edges `find pullRequest=…` follows to sessions before it stops (truncated). */
export const PULL_REQUEST_EDGE_CAP = 5_000;
/** Commits of a pull request followed to sessions. */
const PULL_REQUEST_COMMIT_CAP = 1_000;
const DAY_MS = 86_400_000;

/** A row of `l1_edge_scope`, the worker's build record. */
export interface EdgeScopeState {
	builtRevision: number | null;
	resolverVersion: number | null;
	/** Session: the observation and transcript generations the build read. */
	input: unknown;
	/** Per repository, the collection coverage the build read. */
	coverage: unknown;
	frozenReason: string | null;
	builtAt: string | null;
	/**
	 * A build holds the lease or a request waits: rows of a newer revision
	 * may be written. Reads stay pinned to `builtRevision`.
	 */
	rebuilding: boolean;
}

/** Where the worker's build records come from (Postgres in production). */
export interface EdgeStateSource {
	scopes(
		organizationId: string,
		kind: "session" | "repository",
		scopeIds: readonly string[],
	): Promise<Map<string, EdgeScopeState>>;
}

/** Whether find reads edges; only the exact value `false` turns it off. */
export function isL1EdgeFindReadEnabled(): boolean {
	return process.env.L1_EDGES_FIND_READ !== "false";
}

/** Share of find pages whose edge links are compared with query time (0 to 1, default 0). */
export function l1EdgeFindShadowRate(): number {
	const rate = Number(process.env.L1_EDGES_FIND_SHADOW_RATE ?? "0");
	return Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0;
}

const GenerationInputSchema = z.object({
	revision: z.string(),
	parserVersion: z.number(),
	transcriptParserVersion: z.number(),
});
const SessionInputSchema = z.object({
	transcript: z
		.object({ revision: z.string(), parserVersion: z.number() })
		.nullable(),
	generation: GenerationInputSchema.nullable(),
	truncated: z.boolean(),
});
const CoverageEntrySchema = z.object({
	included: z.boolean(),
	prFrom: z.string().nullable(),
	ciFrom: z.string().nullable(),
	coveredThrough: z.string().nullable(),
});
type CoverageEntry = z.infer<typeof CoverageEntrySchema>;

/** The coverage a build recorded for a repository, or undefined when it recorded none. */
function recordedCoverage(
	state: EdgeScopeState | undefined,
	repositoryId: string,
): CoverageEntry | undefined {
	const coverage = state?.coverage;
	if (!coverage || typeof coverage !== "object") return undefined;
	const entry = CoverageEntrySchema.safeParse(
		(coverage as Record<string, unknown>)[repositoryId],
	);
	return entry.success ? entry.data : undefined;
}

/**
 * Whether a session's edges hold for the evidence find reads: `current` when
 * the build read the same observation and transcript generations under the
 * current rules without hitting its caps (a pending request for the same
 * generation changes nothing it read; reads stay pinned to the built
 * revision); `frozen` when its transcript expired and the edges of a
 * complete build were kept; otherwise `stale` or `not_built`.
 */
export function sessionEdgeStatus(
	state: EdgeScopeState | undefined,
	read: {
		generation: Pick<
			ObservationGeneration,
			"revision" | "parserVersion" | "transcriptParserVersion"
		> | null;
		transcript: { revision: string; parserVersion: number } | null;
	},
): EdgeStatus {
	if (!state || state.builtRevision === null) return "not_built";
	const input = SessionInputSchema.safeParse(state.input);
	// A build that hit its evidence caps has no edges for what it left out.
	if (!input.success || input.data.truncated) return "stale";
	// A freeze keeps the retained build's rules, so they are checked too.
	if (state.resolverVersion !== L1_EDGE_RESOLVER_VERSION) return "stale";
	if (state.frozenReason) return "frozen";
	const built = input.data.generation;
	const generationMatches =
		built === null || read.generation === null
			? built === read.generation
			: built.revision === read.generation.revision &&
				built.parserVersion === read.generation.parserVersion &&
				built.transcriptParserVersion ===
					read.generation.transcriptParserVersion;
	const transcript = input.data.transcript;
	const transcriptMatches =
		transcript === null || read.transcript === null
			? transcript === read.transcript
			: transcript.revision === read.transcript.revision &&
				transcript.parserVersion === read.transcript.parserVersion;
	return generationMatches && transcriptMatches ? "current" : "stale";
}

/**
 * Whether a session's edges answer which pull requests it touched, without
 * comparing generations (`find pullRequest=…` counts the sessions it cannot
 * vouch for): built under the current rules, not truncated, not being
 * rebuilt. A new transcript or observation generation always queues a
 * rebuild, so a stale build is a rebuilding one.
 */
export function settledForReverse(state: EdgeScopeState | undefined): boolean {
	if (!state || state.builtRevision === null || state.rebuilding) return false;
	const input = SessionInputSchema.safeParse(state.input);
	return (
		input.success &&
		!input.data.truncated &&
		state.resolverVersion === L1_EDGE_RESOLVER_VERSION
	);
}

/**
 * The coverage counts from edges may rely on: what every source covers, so
 * the latest start and the earliest end. A missing bound in any source is
 * unknown in the result.
 */
export function intersectCoverage(
	sources: readonly Pick<
		CoverageEntry,
		"prFrom" | "ciFrom" | "coveredThrough"
	>[],
): Pick<CoverageEntry, "prFrom" | "ciFrom" | "coveredThrough"> {
	const pick = (
		values: readonly (string | null)[],
		choose: (left: number, right: number) => number,
	) => {
		if (values.length === 0 || values.some((value) => value === null))
			return null;
		const times = values.map((value) => githubTimeMs(value ?? ""));
		if (times.some((time) => !Number.isFinite(time))) return null;
		return new Date(
			times.reduce((left, right) => choose(left, right)),
		).toISOString();
	};
	return {
		prFrom: pick(
			sources.map((source) => source.prFrom),
			Math.max,
		),
		// ciCount reads `ciFrom ?? prFrom`; the intersection keeps that start.
		ciFrom: pick(
			sources.map((source) => source.ciFrom ?? source.prFrom),
			Math.max,
		),
		coveredThrough: pick(
			sources.map((source) => source.coveredThrough),
			Math.min,
		),
	};
}

const SessionEdgeSchema = z.object({
	user_id: z.string(),
	source: z.string(),
	session_id: z.string(),
	evidence_id: z.string(),
	relation: z.string(),
	to_kind: z.string(),
	to_id: z.string(),
	match_rule: z.string(),
	details: z.string(),
	observed_text: z.string(),
});
type SessionEdgeRow = z.infer<typeof SessionEdgeSchema>;
const SessionEdgeCountSchema = z.object({
	user_id: z.string(),
	source: z.string(),
	session_id: z.string(),
	evidence_id: z.string(),
	relation: z.string(),
	n: z.coerce.number(),
});
const ResolutionSchema = z.object({
	user_id: z.string(),
	source: z.string(),
	session_id: z.string(),
	evidence_id: z.string(),
	target: z.string(),
	status: z.string(),
	candidate_count: z.coerce.number(),
	repository_id: z.string(),
	revision_text: z.string(),
});
type ResolutionRow = z.infer<typeof ResolutionSchema>;
const HopSchema = z.object({
	from_id: z.string(),
	relation: z.string(),
	to_id: z.string(),
	match_rule: z.string(),
	details: z.string(),
	observed_text: z.string(),
});
type HopRow = z.infer<typeof HopSchema>;
const HopCountSchema = z.object({
	from_id: z.string(),
	relation: z.string(),
	n: z.coerce.number(),
});
const MergeCommitSchema = z.object({ to_id: z.string(), from_id: z.string() });
const CreatedSchema = z.object({
	user_id: z.string(),
	source: z.string(),
	session_id: z.string(),
	to_id: z.string(),
	first_ms: z.coerce.number(),
});
const DetailsSchema = z
	.object({
		lastSeenHeadSha: z.string().optional(),
		runCreatedAt: z.string().optional(),
	})
	.catch({});

/** An event of a session whose edges may link it. */
interface Candidate {
	index: number;
	seed: Seed;
	session: SessionIdentity;
	status: "current" | "frozen";
	builtAt: string | null;
	/** The completed build revision every session row is read at. */
	pin: number;
	sessionScope: EdgeScopeState;
	live: Omit<Resolved, "seed">;
	edges: SessionEdgeRow[];
	resolutions: Map<string, ResolutionRow>;
	/** The commit node its links follow, when it names or resolved one. */
	commit: string | null;
	capped: boolean;
}

interface Fallback {
	index: number;
	seed: Seed;
	status: Exclude<EdgeStatus, "current" | "frozen">;
	builtAt: string | null;
}

/** How long a sampled shadow comparison may run after the page was returned. */
const SHADOW_BUDGET_MS = 10_000;

/** Links a page from edges where they hold, at query time elsewhere. */
export function edgeLinker(options: {
	state: EdgeStateSource;
	shadowRate: number;
	random?: () => number;
	/**
	 * The executor the detached comparison runs on, outside the request's
	 * cancellation (the page's executor shares it); the page's when absent.
	 */
	shadowExecutor?: ClickHouseExecutor;
	/** Called with the detached shadow comparison (tests await it). */
	onShadow?: (comparison: Promise<void>) => void;
}): GitPageLinker {
	return async (page) => {
		const linked = await linkFromEdges(page, options.state);
		const random = options.random ?? Math.random;
		if (options.shadowRate > 0 && random() < options.shadowRate) {
			// Detached and bounded: a comparison never delays or fails the find.
			const comparison = shadowCompare(
				{ ...page, executor: options.shadowExecutor ?? page.executor },
				linked,
				SHADOW_BUDGET_MS,
			);
			options.onShadow?.(comparison);
		}
		return { events: linked, notes: [] };
	};
}

/** The page's events in page order, each with how it was linked. */
async function linkFromEdges(
	page: PageToLink,
	state: EdgeStateSource,
): Promise<GitEvent[]> {
	// Without visible GitHub outcomes nothing is linked either way.
	if (page.access.visibility === "hidden") return linkAtQueryTime(page);
	const transcripts = new Map(
		page.batches.flatMap((batch) =>
			batch.generations.map(
				(generation) => [generation.sessionId, generation] as const,
			),
		),
	);
	const identities = new Map<string, SessionIdentity>();
	for (const seed of page.seeds) {
		const session = page.sessions.get(seed.sessionId);
		if (session)
			identities.set(seed.sessionId, {
				userId: session.user_id,
				source: session.source,
				sessionId: session.session_id,
			});
	}
	const scopes = await state.scopes(
		page.organizationId,
		"session",
		[...identities.values()].map(sessionScopeId),
	);
	// No session of the page was ever queued for edges (the worker is off):
	// the page is exactly what query time gives, with no link metadata.
	if (scopes.size === 0) return linkAtQueryTime(page);
	const fallbacks: Fallback[] = [];
	const candidates: Candidate[] = [];
	page.seeds.forEach((seed, index) => {
		const session = identities.get(seed.sessionId);
		const scope = session ? scopes.get(sessionScopeId(session)) : undefined;
		const transcript = transcripts.get(seed.sessionId);
		const status = sessionEdgeStatus(scope, {
			generation: page.generations.get(seed.sessionId) ?? null,
			transcript: transcript
				? {
						revision: transcript.revision,
						parserVersion: transcript.parserVersion,
					}
				: null,
		});
		const builtAt = scope?.builtAt ?? null;
		if (
			!session ||
			!scope ||
			scope.builtRevision === null ||
			(status !== "current" && status !== "frozen")
		) {
			fallbacks.push({
				index,
				seed,
				status: status === "current" || status === "frozen" ? "stale" : status,
				builtAt,
			});
			return;
		}
		candidates.push({
			index,
			seed,
			session,
			status,
			builtAt,
			pin: scope.builtRevision,
			sessionScope: scope,
			live: resolveRepository(
				seed,
				page.sessions.get(seed.sessionId)?.repository ?? "",
				page.access,
			),
			edges: [],
			resolutions: new Map(),
			commit: null,
			capped: false,
		});
	});

	const linked = await linkCandidates(page, state, candidates);
	fallbacks.push(...linked.fallbacks);
	const events = new Map<number, GitEvent>(linked.events);
	if (fallbacks.length > 0) {
		const queried = await linkAtQueryTime({
			...page,
			seeds: fallbacks.map((fallback) => fallback.seed),
		});
		fallbacks.forEach((fallback, position) => {
			const event = queried[position];
			if (event)
				events.set(fallback.index, {
					...event,
					edges: {
						linkedBy: "query",
						status: fallback.status,
						builtAt: fallback.builtAt,
					},
				});
		});
	}
	return page.seeds.flatMap((_, index) => {
		const event = events.get(index);
		return event ? [event] : [];
	});
}

/**
 * Links the candidates whose edges hold; the rest are returned to be linked
 * at query time with the reason.
 */
async function linkCandidates(
	page: PageToLink,
	state: EdgeStateSource,
	all: readonly Candidate[],
): Promise<{ events: [number, GitEvent][]; fallbacks: Fallback[] }> {
	const fallbacks: Fallback[] = [];
	const drop = (candidate: Candidate, status: Fallback["status"]) =>
		fallbacks.push({
			index: candidate.index,
			seed: candidate.seed,
			status,
			builtAt: candidate.builtAt,
		});
	if (all.length === 0) return { events: [], fallbacks };
	const { executor, organizationId } = page;
	const repositoryIds = page.access.bindings.map(
		(binding) => binding.repositoryId,
	);

	const evidence = all.map((candidate) => ({
		session: candidate.session,
		pin: candidate.pin,
		evidenceId: evidenceIdOf(candidate.seed),
		revision: candidate.seed.generation?.revision ?? "0",
		parserVersion: candidate.seed.generation?.parserVersion ?? 0,
	}));
	const [resolutions, sessionEdges] = await Promise.all([
		readResolutions(executor, organizationId, evidence),
		readSessionEdges(executor, organizationId, evidence),
	]);
	const candidates: Candidate[] = [];
	for (const [position, candidate] of all.entries()) {
		const { evidenceId, revision } = evidence[position] ?? {
			evidenceId: "",
			revision: "",
		};
		const evidenceKey = rowKey(candidate.session, evidenceId);
		for (const row of resolutions.get(evidenceKey) ?? [])
			if (row.revision_text === revision)
				candidate.resolutions.set(row.target, row);
		candidate.edges = sessionEdges.rows.get(evidenceKey) ?? [];
		candidate.capped = sessionEdges.capped.has(evidenceKey);
		const status = planCandidate(candidate);
		if (status) drop(candidate, status);
		else candidates.push(candidate);
	}

	// Commits → pull requests and CI; pull requests → CI and merge commits.
	const commits = new Set(
		candidates.flatMap((candidate) =>
			candidate.commit ? [candidate.commit] : [],
		),
	);
	const commitHops = await readHops(executor, organizationId, repositoryIds, {
		fromKind: "commit",
		fromIds: [...commits],
		relations: ["commit_in_pr", "ci_on_sha"],
	});
	const pullRequests = new Set<string>();
	for (const candidate of candidates) {
		for (const edge of candidate.edges)
			if (edge.to_kind === "pull_request") pullRequests.add(edge.to_id);
		for (const hop of candidate.commit
			? (commitHops.rows.get(candidate.commit) ?? [])
			: [])
			if (hop.relation === "commit_in_pr") pullRequests.add(hop.to_id);
	}
	const [pullRequestHops, mergeCommits] = await Promise.all([
		readHops(executor, organizationId, repositoryIds, {
			fromKind: "pull_request",
			fromIds: [...pullRequests],
			relations: ["ci_for_pr"],
		}),
		readMergeCommits(executor, organizationId, repositoryIds, [
			...pullRequests,
		]),
	]);
	const mergeHops = await readHops(executor, organizationId, repositoryIds, {
		fromKind: "commit",
		fromIds: [...new Set([...mergeCommits.values()].flat())].filter(
			(id) => !commits.has(id),
		),
		relations: ["ci_on_sha"],
	});
	const hops = {
		rows: new Map([
			...commitHops.rows,
			...mergeHops.rows,
			...pullRequestHops.rows,
		]),
		capped: new Set([
			...commitHops.capped,
			...mergeHops.capped,
			...pullRequestHops.capped,
		]),
	};

	// When the session created the commit dates its CI history (see ciCount).
	const created = await readCreatedCommits(
		executor,
		organizationId,
		candidates.flatMap((candidate) => {
			const generation = page.generations.get(candidate.seed.sessionId);
			return candidate.commit &&
				generation &&
				candidate.seed.kind !== "commit_created"
				? [
						{
							session: candidate.session,
							pin: candidate.pin,
							generation,
							commit: candidate.commit,
						},
					]
				: [];
		}),
	);
	// Every session row above was read at its scope's built revision. Rows of
	// a newer revision mean a build wrote after the one that completed (in
	// flight, or failed before completing); merges may then have replaced
	// rows read above, so those sessions are linked at query time.
	const rebuilt = await unpublishedSessions(
		executor,
		organizationId,
		candidates,
	);
	const [prRows, runRows] = await Promise.all([
		readPullRequests(executor, organizationId, repositoryIds, [
			...pullRequests,
		]),
		readCiRuns(executor, organizationId, repositoryIds, [
			...candidates.flatMap((candidate) => candidate.edges),
			...[...hops.rows.values()].flat(),
		]),
	]);
	const repositories = new Set(
		candidates.flatMap((candidate) => [
			...(candidate.live.repository ? [candidate.live.repository.id] : []),
			...candidate.edges
				.filter((edge) => edge.to_kind === "pull_request")
				.map((edge) => splitL1NodeId(edge.to_id)[0] ?? ""),
		]),
	);
	for (const id of pullRequests) repositories.add(splitL1NodeId(id)[0] ?? "");
	const repositoryScopes = await state.scopes(
		organizationId,
		"repository",
		[...repositories].filter((id) => id !== ""),
	);

	const events: [number, GitEvent][] = [];
	for (const candidate of candidates) {
		if (rebuilt.has(sessionKey(candidate.session))) {
			drop(candidate, "stale");
			continue;
		}
		const facts = eventFacts(candidate, {
			hops,
			mergeCommits,
			prRows,
			runRows,
		});
		const repository = candidate.live.repository;
		const required = new Set([
			...(repository ? [repository.id] : []),
			...[...facts.pullRequests.values()].map((pr) => pr.repository_id),
		]);
		const coverage = edgeCoverage(
			[...required],
			page.access,
			candidate.sessionScope,
			repositoryScopes,
		);
		if (typeof coverage === "string") {
			drop(candidate, coverage);
			continue;
		}
		const commits = new Map<string, SessionCommit[]>();
		const createdMs = candidate.commit
			? created.get(rowKey(candidate.session, candidate.commit))
			: undefined;
		if (createdMs !== undefined && candidate.commit)
			commits.set(candidate.seed.sessionId, [
				{
					shortSha: splitL1NodeId(candidate.commit)[1] ?? "",
					atMs: createdMs,
				},
			]);
		const live = candidate.live.github;
		const bounded = coverage.get(repository?.id ?? "");
		const [event] = assembleGitEvents(
			[
				{
					seed: candidate.seed,
					repository: candidate.live.repository,
					github: bounded ? { ...live, ...bounded } : live,
				},
			],
			facts,
			page.checks,
			page.sessions,
			{
				...page.access,
				repositories: new Map(
					[...page.access.repositories].map(([id, entry]) => {
						const bound = coverage.get(id);
						return [id, bound ? { ...entry, ...bound } : entry];
					}),
				),
			},
			commits,
		);
		if (!event) continue;
		const capped =
			candidate.capped || touchesCapped(candidate, facts, hops, mergeCommits);
		events.push([
			candidate.index,
			{
				...event,
				// The live coverage; the count's boundary is in ciRunCountThrough.
				github: live,
				...(capped && event.ciRunCountUnknown === null
					? {
							ciRunCount: null,
							ciRunCountThrough: null,
							ciRunCountUnknown: "search_capped" as const,
						}
					: {}),
				edges: {
					linkedBy: "edges",
					status: candidate.status,
					builtAt: candidate.builtAt,
				},
			},
		]);
	}
	return { events, fallbacks };
}

/**
 * Checks the evidence row's resolutions against the live bindings and sets
 * the commit its links follow; returns why its edges cannot be used. Edges
 * into repositories the workspace no longer binds need no check here: the
 * pull request and CI rows they point to are read from bound repositories
 * only, as at query time.
 */
function planCandidate(candidate: Candidate): Fallback["status"] | null {
	const { seed, live } = candidate;
	const repository = candidate.resolutions.get("repository");
	// Built from evidence not resolved in this generation, or before a
	// binding changed: the worker's repository is not the live one.
	if (!repository) return "stale";
	if (live.repository) {
		if (
			repository.status !== "linked" ||
			repository.repository_id !== live.repository.id
		)
			return "stale";
	} else if (repository.status !== live.github.status) return "stale";
	if (!live.repository) return null;
	const repositoryId = live.repository.id;
	const prefix = seedPrefix(seed);
	if (prefix) {
		const commit = candidate.resolutions.get("commit");
		if (!commit) return "stale";
		if (commit.status === "linked") {
			const edge = candidate.edges.find(
				(row) => row.to_kind === "commit" && row.match_rule === "unique_prefix",
			);
			if (!edge) return "stale";
			candidate.commit = edge.to_id;
		}
	} else {
		const full = seedFullSha(seed);
		if (full) candidate.commit = commitNodeId(repositoryId, full);
	}
	const required: [boolean, string][] = [
		[seed.prNumber > 0, "pull_request"],
		[seedBranch(seed) !== "", "branch_pull_request"],
		[seed.kind === "ci_check" && seed.runId !== "", "ci_run"],
		[seed.kind === "ci_check" && seedBranch(seed) !== "", "branch_ci_run"],
	];
	for (const [needed, target] of required)
		if (needed && !candidate.resolutions.has(target)) return "stale";
	const named = candidate.resolutions.get("pull_request");
	if (
		seed.prNumber > 0 &&
		named?.status === "linked" &&
		!candidate.edges.some(
			(edge) => edge.relation === "pr_named" || edge.relation === "pr_listed",
		)
	)
		return "stale";
	return null;
}

/** What GitHub holds for one event, as `assembleGitEvents` reads it, from its edges. */
function eventFacts(
	candidate: Candidate,
	read: {
		hops: { rows: Map<string, HopRow[]> };
		mergeCommits: Map<string, string[]>;
		prRows: Map<string, PullRequestRow>;
		runRows: Map<string, CiRunRow>;
	},
): GitHubFacts {
	const facts = emptyGitHubFacts();
	const { seed, live, edges } = candidate;
	const repositoryId = live.repository?.id;
	if (!repositoryId) return facts;
	const addPullRequest = (nodeId: string) => {
		const row = read.prRows.get(nodeId);
		if (row) facts.pullRequests.set(key(row.repository_id, row.number), row);
		return row;
	};
	const runs = (rows: readonly { to_id: string }[]) =>
		rows.flatMap((row) => {
			const run = read.runRows.get(row.to_id);
			return run ? [run] : [];
		});

	const prefix = seedPrefix(seed);
	const commit = candidate.resolutions.get("commit");
	if (prefix && commit)
		facts.shaCandidates.set(
			key(repositoryId, prefix),
			candidate.commit
				? [splitL1NodeId(candidate.commit)[1] ?? ""]
				: // The worker kept how many collected SHAs matched, not which;
					// only the count of an unresolved prefix is shown.
					Array.from(
						{ length: commit.candidate_count },
						(_, index) => `candidate ${index + 1}`,
					),
		);
	for (const edge of edges)
		if (edge.relation === "pr_named" || edge.relation === "pr_listed")
			addPullRequest(edge.to_id);
	const branch = seedBranch(seed);
	if (branch) {
		const heads = edges.filter((edge) => edge.relation === "pr_branch_head");
		facts.branchPullRequests.set(
			key(repositoryId, branchName(branch)),
			heads.flatMap((edge) => {
				const row = addPullRequest(edge.to_id);
				return row ? [key(row.repository_id, row.number)] : [];
			}),
		);
	}
	if (candidate.commit) {
		const sha = splitL1NodeId(candidate.commit)[1] ?? "";
		const hops = read.hops.rows.get(candidate.commit) ?? [];
		facts.memberships.set(
			key(repositoryId, sha),
			hops
				.filter((hop) => hop.relation === "commit_in_pr")
				.flatMap((hop) => {
					const row = addPullRequest(hop.to_id);
					return row
						? [
								{
									prNumber: row.number,
									lastSeenHeadSha:
										DetailsSchema.parse(parseJson(hop.details))
											.lastSeenHeadSha ?? "",
								},
							]
						: [];
				}),
		);
		facts.shaRuns.set(
			key(repositoryId, sha),
			runs(hops.filter((hop) => hop.relation === "ci_on_sha")),
		);
	}
	if (seed.kind === "ci_check" && seed.runId)
		facts.namedRuns.set(
			key(repositoryId, seed.runId),
			runs(edges.filter((edge) => edge.relation === "ci_named")),
		);
	if (seed.kind === "ci_check" && branch) {
		const branchKey = key(repositoryId, branchName(branch));
		facts.branchRuns.set(
			branchKey,
			runs(edges.filter((edge) => edge.relation === "ci_on_branch_window")),
		);
		if (candidate.resolutions.get("branch_ci_run")?.status === "capped")
			facts.branchRunsCappedAt.set(branchKey, Number.POSITIVE_INFINITY);
	}
	for (const pr of [...facts.pullRequests.values()]) {
		const node = pullRequestNodeId(pr.repository_id, pr.number);
		facts.pullRequestRuns.set(
			key(pr.repository_id, pr.number),
			(read.hops.rows.get(node) ?? []).flatMap((hop) => {
				const run = read.runRows.get(hop.to_id);
				return run
					? [{ ...run, pr_number: pr.number, link_basis: hop.match_rule }]
					: [];
			}),
		);
		// Only a merged PR's merge commit has an edge: an open PR's is a test merge.
		for (const merge of read.mergeCommits.get(node) ?? []) {
			const mergeKey = key(pr.repository_id, splitL1NodeId(merge)[1] ?? "");
			if (!facts.shaRuns.has(mergeKey))
				facts.shaRuns.set(
					mergeKey,
					runs(
						(read.hops.rows.get(merge) ?? []).filter(
							(hop) => hop.relation === "ci_on_sha",
						),
					),
				);
		}
	}
	return facts;
}

/** Whether a lookup behind the event's links stopped at `EDGES_PER_RELATION`. */
function touchesCapped(
	candidate: Candidate,
	facts: GitHubFacts,
	hops: { capped: Set<string> },
	mergeCommits: ReadonlyMap<string, readonly string[]>,
): boolean {
	const pullRequests = [...facts.pullRequests.values()].map((pr) =>
		pullRequestNodeId(pr.repository_id, pr.number),
	);
	const nodes = [
		...(candidate.commit ? [candidate.commit] : []),
		...pullRequests,
		...pullRequests.flatMap((node) => mergeCommits.get(node) ?? []),
	];
	return nodes.some((node) => hops.capped.has(node));
}

/**
 * Per repository the event's links touch, the coverage its counts may rely
 * on: the live collection, the session build's and the repository build's,
 * intersected. Returns why the edges cannot be used when a repository has no
 * GitHub-side edges or was built against a collection that did not include
 * it while the live one does.
 */
function edgeCoverage(
	repositoryIds: readonly string[],
	access: GitHubAccess,
	sessionScope: EdgeScopeState,
	repositoryScopes: ReadonlyMap<string, EdgeScopeState>,
):
	| Map<
			string,
			Pick<RepositoryCoverage, "prFrom" | "ciFrom" | "coveredThrough">
	  >
	| Fallback["status"] {
	const bounded = new Map<
		string,
		Pick<RepositoryCoverage, "prFrom" | "ciFrom" | "coveredThrough">
	>();
	for (const repositoryId of repositoryIds) {
		const repositoryScope = repositoryScopes.get(repositoryId);
		const built = recordedCoverage(repositoryScope, repositoryId);
		if (!repositoryScope || repositoryScope.builtRevision === null || !built)
			return "not_built";
		if (repositoryScope.resolverVersion !== L1_EDGE_RESOLVER_VERSION)
			return "stale";
		const session = recordedCoverage(sessionScope, repositoryId);
		if (!session) return "stale";
		const live = access.repositories.get(repositoryId);
		if (live?.included && (!session.included || !built.included))
			return "stale";
		bounded.set(
			repositoryId,
			intersectCoverage([
				live ?? { prFrom: null, ciFrom: null, coveredThrough: null },
				session,
				built,
			]),
		);
	}
	return bounded;
}

interface EvidenceKey {
	session: SessionIdentity;
	/** The session scope's built revision the row is read at. */
	pin: number;
	evidenceId: string;
	revision: string;
	parserVersion: number;
}

function rowKey(session: SessionIdentity, id: string): string {
	return JSON.stringify([
		session.userId,
		session.source,
		session.sessionId,
		id,
	]);
}

function sessionKey(session: SessionIdentity): string {
	return rowKey(session, "");
}

function edgeRowKey(row: {
	user_id: string;
	source: string;
	session_id: string;
	evidence_id: string;
}): string {
	return rowKey(
		{ userId: row.user_id, source: row.source, sessionId: row.session_id },
		row.evidence_id,
	);
}

/** `from_id` ranges of the sessions' run and session nodes, as SQL and parameters. */
function sessionRanges(sessions: readonly SessionIdentity[]): {
	sql: string;
	params: Record<string, string>;
} {
	const unique = [
		...new Map(sessions.map((session) => [sessionScopeId(session), session])),
	];
	const params: Record<string, string> = {};
	const clauses = unique.map(([scopeId], index) => {
		const range = idPrefixRange(scopeId);
		params[`rangeFrom${index}`] = range.from;
		params[`rangeTo${index}`] = range.to;
		return `(from_id >= {rangeFrom${index}:String} AND from_id < {rangeTo${index}:String})`;
	});
	return { sql: `(${clauses.join(" OR ")})`, params };
}

/**
 * Keeps a row only up to its session's pinned build revision, as SQL and
 * parameters: the latest version of each key at or below the pin is the
 * completed build's (every build rewrites or retracts every key it had).
 */
function pinnedRevision(
	rows: readonly { session: SessionIdentity; pin: number }[],
): {
	sql: string;
	params: Record<string, string[]>;
} {
	const pins = new Map(
		rows.map((row) => [
			[row.session.userId, row.session.source, row.session.sessionId].join(
				"\u001f",
			),
			String(row.pin),
		]),
	);
	return {
		sql: "revision <= toUInt64OrZero(arrayElement({pinValues:Array(String)}, indexOf({pinKeys:Array(String)}, concat(user_id, char(31), toString(source), char(31), session_id))))",
		params: { pinKeys: [...pins.keys()], pinValues: [...pins.values()] },
	};
}

function evidenceTuples(evidence: readonly EvidenceKey[]) {
	return {
		eUsers: evidence.map((row) => row.session.userId),
		eSources: evidence.map((row) => row.session.source),
		eSessions: evidence.map((row) => row.session.sessionId),
		eIds: evidence.map((row) => row.evidenceId),
		eRevisions: evidence.map((row) => row.revision),
		eParsers: evidence.map((row) => row.parserVersion),
	};
}

/** Parameter values of an evidence key, for chunking statements by URL size. */
function evidenceValues(row: EvidenceKey): (string | number)[] {
	return [
		row.session.userId,
		row.session.source,
		row.session.sessionId,
		row.evidenceId,
		row.revision,
		row.parserVersion,
		// The session's range and pin.
		sessionScopeId(row.session),
		sessionScopeId(row.session),
		String(row.pin),
	];
}

/**
 * Resolutions of the evidence rows as the completed build left them (every
 * generation; callers keep the one they read).
 */
async function readResolutions(
	executor: ClickHouseExecutor,
	organizationId: string,
	evidence: readonly EvidenceKey[],
): Promise<Map<string, ResolutionRow[]>> {
	const found = new Map<string, ResolutionRow[]>();
	for (const chunk of chunkByParamBytes(evidence, evidenceValues)) {
		const pin = pinnedRevision(chunk);
		const rows = await query(executor, ResolutionSchema, {
			query: `SELECT user_id, source, session_id, evidence_id, target, status, candidate_count, repository_id, revision_text
				FROM (
					SELECT user_id, source, session_id, evidence_id, target, status, candidate_count, repository_id,
						toString(evidence_revision) AS revision_text, is_active, revision
					FROM ${getSafeClickHouseTable(L1_EDGE_RESOLUTIONS_TABLE)}
					WHERE organization_id = {organizationId:String}
						AND (user_id, source, session_id, evidence_id) IN (
							SELECT t.1, t.2, t.3, t.4 FROM (SELECT arrayJoin(arrayZip(
								{eUsers:Array(String)}, {eSources:Array(String)}, {eSessions:Array(String)}, {eIds:Array(String)})) AS t))
						AND ${pin.sql}
					ORDER BY revision DESC
					LIMIT 1 BY user_id, source, session_id, evidence_id, target
				)
				WHERE is_active = 1`,
			query_params: {
				organizationId,
				...evidenceTuples(chunk),
				...pin.params,
			},
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		});
		for (const row of rows) append(found, edgeRowKey(row), row);
	}
	return found;
}

/**
 * The evidence rows' own edges in the generation each was read in, as the
 * completed build left them, at most `EDGES_PER_RELATION` per row and
 * relation (`capped` names the rows that had more). Counted first, so no
 * statement returns more than `ROWS_PER_STATEMENT` rows.
 */
async function readSessionEdges(
	executor: ClickHouseExecutor,
	organizationId: string,
	evidence: readonly EvidenceKey[],
): Promise<{ rows: Map<string, SessionEdgeRow[]>; capped: Set<string> }> {
	const rows = new Map<string, SessionEdgeRow[]>();
	const capped = new Set<string>();
	const table = getSafeClickHouseTable(L1_EDGES_TABLE);
	// The completed build's version of each edge key, active ones only.
	const published = (chunk: readonly EvidenceKey[]) => {
		const ranges = sessionRanges(chunk.map((row) => row.session));
		const pin = pinnedRevision(chunk);
		return {
			// The latest version of each key at or below the pin first, then
			// activity and generation: a retraction must hide the older row.
			sql: `(
				SELECT * FROM (
					SELECT user_id, source, session_id, from_kind, from_id, evidence_id, relation, to_kind, to_id,
						match_rule, details, observed_at, is_active, revision, evidence_revision, evidence_parser_version
					FROM ${table}
					WHERE organization_id = {organizationId:String} AND from_kind IN ('run', 'session') AND ${ranges.sql}
						AND (user_id, source, session_id, evidence_id) IN (
							SELECT t.1, t.2, t.3, t.4 FROM (SELECT arrayJoin(arrayZip(
								{eUsers:Array(String)}, {eSources:Array(String)}, {eSessions:Array(String)}, {eIds:Array(String)})) AS t))
						AND ${pin.sql}
					ORDER BY revision DESC
					LIMIT 1 BY from_kind, from_id, relation, to_kind, to_id, evidence_id
				)
				WHERE is_active = 1
					AND (user_id, source, session_id, evidence_id, toString(evidence_revision), evidence_parser_version) IN (
						SELECT t.1, t.2, t.3, t.4, t.5, t.6 FROM (SELECT arrayJoin(arrayZip(
							{eUsers:Array(String)}, {eSources:Array(String)}, {eSessions:Array(String)}, {eIds:Array(String)},
							{eRevisions:Array(String)}, {eParsers:Array(UInt16)})) AS t))
			)`,
			params: {
				organizationId,
				...ranges.params,
				...evidenceTuples(chunk),
				...pin.params,
			},
		};
	};
	for (const chunk of chunkByParamBytes(evidence, evidenceValues)) {
		const source = published(chunk);
		const counts = await query(executor, SessionEdgeCountSchema, {
			query: `SELECT user_id, source, session_id, evidence_id, relation, count() AS n
				FROM ${source.sql} WHERE is_active = 1
				GROUP BY user_id, source, session_id, evidence_id, relation`,
			query_params: source.params,
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		});
		const expected = new Map<string, number>();
		for (const count of counts) {
			const evidenceKey = edgeRowKey(count);
			if (count.n > EDGES_PER_RELATION) capped.add(evidenceKey);
			expected.set(
				evidenceKey,
				(expected.get(evidenceKey) ?? 0) +
					Math.min(count.n, EDGES_PER_RELATION),
			);
		}
		const linked = chunk.filter((row) =>
			expected.has(rowKey(row.session, row.evidenceId)),
		);
		for (const part of chunkByRows(
			linked,
			(row) => expected.get(rowKey(row.session, row.evidenceId)) ?? 0,
		)) {
			const partSource = published(part);
			for (const row of await query(executor, SessionEdgeSchema, {
				query: `SELECT user_id, source, session_id, evidence_id, relation, to_kind, to_id, match_rule, details,
						toString(observed_at) AS observed_text
					FROM ${partSource.sql} WHERE is_active = 1
					ORDER BY user_id, source, session_id, evidence_id, relation, to_id
					LIMIT {cap:UInt32} BY user_id, source, session_id, evidence_id, relation`,
				query_params: { ...partSource.params, cap: EDGES_PER_RELATION },
				clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
			}))
				append(rows, edgeRowKey(row), row);
		}
	}
	return { rows, capped };
}

const NewestSchema = z.object({
	user_id: z.string(),
	source: z.string(),
	session_id: z.string(),
	newest: z.string(),
});

/**
 * Sessions with edge or resolution rows of a revision above their pin: a
 * build wrote after the one that completed, so the pinned rows may no longer
 * all be there. Read after the pinned reads (a publication fence).
 */
async function unpublishedSessions(
	executor: ClickHouseExecutor,
	organizationId: string,
	candidates: readonly Candidate[],
): Promise<Set<string>> {
	const sessions = [
		...new Map(
			candidates.map((candidate) => [
				sessionKey(candidate.session),
				{ session: candidate.session, pin: candidate.pin },
			]),
		).values(),
	];
	const pins = new Map(
		sessions.map((row) => [sessionKey(row.session), row.pin]),
	);
	const newer = new Set<string>();
	const check = (rows: z.infer<typeof NewestSchema>[]) => {
		for (const row of rows) {
			const key = sessionKey({
				userId: row.user_id,
				source: row.source,
				sessionId: row.session_id,
			});
			if (BigInt(row.newest) > BigInt(pins.get(key) ?? 0)) newer.add(key);
		}
	};
	for (const chunk of chunkByParamBytes(sessions, (row) => [
		sessionScopeId(row.session),
		sessionScopeId(row.session),
		row.session.userId,
		row.session.source,
		row.session.sessionId,
	])) {
		const ranges = sessionRanges(chunk.map((row) => row.session));
		check(
			await query(executor, NewestSchema, {
				query: `SELECT user_id, source, session_id, toString(max(revision)) AS newest
					FROM ${getSafeClickHouseTable(L1_EDGES_TABLE)}
					WHERE organization_id = {organizationId:String} AND from_kind IN ('run', 'session') AND ${ranges.sql}
					GROUP BY user_id, source, session_id`,
				query_params: { organizationId, ...ranges.params },
				clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
			}),
		);
		check(
			await query(executor, NewestSchema, {
				query: `SELECT user_id, source, session_id, toString(max(revision)) AS newest
					FROM ${getSafeClickHouseTable(L1_EDGE_RESOLUTIONS_TABLE)}
					WHERE organization_id = {organizationId:String}
						AND (user_id, source, session_id) IN (
							SELECT t.1, t.2, t.3 FROM (SELECT arrayJoin(arrayZip(
								{sUsers:Array(String)}, {sSources:Array(String)}, {sSessions:Array(String)})) AS t))
					GROUP BY user_id, source, session_id`,
				query_params: {
					organizationId,
					sUsers: chunk.map((row) => row.session.userId),
					sSources: chunk.map((row) => row.session.source),
					sSessions: chunk.map((row) => row.session.sessionId),
				},
				clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
			}),
		);
	}
	return newer;
}

/**
 * Active GitHub-side edges from the nodes (commits or pull requests) of
 * actively bound repositories, at most `EDGES_PER_RELATION` per node and
 * relation (`capped` names the nodes that had more). A commit's
 * `commit_in_pr` edges are its PR memberships only: a merged PR's merge
 * commit is followed from the PR, never as one of its commits. GitHub-side
 * edges are never retracted; one a repository build is still writing only
 * adds a link its recorded coverage does not count.
 */
async function readHops(
	executor: ClickHouseExecutor,
	organizationId: string,
	repositoryIds: readonly string[],
	input: {
		fromKind: "commit" | "pull_request";
		fromIds: readonly string[];
		relations: readonly string[];
	},
): Promise<{ rows: Map<string, HopRow[]>; capped: Set<string> }> {
	const rows = new Map<string, HopRow[]>();
	const capped = new Set<string>();
	if (input.fromIds.length === 0 || repositoryIds.length === 0)
		return { rows, capped };
	const table = getSafeClickHouseTable(L1_EDGES_TABLE);
	const where = `organization_id = {organizationId:String} AND from_kind = {fromKind:String}
		AND from_id IN {fromIds:Array(String)} AND relation IN {relations:Array(String)}
		AND (relation != 'commit_in_pr' OR match_rule = 'membership')
		AND has({repositoryIds:Array(String)}, repository_id) AND is_active = 1`;
	const params = (fromIds: readonly string[]) => ({
		organizationId,
		fromKind: input.fromKind,
		fromIds: [...fromIds],
		relations: [...input.relations],
		repositoryIds: [...repositoryIds],
	});
	for (const chunk of chunkByParamBytes(input.fromIds, (id) => [id])) {
		const counts = await query(executor, HopCountSchema, {
			query: `SELECT from_id, relation, count() AS n FROM ${table} FINAL WHERE ${where}
				GROUP BY from_id, relation`,
			query_params: params(chunk),
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		});
		const expected = new Map<string, number>();
		for (const count of counts) {
			if (count.n > EDGES_PER_RELATION) capped.add(count.from_id);
			expected.set(
				count.from_id,
				(expected.get(count.from_id) ?? 0) +
					Math.min(count.n, EDGES_PER_RELATION),
			);
		}
		for (const part of chunkByRows(
			chunk.filter((id) => expected.has(id)),
			(id) => expected.get(id) ?? 0,
		))
			for (const row of await query(executor, HopSchema, {
				query: `SELECT from_id, relation, to_id, match_rule, details, toString(observed_at) AS observed_text
					FROM ${table} FINAL WHERE ${where}
					ORDER BY from_id, relation, to_id
					LIMIT {cap:UInt32} BY from_id, relation`,
				query_params: { ...params(part), cap: EDGES_PER_RELATION },
				clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
			}))
				append(rows, row.from_id, row);
	}
	return { rows, capped };
}

/** Per pull request node, the merge commit nodes of a merged PR (read by target). */
async function readMergeCommits(
	executor: ClickHouseExecutor,
	organizationId: string,
	repositoryIds: readonly string[],
	pullRequests: readonly string[],
): Promise<Map<string, string[]>> {
	const merges = new Map<string, string[]>();
	if (repositoryIds.length === 0) return merges;
	for (const chunk of chunkByParamBytes(pullRequests, (id) => [id]))
		for (const row of await query(executor, MergeCommitSchema, {
			query: `SELECT to_id, from_id FROM ${getSafeClickHouseTable(L1_EDGES_BY_TARGET_TABLE)} FINAL
				WHERE organization_id = {organizationId:String} AND to_kind = 'pull_request'
					AND to_id IN {pullRequests:Array(String)} AND relation = 'commit_in_pr' AND from_kind = 'commit'
					AND match_rule = 'merge_commit' AND has({repositoryIds:Array(String)}, repository_id)
					AND is_active = 1`,
			query_params: {
				organizationId,
				pullRequests: [...chunk],
				repositoryIds: [...repositoryIds],
			},
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		}))
			append(merges, row.to_id, row.from_id);
	return merges;
}

/**
 * When each session created each of the commits: its earliest active
 * `commit_created` edge to the commit in the completed build, from the
 * session's observation generation find reads. Keyed by
 * `rowKey(session, commit node)`.
 */
async function readCreatedCommits(
	executor: ClickHouseExecutor,
	organizationId: string,
	wanted: readonly {
		session: SessionIdentity;
		pin: number;
		generation: ObservationGeneration;
		commit: string;
	}[],
): Promise<Map<string, number>> {
	const created = new Map<string, number>();
	for (const chunk of chunkByParamBytes(wanted, (row) => [
		row.commit,
		row.session.userId,
		row.session.source,
		row.session.sessionId,
		sessionScopeId(row.session),
		sessionScopeId(row.session),
		row.generation.revision,
		String(row.pin),
	])) {
		const ranges = sessionRanges(chunk.map((row) => row.session));
		const pin = pinnedRevision(chunk);
		const generations = [
			...new Map(chunk.map((row) => [sessionKey(row.session), row])).values(),
		];
		const rows = await query(executor, CreatedSchema, {
			query: `SELECT user_id, source, session_id, to_id, min(toUnixTimestamp64Milli(observed_at)) AS first_ms
				FROM (
					SELECT user_id, source, session_id, from_kind, from_id, relation, to_kind, to_id, evidence_id,
						observed_at, is_active, revision, evidence_revision, evidence_parser_version
					FROM ${getSafeClickHouseTable(L1_EDGES_TABLE)}
					WHERE organization_id = {organizationId:String} AND from_kind IN ('run', 'session') AND ${ranges.sql}
						AND relation = 'commit_created' AND to_kind = 'commit' AND to_id IN {commits:Array(String)}
						AND (user_id, source, session_id) IN (
							SELECT g.1, g.2, g.3 FROM (SELECT arrayJoin(arrayZip(
								{gUsers:Array(String)}, {gSources:Array(String)}, {gSessions:Array(String)})) AS g))
						AND ${pin.sql}
					ORDER BY revision DESC
					LIMIT 1 BY from_kind, from_id, relation, to_kind, to_id, evidence_id
				)
				-- Activity and generation after the latest version: a retraction hides its row.
				WHERE is_active = 1
					AND (user_id, source, session_id, toString(evidence_revision), evidence_parser_version) IN (
						SELECT g.1, g.2, g.3, g.4, g.5 FROM (SELECT arrayJoin(arrayZip(
							{gUsers:Array(String)}, {gSources:Array(String)}, {gSessions:Array(String)},
							{gRevisions:Array(String)}, {gParsers:Array(UInt16)})) AS g))
				GROUP BY user_id, source, session_id, to_id`,
			query_params: {
				organizationId,
				...ranges.params,
				...pin.params,
				commits: [...new Set(chunk.map((row) => row.commit))],
				gUsers: generations.map((row) => row.session.userId),
				gSources: generations.map((row) => row.session.source),
				gSessions: generations.map((row) => row.session.sessionId),
				gRevisions: generations.map((row) => row.generation.revision),
				gParsers: generations.map((row) => row.generation.parserVersion),
			},
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		});
		for (const row of rows)
			created.set(
				rowKey(
					{
						userId: row.user_id,
						source: row.source,
						sessionId: row.session_id,
					},
					row.to_id,
				),
				row.first_ms,
			);
	}
	return created;
}

/** Current rows of the pull request nodes in actively bound repositories, keyed by node id. */
async function readPullRequests(
	executor: ClickHouseExecutor,
	organizationId: string,
	repositoryIds: readonly string[],
	nodes: readonly string[],
): Promise<Map<string, PullRequestRow>> {
	const found = new Map<string, PullRequestRow>();
	if (repositoryIds.length === 0) return found;
	for (const chunk of chunkByParamBytes(nodes, (node) => [node])) {
		const pairs = chunk.map((node) => splitL1NodeId(node));
		for (const row of await query(executor, PullRequestRowSchema, {
			query: `SELECT ${PULL_REQUEST_COLUMNS}
				FROM rudel.github_pull_requests FINAL
				WHERE workspace_id = {workspaceId:String} AND provider = 'github'
					AND has({repositoryIds:Array(String)}, repository_id)
					AND has(arrayZip({numberRepos:Array(String)}, {numberValues:Array(UInt32)}), (repository_id, number))`,
			query_params: {
				workspaceId: organizationId,
				repositoryIds: [...repositoryIds],
				numberRepos: pairs.map(([repositoryId]) => repositoryId ?? ""),
				numberValues: pairs.map(([, number]) => Number(number)),
			},
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		}))
			found.set(pullRequestNodeId(row.repository_id, row.number), row);
	}
	return found;
}

/**
 * When an edge says its CI run attempt was created: GitHub-side edges as
 * their observation time (the run's creation), session edges only in their
 * details (`runCreatedAt`; their observation time is the check's). Null when
 * the edge does not record it (builds before resolver version 2).
 */
export function runCreatedMs(edge: {
	relation: string;
	details: string;
	observed_text: string;
}): number | null {
	const recorded =
		edge.relation === "ci_on_sha" || edge.relation === "ci_for_pr"
			? edge.observed_text
			: DetailsSchema.parse(parseJson(edge.details)).runCreatedAt;
	const ms = recorded === undefined ? Number.NaN : githubTimeMs(recorded);
	return Number.isFinite(ms) ? ms : null;
}

/**
 * Current rows of the CI run attempts the edges point to, in actively bound
 * repositories, keyed by node id. Where an edge keeps the run's creation the
 * read is bounded by it; a run whose creation no edge records is looked up
 * by its id alone, never by a guessed date.
 */
async function readCiRuns(
	executor: ClickHouseExecutor,
	organizationId: string,
	repositoryIds: readonly string[],
	edges: readonly {
		to_id: string;
		relation: string;
		details: string;
		observed_text: string;
	}[],
): Promise<Map<string, CiRunRow>> {
	const found = new Map<string, CiRunRow>();
	if (repositoryIds.length === 0) return found;
	const runs = new Map<string, number | null>();
	for (const edge of edges) {
		if (
			edge.relation !== "ci_named" &&
			edge.relation !== "ci_on_branch_window" &&
			edge.relation !== "ci_on_sha" &&
			edge.relation !== "ci_for_pr"
		)
			continue;
		const createdMs = runCreatedMs(edge);
		// Any edge that records the creation dates the run.
		if (createdMs !== null || !runs.has(edge.to_id))
			runs.set(edge.to_id, createdMs ?? runs.get(edge.to_id) ?? null);
	}
	const dated = [...runs]
		.flatMap(([node, ms]) => (ms === null ? [] : [[node, ms] as const]))
		.sort(([, left], [, right]) => left - right);
	const undated = [...runs].flatMap(([node, ms]) =>
		ms === null ? [node] : [],
	);
	const read = async (nodes: readonly string[], times: readonly number[]) => {
		const ids = nodes.map((node) => splitL1NodeId(node));
		const bounded = times.length > 0;
		for (const row of await query(executor, CiRunRowSchema, {
			query: `SELECT ${CI_RUN_COLUMNS}, toUInt32(0) AS pr_number, '' AS link_basis
				FROM rudel.github_ci_runs FINAL
				WHERE workspace_id = {workspaceId:String} AND provider = 'github' AND kind != 'check_suite'
					AND has({repositoryIds:Array(String)}, repository_id)
					AND repository_id IN {runRepoSet:Array(String)}
					${bounded ? "AND created_at >= toDateTime64({runFrom:String}, 3, 'UTC') AND created_at <= toDateTime64({runTo:String}, 3, 'UTC')" : ""}
					AND has(arrayZip({runRepos:Array(String)}, {runKinds:Array(String)}, {runIds:Array(String)}, {runAttempts:Array(UInt32)}),
						(repository_id, toString(kind), run_id, attempt))`,
			query_params: {
				workspaceId: organizationId,
				repositoryIds: [...repositoryIds],
				runRepoSet: [
					...new Set(ids.map(([repositoryId]) => repositoryId ?? "")),
				],
				runRepos: ids.map(([repositoryId]) => repositoryId ?? ""),
				runKinds: ids.map(([, kind]) => kind ?? ""),
				runIds: ids.map(([, , runId]) => runId ?? ""),
				runAttempts: ids.map(([, , , attempt]) => Number(attempt)),
				...(bounded
					? {
							// A day of margin: the bound only narrows the parts read.
							runFrom: clickHouseTime(Math.min(...times) - DAY_MS),
							runTo: clickHouseTime(Math.max(...times) + DAY_MS),
						}
					: {}),
			},
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		}))
			found.set(
				ciRunNodeId(row.repository_id, row.kind, row.run_id, row.attempt),
				row,
			);
	};
	for (const chunk of chunkByParamBytes(dated, ([node]) => [node]))
		await read(
			chunk.map(([node]) => node),
			chunk.map(([, ms]) => ms),
		);
	for (const chunk of chunkByParamBytes(undated, (node) => [node]))
		await read(chunk, []);
	return found;
}

/** A retained edge from a session's evidence to a pull request or one of its commits. */
export interface PullRequestTouch {
	session: SessionIdentity;
	relation: string;
	evidenceId: string;
	generation: Generation;
	agentId: string;
	/** The run's number; null for evidence that belongs to no run. */
	turn: number | null;
	matchedValue: string;
	atMs: number;
	/** The worker build revision that wrote the edge. */
	revision: number;
}

/** The sessions' evidence rows that touch a pull request, through its edges. */
export interface PullRequestTouches {
	repository: GitHubBinding;
	number: number;
	/** When GitHub says the PR was created; null when it was not collected. */
	createdAt: string | null;
	/** The touches the sessions' completed builds published. */
	edges: PullRequestTouch[];
	/** Sessions with edge rows for it from no completed build: unknown. */
	unpublished: SessionIdentity[];
	/**
	 * Sessions with edge rows for it newer than their completed build (a
	 * rebuild in flight or one that failed): the published touches read for
	 * them may be incomplete, since merges can replace published rows.
	 */
	incomplete: SessionIdentity[];
	/** More edges, sessions or commits exist than were followed. */
	truncated: boolean;
}

const TouchSchema = z.object({
	user_id: z.string(),
	source: z.string(),
	session_id: z.string(),
	evidence_id: z.string(),
	relation: z.string(),
	from_kind: z.string(),
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	matched_value: z.string(),
	evidence_revision_text: z.string(),
	evidence_parser_version: z.coerce.number(),
	revision_text: z.string(),
	at_ms: z.coerce.number(),
});
const NodeSchema = z.object({ from_id: z.string() });
const CreatedAtSchema = z.object({ created_text: z.string() });
const SessionRowSchema = z.object({
	user_id: z.string(),
	source: z.string(),
	session_id: z.string(),
});

/** Sessions read when following a pull request's edges back. */
export const PULL_REQUEST_SESSION_CAP = 5_000;

/**
 * Reads, by target, the session evidence that named, listed or pushed the
 * head branch of the pull request, and that created, pushed, captured (as
 * head) or mentioned one of its commits (at most `PULL_REQUEST_COMMIT_CAP`
 * commits, in SHA order), newest first, for `userId`'s sessions (everyone's
 * when null). Each session's rows are read as its completed build published
 * them (the latest version of each edge at or below its built revision, then
 * active ones), never a build still in flight or one that failed; sessions
 * whose published rows cannot be read are returned as unknown. The caller
 * still narrows the sessions to what it may see.
 */
export async function loadPullRequestTouches(
	executor: ClickHouseExecutor,
	organizationId: string,
	userId: string | null,
	repository: GitHubBinding,
	number: number,
	state: EdgeStateSource,
): Promise<PullRequestTouches> {
	const table = getSafeClickHouseTable(L1_EDGES_BY_TARGET_TABLE);
	const pullRequest = pullRequestNodeId(repository.repositoryId, number);
	// GitHub-side edges are never retracted: FINAL is the published state.
	const commits = await query(executor, NodeSchema, {
		query: `SELECT DISTINCT from_id FROM ${table} FINAL
			WHERE organization_id = {organizationId:String} AND to_kind = 'pull_request' AND to_id = {pullRequest:String}
				AND relation = 'commit_in_pr' AND from_kind = 'commit' AND match_rule = 'membership' AND is_active = 1
			ORDER BY from_id
			LIMIT {cap:UInt32}`,
		query_params: {
			organizationId,
			pullRequest,
			cap: PULL_REQUEST_COMMIT_CAP + 1,
		},
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
	});
	const commitIds = commits
		.slice(0, PULL_REQUEST_COMMIT_CAP)
		.map((row) => row.from_id);
	const targets = `from_kind IN ('run', 'session') AND (
			(to_kind = 'pull_request' AND to_id = {pullRequest:String}
				AND relation IN ('pr_named', 'pr_branch_head', 'pr_listed'))
			OR (to_kind = 'commit' AND to_id IN {commits:Array(String)}
				AND relation IN ('commit_created', 'commit_pushed', 'commit_captured', 'sha_mentioned')))`;
	const owner = userId === null ? "" : "AND user_id = {userId:String}";
	const base = {
		organizationId,
		pullRequest,
		// At most 1,000 commit ids of ~60 characters.
		commits: commitIds,
		...(userId === null ? {} : { userId }),
	};
	const found = await query(executor, SessionRowSchema, {
		query: `SELECT DISTINCT user_id, source, session_id FROM ${table}
			WHERE organization_id = {organizationId:String} AND ${targets} ${owner}
			ORDER BY user_id, source, session_id
			LIMIT {cap:UInt32}`,
		query_params: { ...base, cap: PULL_REQUEST_SESSION_CAP + 1 },
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
	});
	const sessions = found.slice(0, PULL_REQUEST_SESSION_CAP).map(
		(row): SessionIdentity => ({
			userId: row.user_id,
			source: row.source,
			sessionId: row.session_id,
		}),
	);
	const scopes = await state.scopes(
		organizationId,
		"session",
		sessions.map(sessionScopeId),
	);
	const pinned: { session: SessionIdentity; pin: number }[] = [];
	const unpublished: SessionIdentity[] = [];
	for (const session of sessions) {
		const built = scopes.get(sessionScopeId(session))?.builtRevision;
		if (built === null || built === undefined) unpublished.push(session);
		else pinned.push({ session, pin: built });
	}
	const touches: z.infer<typeof TouchSchema>[] = [];
	const incomplete = new Map<string, SessionIdentity>();
	const commitBytes = commitIds.reduce(
		(sum, id) => sum + paramValueBytes(id),
		0,
	);
	for (const chunk of chunkByParamBytes(
		pinned,
		(row) => [
			row.session.userId,
			row.session.source,
			row.session.sessionId,
			row.session.userId,
			row.session.source,
			row.session.sessionId,
			String(row.pin),
		],
		Math.max(PARAM_BYTES_PER_STATEMENT - commitBytes, 32 * 1024),
	)) {
		const pin = pinnedRevision(chunk);
		const params = {
			...base,
			...pin.params,
			sUsers: chunk.map((row) => row.session.userId),
			sSources: chunk.map((row) => row.session.source),
			sSessions: chunk.map((row) => row.session.sessionId),
		};
		const inChunk = `(user_id, source, session_id) IN (
				SELECT t.1, t.2, t.3 FROM (SELECT arrayJoin(arrayZip(
					{sUsers:Array(String)}, {sSources:Array(String)}, {sSessions:Array(String)})) AS t))`;
		touches.push(
			...(await query(executor, TouchSchema, {
				query: `SELECT user_id, source, session_id, evidence_id, relation, from_kind, agent_id, turn_idx, matched_value,
						toString(evidence_revision) AS evidence_revision_text, evidence_parser_version,
						toString(revision) AS revision_text, toUnixTimestamp64Milli(observed_at) AS at_ms
					FROM (
						SELECT user_id, source, session_id, evidence_id, relation, from_kind, from_id, to_kind, to_id,
							agent_id, turn_idx, matched_value, evidence_revision, evidence_parser_version, revision,
							observed_at, details, is_active
						FROM ${table}
						WHERE organization_id = {organizationId:String} AND ${targets} AND ${inChunk} AND ${pin.sql}
						ORDER BY revision DESC
						LIMIT 1 BY to_kind, to_id, relation, from_kind, from_id, evidence_id
					)
					WHERE is_active = 1 AND JSONExtractString(details, 'role') != 'base'
					ORDER BY at_ms DESC, user_id, source, session_id, evidence_id, relation
					LIMIT {cap:UInt32}`,
				query_params: { ...params, cap: PULL_REQUEST_EDGE_CAP + 1 },
				clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
			})),
		);
		// Rows above a session's pin: a build wrote after the completed one.
		const pins = new Map(
			chunk.map((row) => [sessionKey(row.session), row.pin]),
		);
		for (const row of await query(executor, NewestSchema, {
			query: `SELECT user_id, source, session_id, toString(max(revision)) AS newest
				FROM ${table}
				WHERE organization_id = {organizationId:String} AND ${targets} AND ${inChunk}
				GROUP BY user_id, source, session_id`,
			query_params: params,
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		})) {
			const session = {
				userId: row.user_id,
				source: row.source,
				sessionId: row.session_id,
			};
			if (BigInt(row.newest) > BigInt(pins.get(sessionKey(session)) ?? 0))
				incomplete.set(sessionKey(session), session);
		}
	}
	const [created] = await query(executor, CreatedAtSchema, {
		query: `SELECT toString(created_at) AS created_text FROM rudel.github_pull_requests FINAL
			WHERE workspace_id = {organizationId:String} AND provider = 'github'
				AND repository_id = {repositoryId:String} AND number = {number:UInt32}
			LIMIT 1`,
		query_params: {
			organizationId,
			repositoryId: repository.repositoryId,
			number,
		},
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
	});
	const all = touches.sort((left, right) => right.at_ms - left.at_ms);
	return {
		repository,
		number,
		createdAt: created?.created_text ?? null,
		edges: all.slice(0, PULL_REQUEST_EDGE_CAP).map(
			(row): PullRequestTouch => ({
				session: {
					userId: row.user_id,
					source: row.source,
					sessionId: row.session_id,
				},
				relation: row.relation,
				evidenceId: row.evidence_id,
				generation: {
					revision: row.evidence_revision_text,
					parserVersion: row.evidence_parser_version,
				},
				agentId: row.agent_id,
				turn: row.from_kind === "run" ? row.turn_idx : null,
				matchedValue: row.matched_value,
				atMs: row.at_ms,
				revision: Number(row.revision_text),
			}),
		),
		unpublished,
		incomplete: [...incomplete.values()],
		truncated:
			all.length > PULL_REQUEST_EDGE_CAP ||
			found.length > PULL_REQUEST_SESSION_CAP ||
			commits.length > PULL_REQUEST_COMMIT_CAP,
	};
}

/**
 * `find`'s evidence filter for the touches: per session id, each evidence
 * id with the generation its edge was built from. An observation is only
 * ever matched in that generation.
 */
export function touchEvidence(
	touches: readonly PullRequestTouch[],
): Map<string, Map<string, Generation>> {
	const evidence = new Map<string, Map<string, Generation>>();
	for (const touch of touches) {
		const ids = evidence.get(touch.session.sessionId) ?? new Map();
		ids.set(touch.evidenceId, touch.generation);
		evidence.set(touch.session.sessionId, ids);
	}
	return evidence;
}

/** Retained edges listed when `find pullRequest=…` cannot show their evidence row. */
export const WITNESSES_PER_ANSWER = 200;

/**
 * The visible touches whose observation cannot be shown as an event: the
 * session's transcript is no longer indexed, or find reads another
 * observation generation than the edge was built from. Each is the edge
 * itself, as the worker recorded it, newest first.
 */
export function touchWitnesses(
	touches: readonly PullRequestTouch[],
	visible: ReadonlySet<string>,
	generations: ReadonlyMap<string, Generation>,
): Witness[] {
	return touches.flatMap((touch): Witness[] => {
		if (
			!visible.has(sessionScopeId(touch.session)) ||
			!touch.evidenceId.startsWith("obs:")
		)
			return [];
		const read = generations.get(touch.session.sessionId);
		if (
			read &&
			read.revision === touch.generation.revision &&
			read.parserVersion === touch.generation.parserVersion
		)
			return [];
		return [
			{
				sessionId: touch.session.sessionId,
				agentId: touch.agentId,
				turn: touch.turn,
				relation: touch.relation,
				matchedValue: touch.matchedValue,
				at: new Date(touch.atMs).toISOString(),
				evidenceId: touch.evidenceId,
				generation: touch.generation,
				reason: read ? "other_generation" : "transcript_unavailable",
			},
		];
	});
}

/**
 * The witnesses of the runs `refs` or `model` select: with `refs`, those of
 * the named runs; with `model`, those of selected runs, and the ones whose
 * model cannot be checked (no indexed transcript, or no run) counted as
 * unknown rather than kept or dropped silently.
 */
export function selectWitnesses(
	witnesses: readonly Witness[],
	filter: {
		refs: ReadonlySet<string> | null;
		modelRuns: ReadonlySet<string> | null;
		runKey: (ref: {
			sessionId: string;
			agentId: string;
			turn: number;
		}) => string;
	},
): { kept: Witness[]; unattributed: number } {
	if (!filter.refs && !filter.modelRuns)
		return { kept: [...witnesses], unattributed: 0 };
	const kept: Witness[] = [];
	let unattributed = 0;
	for (const witness of witnesses) {
		const run =
			witness.turn === null
				? null
				: filter.runKey({
						sessionId: witness.sessionId,
						agentId: witness.agentId,
						turn: witness.turn,
					});
		// Both filters apply when both are given: a named run must also be one
		// the model selected.
		if (filter.refs && (run === null || !filter.refs.has(run))) continue;
		if (filter.modelRuns && (run === null || !filter.modelRuns.has(run))) {
			if (run === null || witness.reason === "transcript_unavailable")
				unattributed++;
			continue;
		}
		kept.push(witness);
	}
	return { kept, unattributed };
}

type Witness = NonNullable<
	Extract<AnalysisFindOutput, { source: "git" }>["witnesses"]
>[number];

/**
 * Header notes of `find pullRequest=…`, counted only over the sessions the
 * caller may see (`visible`, by session scope id).
 */
export function pullRequestNotes(input: {
	touches: PullRequestTouches;
	/** The published touches. */
	edges: readonly PullRequestTouch[];
	visible: ReadonlySet<string>;
	sessionScopes: ReadonlyMap<string, EdgeScopeState>;
	repositoryScope: EdgeScopeState | undefined;
	/** Visible sessions of the window whose edges cannot vouch for them. */
	unsettled: {
		count: number;
		of: number;
		from: string;
		to: string;
		capped: boolean;
	};
	witnesses: number;
	/** Witnesses whose run the `model` filter cannot be checked for (transcript gone). */
	unattributed: number;
	model: string | undefined;
}): string[] {
	const { touches } = input;
	const name = `${touches.repository.fullName}#${touches.number}`;
	const edges = input.edges.filter((edge) =>
		input.visible.has(sessionScopeId(edge.session)),
	);
	const sessions = [
		...new Set(edges.map((edge) => sessionScopeId(edge.session))),
	];
	const relations = new Map<string, number>();
	for (const edge of edges)
		relations.set(edge.relation, (relations.get(edge.relation) ?? 0) + 1);
	const notes = [
		sessions.length === 0
			? `pullRequest ${name}: no session you can see has an edge to it or its commits`
			: `pullRequest ${name}: ${sessions.length} sessions you can see touch it through ${edges.length} edges (${[
					...relations,
				]
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([relation, count]) => `${relation} ${count}`)
					.join(", ")})`,
	];
	const frozen = sessions.filter(
		(scopeId) => input.sessionScopes.get(scopeId)?.frozenReason,
	).length;
	if (frozen > 0)
		notes.push(
			`${frozen} of them have edges frozen after their transcript expired; their links are as of edges.builtAt`,
		);
	if (input.witnesses > 0)
		notes.push(
			`${input.witnesses} of these edges have no readable evidence row (transcript_unavailable, or other_generation when the edge came from an older observation generation): they are listed as witnesses${input.witnesses > WITNESSES_PER_ANSWER ? `, the newest ${WITNESSES_PER_ANSWER}` : ""}, not as events`,
		);
	if (input.unattributed > 0)
		notes.push(
			`${input.unattributed} more retained edges come from runs whose model is unknown (their transcript is no longer indexed, or the evidence belongs to no run), so whether they used model=${input.model ?? ""} is unknown: they are not listed`,
		);
	if (touches.unpublished.length > 0)
		notes.push(
			`${touches.unpublished.length} sessions you can see have edges to it only from builds that never completed: whether they touch ${name} is unknown`,
		);
	if (touches.incomplete.length > 0)
		notes.push(
			`${touches.incomplete.length} sessions you can see are being rebuilt or had a rebuild fail after their last completed one: what is shown for them may be incomplete (unknown)`,
		);
	if (!input.repositoryScope || input.repositoryScope.builtRevision === null)
		notes.push(
			`${touches.repository.fullName} has no GitHub-side edges built yet: the PR's commits are unknown, so sessions that only created, pushed or mentioned them are missing (unknown, not absent)`,
		);
	const { unsettled } = input;
	if (unsettled.count > 0)
		notes.push(
			`${unsettled.count} of the ${unsettled.capped ? "newest " : ""}${unsettled.of} sessions you can see from ${unsettled.from} to ${unsettled.to} have no edges that vouch for them (not built, stale, truncated or being rebuilt); they may also touch ${name} (unknown)`,
		);
	// Said even when none of the checked ones is unknown: older ones were not checked.
	if (unsettled.capped)
		notes.push(
			`only the newest ${unsettled.of} sessions you can see from ${unsettled.from} to ${unsettled.to} were checked for edges that vouch for them; older ones may also touch ${name} (unknown, truncated)`,
		);
	if (touches.truncated)
		notes.push(
			`the lookup stopped at ${PULL_REQUEST_EDGE_CAP} edges or ${PULL_REQUEST_COMMIT_CAP} commits (taken in SHA order, not by time): older sessions, and sessions touching unsearched commits, may be missing (truncated)`,
		);
	return notes;
}

/** `executor` with every statement bound to `signal`. */
function abortableExecutor(
	executor: ClickHouseExecutor,
	signal: AbortSignal,
): ClickHouseExecutor {
	return {
		close: () => executor.close(),
		execute: (statement) =>
			executor.execute({ ...statement, abortSignal: signal }),
		insert: (params) => executor.insert({ ...params, abortSignal: signal }),
		query: (statement) => executor.query({ ...statement, abortSignal: signal }),
	};
}

/** Log-safe class of a failure: never its message, which can carry parameters. */
function errorClass(error: unknown): string {
	if (!(error instanceof Error)) return typeof error;
	const code =
		"code" in error && typeof error.code === "string" ? error.code : "";
	const type =
		"type" in error && typeof error.type === "string" ? error.type : "";
	return /^[\w.-]{1,64}$/u.test(code || type)
		? `${error.name}:${code || type}`
		: error.name;
}

/**
 * For sampled pages, links the edge-linked events at query time too and
 * logs how they differ, by class. Expected classes: CI on an open PR's
 * test merge commit (edges follow merged PRs' merge commits only), a SHA
 * whose creation only query time attributes (edges need a unique prefix),
 * and a count bounded earlier by the coverage the edges were built against.
 * Runs detached from the find, within `budgetMs`; it never rejects.
 */
async function shadowCompare(
	page: PageToLink,
	events: readonly GitEvent[],
	budgetMs: number,
): Promise<void> {
	const fromEdges = events.flatMap((event, index) => {
		const seed = page.seeds[index];
		return event.edges?.linkedBy === "edges" && seed ? [{ event, seed }] : [];
	});
	if (fromEdges.length === 0) return;
	// Its own cancellation: a failing or slow comparison never aborts the
	// request's statements, and its own statements stop at its deadline.
	const controller = new AbortController();
	const executor = abortableExecutor(page.executor, controller.signal);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const queried = await Promise.race([
			linkAtQueryTime({
				...page,
				executor,
				seeds: fromEdges.map(({ seed }) => seed),
			}),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					const error = new Error("shadow comparison budget");
					controller.abort(error);
					reject(error);
				}, budgetMs);
			}),
		]);
		const classes = new Map<string, number>();
		const samples: string[] = [];
		fromEdges.forEach(({ event, seed }, index) => {
			const other = queried[index];
			if (!other) return;
			for (const difference of shadowDifferences(event, other)) {
				classes.set(difference, (classes.get(difference) ?? 0) + 1);
				if (!difference.startsWith("expected:") && samples.length < 3)
					samples.push(`${seed.sessionId}:${evidenceIdOf(seed)}:${difference}`);
			}
		});
		const summary = {
			organizationId: page.organizationId,
			compared: fromEdges.length,
			classes: Object.fromEntries(classes),
			samples,
		};
		if (samples.length > 0)
			logger.warn("find edge links differ from query time: {summary}", {
				summary,
			});
		else
			logger.info("find edge links match query time: {summary}", { summary });
	} catch (error) {
		logger.warn("find edge shadow comparison failed: {errorClass}", {
			errorClass: errorClass(error),
		});
	} finally {
		clearTimeout(timer);
	}
}

/**
 * How an edge-linked event differs from the same event linked at query
 * time, by class; `expected:` classes are differences the edges make on
 * purpose.
 */
export function shadowDifferences(
	fromEdges: GitEvent,
	atQuery: GitEvent,
): string[] {
	const differences: string[] = [];
	const same = (left: unknown, right: unknown) =>
		JSON.stringify(left) === JSON.stringify(right);
	if (!same(fromEdges.sha, atQuery.sha)) differences.push("sha");
	const byNumber = (prs: GitEvent["pullRequests"]) =>
		[...prs].sort((left, right) => left.number - right.number);
	if (!same(byNumber(fromEdges.pullRequests), byNumber(atQuery.pullRequests)))
		differences.push("pull_requests");

	// CI only query time links: runs on an open PR's test merge commit.
	const openPullRequests = new Set(
		atQuery.pullRequests
			.filter((pr) => pr.mergedAt === null)
			.map((pr) => pr.number),
	);
	const runId = (run: GitEvent["ciRuns"][number]) =>
		`${run.repositoryId}|${run.kind}|${run.runId}|${run.attempt}`;
	const edgeRuns = new Map(fromEdges.ciRuns.map((run) => [runId(run), run]));
	const queryRuns = new Map(atQuery.ciRuns.map((run) => [runId(run), run]));
	let openMergeOnly = 0;
	let unexplained = [...edgeRuns.keys()].filter(
		(id) => !queryRuns.has(id),
	).length;
	for (const [id, run] of queryRuns) {
		const edgeRun = edgeRuns.get(id);
		if (edgeRun && same(edgeRun, run)) continue;
		const missing = run.edges.filter(
			(edge) => !edgeRun?.edges.some((known) => same(known, edge)),
		);
		const openMerge =
			missing.length > 0 &&
			missing.every(
				(edge) =>
					edge.basis === "merge_commit" &&
					edge.prNumber !== null &&
					openPullRequests.has(edge.prNumber),
			);
		if (openMerge) openMergeOnly++;
		else unexplained++;
	}
	if (openMergeOnly > 0) differences.push("expected:open_pr_merge_commit");
	if (unexplained > 0) differences.push("ci_runs");

	if (
		fromEdges.ciRunCount !== atQuery.ciRunCount ||
		fromEdges.ciRunCountUnknown !== atQuery.ciRunCountUnknown ||
		fromEdges.ciRunCountThrough !== atQuery.ciRunCountThrough
	) {
		if (
			fromEdges.ciRunCountUnknown === "target_history_unknown" &&
			atQuery.ciRunCountUnknown === null
		)
			// Edges date a SHA only by the commit it uniquely resolved to.
			differences.push("expected:created_in_session");
		else if (
			fromEdges.ciRunCountThrough !== null &&
			atQuery.ciRunCountThrough !== null &&
			fromEdges.ciRunCountThrough < atQuery.ciRunCountThrough
		)
			// Counted only up to the coverage the edges were built against.
			differences.push("expected:coverage_boundary");
		else if (openMergeOnly > 0 && unexplained === 0)
			differences.push("expected:open_pr_merge_commit");
		else differences.push("ci_run_count");
	}
	return [...new Set(differences)];
}

/** Consecutive groups of items whose expected rows sum to at most `ROWS_PER_STATEMENT`. */
function chunkByRows<T>(items: readonly T[], rows: (item: T) => number): T[][] {
	const result: T[][] = [];
	let current: T[] = [];
	let total = 0;
	for (const item of items) {
		const count = rows(item);
		if (current.length > 0 && total + count > ROWS_PER_STATEMENT) {
			result.push(current);
			current = [];
			total = 0;
		}
		current.push(item);
		total += count;
	}
	if (current.length > 0) result.push(current);
	return result;
}

function append<T>(map: Map<string, T[]>, mapKey: string, value: T): void {
	const values = map.get(mapKey);
	if (values) values.push(value);
	else map.set(mapKey, [value]);
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return {};
	}
}
