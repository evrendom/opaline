import type {
	AnalysisSchemaInput,
	AnalysisSchemaOutput,
	AnalysisSqlOutput,
} from "@rudel/api-routes";
import { redactReturnedValue } from "@rudel/secret-filter";
import { z } from "zod";
import {
	ALLOWED_CLICKHOUSE_TABLES,
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
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
import { fitCount } from "./output-ceiling.js";
import { cell } from "./read-output.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./sql.js";
import {
	checkParsedSql,
	type PreparedSql,
	prepareAgentSql,
	type SqlFailure,
	withoutCtePrefix,
} from "./sql-guard.js";
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
}

export type SqlOutcome =
	| {
			readonly ok: true;
			readonly result: AnalysisSqlOutput;
			/** Members whose sessions the query could read, stored with it. */
			readonly owners: readonly string[];
	  }
	| { readonly ok: false; readonly error: SqlFailure };

export type SchemaOutcome =
	| { readonly ok: true; readonly result: AnalysisSchemaOutput }
	| { readonly ok: false; readonly error: SqlFailure };

/** Per-query limits: ClickHouse is small (6 cores, 5.4 GiB) and shared. */
export const SQL_LIMITS = {
	seconds: 10,
	memoryBytes: 512 * 1024 * 1024,
	rowsRead: 50_000_000,
	bytesRead: 4 * 1024 * 1024 * 1024,
	/** Rows shown; one more is read to know that there were more. */
	rows: 200,
	cellChars: 300,
	tableChars: 24_000,
	resultBytes: 16 * 1024 * 1024,
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

const SQL_SETTINGS: NonNullable<ClickHouseStatement["clickhouse_settings"]> = {
	readonly: "1",
	max_execution_time: SQL_LIMITS.seconds,
	timeout_overflow_mode: "throw",
	max_memory_usage: String(SQL_LIMITS.memoryBytes),
	max_rows_to_read: String(SQL_LIMITS.rowsRead),
	max_bytes_to_read: String(SQL_LIMITS.bytesRead),
	read_overflow_mode: "throw",
	// Caps the rows of the result as LIMIT would; the order is kept.
	limit: String(SQL_LIMITS.rows + 1),
	// Bigger results fail with a notice to narrow, never arrive cut silently.
	max_result_bytes: String(SQL_LIMITS.resultBytes),
	result_overflow_mode: "throw",
	max_threads: 2,
	remote_filesystem_read_prefetch: 0,
	timeout_before_checking_execution_speed: 0,
};

export const NOT_EVIDENCE =
	"not evidence: these rows say where to look, not why. Open the runs with read (session_id, agent_id, and turn_idx as its turn) before naming a cause.";

export async function runSql(
	caller: SqlCaller,
	input: { query: string; title: string },
	env: SqlEnv,
	signal?: AbortSignal,
): Promise<SqlOutcome> {
	// The lookups for the result read ClickHouse too, so they hold the slot.
	const executed = await execute(caller, input.query, env, signal, (found) => {
		const rows = found.map(
			(row) => redactReturnedValue(row) as Record<string, unknown>,
		);
		const columns = Object.keys(rows[0] ?? {});
		return Promise.all([
			namedSessions(caller, columns, rows, env.executor),
			coveredOwners(caller, env.executor),
		]).then(([sessions, owners]) => ({ rows, columns, sessions, owners }));
	});
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
		notices: [...table.notices, NOT_EVIDENCE],
		sessions,
	};
	const id = await env.results.save({
		workspaceId: caller.workspaceId,
		authorId: caller.reader.userId,
		title: input.title,
		query: input.query,
		output,
		owners,
	});
	return { ok: true, result: { id, ...output }, owners };
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
				notes: [
					"Pass view to see its columns with their meaning and traps, then column to see its most common values.",
					"Every view holds only the sessions you may read; the server adds the workspace.",
				],
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
		`SELECT toString(${value}) AS value, count() AS runs FROM ${view.name}
			WHERE started_at >= now() - INTERVAL ${TOP_VALUES_DAYS} DAY
			GROUP BY value ORDER BY runs DESC, value LIMIT ${TOP_VALUES}`,
		env,
		signal,
		async (rows) => rows,
	);
	if (!executed.ok) return executed;
	const values = z
		.array(z.object({ value: z.string().nullable(), runs: z.coerce.number() }))
		.parse(executed.value)
		.map((row) => ({
			value: clip(cell(redactReturnedValue(row.value))).text,
			runs: row.runs,
		}));
	return {
		ok: true,
		result: {
			level: "values",
			view: view.name,
			column: { ...column, traps: [...column.traps] },
			over: `runs that started in the last ${TOP_VALUES_DAYS} days`,
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

/**
 * Runs the agent's SQL and then `follow` on its rows, both in a query slot
 * of the workspace, or says why it is refused.
 */
async function execute<T>(
	caller: SqlCaller,
	sql: string,
	env: SqlEnv,
	signal: AbortSignal | undefined,
	follow: (rows: Record<string, unknown>[]) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: SqlFailure }> {
	const prepared = prepareAgentSql(
		sql,
		new Map(
			SQL_VIEWS.map((view) => [
				view.name,
				view.sql(readableSessionOwner(caller.reader) !== null),
			]),
		),
		RESERVED_NAMES,
	);
	if (!prepared.ok) return { ok: false, error: prepared.failure };
	const parsed = await checkWithClickHouseParser(sql, prepared.prepared, env);
	if (parsed) return { ok: false, error: parsed };
	const statement: ClickHouseStatement = {
		clickhouse_settings: SQL_SETTINGS,
		query: prepared.prepared.sql,
		query_params: {
			[SQL_SCOPE_PARAMS.workspace]: caller.workspaceId,
			...memberParam(caller),
		},
	};
	try {
		// The quota is taken inside the slot, so a busy refusal costs none.
		return await env.limiter.withAgentQuerySlot(
			caller.workspaceId,
			async (): Promise<
				{ ok: true; value: T } | { ok: false; error: SqlFailure }
			> => {
				const quota = await env.quota.take(caller.workspaceId);
				if (!quota.allowed)
					return {
						ok: false,
						error: {
							kind: "fatal",
							message: `The workspace used its SQL quota of ${env.quota.queries} queries per ${env.quota.windowMs / 60_000} minutes.`,
							fragment: null,
							fix: `Do not retry before ${quota.resetsAt.toISOString()}; answer with what you have, or with find and read.`,
						},
					};
				let rows: Record<string, unknown>[];
				try {
					rows = await env.executor.query<Record<string, unknown>>(statement);
				} catch (error) {
					const failure = classify(error, sql, prepared.prepared);
					if (!failure) throw error;
					return { ok: false, error: failure };
				}
				return { ok: true, value: await follow(rows) };
			},
			signal,
		);
	} catch (error) {
		if (!(error instanceof AgentQueryBusyError)) throw error;
		return { ok: false, error: BUSY };
	}
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
	env: SqlEnv,
): Promise<SqlFailure | null> {
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
		return failure;
	}
	return checkParsedSql(lines, {
		views: new Set(SQL_VIEWS.map((view) => view.name)),
		ctes: prepared.ctes,
	});
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
const NARROW_HOW =
	"a shorter started_at range, fewer members or sessions, fewer or narrower columns (leave out prompt_head and arrays), or aggregate with GROUP BY before ordering.";
const NARROW = `Narrow it: ${NARROW_HOW}`;
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
		return { kind: "recoverable", message: limit, fragment: null, fix: NARROW };
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
			fix: `Do not run this query again. A narrower one can pass: ${NARROW_HOW}`,
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
			type === "UNKNOWN_IDENTIFIER" || type === "UNKNOWN_TABLE"
				? "Use only columns of the view (schema view=runs lists them) and names your query defines."
				: "Fix the failing part and run the query again; schema view=runs lists the columns and their types.",
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
	const text = fitCount(lines.length, build, SQL_LIMITS.tableChars);
	const shown = text.split("\n").length - 1;
	const notices: string[] = [];
	if (rows.length > SQL_LIMITS.rows)
		notices.push(
			`cut: the query returned more than ${SQL_LIMITS.rows} rows; only the first ${SQL_LIMITS.rows} are shown. Cut rows are not missing data: aggregate (GROUP BY with count(), sum(), avg()) or page with ORDER BY … LIMIT ${SQL_LIMITS.rows} OFFSET ${SQL_LIMITS.rows}.`,
		);
	if (shown < lines.length)
		notices.push(
			`cut: only the first ${shown} of ${lines.length} rows fit ${SQL_LIMITS.tableChars} characters. Cut rows are not missing data: select fewer or shorter columns, aggregate, or page with LIMIT ${shown} OFFSET ${shown}.`,
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
