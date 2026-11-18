import { getLogger } from "@logtape/logtape";
import type { RudelMcpToolCallsRow } from "@rudel/ch-schema/generated";
import { MCP_TOOL_CALLS_TABLE } from "@rudel/ch-schema/mcp-tool-calls";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";

const logger = getLogger(["opaline", "api", "mcp", "analytics"]);
const UINT32_MAX = 4_294_967_295;
const FEEDBACK_MAX_CHARS = 20_000;
const RECORD_TIMEOUT_MS = 1_500;

export interface ToolCallFacts {
	readonly tool: string;
	readonly userId: string;
	readonly workspaceId: string;
	readonly calledAt: Date;
	readonly context: string;
	readonly llmModel: string;
	readonly durationMs: number;
	readonly errorCode: string | null;
	readonly outputChars: number;
	readonly feedback?: unknown;
}

const count = (value: number) =>
	Math.min(UINT32_MAX, Math.max(0, Math.round(value)));

export function toolCallRow(facts: ToolCallFacts): RudelMcpToolCallsRow {
	return {
		organization_id: facts.workspaceId,
		user_id: facts.userId,
		called_at: facts.calledAt.toISOString().replace("T", " ").slice(0, 23),
		call_id: crypto.randomUUID(),
		tool: facts.tool,
		context: facts.context,
		llm_model: facts.llmModel,
		duration_ms: count(facts.durationMs),
		is_error: facts.errorCode === null ? 0 : 1,
		error_code: facts.errorCode ?? "",
		output_chars: count(facts.outputChars),
		feedback:
			facts.errorCode === null && facts.feedback !== undefined
				? JSON.stringify(facts.feedback).slice(0, FEEDBACK_MAX_CHARS)
				: "",
	};
}

export async function recordToolCall(
	executor: Pick<ClickHouseExecutor, "insert">,
	row: RudelMcpToolCallsRow,
	timeoutMs = RECORD_TIMEOUT_MS,
): Promise<void> {
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), timeoutMs);
	try {
		await executor.insert({
			table: MCP_TOOL_CALLS_TABLE,
			values: [row],
			asyncInsert: true,
			abortSignal: abort.signal,
		});
	} catch (error) {
		logger.warn("MCP call analytics for {tool} not recorded: {error}", {
			tool: row.tool,
			error,
		});
	} finally {
		clearTimeout(timer);
	}
}

export const MCP_STATS_ACTIONS = [
	"stats",
	"failures",
	"sample_intents",
	"feedback",
] as const;
export type McpStatsAction = (typeof MCP_STATS_ACTIONS)[number];

export interface McpStatsQuery {
	readonly action: McpStatsAction;
	readonly from: string;
	readonly to: string;
	readonly tool?: string;
	readonly limit: number;
}

const WINDOW = `called_at >= toDateTime64({from:String}, 3, 'UTC')
			AND called_at < toDateTime64({to:String}, 3, 'UTC') + INTERVAL 1 DAY`;

export function mcpStatsStatement(query: McpStatsQuery): ClickHouseStatement {
	const tool = query.tool ? "AND tool = {tool:String}" : "";
	const where = `${WINDOW}\n\t\t\t${tool}`;
	const sql: Record<McpStatsAction, string> = {
		stats: `SELECT tool, count() AS calls, countIf(is_error = 1) AS errors,
			quantiles(0.5, 0.95)(duration_ms) AS latency,
			round(latency[1]) AS p50_ms, round(latency[2]) AS p95_ms,
			uniq(user_id) AS users, uniq(organization_id) AS workspaces,
			countIf(context != '') AS with_intent
		FROM ${MCP_TOOL_CALLS_TABLE}
		WHERE ${where}
		GROUP BY tool
		ORDER BY calls DESC, tool
		LIMIT {limit:UInt32}`,
		failures: `SELECT tool, error_code, llm_model, count() AS calls,
			uniq(user_id) AS users, max(called_at) AS last_seen
		FROM ${MCP_TOOL_CALLS_TABLE}
		WHERE ${where} AND is_error = 1
		GROUP BY tool, error_code, llm_model
		ORDER BY calls DESC, tool, error_code, llm_model
		LIMIT {limit:UInt32}`,
		sample_intents: `SELECT called_at, tool, llm_model, is_error, context
		FROM ${MCP_TOOL_CALLS_TABLE}
		WHERE ${where} AND context != ''
		ORDER BY called_at DESC
		LIMIT {limit:UInt32}`,
		feedback: `SELECT called_at, llm_model, feedback
		FROM ${MCP_TOOL_CALLS_TABLE}
		WHERE ${WINDOW} AND tool = 'agent_feedback' AND feedback != ''
		ORDER BY called_at DESC
		LIMIT {limit:UInt32}`,
	};
	return {
		query: sql[query.action],
		query_params: {
			from: query.from,
			to: query.to,
			limit: query.limit,
			...(query.tool ? { tool: query.tool } : {}),
		},
		clickhouse_settings: { max_execution_time: 10 },
	};
}

export const MCP_STATS_COLUMNS: Record<McpStatsAction, readonly string[]> = {
	stats: [
		"tool",
		"calls",
		"errors",
		"p50_ms",
		"p95_ms",
		"users",
		"workspaces",
		"with_intent",
	],
	failures: ["tool", "error_code", "llm_model", "calls", "users", "last_seen"],
	sample_intents: ["called_at", "tool", "llm_model", "is_error", "context"],
	feedback: ["called_at", "llm_model", "feedback"],
};
