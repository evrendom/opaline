import { ORPCError, type RouterClient } from "@orpc/server";
import {
	AnalysisFindInputBaseSchema,
	AnalysisHistoryGetInputSchema,
	AnalysisHistoryQueryInputSchema,
	AnalysisHistorySaveInputSchema,
	AnalysisHistorySearchInputSchema,
	AnalysisHistoryShareInputSchema,
	AnalysisReadInputSchema,
	AnalysisRunInputSchema,
	AnalysisSchemaInputSchema,
	AnalysisSearchInputSchema,
	AnalysisSqlInputSchema,
	CHECK_TARGETS,
	type CheckDefinition,
	ChecksCreateInputSchema,
	ChecksRunInputSchema,
	ChecksTestInputSchema,
	type CostDashboard,
	CostDashboardInputSchema,
	CostDashboardRequestedMetricSchema,
	MeasureDrillSchema,
	MeasureScopeSchema,
	MeasuresRunInputSchema,
	PATTERN_KINDS,
	PatternsDrillInputSchema,
	PatternsListInputSchema,
	PatternsVerifyInputSchema,
	RunQuestionsInputSchema,
	RunQuestionsRunInputSchema,
} from "@rudel/api-routes";
import { z } from "zod";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import type { AppContext } from "../middleware.js";
import type { router } from "../router.js";
import { retroToolsEnabled } from "../services/analysis/retro-tools.js";
import { SQL_RESULT_ID_PREFIX } from "../services/analysis/sql-results.js";
import { countVisibleSessions } from "../services/analysis/visible-sessions.js";
import { readSessionReader } from "../services/session-reader.service.js";
import { readsEverySession } from "../services/session-visibility.js";
import {
	renderAnalysisSearch,
	renderAnalysisTree,
	renderFind,
	renderQuestionsEstimate,
	renderQuestionsRun,
	renderRead,
	renderRun,
	renderSchema,
	renderSql,
	renderStoredQuery,
	renderStoredSqlResult,
} from "./analysis-renderers.js";
import { withAnalyticsInputs } from "./analytics-inputs.js";
import { sessionsUrl, sessionUrl, withUrlLine } from "./app-links.js";
import {
	cliHint,
	pullCommand,
	pullPatternCommand,
	sqlOutCommand,
} from "./cli-hint.js";
import { DASHBOARD_WIDGET_URI, OPALINE_ICON } from "./dashboard-widget.js";
import {
	FIND_DESCRIPTION,
	FIND_INPUT_DESCRIPTIONS,
	FIND_PUBLISHED_SORTS,
	FIND_RETRO_DESCRIPTION,
	FIND_RETRO_INPUT_DESCRIPTIONS,
} from "./find-description.js";
import { parseMcpInput } from "./input-validation.js";
import {
	FORMAT_INPUT,
	outputFormat,
	readJson,
	runJson,
} from "./json-output.js";
import {
	renderCheckCreate,
	renderCheckList,
	renderCheckResult,
	renderMeasureDescribe,
	renderMeasureList,
	renderMeasureRun,
	renderPatterns,
} from "./measure-renderers.js";
import {
	findPeek,
	measuresPeek,
	patternsPeek,
	searchPeek,
	sqlPeek,
	withPeek,
} from "./retro-extras.js";
import { RUN_URL_INPUT, runFromUrl, sessionOfRunId } from "./run-url.js";
import { renderSearch } from "./search-renderer.js";
import { agentFeedbackTool, mcpStatsTool } from "./self-analytics-tools.js";
import {
	type McpToolAnnotations,
	READ_ONLY,
	REPLACES_OWN_SETTING,
	SAVES_AND_INDEXES,
	SENDS_RUN_NOTES,
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
	readonly retroDescription?: string;
	readonly inputSchema: JsonSchema;
	readonly retroInputSchema?: JsonSchema;
	readonly outputSchema?: JsonSchema;
	/** Published in tools/list; must match what `run` does. */
	readonly annotations: McpToolAnnotations;
	/** `_meta` for tools/list; tools with it return structuredContent. */
	readonly meta?: Record<string, unknown>;
	readonly icons?: readonly unknown[];
	run(client: Client, args: Args, context: McpToolContext): Promise<unknown>;
	/** Path in the web app showing the same view, relative to the workspace. */
	link?(args: Args): string;
	readonly retroInputs?: Record<string, JsonSchema>;
	readonly retroInputDescriptions?: Record<string, string>;
	readonly recordsInput?: true;
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

const FindToolPublishedInputSchema = FindToolInputSchema.omit({
	parentSessionId: true,
	filters: true,
	offset: true,
	verbosity: true,
}).extend({ sort: z.enum(FIND_PUBLISHED_SORTS).default("startedAt") });

const RunToolInputSchema = AnalysisRunInputSchema.partial({ id: true });

/**
 * The plugin only shares: stopping sharing revokes access, which is not an
 * additive write, so it stays out of the plugin (the API keeps it).
 */
const ShareToolInputSchema = AnalysisHistoryShareInputSchema.omit({
	shared: true,
});

/**
 * answers: one tool for earlier analyses with an explicit action. Each action
 * takes only its own inputs; `answersInput` names what an action needs and
 * refuses another action's inputs.
 */
const AnswersToolInputSchema = z
	.object({
		action: z.enum(["search", "open", "result"]),
		text: z.string().min(1).max(500).optional(),
		limit: z.number().int().min(1).max(50).optional(),
		includeEval: z.boolean().optional(),
		analysis: z.string().min(1).max(40).optional(),
		id: z.string().min(1).max(40).optional(),
	})
	.strict();

type AnswersInput =
	| {
			action: "search";
			text?: string;
			limit?: number;
			includeEval?: boolean;
	  }
	| { action: "open"; analysis: string }
	| { action: "result"; id: string };

const ANSWERS_INPUTS = {
	search: ["text", "limit", "includeEval"],
	open: ["analysis"],
	result: ["id"],
} as const;

function answersInput(args: Args): AnswersInput {
	const input = parseMcpInput(AnswersToolInputSchema, args);
	const foreign = (
		["text", "limit", "includeEval", "analysis", "id"] as const
	).filter(
		(key) =>
			input[key] !== undefined &&
			!(ANSWERS_INPUTS[input.action] as readonly string[]).includes(key),
	);
	if (foreign.length)
		throw new ORPCError("BAD_REQUEST", {
			message: `${foreign.join(", ")} ${foreign.length > 1 ? "are not inputs" : "is not an input"} of action=${input.action}; it takes ${ANSWERS_INPUTS[input.action].join(", ")}`,
		});
	if (input.action === "open") {
		if (!input.analysis)
			throw new ORPCError("BAD_REQUEST", {
				message:
					"action=open needs analysis: the saved answer's id, from action=search",
			});
		return { action: "open", analysis: input.analysis };
	}
	if (input.action === "result") {
		if (!input.id)
			throw new ORPCError("BAD_REQUEST", {
				message:
					"action=result needs id: a stored result's id from action=open, or an sql result id (sr_…)",
			});
		return { action: "result", id: input.id };
	}
	return {
		action: "search",
		text: input.text,
		limit: input.limit,
		includeEval: input.includeEval,
	};
}

const linked = (url: string | undefined) => (text: string) =>
	url ? withUrlLine(text, url) : text;

function searchAnswers(
	client: Client,
	input: z.output<typeof AnalysisHistorySearchInputSchema>,
	url?: string,
): Promise<unknown> {
	return withLogOffMessage(
		client.analysis.history
			.search(input)
			.then(renderAnalysisSearch)
			.then(linked(url)),
	);
}

function openAnswer(
	client: Client,
	analysis: string,
	url?: string,
): Promise<unknown> {
	return withLogOffMessage(
		client.analysis.history
			.get({ analysis })
			.then(renderAnalysisTree)
			.then(linked(url)),
	);
}

/** A step's stored query by its id, or a stored sql result by its `sr_` id. */
function openResult(
	client: Client,
	id: string,
	url?: string,
): Promise<unknown> {
	if (id.startsWith(SQL_RESULT_ID_PREFIX))
		return client.analysis.history
			.sqlResult({ id })
			.then(renderStoredSqlResult)
			.then(linked(url));
	return withLogOffMessage(
		client.analysis.history
			.query({ query: id })
			.then(renderStoredQuery)
			.then(linked(url)),
	);
}

const MeasuresToolInputSchema = z
	.object({
		action: z.enum(["list", "describe", "run"]),
		name: z.string().trim().min(1).max(60).optional(),
		...MeasureScopeSchema.shape,
		limit: z.number().int().min(1).max(200).optional(),
		drill: MeasureDrillSchema.optional(),
		analysis: z.string().min(1).max(40).optional(),
	})
	.strict();

const MEASURES_INPUTS = {
	list: [],
	describe: ["name"],
	run: [
		"name",
		"from",
		"to",
		"repository",
		"latest",
		"sessions",
		"limit",
		"drill",
		"analysis",
	],
} as const;

const PatternsToolInputSchema = z
	.object({
		action: z.enum(["list", "drill", "verify"]),
		...MeasureScopeSchema.shape,
		kind: z.enum(PATTERN_KINDS).optional(),
		minCount: z.number().int().min(1).max(10_000).optional(),
		id: z.string().trim().min(1).max(40).optional(),
		since: z.string().date().optional(),
		limit: z.number().int().min(1).max(200).optional(),
		analysis: z.string().min(1).max(40).optional(),
	})
	.strict();

const PATTERN_SCOPE = [
	"from",
	"to",
	"repository",
	"latest",
	"sessions",
] as const;

const PATTERNS_INPUTS = {
	list: [...PATTERN_SCOPE, "kind", "minCount", "limit", "analysis"],
	drill: ["id", ...PATTERN_SCOPE, "limit", "analysis"],
	verify: [
		"id",
		...PATTERN_SCOPE,
		"kind",
		"minCount",
		"since",
		"limit",
		"analysis",
	],
} as const;

const ChecksToolInputSchema = z
	.object({
		action: z.enum(["test", "create", "list", "run"]),
		name: z.string().trim().min(1).max(120).optional(),
		where: z.string().trim().min(1).max(4_000).optional(),
		target: z.enum(CHECK_TARGETS).optional(),
		measure: z.string().trim().min(1).max(60).optional(),
		column: z.string().trim().min(1).max(60).optional(),
		min: z.number().finite().optional(),
		repository: MeasureScopeSchema.shape.repository,
		last: z.number().int().min(1).max(5_000).optional(),
		id: z.string().trim().min(1).max(40).optional(),
		from: z.string().date().optional(),
		to: z.string().date().optional(),
		analysis: z.string().min(1).max(40).optional(),
	})
	.strict();

const DEFINITION_INPUTS = [
	"where",
	"target",
	"measure",
	"column",
	"min",
	"repository",
] as const;

const CHECKS_INPUTS = {
	test: [...DEFINITION_INPUTS, "last", "analysis"],
	create: ["name", ...DEFINITION_INPUTS],
	list: [],
	run: ["id", "from", "to", "analysis"],
} as const;

function actionInput<
	T extends z.ZodObject,
	A extends Record<string, readonly string[]>,
>(schema: T, args: Args, inputs: A): z.output<T> & { action: keyof A } {
	const input = parseMcpInput(schema, args) as z.output<T> & {
		action: keyof A & string;
	};
	const allowed: readonly string[] = inputs[input.action] ?? [];
	const foreign = Object.keys(input).filter(
		(key) =>
			key !== "action" &&
			(input as Record<string, unknown>)[key] !== undefined &&
			!allowed.includes(key),
	);
	if (foreign.length)
		throw new ORPCError("BAD_REQUEST", {
			message: `${foreign.join(", ")} ${foreign.length > 1 ? "are not inputs" : "is not an input"} of action=${input.action}; it takes ${allowed.join(", ") || "nothing else"}`,
		});
	return input;
}

function required<T extends Record<string, unknown>>(
	input: T & { action: string },
	key: keyof T & string,
	what: string,
): string {
	const value = input[key];
	if (typeof value !== "string")
		throw new ORPCError("BAD_REQUEST", {
			message: `action=${input.action} needs ${key}: ${what}`,
		});
	return value;
}

function checkDefinition(
	input: z.output<typeof ChecksToolInputSchema>,
): CheckDefinition {
	if (input.where !== undefined && input.measure !== undefined)
		throw new ORPCError("BAD_REQUEST", {
			message: "give where or measure, not both",
		});
	if (input.where !== undefined) {
		if (input.column !== undefined || input.min !== undefined)
			throw new ORPCError("BAD_REQUEST", {
				message: "column and min go with measure, not where",
			});
		return {
			kind: "runs",
			where: input.where,
			target: input.target ?? "run",
		};
	}
	if (input.measure === undefined)
		throw new ORPCError("BAD_REQUEST", {
			message: `action=${input.action} needs where (a condition over runs) or measure with column and min`,
		});
	if (input.column === undefined || input.min === undefined)
		throw new ORPCError("BAD_REQUEST", {
			message: "measure needs column and min",
		});
	if (input.target !== undefined)
		throw new ORPCError("BAD_REQUEST", {
			message: "target goes with where; a measure's rows are its own",
		});
	return {
		kind: "measure",
		measure: input.measure,
		column: input.column,
		min: input.min,
		...(input.repository ? { repository: input.repository } : {}),
	};
}

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

export function retroListedTool(tool: McpTool) {
	const listed = listedTool(tool);
	return isAppOnlyTool(tool)
		? listed
		: {
				...listed,
				description: tool.retroDescription ?? tool.description,
				annotations: { title: tool.title, ...tool.annotations },
				inputSchema: withAnalyticsInputs(
					withDescriptions(
						tool.retroInputSchema ?? tool.inputSchema,
						tool.retroInputDescriptions,
					),
					tool.retroInputs,
				),
			};
}

function withDescriptions(
	schema: JsonSchema,
	descriptions: Record<string, string> = {},
): JsonSchema {
	const properties = schema.properties as Record<string, JsonSchema>;
	return {
		...schema,
		properties: Object.fromEntries(
			Object.entries(properties).map(([key, property]) => [
				key,
				descriptions[key]
					? { ...property, description: descriptions[key] }
					: property,
			]),
		),
	};
}

export function isAppOnlyTool(tool: Pick<McpTool, "meta">): boolean {
	const ui = tool.meta?.ui as { visibility?: unknown } | undefined;
	return Array.isArray(ui?.visibility) && ui.visibility.includes("app");
}

/** A tool as `tools/list` publishes it; `annotations.title` repeats its title. */
export function listedTool(tool: McpTool) {
	const { idempotentHint: _retroOnly, ...annotations } = tool.annotations;
	return {
		name: tool.name,
		title: tool.title,
		description: tool.description,
		inputSchema: tool.inputSchema,
		...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
		...(tool.icons ? { icons: tool.icons } : {}),
		annotations: { title: tool.title, ...annotations },
		...(tool.meta ? { _meta: tool.meta } : {}),
	};
}

export const MCP_TOOLS: readonly McpTool[] = [
	withPeek(
		{
			name: "find",
			annotations: WRITES_OWN_RECORDS,
			title: "Find patterns in agent runs",
			description: FIND_DESCRIPTION,
			retroDescription: FIND_RETRO_DESCRIPTION,
			inputSchema: describeInput(zodToolInput(FindToolPublishedInputSchema), {
				...FIND_INPUT_DESCRIPTIONS,
				analysis: ANALYSIS_ID_DESCRIPTION,
				workspace: WORKSPACE_DESCRIPTION,
			}),
			retroInputSchema: describeInput(zodToolInput(FindToolInputSchema), {
				...FIND_RETRO_INPUT_DESCRIPTIONS,
				analysis: ANALYSIS_ID_DESCRIPTION,
				workspace: WORKSPACE_DESCRIPTION,
			}),
			run: async (client, { workspace: _workspace, ...args }, context) => {
				const input = parseMcpInput(FindToolInputSchema, args);
				const output = await client.analysis.find(input);
				const session = input.sessionId ?? input.parentSessionId;
				const url = session
					? sessionUrl(context.workspace.slug, session)
					: sessionsUrl(context.workspace.slug, output.header);
				const text = withUrlLine(renderFind(output, input.verbosity), url);
				if (!output.header.cursor || !retroToolsEnabled(context.workspace.id))
					return text;
				const lines = text.split("\n");
				lines.splice(
					-1,
					0,
					cliHint(
						pullCommand({ repository: input.repository, ...output.header }),
					),
				);
				return lines.join("\n");
			},
		},
		findPeek,
	),

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
		retroInputs: { format: FORMAT_INPUT },
		run: async (
			client,
			{ workspace: _workspace, format, ...args },
			context,
		) => {
			const json = outputFormat(format) === "json";
			const output = await client.analysis.read(
				parseMcpInput(AnalysisReadInputSchema, args),
			);
			const urlOf = (sessionId: string) =>
				sessionUrl(context.workspace.slug, sessionId);
			if (json) return readJson(output, urlOf);
			const sessions = [
				...new Set(output.reads.map((read) => read.ref.sessionId)),
			];
			return sessions.reduceRight(
				(text, sessionId) => withUrlLine(text, urlOf(sessionId)),
				renderRead(output),
			);
		},
	},

	{
		name: "run",
		annotations: READ_ONLY,
		title: "Open one agent run",
		description: [
			"What it does: Shows one run compactly: its prompt, time, tokens and cost, how the run before it ended, how it ended, the user's next prompt, the setup it received and its phases.",
			"Use when: After sql or find points at a run; open only the parts that decide the question.",
			"Returns: Lines with ids. Phases open into requests, requests into calls; calls, records and setup into the exact text (setup at the version the run used); a subagent call into its run.",
			"Side effects: None.",
			"Limits: One run per call, within maxChars (the text says what was cut); sql's 10 seconds, 512 MiB and workspace quota.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(RunToolInputSchema), {
			id: "The run's id (required unless url is given): the run_id column of sql, or an id a run view shows (PREV, NEXT, a subagent run). Or a record's own id from a Claude Code transcript (the uuid of its JSONL line): opens the run that holds the record with the record expanded, and says its session, stream, record and run number. Sessions indexed before transcript parser 12 keep no record ids: there it is unknown, not missing.",
			expand:
				"Ids from the view to open, together within maxChars: phases (p2), requests (q153), calls (c154), records (r160) and setup (s2).",
			sections:
				"Only these sections, in the view's order: header, prev, end, next, setup, phases. Default: all of them.",
			maxChars: "Most characters returned, 1000-40000. Default 12000.",
			workspace: WORKSPACE_DESCRIPTION,
		}),
		retroInputs: { url: RUN_URL_INPUT, format: FORMAT_INPUT },
		run: async (
			client,
			{ workspace: _workspace, format, url, ...args },
			context,
		) => {
			const json = outputFormat(format) === "json";
			const pasted = runFromUrl(url, args);
			if (pasted.hint !== null) return pasted.hint;
			const output = await client.analysis.run(
				parseMcpInput(AnalysisRunInputSchema, pasted.args),
			);
			const sessionId = output.ref?.sessionId ?? sessionOfRunId(output.id);
			const link = sessionId
				? sessionUrl(context.workspace.slug, sessionId)
				: null;
			if (json) return runJson(output, link);
			const text = renderRun(output);
			return link ? withUrlLine(text, link) : text;
		},
	},

	{
		name: "schema",
		annotations: READ_ONLY,
		title: "Describe the data sql can read",
		description: [
			"What it does: Describes the views sql reads, step by step: the views, then one view's columns with their meaning and traps, then a column's most common values.",
			"Use when: Before writing sql, and whenever a column's meaning or values are unclear.",
			"Returns: The views; or one view's columns with meaning and traps; or one column's 20 most common values over the last 30 days.",
			"Side effects: None.",
			"Limits: Values come only from your workspace's sessions you may open.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(AnalysisSchemaInputSchema), {
			view: "A view from the list, e.g. runs. Leave out to list the views.",
			column:
				"A column of that view, to list its most common values. Needs view.",
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: async (client, { workspace: _workspace, ...args }) =>
			renderSchema(
				await client.analysis.schema(
					parseMcpInput(AnalysisSchemaInputSchema, args),
				),
			),
	},
	withPeek(
		{
			name: "sql",
			annotations: WRITES_OWN_RECORDS,
			title: "Rank and count agent runs with SQL",
			description: [
				"What it does: Runs one read-only SELECT over the views schema lists, to rank, count and compare runs.",
				"Use when: To rank where time, cost or failures went, then read the top runs; rows are not evidence.",
				"Returns: Up to 200 rows, a stored result id, and notes on what was cut.",
				"Side effects: Stores the result for 90 days and adds it to the answer being worked on, deleted after 7 days if never saved. Nobody can see this unfinished answer, not even the user, until save_answer saves it.",
				"Limits: Your workspace's sessions you may open; 10 seconds, 512 MiB, a workspace quota that run calls count in too.",
				"",
				'Data: no bulk export here. When the rows you need do not fit, aggregate in SQL; to compute on every row, the result names the opaline CLI command that writes them to a file (opaline sql "<query>" --out rows.jsonl) where a shell has the CLI.',
			].join("\n"),
			inputSchema: describeInput(zodToolInput(AnalysisSqlInputSchema), {
				query:
					"Required. One SELECT (or WITH … SELECT) over the views schema lists, e.g. FROM runs. The server adds the workspace; never filter by it.",
				title:
					"Required. What the result shows, as a short label of up to 120 characters, e.g. 'Longest runs, last 30 days'.",
				analysis: ANALYSIS_ID_DESCRIPTION,
				workspace: WORKSPACE_DESCRIPTION,
			}),
			run: async (client, { workspace: _workspace, ...args }, context) => {
				const output = await client.analysis.sql(
					parseMcpInput(AnalysisSqlInputSchema, args),
				);
				const text = withUrlLine(
					renderSql(output),
					sessionsUrl(context.workspace.slug),
				);
				return output.truncated
					? `${text}\n${cliHint(sqlOutCommand(output.query))}`
					: text;
			},
		},
		sqlPeek,
	),

	withPeek(
		{
			name: "measures",
			annotations: WRITES_OWN_RECORDS,
			title: "Run approved retro measures",
			description: [
				"What it does: Runs approved retro measures in one call: time lost by cause, local pass then CI fail, files hunted before editing, instruction cost, repeated commands and corrections.",
				"Use when: Before writing sql for a retro, same window and scope for each; for the sessions behind a row, use drill, not one find per session.",
				"Returns: list, describe: names, definitions, SQL. run: a ranked table with runs to open; drill: the sessions behind a row.",
				"Side effects: run stores its result like sql, in the answer being worked on.",
				"Limits: Each run is one sql query (10 seconds, 512 MiB, workspace quota).",
				"",
				"Drill: copy the row's key columns: time_lost_by_cause {kind, cause}, repeated_commands {family}, files_hunted_before_edit {file}, local_pass_then_ci_fail {outcome}. cohort and repeated_corrections rows are sessions already; instruction_cost takes no drill. Each session row has session_id, repository, started_at, rows_matched, first_seen, last_seen, group_run_time, group_call_time, failed_calls and an example run (agent_id, turn_idx).",
				"",
				"Examples:",
				'- Time lost by cause over a month: {"action":"run","name":"time_lost_by_cause","from":"2026-10-06","to":"2026-11-03"}',
				'- The sessions behind one of its rows: {"action":"run","name":"time_lost_by_cause","from":"2026-10-06","to":"2026-11-03","drill":{"kind":"validation","cause":"typecheck: tsc"}}',
				"",
				"Reminders:",
				"- To list the sessions behind a group, use drill (or find groupBy=session) instead of calling once per session.",
				"- No bulk export here: for your own definition over many sessions, pull them with the opaline CLI command a cut result names (opaline pull --repo … --from … --to …) where a shell has the CLI.",
				"- Keep the same from, to, repository and latest when you drill, so the sessions add up to the row.",
				"- When a failure keeps happening, offer to save it as a check.",
			].join("\n"),
			inputSchema: describeInput(zodToolInput(MeasuresToolInputSchema), {
				action:
					"Required. list: every measure. describe: one measure's definition, columns, traps and SQL. run: run one measure.",
				name: "action=describe or run, required: a measure name from action=list, e.g. time_lost_by_cause.",
				from: "action=run: first day the sessions started, YYYY-MM-DD (UTC). Default: 29 days before to.",
				to: "action=run: last day the sessions started, YYYY-MM-DD (UTC). Default: today.",
				repository:
					"action=run: only sessions of this repository, its full value or the part after the last slash (athena).",
				latest:
					"action=run: only the newest N sessions by start time, 1-500, e.g. 50 for the last 50 sessions.",
				sessions: "action=run: only these session ids, up to 200.",
				limit: "action=run: rows to return, 1-200. Default 50.",
				drill:
					"action=run: one row of this measure's result by its key columns, copied from that row (see Drill above); returns the sessions behind it, one row each.",
				analysis: ANALYSIS_ID_DESCRIPTION,
				workspace: WORKSPACE_DESCRIPTION,
			}),
			run: async (client, { workspace: _workspace, ...args }) => {
				const input = actionInput(
					MeasuresToolInputSchema,
					args,
					MEASURES_INPUTS,
				);
				if (input.action === "list")
					return renderMeasureList(await client.analysis.measures.list());
				const name = required(input, "name", "a measure name from action=list");
				if (input.action === "describe")
					return renderMeasureDescribe(
						await client.analysis.measures.describe({ name }),
					);
				const { action: _action, ...rest } = input;
				const output = await client.analysis.measures.run(
					parseMcpInput(MeasuresRunInputSchema, { ...rest, name }),
				);
				const text = renderMeasureRun(output);
				return output.truncated && output.measure
					? `${text}\n${cliHint(pullCommand({ repository: input.repository, ...output.measure }))}`
					: text;
			},
		},
		measuresPeek,
	),

	withPeek(
		{
			name: "patterns",
			annotations: WRITES_OWN_RECORDS,
			title: "Find recurring agent failures and their fixes",
			description: [
				"What it does: Finds recurring agent failures with the setup fix for each, and what the person keeps asking.",
				"Use when: A retro or how to improve the agents: list, read themes and example runs, then fix.",
				"Returns: list: sections of patterns with fixes. drill: every run or prompt of one. verify: before and after a change.",
				"Side effects: Stores each result like sql, in the answer being worked on.",
				"Limits: A sql query per family, per 35 days for calls (each 10 seconds, 512 MiB, workspace quota).",
				"",
				"Kinds: failing_call (one error across tools and commands, only calls that failed or were refused; detail lists its variants with their calls), retry_loop (the same failing command 3+ times in a run; edit, check, fail 3+ times; one file edited back and forth), wrong_route (a file searched for before its first edit; read and never used; edits thrown away), incomplete (edits with no passing check after the last one; pushed as done, then CI failed), correction (what the person had to say again: after done, after an interrupt, or a correction), theme (what the person keeps asking or reporting whatever the tone: the same opening or 2-4 words; templated text a tool writes is its own row; detail shows prompts and how the run before ended).",
				"Sections, in order, each ranked by the sessions it hit, then minutes: failures (failing_call, retry_loop, wrong_route), up to limit rows; then incomplete, correction and theme, a fifth of limit each. A pattern needs 3 sessions, 2 runs and minCount occurrences.",
				"fix_type: install_or_agents_md, script_and_pointer, navigation_pointer, agents_md_rule, tool_schema, allowlist, align_ci_check, pretooluse_hook, stop_hook, comment_at_entry; corrections: instruction, doc or skill; themes: read_prompts (context, not a diagnosis). fix_hint names the file, command or tool to change.",
				"",
				"Examples:",
				'- The patterns of a month: {"action":"list","repository":"athena","from":"2026-10-06","to":"2026-11-03"}',
				'- One pattern\'s runs and evidence: {"action":"drill","id":"fc_1a2b3c4d5e","repository":"athena","from":"2026-10-06","to":"2026-11-03"}',
				'- What the person keeps asking or reporting: {"action":"list","kind":"theme","limit":40,"repository":"athena","from":"2026-10-06","to":"2026-11-03"}',
				'- Did a fix hold: {"action":"verify","id":"fc_1a2b3c4d5e","repository":"athena","from":"2026-10-06","to":"2026-11-10"}',
				"",
				"Reminders:",
				"- Read two or three example runs before writing the fix: the counts say where to look, not why.",
				"- A theme is context: drill it for every prompt, then read the runs before them.",
				"- Write the fix as a diff against the repository, of the kind fix_type names: AGENTS.md or CLAUDE.md, a tool description or schema, a script, a comment, a hook or a lint rule.",
				"- Keep the same from, to and repository for drill and verify, so the runs add up to the row.",
				"- Where a shell has the opaline CLI, opaline pull --pattern <id> --repo … --from … --to … copies just that pattern's sessions, every record.",
				"- When a failure keeps happening, offer to save it as a check.",
			].join("\n"),
			inputSchema: describeInput(zodToolInput(PatternsToolInputSchema), {
				action:
					"Required. list: the recurring patterns in sections (failures, incomplete, correction, theme). drill: one pattern's runs with evidence (a theme: each prompt). verify: rates before and after the last setup change.",
				from: "First day the sessions started, YYYY-MM-DD (UTC). Default: 29 days before to.",
				to: "Last day the sessions started, YYYY-MM-DD (UTC). Default: today.",
				repository:
					"Only sessions of this repository, its full value or the part after the last slash (athena).",
				latest:
					"Only the newest N sessions by start time, 1-500, e.g. 50 for the last 50 sessions.",
				sessions: "Only these session ids, up to 200.",
				kind: "action=list or verify: only this kind of pattern, e.g. theme; then limit rows of it.",
				minCount:
					"action=list or verify: the fewest occurrences a pattern needs, default 2 (it also needs 2 runs and 3 sessions).",
				id: "action=drill, required; action=verify, optional: a pattern id from action=list, e.g. fc_1a2b3c4d5e.",
				since:
					"action=verify: compare before and after this day (YYYY-MM-DD, UTC), e.g. the day a fix merged. Default: the last change of an instruction or skill file in the window.",
				limit:
					"Rows to return: list default 20 (up to 100), drill default 50 (up to 200), verify default 10 (up to 50).",
				analysis: ANALYSIS_ID_DESCRIPTION,
				workspace: WORKSPACE_DESCRIPTION,
			}),
			run: async (client, { workspace: _workspace, ...args }) => {
				const input = actionInput(
					PatternsToolInputSchema,
					args,
					PATTERNS_INPUTS,
				);
				const { action, ...rest } = input;
				const output =
					action === "drill"
						? await client.analysis.patterns.drill(
								parseMcpInput(PatternsDrillInputSchema, {
									...rest,
									id: required(input, "id", "a pattern id from action=list"),
								}),
							)
						: action === "verify"
							? await client.analysis.patterns.verify(
									parseMcpInput(PatternsVerifyInputSchema, rest),
								)
							: await client.analysis.patterns.list(
									parseMcpInput(PatternsListInputSchema, rest),
								);
				const scope = {
					repository: input.repository,
					from: output.measure?.from ?? "",
					to: output.measure?.to ?? "",
				};
				const text = renderPatterns(action, output, (id) =>
					pullPatternCommand(id, scope),
				);
				return output.truncated
					? `${text}\n${cliHint(pullCommand(scope))}`
					: text;
			},
		},
		patternsPeek,
	),

	{
		name: "checks",
		annotations: WRITES_OWN_RECORDS,
		title: "Save and run checks for recurring failures",
		description: [
			"What it does: Saves a failure that keeps happening as a check (a condition over runs, or a measure and a threshold) to run again on any window.",
			"Use when: A failure keeps happening: test the condition, create the check, then run it on later windows to see if a fix held.",
			"Returns: test and run: matching runs or sessions and their count. create: the saved check. list: your checks.",
			"Side effects: create saves the check for you only, switched off; test and run store results like sql.",
			"Limits: One condition over runs columns; test tries the last 500 runs; each test or run is one sql query.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(ChecksToolInputSchema), {
			action:
				"Required. test: try a condition on recent runs. create: save it. list: your checks. run: run a saved check over a window.",
			name: "action=create, required: a short name, e.g. 'pushed before typecheck'.",
			where:
				"action=test or create: one SQL condition over the runs columns, e.g. failed_calls >= 10 AND agent_id = ''. Give where or measure.",
			target:
				"action=test or create with where: run (default) lists matching runs; session lists sessions with a matching run.",
			measure:
				"action=test or create: a query measure whose rows must reach min in column, instead of where.",
			column: "With measure: the numeric column to compare, e.g. failed_calls.",
			min: "With measure: the smallest value that matches.",
			repository: "With measure: only sessions of this repository.",
			last: "action=test: how many of the newest runs to try (sessions for a measure), 1-5000. Default 500.",
			id: "action=run, required: the check's id from action=create or list.",
			from: "action=run: first day, YYYY-MM-DD (UTC). Default: 29 days before to.",
			to: "action=run: last day, YYYY-MM-DD (UTC). Default: today.",
			analysis: ANALYSIS_ID_DESCRIPTION,
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: async (client, { workspace: _workspace, ...args }) => {
			const input = actionInput(ChecksToolInputSchema, args, CHECKS_INPUTS);
			if (input.action === "list")
				return renderCheckList(await client.analysis.checks.list());
			if (input.action === "run")
				return renderCheckResult(
					await client.analysis.checks.run(
						parseMcpInput(ChecksRunInputSchema, {
							id: required(input, "id", "the check's id from action=list"),
							from: input.from,
							to: input.to,
							analysis: input.analysis,
						}),
					),
				);
			const definition = checkDefinition(input);
			if (input.action === "test")
				return renderCheckResult(
					await client.analysis.checks.test(
						parseMcpInput(ChecksTestInputSchema, {
							definition,
							last: input.last,
							analysis: input.analysis,
						}),
					),
				);
			return renderCheckCreate(
				await client.analysis.checks.create(
					parseMcpInput(ChecksCreateInputSchema, {
						name: required(input, "name", "a short name for the check"),
						definition,
					}),
				),
			);
		},
	},
	{
		name: "answers",
		annotations: READ_ONLY,
		title: "Search and open saved answers",
		description: [
			"What it does: Searches answers your team saved about its coding-agent sessions, opens one, or opens one stored result behind it.",
			"Use when: Before analysing the team's agent sessions, to start from what the team already found; not for support, account or billing questions.",
			"Returns: action=search: saved answers by meaning or most recent. action=open: one answer's steps, findings and stored result ids. action=result: one stored result.",
			"Side effects: None.",
			"Limits: Only answers you saved or that were shared with your workspace, and sql results you ran; results expire after 90 days.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(AnswersToolInputSchema), {
			action:
				"Required. search: list saved answers. open: one saved answer. result: one stored result.",
			text: "action=search: words to look for, matched by meaning (1-500 characters). Default: the most recent answers.",
			limit: "action=search: how many answers to return, 1-50. Default 10.",
			includeEval:
				"action=search: also show answers from test runs. Default false.",
			analysis:
				"action=open, required: the saved answer's id, from action=search.",
			id: "action=result, required: a stored result's id, shown in the steps of action=open, or an sql result id (sr_…).",
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: async (client, { workspace: _workspace, ...args }, context) => {
			const input = answersInput(args);
			const url = sessionsUrl(context.workspace.slug);
			if (input.action === "search")
				return searchAnswers(
					client,
					parseMcpInput(AnalysisHistorySearchInputSchema, {
						text: input.text,
						limit: input.limit,
						includeEval: input.includeEval,
					}),
					url,
				);
			if (input.action === "open")
				return openAnswer(client, input.analysis, url);
			return openResult(client, input.id, url);
		},
	},
	withPeek(
		{
			name: "search",
			annotations: READ_ONLY,
			title: "Search agent transcripts",
			description: [
				"What it does: Finds runs by meaning and by exact string or regex in every session, in one ranking. In sql, search('text') is a table to join to runs.",
				"Use when: To find runs about something, or that contain a flag, file, command or error; results are not evidence.",
				"Returns: Up to 20 runs with why each matched and a snippet, match counts, coverage, the OpenAI quota, and a rewrite to try when none matched.",
				"Side effects: None; meaning search spends tokens of the OpenAI quota.",
				"Limits: Sessions you may open; meaning only where indexed; 30 days by default, at most 180.",
			].join("\n"),
			inputSchema: describeInput(zodToolInput(AnalysisSearchInputSchema), {
				text: "Required. What to find: a description of what happened, a literal string such as a flag, file name or error, or an RE2 regex (mode regex, up to 800 characters).",
				mode: "hybrid (default) merges meaning and exact matches, meaning finds similar text, exact finds the string itself (case-insensitive), regex matches an RE2 pattern (case-sensitive unless it starts with (?i)).",
				filters:
					"Optional: since and until (YYYY-MM-DD, UTC, inclusive; default the last 30 days, at most 180 apart), source (claude_code or codex), kinds (user_prompt, assistant_text, reasoning, tool_call, tool_result, file_change), userId (one member).",
				workspace: WORKSPACE_DESCRIPTION,
			}),
			run: async (client, { workspace: _workspace, ...args }, context) => {
				const output = await client.analysis.search(
					parseMcpInput(AnalysisSearchInputSchema, args),
				);
				return withUrlLine(
					renderSearch(output),
					sessionsUrl(context.workspace.slug, {
						from: output.since,
						to: new Date(Date.parse(output.until) - 1).toISOString(),
					}),
				);
			},
		},
		searchPeek,
	),

	{
		name: "estimate_questions",
		annotations: READ_ONLY,
		title: "Estimate run questions",
		description: [
			"What it does: Says what answering yes/no run questions over the runs a query selects would cost, and which answers are already stored and reused.",
			"Use when: Before run_questions, only for runs without answers in run_answers (new runs are answered already).",
			"Returns: Runs selected, answers stored, queued and to buy per question, the most it can cost, the quota left, and a token for run_questions.",
			"Side effects: None; nothing is sent anywhere.",
			"Limits: Up to 10 questions and 5,000 runs; the query counts against the sql quota.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(RunQuestionsInputSchema), {
			questions: "Required. Ids of run questions from schema, up to 10.",
			runs: "Optional. One SELECT over the sql views returning session_id, agent_id and turn_idx. Default: every run of the last 4 weeks.",
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: async (client, { workspace: _workspace, ...args }) =>
			renderQuestionsEstimate(
				await client.analysis.estimateQuestions(
					parseMcpInput(RunQuestionsInputSchema, args),
				),
			),
	},
	{
		name: "run_questions",
		annotations: SENDS_RUN_NOTES,
		title: "Answer run questions",
		description: [
			"What it does: Answers yes/no run questions over the runs a query selects, as the probability of yes, and keeps the answers.",
			"Use when: After estimate_questions, with its token, if the cost is worth it; then rank runs with sql over run_answers.",
			"Returns: What was queued and reused, and the most it costs; answers arrive within minutes.",
			"Side effects: Sends each run's text, secrets removed, to the answering service; answers are stored in the workspace.",
			"Limits: Only what the estimate priced, within 15 minutes; a workspace answer quota; answers say where to read, not why.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(RunQuestionsRunInputSchema), {
			questions: "Required. The same question ids as the estimate.",
			runs: "Optional. The same SELECT as the estimate. Default: every run of the last 4 weeks.",
			estimate:
				"Required. The token estimate_questions returned for these questions and runs.",
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: async (client, { workspace: _workspace, ...args }) =>
			renderQuestionsRun(
				await client.analysis.runQuestions(
					parseMcpInput(RunQuestionsRunInputSchema, args),
				),
			),
	},
	{
		name: "search_answers",
		annotations: READ_ONLY,
		title: "Search saved answers",
		description: [
			"What it does: Lists answers your team saved about its coding-agent sessions, by meaning or most recent.",
			"Use when: Same as answers action=search, kept for older instructions; before analysing the team's agent sessions, to find an answer to update.",
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
			searchAnswers(
				client,
				parseMcpInput(AnalysisHistorySearchInputSchema, args),
			),
	},
	{
		name: "get_answer",
		annotations: READ_ONLY,
		title: "Open a saved answer",
		description: [
			"What it does: Opens one saved answer with its findings, steps and final answer.",
			"Use when: Same as answers action=open, kept for older instructions; a saved answer covers the question.",
			"Returns: The question, the last day its data covers, the answer it updates and newer versions, each step with its finding and stored result ids, the changes against the older answer, and the final answer.",
			"Side effects: None.",
			"Limits: Only answers you saved or that were shared with your workspace.",
		].join("\n"),
		inputSchema: describeInput(zodToolInput(AnalysisHistoryGetInputSchema), {
			analysis: "Required. The saved answer's id, from search_answers.",
			workspace: WORKSPACE_DESCRIPTION,
		}),
		run: async (client, { workspace: _workspace, ...args }) =>
			openAnswer(
				client,
				parseMcpInput(AnalysisHistoryGetInputSchema, args).analysis,
			),
	},
	{
		name: "get_answer_evidence",
		annotations: READ_ONLY,
		title: "Open a stored result",
		description: [
			"What it does: Shows one stored find or read result behind a saved answer.",
			"Use when: Same as answers action=result, kept for older instructions; to check one step of a saved answer.",
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
			openResult(
				client,
				parseMcpInput(AnalysisHistoryQueryInputSchema, args).query,
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
	agentFeedbackTool,
	mcpStatsTool(getClickhouse),
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
