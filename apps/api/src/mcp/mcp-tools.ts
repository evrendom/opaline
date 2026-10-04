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
import { compactSkills } from "./skill-summaries.js";

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
const integer = (description: string): JsonSchema => ({
	type: "integer",
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
const DAYS = integer("Look back this many days (default 7, max 365).");
/** Tools only the widget or the host UI call; hidden from the model. */
export const APP_ONLY = { ui: { visibility: ["app"] } };
const isoDay = (offsetDays = 0) =>
	new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

function input(properties: JsonSchema = {}, required: string[] = []) {
	return {
		type: "object",
		properties: {
			workspace: string(
				"Workspace slug from list_workspaces. Defaults to the default workspace in the plugin settings, else the one the user last opened in Opaline.",
			),
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

/** One tool for the analysis log; `action` selects the history procedure. */
const AnalysesToolInputSchema = z
	.object({
		action: z
			.enum(["search", "get", "query", "save", "share"])
			.default("search"),
		...AnalysisHistorySearchInputSchema.partial().shape,
		...AnalysisHistorySaveInputSchema.partial().shape,
		...AnalysisHistoryQueryInputSchema.partial().shape,
		...AnalysisHistoryShareInputSchema.partial().shape,
	})
	.strict();

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

export const MCP_TOOLS: readonly McpTool[] = [
	{
		name: "find",
		title: "Find runs and deterministic events",
		description: [
			"Where did something happen in the user's agent runs? Cheap and deterministic: call it before read. Answers say where, never why; why needs read.",
			"A run is one user prompt and everything the agent did until the next prompt. A ref is {sessionId, agentId, turn}: agentId '' (the default) is the main transcript, otherwise a subagent; turn starts at 1.",
			"Scope: from/to (UTC days, default last 7) and/or latest=N (the newest N sessions in that range). Members see their own sessions; admins can pass userId.",
			"source=runs: one row per run with minutes, cost, edits, failed calls, not-found reads/searches, the next prompt's reaction and raw chars (what reading it costs). groupBy gives totals for trends. refs returns only those runs plus their summed minutes and cost: use it to price runs you read.",
			"source=tool: failed tool calls grouped by tool group, cause and detail, with example refs. Each failure belongs to its own run.",
			"source=user: every negative or swearing user prompt and every agent apology, each with its origin run: for a prompt, the run before it; for an apology, the run the user was correcting (its own run if there is none). Matches are word-list candidates; quoted or pasted text can match too.",
			"kind=friction: a hook or policy blocked the call. kind=mistake: the agent's wrong assumption (wrong path, stale patch, bad flag). kind=validation: tests, typecheck, lint or build rejected the code. kind=environment: missing dependency, service or credential. kind=noise: an expected non-zero exit such as a search with no hits; hidden unless includeNoise. kind=other: no rule matched.",
			"The header states coverage (sessions in scope vs indexed) and how many runs are unpriced; repeat it in the answer.",
			"Pages: limit rows, groups or events per call (default 50, 20 for source=tool, max 200). When more follow, the header has a 'more: pass cursor=…' line: call again with the same arguments plus that cursor instead of splitting the date range.",
			"Analysis log: on the first call of an analysis pass question = the asker's exact question; afterwards pass analysis = the id from the trace line, and step = the sub-question this call answers (or an existing step id, with parentStep for a follow-up). Every call is stored with its exact result.",
		].join("\n"),
		inputSchema: zodToolInput(AnalysisFindInputSchema),
		run: async (client, { workspace: _workspace, ...args }) =>
			renderFind(
				await client.analysis.find(
					parseMcpInput(AnalysisFindInputSchema, args),
				),
			),
	},
	{
		name: "read",
		title: "Read selected runs",
		description: [
			"Read specific runs (1-10 refs from find) to see what actually happened. This is where tokens go: read only the runs that fit the question, never a whole session run by run.",
			"maxChars (default 12000, max 40000) is shared across all refs; [cut] marks what was left out.",
			"depth=exchange (default): the user's prompt, files the agent edited, checks it ran after its last edit and whether they passed, failed calls with their error line, its final message, and the user's next prompt.",
			"depth=turn: every record of the run, compact.",
			"depth=record: the exact text of one record of one run (record index from turn or find), optionally a fromChar/toChar slice. Use it to quote evidence.",
			"Analysis log: on the first call of an analysis pass question = the asker's exact question; afterwards pass analysis = the id from the trace line, and step = the sub-question this call answers (or an existing step id, with parentStep for a follow-up). Every call is stored with its exact result.",
		].join("\n"),
		inputSchema: zodToolInput(AnalysisReadInputSchema),
		run: async (client, { workspace: _workspace, ...args }) =>
			renderRead(
				await client.analysis.read(
					parseMcpInput(AnalysisReadInputSchema, args),
				),
			),
	},
	{
		name: "analyses",
		title: "Past analyses",
		description: [
			"The analysis log: questions asked before, the steps taken and the final answers. Call action=search before analysing anything; if a past analysis matches, get it and update it from its cutoff instead of starting over.",
			"action=search: past analyses by meaning (text) or most recent (no text); yours plus ones shared with the workspace.",
			"action=get: one analysis as its path: question, steps (sub-question, finding, the asker's reply, query ids) and final answer.",
			"action=query: the exact stored result of one query, flagged stale when a session it read has changed. Open one only to check or quote a specific step; replaying every query costs as much as redoing the analysis.",
			"action=save: once, just before your last message, which must repeat the saved final answer in full: the final answer, a finding per step (step = id from its trace line or its exact sub-question), clarifications you asked the asker (question + reply), up to 8 topics, and updates = the analysis this one updates.",
			"action=share: share an analysis with the workspace (or stop sharing). Results quoting others' sessions stay readable only by their owners and admins.",
		].join("\n"),
		inputSchema: zodToolInput(AnalysesToolInputSchema),
		run: (client, { workspace: _workspace, action, ...args }) =>
			// Where the log is off, its message tells the agent to go on with
			// find and read: a plain result, not a failed call.
			runAnalysesAction(client, action, args).catch((error: unknown) => {
				if (error instanceof ORPCError && error.code === "PRECONDITION_FAILED")
					return error.message;
				throw error;
			}),
	},
	{
		name: "list_workspaces",
		title: "List workspaces",
		description:
			"Lists the Opaline workspaces the user belongs to. Pass a slug as `workspace` to any other tool.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		run: (client) => client.listMyOrganizations(),
	},
	{
		name: "get_dashboard",
		title: "Opaline",
		description:
			"The Opaline dashboard: total and daily trend of agent cost (USD), sessions, signals, agent runs, merged pull requests or CI failures per PR for a date range (default: the last 30 days), with the top members, repositories, models and other breakdowns. Filter by member user IDs, repository names or models, or split the trend by a dimension.",
		inputSchema: input({
			startDate: date("First day (default 30 days ago)"),
			endDate: date(
				"Last day (default today), at most one year after startDate",
			),
			metric: oneOf(DASHBOARD_METRICS, "Metric to chart (default cost)."),
			splitBy: oneOf(SPLITS, "Split the trend into series by this dimension."),
			members: strings("Only these member user IDs (from get_team)."),
			repositories: strings("Only these repositories."),
			models: strings("Only these models."),
		}),
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
		name: "get_kpis",
		title: "Get headline KPIs",
		description:
			"Headline counts for a date range: sessions, active members, projects, subagents, skills and slash commands.",
		inputSchema: input(
			{ startDate: date("First day"), endDate: date("Last day") },
			["startDate", "endDate"],
		),
		run: (client, args) =>
			client.analytics.overview.kpis({
				startDate: args.startDate as string,
				endDate: args.endDate as string,
			}),
	},
	{
		name: "list_sessions",
		title: "List sessions",
		description:
			"Lists Claude Code and Codex sessions in the workspace, newest first, with repository, branch, model, tokens, cost and duration. Filter by member, repository, skill or agent.",
		inputSchema: input({
			days: DAYS,
			startDate: date(
				"Optional first day; replaces days together with endDate",
			),
			endDate: date("Optional last day"),
			userId: string("Only sessions of this member user ID."),
			repository: string("Only sessions in this repository."),
			skillName: string("Only sessions that used this skill."),
			source: oneOf(["claude_code", "codex"], "Only sessions from this agent."),
			sortBy: oneOf(
				["session_date", "duration_min", "total_tokens"],
				"Sort column (default session_date).",
			),
			sortOrder: oneOf(["asc", "desc"], "Sort order (default desc)."),
			limit: integer("Page size (default 25, max 100)."),
			offset: integer("Rows to skip for paging."),
		}),
		run: async (client, { workspace: _, limit, ...args }) => {
			const sessions = await client.analytics.sessions.list({
				...args,
				limit: Math.min((limit as number | undefined) ?? 25, 100),
			} as Parameters<Client["analytics"]["sessions"]["list"]>[0]);
			// Only what answers "which sessions": not every analytics column.
			return sessions.map((session) => ({
				session_id: session.session_id,
				user_id: session.user_id,
				date: session.session_date,
				repository: session.repository ?? session.project_path,
				branch: session.git_branch,
				agent: session.source,
				model: session.model_used,
				duration_min: session.duration_min,
				total_tokens: session.total_tokens,
				estimated_cost_usd: session.estimated_cost,
				errors: session.error_count,
				subagents: session.subagent_count,
				skills: session.skills,
				has_commit: session.has_commit,
			}));
		},
		link: () => "/sessions",
	},
	{
		name: "get_session",
		title: "Get session",
		description:
			"One session's summary, activity totals, subagents and its turns (each with an ID for read_session_turn). Only the session owner and workspace admins can open a session.",
		inputSchema: input(
			{
				sessionId: string("Session ID from list_sessions."),
				turnCursor: string(
					"Cursor from a previous call to page through turns.",
				),
			},
			["sessionId"],
		),
		run: (client, args) =>
			client.analytics.sessions.detailOverview({
				sessionId: args.sessionId as string,
				...(args.turnCursor ? { turnCursor: args.turnCursor as string } : {}),
			}),
		link: (args) => `/sessions/${encodeURIComponent(`${args.sessionId}`)}`,
	},
	{
		name: "read_session_turn",
		title: "Read session turn",
		description:
			"The full content of one turn: the user's prompt and the agent's messages, tool calls and results.",
		inputSchema: input(
			{
				sessionId: string("Session ID."),
				revision: string("The `revision` value returned by get_session."),
				turnId: string("Turn ID from get_session."),
			},
			["sessionId", "revision", "turnId"],
		),
		run: (client, args) =>
			client.analytics.sessions.detailTurn({
				sessionId: args.sessionId as string,
				revision: args.revision as string,
				turnId: args.turnId as string,
			}),
		link: (args) => `/sessions/${encodeURIComponent(`${args.sessionId}`)}`,
	},
	{
		name: "get_team",
		title: "Get team",
		description:
			"Workspace members with their sessions, cost, tokens and activity trend over the last N days. Member IDs work as filters in other tools.",
		inputSchema: input({ days: DAYS }),
		run: (client, args) =>
			client.analytics.developers.teamCards({
				days: (args.days as number | undefined) ?? 7,
			}),
		link: () => "/team",
	},
	{
		name: "list_skills",
		title: "List skills",
		description:
			"Skills used in the workspace with session counts, version counts, users and top repositories. For a skill's content and versions use get_skill.",
		inputSchema: input(),
		run: async (client) => compactSkills(await client.analytics.skills.list()),
		link: () => "/skills",
	},
	{
		name: "get_skill",
		title: "Get skill",
		description: "One skill's content, versions and usage.",
		inputSchema: input({ name: string("Skill name from list_skills.") }, [
			"name",
		]),
		run: (client, args) =>
			client.analytics.skills.detail({ name: args.name as string }),
		link: (args) => `/skills${query(args, { name: "skill" })}`,
	},
	{
		name: "list_repositories",
		title: "List repositories",
		description:
			"Repositories agents worked in, with sessions, cost and last activity.",
		inputSchema: input(),
		run: (client) => client.analytics.repositories.list(),
		link: () => "/repos",
	},
	{
		name: "get_repository",
		title: "Get repository",
		description:
			"Skills used in one repository. For its sessions use list_sessions with `repository`.",
		inputSchema: input(
			{ repoKey: string("Repository key from list_repositories.") },
			["repoKey"],
		),
		run: async (client, args) => {
			const { skills } = await client.analytics.repositories.detail({
				repoKey: args.repoKey as string,
			});
			return { skills: compactSkills(skills) };
		},
		link: (args) => `/repos${query(args, { repoKey: "repo" })}`,
	},
	{
		name: "find_recurring_errors",
		title: "Find recurring errors",
		description:
			"Errors that keep recurring across sessions in the last N days, with how often and where they occurred. Use it to check whether a failure has been seen before.",
		inputSchema: input({
			days: DAYS,
			minOccurrences: integer("Minimum occurrences (default 2)."),
			limit: integer("Maximum errors (default 20)."),
		}),
		run: (client, { workspace: _, ...args }) =>
			client.analytics.errors.topRecurring(
				args as Parameters<Client["analytics"]["errors"]["topRecurring"]>[0],
			),
	},
	{
		name: "get_billing",
		title: "Get billing",
		description: "The workspace's plan, seats and usage limits.",
		inputSchema: input(),
		run: (client) => client.billing.current(),
		link: () => "/settings/workspace",
	},
	{
		name: "settings_read",
		title: "Read Opaline settings",
		description: "Settings shown on the Opaline plugin page.",
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
		title: "Update Opaline settings",
		description: "Saves settings changed on the Opaline plugin page.",
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
		title: "Sessions",
		description:
			"Finds recent sessions by repository, branch, model or date for @-mentions.",
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

async function runAnalysesAction(client: Client, action: unknown, args: Args) {
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
		case "save": {
			const saved = await history.save(
				parseMcpInput(AnalysisHistorySaveInputSchema, args),
			);
			return `saved analysis=${saved.analysis} status=${saved.status}`;
		}
		case "share": {
			const shared = await history.share(
				parseMcpInput(AnalysisHistoryShareInputSchema, args),
			);
			return `analysis=${shared.analysis} shared=${shared.shared}`;
		}
		default:
			return renderAnalysisSearch(
				await history.search(
					parseMcpInput(AnalysisHistorySearchInputSchema, args),
				),
			);
	}
}

async function readPluginBootstrap(client: Client, context: McpToolContext) {
	const organizations = await client.listMyOrganizations();
	const organization = organizations.find(
		(org) => org.id === context.workspace.id,
	);
	if (!organization || !context.authSession.user)
		throw new McpToolError("Workspace not available.");
	const members = await sqlClient<
		{
			id: string;
			userId: string;
			role: string;
			user: { id: string; name: string; email: string; image: string | null };
		}[]
	>`
		SELECT m.id, m.user_id AS "userId", m.role,
			json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'image', u.image) AS "user"
		FROM member m JOIN "user" u ON u.id = m.user_id
		WHERE m.organization_id = ${organization.id}
	`;
	return {
		session: context.authSession,
		organization: { ...organization, members, invitations: [] },
		member: members.find((member) => member.userId === context.userId),
	};
}
