import { ORPCError } from "@orpc/server";
import {
	type AnalysisCall,
	type AnalysisFindInput,
	type AnalysisFindOutput,
	type AnalysisRun,
	findLimit,
	isSessionsBehind,
	parsePullRequestRef,
	type RunRef,
	type SESSIONS_BEHIND_SOURCES,
} from "@rudel/api-routes";
import type { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getClickhouse,
	MAX_CLICKHOUSE_URL_BYTES,
} from "../../clickhouse.js";
import { sessionScopeId } from "../l1-edges/l1-edge-ids.js";
import {
	buildCallExamplesStatement,
	buildCallGroupsStatement,
	buildCallRowsStatement,
	type CallExampleRow,
	CallExampleRowSchema,
	type CallGroupBy,
	CallGroupRowSchema,
	type CallPosition,
	type CallRow,
	CallRowSchema,
} from "./call-queries.js";
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
	buildRunFilterStatement,
	buildSessionLinksStatement,
	compileFindFilters,
	RunKeyRowSchema,
	SessionLinkRowSchema,
	sessionTree,
	type TreeSession,
} from "./find-filter-queries.js";
import { type CompiledFilters, isRegexError } from "./find-filters.js";
import {
	padUInt64,
	RANDOM_CALL_ORDER,
	RANDOM_RUN_ORDER,
	randomRank,
	randomSeedOf,
	skipLeading,
	unpadUInt64,
} from "./find-paging.js";
import {
	type FailedCallsOf,
	SESSIONS_BEHIND_ORDER,
	SessionsBehind,
} from "./find-sessions.js";
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
import {
	type ComputedRunFacts,
	computedRunFactsOf,
	loadRunFacts,
} from "./run-facts-loader.js";
import type { RunRow } from "./run-queries.js";
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
import {
	chunkByParamBytes,
	clickHouseMemoryPressureError,
	isAnalysisWorkLimit,
	isClickHouseMemoryPressure,
	paramValueBytes,
	pinnedParams,
	query,
} from "./sql.js";
import { findWeeklyTotals, weeklyOrder } from "./weekly-totals.js";

type Header = AnalysisFindOutput["header"];
/** A run's own facts; its next reaction and family are added per page. */
type RunBase = Omit<AnalysisRun, "nextReaction" | "parentSessionId" | "depth">;
type ToolGroupResult = Extract<
	AnalysisFindOutput,
	{ source: "tool" }
>["groups"][number];
type CallGroupResult = Extract<
	AnalysisFindOutput,
	{ source: "calls"; groups: unknown }
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
	filters?: CompiledFilters;
	seed: string;
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
/** Newest call first, then session, stream, record and block. */
const CALL_ORDER: CursorOrder = ["desc", "asc", "asc", "asc", "asc"];
/**
 * Distinct keys a calls grouping counts across batches; calls with a key
 * first seen past it are left out, and the answer says so.
 */
const MAX_CALL_GROUPS = 50_000;
const EXAMPLE_URL_RESERVE = 2 * 1024;
/** A group's examples: newest first, then batch and position. */
const EXAMPLE_ORDER: CursorOrder = [
	"desc",
	"asc",
	"asc",
	"asc",
	"asc",
	"asc",
	"asc",
];

export type { AnalysisScope };

/**
 * `find` answers where something happened: runs of a scope, failed tool calls
 * grouped by cause, or lexicon reactions with their origin runs. Everything is
 * deterministic and pinned to each session's committed transcript generation.
 * A ClickHouse work ceiling returns an explicitly incomplete answer, as does
 * a result too large for the response size limit. Results are paged: when
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
			const filters = compileFindFilters(input);
			const offset = input.cursor === undefined ? (input.offset ?? 0) : 0;
			const limit = findLimit(input) + offset;
			// Weekly totals are a lookup in the nightly snapshot: no session scope.
			if (input.source === "weekly")
				try {
					const found = skipLeading(
						await findWeeklyTotals(executor, scope, { ...input, limit }),
						offset,
					);
					return {
						output: fitFindOutput(
							found.output,
							(index) => cursorAt(input, found.keys, index),
							input.verbosity,
						),
						owners: found.owners,
					};
				} catch (error) {
					if (isClickHouseMemoryPressure(error))
						throw clickHouseMemoryPressureError(error);
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
				const tree = input.parentSessionId
					? sessionTree(
							await query(
								executor,
								SessionLinkRowSchema,
								buildSessionLinksStatement(scope),
							),
							input.parentSessionId,
						)
					: [];
				const resolved = await resolveScope(
					executor,
					scope,
					input.parentSessionId && tree.length === 0
						? { ...input, sessionId: input.parentSessionId }
						: input,
					env.batchRecords,
					pullRequest
						? pullRequestPick(pullRequest.published, input)
						: tree.length > 0
							? treePick(tree, input)
							: undefined,
				);
				placeInTree(resolved, tree);
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
				const header = newHeader(resolved);
				const context: FindContext = {
					executor,
					input,
					limit,
					order,
					after,
					scope: resolved,
					header,
					runs: await loadScopeRuns(
						executor,
						resolved,
						input,
						sessions,
						filters?.view === "runs" ? { filters, header, scope } : undefined,
						computedRunFactsOf(env.executor),
					),
					sessions,
					github,
					edges,
					organizationId: scope.organizationId,
					ownerId: scope.userId,
					unboundExecutor: env.executor,
					pullRequest,
					filters,
					seed: randomSeedOf(after),
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
				if (tree.length > 0)
					header.notes.push(
						`parentSessionId=${input.parentSessionId}: the session and the ${tree.length - 1} sessions linked below it in session_links (subagent threads, forks, delegations), whatever their date unless from or to is given; parentSessionId and depth place each in that tree`,
					);
				const found = skipLeading(await findBySource(context), offset);
				finishHeader(context);
				const output = fitFindOutput(
					found.output,
					(index) => cursorAt(input, found.keys, index),
					input.verbosity,
				);
				return { output, owners };
			} catch (error) {
				if (isRegexError(error))
					throw new ORPCError("BAD_REQUEST", {
						message: `filters: ClickHouse could not compile a regex (re2 syntax: no lookaround or backreferences; (?i) for case-insensitive): ${error instanceof Error ? error.message.slice(0, 300) : ""}`,
					});
				if (isClickHouseMemoryPressure(error))
					throw clickHouseMemoryPressureError(error);
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
		case "calls":
			if (isSessionsBehind(context.input)) return findCallSessions(context);
			return context.input.groupBy
				? findCallGroups(context, context.input.groupBy as CallGroupBy)
				: findCalls(context);
	}
}

async function findCallSessions(context: FindContext): Promise<FoundPage> {
	const { input, scope, header } = context;
	const behind = new SessionsBehind();
	let matched = 0;
	let minutes = 0;
	for (const batch of scope.batches) {
		const refs = batchRefs(input, batch);
		if (refs?.length === 0) continue;
		const rows = await query(
			context.executor,
			CallGroupRowSchema,
			buildCallGroupsStatement(
				{
					scope: batch.scope,
					generations: batch.generations,
					input,
					refs,
					filters: context.filters,
				},
				"session",
			),
		);
		for (const row of rows) {
			matched += row.calls;
			minutes += row.call_minutes;
			const example = [...row.examples].sort(
				([left], [right]) => left - right,
			)[0]?.[1];
			if (!example) continue;
			const [sessionId, agentId, turn, record] = example;
			behind.add({
				ref: { sessionId, agentId, turn },
				record,
				atMs: row.first_ms,
				lastMs: row.last_ms,
				rows: row.calls,
				failedCalls: row.failed_calls,
				callMinutes: row.call_minutes,
				runs: row.runs.flatMap(([position, agent, runTurn]) => {
					const session = batch.generations[position - 1]?.sessionId;
					return session
						? [runKey({ sessionId: session, agentId: agent, turn: runTurn })]
						: [];
				}),
			});
		}
	}
	header.matchedCalls = matched;
	header.groupCallTime = roundMinutes(minutes);
	if (context.filters) header.notes.push(callFilterNote(context.filters));
	return sessionsPage(context, behind, "hits", true);
}

function sessionsPage(
	context: FindContext,
	behind: SessionsBehind,
	failedCallsOf: FailedCallsOf,
	timed: boolean,
): FoundPage {
	const { output, keys, more } = behind.page({
		after: context.after,
		limit: context.limit,
		runs: context.runs,
		sessions: context.sessions,
		failedCallsOf,
		timed,
	});
	return paged(context, keys, more, {
		source: "sessions",
		of: context.input.source as (typeof SESSIONS_BEHIND_SOURCES)[number],
		header: context.header,
		...output,
	});
}

async function findCalls(context: FindContext): Promise<FoundPage> {
	const { input, scope, header } = context;
	const random = input.sort === "random";
	const keyOf = (row: CallRow): CursorKey =>
		random
			? [
					context.seed,
					padUInt64(row.random_key),
					row.session_id,
					row.agent_id,
					row.record_idx,
					row.block_idx,
				]
			: [
					row.at_ms,
					row.session_id,
					row.agent_id,
					row.record_idx,
					row.block_idx,
				];
	const position = callPosition(context);
	let rows: CallRow[] = [];
	let matched = 0;
	let minutes = 0;
	for (const batch of scope.batches) {
		const refs = batchRefs(input, batch);
		if (refs?.length === 0) continue;
		const found = await query(
			context.executor,
			CallRowSchema,
			buildCallRowsStatement(
				{
					scope: batch.scope,
					generations: batch.generations,
					input,
					refs,
					filters: context.filters,
				},
				position,
				context.limit + 1,
			),
		);
		matched += found[0]?.matched_calls ?? 0;
		minutes += found[0]?.matched_minutes ?? 0;
		rows.push(...found);
		rows = takePage(
			rows,
			keyOf,
			context.order,
			undefined,
			context.limit + 1,
		).page;
	}
	const { page, more } = takePage(
		rows,
		keyOf,
		context.order,
		context.after,
		context.limit,
	);
	header.matchedCalls = matched;
	header.groupCallTime = roundMinutes(minutes);
	if (context.filters) header.notes.push(callFilterNote(context.filters));
	return paged(context, page.map(keyOf), more, {
		source: "calls",
		header,
		rows: page.map((row) => toCall(row, context.sessions.get(row.session_id))),
	});
}

function callPosition(context: FindContext): CallPosition {
	const after = context.after;
	if (context.input.sort === "random")
		return {
			order: "random",
			seed: context.seed,
			after: after
				? [
						unpadUInt64(String(after[1])),
						String(after[2]),
						String(after[3]),
						Number(after[4]),
						Number(after[5]),
					]
				: undefined,
		};
	return {
		order: "time",
		after: after as
			| readonly [number, string, string, number, number]
			| undefined,
	};
}

function callFilterNote(filters: CompiledFilters): string {
	return `filters (calls view, AND): ${filters.text}`;
}

interface CallBucket {
	group: Omit<CallGroupResult, "normalized" | "examples" | "groupRunTime">;
	runs: Set<string>;
	/** Newest first: [last seen, batch index, session, agent, turn, record, block]. */
	examples: (readonly [
		number,
		number,
		string,
		string,
		number,
		number,
		number,
	])[];
}

/**
 * The scope's command-carrying calls grouped by a command identity column,
 * most calls first. Counts are summed over batches (their sessions are
 * disjoint); the examples are then read for the page's groups only.
 */
async function findCallGroups(
	context: FindContext,
	groupBy: CallGroupBy,
): Promise<FoundPage> {
	const { input, scope, header } = context;
	const buckets = new Map<string, CallBucket>();
	let unkeyed = 0;
	let uncounted = 0;
	let matched = 0;
	let minutes = 0;
	for (const [index, batch] of scope.batches.entries()) {
		const refs = batchRefs(input, batch);
		if (refs?.length === 0) continue;
		const groups = await query(
			context.executor,
			CallGroupRowSchema,
			buildCallGroupsStatement(
				{
					scope: batch.scope,
					generations: batch.generations,
					input,
					refs,
					filters: context.filters,
				},
				groupBy,
			),
		);
		for (const row of groups) {
			matched += row.calls;
			minutes += row.call_minutes;
			if (row.key === null) {
				unkeyed += row.calls;
				continue;
			}
			let bucket = buckets.get(row.key);
			if (!bucket) {
				if (buckets.size >= MAX_CALL_GROUPS) {
					uncounted += row.calls;
					continue;
				}
				bucket = {
					group: {
						key: row.key,
						calls: 0,
						sessions: 0,
						failedCalls: 0,
						firstSeen: new Date(row.first_ms).toISOString(),
						lastSeen: new Date(row.last_ms).toISOString(),
						groupCallTime: 0,
					},
					runs: new Set(),
					examples: [],
				};
				buckets.set(row.key, bucket);
			}
			const { group } = bucket;
			group.calls += row.calls;
			group.sessions += row.sessions;
			group.failedCalls += row.failed_calls;
			group.groupCallTime = (group.groupCallTime ?? 0) + row.call_minutes;
			for (const [position, agent, turn] of row.runs) {
				const sessionId = batch.generations[position - 1]?.sessionId;
				if (sessionId)
					bucket.runs.add(runKey({ sessionId, agentId: agent, turn }));
			}
			const first = new Date(row.first_ms).toISOString();
			const last = new Date(row.last_ms).toISOString();
			if (first < group.firstSeen) group.firstSeen = first;
			if (last > group.lastSeen) group.lastSeen = last;
			bucket.examples = [
				...bucket.examples,
				...row.examples.map(
					([at, [session, agent, turn, record, block]]) =>
						[at, index, session, agent, turn, record, block] as const,
				),
			]
				.sort((left, right) => compareKeys(left, right, EXAMPLE_ORDER))
				.slice(0, 3);
		}
	}
	const keyOf = ({ group }: CallBucket): CursorKey => [group.calls, group.key];
	const { page, more } = takePage(
		[...buckets.values()],
		keyOf,
		RUN_GROUP_ORDER,
		context.after,
		context.limit,
	);
	const texts = await callExamples(context, page);
	header.matchedCalls = matched;
	header.groupCallTime = roundMinutes(minutes);
	if (context.filters) header.notes.push(callFilterNote(context.filters));
	if (unkeyed)
		header.notes.push(
			groupBy === "commandFingerprint"
				? `${unkeyed} calls have no fingerprint: only part of their text is stored`
				: `${unkeyed} calls have no ${groupBy === "commandArgv0" ? "program" : "prefix"}: Codex code-mode scripts and written script files, which run no single program, and calls stored only in part`,
		);
	if (uncounted) {
		header.truncated = true;
		header.notes.push(
			`more than ${MAX_CALL_GROUPS} distinct keys: ${uncounted} calls with keys past them are not counted; narrow the scope (dates, latest, repository, agent)`,
		);
	}
	return paged(context, page.map(keyOf), more, {
		source: "calls",
		header,
		groups: page.map(({ group, examples, runs }) => {
			const shown = examples.flatMap(
				([, , session, agent, turn, record, block]) => {
					const text = texts.get(exampleKey(session, agent, record, block));
					return text ? [{ session, agent, turn, record, block, text }] : [];
				},
			);
			return {
				...group,
				groupCallTime: roundMinutes(group.groupCallTime ?? 0),
				groupRunTime: roundMinutes(
					[...runs].reduce(
						(sum, key) => sum + (context.runs.get(key)?.active_minutes ?? 0),
						0,
					),
				),
				normalized:
					groupBy === "commandFingerprint"
						? (shown[0]?.text.normalized ?? null)
						: null,
				examples: shown.map(
					({ session, agent, turn, record, block, text }) => ({
						ref: { sessionId: session, agentId: agent, turn },
						record,
						block,
						commandFrom: text.command_from,
						command: text.command,
						parentSessionId:
							context.sessions.get(session)?.parentSessionId ?? null,
					}),
				),
			};
		}),
	});
}

/** The command texts of the page's examples, one statement per batch that holds some. */
async function callExamples(
	context: FindContext,
	page: readonly CallBucket[],
): Promise<Map<string, CallExampleRow>> {
	const byBatch = new Map<
		number,
		(readonly [string, string, number, number])[]
	>();
	for (const { examples } of page)
		for (const [, index, session, agent, , record, block] of examples)
			byBatch.set(index, [
				...(byBatch.get(index) ?? []),
				[session, agent, record, block],
			]);
	const texts = new Map<string, CallExampleRow>();
	for (const [index, calls] of byBatch) {
		const batch = context.scope.batches[index];
		if (!batch) continue;
		for (const chunk of exampleChunks(batch, calls))
			for (const row of await query(
				context.executor,
				CallExampleRowSchema,
				buildCallExamplesStatement(batch.scope, batch.generations, chunk),
			))
				texts.set(
					exampleKey(
						row.session_id,
						row.agent_id,
						row.record_idx,
						row.block_idx,
					),
					row,
				);
	}
	return texts;
}

export function exampleChunks<
	T extends readonly [string, string, number, number],
>(
	batch: Pick<ScopeBatch, "scope" | "generations">,
	calls: readonly T[],
): T[][] {
	const pinned = Object.values(
		pinnedParams(batch.scope, batch.generations),
	).reduce<number>(
		(sum, value) =>
			sum +
			(Array.isArray(value) ? value : [value]).reduce<number>(
				(bytes, item: string | number) => bytes + paramValueBytes(item),
				0,
			),
		0,
	);
	const budget = Math.max(
		1024,
		MAX_CLICKHOUSE_URL_BYTES - EXAMPLE_URL_RESERVE - pinned,
	);
	return chunkByParamBytes(calls, (call) => [...call], budget);
}

function exampleKey(
	session: string,
	agent: string,
	record: number,
	block: number,
): string {
	return JSON.stringify([session, agent, record, block]);
}

/** `refs` of the batch's sessions; undefined when the input names no refs. */
function batchRefs(
	input: AnalysisFindInput,
	batch: ScopeBatch,
): RunRef[] | undefined {
	if (!input.refs) return undefined;
	const sessions = new Set(batch.sessions.map((session) => session.session_id));
	return input.refs.filter((ref) => sessions.has(ref.sessionId));
}

function toCall(
	row: CallRow,
	session: AnalysisSession | undefined,
): AnalysisCall {
	return {
		ref: rowRef(row),
		record: row.record_idx,
		block: row.block_idx,
		at: new Date(row.at_ms).toISOString(),
		agent: session?.source ?? "claude_code",
		tool: row.tool_name,
		filePath: row.command_from === "written" ? row.file_path : "",
		commandFrom: row.command_from,
		command: row.command,
		commandChars: row.command_chars,
		commandArgv0: row.command_argv0,
		commandPrefix: row.command_prefix,
		commandFingerprint: row.command_fingerprint,
		commandSimhash: row.command_simhash,
		failed: row.has_result ? row.failed : null,
		exitCode: row.has_result ? row.exit_code : null,
		callMinutes:
			row.call_minutes === null ? null : roundMinutes(row.call_minutes),
		parentSessionId: session?.parentSessionId ?? null,
	};
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
			input.refs?.length || input.model || context.filters
				? new Set(context.runs.keys())
				: null,
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

function treePick(
	tree: readonly TreeSession[],
	input: AnalysisFindInput,
): SessionPick {
	const days = tree.flatMap((session) =>
		session.atMs === null
			? []
			: [new Date(session.atMs).toISOString().slice(0, 10)],
	);
	const fallback = defaultRange(input);
	return {
		sessions: tree.map(({ userId, sessionId }) => ({ userId, sessionId })),
		range:
			days.length > 0
				? { from: days.reduce(minDay), to: fallback.to }
				: fallback,
	};
}

function placeInTree(scope: ResolvedScope, tree: readonly TreeSession[]): void {
	if (tree.length === 0) return;
	const places = new Map(tree.map((session) => [session.sessionId, session]));
	const root = tree[0]?.sessionId;
	if (!root) return;
	for (const batch of scope.batches)
		batch.sessions = batch.sessions.map((session) => {
			const place = places.get(session.session_id);
			return place
				? {
						...session,
						parentSessionId: place.parentSessionId,
						depth: place.depth,
						rootSessionId: root,
					}
				: session;
		});
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
	filtered?: { filters: CompiledFilters; header: Header; scope: AnalysisScope },
	computed?: ComputedRunFacts,
): Promise<Map<string, RunRow>> {
	const wanted = input.refs ? new Set(input.refs.map(runKey)) : undefined;
	const runs = new Map<string, RunRow>();
	let before = 0;
	const facts = await loadRunFacts(executor, scope.batches, computed);
	for (const [index, batch] of scope.batches.entries()) {
		const matching = filtered
			? new Set(
					(
						await query(
							executor,
							RunKeyRowSchema,
							buildRunFilterStatement(
								filtered.scope.organizationId,
								batch,
								filtered.filters,
							),
						)
					).map((row) => runKey(rowRef(row))),
				)
			: undefined;
		for (const row of facts.rows[index] ?? []) {
			const key = runKey(rowRef(row));
			if (wanted && !wanted.has(key)) continue;
			before++;
			if (matching && !matching.has(key)) continue;
			const run = input.model
				? runForModel(row, sessions.get(row.session_id), input.model)
				: row;
			if (run) runs.set(key, run);
		}
	}
	if (filtered)
		filtered.header.notes.push(
			`filters (runs view, AND): ${filtered.filters.text}; ${runs.size} of ${before} runs match, and only they are counted here${input.source === "runs" ? "" : ` and only ${input.source === "tool" ? "failures" : "events"} in them are shown`}; a run the run index does not hold yet is left out`,
		);
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
	const keyOf = (row: RunRow): CursorKey => {
		if (input.sort !== "random") return runSortKey(row, input.sort);
		const key = runKey(rowRef(row));
		return [context.seed, randomRank(context.seed, key), key];
	};
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
	const behind = isSessionsBehind(input) ? new SessionsBehind() : null;
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
					(context.filters && !context.runs.has(runKey(rowRef(row)))) ||
					(!input.includeNoise && cause.kind === "noise") ||
					(input.toolGroup && row.tool_group !== input.toolGroup) ||
					(input.commandClass && row.command_class !== input.commandClass) ||
					(input.kind && cause.kind !== input.kind) ||
					(input.cause && cause.cause !== input.cause) ||
					(input.detail && cause.detail !== input.detail)
				)
					return;
				const ref = rowRef(row);
				if (behind) {
					behind.add({ ref, record: row.record_idx, atMs: row.started_ms });
					return;
				}
				const at = new Date(row.started_ms).toISOString();
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
				const normalized = normalize(row.command);
				const command =
					normalized.length > 200 ? `${normalized.slice(0, 199)}…` : normalized;
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
	if (behind) return sessionsPage(context, behind, "rows", false);
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
	const behind = isSessionsBehind(input) ? new SessionsBehind() : null;
	for (const batch of scope.batches)
		await scanPages(
			context,
			(page) => buildTextScanStatement(batch.scope, batch.generations, page),
			TextRowSchema,
			(row) => {
				for (const event of reactionEvents(row)) {
					const count = counts.get(event.type);
					if (!count) continue;
					if (context.filters && !context.runs.has(runKey(event.eventRef)))
						continue;
					if (behind) {
						const { sessionId, agentId, turn, record } = event.eventRef;
						const ref = { sessionId, agentId, turn };
						behind.add({
							ref,
							record,
							atMs: Date.parse(event.at),
							runs: [runKey(event.originRef ?? ref)],
						});
						continue;
					}
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
	if (behind) return sessionsPage(context, behind, "runs", false);
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
	if (isSessionsBehind(input))
		return {
			source: "sessions",
			of: input.source as (typeof SESSIONS_BEHIND_SOURCES)[number],
			header,
			sessionTotals: { sessions: 0, rows: 0, firstSeen: null, lastSeen: null },
			sessions: [],
		};
	if (input.source === "tool") return { source: "tool", header, groups: [] };
	if (input.source === "user")
		return { source: "user", header, events: [], groups: [] };
	if (input.source === "git") return { source: "git", header, events: [] };
	if (input.source === "weekly")
		return { source: "weekly", header, snapshot: null, totals: [] };
	if (input.source === "calls")
		return input.groupBy
			? { source: "calls", header, groups: [] }
			: { source: "calls", header, rows: [] };
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
		random: "started_ms",
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
	if (isSessionsBehind(input)) return SESSIONS_BEHIND_ORDER;
	if (input.source === "tool") return TOOL_GROUP_ORDER;
	if (input.source === "user") return EVENT_ORDER;
	if (input.source === "git") return GIT_ORDER;
	if (input.source === "weekly") return weeklyOrder(input.groupBy);
	if (input.source === "calls")
		return input.groupBy
			? RUN_GROUP_ORDER
			: input.sort === "random"
				? RANDOM_CALL_ORDER
				: CALL_ORDER;
	if (input.groupBy) return RUN_GROUP_ORDER;
	return input.sort === "random" ? RANDOM_RUN_ORDER : RUN_ORDER;
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
