import type { RunIndexColumn } from "./run-index.js";

export const MCP_TOOL_CALLS_TABLE = "rudel.mcp_tool_calls";
export const MCP_TOOL_CALLS_MIGRATION = "20261104120000_mcp_tool_calls.sql";
export const MCP_TOOL_CALLS_ORDER_BY = ["tool", "called_at", "call_id"];
export const MCP_TOOL_CALLS_PARTITION_BY = "toYYYYMM(called_at)";
export const MCP_TOOL_CALLS_RETENTION_DAYS = 365;
export const MCP_TOOL_CALLS_TTL = `toDateTime(called_at) + toIntervalDay(${MCP_TOOL_CALLS_RETENTION_DAYS})`;
export const MCP_TOOL_CALLS_COMMENT =
	"One row per call of a model-facing Opaline MCP tool: the tool, the purpose and model the agent stated, how long it took, whether it failed and how much it returned; agent_feedback calls also keep the feedback. Kept 365 days.";

export const MCP_TOOL_CALL_COLUMNS: readonly RunIndexColumn[] = [
	{
		name: "organization_id",
		type: "String",
		comment:
			"Workspace (organization id) the call ran in; empty when the workspace could not be resolved.",
	},
	{ name: "user_id", type: "String", comment: "Member who made the call." },
	{
		name: "called_at",
		type: "DateTime64(3, 'UTC')",
		comment: "UTC time the server received the call.",
	},
	{
		name: "call_id",
		type: "String",
		comment: "Random id of the call, so identical calls stay distinct rows.",
	},
	{ name: "tool", type: "LowCardinality(String)", comment: "Tool name." },
	{
		name: "context",
		type: "String",
		comment:
			"Why the agent called the tool, in its own words (the context input, 15-25 words, no personal data); empty when not given.",
	},
	{
		name: "llm_model",
		type: "LowCardinality(String)",
		comment:
			"Model id the agent reported (the llm_model input; unknown when it did not know); empty when not given.",
	},
	{
		name: "duration_ms",
		type: "UInt32",
		comment: "Milliseconds from receiving the call to its result.",
	},
	{
		name: "is_error",
		type: "UInt8",
		comment: "1 when the call returned an error, else 0.",
	},
	{
		name: "error_code",
		type: "LowCardinality(String)",
		comment:
			"The error's code (BAD_REQUEST, NOT_FOUND, FORBIDDEN, INTERNAL_SERVER_ERROR, ...); empty on success.",
	},
	{
		name: "output_chars",
		type: "UInt32",
		comment: "Characters of text the call returned to the agent.",
	},
	{
		name: "feedback",
		type: "String",
		comment:
			"agent_feedback calls only: the feedback as JSON (summary, feedback_type, sentiment, category, ...); empty otherwise.",
	},
];
