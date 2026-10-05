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

/** What each app-only tool loads, for its title and one-line description. */
const PLUGIN_LABELS: Record<
	(typeof PLUGIN_PROCEDURES)[number],
	{ title: string; loads: string }
> = {
	"analytics.overview.costs": { title: "Dashboard: costs", loads: "cost data" },
	"analytics.overview.kpis": {
		title: "Dashboard: totals",
		loads: "headline totals",
	},
	"analytics.overview.usersDailyTrend": {
		title: "Dashboard: daily activity",
		loads: "daily activity per member",
	},
	"analytics.sessions.filterCatalog": {
		title: "Sessions: filters",
		loads: "the session filter options",
	},
	"analytics.sessions.list": {
		title: "Sessions: list",
		loads: "the session list",
	},
	"analytics.sessions.summaryComparison": {
		title: "Sessions: summary",
		loads: "session totals compared with the previous period",
	},
	"analytics.sessions.dimensionAnalysis": {
		title: "Sessions: breakdowns",
		loads: "session breakdowns",
	},
	"analytics.sessions.uploadFailures": {
		title: "Sessions: upload problems",
		loads: "sessions that failed to upload",
	},
	"analytics.sessions.detailInitial": {
		title: "Session: first view",
		loads: "the first view of a session",
	},
	"analytics.sessions.detailOverview": {
		title: "Session: overview",
		loads: "a session's overview",
	},
	"analytics.sessions.detailWindow": {
		title: "Session: part of the timeline",
		loads: "part of a session's timeline",
	},
	"analytics.sessions.detailSpine": {
		title: "Session: outline",
		loads: "a session's outline",
	},
	"analytics.sessions.detailBodyChunk": {
		title: "Session: text",
		loads: "part of a session's text",
	},
	"analytics.sessions.detailRelationships": {
		title: "Session: related sessions",
		loads: "a session's related sessions",
	},
	"analytics.sessions.detailSubagent": {
		title: "Session: subagent",
		loads: "a subagent's work in a session",
	},
	"analytics.sessions.detailTurn": {
		title: "Session: one prompt",
		loads: "one prompt and the agent's work after it",
	},
	"analytics.skills.list": { title: "Skills: list", loads: "the skill list" },
	"analytics.skills.detail": {
		title: "Skills: one skill",
		loads: "one skill",
	},
	"analytics.repositories.list": {
		title: "Repositories: list",
		loads: "the repository list",
	},
	"analytics.repositories.detail": {
		title: "Repositories: one repository",
		loads: "one repository",
	},
	"analytics.developers.list": {
		title: "Team: members",
		loads: "per-member usage, to see where each person's setup needs help",
	},
	"analytics.developers.teamCards": {
		title: "Team: member cards",
		loads: "per-member cards, to see where each person's setup needs help",
	},
};

const PREFIX = "app_";

export const PLUGIN_TOOLS: readonly McpTool[] = PLUGIN_PROCEDURES.map(
	(path) => {
		const schema = pluginInputSchema(path);
		return {
			name: `${PREFIX}${path.replaceAll(".", "__")}`,
			annotations: READ_ONLY,
			title: PLUGIN_LABELS[path].title,
			description: `Used by the Opaline dashboard to load ${PLUGIN_LABELS[path].loads}. Not called by the assistant.`,
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
