import { type AnalysisPeekOutput, PEEK_HEAD_ROWS } from "@rudel/api-routes";
import { redactReturnedValue } from "@rudel/secret-filter";
import {
	type AgentSqlEnv,
	execute,
	type SqlCaller,
	type SqlFailure,
} from "./sql-gateway.js";

const ROWS = "opaline_peek_rows";
const CHARS = "opaline_peek_chars";

export function peekWrapper() {
	return {
		prefix: `SELECT count() OVER () AS ${ROWS}, sum(length(formatRow('JSONEachRow', *))) OVER () AS ${CHARS}, * FROM (\n`,
		suffix: `\n) LIMIT ${PEEK_HEAD_ROWS}`,
		rows: PEEK_HEAD_ROWS,
	};
}

export async function peekSql(
	caller: SqlCaller,
	input: { query: string; cohort?: string },
	env: AgentSqlEnv,
	signal?: AbortSignal,
): Promise<
	{ ok: true; result: AnalysisPeekOutput } | { ok: false; error: SqlFailure }
> {
	const started = performance.now();
	const executed = await execute(
		caller,
		input.query,
		env,
		signal,
		async (rows) => rows,
		peekWrapper(),
		input.cohort,
	);
	if (!executed.ok) return executed;
	const first = executed.value[0] ?? {};
	const head = executed.value.map((row) => {
		const { [ROWS]: _rows, [CHARS]: _chars, ...rest } = row;
		return redactReturnedValue(rest) as Record<string, unknown>;
	});
	return {
		ok: true,
		result: {
			rows: Number(first[ROWS] ?? 0),
			chars: Number(first[CHARS] ?? 0),
			columns: Object.keys(head[0] ?? {}),
			head,
			ms: Math.round(performance.now() - started),
		},
	};
}

export async function sliceSql(
	caller: SqlCaller,
	input: { query: string; cohort?: string },
	env: AgentSqlEnv,
	maxRows: number,
	signal?: AbortSignal,
): Promise<
	| { ok: true; result: { rows: Record<string, unknown>[]; more: boolean } }
	| { ok: false; error: SqlFailure }
> {
	const executed = await execute(
		caller,
		input.query,
		env,
		signal,
		async (rows) => rows,
		{
			prefix: "SELECT * FROM (\n",
			suffix: `\n) LIMIT ${maxRows + 1}`,
			rows: maxRows + 1,
		},
		input.cohort,
	);
	if (!executed.ok) return executed;
	return {
		ok: true,
		result: {
			rows: executed.value
				.slice(0, maxRows)
				.map((row) => redactReturnedValue(row) as Record<string, unknown>),
			more: executed.value.length > maxRows,
		},
	};
}
