import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { ClickHouseExecutor } from "../clickhouse.js";
import { isSelfHosted } from "../lib/self-hosted.js";
import { table } from "../services/analysis/find-text.js";
import {
	MCP_STATS_ACTIONS,
	MCP_STATS_COLUMNS,
	mcpStatsStatement,
} from "../services/mcp-analytics/tool-calls.js";
import { parseMcpInput } from "./input-validation.js";
import type { McpTool } from "./mcp-tools.js";
import { READ_ONLY, WRITES_OWN_RECORDS } from "./tool-annotations.js";

export function isAdminWorkspace(workspaceId: string): boolean {
	const team = process.env.VITE_ADMIN_ORGANIZATION_ID?.trim();
	return Boolean(team) && workspaceId === team;
}

const FEEDBACK_RESPONSE =
	"Thank you for the feedback — it has been recorded and will be reviewed by the Opaline team. Submitting feedback does not mean your work is done: keep going and finish the user's task using the other available tools.";

const text = (max: number) => z.string().trim().min(1).max(max);

export const AgentFeedbackInputSchema = z
	.object({
		summary: text(500).describe(
			'A one-sentence headline capturing the feedback (e.g. "find source=calls hid the failing command behind its fingerprint", "run\'s phase view made it hard to see which call failed", or "sql over runs answered the question in one call").',
		),
		feedback_type: z
			.enum(["opaline", "mcp", "docs", "other"])
			.describe(
				'What this feedback is about. "opaline" = any Opaline product or feature (the dashboard, sessions, the session reader, skills, repositories, saved answers). "mcp" = this MCP server itself — a tool, its input schema, response format, an error, or these instructions. "docs" = Opaline documentation. "other" = anything that doesn\'t fit the above.',
			),
		sentiment: z
			.enum(["positive", "neutral", "negative", "mixed"])
			.describe(
				'The overall tone. Use "negative" for something broken or blocking, "mixed" for mostly-fine-but-with-a-concrete-problem, "neutral" for a suggestion or feature request with no strong sentiment, and "positive" for praise or something that worked well. All sentiments are welcome — positive feedback is encouraged, not just problems.',
			),
		product_area: text(200)
			.optional()
			.describe(
				'The Opaline product or area this is about, in free text (e.g. "session reader", "dashboard", "skills", "docs"). Most useful for Opaline feedback; for MCP feedback the tool name belongs in details or friction_points instead.',
			),
		category: z
			.enum([
				"tool_correctness",
				"tool_description",
				"tool_input_schema",
				"tool_output_format",
				"missing_tool",
				"instructions_clarity",
				"performance",
				"error_message",
				"other",
			])
			.optional()
			.describe(
				'For MCP feedback (feedback_type "mcp") only: the single category that best describes the dominant theme. Pick "missing_tool" if a capability was absent, "tool_description" if the tool docs were unclear, "tool_input_schema" if input args were confusing, "tool_output_format" if the response was hard to consume, "instructions_clarity" if these MCP instructions were unclear, "tool_correctness" if a tool returned wrong data, "error_message" if an error was unhelpful, "performance" if latency was the issue. Omit for Opaline, docs, or other feedback.',
			),
		task_completed: z
			.boolean()
			.optional()
			.describe(
				'Were you able to complete the user\'s task? Be honest — "false" is just as useful as "true". Most relevant when feedback_type is "mcp".',
			),
		tools_used: z
			.array(text(100))
			.max(50)
			.optional()
			.describe(
				'The MCP tool names you called while working on the user\'s task (e.g. ["find", "run"]). Helps us correlate feedback to specific tools.',
			),
		friction_points: text(4_000)
			.optional()
			.describe(
				"Clear, concise bullet points describing the friction — what was confusing, broken, slow, or missing. Quote the exact product surface, tool name, parameter, or error text where you can. Omit for purely positive feedback.",
			),
		suggested_improvement: text(4_000)
			.optional()
			.describe(
				"The single most impactful, concrete change that would address this feedback, if you can name one (e.g. \"add a filters example to find's description\"). Optional — praise or an observation doesn't need one.",
			),
		user_request: text(1_000)
			.optional()
			.describe(
				"A short, anonymised paraphrase of what the user originally asked you to do. Do not include PII, customer names, or sensitive query content.",
			),
		details: text(4_000)
			.optional()
			.describe(
				"Any additional context that doesn't fit the other fields. Keep it to clear, concise bullet points.",
			),
	})
	.strict();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "a day as YYYY-MM-DD");

export const McpStatsInputSchema = z
	.object({
		action: z
			.enum(MCP_STATS_ACTIONS)
			.describe(
				"stats: per tool, calls, errors, p50 and p95 milliseconds, members, workspaces and calls that stated a purpose. failures: failed calls per tool, error code and model. sample_intents: the newest purposes agents stated. feedback: the newest agent_feedback reports.",
			),
		tool: text(100)
			.optional()
			.describe("Only this tool, by name. Default: every tool."),
		from: isoDate
			.optional()
			.describe("First day, YYYY-MM-DD (UTC). Default: 6 days before to."),
		to: isoDate
			.optional()
			.describe("Last day, YYYY-MM-DD (UTC). Default: today."),
		limit: z
			.number()
			.int()
			.min(1)
			.max(500)
			.optional()
			.describe("Rows, 1-500. Default 100 for stats, else 20."),
	})
	.strict();

function jsonInput(schema: z.ZodObject): Record<string, unknown> {
	return z.toJSONSchema(
		schema.safeExtend({ workspace: z.string().optional() }),
		{
			io: "input",
			target: "draft-7",
			unrepresentable: "any",
		},
	);
}

const WORKSPACE_DESCRIPTION =
	"Workspace slug from list_workspaces. Default: the default workspace in the plugin settings, else the one you last opened in Opaline.";

function withWorkspaceDescription(
	schema: Record<string, unknown>,
): Record<string, unknown> {
	const properties = schema.properties as Record<
		string,
		Record<string, unknown>
	>;
	return {
		...schema,
		properties: {
			...properties,
			workspace: {
				...properties.workspace,
				description: WORKSPACE_DESCRIPTION,
			},
		},
	};
}

const day = (offsetDays: number, from = Date.now()) =>
	new Date(from + offsetDays * 86_400_000).toISOString().slice(0, 10);

export const agentFeedbackTool: McpTool = {
	name: "agent_feedback",
	annotations: WRITES_OWN_RECORDS,
	title: "Send feedback to the Opaline team",
	description: [
		"What it does: Sends the Opaline team feedback about Opaline, this MCP server, its docs, or a missing capability.",
		"Use when: You or the user hit a rough edge, a missing capability, an unhelpful error, or something that worked really well.",
		"Returns: A receipt; then keep going with the user's task.",
		"Side effects: Stores the feedback for the Opaline team; nothing in the workspace changes.",
		"Limits: Short text only; never include personal data or the content of sessions.",
		"",
		"Set feedback_type to route it: opaline for the product, mcp for this server (set category), docs for documentation, other for anything else. All sentiments are welcome. Keep it short and actionable: a one-sentence summary, then friction_points, suggested_improvement and details as concise bullet points, quoting the exact tool, parameter or error text. Use task_completed: false when you could not finish the user's request. The user can also ask you to send feedback directly; capture their point faithfully.",
		"Submitting feedback is not a way to end your turn or skip work: call it when warranted, then finish the user's task with the other tools.",
	].join("\n"),
	inputSchema: withWorkspaceDescription(jsonInput(AgentFeedbackInputSchema)),
	run: async (_client, { workspace: _workspace, ...args }) => {
		const input = parseMcpInput(AgentFeedbackInputSchema, args);
		return JSON.stringify({
			received: true,
			summary: input.summary,
			feedback_type: input.feedback_type,
			sentiment: input.sentiment,
			message: FEEDBACK_RESPONSE,
		});
	},
	recordsInput: true,
};

export function mcpStatsTool(
	executor: () => Pick<ClickHouseExecutor, "query">,
	now: () => number = Date.now,
	selfHostedAdmin: (userId: string) => Promise<boolean> = async () => false,
): McpTool {
	return {
		name: "mcp_stats",
		annotations: READ_ONLY,
		title: "MCP tool usage",
		description: [
			"What it does: Shows how agents use this MCP server's tools: calls, failures, latency, the purposes they stated and their feedback.",
			"Use when: Checking how a tool is doing, why it fails, what agents try to do with it, or what they reported.",
			"Returns: A table for the chosen action over the chosen days.",
			"Side effects: None.",
			"Limits: Only in the Opaline team's own workspace; up to 500 rows a call.",
		].join("\n"),
		inputSchema: withWorkspaceDescription(jsonInput(McpStatsInputSchema)),
		run: async (_client, { workspace: _workspace, ...args }, context) => {
			if (
				!isAdminWorkspace(context.workspace.id) &&
				!(isSelfHosted() && (await selfHostedAdmin(context.userId)))
			)
				throw new ORPCError("FORBIDDEN", {
					message:
						"refused, do not retry: mcp_stats is only available in the Opaline team's own workspace.",
				});
			const input = parseMcpInput(McpStatsInputSchema, args);
			const to = input.to ?? day(0, now());
			const from = input.from ?? day(-6, Date.parse(`${to}T00:00:00Z`));
			if (from > to)
				throw new ORPCError("BAD_REQUEST", {
					message: `from (${from}) is after to (${to}).`,
				});
			const limit = input.limit ?? (input.action === "stats" ? 100 : 20);
			const columns = MCP_STATS_COLUMNS[input.action];
			const rows = await executor().query<Record<string, unknown>>(
				mcpStatsStatement({
					action: input.action,
					from,
					to,
					limit,
					...(input.tool ? { tool: input.tool } : {}),
				}),
			);
			return [
				`mcp_stats action=${input.action} ${from}..${to}${input.tool ? ` tool=${input.tool}` : ""} rows=${rows.length}`,
				rows.length
					? table(
							columns,
							rows.map((row) => columns.map((column) => row[column])),
						)
					: "(no calls recorded)",
			].join("\n");
		},
	};
}
