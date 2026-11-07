import { ORPCError } from "@orpc/server";
import { CLI_DATA_LIMITS } from "@rudel/api-routes/cli-data";
import type { ClickHouseStatement } from "../../clickhouse.js";
import type {
	ClickHouseLineFormat,
	OpenClickHouseLines,
} from "../../clickhouse-lines.js";
import { AGENT_QUERY_BUSY } from "../analysis/agent-query-slots.js";
import {
	type AgentSqlEnv,
	describeSqlFailure,
	prepareAgentStatement,
	type SqlCaller,
	type SqlFailure,
	withAgentQuery,
} from "../analysis/sql-gateway.js";
import type { SqlQuota } from "../analysis/sql-results.js";
import { NARROW_EXPORT, tooLarge } from "./lines.js";

export interface CliDataEnv extends AgentSqlEnv {
	readonly lines: OpenClickHouseLines;
	readonly githubBindings: (
		workspaceId: string,
	) => Promise<readonly { repositoryId: string; fullName: string }[]>;
}

export interface CliDataContext {
	readonly caller: SqlCaller;
	readonly env: CliDataEnv;
	readonly signal?: AbortSignal;
	readonly quotaRefusedAt: () => Date | null;
}

export const EXPORT_LIMITS = {
	max_execution_time: CLI_DATA_LIMITS.statementSeconds,
	timeout_overflow_mode: "throw",
	max_memory_usage: String(CLI_DATA_LIMITS.statementMemoryBytes),
	max_rows_to_read: "50000000",
	max_bytes_to_read: String(4 * 1024 * 1024 * 1024),
	read_overflow_mode: "throw",
	max_threads: 2,
	max_result_bytes: String(CLI_DATA_LIMITS.exportBytes),
	result_overflow_mode: "throw",
	remote_filesystem_read_prefetch: 0,
	timeout_before_checking_execution_speed: 0,
	output_format_json_escape_forward_slashes: 0,
} as const;

const UNCAPPED = new Set(["limit", "max_result_bytes", "result_overflow_mode"]);

export const FREE_QUOTA: SqlQuota = {
	queries: Number.MAX_SAFE_INTEGER,
	windowMs: 3_600_000,
	take: async () => ({ allowed: true }),
};

export function watchedQuota(quota: SqlQuota): {
	quota: SqlQuota;
	refusedAt: () => Date | null;
} {
	let refused: Date | null = null;
	return {
		quota: {
			queries: quota.queries,
			windowMs: quota.windowMs,
			take: async (workspaceId) => {
				const taken = await quota.take(workspaceId);
				if (!taken.allowed) refused = taken.resetsAt;
				return taken;
			},
		},
		refusedAt: () => refused,
	};
}

export class ExportRefused extends Error {
	constructor(readonly failure: SqlFailure) {
		super(failure.message);
		this.name = "ExportRefused";
	}
}

function errorType(error: unknown): string {
	if (!(error instanceof Error)) return "";
	if ("type" in error && typeof error.type === "string") return error.type;
	return /\(([A-Z][A-Z_]+)\)/u.exec(error.message)?.[1] ?? "";
}

function exportFailure(
	error: unknown,
	failure: SqlFailure | null,
): SqlFailure | null {
	if (errorType(error) === "TOO_MANY_ROWS_OR_BYTES")
		throw tooLarge(CLI_DATA_LIMITS.exportBytes, NARROW_EXPORT);
	if (failure?.limit === "time")
		return {
			...failure,
			message: `The query ran past ${CLI_DATA_LIMITS.statementSeconds} seconds.`,
		};
	return failure;
}

export function exportStatement(
	statement: ClickHouseStatement,
	signal: AbortSignal | undefined,
): ClickHouseStatement {
	const settings = Object.fromEntries(
		Object.entries(statement.clickhouse_settings ?? {}).filter(
			([name]) => !UNCAPPED.has(name),
		),
	);
	return {
		...statement,
		...(signal ? { abortSignal: signal } : {}),
		clickhouse_settings: { ...settings, ...EXPORT_LIMITS, readonly: "1" },
	};
}

export async function agentLines(
	context: CliDataContext,
	sql: string,
	format: ClickHouseLineFormat,
	cohort?: string,
): Promise<{ batches: AsyncIterable<readonly string[]>; notices: string[] }> {
	const { caller, env, signal } = context;
	const prepared = await prepareAgentStatement(
		caller,
		sql,
		env,
		undefined,
		cohort,
	);
	if (!prepared.ok) throw new ExportRefused(prepared.error);
	const statement = exportStatement(prepared.value.statement, signal);
	const opened = await withAgentQuery(
		caller.workspaceId,
		env,
		async () => {
			try {
				return {
					ok: true as const,
					batches: await env.lines(statement, format),
				};
			} catch (error) {
				const failure = exportFailure(error, prepared.value.classify(error));
				if (!failure) throw error;
				return { ok: false as const, error: failure };
			}
		},
		signal,
	);
	if (!opened.ok) throw new ExportRefused(opened.error);
	return { batches: opened.batches, notices: prepared.value.notices };
}

export async function trustedLines(
	context: CliDataContext,
	statement: ClickHouseStatement,
): Promise<AsyncIterable<readonly string[]>> {
	const { caller, env, signal } = context;
	const opened = await withAgentQuery(
		caller.workspaceId,
		env,
		async () => {
			try {
				return {
					ok: true as const,
					batches: await env.lines(
						exportStatement(statement, signal),
						"JSONEachRow",
					),
				};
			} catch (error) {
				const failure = exportFailure(error, null);
				if (!failure) throw error;
				return { ok: false as const, error: failure };
			}
		},
		signal,
	);
	if (!opened.ok) throw new ExportRefused(opened.error);
	return opened.batches;
}

export type Row = Record<string, unknown>;

export async function agentRows(
	context: CliDataContext,
	sql: string,
	cohort?: string,
): Promise<Row[]> {
	const rows: Row[] = [];
	const { batches } = await agentLines(context, sql, "JSONEachRow", cohort);
	for await (const batch of batches)
		for (const line of batch) rows.push(JSON.parse(line) as Row);
	return rows;
}

export async function trustedRows(
	context: CliDataContext,
	statement: ClickHouseStatement,
): Promise<Row[]> {
	const rows: Row[] = [];
	for await (const batch of await trustedLines(context, statement))
		for (const line of batch) rows.push(JSON.parse(line) as Row);
	return rows;
}

const isLimit = (error: unknown) =>
	error instanceof ExportRefused && error.failure.limit !== undefined;

export async function* agentBatches(
	context: CliDataContext,
	keys: readonly string[],
	size: number,
	sqlFor: (batch: readonly string[]) => string,
): AsyncGenerator<string> {
	const queue: string[][] = [];
	for (let index = 0; index < keys.length; index += size)
		queue.push(keys.slice(index, index + size));
	while (queue.length > 0) {
		const batch = queue.shift() as string[];
		let opened: Awaited<ReturnType<typeof agentLines>>;
		try {
			opened = await agentLines(context, sqlFor(batch), "JSONEachRow");
		} catch (error) {
			if (batch.length > 1 && isLimit(error)) {
				const half = Math.ceil(batch.length / 2);
				queue.unshift(batch.slice(0, half), batch.slice(half));
				continue;
			}
			throw error;
		}
		for await (const lines of opened.batches) yield* lines;
	}
}

export function cliDataError(
	failure: SqlFailure,
	quotaRefusedAt: Date | null,
): ORPCError<string, unknown> {
	if (quotaRefusedAt)
		return new ORPCError("QUOTA_EXCEEDED", {
			status: 429,
			message: `${failure.message} Do not retry before ${quotaRefusedAt.toISOString()}.`,
			data: { resetsAt: quotaRefusedAt.toISOString() },
		});
	if (failure.message === AGENT_QUERY_BUSY)
		return new ORPCError("BUSY", {
			status: 503,
			message: `${AGENT_QUERY_BUSY} Run the same command again in a few seconds.`,
		});
	return new ORPCError(failure.kind === "fatal" ? "FORBIDDEN" : "BAD_REQUEST", {
		message: describeSqlFailure(failure),
		data: { kind: failure.kind, fragment: failure.fragment, fix: failure.fix },
	});
}

export function asCliDataError(
	error: unknown,
	context: Pick<CliDataContext, "quotaRefusedAt">,
): unknown {
	return error instanceof ExportRefused
		? cliDataError(error.failure, context.quotaRefusedAt())
		: error;
}
