import type {
	AnalysisFindInput,
	AnalysisFindOutput,
	AnalysisRun,
	RunRef,
} from "@rudel/api-routes";
import type { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getClickhouse,
} from "../../clickhouse.js";
import { withAnalysisDeadline } from "./deadline.js";
import {
	CLASSIFIER_VERSION,
	classifyFailure,
	errorLine,
	normalize,
} from "./failure-classifier.js";
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
	type ResolvedScope,
	resolveScope,
	type ScopeBatch,
} from "./scope.js";
import { isAnalysisWorkLimit, query } from "./sql.js";

type Header = AnalysisFindOutput["header"];
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
	deadlineMs?: number;
}

interface FindContext {
	executor: ClickHouseExecutor;
	input: AnalysisFindInput;
	scope: ResolvedScope;
	header: Header;
	scan: ScanBudget;
	/** Every run of the scope (only `refs` when given), keyed by `runKey`. */
	runs: Map<string, RunRow>;
	sessions: Map<string, AnalysisSession>;
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

/** Rows per scan page; text is cut at 16k characters, so a page stays under the 16 MB result ceiling. */
const SCAN_PAGE_ROWS = 512;

export type { AnalysisScope };

/**
 * `find` answers where something happened: runs of a scope, failed tool calls
 * grouped by cause, or lexicon reactions with their origin runs. Everything is
 * deterministic and pinned to each session's committed transcript generation.
 * A ClickHouse work ceiling returns an explicitly incomplete answer, as does
 * a result too large for `ANALYSIS_OUTPUT_MAX_BYTES`.
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
			let owners: string[] = [];
			try {
				const resolved = await resolveScope(
					executor,
					scope,
					input,
					env.batchRecords,
				);
				owners = [
					...new Set(resolved.batches.map((batch) => batch.scope.userId)),
				];
				const context: FindContext = {
					executor,
					input,
					scope: resolved,
					header: newHeader(resolved),
					runs: await loadScopeRuns(executor, resolved, input),
					sessions: new Map(
						resolved.batches.flatMap((batch) =>
							batch.sessions.map((session) => [session.session_id, session]),
						),
					),
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
				const result = await findBySource(context);
				finishHeader(context);
				return { output: fitFindOutput(result), owners };
			} catch (error) {
				if (!isAnalysisWorkLimit(error)) throw error;
				return { output: emptyResult(input, workLimitHeader(input)), owners };
			}
		},
		env,
	);
}

function findBySource(context: FindContext): Promise<AnalysisFindOutput> {
	switch (context.input.source) {
		case "runs":
			return context.input.groupBy ? findRunGroups(context) : findRuns(context);
		case "tool":
			return findFailures(context);
		case "user":
			return findReactions(context);
	}
}

/** One run-facts statement per batch; everything else in the request works on these rows. */
async function loadScopeRuns(
	executor: ClickHouseExecutor,
	scope: ResolvedScope,
	input: AnalysisFindInput,
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
			if (!wanted || wanted.has(key)) runs.set(key, row);
		}
	return runs;
}

function addCoverage({ runs, header }: FindContext): void {
	const sessions = new Map<string, number>();
	for (const run of runs.values()) {
		header.runsInScope++;
		header.minutes += run.minutes;
		header.rawChars += run.raw_chars;
		if (run.cost === null) header.unpricedRuns++;
		else header.pricedCostUsd += run.cost;
		sessions.set(run.session_id, run.session_unattributed);
	}
	for (const unattributed of sessions.values())
		header.unattributedCostUsd += unattributed;
}

async function findRuns(context: FindContext): Promise<AnalysisFindOutput> {
	const { executor, input, scope, header } = context;
	const rows = [...context.runs.values()]
		.sort((left, right) => compareRuns(left, right, input.sort))
		.slice(0, input.limit);
	header.truncated ||= header.runsInScope > rows.length;
	const reactions = await nextReactions(executor, scope.batches, rows);
	return {
		source: "runs",
		header,
		rows: rows.map((row) => ({
			...toRun(row, context.sessions.get(row.session_id)),
			nextReaction: reactions.get(runKey(rowRef(row))) ?? null,
		})),
	};
}

function findRunGroups(context: FindContext): Promise<AnalysisFindOutput> {
	const { input, header } = context;
	const groups = new Map<
		string,
		{
			key: string;
			runs: number;
			sessions: Set<string>;
			minutes: number;
			cost: number | null;
		}
	>();
	for (const row of context.runs.values()) {
		const run = toRun(row, context.sessions.get(row.session_id));
		const key = groupKey(run, input.groupBy);
		const group = groups.get(key) ?? {
			key,
			runs: 0,
			sessions: new Set<string>(),
			minutes: 0,
			cost: null,
		};
		groups.set(key, group);
		group.runs++;
		group.sessions.add(row.session_id);
		group.minutes += row.minutes;
		group.cost = sumCost(group.cost, row.cost);
	}
	const sorted = [...groups.values()].sort(
		(left, right) =>
			right.runs - left.runs || left.key.localeCompare(right.key),
	);
	header.truncated ||= sorted.length > input.limit;
	return Promise.resolve({
		source: "runs",
		header,
		groups: sorted.slice(0, input.limit).map((group) => ({
			key: group.key,
			runs: group.runs,
			sessions: group.sessions.size,
			minutes: group.minutes,
			costUsd: roundNullableCost(group.cost),
		})),
	});
}

interface FailureBucket {
	group: ToolGroupResult;
	runs: Map<string, RunRef>;
	commands: Map<string, number>;
}

async function findFailures(context: FindContext): Promise<AnalysisFindOutput> {
	const { input, scope, header } = context;
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
					});
			},
		);
	const top = [...buckets.values()]
		.sort(
			(left, right) =>
				right.group.count - left.group.count ||
				left.group.cause.localeCompare(right.group.cause) ||
				left.group.detail.localeCompare(right.group.detail),
		)
		.slice(0, input.limit);
	header.truncated ||= buckets.size > top.length;
	const runs = context.runs;
	return {
		source: "tool",
		header,
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
	};
}

async function findReactions(
	context: FindContext,
): Promise<AnalysisFindOutput> {
	const { input, scope, header } = context;
	const counts = new Map(
		input.reaction.map((type) => [
			type,
			{ count: 0, sessions: new Set<string>() },
		]),
	);
	let events: TimedEvent[] = [];
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
					events.push(event);
				}
				if (events.length > input.limit * 2)
					events = newestEvents(events, input.limit);
			},
		);
	events = newestEvents(events, input.limit);
	const total = [...counts.values()].reduce(
		(sum, count) => sum + count.count,
		0,
	);
	header.truncated ||= total > events.length;
	const origins = context.runs;
	return {
		source: "user",
		header,
		events: events.map(({ at: _at, ...event }) => {
			const origin = event.originRef
				? origins.get(runKey(event.originRef))
				: undefined;
			return {
				...event,
				originMinutes: origin?.minutes ?? null,
				originCostUsd: roundNullableCost(origin?.cost ?? null),
			};
		}),
		groups: [...counts].map(([type, count]) => ({
			type,
			count: count.count,
			sessions: count.sessions.size,
		})),
	};
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
	header.unattributedCostUsd = roundCost(header.unattributedCostUsd);
	if (header.indexedSessions < header.sessionsInScope)
		header.notes.push(
			`run facts cover the ${header.indexedSessions} indexed of ${header.sessionsInScope} sessions in scope`,
		);
	if (header.unattributedCostUsd > 0)
		header.notes.push(
			"unattributedCostUsd is usage that cannot be tied to one run unambiguously; it is in no run's cost",
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

function workLimitHeader(input: AnalysisFindInput): Header {
	return {
		...newHeader({
			...defaultRange(input),
			sessionsInScope: 0,
			indexedSessions: 0,
			sessionCapReached: false,
			batches: [],
		}),
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
	return input.groupBy
		? { source: "runs", header, groups: [] }
		: { source: "runs", header, rows: [] };
}

function toRun(
	row: RunRow,
	session: AnalysisSession | undefined,
): Omit<AnalysisRun, "nextReaction"> {
	return {
		ref: rowRef(row),
		startedAt: new Date(row.started_ms).toISOString(),
		minutes: row.minutes,
		costUsd: roundNullableCost(row.cost),
		model: row.usage_model || session?.model || "",
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

function compareRuns(
	left: RunRow,
	right: RunRow,
	sort: AnalysisFindInput["sort"],
): number {
	const column = {
		startedAt: "started_ms",
		minutes: "minutes",
		costUsd: "cost",
		failedCalls: "failed_calls",
		rawChars: "raw_chars",
	} as const satisfies Record<AnalysisFindInput["sort"], keyof RunRow>;
	return (
		(right[column[sort]] ?? -Infinity) - (left[column[sort]] ?? -Infinity) ||
		runKey(rowRef(left)).localeCompare(runKey(rowRef(right)))
	);
}

function groupKey(
	run: Omit<AnalysisRun, "nextReaction">,
	groupBy: AnalysisFindInput["groupBy"],
): string {
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
		.sort(
			(left, right) =>
				right.at.localeCompare(left.at) ||
				right.eventRef.record - left.eventRef.record ||
				left.type.localeCompare(right.type),
		)
		.slice(0, limit);
}

function sumCost(left: number | null, right: number | null): number | null {
	return left === null && right === null ? null : (left ?? 0) + (right ?? 0);
}

function roundCost(cost: number): number {
	return Math.round(cost * 10_000) / 10_000;
}

function roundNullableCost(cost: number | null): number | null {
	return cost === null ? null : roundCost(cost);
}
