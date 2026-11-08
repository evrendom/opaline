import {
	type AnalysisSchemaInput,
	type AnalysisSchemaOutput,
	type AnalysisSqlOutput,
	RunRefSchema,
} from "@rudel/api-routes";
import { redactReturnedValue } from "@rudel/secret-filter";
import { z } from "zod";
import {
	ALLOWED_CLICKHOUSE_TABLES,
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { rowsQuote } from "../analysis-log/evidence.js";
import { describeSessions } from "../analysis-log/sessions.js";
import { RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";
import {
	mayReadSession,
	readableSessionOwner,
	type SessionReader,
} from "../session-visibility.js";
import {
	AGENT_QUERY_BUSY,
	AgentQueryBusyError,
	type AgentQueryLimiter,
} from "./agent-query-slots.js";
import { omittedMarker } from "./compact.js";
import { fitCount } from "./output-ceiling.js";
import { cell } from "./read-output.js";
import { limitRefusal, runSplit, splitBudget } from "./refused-split.js";
import type { MeasureParams } from "./retro-measure-sql.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./sql.js";
import { workspaceHasLegacyCalls } from "./sql-call-facts-view.js";
import {
	carriesText,
	checkParsedSql,
	type PreparedSql,
	prepareAgentSql,
	type SqlFailure,
	type SqlTableFunction,
	type SqlTableFunctionCall,
	type SqlWindow,
	withoutCtePrefix,
} from "./sql-guard.js";
import { SQL_MEASURES } from "./sql-measures.js";
import { resultNotices, type SqlTraps, sqlTraps } from "./sql-notices.js";
import type { SqlQuota, SqlResultStore } from "./sql-results.js";
import { findSqlView, SQL_SCOPE_PARAMS, SQL_VIEWS } from "./sql-views.js";

export type { SqlFailure } from "./sql-guard.js";

/**
 * The SQL gateway (docs/adr/0005-agents-query-l1-with-sql.md): an agent's
 * read-only SQL over the allowed views, scoped by the server to the caller's
 * workspace and the sessions they may read, run read-only within limits and a
 * per-workspace quota. A result is a compact table with cell and total caps,
 * says when something was cut, always says it is not evidence, and is stored
 * with its title, SQL and covered sessions under an id. An error is
 * recoverable (the failing part and how to fix or narrow it) or fatal
 * (refused; do not retry).
 */

export interface SqlCaller {
	readonly workspaceId: string;
	/**
	 * Who asks, with their role and the workspace's own-sessions-only option:
	 * whose sessions they read is decided by `session-visibility.ts`.
	 */
	readonly reader: SessionReader;
}

export interface SqlEnv {
	readonly executor: ClickHouseExecutor;
	readonly results: SqlResultStore;
	readonly quota: SqlQuota;
	/** The slots agent queries share across instances; each statement runs in one. */
	readonly limiter: AgentQueryLimiter;
	/**
	 * The GitHub repositories whose facts the workspace may read: its active
	 * bindings while GitHub outcomes are visible to it, otherwise none.
	 */
	readonly githubRepositories: (
		workspaceId: string,
	) => Promise<readonly string[]>;
	/** Table functions the server offers in agent SQL, e.g. `search`. */
	readonly functions?: readonly SqlServerFunction[];
}

/**
 * A table function the server offers in agent SQL (`search('…')`): the
 * statement in place of each call, scoped like the views, and the parameters
 * it binds once the query passed every check.
 */
export interface SqlServerFunction {
	readonly name: string;
	statement(
		call: SqlTableFunctionCall,
		memberOnly: boolean,
	): ReturnType<SqlTableFunction>;
	bind(
		caller: SqlCaller,
		calls: readonly SqlTableFunctionCall[],
	): Promise<
		| { params: Record<string, unknown>; notices: string[] }
		| { failure: SqlFailure }
	>;
}

export type SqlOutcome =
	| {
			readonly ok: true;
			readonly result: AnalysisSqlOutput;
			/** Members whose sessions the query could read, stored with it. */
			readonly owners: readonly string[];
			/**
			 * The shown rows carry text from the sessions (`rowsQuote`): deleting
			 * any member it could read deletes the result, not only its rows.
			 */
			readonly quotes: boolean;
	  }
	| { readonly ok: false; readonly error: SqlFailure };

export type SchemaOutcome =
	| { readonly ok: true; readonly result: AnalysisSchemaOutput }
	| { readonly ok: false; readonly error: SqlFailure };

/** Per-query limits: ClickHouse is small (6 cores, 5.4 GiB) and shared. */
export const SQL_LIMITS = {
	seconds: 10,
	memoryBytes: 512 * 1024 * 1024,
	spillBytes: 256 * 1024 * 1024,
	rowsRead: 50_000_000,
	bytesRead: 4 * 1024 * 1024 * 1024,
	/** Rows shown; one more is read to know that there were more. */
	rows: 200,
	cellChars: 300,
	tableChars: 24_000,
	resultBytes: 16 * 1024 * 1024,
	/**
	 * Bytes of the statement once views and `search()` calls are expanded:
	 * ClickHouse refuses a query over `max_query_size` (262,144) unparsed.
	 */
	statementBytes: 200_000,
} as const;

/**
 * Names an agent's SQL may never use: the server's databases and its tables,
 * except where a view column has the same name.
 */
const RESERVED_NAMES: ReadonlySet<string> = new Set(
	[
		"rudel",
		"system",
		"default",
		"information_schema",
		...[...ALLOWED_CLICKHOUSE_TABLES].map(
			(table) => table.split(".").at(-1) ?? table,
		),
	]
		.map((name) => name.toLowerCase())
		.filter(
			(name) =>
				!SQL_VIEWS.some((view) =>
					view.columns.some((column) => column.name === name),
				),
		),
);

/** How many values `schema` lists for a column, and over which runs. */
const TOP_VALUES = 20;
const TOP_VALUES_DAYS = 30;

/**
 * What one agent statement may take of ClickHouse: time, memory, rows and
 * bytes read, and two of its six cores. The `run` tool reads under the same
 * limits (`withSqlLimits`).
 */
const SQL_QUERY_LIMITS = {
	max_execution_time: SQL_LIMITS.seconds,
	timeout_overflow_mode: "throw",
	max_memory_usage: String(SQL_LIMITS.memoryBytes),
	max_bytes_before_external_group_by: String(SQL_LIMITS.spillBytes),
	max_bytes_before_external_sort: String(SQL_LIMITS.spillBytes),
	max_rows_to_read: String(SQL_LIMITS.rowsRead),
	max_bytes_to_read: String(SQL_LIMITS.bytesRead),
	read_overflow_mode: "throw",
	max_threads: 2,
} as const;

export const SQL_SETTINGS: NonNullable<
	ClickHouseStatement["clickhouse_settings"]
> = {
	readonly: "1",
	...SQL_QUERY_LIMITS,
	// Caps the rows of the result as LIMIT would; the order is kept.
	limit: String(SQL_LIMITS.rows + 1),
	// Bigger results fail with a notice to narrow, never arrive cut silently.
	max_result_bytes: String(SQL_LIMITS.resultBytes),
	result_overflow_mode: "throw",
	remote_filesystem_read_prefetch: 0,
	timeout_before_checking_execution_speed: 0,
};

/**
 * An executor whose reads run within the sql tool's per-statement limits,
 * whatever settings the statement brings: for tools that read on an
 * agent's behalf outside the gateway, such as `run`.
 */
export function withSqlLimits(
	executor: ClickHouseExecutor,
): ClickHouseExecutor {
	const limited = (statement: ClickHouseStatement): ClickHouseStatement => ({
		...statement,
		clickhouse_settings: {
			...statement.clickhouse_settings,
			...SQL_QUERY_LIMITS,
		},
	});
	return {
		close: () => executor.close(),
		execute: (statement) => executor.execute(limited(statement)),
		query: (statement) => executor.query(limited(statement)),
		insert: (params) => executor.insert(params),
	};
}

/** The refusal of a call past the workspace's quota, which sql and run share. */
export function quotaExceeded(
	quota: Pick<SqlQuota, "queries" | "windowMs">,
	resetsAt: Date,
): SqlFailure {
	return {
		kind: "fatal",
		message: `The workspace used its SQL quota of ${quota.queries} queries (sql and run calls) per ${quota.windowMs / 60_000} minutes.`,
		fragment: null,
		fix: [
			`Do not retry before ${resetsAt.toISOString()}. Instead:`,
			"1. Answer with what you have.",
			"2. Use find and read, which this quota does not count.",
		].join("\n"),
	};
}

export const NOT_EVIDENCE =
	"not evidence: these rows say where to look, not why. Open the runs with read (session_id, agent_id, and turn_idx as its turn) before naming a cause.";

type SqlRow = Record<string, unknown>;

export interface SqlSplit {
	readonly stage: string;
	readonly window: MeasureParams;
	readonly build: (window: MeasureParams) => SqlPart;
	readonly merge?: (pieces: SqlRow[][]) => SqlRow[];
	readonly approximate?: string;
}

export interface SqlPart {
	readonly query: string;
	readonly cohort?: string;
	readonly rows?: number;
}

export interface SqlParts {
	readonly queries: readonly (SqlPart & { readonly split?: SqlSplit })[];
	readonly merge: (rows: SqlRow[]) => SqlRow[];
}

interface Followed {
	readonly rows: SqlRow[];
	readonly columns: string[];
	readonly sessions: AnalysisSqlOutput["sessions"];
	readonly owners: readonly string[];
}

export function wrapRows(rows: number): {
	prefix: string;
	suffix: string;
	rows: number;
} {
	return { prefix: "SELECT * FROM (\n", suffix: "\n)", rows: rows + 1 };
}

class PartFailed extends Error {
	constructor(readonly failure: SqlFailure) {
		super(failure.message);
	}
}

async function runSplitParts<T>(
	caller: SqlCaller,
	input: { cohort?: string; parts: SqlParts },
	env: AgentSqlEnv,
	signal: AbortSignal | undefined,
	follow: (rows: SqlRow[]) => Promise<T>,
): Promise<
	{ ok: true; value: T; notices: string[] } | { ok: false; error: SqlFailure }
> {
	const budget = splitBudget();
	const rows: SqlRow[] = [];
	const notices: string[] = [];
	const run = async (part: SqlPart) => {
		const done = await execute(
			caller,
			part.query,
			env,
			signal,
			async (found) => found,
			part.rows ? wrapRows(part.rows) : undefined,
			part.cohort ?? input.cohort,
		);
		if (done.ok) {
			notices.push(...done.notices);
			return done.value;
		}
		throw limitRefusal(done.error) ?? new PartFailed(done.error);
	};
	let completed = 0;
	let refused: SqlFailure | null = null;
	try {
		for (const part of input.parts.queries) {
			const split = part.split;
			if (!split) {
				rows.push(...(await run(part)));
				completed += 1;
				continue;
			}
			const outcome = await runSplit(
				split.stage,
				split.window,
				(window, piece) => run(piece ? split.build(window) : part),
				budget,
				split.approximate ? { approximate: split.approximate } : {},
			);
			if (!outcome.ok) {
				refused ??= outcome.refusal?.failure ?? null;
				continue;
			}
			completed += 1;
			rows.push(
				...(outcome.values.length > 1 && split.merge
					? split.merge(outcome.values)
					: outcome.values.flat()),
			);
		}
	} catch (error) {
		if (error instanceof PartFailed) return { ok: false, error: error.failure };
		throw error;
	}
	if (completed === 0)
		return {
			ok: false,
			error: {
				...(refused ?? BUSY),
				message: [refused?.message ?? BUSY.message, ...budget.partial].join(
					" ",
				),
			},
		};
	try {
		const value = await env.limiter.withAgentQuerySlot(
			caller.workspaceId,
			() => follow(input.parts.merge(rows)),
			signal,
		);
		return {
			ok: true,
			value,
			notices: [...notices, ...budget.notes, ...budget.partial],
		};
	} catch (error) {
		if (!(error instanceof AgentQueryBusyError)) throw error;
		return { ok: false, error: BUSY };
	}
}

export function runSql(
	caller: SqlCaller,
	input: {
		query: string;
		title: string;
		cohort?: string;
		measure?: AnalysisSqlOutput["measure"];
		parts?: SqlParts;
		traps?: boolean;
	},
	env: SqlEnv,
	signal?: AbortSignal,
): Promise<SqlOutcome> {
	return runStatements(caller, input, withCallQuota(env), signal);
}

async function runStatements(
	caller: SqlCaller,
	input: Parameters<typeof runSql>[1],
	env: SqlEnv,
	signal: AbortSignal | undefined,
): Promise<SqlOutcome> {
	const follow = (found: SqlRow[]): Promise<Followed> => {
		const rows = found.map((row) => redactReturnedValue(row) as SqlRow);
		const columns = Object.keys(rows[0] ?? {});
		return Promise.all([
			namedSessions(caller, columns, rows, env.executor),
			coveredOwners(caller, env.executor),
		]).then(([sessions, owners]) => ({ rows, columns, sessions, owners }));
	};
	const parts = input.parts;
	const executed = parts?.queries.some((part) => part.split)
		? await runSplitParts(caller, { ...input, parts }, env, signal, follow)
		: await runParts(caller, input, env, signal, follow);
	if (!executed.ok) return executed;
	const { rows, columns, sessions, owners } = executed.value;
	const table = renderTable(columns, rows);
	const output: Omit<AnalysisSqlOutput, "id"> = {
		title: input.title,
		query: input.query,
		columns,
		rows: table.rows,
		truncated: table.notices.length > 0,
		table: table.text,
		notices: [...table.notices, ...executed.notices, NOT_EVIDENCE],
		sessions,
		// Findings cite only what the agent saw: the rows the table shows.
		runs: namedRuns(columns, rows.slice(0, table.rows), sessions),
		...(input.measure ? { measure: input.measure } : {}),
	};
	const quotes = rowsQuote(
		rows.slice(0, table.rows),
		new Set([
			caller.workspaceId,
			...owners,
			...sessions.flatMap((session) => [session.sessionId, session.ownerId]),
			...output.runs.map((run) => run.agentId),
		]),
	);
	const id = await env.results.save({
		workspaceId: caller.workspaceId,
		authorId: caller.reader.userId,
		title: input.title,
		query: input.query,
		output,
		owners,
		counts: !quotes,
		queryCarriesText: carriesText(input.query),
	});
	return { ok: true, result: { id, ...output }, owners, quotes };
}

async function runParts<T>(
	caller: SqlCaller,
	input: {
		query: string;
		cohort?: string;
		parts?: SqlParts;
		traps?: boolean;
	},
	env: AgentSqlEnv,
	signal: AbortSignal | undefined,
	follow: (rows: SqlRow[]) => Promise<T>,
): Promise<
	{ ok: true; value: T; notices: string[] } | { ok: false; error: SqlFailure }
> {
	const queries = input.parts?.queries ?? [{ query: input.query }];
	const merge = input.parts?.merge ?? ((rows) => rows);
	const earlier: SqlRow[] = [];
	const notices: string[] = [];
	for (const part of queries.slice(0, -1)) {
		const done = await execute(
			caller,
			part.query,
			env,
			signal,
			async (found) => found,
			undefined,
			part.cohort ?? input.cohort,
			input.traps,
		);
		if (!done.ok) return done;
		earlier.push(...done.value);
		notices.push(...done.notices);
	}
	const last = queries.at(-1);
	// The lookups for the result read ClickHouse too, so they hold the slot.
	const executed = await execute(
		caller,
		last?.query ?? input.query,
		env,
		signal,
		(found) => follow(merge([...earlier, ...found])),
		undefined,
		last?.cohort ?? input.cohort,
		input.traps,
	);
	if (!executed.ok) return executed;
	return {
		ok: true,
		value: executed.value,
		notices: [...notices, ...executed.notices],
	};
}

export function partRows(
	caller: SqlCaller,
	input: { query: string; cohort?: string; parts: SqlParts },
	env: AgentSqlEnv,
	signal?: AbortSignal,
): Promise<
	| { ok: true; value: SqlRow[]; notices: string[] }
	| { ok: false; error: SqlFailure }
> {
	const rows = async (found: SqlRow[]) => found;
	return input.parts.queries.some((part) => part.split)
		? runSplitParts(caller, input, env, signal, rows)
		: runParts(caller, input, env, signal, rows);
}

export function guardSql(caller: SqlCaller, sql: string): SqlFailure | null {
	const memberOnly = readableSessionOwner(caller.reader) !== null;
	const prepared = prepareAgentSql(
		sql,
		new Map(
			SQL_VIEWS.map((view) => [
				view.name,
				{
					windowColumn: view.windowColumn,
					statement: (window: SqlWindow) => view.sql(memberOnly, window),
				},
			]),
		),
		RESERVED_NAMES,
	);
	return prepared.ok ? null : prepared.failure;
}

/** A refusal as the agent reads it: what failed, where, and what to do. */
export function describeSqlFailure(failure: SqlFailure): string {
	return failure.kind === "fatal"
		? [`refused, do not retry: ${failure.message}`, failure.fix].join("\n")
		: [
				`error, recoverable: ${failure.message}`,
				...(failure.fragment ? [`failing part: ${failure.fragment}`] : []),
				`fix: ${failure.fix}`,
			].join("\n");
}

/** The views, one view's columns with meaning and traps, or one column's top values. */
export async function describeSchema(
	caller: SqlCaller,
	input: AnalysisSchemaInput,
	env: SqlEnv,
	signal?: AbortSignal,
): Promise<SchemaOutcome> {
	if (input.view === undefined)
		return {
			ok: true,
			result: {
				level: "views",
				views: SQL_VIEWS.map((view) => ({
					name: view.name,
					grain: view.grain,
					columns: view.columns.length,
				})),
				measures: SQL_MEASURES.map((measure) => ({ ...measure })),
				notes: [
					"Rank and compare with the approved measures, so analyses agree and before/after comparisons hold; say which order you ranked by.",
					"Pass view to see its columns with their meaning and traps, then column to see its most common values.",
					"Every view holds only the sessions you may read, and GitHub facts only of the repositories the workspace connected; the server adds the workspace.",
					"Views join to runs by run_id; edges chain runs to commits, pull requests and CI runs (ci_jobs); setup_files lists the setup file versions each run received.",
				],
				// The caller adds the run questions agents may ask.
				questions: [],
			},
		};
	const view = findSqlView(input.view);
	if (!view)
		return unknownName(
			input.view,
			`${input.view} is not a view.`,
			`Pass one of: ${SQL_VIEWS.map((item) => item.name).join(", ")}.`,
		);
	if (input.column === undefined)
		return {
			ok: true,
			result: {
				level: "columns",
				view: view.name,
				grain: view.grain,
				traps: [...view.traps],
				columns: view.columns.map((column) => ({
					...column,
					traps: [...column.traps],
				})),
			},
		};
	const column = view.columns.find((item) => item.name === input.column);
	if (!column)
		return unknownName(
			input.column,
			`${view.name} has no column ${input.column}.`,
			`Call schema view=${view.name} for its columns.`,
		);
	const value = column.type.startsWith("Array(")
		? `arrayJoin(${column.name})`
		: column.name;
	const executed = await execute(
		caller,
		`SELECT toString(${value}) AS value, count() AS rows FROM ${view.name}
			WHERE ${view.recent.column} >= now() - INTERVAL ${TOP_VALUES_DAYS} DAY
			GROUP BY value ORDER BY rows DESC, value LIMIT ${TOP_VALUES}`,
		env,
		signal,
		async (rows) => rows,
	);
	if (!executed.ok) return executed;
	const values = z
		.array(z.object({ value: z.string().nullable(), rows: z.coerce.number() }))
		.parse(executed.value)
		.map((row) => ({
			value: clip(cell(redactReturnedValue(row.value))).text,
			rows: row.rows,
		}));
	return {
		ok: true,
		result: {
			level: "values",
			view: view.name,
			column: { ...column, traps: [...column.traps] },
			over: `${view.recent.rows} in the last ${TOP_VALUES_DAYS} days`,
			values,
			notices: [
				values.length === TOP_VALUES
					? `only the ${TOP_VALUES} most common values; count the rest with sql.`
					: "every value is listed.",
			],
		},
	};
}

/** The member a view is held to, bound as a parameter, when the reader may read only their own sessions. */
function memberParam(caller: SqlCaller): Record<string, string> {
	const only = readableSessionOwner(caller.reader);
	return only === null ? {} : { [SQL_SCOPE_PARAMS.member]: only };
}

/** A run an agent's SQL selected. */
export interface SelectedRun {
	readonly sessionId: string;
	readonly agentId: string;
	readonly turn: number;
}

/**
 * The runs an agent's SQL selects (run questions, docs/retro-architecture.md):
 * the same guard, scope, limits, query slot and quota as `sql`, but only the
 * distinct session_id, agent_id and turn_idx of its rows, up to `max`, handed
 * to `follow` within the slot. `more` says the query selected more than
 * `max`. Nothing is stored.
 */
export async function selectRuns<T>(
	caller: SqlCaller,
	sql: string,
	env: AgentSqlEnv,
	max: number,
	follow: (selected: { runs: SelectedRun[]; more: boolean }) => Promise<T>,
	signal?: AbortSignal,
): Promise<{ ok: true; value: T } | { ok: false; error: SqlFailure }> {
	const executed = await execute(
		caller,
		sql,
		env,
		signal,
		(rows) => {
			const runs = z
				.array(
					z.object({
						session_id: z.string(),
						agent_id: z.string(),
						turn_idx: z.coerce.number(),
					}),
				)
				.parse(rows)
				.map((row) => ({
					sessionId: row.session_id,
					agentId: row.agent_id,
					turn: row.turn_idx,
				}));
			return follow({ runs: runs.slice(0, max), more: runs.length > max });
		},
		{
			prefix: SELECT_RUNS_PREFIX,
			// On its own line, so a trailing line comment cannot swallow it.
			suffix: `\n) ORDER BY session_id, agent_id, turn_idx LIMIT ${max + 1}`,
			rows: max + 1,
		},
	);
	if (!executed.ok)
		return RUN_COLUMNS.includes(executed.error.fragment ?? "")
			? {
					ok: false,
					error: {
						...executed.error,
						message: `The query must return the columns session_id, agent_id and turn_idx; ${executed.error.fragment} is missing.`,
						fix: "Select them from runs, e.g. SELECT session_id, agent_id, turn_idx FROM runs WHERE started_at >= now() - INTERVAL 28 DAY.",
					},
				}
			: executed;
	return { ok: true, value: executed.value };
}

const RUN_COLUMNS = ["session_id", "agent_id", "turn_idx"];
const COHORT = "opaline_cohort";
const SELECT_RUNS_PREFIX =
	"SELECT DISTINCT session_id, agent_id, turn_idx FROM (";

/** What running an agent's SQL needs of the sql environment. */
export type AgentSqlEnv = Pick<
	SqlEnv,
	"executor" | "quota" | "limiter" | "githubRepositories" | "functions"
>;

/**
 * Runs the agent's SQL and then `follow` on its rows, both in a query slot
 * of the workspace, or says why it is refused.
 */
export async function execute<T>(
	caller: SqlCaller,
	sql: string,
	env: AgentSqlEnv,
	signal: AbortSignal | undefined,
	follow: (rows: Record<string, unknown>[]) => Promise<T>,
	/** Wraps the scoped statement, e.g. to keep only some columns, with its own row cap. */
	given?: { prefix: string; suffix: string; rows: number },
	cohort?: string,
	traps?: boolean,
): Promise<
	{ ok: true; value: T; notices: string[] } | { ok: false; error: SqlFailure }
> {
	const prepared = await prepareAgentStatement(
		caller,
		sql,
		env,
		given,
		cohort,
		traps,
	);
	if (!prepared.ok) return prepared;
	const {
		statement,
		notices,
		classify: refusal,
		traps: found,
	} = prepared.value;
	return withAgentQuery(
		caller.workspaceId,
		env,
		async (): Promise<
			| { ok: true; value: T; notices: string[] }
			| { ok: false; error: SqlFailure }
		> => {
			let rows: Record<string, unknown>[];
			try {
				rows = await env.executor.query<Record<string, unknown>>(statement);
			} catch (error) {
				const failure = refusal(error);
				if (!failure) throw error;
				return { ok: false, error: failure };
			}
			return {
				ok: true,
				value: await follow(rows),
				notices: found ? [...notices, ...resultNotices(found, rows)] : notices,
			};
		},
		signal,
	);
}

export interface PreparedAgentStatement {
	readonly statement: ClickHouseStatement;
	readonly notices: string[];
	readonly classify: (error: unknown) => SqlFailure | null;
	readonly traps?: SqlTraps;
}

const CALLS_WORD = /\bcalls\b/iu;

export async function prepareAgentStatement(
	caller: SqlCaller,
	sql: string,
	env: AgentSqlEnv,
	given?: { prefix: string; suffix: string; rows: number },
	cohort?: string,
	traps?: boolean,
): Promise<
	{ ok: true; value: PreparedAgentStatement } | { ok: false; error: SqlFailure }
> {
	const memberOnly = readableSessionOwner(caller.reader) !== null;
	const functions = env.functions ?? [];
	const legacyCalls = CALLS_WORD.test(`${sql}\n${cohort ?? ""}`)
		? await workspaceHasLegacyCalls(env.executor, caller.workspaceId)
		: true;
	const views = (narrowed: boolean) =>
		new Map(
			SQL_VIEWS.map((view) => [
				view.name,
				{
					windowColumn: view.windowColumn,
					statement: (window: SqlWindow) =>
						view.sql(memberOnly, {
							...window,
							legacyCalls,
							...(narrowed ? { cohort: COHORT } : {}),
						}),
				},
			]),
		);
	const scoped =
		cohort === undefined
			? undefined
			: prepareAgentSql(cohort, views(false), RESERVED_NAMES);
	if (scoped && !scoped.ok) return { ok: false, error: scoped.failure };
	const cohortWith = scoped?.ok
		? `WITH (SELECT groupUniqArray((user_id, session_id)) FROM (${scoped.prepared.sql})) AS ${COHORT}\n`
		: "";
	const wrap = given
		? { ...given, prefix: `${cohortWith}${given.prefix}` }
		: scoped?.ok
			? {
					prefix: `${cohortWith}SELECT * FROM (\n`,
					suffix: "\n)",
					rows: SQL_LIMITS.rows + 1,
				}
			: undefined;
	const prepared = prepareAgentSql(
		sql,
		views(scoped !== undefined),
		RESERVED_NAMES,
		new Map(
			functions.map((fn) => [
				fn.name,
				(call: SqlTableFunctionCall) => fn.statement(call, memberOnly),
			]),
		),
	);
	if (!prepared.ok) return { ok: false, error: prepared.failure };
	const statementBytes =
		Buffer.byteLength(prepared.prepared.sql, "utf8") +
		Buffer.byteLength(wrap?.prefix ?? "", "utf8");
	if (statementBytes > SQL_LIMITS.statementBytes)
		return {
			ok: false,
			error: {
				kind: "recoverable",
				message: `The query is too large once its views and search() calls are expanded: ${statementBytes.toLocaleString("en-US")} bytes, more than the ${SQL_LIMITS.statementBytes.toLocaleString("en-US")} ClickHouse is given.`,
				fragment: null,
				fix: "Name each view or search() once in a WITH clause and read that name, or split the query into several.",
			},
		};
	const parsed = await checkWithClickHouseParser(
		sql,
		prepared.prepared,
		env,
		new Set(functions.map((fn) => fn.name)),
	);
	if ("failure" in parsed) return { ok: false, error: parsed.failure };
	const found = traps ? sqlTraps(parsed.explain) : undefined;
	// Server functions bind before the slot: their own work (search embeds
	// its text) holds no query slot and takes no sql quota; a refusal there
	// costs none either.
	const bound: Record<string, unknown> = {};
	const notices: string[] = [...(found?.notices ?? [])];
	for (const fn of functions) {
		const calls = prepared.prepared.calls.filter(
			(call) => call.name === fn.name,
		);
		if (calls.length === 0) continue;
		const binding = await fn.bind(caller, calls);
		if ("failure" in binding) return { ok: false, error: binding.failure };
		Object.assign(bound, binding.params);
		notices.push(...binding.notices);
	}
	const statement: ClickHouseStatement = {
		clickhouse_settings: wrap
			? { ...SQL_SETTINGS, limit: String(wrap.rows) }
			: SQL_SETTINGS,
		query: wrap
			? `${wrap.prefix}${prepared.prepared.sql}${wrap.suffix}`
			: prepared.prepared.sql,
		query_params: {
			...bound,
			[SQL_SCOPE_PARAMS.workspace]: caller.workspaceId,
			[SQL_SCOPE_PARAMS.viewer]: caller.reader.userId,
			...memberParam(caller),
			...(prepared.prepared.sql.includes(`{${SQL_SCOPE_PARAMS.repositories}:`)
				? {
						[SQL_SCOPE_PARAMS.repositories]: [
							...(await env.githubRepositories(caller.workspaceId)),
						],
					}
				: {}),
		},
	};
	const offset = wrap?.prefix.length ?? 0;
	return {
		ok: true,
		value: {
			statement,
			notices,
			classify: (error) =>
				classify(error, sql, {
					...prepared.prepared,
					originOf: (position) =>
						prepared.prepared.originOf(Math.max(0, position - offset)),
				}),
			...(found ? { traps: found } : {}),
		},
	};
}

/**
 * Runs `work` (an agent's ClickHouse reads: sql, search, run_questions) in a
 * query slot of the workspace, taking one query of its quota inside the slot,
 * so a busy refusal costs none; within `withCallQuota`, only the call's first
 * statement takes one. Past the quota, or with no slot free, it says why
 * instead.
 */
export async function withAgentQuery<T>(
	workspaceId: string,
	env: { readonly limiter: AgentQueryLimiter; readonly quota: SqlQuota },
	work: () => Promise<T | { ok: false; error: SqlFailure }>,
	signal?: AbortSignal,
): Promise<T | { ok: false; error: SqlFailure }> {
	try {
		return await env.limiter.withAgentQuerySlot(
			workspaceId,
			async () => {
				const quota = await env.quota.take(workspaceId);
				if (!quota.allowed)
					return {
						ok: false as const,
						error: quotaExceeded(env.quota, quota.resetsAt),
					};
				return await work();
			},
			signal,
		);
	} catch (error) {
		if (!(error instanceof AgentQueryBusyError)) throw error;
		return { ok: false, error: BUSY };
	}
}

export function withCallQuota<E extends { readonly quota: SqlQuota }>(
	env: E,
): E {
	let taken: ReturnType<SqlQuota["take"]> | null = null;
	return {
		...env,
		quota: {
			queries: env.quota.queries,
			windowMs: env.quota.windowMs,
			take: (workspaceId: string) => {
				taken ??= env.quota.take(workspaceId);
				return taken;
			},
		},
	};
}

/** No query slot came free, or ClickHouse as a whole is short of memory. */
const BUSY: SqlFailure = {
	kind: "recoverable",
	message: AGENT_QUERY_BUSY,
	fragment: null,
	fix: "Run the same query again in a few seconds; nothing in it needs to change.",
};

/**
 * The parse runs read-only with a short deadline and, unlike the query, no row
 * cap. The client's FORMAT clause attaches to the parsed SELECT, so the
 * output format comes from `default_format`.
 */
const PARSE_SETTINGS: NonNullable<ClickHouseStatement["clickhouse_settings"]> =
	{
		readonly: "1",
		max_execution_time: 5,
		default_format: "JSONEachRow",
	};
const PARSE_PREFIX = "EXPLAIN AST ";

/**
 * ClickHouse's own parse of the agent's SQL, checked node by node, so the
 * token rules are not the only barrier. Parsing executes nothing.
 */
async function checkWithClickHouseParser(
	sql: string,
	prepared: PreparedSql,
	env: Pick<SqlEnv, "executor">,
	functions: ReadonlySet<string>,
): Promise<{ failure: SqlFailure } | { explain: string[] }> {
	let lines: string[];
	try {
		const rows = await env.executor.query<{ explain?: unknown }>({
			clickhouse_settings: PARSE_SETTINGS,
			query: `${PARSE_PREFIX}${prepared.parsed.sql}`,
		});
		lines = rows.map((row) => String(row.explain ?? ""));
	} catch (error) {
		const failure = classify(error, sql, {
			...prepared,
			originOf: (offset) =>
				prepared.parsed.originOf(Math.max(0, offset - PARSE_PREFIX.length)),
		});
		if (!failure) throw error;
		return { failure };
	}
	const failure = checkParsedSql(lines, {
		views: new Set(SQL_VIEWS.map((view) => view.name)),
		ctes: prepared.ctes,
		functions,
	});
	return failure ? { failure } : { explain: lines };
}

/** Limits a narrower query can pass: recoverable. */
const LIMIT_FIXES: Readonly<Record<string, string>> = {
	TIMEOUT_EXCEEDED: `The query ran past ${SQL_LIMITS.seconds} seconds.`,
	TOO_SLOW: `The query would run past ${SQL_LIMITS.seconds} seconds.`,
	TOO_MANY_ROWS_OR_BYTES: `The result is larger than ${SQL_LIMITS.resultBytes / 1024 / 1024} MiB.`,
};
/**
 * Memory and read limits: fatal, so the agent never runs the same query
 * again; each run of it would take the same memory from the ClickHouse that
 * ingest and merges share.
 */
const READ_LIMITS: Readonly<Record<string, string>> = {
	MEMORY_LIMIT_EXCEEDED: `The query needed more than ${SQL_LIMITS.memoryBytes / 1024 / 1024} MiB of memory`,
	TOO_MANY_ROWS: `The query read more than ${SQL_LIMITS.rowsRead.toLocaleString("en-US")} rows`,
	TOO_MANY_BYTES: `The query read more than ${SQL_LIMITS.bytesRead / 1024 / 1024 / 1024} GiB`,
};
const NARROW_HOW = [
	"1. Shorten the time range (started_at, at, observed_at).",
	"2. Add filters: fewer members or sessions (user_id, or session_id IN (SELECT session_id FROM runs WHERE started_at >= …)).",
	"3. Select fewer or narrower columns (leave out long text such as prompt_head, command and text, and arrays) and lower the LIMIT.",
	"4. Aggregate with GROUP BY before ordering.",
].join("\n");
const NARROW = `Narrow the query and retry:\n${NARROW_HOW}`;
const QUERY_FIXES: Readonly<Record<string, string>> = {
	ILLEGAL_AGGREGATION:
		"An aggregate's alias reuses a column name that another aggregate or the WHERE reads (sum(cost_usd) AS cost_usd, then sum(cost_usd) / runs), so ClickHouse reads the alias there. Give each aggregate a new alias (sum(cost_usd) AS total_cost_usd), use the new name where the query means the total, and run the query again.",
	CANNOT_COMPILE_REGEXP:
		"Regular expressions are RE2: no lookahead or lookbehind, no \\uXXXX escapes. Write the character itself ('✖') or its code point with the backslash doubled, as every backslash in a SQL string is ('\\\\x{2716}'; '\\\\.' matches a dot). For a plain substring use position() or LIKE instead.",
	CANNOT_PARSE_DATE:
		"Write dates as 'YYYY-MM-DD' (toDate('2026-10-06')) and times as 'YYYY-MM-DD hh:mm:ss' (toDateTime64('2026-10-06 13:50:00', 3, 'UTC')), seconds included, and run the query again.",
	CANNOT_PARSE_DATETIME:
		"Write dates as 'YYYY-MM-DD' (toDate('2026-10-06')) and times as 'YYYY-MM-DD hh:mm:ss' (toDateTime64('2026-10-06 13:50:00', 3, 'UTC')), seconds included, and run the query again.",
};
/** Refusals no rewrite of the query can pass. */
const FATAL_TYPES = new Set([
	"ACCESS_DENIED",
	"READONLY",
	"DATABASE_ACCESS_DENIED",
	"QUOTA_EXCEEDED",
	"QUOTA_EXPIRED",
	"SET_NON_GRANTED_ROLE",
	"FUNCTION_NOT_ALLOWED",
]);

/** A ClickHouse refusal as the agent can act on it; null for anything else (a bug or an outage). */
function classify(
	error: unknown,
	sql: string,
	prepared: PreparedSql,
): SqlFailure | null {
	if (!(error instanceof Error)) return null;
	const type =
		"type" in error && typeof error.type === "string"
			? error.type
			: (/\(([A-Z][A-Z_]+)\)/u.exec(error.message)?.[1] ?? "");
	if (!type) return null;
	const message = cleanMessage(error.message);
	const limit = LIMIT_FIXES[type];
	if (limit)
		return {
			kind: "recoverable",
			message: limit,
			fragment: null,
			fix: NARROW,
			...(type === "TOO_MANY_ROWS_OR_BYTES" ? {} : { limit: "time" as const }),
		};
	// The server's or the user's memory, not this query's: others hold it.
	if (
		type === "MEMORY_LIMIT_EXCEEDED" &&
		/\((?:total|for user)\)|(?:total|user) memory limit/iu.test(error.message)
	)
		return BUSY;
	const read = READ_LIMITS[type];
	if (read)
		return {
			kind: "fatal",
			message: `${read}: this query reads too much; aggregate or narrow the window.`,
			fragment: null,
			fix: `Do not run this query again. A narrower one can pass:\n${NARROW_HOW}`,
			...(type === "MEMORY_LIMIT_EXCEEDED" ? { limit: "memory" as const } : {}),
		};
	if (FATAL_TYPES.has(type))
		return {
			kind: "fatal",
			message,
			fragment: null,
			fix: "Do not retry; the query reads or changes something outside the views you may query.",
		};
	return {
		kind: "recoverable",
		message,
		fragment: failingPart(error.message, sql, prepared),
		fix:
			QUERY_FIXES[type] ??
			(type === "UNKNOWN_IDENTIFIER" || type === "UNKNOWN_TABLE"
				? "Use only columns of the views (schema view=<view> lists them) and names your query defines."
				: "Fix the failing part and run the query again; schema view=<view> lists the columns and their types."),
	};
}

/** The failing part of the agent's SQL: a named identifier, or the text at the syntax error. */
function failingPart(
	raw: string,
	sql: string,
	prepared: PreparedSql,
): string | null {
	const named =
		/(?:identifier|function|column|table[^`']*?) [`']([^`']+)[`']/u.exec(
			raw,
		)?.[1];
	if (named)
		return SERVER_TEXT.some((marker) => named.includes(marker))
			? null
			: withoutCtePrefix(named);
	const position = /failed at position (\d+)/u.exec(raw)?.[1];
	if (position === undefined) return null;
	const origin = prepared.originOf(Number(position) - 1);
	return sql.slice(origin, origin + 60).trim() || null;
}

/**
 * The refusal without the rewritten statement, codes, versions or server
 * table names: positions and quoted text refer to the statement the server
 * ran, so the failing part is given separately, from the agent's own SQL.
 */
function cleanMessage(message: string): string {
	const text = message
		.replace(/^Code: \d+\. DB::Exception: /u, "")
		.replace(/ \(version [^)]*\)/u, "")
		.replace(/ \([A-Z][A-Z_]+\)\s*$/u, "")
		.trim();
	if (text.startsWith("Syntax error")) {
		const unmatched = /Unmatched parentheses: \S+\./u.exec(text)?.[0];
		return `Syntax error at the failing part.${unmatched ? ` ${unmatched}` : ""}`;
	}
	const cut = text
		.replace(/ in scope [\s\S]*$/u, "")
		.replace(/ Maybe you meant [\s\S]*$/u, "")
		.replace(/: \(at row \d+\)[\s\S]*$/u, "");
	const leak = SERVER_TEXT.map((marker) => cut.indexOf(marker))
		.filter((index) => index !== -1)
		.sort((left, right) => left - right)[0];
	return withoutCtePrefix(
		(leak === undefined ? cut : `${cut.slice(0, leak).trimEnd()} …`).slice(
			0,
			500,
		),
	);
}

/** Text only the server's view statement contains; a message is cut before it. */
const SERVER_TEXT = [
	"rudel.",
	"{opaline_",
	"opaline_workspace",
	"opaline_member",
	"opaline_repositories",
	"opaline_view_",
	"opaline_search",
];

function unknownName(
	name: string,
	message: string,
	fix: string,
): { ok: false; error: SqlFailure } {
	return {
		ok: false,
		error: { kind: "recoverable", message, fragment: name, fix },
	};
}

/**
 * The rows as a pipe table: a header, then a row per line, each cell cut to
 * `cellChars` and the table to as many rows as fit `tableChars`. Every cut
 * gets a notice saying cut rows are not missing data and how to aggregate or
 * page.
 */
function renderTable(
	columns: readonly string[],
	rows: readonly Record<string, unknown>[],
): { text: string; rows: number; notices: string[] } {
	if (rows.length === 0) return { text: "(no rows)", rows: 0, notices: [] };
	let cutCells = 0;
	const lines = rows.slice(0, SQL_LIMITS.rows).map((row) =>
		columns
			.map((column) => {
				const clipped = clip(tableCell(row[column]));
				if (clipped.cut) cutCells++;
				return clipped.text;
			})
			.join(" | "),
	);
	const header = columns.map((column) => tableCell(column)).join(" | ");
	const build = (count: number) =>
		[header, ...lines.slice(0, count)].join("\n");
	const fitted = fitCount(lines.length, build, SQL_LIMITS.tableChars);
	const shown = fitted.split("\n").length - 1;
	const text =
		shown < lines.length
			? `${fitted}\n${omittedMarker(lines.length - shown)}`
			: fitted;
	const notices: string[] = [];
	if (rows.length > SQL_LIMITS.rows)
		notices.push(
			`cut: the query returned more than ${SQL_LIMITS.rows} rows; only the first ${SQL_LIMITS.rows} are shown. Cut rows are not missing data: aggregate (GROUP BY with count(), sum(), avg()) or page with ORDER BY … LIMIT ${SQL_LIMITS.rows} OFFSET ${SQL_LIMITS.rows}.`,
		);
	if (shown < lines.length)
		notices.push(
			`cut rows are not missing data: select fewer or shorter columns, aggregate, or page with LIMIT ${shown} OFFSET ${shown}.`,
		);
	if (cutCells > 0)
		notices.push(
			`cut: ${cutCells} cells were longer than ${SQL_LIMITS.cellChars} characters and end in "…"; select substring(column, ${SQL_LIMITS.cellChars + 1}, ${SQL_LIMITS.cellChars}) to read on.`,
		);
	return { text, rows: shown, notices };
}

function tableCell(value: unknown): string {
	const text =
		value !== null && typeof value === "object" ? JSON.stringify(value) : value;
	return cell(text).replaceAll("|", "\\|");
}

function clip(text: string): { text: string; cut: boolean } {
	return text.length > SQL_LIMITS.cellChars
		? { text: `${text.slice(0, SQL_LIMITS.cellChars - 1)}…`, cut: true }
		: { text, cut: false };
}

/** Sessions a result names in a `session_id` column, with their generations now. */
async function namedSessions(
	caller: SqlCaller,
	columns: readonly string[],
	rows: readonly Record<string, unknown>[],
	executor: ClickHouseExecutor,
): Promise<AnalysisSqlOutput["sessions"]> {
	if (!columns.includes("session_id")) return [];
	const ids = [
		...new Set(
			rows
				.slice(0, SQL_LIMITS.rows)
				.map((row) => row.session_id)
				.filter((id): id is string => typeof id === "string" && id !== ""),
		),
	];
	const sessions = await describeSessions(executor, caller.workspaceId, ids);
	return sessions
		.filter((session) => mayReadSession(caller.reader, session.ownerId))
		.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

/**
 * Runs the given (shown) rows name, once each in row order: only with session_id,
 * agent_id and turn_idx columns, since a turn number alone names a run in
 * the main stream and in each subagent, and only in sessions the caller may
 * read (`sessions`), so a literal in the SQL cannot cite another member's run.
 */
function namedRuns(
	columns: readonly string[],
	rows: readonly Record<string, unknown>[],
	sessions: AnalysisSqlOutput["sessions"],
): AnalysisSqlOutput["runs"] {
	if (
		!["session_id", "agent_id", "turn_idx"].every((column) =>
			columns.includes(column),
		)
	)
		return [];
	const readable = new Set(sessions.map((session) => session.sessionId));
	const runs = new Map<string, AnalysisSqlOutput["runs"][number]>();
	for (const row of rows) {
		const parsed = RunRefSchema.safeParse({
			sessionId: row.session_id,
			agentId: row.agent_id,
			turn: Number(row.turn_idx),
		});
		if (!parsed.success || !readable.has(parsed.data.sessionId)) continue;
		runs.set(JSON.stringify(parsed.data), parsed.data);
	}
	return [...runs.values()];
}

/**
 * Members whose sessions the query could read: every member with indexed
 * sessions, or the caller alone where the workspace keeps members to their
 * own sessions. Deleting any of them deletes the result.
 */
async function coveredOwners(
	caller: SqlCaller,
	executor: ClickHouseExecutor,
): Promise<string[]> {
	const only = readableSessionOwner(caller.reader);
	if (only !== null) return [only];
	const rows = await query(executor, z.object({ user_id: z.string() }), {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT DISTINCT user_id FROM ${getSafeClickHouseTable(RUN_INDEX_TABLE)}
			WHERE organization_id = {organizationId:String} AND row_kind = 'receipt'
			ORDER BY user_id`,
		query_params: { organizationId: caller.workspaceId },
	});
	return rows.map((row) => row.user_id);
}
