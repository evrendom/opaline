import { ORPCError, type RouterClient } from "@orpc/server";
import {
	AnalysisFindInputSchema,
	AnalysisHistoryGetInputSchema,
	AnalysisHistoryQueryInputSchema,
	AnalysisHistorySaveInputSchema,
	AnalysisHistorySearchInputSchema,
	AnalysisHistoryShareInputSchema,
	AnalysisReadInputSchema,
	type CostDashboard,
	CostDashboardInputSchema,
	CostDashboardRequestedMetricSchema,
} from "@rudel/api-routes";
import { z } from "zod";
import { sqlClient } from "../db.js";
import type { AppContext } from "../middleware.js";
import type { router } from "../router.js";
import {
	renderAnalysisSearch,
	renderAnalysisTree,
	renderFind,
	renderRead,
	renderStoredQuery,
} from "./analysis-renderers.js";
import { DASHBOARD_WIDGET_URI, OPALINE_ICON } from "./dashboard-widget.js";
import { parseMcpInput } from "./input-validation.js";
import {
	type McpToolAnnotations,
	READ_ONLY,
	WRITES_OWN_RECORDS,
} from "./tool-annotations.js";

type Client = RouterClient<typeof router>;

/** An error whose message is safe to show the model and the user. */
export class McpToolError extends Error {}
type Args = Record<string, unknown>;
type JsonSchema = Record<string, unknown>;

export interface McpWorkspace {
	readonly id: string;
	readonly slug: string;
}

export interface McpToolContext {
	readonly userId: string;
	readonly workspace: McpWorkspace;
	readonly authSession: Pick<AppContext, "user" | "session">;
}

export interface McpTool {
	readonly name: string;
	readonly title: string;
	readonly description: string;
	readonly inputSchema: JsonSchema;
	readonly outputSchema?: JsonSchema;
	/** Published in tools/list; must match what `run` does. */
	readonly annotations: McpToolAnnotations;
	/** `_meta` for tools/list; tools with it return structuredContent. */
	readonly meta?: Record<string, unknown>;
	readonly icons?: readonly unknown[];
	run(client: Client, args: Args, context: McpToolContext): Promise<unknown>;
	/** Path in the web app showing the same view, relative to the workspace. */
	link?(args: Args): string;
}

const string = (description: string): JsonSchema => ({
	type: "string",
	description,
});
const strings = (description: string): JsonSchema => ({
	type: "array",
	items: { type: "string" },
	description,
});
const oneOf = (values: readonly string[], description: string): JsonSchema => ({
	type: "string",
	enum: values,
	description,
});
const date = (description: string) =>
	string(`${description} (YYYY-MM-DD, UTC).`);
const WORKSPACE_DESCRIPTION =
	"Workspace slug from list_workspaces. Default: the default workspace in the plugin settings, else the one you last opened in Opaline.";
/** Tools only the widget or the host UI call; hidden from the model. */
export const APP_ONLY = { ui: { visibility: ["app"] } };
const isoDay = (offsetDays = 0) =>
	new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

function input(properties: JsonSchema = {}, required: string[] = []) {
	return {
		type: "object",
		properties: {
			workspace: string(WORKSPACE_DESCRIPTION),
			...properties,
		},
		required,
		additionalProperties: false,
	};
}

function query(args: Args, keys: Record<string, string>) {
	const params = new URLSearchParams();
	for (const [arg, param] of Object.entries(keys)) {
		const value = args[arg];
		for (const item of Array.isArray(value) ? value : [value]) {
			if (item !== undefined && item !== null) params.append(param, `${item}`);
		}
	}
	const search = params.toString();
	return search ? `?${search}` : "";
}

/** Keeps the requested metric with its trend and the top breakdown rows. */
export function summarizeDashboard(dashboard: CostDashboard, metric: string) {
	const data = dashboard.metrics[metric as keyof CostDashboard["metrics"]];
	if (!data) {
		throw new McpToolError(
			`${metric} is not available for this workspace yet. Available: ${dashboard.availableMetrics.join(", ")}.`,
		);
	}
	// A ratio over zero pull requests is undefined, not zero.
	const ratio = (value: number, denominator?: number) =>
		denominator === 0 ? null : value;
	return {
		metric,
		availableMetrics: dashboard.availableMetrics,
		splitBy: dashboard.splitBy,
		total: ratio(data.total, data.denominator),
		incomplete: data.incomplete,
		series: data.series,
		trend: data.trend.map(
			({ date, total, values, denominator, denominatorValues }) => ({
				date,
				total: ratio(total, denominator),
				...(dashboard.splitBy === "none"
					? {}
					: {
							values: Object.fromEntries(
								Object.entries(values).map(([id, value]) => [
									id,
									ratio(value, denominatorValues?.[id]),
								]),
							),
						}),
			}),
		),
		top: Object.fromEntries(
			Object.entries(data.breakdowns)
				.filter(([, rows]) => rows.length > 0)
				.map(([dimension, rows]) => [
					dimension,
					rows
						.slice(0, 10)
						.map(({ id, label, value }) => ({ id, label, value })),
				]),
		),
		...(data.durationStats ? { durationStats: data.durationStats } : {}),
	};
}

const DASHBOARD_METRICS = CostDashboardRequestedMetricSchema.options;
const SPLITS = CostDashboardInputSchema.shape.splitBy.unwrap().options;

/** Reads of the analysis log; `action` selects the history procedure. */
const AnalysesToolInputSchema = z
	.object({
		action: z.enum(["search", "get", "query"]).default("search"),
		...AnalysisHistorySearchInputSchema.partial().shape,
		...AnalysisHistoryGetInputSchema.partial().shape,
		...AnalysisHistoryQueryInputSchema.partial().shape,
	})
	.strict();

/** Writes to the analysis log, kept apart so `analyses` stays read-only. */
const SaveAnalysisToolInputSchema = z
	.object({
		action: z.enum(["save", "share"]).default("save"),
		...AnalysisHistorySaveInputSchema.partial().shape,
		...AnalysisHistoryShareInputSchema.partial().shape,
	})
	.strict();

/** What `analyses` answers clients still sending the old write actions. */
export const ANALYSES_MOVED_TO_SAVE_ANALYSIS =
	"analyses only searches and reads the analysis log now. Nothing was saved: call save_analysis with the same arguments (action=save to save, action=share to share).";

/**
 * The JSON Schema MCP hosts show the model for a tool taking `schema`, plus the
 * `workspace` every tool accepts. Cross-field refinements stay server-side.
 */
function zodToolInput(schema: z.ZodObject): JsonSchema {
	return z.toJSONSchema(
		schema.safeExtend({ workspace: z.string().optional() }),
		{ io: "input", target: "draft-7", unrepresentable: "any" },
	);
}

/**
 * Gives every property of a tool's input schema its description, including
 * the properties of array items (`refs[].turn`). Fails at load when a
 * property has none or a description names no property, so the published
 * schema never carries an undescribed or unused parameter.
 */
function describeInput(
	schema: JsonSchema,
	descriptions: Record<string, string>,
): JsonSchema {
	const unused = new Set(Object.keys(descriptions));
	const walk = (node: JsonSchema, prefix: string): JsonSchema => {
		const properties = node.properties as Record<string, JsonSchema>;
		return {
			...node,
			properties: Object.fromEntries(
				Object.entries(properties).map(([key, property]) => {
					const path = `${prefix}${key}`;
					const description = descriptions[path];
					if (!description)
						throw new Error(`Tool input ${path} has no description`);
					unused.delete(path);
					const items = property.items as JsonSchema | undefined;
					return [
						key,
						{
							...property,
							description,
							...(items?.properties
								? { items: walk(items, `${path}[].`) }
								: {}),
						},
					];
				}),
			),
		};
	};
	const described = walk(schema, "");
	if (unused.size)
		throw new Error(`Descriptions name no input: ${[...unused].join(", ")}`);
	return described;
}

/** `structuredContent` of a tool returning a list: `{ items: [...] }`. */
function itemsOutput(properties: Record<string, JsonSchema>): JsonSchema {
	return {
		type: "object",
		properties: {
			items: { type: "array", items: { type: "object", properties } },
		},
		required: ["items"],
	};
}

/** A tool as `tools/list` publishes it; `annotations.title` repeats its title. */
export function listedTool(tool: McpTool) {
	return {
		name: tool.name,
		title: tool.title,
		description: tool.description,
		inputSchema: tool.inputSchema,
		...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
		...(tool.icons ? { icons: tool.icons } : {}),
		annotations: { title: tool.title, ...tool.annotations },
		...(tool.meta ? { _meta: tool.meta } : {}),
	};
}

export const MCP_TOOLS: readonly McpTool[] = [
	{
		name: "find",
		annotations: WRITES_OWN_RECORDS,
		title: "Find patterns in agent runs",
		description: [
			"What it does: Finds where the team's agents got stuck, failed or wasted time and money, so the team can fix their setup.",
			"Use when: Start here for questions about how agents worked, then read a few runs it points to.",
			"Returns: The period covered, totals, and runs, failures by cause, or prompts where the user was unhappy.",
			"Side effects: Saves what it found in the answer being worked on, deleted after 7 days if never saved. Nobody can see this unfinished answer, not even the user, until save_analysis saves it.",
			"Limits: Members see their own sessions, admins the whole team; up to 200 rows per call.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(AnalysisFindInputSchema), {
			source:
				"Required. runs: one row per run with its time and cost. tool: failed tool calls grouped by cause. user: prompts where the user was unhappy with the agent (corrections, complaints) and agent apologies.",
			from: "First day, YYYY-MM-DD (UTC). Default: 6 days before to, or the last day covered by the answer named in updates.",
			to: "Last day, YYYY-MM-DD (UTC). Default: today.",
			latest: "Only the newest N sessions in the date range, 1-200.",
			repository:
				"Only sessions in this repository (a name from the repository column).",
			agent: "Only sessions from claude_code or codex. Default: both.",
			model:
				"Only runs that used this model id; cost then counts only that model.",
			sessionId: "Only this session and the subagents it started.",
			userId:
				"Admins only: only this member's sessions, to see where their setup needs help.",
			toolGroup:
				"source=tool only: shell, edit, read, search, browser, web, mcp, subagent or other.",
			commandClass:
				"source=tool only, shell failures: test, build, lint, typecheck, git, migrate, install or other.",
			kind: "source=tool only: friction (blocked by a hook or policy), mistake (wrong path, stale patch, bad flag), validation (tests, types, lint or build failed), environment (missing tool or service), noise (expected failures, hidden by default) or other.",
			cause:
				"source=tool only: only this cause, copied from an earlier result.",
			detail:
				"source=tool only: only this detail (lint rule, error code), copied from an earlier result.",
			includeNoise:
				"source=tool only: also show expected failures. Default false.",
			reaction:
				"source=user only: negative (unhappy prompts), swear (strongly worded complaints), apology (the agent apologized). Default: all three.",
			groupBy:
				"source=runs only: totals per week, model, repository, agent or session instead of one row per run.",
			refs: "Only these runs (at most 200), as given by an earlier result; with source=runs this returns their total time and cost.",
			"refs[].sessionId": "The run's session id.",
			"refs[].agentId":
				"Empty (default) for the main agent, else the subagent's id.",
			"refs[].turn": "The run's number in the session, from 1.",
			limit: "Rows per call, 1-200. Default 50, or 20 for source=tool.",
			sort: "source=runs order, biggest first: startedAt (default, newest first), minutes, costUsd, failedCalls or rawChars (size of the run's text).",
			cursor:
				"The value from an earlier result's 'more: pass cursor=…' line, to get the next page with the same other arguments.",
			analysis:
				"Id of the answer being worked on, from the 'analysis=' value at the end of an earlier find or read result. Leave out on the first call.",
			question:
				"First call only: the user's question, word for word. Starts a new answer.",
			updates:
				"First call only: id of a saved answer this new answer updates. from then defaults to the last day that answer covered.",
			step: "The sub-question this call answers, as text, or a step id from an earlier result.",
			parentStep:
				"A step id from an earlier result; makes this step a follow-up of it.",
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: async (client, { workspace: _workspace, ...args }) =>
			renderFind(
				await client.analysis.find(
					parseMcpInput(AnalysisFindInputSchema, args),
				),
			),
	},
	{
		name: "read",
		annotations: WRITES_OWN_RECORDS,
		title: "Read agent runs",
		description: [
			"What it does: Shows what happened in up to 10 runs that find pointed to (a run is one prompt and the agent's work after it).",
			"Use when: You need to see why something went wrong before you name a cause.",
			"Returns: For each run, the prompt, files changed, checks run, failed calls and the agent's last message.",
			"Side effects: Saves what it found in the answer being worked on, deleted after 7 days if never saved. Nobody can see this unfinished answer, not even the user, until save_analysis saves it.",
			"Limits: Only sessions you may open (your own, or any as an admin); output is cut to maxChars.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(AnalysisReadInputSchema), {
			refs: "Required. The runs to read, 1-10, as given by find.",
			"refs[].sessionId": "The run's session id.",
			"refs[].agentId":
				"Empty (default) for the main agent, else the subagent's id.",
			"refs[].turn": "The run's number in the session, from 1.",
			depth:
				"How much to show: exchange (default, the outcome in brief), turn (every step, compact) or record (the full text of one item).",
			maxChars:
				"Most characters returned for all runs, 1-40000. Default 12000.",
			record:
				"Record view only (required there): the item number, from the turn view or find.",
			block:
				"Record view only: the part within the item, from 0. Default: the first part with text.",
			fromChar:
				"Record view only: first character to show, from 0. Default: 0.",
			toChar:
				"Record view only: character to stop before, above fromChar. Default: the end.",
			analysis:
				"Id of the answer being worked on, from the 'analysis=' value at the end of an earlier find or read result. Leave out on the first call.",
			question:
				"First call only: the user's question, word for word. Starts a new answer.",
			updates: "First call only: id of a saved answer this new answer updates.",
			step: "The sub-question this call answers, as text, or a step id from an earlier result.",
			parentStep:
				"A step id from an earlier result; makes this step a follow-up of it.",
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: async (client, { workspace: _workspace, ...args }) =>
			renderRead(
				await client.analysis.read(
					parseMcpInput(AnalysisReadInputSchema, args),
				),
			),
	},
	{
		name: "analyses",
		annotations: READ_ONLY,
		title: "Search saved answers",
		description: [
			"What it does: Searches the answers your team saved before and opens one.",
			"Use when: Before a new question, to check whether a saved answer already covers it and can be updated.",
			"Returns: A list of saved answers, or one answer with its findings, the last day its data covers, the steps behind it and links to older or newer versions.",
			"Side effects: None.",
			"Limits: Only answers you saved or that were shared with your workspace; unsaved work never appears.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(AnalysesToolInputSchema), {
			action:
				"search (default): list saved answers. get: open one answer. query: open one stored result of an answer.",
			text: "search: words to look for, matched by meaning (1-500 characters). Default: the most recent answers.",
			limit: "search: how many answers to return, 1-50. Default 10.",
			includeEval: "search: also show answers from test runs. Default false.",
			analysis: "get: the answer's id (required for get).",
			query:
				"query: a stored result's id, shown in the steps of get (required for query).",
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: (client, { workspace: _workspace, action, ...args }) =>
			action === "save" || action === "share"
				? Promise.resolve(ANALYSES_MOVED_TO_SAVE_ANALYSIS)
				: withLogOffMessage(readAnalyses(client, action, args)),
	},
	{
		name: "save_analysis",
		annotations: WRITES_OWN_RECORDS,
		title: "Save or share an answer",
		description: [
			"What it does: Saves the finished answer, or shares a saved answer with your workspace.",
			"Use when: Once, right before your final message; share only when the user asks.",
			"Returns: The saved answer's id, or whether it is now shared.",
			"Side effects: Saves the answer in Opaline so you, and your own workspace if shared, can see it. Nothing is posted outside Opaline. A saved answer is never changed or deleted; an update is saved as a new answer linked to it. Sharing can be undone with shared=false.",
			"Limits: Only the person who asked can save or share an answer, and each answer is saved once.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(SaveAnalysisToolInputSchema), {
			action:
				"save (default): save the answer. share: set whether your workspace can see a saved answer.",
			analysis:
				"Required. The answer's id, from the 'analysis=' value at the end of a find or read result.",
			finalAnswer:
				"save: the complete final answer, up to 20000 characters (required for save).",
			findings: "save: one finding per step, at most 100. Default: none.",
			"findings[].step": "The step's id, or its sub-question word for word.",
			"findings[].finding": "What this step found, up to 4000 characters.",
			clarifications:
				"save: questions you asked the user, with their replies, at most 20. Default: none.",
			"clarifications[].question": "The question you asked the user.",
			"clarifications[].reply": "The user's reply.",
			"clarifications[].before":
				"A step id or sub-question to place it before. Default: at the end.",
			topics: "save: up to 8 short topic words, used for search.",
			updates:
				"save: id of the saved answer this one updates, if the first find did not already name it.",
			changes:
				"save, only when updating an answer: one item for every finding saved now, plus a dropped item for each old finding that no longer holds.",
			"changes[].step":
				"The finding's step id or sub-question; for dropped, a step of the old answer.",
			"changes[].change":
				"confirmed, strengthened, weakened, new or dropped (compared with the old answer).",
			"changes[].evidence":
				"Short reason, with counts or dates, up to 500 characters.",
			shared:
				"share: true to share with your workspace, false to stop sharing (required for share).",
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: (client, { workspace: _workspace, action, ...args }) =>
			withLogOffMessage(writeAnalysis(client, action, args)),
	},
	{
		name: "list_workspaces",
		annotations: READ_ONLY,
		title: "List your workspaces",
		description: [
			"What it does: Lists the Opaline workspaces you belong to.",
			"Use when: An answer looks empty, the user names another team, or you need a workspace name for another tool.",
			"Returns: Each workspace's name, slug (the short name other tools take as workspace) and logo.",
			"Side effects: None.",
			"Limits: Only workspaces you are a member of.",
		].join("\n"),
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		outputSchema: itemsOutput({
			name: { type: "string", description: "Workspace name." },
			slug: {
				type: "string",
				description: "Pass as workspace to other tools.",
			},
			logo: {
				type: ["string", "null"],
				description: "Logo URL, or null.",
			},
		}),
		// Tools take the slug; the internal organization id stays out.
		run: async (client) =>
			(await client.listMyOrganizations()).map(({ name, slug, logo }) => ({
				name,
				slug,
				logo,
			})),
	},
	{
		name: "get_dashboard",
		annotations: READ_ONLY,
		// "Opaline", the name Codex shows in the app's header (see #185).
		title: "Opaline",
		description: [
			"What it does: Shows the Opaline dashboard in the chat: agent cost, sessions and runs over time, by repository, model and member.",
			"Use when: The user asks to open or show the dashboard, or wants an overview of agent cost and usage.",
			"Returns: The chosen metric's total, daily trend and top breakdowns, and the dashboard itself in the chat.",
			"Side effects: None.",
			"Limits: Up to one year per view; pull request metrics need a GitHub connection.",
		].join("\n"),
		inputSchema: input({
			startDate: date("First day. Default: 29 days before today"),
			endDate: date(
				"Last day. Default: today; at most one year after startDate",
			),
			metric: oneOf(
				DASHBOARD_METRICS,
				"What to chart. Default: cost (estimated cost in USD).",
			),
			splitBy: oneOf(
				SPLITS,
				"Split the chart into one line per value of this. Default: none.",
			),
			members: strings(
				"Only these members, by the user ids an earlier dashboard showed. Default: everyone you may see.",
			),
			repositories: strings("Only these repositories, by name. Default: all."),
			models: strings("Only these model ids. Default: all."),
		}),
		outputSchema: {
			type: "object",
			properties: {
				metric: { type: "string", description: "The charted metric." },
				availableMetrics: {
					type: "array",
					items: { type: "string" },
					description: "Metrics the workspace has data for.",
				},
				splitBy: { type: "string", description: "The split dimension." },
				total: {
					type: ["number", "null"],
					description:
						"Total for the range; null for a ratio over zero pull requests.",
				},
				incomplete: {
					description: "Whether some data could not be counted.",
				},
				series: { description: "The series of a split trend." },
				trend: {
					type: "array",
					description:
						"One entry per day: date, total and, when split, values per series.",
				},
				top: {
					type: "object",
					description: "Up to 10 rows (id, label, value) per breakdown.",
				},
				durationStats: { description: "Duration statistics, when available." },
				query: {
					type: "object",
					description: "The date range, filters and workspace used.",
				},
			},
			required: ["metric", "trend", "query"],
		},
		// Also opens from the ChatGPT sidebar, which calls it with `{}`.
		meta: {
			ui: { resourceUri: DASHBOARD_WIDGET_URI },
			"openai/outputTemplate": DASHBOARD_WIDGET_URI,
			"openai/ui": { entrypoints: [{ type: "global" }] },
		},
		icons: [OPALINE_ICON],
		run: async (client, args, context) => {
			const query = {
				startDate: (args.startDate as string | undefined) ?? isoDay(-29),
				endDate: (args.endDate as string | undefined) ?? isoDay(),
				metric: (args.metric as (typeof DASHBOARD_METRICS)[number]) ?? "cost",
				splitBy: (args.splitBy as (typeof SPLITS)[number]) ?? "none",
				members: (args.members as string[]) ?? [],
				repositories: (args.repositories as string[]) ?? [],
				models: (args.models as string[]) ?? [],
			};
			const { metric: _metric, ...filters } = query;
			// The contract fills every other filter, so this is the exact input
			// (and cache key) the web dashboard uses.
			const input = CostDashboardInputSchema.parse({
				...filters,
				requestedMetric: query.metric,
			});
			const [dashboard, bootstrap] = await Promise.all([
				client.analytics.overview.costs(input),
				readPluginBootstrap(client, context),
			]);
			const view = { ...query, workspace: context.workspace.slug };
			return {
				...summarizeDashboard(dashboard, query.metric),
				query: view,
				// Only the plugin app reads `widget` (as `_meta`): its first screen
				// renders from this without another round trip.
				widget: {
					query: view,
					dashboard: { input, data: dashboard },
					bootstrap,
				},
			};
		},
		link: (args) =>
			`/dashboard${query(args, { startDate: "from", endDate: "to", metric: "metric", splitBy: "split", members: "member", repositories: "repo", models: "model" })}`,
	},
	{
		name: "get_session",
		annotations: READ_ONLY,
		title: "Session: overview",
		description:
			"Used by Opaline to show a session the user mentioned with @. Not called by the assistant.",
		inputSchema: input(
			{
				sessionId: string("The session's id (required)."),
				turnCursor: string("Position of the next page of turns."),
			},
			["sessionId"],
		),
		meta: APP_ONLY,
		run: async (client, args) =>
			withoutRenderIds(
				await client.analytics.sessions.detailOverview({
					sessionId: args.sessionId as string,
					...(args.turnCursor ? { turnCursor: args.turnCursor as string } : {}),
				}),
			),
		link: (args) => `/sessions/${encodeURIComponent(`${args.sessionId}`)}`,
	},
	{
		name: "settings_read",
		annotations: READ_ONLY,
		title: "Settings: read",
		description:
			"Used by the plugin settings page to load your default workspace. Not called by the assistant.",
		inputSchema: { type: "object", additionalProperties: false },
		outputSchema: {
			type: "object",
			properties: {
				schema: { type: "object" },
				values: { type: "object" },
				layout: { type: "array", items: { type: "object" } },
			},
			required: ["schema", "values"],
		},
		meta: APP_ONLY,
		run: async (client, _args, { workspace }) => ({
			schema: {
				type: "object",
				properties: {
					defaultWorkspace: {
						type: "string",
						title: "Default workspace",
						description:
							"Workspace Opaline answers from unless you name another one.",
						enum: (await client.listMyOrganizations()).map((org) => org.slug),
					},
				},
			},
			values: { defaultWorkspace: workspace.slug },
		}),
	},
	{
		name: "settings_update",
		annotations: WRITES_OWN_RECORDS,
		title: "Settings: save",
		description:
			"Used by the plugin settings page to save your default workspace. Not called by the assistant.",
		inputSchema: {
			type: "object",
			properties: {
				set: {
					type: "object",
					properties: { defaultWorkspace: { type: "string" } },
					minProperties: 1,
					additionalProperties: false,
				},
			},
			required: ["set"],
			additionalProperties: false,
		},
		outputSchema: {
			type: "object",
			properties: { values: { type: "object" } },
			required: ["values"],
		},
		meta: APP_ONLY,
		run: async (client, args, { userId }) => {
			const slug = (args.set as { defaultWorkspace?: string }).defaultWorkspace;
			const workspaces = await client.listMyOrganizations();
			if (!workspaces.some((org) => org.slug === slug)) {
				throw new McpToolError(`No workspace "${slug}".`);
			}
			await sqlClient`
				INSERT INTO mcp_user_setting (user_id, default_workspace, updated_at)
				VALUES (${userId}, ${slug ?? null}, now())
				ON CONFLICT (user_id) DO UPDATE
				SET default_workspace = EXCLUDED.default_workspace, updated_at = now()
			`;
			return { values: { defaultWorkspace: slug } };
		},
	},
	{
		name: "mention_sessions",
		annotations: READ_ONLY,
		title: "Sessions: @-mention search",
		description:
			"Used by the chat to suggest your recent sessions when you type @. Not called by the assistant.",
		inputSchema: {
			type: "object",
			properties: { query: { type: "string" } },
			required: ["query"],
		},
		meta: { ...APP_ONLY, "openai/extensions": { "mentions/search": {} } },
		run: async (client, args, { userId, workspace }) => {
			const words = `${args.query ?? ""}`.toLowerCase().split(/\s+/u);
			// Only the user's own sessions: members cannot open colleagues' ones.
			const sessions = await client.analytics.sessions.list({
				days: 90,
				limit: 100,
				userId,
			});
			return {
				items: sessions
					.map((session) => ({
						session,
						label: [
							session.repository ?? session.project_path,
							session.git_branch,
							new Date(session.session_date).toUTCString().slice(5, 22),
							session.model_used,
						]
							.filter(Boolean)
							.join(" · "),
					}))
					.filter(({ label }) =>
						words.every((word) => label.toLowerCase().includes(word)),
					)
					.slice(0, 20)
					.map(({ session, label }) => ({
						type: "resource_link",
						uri: sessionResourceUri(workspace.slug, session.session_id),
						name: label,
						mimeType: "text/plain",
					})),
			};
		},
	},
];

export const SESSION_RESOURCE_PREFIX = "opaline://sessions/";

export function sessionResourceUri(workspace: string, sessionId: string) {
	return `${SESSION_RESOURCE_PREFIX}${encodeURIComponent(workspace)}/${encodeURIComponent(sessionId)}`;
}

/**
 * Where the log is off, its message tells the agent to go on with find and
 * read: a plain result, not a failed call.
 */
function withLogOffMessage(result: Promise<string>) {
	return result.catch((error: unknown) => {
		if (error instanceof ORPCError && error.code === "PRECONDITION_FAILED")
			return error.message;
		throw error;
	});
}

async function writeAnalysis(client: Client, action: unknown, args: Args) {
	const history = client.analysis.history;
	if (action === "share") {
		const shared = await history.share(
			parseMcpInput(AnalysisHistoryShareInputSchema, args),
		);
		return `analysis=${shared.analysis} shared=${shared.shared}`;
	}
	const saved = await history.save(
		parseMcpInput(AnalysisHistorySaveInputSchema, args),
	);
	return `saved analysis=${saved.analysis} status=${saved.status}`;
}

async function readAnalyses(client: Client, action: unknown, args: Args) {
	const history = client.analysis.history;
	switch (action) {
		case "get":
			return renderAnalysisTree(
				await history.get(parseMcpInput(AnalysisHistoryGetInputSchema, args)),
			);
		case "query":
			return renderStoredQuery(
				await history.query(
					parseMcpInput(AnalysisHistoryQueryInputSchema, args),
				),
			);
		default:
			return renderAnalysisSearch(
				await history.search(
					parseMcpInput(AnalysisHistorySearchInputSchema, args),
				),
			);
	}
}

type SessionOverview = Awaited<
	ReturnType<Client["analytics"]["sessions"]["detailOverview"]>
>;

/**
 * The overview without what only the web app uses: event ids it scrolls to
 * and the signal classifier version.
 */
function withoutRenderIds(overview: SessionOverview) {
	const { signalScanVersion: _version, ...activityTotals } =
		overview.activityTotals;
	return {
		...overview,
		activityTotals,
		turnPage: {
			...overview.turnPage,
			items: overview.turnPage.items.map((turn) => ({
				...turn,
				fileEvents: turn.fileEvents?.map(({ eventId: _id, ...event }) => event),
				subagentEvents: turn.subagentEvents?.map(
					({ eventId: _id, ...event }) => event,
				),
			})),
		},
	};
}

/**
 * What the plugin app renders about people: member names, avatars and roles,
 * and the caller's name and avatar on the account button. Emails and the rest
 * of the account record stay out.
 */
async function readPluginBootstrap(client: Client, context: McpToolContext) {
	const organizations = await client.listMyOrganizations();
	const organization = organizations.find(
		(org) => org.id === context.workspace.id,
	);
	const { user, session } = context.authSession;
	if (!organization || !user || !session)
		throw new McpToolError("Workspace not available.");
	const members = await sqlClient<
		{
			id: string;
			userId: string;
			role: string;
			user: { id: string; name: string; image: string | null };
		}[]
	>`
		SELECT m.id, m.user_id AS "userId", m.role,
			json_build_object('id', u.id, 'name', u.name, 'image', u.image) AS "user"
		FROM member m JOIN "user" u ON u.id = m.user_id
		WHERE m.organization_id = ${organization.id}
	`;
	return {
		session: {
			user: { id: user.id, name: user.name, image: user.image ?? null },
			session: {
				id: session.id,
				userId: session.userId,
				activeOrganizationId: organization.id,
				expiresAt: session.expiresAt,
			},
		},
		organization: { ...organization, members, invitations: [] },
		member: members.find((member) => member.userId === context.userId),
	};
}
