import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import type { ClickHouseLineFormat } from "../../clickhouse-lines.js";
import {
	AgentQueryBusyError,
	type AgentQueryLimiter,
} from "../analysis/agent-query-slots.js";
import { withCallQuota } from "../analysis/sql-gateway.js";
import { createMemorySqlQuota } from "../analysis/sql-results.js";
import type { SessionReader } from "../session-visibility.js";
import {
	type CliDataContext,
	type CliDataEnv,
	watchedQuota,
} from "./statements.js";

export interface Sent {
	readonly statement: ClickHouseStatement;
	readonly format: ClickHouseLineFormat;
}

export type Answer = (sent: Sent) => readonly string[] | Error;

export function fakeClickHouse(
	answer: Answer,
	options: { busy?: boolean; queries?: number } = {},
) {
	const sent: Sent[] = [];
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {},
		insert: async () => {},
		query: async <T>() => [] as T[],
	};
	const limiter: AgentQueryLimiter = {
		async withAgentQuerySlot(_workspaceId, work) {
			if (options.busy) throw new AgentQueryBusyError();
			return work();
		},
	};
	const quota = createMemorySqlQuota({
		queries: options.queries ?? 100,
		windowMs: 3_600_000,
	});
	const env: CliDataEnv = {
		executor,
		lines: async (statement, format) => {
			sent.push({ statement, format });
			const lines = answer({ statement, format });
			if (lines instanceof Error) throw lines;
			return (async function* () {
				if (lines.length > 0) yield lines;
			})();
		},
		quota,
		limiter,
		githubRepositories: async () => [],
		githubBindings: async () => [{ repositoryId: "101", fullName: "acme/app" }],
		functions: [],
	};
	return { env, sent, quota };
}

export const teammate: SessionReader = {
	userId: "user-1",
	role: "member",
	ownSessionsOnly: false,
};

export function contextOf(
	env: CliDataEnv,
	options: { reader?: SessionReader; charged?: boolean } = {},
): CliDataContext {
	const watched = watchedQuota(
		options.charged === false
			? {
					queries: Number.MAX_SAFE_INTEGER,
					windowMs: 1,
					take: async () => ({ allowed: true }),
				}
			: env.quota,
	);
	return {
		caller: { workspaceId: "ws-1", reader: options.reader ?? teammate },
		env: withCallQuota({ ...env, quota: watched.quota }),
		quotaRefusedAt: watched.refusedAt,
	};
}

export function clickHouseError(type: string, message: string): Error {
	return Object.assign(new Error(`${message} (${type})`), { type });
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const value of iterable) out.push(value);
	return out;
}

export async function failure(
	work: () => Promise<unknown>,
): Promise<{ code: string; message: string; data: unknown; status: number }> {
	try {
		await work();
	} catch (error) {
		return error as {
			code: string;
			message: string;
			data: unknown;
			status: number;
		};
	}
	throw new Error("expected a failure");
}

export const summaryRow = (
	sessionId: string,
	userId = "user-1",
	firstStart = "2026-11-01 10:00:00.000",
) =>
	JSON.stringify({
		session_id: sessionId,
		owner_id: userId,
		session_source: "claude_code",
		first_start: firstStart,
		session_repository: "github.com/acme/app",
	});

export const isSummary = (sent: Sent) =>
	sent.statement.query.includes("first_start");
