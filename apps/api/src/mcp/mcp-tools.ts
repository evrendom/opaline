import { ORPCError, type RouterClient } from "@orpc/server";
import {
	AnalysisFindInputBaseSchema,
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
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import type { AppContext } from "../middleware.js";
import type { router } from "../router.js";
import { countVisibleSessions } from "../services/analysis/visible-sessions.js";
import { readSessionReader } from "../services/session-reader.service.js";
import { readsEverySession } from "../services/session-visibility.js";
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
	REPLACES_OWN_SETTING,
	SAVES_AND_INDEXES,
	SHARES_WITH_WORKSPACE,
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
/** Who sees a shared answer's stored results (`unavailableReason` in analysis-log.service.ts). */
export const SHARING_DISCLOSURE =
	"Sharing shows the answer, its findings and the stored results behind it (which can include short excerpts from the sessions that were read) to members of your workspace; a workspace limited to own sessions may show those results only to admins and the session's owner.";
export const EMBEDDING_DISCLOSURE =
	"OpenAI processes the title and topics to build the search index.";
const ANALYSIS_ID_DESCRIPTION =
	"Id of the answer being worked on, from an earlier result. Leave out to start a new one.";
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

/**
 * Keeps the requested metric with its trend and the top breakdown rows.
 * Member user ids never reach the model: per-member rows and series appear
 * only when the trend is split by member, and then by name alone.
 */
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
	const byMember = dashboard.splitBy === "members";
	const names = new Map(data.series.map(({ id, label }) => [id, label]));
	const key = (id: string) => (byMember ? (names.get(id) ?? id) : id);
	return {
		metric,
		availableMetrics: dashboard.availableMetrics,
		splitBy: dashboard.splitBy,
		total: ratio(data.total, data.denominator),
		incomplete: data.incomplete,
		series: byMember
			? data.series.map(({ label }) => ({ label }))
			: data.series,
		trend: data.trend.map(
			({ date, total, values, denominator, denominatorValues }) => ({
				date,
				total: ratio(total, denominator),
				...(dashboard.splitBy === "none"
					? {}
					: {
							values: Object.fromEntries(
								Object.entries(values).map(([id, value]) => [
									key(id),
									ratio(value, denominatorValues?.[id]),
								]),
							),
						}),
			}),
		),
		top: Object.fromEntries(
			Object.entries(data.breakdowns)
				.filter(
					([dimension, rows]) =>
						rows.length > 0 && (dimension !== "members" || byMember),
				)
				.map(([dimension, rows]) => [
					dimension,
					rows
						.slice(0, 10)
						.map(({ id, label, value }) =>
							dimension === "members" ? { label, value } : { id, label, value },
						),
				]),
		),
		...(data.durationStats ? { durationStats: data.durationStats } : {}),
	};
}

/** Breakdowns that name people: workspace members and GitHub authors. */
const PERSON_DIMENSIONS = ["members", "githubAuthors"] as const;

/**
 * The dashboard data the app's first view gets up front: totals, trends and
 * the repository and model breakdowns, without rows or series that name
 * people. The app loads those through its app-only costs tool when the user
 * opens them (`DeferredPersonRows` in the web app).
 */
export function withoutPersonRows(dashboard: CostDashboard): CostDashboard {
	const splitByPerson = (PERSON_DIMENSIONS as readonly string[]).includes(
		dashboard.splitBy,
	);
	return {
		...dashboard,
		metrics: Object.fromEntries(
			Object.entries(dashboard.metrics).map(([name, data]) => [
				name,
				data && {
					...data,
					breakdowns: {
						...data.breakdowns,
						...Object.fromEntries(
							PERSON_DIMENSIONS.map((dimension) => [dimension, []]),
						),
					},
					...(splitByPerson
						? {
								series: [],
								trend: data.trend.map(
									({
										values: _values,
										numeratorValues: _numerators,
										denominatorValues: _denominators,
										...point
									}) => ({ ...point, values: {} }),
								),
							}
						: {}),
				},
			]),
		) as CostDashboard["metrics"],
	};
}

const DASHBOARD_METRICS = CostDashboardRequestedMetricSchema.options;
const SPLITS = CostDashboardInputSchema.shape.splitBy.unwrap().options;

/**
 * find as the model sees it: the per-member filter stays out (admins have
 * the dashboard for per-member views). The procedure checks the rest.
 */
const FindToolInputSchema = AnalysisFindInputBaseSchema.omit({ userId: true });

/**
 * The plugin only shares: stopping sharing revokes access, which is not an
 * additive write, so it stays out of the plugin (the API keeps it).
 */
const ShareToolInputSchema = AnalysisHistoryShareInputSchema.omit({
	shared: true,
});

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
			"Returns: Period totals and runs, failure causes, unhappy prompts, git events, weekly totals or calls.",
			"Side effects: Saves what it found in the answer being worked on, deleted after 7 days if never saved. Nobody can see this unfinished answer, not even the user, until save_answer saves it.",
			"Limits: Every member sees every member's sessions in the workspace; 200 rows a call.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(FindToolInputSchema), {
			source:
				"Required. runs: one row per run with its time and cost. tool: failed tool calls grouped by cause. user: prompts where the user was unhappy with the agent (corrections, complaints) and agent apologies. git: commits, pushes, PR links and creations, CI status reads and Codex git metadata, each with the pull requests and CI runs GitHub links to it and whether CI was checked after a push; with pullRequest, the sessions that touched that pull request. weekly: per ISO week, member and agent, the sums of the runs' recorded facts (runs, sessions, minutes, cost and tokens, calls, failures, denials, interruptions, API errors, pushes, commits, PR links, MCP calls, skills), from a nightly snapshot; use it for trends over weeks or months and for before/after comparisons. calls: shell commands, Codex code-mode scripts and written script files, each with its program, first words, fingerprint (the same command with incidental values such as paths, numbers, ids and quoted strings replaced) and simhash (near-duplicate scripts), whether it failed, and its text.",
			from: "First day, YYYY-MM-DD (UTC). Default: 6 days before to (source=weekly: the 11 weeks before the week of to). For totals and rankings, use the start of the window the user asked for. source=weekly counts whole weeks from the Monday on or before it.",
			to: "Last day, YYYY-MM-DD (UTC). Default: today.",
			latest: "Only the newest N sessions in the date range, 1-200.",
			repository:
				"Only sessions in this repository (a name from the repository column). Not for source=weekly.",
			agent: "Only sessions from claude_code or codex. Default: both.",
			model:
				"Only runs that used this model id; cost then counts only that model. Not for source=calls: find those runs first and pass them.",
			sessionId: "Only this session and the subagents it started.",
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
			commandFrom:
				"source=calls only: command (a shell command, or a Codex code-mode script that runs exactly one), script (any other Codex code-mode script) or written (a script file a call wrote).",
			commandArgv0:
				"source=calls only: only commands that run this program, as in the argv0 column (git, bun, python3).",
			commandPrefix:
				"source=calls only: only commands with these first words, as in the prefix column (git push, gh pr).",
			commandFingerprint:
				"source=calls only: only calls with this fingerprint, copied from an earlier result.",
			commandSimhash:
				"source=calls only: only near-duplicates of a script, a simhash copied from an earlier result (calls whose simhash differs in at most 3 of 32 bits; texts under 20 words have none).",
			reaction:
				"source=user only: negative (unhappy prompts), swear (strongly worded complaints), apology (the agent apologized). Default: all three.",
			groupBy:
				"source=runs: totals per week, model, repository, agent or session instead of one row per run. source=weekly: totals per week, member or agent instead of one row per week, member and agent. source=calls: counts per commandFingerprint (the same command), commandArgv0 (program) or commandPrefix (first words), with failed calls and example texts.",
			refs: "Only these runs (at most 200), as given by an earlier result; with source=runs this returns their total time and cost.",
			"refs[].sessionId": "The run's session id.",
			"refs[].agentId":
				"Empty (default) for the main agent, else the subagent's id.",
			"refs[].turn": "The run's number in the session, from 1.",
			limit: "Rows per call, 1-200. Default 50, or 20 for source=tool.",
			sort: "source=runs order, biggest first: startedAt (default, newest first), minutes, costUsd, failedCalls or rawChars (size of the run's text).",
			cursor:
				"The value from an earlier result's 'more: pass cursor=…' line, to get the next page with the same other arguments.",
			pullRequest:
				"source=git only: a pull request as owner/name#number or its GitHub URL. Returns the events of every session that named it, pushed its head branch, or created, pushed or mentioned one of its commits, whatever their date unless from or to is given.",
			analysis: ANALYSIS_ID_DESCRIPTION,
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: async (client, { workspace: _workspace, ...args }) =>
			renderFind(
				await client.analysis.find(parseMcpInput(FindToolInputSchema, args)),
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
			"Side effects: Saves what it found in the answer being worked on, deleted after 7 days if never saved. Nobody can see this unfinished answer, not even the user, until save_answer saves it.",
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
			analysis: ANALYSIS_ID_DESCRIPTION,
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
		name: "search_answers",
		annotations: READ_ONLY,
		title: "Search saved answers",
		description: [
			"What it does: Lists answers your team saved about its coding-agent sessions, by meaning or most recent.",
			"Use when: Before analysing the team's agent sessions (cost, time, failures, mistakes), to find an answer to update; not for support, account, billing or general coding questions.",
			"Returns: A table of saved answers: id, question, last day of data, the answer each updates, and how each answer starts.",
			"Side effects: None.",
			"Limits: Only answers you saved or shared with your workspace; drafts never appear. Requires Opaline's answer history, which is on for every workspace.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(AnalysisHistorySearchInputSchema), {
			text: "Words to look for, matched by meaning (1-500 characters). Default: the most recent answers.",
			limit: "How many answers to return, 1-50. Default 10.",
			includeEval: "Also show answers from test runs. Default false.",
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: async (client, { workspace: _workspace, ...args }) =>
			withLogOffMessage(
				client.analysis.history
					.search(parseMcpInput(AnalysisHistorySearchInputSchema, args))
					.then(renderAnalysisSearch),
			),
	},
	{
		name: "get_answer",
		annotations: READ_ONLY,
		title: "Open a saved answer",
		description: [
			"What it does: Opens one saved answer with its findings, steps and final answer.",
			"Use when: search_answers found an answer that covers the question, so you can start from its findings.",
			"Returns: The question, the last day its data covers, the answer it updates and newer versions, each step with its finding and stored result ids, the changes against the older answer, and the final answer.",
			"Side effects: None.",
			"Limits: Only answers you saved or that were shared with your workspace.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(AnalysisHistoryGetInputSchema), {
			analysis: "Required. The saved answer's id, from search_answers.",
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: async (client, { workspace: _workspace, ...args }) =>
			withLogOffMessage(
				client.analysis.history
					.get(parseMcpInput(AnalysisHistoryGetInputSchema, args))
					.then(renderAnalysisTree),
			),
	},
	{
		name: "get_answer_evidence",
		annotations: READ_ONLY,
		title: "Open a stored result",
		description: [
			"What it does: Shows one stored find or read result behind a saved answer.",
			"Use when: You must check or quote one step of a saved answer; never open all of them.",
			"Returns: The stored result with its arguments, whether a session it read has changed since, or why it is unavailable (expired, removed or restricted).",
			"Side effects: None.",
			"Limits: Results expire after 90 days (a year when shared or pinned); a workspace limited to own sessions may show them only to admins and the session's owner.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(AnalysisHistoryQueryInputSchema), {
			query:
				"Required. A stored result's id, shown in the steps of get_answer.",
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: async (client, { workspace: _workspace, ...args }) =>
			withLogOffMessage(
				client.analysis.history
					.query(parseMcpInput(AnalysisHistoryQueryInputSchema, args))
					.then(renderStoredQuery),
			),
	},
	{
		name: "save_answer",
		annotations: SAVES_AND_INDEXES,
		title: "Save an answer",
		description: [
			"What it does: Saves the answer built from your find and read calls.",
			"Use when: Once, right before your final message.",
			"Returns: The saved answer's id.",
			`Side effects: Saves the answer in your Opaline workspace, visible only to you until shared. A saved answer is never changed or deleted by the plugin's tools; an update is a new answer linked to it. Nothing is published publicly or shared with other workspaces. ${EMBEDDING_DISCLOSURE}`,
			"Limits: Only the asker can save, once per answer. Requires Opaline's answer history, which is on for every workspace.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(AnalysisHistorySaveInputSchema), {
			analysis:
				"Required. The answer's id, from the 'analysis=' value at the end of a find or read result.",
			question:
				"Required. A short title, not the user's words, no personal data, up to 120 characters, e.g. 'Where our agents get stuck'.",
			finalAnswer:
				"Required. The complete final answer, up to 20000 characters.",
			findings: "One finding per step, at most 100. Default: none.",
			"findings[].step":
				"The step or query id from the 'analysis=… step=… query=…' line of the find or read call it comes from.",
			"findings[].finding": "What this step found, up to 4000 characters.",
			topics: "Up to 8 short topic words, used for search. Default: none.",
			updates:
				"Id of the saved answer this one updates, from search_answers. Default: none.",
			changes:
				"Only when updating an answer: one item for every finding saved now, plus a dropped item for each old finding that no longer holds.",
			"changes[].step":
				"The finding's step or query id; for dropped, a step or query id of the old answer.",
			"changes[].change":
				"confirmed, strengthened, weakened, new or dropped (compared with the old answer).",
			"changes[].evidence":
				"Short reason, with counts or dates, up to 500 characters.",
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: async (client, { workspace: _workspace, ...args }) =>
			withLogOffMessage(
				client.analysis.history
					.save(parseMcpInput(AnalysisHistorySaveInputSchema, args))
					.then(
						(saved) =>
							`saved analysis=${saved.analysis} status=${saved.status}`,
					),
			),
	},
	{
		name: "share_answer",
		annotations: SHARES_WITH_WORKSPACE,
		title: "Share an answer",
		description: [
			"What it does: Shares a saved answer with your workspace.",
			"Use when: Only when the user asks to share an answer.",
			"Returns: Confirmation that the answer is shared.",
			`Side effects: ${SHARING_DISCLOSURE} This tool only adds access; it never removes it.`,
			"Limits: Only the person who asked can share an answer, and only once it is saved.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(ShareToolInputSchema), {
			analysis: "Required. The saved answer's id, from save_answer.",
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: async (client, { workspace: _workspace, ...args }) =>
			withLogOffMessage(
				client.analysis.history
					.share({ ...parseMcpInput(ShareToolInputSchema, args), shared: true })
					.then(
						(shared) => `analysis=${shared.analysis} shared=${shared.shared}`,
					),
			),
	},
	{
		name: "list_workspaces",
		annotations: READ_ONLY,
		title: "List your workspaces",
		description: [
			"What it does: Lists the Opaline workspaces you belong to, with how many sessions you can see in each.",
			"Use when: Checking that Opaline is set up, an answer looks empty, the user names another team, or you need a workspace name for another tool.",
			"Returns: Each workspace's name, slug (the short name other tools take as workspace), logo, the number of sessions you can see from the last 365 days, and default: true on the one tools use when no workspace is given.",
			"Side effects: None.",
			"Limits: Only workspaces you are a member of; every member counts the whole team's sessions.",
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
			default: {
				type: "boolean",
				description:
					"True for the workspace tools use when no workspace is given.",
			},
			sessionsLast365Days: {
				type: "integer",
				description:
					"Sessions you can see from the last 365 days (the whole team's). A count only.",
			},
		}),
		// Tools take the slug; the internal organization id stays out.
		// list_workspaces takes no workspace, so the context holds the default.
		run: async (_client, _args, { userId, workspace }) => {
			const memberships = await sqlClient<
				{
					id: string;
					name: string;
					slug: string;
					logo: string | null;
					role: string;
					ownSessionsOnly: boolean;
				}[]
			>`
				SELECT o.id, o.name, o.slug, o.logo, m.role,
					o.own_sessions_only AS "ownSessionsOnly"
				FROM member m JOIN organization o ON o.id = m.organization_id
				WHERE m.user_id = ${userId}
				ORDER BY o.name
			`;
			const executor = getClickhouse();
			return Promise.all(
				memberships.map(
					async ({ id, name, slug, logo, role, ownSessionsOnly }) => ({
						name,
						slug,
						logo,
						default: id === workspace.id,
						sessionsLast365Days: await countVisibleSessions(
							executor,
							id,
							{ userId, role, ownSessionsOnly },
							365,
						),
					}),
				),
			);
		},
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
				series: {
					description:
						"The series of a split trend; split by member, names only.",
				},
				trend: {
					type: "array",
					description:
						"One entry per day: date, total and, when split, values per series.",
				},
				top: {
					type: "object",
					description:
						"Up to 10 rows (id, label, value) per breakdown; per-member rows (label and value only) appear only when splitBy is members.",
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
				// Member filters stay in the app: the model never sees member ids.
				members: [] as string[],
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
					dashboard: { input, data: withoutPersonRows(dashboard) },
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
		title: "Session: mention preview",
		description:
			"Used by Opaline to show a session the user mentioned with @. Members of the workspace only. Not called by the assistant.",
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
			"Used by the plugin settings page to load your default workspace. Reads only your own setting. Not called by the assistant.",
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
		// Replaces the default workspace setting.
		annotations: REPLACES_OWN_SETTING,
		title: "Settings: save",
		description:
			"Used by the plugin settings page to save your default workspace. Replaces the saved default workspace; only workspaces you belong to are accepted. Not called by the assistant.",
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
		name: "app_account",
		annotations: READ_ONLY,
		title: "Account: you",
		description:
			"Used by the Opaline dashboard to show your account button and mark the sessions that are yours. Only your own account. Not called by the assistant.",
		inputSchema: input(),
		meta: APP_ONLY,
		run: (client, _args, context) => readPluginAccount(client, context),
	},
	{
		name: "workspace_members",
		annotations: READ_ONLY,
		title: "Team: member names",
		description:
			"Used by the Opaline dashboard to load member names and pictures when a view shows them. Members of the workspace only. Not called by the assistant.",
		inputSchema: input(),
		meta: APP_ONLY,
		run: async (client, _args, { workspace }) => {
			const organizations = await client.listMyOrganizations();
			if (!organizations.some((org) => org.id === workspace.id))
				throw new McpToolError("Workspace not available.");
			return { members: await readWorkspaceMembers(workspace.id) };
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
			// The user's own recent sessions, the ones they mention most; a
			// teammate's session they mention opens too (get_session).
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
/** One workspace's members as the plugin app shows them: names, images and roles, no emails. */
async function readWorkspaceMembers(organizationId: string, userId?: string) {
	return sqlClient<
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
		WHERE m.organization_id = ${organizationId}
			${userId === undefined ? sqlClient`` : sqlClient`AND m.user_id = ${userId}`}
	`;
}

/**
 * What the dashboard's first view needs: the workspace (name, slug, logo).
 * Nothing about the caller or other members is sent up front: the app loads
 * the caller's account with `app_account` and the roster with
 * `workspace_members` when a view needs them.
 */
async function readPluginBootstrap(client: Client, context: McpToolContext) {
	const organizations = await client.listMyOrganizations();
	const organization = organizations.find(
		(org) => org.id === context.workspace.id,
	);
	if (!organization) throw new McpToolError("Workspace not available.");
	return {
		organization: { ...organization, members: [], invitations: [] },
	};
}

/**
 * The caller's account as the app shows it (account button, marking the
 * sessions that are the caller's, admin-only links, which sessions open):
 * id, name, image, role in the workspace and whether they read every
 * member's sessions. Authorization stays on the server for every procedure.
 */
async function readPluginAccount(client: Client, context: McpToolContext) {
	const { organization } = await readPluginBootstrap(client, context);
	const { user, session } = context.authSession;
	if (!user || !session) throw new McpToolError("Workspace not available.");
	const [[member], reader] = await Promise.all([
		readWorkspaceMembers(organization.id, context.userId),
		readSessionReader(organization.id, context.userId),
	]);
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
		member: member ?? null,
		readsEverySession: reader !== null && readsEverySession(reader),
	};
}
