import { schema, table } from "@chkit/core";
import {
	MCP_TOOL_CALL_COLUMNS,
	MCP_TOOL_CALLS_COMMENT,
	MCP_TOOL_CALLS_ORDER_BY,
	MCP_TOOL_CALLS_PARTITION_BY,
	MCP_TOOL_CALLS_TTL,
} from "../../mcp-tool-calls.js";

export const mcpToolCallsTable = table({
	database: "rudel",
	name: "mcp_tool_calls",
	engine: "SharedMergeTree",
	columns: [...MCP_TOOL_CALL_COLUMNS],
	primaryKey: [...MCP_TOOL_CALLS_ORDER_BY],
	orderBy: [...MCP_TOOL_CALLS_ORDER_BY],
	partitionBy: MCP_TOOL_CALLS_PARTITION_BY,
	ttl: MCP_TOOL_CALLS_TTL,
	settings: {
		index_granularity: "8192",
		ttl_only_drop_parts: "1",
		storage_policy: "'s3'",
	},
	comment: MCP_TOOL_CALLS_COMMENT,
});

export default schema(mcpToolCallsTable);
