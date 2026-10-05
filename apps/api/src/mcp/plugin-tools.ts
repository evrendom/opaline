import { ORPCError } from "@orpc/server";
import { contract } from "@rudel/api-routes";
import { z } from "zod";
import type { McpTool } from "./mcp-tools.js";
import { READ_ONLY } from "./tool-annotations.js";

/**
 * The read-only procedures the plugin app (the web app in plugin mode) may
 * call. Each becomes its own app-only tool, `app_<path with __>`, taking the
 * procedure's input plus `workspace`. Never add a procedure that writes.
 */
export const PLUGIN_PROCEDURES = [
	"analytics.overview.costs",
	"analytics.overview.kpis",
	"analytics.overview.usersDailyTrend",
	"analytics.sessions.filterCatalog",
	"analytics.sessions.list",
	"analytics.sessions.summaryComparison",
	"analytics.sessions.dimensionAnalysis",
	"analytics.sessions.uploadFailures",
	"analytics.sessions.detailInitial",
	"analytics.sessions.detailOverview",
	"analytics.sessions.detailWindow",
	"analytics.sessions.detailSpine",
	"analytics.sessions.detailBodyChunk",
	"analytics.sessions.detailRelationships",
	"analytics.sessions.detailSubagent",
	"analytics.sessions.detailTurn",
	"analytics.skills.list",
	"analytics.skills.detail",
	"analytics.repositories.list",
	"analytics.repositories.detail",
	"analytics.developers.list",
	"analytics.developers.teamCards",
] as const;

const PREFIX = "app_";

export const PLUGIN_TOOLS: readonly McpTool[] = PLUGIN_PROCEDURES.map(
	(path) => {
		const schema = pluginInputSchema(path);
		return {
			name: `${PREFIX}${path.replaceAll(".", "__")}`,
			annotations: READ_ONLY,
			title: path,
			description: `Read-only Opaline procedure ${path}, for the Opaline app.`,
			inputSchema: {
				type: "object",
				...z.toJSONSchema(schema, {
					io: "input",
					target: "draft-7",
					unrepresentable: "any",
				}),
			},
			meta: { ui: { visibility: ["app"] } },
			run: (client, args) => {
				const parsed = schema.safeParse(args);
				if (!parsed.success) {
					throw new ORPCError("BAD_REQUEST", {
						data: z.flattenError(parsed.error),
					});
				}
				const { workspace: _, ...input } = parsed.data as Record<
					string,
					unknown
				>;
				const procedure = path
					.split(".")
					.reduce<unknown>(
						(node, key) => (node as Record<string, unknown>)[key],
						client,
					) as (input?: unknown) => Promise<unknown>;
				return procedure(Object.keys(input).length ? input : undefined);
			},
		};
	},
);

export function isPluginTool(tool: McpTool) {
	return tool.name.startsWith(PREFIX) && PLUGIN_TOOLS.includes(tool);
}

/** The procedure's contract input, strict, plus the `workspace` slug. */
export function pluginInputSchema(path: (typeof PLUGIN_PROCEDURES)[number]) {
	const procedure = path
		.split(".")
		.reduce<unknown>(
			(node, key) => (node as Record<string, unknown>)[key],
			contract,
		) as { "~orpc": { inputSchema?: z.ZodType } };
	return withWorkspace(procedure["~orpc"].inputSchema ?? z.object({}));
}

function withWorkspace(schema: z.core.$ZodType): z.ZodType {
	if (schema instanceof z.ZodPipe) return withWorkspace(schema.in);
	if (schema instanceof z.ZodObject) {
		return schema.safeExtend({ workspace: z.string().min(1) }).strict();
	}
	if (
		schema instanceof z.ZodUnion ||
		schema instanceof z.ZodDiscriminatedUnion
	) {
		return z.union(
			schema.options.map(withWorkspace) as [z.ZodType, ...z.ZodType[]],
		);
	}
	throw new Error("Plugin procedures take an object input.");
}
