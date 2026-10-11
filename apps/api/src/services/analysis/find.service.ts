import {
	type AnalysisFindInput,
	type AnalysisFindOutput,
	type AnalysisRun,
	findLimit,
	parsePullRequestRef,
	type RunRef,
} from "@rudel/api-routes";
import type { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getClickhouse,
} from "../../clickhouse.js";
import { sessionScopeId } from "../l1-edges/l1-edge-ids.js";
import { withAnalysisDeadline } from "./deadline.js";
import {
	CLASSIFIER_VERSION,
	classifyFailure,
	errorLine,
	normalize,
} from "./failure-classifier.js";
import {
	type CursorKey,
	type CursorOrder,
	compareKeys,
	isAfter,
	readFindCursor,
	takePage,
	writeFindCursor,
} from "./find-cursor.js";
import {
	type EdgeScopeState,
	type EdgeStateSource,
	edgeLinker,
	isL1EdgeFindReadEnabled,
	l1EdgeFindShadowRate,
	loadPullRequestTouches,
	type PullRequestTouch,
	type PullRequestTouches,
	pullRequestNotes,
	selectWitnesses,
	settledForReverse,
	touchEvidence,
	touchWitnesses,
	WITNESSES_PER_ANSWER,
} from "./git-edge-links.js";
import { type GitHubSource, loadGitPage } from "./git-links.js";
import { fitFindOutput } from "./output-ceiling.js";
import {
	promptReaction,
	reactionEvents,
	runKey,
	type TimedEvent,
} from "./reactions.js";
import { queryRunFacts, type RunRow } from "./run-queries.js";
import {
	buildFailureScanStatement,
	buildOpeningPromptsStatement,
	buildTextScanStatement,
	FailureRowSchema,
	type ScanCursor,
	type ScanPage,
	TextRowSchema,
} from "./scan-queries.js";
import {
	type AnalysisScope,
	type AnalysisSession,
	defaultRange,
	listScopeSessions,
	type ResolvedScope,
	resolveScope,
	type ScopeBatch,
	type SessionPick,
} from "./scope.js";
import { isAnalysisWorkLimit, query } from "./sql.js";
import { findWeeklyTotals, weeklyOrder } from "./weekly-totals.js";

type Header = AnalysisFindOutput["header"];
/** A run's own facts; its next reaction and family are added per page. */
type RunBase = Omit<AnalysisRun, "nextReaction" | "parentSessionId" | "depth">;
type ToolGroupResult = Extract<
	AnalysisFindOutput,
	{ source: "tool" }
>["groups"][number];

interface FindEnv {
	executor: ClickHouseExecutor;
	/** Text-scan ceilings for source=tool and source=user (tests lower them). */
	recordRowCap?: number;
	recordByteCap?: number;
	/** Records per run-facts batch (tests lower it to split a scope). */
	batchRecords?: number;
	/** GitHub visibility and active bindings for source=git (tests inject them). */
	github?: GitHubSource;
	/** The edge worker's build records for source=git (tests inject them); null reads no edges. */
	edges?: EdgeStateSource | null;
	deadlineMs?: number;
}

interface FindContext {
	executor: ClickHouseExecutor;
	input: AnalysisFindInput;
	/** Items per page (`findLimit`). */
	limit: number;
	/** Sort order of this call's items, and the position its cursor encodes. */
	order: CursorOrder;
	after: CursorKey | undefined;
	scope: ResolvedScope;
	header: Header;
	scan: ScanBudget;
	/** Every run of the scope (only `refs` when given), keyed by `runKey`. */
	runs: Map<string, RunRow>;
	sessions: Map<string, AnalysisSession>;
	github: GitHubSource;
	/** Null when links are computed at query time only (`L1_EDGES_FIND_READ=false`). */
	edges: EdgeStateSource | null;
	organizationId: string;
	/** The owner the scope is limited to; null for an admin across members. */
	ownerId: string | null;
	/** The request's executor without its cancellation, for detached work with its own. */
	unboundExecutor: ClickHouseExecutor;
	/** `pullRequest`: the evidence rows that touch it, as their sessions' builds published them. */
	pullRequest?: { touches: PullRequestTouches; published: PullRequestTouch[] };
}

interface ScanRow {
	session_id: string;
	agent_id: string;
	record_idx: number;
	block_idx: number;
	partial: boolean;
}

interface ScanBudget {
	rows: number;
	bytes: number;
	rowCap: number;
	byteCap: number;
	cut: boolean;
	partialTexts: number;
}

/** One page of a find result with the sort key of each of its items. */
interface FoundPage {
	output: AnalysisFindOutput;
	keys: CursorKey[];
}

/** Rows per scan page; text is cut at 16k characters, so a page stays under the 16 MB result ceiling. */
const SCAN_PAGE_ROWS = 512;
/** Each sort key ends in an identity, so the order is total and pages are exact. */
const RUN_ORDER: CursorOrder = ["desc", "asc"];
const RUN_GROUP_ORDER: CursorOrder = ["desc", "asc"];
const TOOL_GROUP_ORDER: CursorOrder = ["desc", "asc", "asc", "asc", "asc"];
const EVENT_ORDER: CursorOrder = ["desc", "desc", "asc", "asc", "asc"];
/** Newest event first, then session, stream, record and block. */
const GIT_ORDER: CursorOrder = ["desc", "asc", "asc", "asc", "asc", "asc"];

export type { AnalysisScope };

/**
 * `find` answers where something happened: runs of a scope, failed tool calls
 * grouped by cause, or lexicon reactions with their origin runs. Everything is
 * deterministic and pinned to each session's committed transcript generation.
 * A ClickHouse work ceiling returns an explicitly incomplete answer, as does
 * a result too large for `ANALYSIS_OUTPUT_MAX_BYTES`. Results are paged: when
 * more items follow, `header.cursor` continues after the last one returned.
 */
export async function findAnalysis(
	scope: AnalysisScope,
	input: AnalysisFindInput,
	env: FindEnv = { executor: getClickhouse() },
): Promise<AnalysisFindOutput> {
	return (await findAnalysisWithOwners(scope, input, env)).output;
}

/**
 * `findAnalysis`, with every member whose sessions it read: the owners of the
 * scope's sessions, which a grouped or trimmed result need not name.
 */
export function findAnalysisWithOwners(
	scope: AnalysisScope,
	input: AnalysisFindInput,
	env: FindEnv = { executor: getClickhouse() },
): Promise<{ output: AnalysisFindOutput; owners: string[] }> {
	return withAnalysisDeadline(
		"analysis.find",
		async (executor) => {
			// Weekly totals are a lookup in the nightly snapshot: no session scope.
			if (input.source === "weekly")
				try {
					const found = await findWeeklyTotals(executor, scope, input);
					return {
						output: fitFindOutput(found.output, (index) =>
							cursorAt(input, found.keys, index),
						),
						owners: found.owners,
					};
				} catch (error) {
					if (!isAnalysisWorkLimit(error)) throw error;
					return {
						output: emptyResult(input, workLimitHeader(input)),
						owners: [],
					};
				}
			let owners: string[] = [];
			const order = cursorOrder(input);
			const after = readFindCursor(input, order);
			const github = env.github ?? lazyPostgresGitHubSource;
			const edges = isL1EdgeFindReadEnabled()
				? env.edges === undefined
					? lazyPostgresEdgeState
					: env.edges
				: null;
			try {
				const touches =
					input.source === "git" && input.pullRequest !== undefined
						? await pullRequestTouches(
								executor,
								scope,
								input.pullRequest,
								github,
								edges,
							)
						: undefined;
				if (touches && "unknown" in touches)
					return {
						output: emptyResult(input, {
							...newHeader(emptyScope(input)),
							notes: [touches.unknown],
						}),
						owners,
					};
				// The touches are what the sessions' completed builds published.
				const pullRequest = touches
					? { touches, published: touches.edges }
					: undefined;
				const resolved = await resolveScope(
					executor,
					scope,
					input,
					env.batchRecords,
					pullRequest && pullRequestPick(pullRequest.published, input),
				);
				// source=git also reads CLI evidence of sessions without an indexed
				// transcript; their owners own the result too.
				owners = [
					...new Set([
						...resolved.batches.map((batch) => batch.scope.userId),
						...(input.source === "git"
							? resolved.unindexed.map((group) => group.scope.userId)
							: []),
					]),
				];
				const sessions = new Map(
					resolved.batches.flatMap((batch) =>
						batch.sessions.map((session) => [session.session_id, session]),
					),
				);
				const context: FindContext = {
					executor,
					input,
					limit: findLimit(input),
					order,
					after,
					scope: resolved,
					header: newHeader(resolved),
					runs: await loadScopeRuns(executor, resolved, input, sessions),
					sessions,
					github,
					edges,
					organizationId: scope.organizationId,
					ownerId: scope.userId,
					unboundExecutor: env.executor,
					pullRequest,
					scan: {
						rows: 0,
						bytes: 0,
						rowCap: env.recordRowCap ?? 100_000,
						byteCap: env.recordByteCap ?? 64 * 1024 * 1024,
						cut: false,
						partialTexts: 0,
					},
				};
				addCoverage(context);
				const found = await findBySource(context);
				finishHeader(context);
				const output = fitFindOutput(found.output, (index) =>
					cursorAt(input, found.keys, index),
				);
				return { output, owners };
			} catch (error) {
				if (!isAnalysisWorkLimit(error)) throw error;
				return { output: emptyResult(input, workLimitHeader(input)), owners };
			}
		},
		env,
	);
}

function findBySource(context: FindContext): Promise<FoundPage> {
	switch (context.input.source) {
		case "runs":
			return context.input.groupBy ? findRunGroups(context) : findRuns(context);
		case "tool":
			return findFailures(context);
		case "user":
			return findReactions(context);
		case "git":
			return findGitEvents(context);
		case "weekly":
			throw new Error("weekly totals are read without a session scope");
	}
}

/**
 * The scope's git and GitHub events (commits, pushes, PR URLs and creations,
 * CI status reads, Codex git metadata) with the PRs and CI runs GitHub links
 * to them, newest first. GitHub facts appear only where the workspace's GitHub
 * outcomes are visible, as on the dashboard.
 */
async function findGitEvents(context: FindContext): Promise<FoundPage> {
	const { scope, header, input } = context;
	const sessions = new Map(context.sessions);
	for (const group of scope.unindexed)
		for (const session of group.sessions)
			sessions.set(session.session_id, session);
	const page = await loadGitPage({
		executor: context.executor,
		organizationId: context.organizationId,
		batches: scope.batches,
		unindexed: scope.unindexed,
		sessions,
		runKeys:
			input.refs?.length || input.model ? new Set(context.runs.keys()) : null,
		after: context.after,
		order: context.order,
		limit: context.limit,
		source: context.github,
		link: context.edges
			? edgeLinker({
					state: context.edges,
					shadowRate: l1EdgeFindShadowRate(),
					shadowExecutor: context.unboundExecutor,
				})
			: undefined,
		only: context.pullRequest && touchEvidence(context.pullRequest.published),
	});
	let witnesses: ReturnType<typeof touchWitnesses> | undefined;
	if (context.pullRequest && context.edges) {
		const { touches, published } = context.pullRequest;
		const visible = new Set(
			[...sessions.values()].map((session) =>
				sessionScopeId({
					userId: session.user_id,
					source: session.source,
					sessionId: session.session_id,
				}),
			),
		);
		// Every retained edge whose evidence row cannot be shown, on the first
		// page, of the runs `refs` or `model` select.
		const selected = selectWitnesses(
			context.after === undefined
				? touchWitnesses(published, visible, page.generations)
				: [],
			{
				refs: input.refs?.length
					? new Set(input.refs.map((ref) => runKey(ref)))
					: null,
				modelRuns: input.model ? new Set(context.runs.keys()) : null,
				runKey,
			},
		);
		const all = selected.kept;
		witnesses = all.slice(0, WITNESSES_PER_ANSWER);
		const [sessionScopes, repositoryScopes, unsettled] = await Promise.all([
			context.edges.scopes(
				context.organizationId,
				"session",
				published
					.map((edge) => sessionScopeId(edge.session))
					.filter((id) => visible.has(id)),
			),
			context.edges.scopes(context.organizationId, "repository", [
				touches.repository.repositoryId,
			]),
			unsettledSessions(context, touches),
		]);
		header.notes.push(
			...pullRequestNotes({
				touches,
				edges: published,
				visible,
				sessionScopes,
				repositoryScope: repositoryScopes.get(touches.repository.repositoryId),
				unsettled,
				witnesses: all.length,
				unattributed: selected.unattributed,
				model: input.model,
			}),
		);
		if (
			touches.truncated ||
			all.length > witnesses.length ||
			selected.unattributed > 0 ||
			touches.unpublished.length > 0 ||
			touches.incomplete.length > 0 ||
			unsettled.capped
		)
			header.truncated = true;
	}
	header.notes.push(...page.notes);
	if (page.truncated) header.truncated = true;
	return paged(context, page.keys, page.more, {
		source: "git",
		header,
		events: page.events,
		// Only a pullRequest answer has witnesses; others keep their old shape.
		...(witnesses ? { witnesses } : {}),
	});
}

/**
 * The sessions the caller may see in the window that could touch the pull
 * request (from `from`, else two weeks before the PR was created, to `to`,
 * else today) whose edges cannot vouch for them: no scope, not built, older
 * rules, truncated or being rebuilt (a new transcript or observation
 * generation always queues a rebuild, so a stale build is one being
 * rebuilt).
 */
async function unsettledSessions(
	context: FindContext,
	touches: PullRequestTouches,
): Promise<{
	count: number;
	of: number;
	from: string;
	to: string;
	capped: boolean;
}> {
	const today = new Date().toISOString().slice(0, 10);
	const createdMs = touches.createdAt
		? Date.parse(`${touches.createdAt.replace(" ", "T").slice(0, 19)}Z`)
		: Number.NaN;
	const from =
		context.input.from ??
		(Number.isFinite(createdMs)
			? new Date(createdMs - 14 * 86_400_000).toISOString().slice(0, 10)
			: new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10));
	const to = context.input.to ?? today;
	const inventory = await listScopeSessions(
		context.executor,
		{ organizationId: context.organizationId, userId: context.ownerId },
		context.input,
		{ from, to },
	);
	const states: ReadonlyMap<string, EdgeScopeState> = context.edges
		? await context.edges.scopes(
				context.organizationId,
				"session",
				inventory.sessions.map((session) =>
					sessionScopeId({
						userId: session.user_id,
						source: session.source,
						sessionId: session.session_id,
					}),
				),
			)
		: new Map();
	return {
		count: inventory.sessions.filter(
			(session) =>
				!settledForReverse(
					states.get(
						sessionScopeId({
							userId: session.user_id,
							source: session.source,
							sessionId: session.session_id,
						}),
					),
				),
		).length,
		of: inventory.sessions.length,
		from,
		to,
		capped: inventory.capped,
	};
}

/**
 * The sessions and evidence rows that touch `pullRequest`, through the
 * stored edges of the workspace's actively bound repository, for the scope's
 * owner (everyone's for an admin); or why that is unknown.
 */
async function pullRequestTouches(
	executor: ClickHouseExecutor,
	scope: AnalysisScope,
	value: string,
	github: GitHubSource,
	edges: EdgeStateSource | null,
): Promise<PullRequestTouches | { unknown: string }> {
	const ref = parsePullRequestRef(value);
	if (!ref)
		return {
			unknown: `pullRequest ${value} is not owner/name#number or a GitHub pull request URL`,
		};
	if (!edges)
		return {
			unknown:
				"pullRequest follows the stored L1 edges, which this server does not read at the moment: which sessions touched it is unknown; find source=git without pullRequest still links events at query time",
		};
	const access = await github.access(scope.organizationId);
	if (access.visibility === "hidden")
		return {
			unknown:
				"GitHub outcomes are not visible for this workspace: which sessions touched the pull request is unknown",
		};
	const binding = access.bindings.find(
		(candidate) =>
			candidate.fullName.toLowerCase() === ref.fullName.toLowerCase(),
	);
	if (!binding)
		return {
			unknown: `${ref.fullName} has no active GitHub binding in this workspace: which sessions touched #${ref.number} is unknown`,
		};
	return loadPullRequestTouches(
		executor,
		scope.organizationId,
		scope.userId,
		binding,
		ref.number,
		edges,
	);
}

/** The touching sessions as find's scope; dates span their evidence unless given. */
function pullRequestPick(
	touches: readonly PullRequestTouch[],
	input: AnalysisFindInput,
): SessionPick {
	const days = touches.map((edge) =>
		new Date(edge.atMs).toISOString().slice(0, 10),
	);
	const fallback = defaultRange(input);
	return {
		sessions: [
			...new Map(
				touches.map((edge) => [
					sessionScopeId(edge.session),
					{ userId: edge.session.userId, sessionId: edge.session.sessionId },
				]),
			).values(),
		],
		range:
			days.length > 0
				? { from: days.reduce(minDay), to: days.reduce(maxDay) }
				: fallback,
	};
}

function minDay(left: string, right: string): string {
	return left < right ? left : right;
}

function maxDay(left: string, right: string): string {
	return left > right ? left : right;
}

/** Postgres-backed edge build records, loaded only when source=git runs. */
const lazyPostgresEdgeState: EdgeStateSource = {
	scopes: async (organizationId, kind, scopeIds) => {
		const [{ sqlClient }, { postgresEdgeStateSource }] = await Promise.all([
			import("../../db.js"),
			import("./edge-scopes.js"),
		]);
		return postgresEdgeStateSource(sqlClient).scopes(
			organizationId,
			kind,
			scopeIds,
		);
	},
};

/** Postgres-backed GitHub source, loaded only when source=git runs. */
const lazyPostgresGitHubSource: GitHubSource = {
	access: async (organizationId) =>
		(await import("./github-access.js")).postgresGitHubSource.access(
			organizationId,
		),
	evidence: async (organizationId, owners, page) =>
		(await import("./github-access.js")).postgresGitHubSource.evidence(
			organizationId,
			owners,
			page,
		),
};

/**
 * One run-facts statement per batch; everything else in the request works on
 * these rows. With `model`, only runs whose usage includes that model are kept,
 * each narrowed to that model's cost (a run without usage counts by its
 * session's model).
 */
async function loadScopeRuns(
	executor: ClickHouseExecutor,
	scope: ResolvedScope,
	input: AnalysisFindInput,
	sessions: ReadonlyMap<string, AnalysisSession>,
): Promise<Map<string, RunRow>> {
	const wanted = input.refs ? new Set(input.refs.map(runKey)) : undefined;
	const runs = new Map<string, RunRow>();
	for (const batch of scope.batches)
		for (const row of await queryRunFacts(
			executor,
			batch.scope,
			batch.generations,
		)) {
			const key = runKey(rowRef(row));
			if (wanted && !wanted.has(key)) continue;
			const run = input.model
				? runForModel(row, sessions.get(row.session_id), input.model)
				: row;
			if (run) runs.set(key, run);
		}
	return runs;
}

/** The part of a run that used `model`, or undefined when it used none of it. */
function runForModel(
	row: RunRow,
	session: AnalysisSession | undefined,
	model: string,
): RunRow | undefined {
	if (row.model_costs.length === 0)
		return session?.model === model ? row : undefined;
	const entry = row.model_costs.find(([name]) => name === model);
	if (!entry) return undefined;
	const unattributed = row.session_unattributed_models.filter(
		([name]) => name === model,
	);
	return {
		...row,
		cost: entry[1],
		unpriced_observations: entry[2],
		usage_model: model,
		model_costs: [entry],
		session_unattributed: unattributed.reduce((sum, [, cost]) => sum + cost, 0),
		session_unattributed_models: unattributed,
	};
}

function addCoverage({ runs, header, input }: FindContext): void {
	const sessions = new Map<string, number>();
	let partiallyPriced = 0;
	for (const run of runs.values()) {
		header.runsInScope++;
		header.minutes += run.minutes;
		header.activeMinutes = (header.activeMinutes ?? 0) + run.active_minutes;
		header.rawChars += run.raw_chars;
		if (run.cost === null) header.unpricedRuns++;
		else header.pricedCostUsd += run.cost;
		if (run.cost !== null && run.unpriced_observations > 0) partiallyPriced++;
		sessions.set(run.session_id, run.session_unattributed);
	}
	for (const unattributed of sessions.values())
		header.unattributedCostUsd += unattributed;
	if (partiallyPriced)
		header.notes.push(
			`${partiallyPriced} priced runs also have usage that could not be priced (unknown model or rate); their cost covers only the priced part`,
		);
	if (input.model)
		header.notes.push(
			`model=${input.model} keeps runs whose usage includes that model and counts only that model's cost; runs without usage count by their session's model`,
		);
}

async function findRuns(context: FindContext): Promise<FoundPage> {
	const { executor, input, scope } = context;
	const keyOf = (row: RunRow) => runSortKey(row, input.sort);
	const { page: rows, more } = takePage(
		[...context.runs.values()],
		keyOf,
		context.order,
		context.after,
		context.limit,
	);
	const reactions = await nextReactions(executor, scope.batches, rows);
	return paged(context, rows.map(keyOf), more, {
		source: "runs",
		header: context.header,
		rows: rows.map((row) => {
			const session = context.sessions.get(row.session_id);
			return {
				...toRun(row, session),
				nextReaction: reactions.get(runKey(rowRef(row))) ?? null,
				parentSessionId: session?.parentSessionId ?? null,
				depth: session?.depth ?? 0,
			};
		}),
	});
}

function findRunGroups(context: FindContext): Promise<FoundPage> {
	const { input } = context;
	const groups = new Map<
		string,
		{
			key: string;
			runs: number;
			sessions: Set<string>;
			minutes: number;
			activeMinutes: number;
			cost: number | null;
		}
	>();
	let multiModelRuns = 0;
	for (const row of context.runs.values()) {
		const session = context.sessions.get(row.session_id);
		// By model, a run's cost goes to each model it used, never all to one.
		const parts =
			input.groupBy === "model" && row.model_costs.length > 0
				? row.model_costs.map(([model, cost]) => ({ key: model, cost }))
				: [
						{
							key: groupKey(toRun(row, session), session, input.groupBy),
							cost: row.cost,
						},
					];
		if (parts.length > 1) multiModelRuns++;
		for (const part of parts) {
			const group = groups.get(part.key) ?? {
				key: part.key,
				runs: 0,
				sessions: new Set<string>(),
				minutes: 0,
				activeMinutes: 0,
				cost: null,
			};
			groups.set(part.key, group);
			group.runs++;
			group.sessions.add(row.session_id);
			group.minutes += row.minutes;
			group.activeMinutes += row.active_minutes;
			group.cost = sumCost(group.cost, part.cost);
		}
	}
	if (multiModelRuns)
		context.header.notes.push(
			`${multiModelRuns} runs used several models: each model's group has that model's cost and counts the run, so costs add up across groups but runs, sessions and minutes do not`,
		);
	const keyOf = (group: { runs: number; key: string }) => [
		group.runs,
		group.key,
	];
	const { page, more } = takePage(
		[...groups.values()],
		keyOf,
		context.order,
		context.after,
		context.limit,
	);
	return Promise.resolve(
		paged(context, page.map(keyOf), more, {
			source: "runs",
			header: context.header,
			groups: page.map((group) => ({
				key: group.key,
				runs: group.runs,
				sessions: group.sessions.size,
				// Sums of floats depend on row order; rounding keeps pages consistent.
				minutes: roundMinutes(group.minutes),
				activeMinutes: roundMinutes(group.activeMinutes),
				costUsd: roundNullableCost(group.cost),
			})),
		}),
	);
}

interface FailureBucket {
	group: ToolGroupResult;
	runs: Map<string, RunRef>;
	commands: Map<string, number>;
}

async function findFailures(context: FindContext): Promise<FoundPage> {
	const { input, scope } = context;
	const buckets = new Map<string, FailureBucket>();
	for (const batch of scope.batches)
		await scanPages(
			context,
			(page) => buildFailureScanStatement(batch.scope, batch.generations, page),
			FailureRowSchema,
			(row) => {
				const cause = classifyFailure({
					tool: row.tool_name,
					commandClass: row.command_class,
					command: row.command,
					body: row.head,
					tail: row.tail,
					exitCode: row.exit_code,
				});
				if (
					(!input.includeNoise && cause.kind === "noise") ||
					(input.toolGroup && row.tool_group !== input.toolGroup) ||
					(input.commandClass && row.command_class !== input.commandClass) ||
					(input.kind && cause.kind !== input.kind) ||
					(input.cause && cause.cause !== input.cause) ||
					(input.detail && cause.detail !== input.detail)
				)
					return;
				const at = new Date(row.started_ms).toISOString();
				const ref = rowRef(row);
				const key = JSON.stringify([
					row.tool_group,
					cause.cause,
					cause.detail,
					cause.kind,
				]);
				const bucket: FailureBucket = buckets.get(key) ?? {
					group: {
						toolGroup: row.tool_group,
						cause: cause.cause,
						detail: cause.detail,
						kind: cause.kind,
						count: 0,
						sessions: 0,
						firstSeen: at,
						lastSeen: at,
						topCommands: [],
						minutes: 0,
						costUsd: null,
						examples: [],
					},
					runs: new Map(),
					commands: new Map(),
				};
				buckets.set(key, bucket);
				bucket.group.count++;
				if (at < bucket.group.firstSeen) bucket.group.firstSeen = at;
				if (at > bucket.group.lastSeen) bucket.group.lastSeen = at;
				bucket.runs.set(runKey(ref), ref);
				const command = normalize(row.command).slice(0, 200);
				if (command)
					bucket.commands.set(command, (bucket.commands.get(command) ?? 0) + 1);
				if (bucket.group.examples.length < 5)
					bucket.group.examples.push({
						ref,
						record: row.record_idx,
						errorLine: errorLine(row.head, row.tail),
						parentSessionId:
							context.sessions.get(row.session_id)?.parentSessionId ?? null,
					});
			},
		);
	const keyOf = ({ group }: FailureBucket) => [
		group.count,
		group.cause,
		group.detail,
		group.toolGroup,
		group.kind,
	];
	const { page: top, more } = takePage(
		[...buckets.values()],
		keyOf,
		context.order,
		context.after,
		context.limit,
	);
	const runs = context.runs;
	return paged(context, top.map(keyOf), more, {
		source: "tool",
		header: context.header,
		groups: top.map(({ group, runs: refs, commands }) => {
			const priced = [...refs.keys()].flatMap((key) => runs.get(key) ?? []);
			return {
				...group,
				sessions: new Set([...refs.values()].map((ref) => ref.sessionId)).size,
				topCommands: [...commands]
					.sort(([left, a], [right, b]) => b - a || left.localeCompare(right))
					.slice(0, 3)
					.map(([command]) => command),
				minutes: priced.reduce((sum, run) => sum + run.minutes, 0),
				costUsd: roundNullableCost(
					priced.reduce<number | null>(
						(sum, run) => sumCost(sum, run.cost),
						null,
					),
				),
			};
		}),
	});
}

async function findReactions(context: FindContext): Promise<FoundPage> {
	const { input, scope } = context;
	const counts = new Map(
		input.reaction.map((type) => [
			type,
			{ count: 0, sessions: new Set<string>() },
		]),
	);
	let events: TimedEvent[] = [];
	let following = 0;
	for (const batch of scope.batches)
		await scanPages(
			context,
			(page) => buildTextScanStatement(batch.scope, batch.generations, page),
			TextRowSchema,
			(row) => {
				for (const event of reactionEvents(row)) {
					const count = counts.get(event.type);
					if (!count) continue;
					count.count++;
					count.sessions.add(event.eventRef.sessionId);
					if (!isAfter(eventSortKey(event), context.after, context.order))
						continue;
					following++;
					events.push(event);
				}
				if (events.length > context.limit * 2)
					events = newestEvents(events, context.limit);
			},
		);
	events = newestEvents(events, context.limit);
	const origins = context.runs;
	return paged(context, events.map(eventSortKey), following > events.length, {
		source: "user",
		header: context.header,
		events: events.map(({ at: _at, block: _block, ...event }) => {
			const origin = event.originRef
				? origins.get(runKey(event.originRef))
				: undefined;
			return {
				...event,
				originMinutes: origin?.minutes ?? null,
				originCostUsd: roundNullableCost(origin?.cost ?? null),
				parentSessionId:
					context.sessions.get(event.eventRef.sessionId)?.parentSessionId ??
					null,
			};
		}),
		groups: [...counts].map(([type, count]) => ({
			type,
			count: count.count,
			sessions: count.sessions.size,
		})),
	});
}

/** A page of `output` whose items have `keys`; the header says if more follow. */
function paged(
	{ input, header }: FindContext,
	keys: CursorKey[],
	more: boolean,
	output: AnalysisFindOutput,
): FoundPage {
	header.truncated ||= more;
	const last = keys.at(-1);
	if (more && last) header.cursor = writeFindCursor(input, last);
	return { output, keys };
}

/**
 * Pages through one batch with a keyset cursor until the batch ends or the
 * request-wide row/byte ceiling is reached, handing each row to `onRow`.
 */
async function scanPages<Row extends ScanRow>(
	{ executor, scan }: FindContext,
	statement: (page: ScanPage) => ClickHouseStatement,
	schema: z.ZodType<Row, unknown>,
	onRow: (row: Row) => void,
): Promise<void> {
	let after: ScanCursor | undefined;
	while (!scan.cut) {
		const limit = Math.min(SCAN_PAGE_ROWS, scan.rowCap - scan.rows);
		if (limit <= 0) {
			scan.cut = true;
			return;
		}
		const page = await query(executor, schema, statement({ after, limit }));
		for (const row of page) {
			const bytes = Buffer.byteLength(JSON.stringify(row));
			if (scan.bytes + bytes > scan.byteCap) {
				scan.cut = true;
				return;
			}
			scan.rows++;
			scan.bytes += bytes;
			if (row.partial) scan.partialTexts++;
			onRow(row);
		}
		const last = page.at(-1);
		if (!last || page.length < limit) return;
		after = [last.session_id, last.agent_id, last.record_idx, last.block_idx];
	}
}

/** The reaction of the prompt that opens the next run, for each row. */
async function nextReactions(
	executor: ClickHouseExecutor,
	batches: readonly ScopeBatch[],
	rows: readonly RunRow[],
): Promise<Map<string, "swear" | "negative">> {
	const reactions = new Map<string, "swear" | "negative">();
	for (const batch of batches) {
		const next = rows
			.filter((row) =>
				batch.generations.some(
					(generation) => generation.sessionId === row.session_id,
				),
			)
			.map((row) => ({ ...rowRef(row), turn: row.turn_idx + 1 }));
		if (!next.length) continue;
		const prompts = await query(
			executor,
			TextRowSchema,
			buildOpeningPromptsStatement(batch.scope, batch.generations, next),
		);
		for (const prompt of prompts) {
			const reaction = promptReaction(prompt);
			if (reaction)
				reactions.set(
					runKey({ ...rowRef(prompt), turn: prompt.turn_idx - 1 }),
					reaction,
				);
		}
	}
	return reactions;
}

function newHeader(scope: ResolvedScope): Header {
	return {
		from: scope.from,
		to: scope.to,
		sessionsInScope: scope.sessionsInScope,
		indexedSessions: scope.indexedSessions,
		runsInScope: 0,
		minutes: 0,
		activeMinutes: 0,
		pricedCostUsd: 0,
		unattributedCostUsd: 0,
		unpricedRuns: 0,
		rawChars: 0,
		truncated: scope.sessionCapReached,
		notes: [],
		classifierVersion: CLASSIFIER_VERSION,
	};
}

/** Notes only say something when it applies to this answer. */
function finishHeader({ header, scope, scan }: FindContext): void {
	header.pricedCostUsd = roundCost(header.pricedCostUsd);
	header.minutes = roundMinutes(header.minutes);
	header.activeMinutes = roundMinutes(header.activeMinutes ?? 0);
	header.unattributedCostUsd = roundCost(header.unattributedCostUsd);
	if (header.indexedSessions < header.sessionsInScope)
		header.notes.push(
			`run facts cover the ${header.indexedSessions} indexed of ${header.sessionsInScope} sessions in scope`,
		);
	if (header.unattributedCostUsd > 0)
		header.notes.push(
			"unattributedCostUsd is usage that cannot be tied to one run unambiguously; it is in no run's cost",
		);
	if (scope.subagentThreads)
		header.notes.push(
			`${scope.subagentThreads} of the ${header.sessionsInScope} sessions are Codex subagent threads: their runs carry parentSessionId and depth, a session in scope brings its threads, latest counts a session with its threads as one, and groupBy=session totals each family`,
		);
	if (scope.sessionCapReached)
		header.notes.push(
			`session ceiling reached; only the newest ${scope.sessionsInScope} sessions are covered`,
		);
	if (scan.cut) {
		header.truncated = true;
		header.notes.push(
			`text scan coverage curtailed at ${scan.rows} rows / ${scan.bytes} bytes; results cover scanned text only`,
		);
	}
	if (scan.partialTexts)
		header.notes.push(
			`${scan.partialTexts} texts were scanned only in part (stored or scan cap)`,
		);
}

/** A scope with no sessions over the default range. */
function emptyScope(input: AnalysisFindInput): ResolvedScope {
	return {
		...defaultRange(input),
		sessionsInScope: 0,
		indexedSessions: 0,
		sessionCapReached: false,
		subagentThreads: 0,
		batches: [],
		unindexed: [],
	};
}

function workLimitHeader(input: AnalysisFindInput): Header {
	return {
		...newHeader(emptyScope(input)),
		truncated: true,
		notes: [
			"SQL work ceiling reached; nothing could be counted for this scope, narrow it (dates, latest, repository)",
		],
	};
}

function emptyResult(
	input: AnalysisFindInput,
	header: Header,
): AnalysisFindOutput {
	if (input.source === "tool") return { source: "tool", header, groups: [] };
	if (input.source === "user")
		return { source: "user", header, events: [], groups: [] };
	if (input.source === "git") return { source: "git", header, events: [] };
	if (input.source === "weekly")
		return { source: "weekly", header, snapshot: null, totals: [] };
	return input.groupBy
		? { source: "runs", header, groups: [] }
		: { source: "runs", header, rows: [] };
}

function toRun(row: RunRow, session: AnalysisSession | undefined): RunBase {
	return {
		ref: rowRef(row),
		startedAt: new Date(row.started_ms).toISOString(),
		minutes: row.minutes,
		activeMinutes: row.active_minutes,
		costUsd: roundNullableCost(row.cost),
		model: row.usage_model || session?.model || "",
		models: row.model_costs.map(([model]) => model),
		repository: session?.repository ?? "",
		agent: session?.source ?? "claude_code",
		promptHead: row.prompt_head,
		edits: row.edits,
		toolCalls: row.tool_calls,
		failedCalls: row.failed_calls,
		readCalls: row.read_calls,
		searchCalls: row.search_calls,
		notFound: row.not_found,
		rawChars: row.raw_chars,
	};
}

function rowRef(row: {
	session_id: string;
	agent_id: string;
	turn_idx: number;
}): RunRef {
	return {
		sessionId: row.session_id,
		agentId: row.agent_id,
		turn: row.turn_idx,
	};
}

/** The sort column descending (unpriced runs last), then the ref. */
function runSortKey(row: RunRow, sort: AnalysisFindInput["sort"]): CursorKey {
	const column = {
		startedAt: "started_ms",
		minutes: "minutes",
		costUsd: "cost",
		failedCalls: "failed_calls",
		rawChars: "raw_chars",
	} as const satisfies Record<AnalysisFindInput["sort"], keyof RunRow>;
	return [row[column[sort]], runKey(rowRef(row))];
}

/**
 * Newest first, then the later record, its content block, the type and the
 * stream: one record may hold several text blocks, each with its own events.
 */
function eventSortKey(event: TimedEvent): CursorKey {
	return [
		event.at,
		event.eventRef.record,
		event.block,
		event.type,
		runKey(event.eventRef),
	];
}

function cursorOrder(input: AnalysisFindInput): CursorOrder {
	if (input.source === "tool") return TOOL_GROUP_ORDER;
	if (input.source === "user") return EVENT_ORDER;
	if (input.source === "git") return GIT_ORDER;
	if (input.source === "weekly") return weeklyOrder(input.groupBy);
	return input.groupBy ? RUN_GROUP_ORDER : RUN_ORDER;
}

function cursorAt(
	input: AnalysisFindInput,
	keys: readonly CursorKey[],
	index: number,
): string | undefined {
	const key = keys[index];
	return key ? writeFindCursor(input, key) : undefined;
}

/** `session` groups a Codex subagent thread under the top session of its family. */
function groupKey(
	run: RunBase,
	session: AnalysisSession | undefined,
	groupBy: AnalysisFindInput["groupBy"],
): string {
	if (groupBy === "session") return session?.rootSessionId ?? run.ref.sessionId;
	if (groupBy === "week") {
		const day = new Date(run.startedAt);
		day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
		return day.toISOString().slice(0, 10);
	}
	if (groupBy === "agent") return run.agent;
	return groupBy === "repository" ? run.repository : run.model;
}

function newestEvents(events: TimedEvent[], limit: number): TimedEvent[] {
	return events
		.sort((left, right) =>
			compareKeys(eventSortKey(left), eventSortKey(right), EVENT_ORDER),
		)
		.slice(0, limit);
}

function sumCost(left: number | null, right: number | null): number | null {
	return left === null && right === null ? null : (left ?? 0) + (right ?? 0);
}

function roundCost(cost: number): number {
	return Math.round(cost * 10_000) / 10_000;
}

function roundMinutes(minutes: number): number {
	return Math.round(minutes * 10_000) / 10_000;
}

function roundNullableCost(cost: number | null): number | null {
	return cost === null ? null : roundCost(cost);
}
