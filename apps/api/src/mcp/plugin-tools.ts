import { ORPCError } from "@orpc/server";
import {
	contract,
	PLUGIN_TOOL_NAMES,
	type PluginProcedure,
} from "@rudel/api-routes";
import { z } from "zod";
import type { McpTool } from "./mcp-tools.js";
import { READ_ONLY } from "./tool-annotations.js";

/**
 * The read-only procedures the plugin app (the web app in plugin mode) may
 * call. Each becomes its own app-only tool, named in `PLUGIN_TOOL_NAMES`
 * (`@rudel/api-routes`, shared with the app), taking the procedure's input
 * plus `workspace`. Never add a procedure that writes.
 */
export const PLUGIN_PROCEDURES = Object.keys(
	PLUGIN_TOOL_NAMES,
) as PluginProcedure[];

/** Success-score metrics; the plugin never breaks them down by person. */
const SCORE_KEY = /success/u;

const SESSION_CONTENT =
	"Only the session's owner or a workspace admin can open it";

/**
 * What each app-only tool loads, for its title and one-line description, with
 * any access rule beyond workspace membership (which every tool requires).
 */
const PLUGIN_LABELS: Record<
	PluginProcedure,
	{ title: string; loads: string; limits?: string }
> = {
	"analytics.overview.costs": {
		title: "Dashboard: metrics",
		loads:
			"its metrics (cost, sessions, signals, agent runs, merged pull requests, CI failures per pull request and CI runs) with their trends and breakdowns",
	},
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
		title: "Sessions: breakdown",
		loads: "session breakdowns",
	},
	"analytics.sessions.uploadFailures": {
		title: "Sessions: upload problems",
		loads: "sessions that failed to upload",
		limits: "Admins see every member's, members their own",
	},
	"analytics.sessions.detailInitial": {
		title: "Session: overview",
		loads: "the first view of a session",
		limits: SESSION_CONTENT,
	},
	"analytics.sessions.detailOverview": {
		title: "Session: turns",
		loads: "a session's summary and its list of turns",
		limits: SESSION_CONTENT,
	},
	"analytics.sessions.detailWindow": {
		title: "Session: window",
		loads: "part of a session's timeline",
		limits: SESSION_CONTENT,
	},
	"analytics.sessions.detailSpine": {
		title: "Session: outline",
		loads: "a session's outline",
		limits: SESSION_CONTENT,
	},
	"analytics.sessions.detailBodyChunk": {
		title: "Session: text",
		loads: "part of a session's text",
		limits: SESSION_CONTENT,
	},
	"analytics.sessions.detailRelationships": {
		title: "Session: links",
		loads: "a session's related sessions",
		limits: SESSION_CONTENT,
	},
	"analytics.sessions.detailSubagent": {
		title: "Session: subagent",
		loads: "a subagent's work in a session",
		limits: SESSION_CONTENT,
	},
	"analytics.sessions.detailTurn": {
		title: "Session: one prompt",
		loads: "one prompt and the agent's work after it",
		limits: SESSION_CONTENT,
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
			name: PLUGIN_TOOL_NAMES[path],
			annotations: READ_ONLY,
			title: PLUGIN_LABELS[path].title,
			description: `Used by the Opaline dashboard to load ${PLUGIN_LABELS[path].loads}. ${PLUGIN_LABELS[path].limits ?? "Members of the workspace only"}. Not called by the assistant.`,
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
				return procedure(Object.keys(input).length ? input : undefined).then(
					withoutPersonalScores,
				);
			},
		};
	},
);

/**
 * Rows that belong to one person (they carry `user_id`) lose their success
 * scores, at any depth: the plugin app shows no per-person success score.
 */
export function withoutPersonalScores(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutPersonalScores);
	if (!value || typeof value !== "object") return value;
	const personal = "user_id" in value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => !(personal && SCORE_KEY.test(key)))
			.map(([key, child]) => [key, withoutPersonalScores(child)]),
	);
}

export function isPluginTool(tool: McpTool) {
	// By name: the server serves wrapped copies (`withRedactedOutput`).
	return (
		tool.name.startsWith(PREFIX) &&
		PLUGIN_TOOLS.some((plugin) => plugin.name === tool.name)
	);
}

/** The procedure's contract input, strict, plus the `workspace` slug. */
export function pluginInputSchema(path: PluginProcedure) {
	const schema = contractInputSchema(path);
	// The breakdown can group by member, so it offers no success-score metric.
	if (
		path === "analytics.sessions.dimensionAnalysis" &&
		schema instanceof z.ZodObject &&
		schema.shape.metric instanceof z.ZodEnum
	) {
		const metrics = (schema.shape.metric.options as string[]).filter(
			(metric) => !SCORE_KEY.test(metric),
		);
		return schema.extend({ metric: z.enum(metrics as [string, ...string[]]) });
	}
	return schema;
}

function contractInputSchema(path: PluginProcedure) {
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
