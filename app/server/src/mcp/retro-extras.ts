import { ORPCError, type RouterClient } from "@orpc/server";
import {
	AnalysisFindInputBaseSchema,
	MeasuresRunInputSchema,
	PatternsPeekInputSchema,
} from "@rudel/api-routes";
import type { router } from "../router.js";
import { measureParams } from "../services/analysis/retro-measures.js";
import { pullCommand, pullPatternCommand, sqlOutCommand } from "./cli-hint.js";
import { parseMcpInput } from "./input-validation.js";
import type { McpTool, McpToolContext } from "./mcp-tools.js";
import {
	findPeekPlan,
	isPeek,
	PEEK_INPUT,
	renderFindPeek,
	renderSqlPeek,
	searchPeekQuery,
} from "./peek.js";

type Client = RouterClient<typeof router>;
type Args = Record<string, unknown>;
type Extra<T> = (
	client: Client,
	args: Args,
	context: McpToolContext,
	tool: McpTool,
) => Promise<T>;

const FindInputSchema = AnalysisFindInputBaseSchema.omit({ userId: true });

export function withPeek(tool: McpTool, peek: Extra<string>): McpTool {
	return {
		...tool,
		retroInputs: { ...tool.retroInputs, peek: PEEK_INPUT },
		run: async (client, { peek: asked, ...args }, context) =>
			isPeek(asked)
				? peek(client, args, context, tool)
				: tool.run(client, args, context),
	};
}

export const findPeek: Extra<string> = async (client, args, context, tool) => {
	const { workspace: _workspace, ...input } = args;
	const plan = findPeekPlan(input);
	if (!plan) {
		const started = performance.now();
		const text = String(
			await tool.run(client, { ...input, verbosity: "summary" }, context),
		);
		return `peek find source=weekly: ${text.split("\n").length} lines, ${text.length.toLocaleString("en-US")} chars; weekly totals are a snapshot lookup, so this ran the call itself\nsuggest: ${text.length > 20_000 ? "narrow from/to or groupBy" : "small: call again without peek"}\npeek: ${Math.round(performance.now() - started)} ms`;
	}
	parseMcpInput(FindInputSchema, input);
	return renderFindPeek(
		input,
		plan,
		await client.analysis.peek({ query: plan.query }),
	);
};

export const sqlPeek: Extra<string> = async (client, args) => {
	const query = String(args.query ?? "");
	return renderSqlPeek(
		"sql",
		await client.analysis.peek({ query }),
		200,
		sqlOutCommand(query),
	);
};

function measureRunInput(args: Args) {
	const { action, workspace: _workspace, ...rest } = args;
	if (action !== "run")
		throw new ORPCError("BAD_REQUEST", {
			message: "peek goes with action=run",
		});
	return parseMcpInput(MeasuresRunInputSchema, rest);
}

export const measuresPeek: Extra<string> = async (client, args) => {
	const input = measureRunInput(args);
	const params = measureParams(input, new Date());
	return renderSqlPeek(
		"measures",
		await client.analysis.measures.peek(input),
		input.limit,
		"error" in params ? null : pullCommand(params),
	);
};

export const searchPeek: Extra<string> = async (client, args) => {
	const peek = await client.analysis.peek({ query: searchPeekQuery(args) });
	const note =
		args.mode === undefined || args.mode === "exact"
			? ""
			: "\nnote: peek counts exact matches only; meaning matches are ranked when loaded";
	return `${renderSqlPeek("search", peek, 20, null)}${note}`;
};

export const patternsPeek: Extra<string> = async (client, args) => {
	const { action, workspace: _workspace, since: _since, ...rest } = args;
	if (action !== "list" && action !== "drill")
		throw new ORPCError("BAD_REQUEST", {
			message: "peek goes with action=list or drill",
		});
	const input = parseMcpInput(PatternsPeekInputSchema, rest);
	const params = measureParams(input, new Date());
	return renderSqlPeek(
		"patterns",
		await client.analysis.patterns.peek(input),
		input.limit,
		"error" in params
			? null
			: input.id
				? pullPatternCommand(input.id, params)
				: pullCommand(params),
	);
};
