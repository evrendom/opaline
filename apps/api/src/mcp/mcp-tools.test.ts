import { afterEach, expect, test } from "bun:test";
import {
	ADMIN_LISTED_TOOLS,
	RETRO_LISTED_TOOLS,
	toolsListedFor,
	workspacesListing,
} from "./retro-listing.js";

/**
 * Loads MCP_TOOLS in a child process: the module opens the Postgres pool on
 * import (without connecting), so it needs a connection string but no database.
 */
interface ListedTool {
	name: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations: Record<string, unknown>;
	_meta?: { ui?: { visibility?: string[] } };
}

type Outcome = { result: string } | { error: string };

interface LoadedTools {
	schemas: Record<string, Record<string, unknown>>;
	annotations: Record<string, Record<string, boolean>>;
	listed: ListedTool[];
	retroListed: ListedTool[];
	retroDescriptions: Record<string, string>;
	draft: { analysis: string };
	revision: { analysis: string; step: string; query: string };
	flow: Record<string, Outcome>;
	summaries: {
		plain: unknown;
		byMember: unknown;
		widgetPlain: unknown;
		widgetByMember: unknown;
	};
}

async function loadTools(): Promise<LoadedTools> {
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`const { MCP_TOOLS, listedTool, retroListedTool, summarizeDashboard, withoutPersonRows } = await import(${JSON.stringify(new URL("./mcp-tools.ts", import.meta.url).href)});
const { PLUGIN_TOOLS } = await import(${JSON.stringify(new URL("./plugin-tools.ts", import.meta.url).href)});
const service = await import(${JSON.stringify(new URL("../services/analysis-log/analysis-log.service.ts", import.meta.url).href)});
const { createMemoryAnalysisStore } = await import(${JSON.stringify(new URL("../services/analysis-log/memory-store.ts", import.meta.url).href)});
const { createLocalEmbedder } = await import(${JSON.stringify(new URL("../services/analysis-log/embedder.ts", import.meta.url).href)});
const tool = (name) => MCP_TOOLS.find((candidate) => candidate.name === name);
const context = { userId: "u", workspace: { id: "w", slug: "w" }, authSession: {} };
// The history procedures as the API runs them, over an in-memory log.
const log = { store: createMemoryAnalysisStore(), embedder: createLocalEmbedder(), now: () => new Date() };
const viewer = { workspaceId: "w", userId: "u", isAdmin: false, restrictResults: false, onlyMember: null };
const client = { analysis: { coverage: async () => ({ line: "coverage: stub" }), history: {
	save: (input) => service.saveAnalysis(log, viewer, input),
	share: (input) => service.shareAnalysis(log, viewer, input.analysis, input.shared),
	get: (input) => service.getAnalysisTree(log, viewer, input.analysis),
	search: (input) => service.searchAnalyses(log, viewer, input),
	query: (input) => service.getStoredQuery(log, viewer, input.query, async () => new Map()),
} } };
const record = (trace) => service.recordQuery(log, { workspaceId: "w", userId: "u", host: "plugin" }, { tool: "find", args: { source: "runs" }, trace, output: { ok: true }, outputChars: 11, sessions: [], owners: [] });
const outcome = (promise) => promise.then((result) => ({ result }), (error) => ({ error: error.message }));
const draft = await record({});
const flow = {};
flow.getDraft = await outcome(tool("get_answer").run(client, { analysis: draft.analysis }, context));
flow.queryDraft = await outcome(tool("get_answer_evidence").run(client, { query: draft.query }, context));
flow.shareDraft = await outcome(tool("share_answer").run(client, { analysis: draft.analysis }, context));
flow.saveWithoutQuestion = await outcome(tool("save_answer").run(client, { analysis: draft.analysis, finalAnswer: "Stale patches." }, context));
flow.save = await outcome(tool("save_answer").run(client, { analysis: draft.analysis, question: "Why agents fail", finalAnswer: "Stale patches." }, context));
flow.share = await outcome(tool("share_answer").run(client, { analysis: draft.analysis }, context));
flow.unshare = await outcome(tool("share_answer").run(client, { analysis: draft.analysis, shared: false }, context));
flow.saveAgain = await outcome(tool("save_answer").run(client, { analysis: draft.analysis, question: "Why agents fail", finalAnswer: "Changed." }, context));
const revision = await record({});
const revisionFindings = [{ step: revision.query, finding: "fewer stale patches" }];
flow.reviseWithoutChanges = await outcome(tool("save_answer").run(client, { analysis: revision.analysis, question: "Why agents fail", updates: draft.analysis, finalAnswer: "Fewer.", findings: revisionFindings }, context));
flow.revise = await outcome(tool("save_answer").run(client, { analysis: revision.analysis, question: "Why agents fail", updates: draft.analysis, finalAnswer: "Fewer.", findings: revisionFindings, changes: [{ step: revision.query, change: "weakened", evidence: "4, was 11" }] }, context));
flow.getPrior = await outcome(tool("get_answer").run(client, { analysis: draft.analysis }, context));
flow.getRevision = await outcome(tool("get_answer").run(client, { analysis: revision.analysis }, context));
const member = { id: "user-secret-id", label: "Alex", value: 5, share: 1, image: null };
const repo = { id: "acme/web", label: "acme/web", value: 5, share: 1, image: null };
const dashboardOf = (splitBy) => ({
	availableMetrics: ["cost"],
	splitBy,
	metrics: { cost: {
		total: 5, incomplete: false,
		series: splitBy === "members" ? [{ id: "user-secret-id", label: "Alex" }] : [],
		trend: [{ date: "2026-10-01", total: 5, values: splitBy === "members" ? { "user-secret-id": 5 } : {} }],
		breakdowns: { members: [member], repositories: [repo] },
	} },
});
const summaries = {
	plain: summarizeDashboard(dashboardOf("none"), "cost"),
	byMember: summarizeDashboard(dashboardOf("members"), "cost"),
	widgetPlain: withoutPersonRows(dashboardOf("none")),
	widgetByMember: withoutPersonRows(dashboardOf("members")),
};
console.log(JSON.stringify({
	summaries,
	schemas: Object.fromEntries(MCP_TOOLS.map((tool) => [tool.name, tool.inputSchema])),
	annotations: Object.fromEntries(MCP_TOOLS.map((tool) => [tool.name, tool.annotations])),
	listed: [...MCP_TOOLS, ...PLUGIN_TOOLS].map(listedTool),
	retroListed: [...MCP_TOOLS, ...PLUGIN_TOOLS].map(retroListedTool),
	retroDescriptions: Object.fromEntries(MCP_TOOLS.filter((tool) => tool.retroDescription).map((tool) => [tool.name, tool.retroDescription])),
	draft,
	revision,
	flow,
}));`,
		],
		{
			env: {
				PATH: process.env.PATH,
				PG_CONNECTION_STRING: "postgres://unused@127.0.0.1:1/unused",
				ALLOWED_ORIGIN: "https://opaline.so/",
			},
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		subprocess.exited,
		new Response(subprocess.stdout).text(),
		new Response(subprocess.stderr).text(),
	]);
	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
	return JSON.parse(stdout);
}

const loaded = loadTools();

test("analysis tools publish closed input schemas with defaults and a workspace", async () => {
	const { schemas } = await loaded;

	expect(schemas.find).toMatchObject({
		type: "object",
		required: ["source"],
		additionalProperties: false,
		properties: {
			source: {
				type: "string",
				enum: ["runs", "tool", "user", "git", "weekly", "calls"],
			},
			from: { type: "string", format: "date" },
			limit: { type: "integer", minimum: 1, maximum: 200 },
			cursor: { type: "string" },
			reaction: { default: ["negative", "swear", "apology"] },
			refs: {
				type: "array",
				items: {
					required: ["sessionId", "turn"],
					properties: { agentId: { default: "" } },
					additionalProperties: false,
				},
			},
			workspace: { type: "string" },
		},
	});
	expect(schemas.read).toMatchObject({
		type: "object",
		required: ["refs"],
		additionalProperties: false,
		properties: {
			refs: {
				type: "array",
				minItems: 1,
				maxItems: 10,
				items: { required: ["sessionId", "turn"] },
			},
			depth: { enum: ["exchange", "turn", "record"], default: "exchange" },
			maxChars: { maximum: 40_000, default: 12_000 },
			workspace: { type: "string" },
		},
	});
	// find and read take only what their operation needs, plus the draft id.
	expect(Object.keys(schemas.find?.properties ?? {}).sort()).toEqual(
		[
			"source",
			"from",
			"to",
			"latest",
			"repository",
			"agent",
			"model",
			"sessionId",
			"toolGroup",
			"commandClass",
			"kind",
			"cause",
			"detail",
			"includeNoise",
			"commandFrom",
			"commandArgv0",
			"commandPrefix",
			"commandFingerprint",
			"commandSimhash",
			"reaction",
			"groupBy",
			"refs",
			"limit",
			"sort",
			"cursor",
			"pullRequest",
			"analysis",
			"workspace",
		].sort(),
	);
	expect(Object.keys(schemas.read?.properties ?? {}).sort()).toEqual(
		[
			"refs",
			"depth",
			"maxChars",
			"record",
			"block",
			"fromChar",
			"toChar",
			"analysis",
			"workspace",
		].sort(),
	);
	for (const name of ["find", "read"])
		for (const removed of [
			"question",
			"step",
			"parentStep",
			"updates",
			"userId",
		])
			expect(schemas[name]?.properties).not.toHaveProperty(removed);
	expect(schemas.save_answer?.properties).toHaveProperty("question");
	expect(schemas.save_answer?.properties).toHaveProperty("updates");
	// One operation per tool: each takes only its own inputs.
	expect(Object.keys(schemas.search_answers?.properties ?? {}).sort()).toEqual([
		"includeEval",
		"limit",
		"text",
		"workspace",
	]);
	expect(schemas.get_answer).toMatchObject({
		required: ["analysis"],
		additionalProperties: false,
	});
	expect(Object.keys(schemas.get_answer?.properties ?? {}).sort()).toEqual([
		"analysis",
		"workspace",
	]);
	expect(schemas.get_answer_evidence).toMatchObject({ required: ["query"] });
	expect(Object.keys(schemas.share_answer?.properties ?? {}).sort()).toEqual([
		"analysis",
		"workspace",
	]);
	expect(schemas.save_answer).toMatchObject({
		type: "object",
		additionalProperties: false,
		required: ["analysis", "question", "finalAnswer"],
		properties: {
			analysis: { type: "string" },
			finalAnswer: { type: "string" },
			findings: { type: "array", default: [] },
			question: { type: "string", maxLength: 120 },
			workspace: { type: "string" },
		},
	});
	// The plugin only adds: no unsharing, and no conversation turns.
	for (const name of ["save_answer", "share_answer"]) {
		expect(schemas[name]?.properties).not.toHaveProperty("shared");
		expect(schemas[name]?.properties).not.toHaveProperty("clarifications");
		expect(schemas[name]?.properties).not.toHaveProperty("action");
	}
});

test("every tool declares all four annotations, and only the tools that write are not read-only or idempotent", async () => {
	const { annotations } = await loaded;
	const readOnly = {
		readOnlyHint: true,
		destructiveHint: false,
		openWorldHint: false,
		idempotentHint: true,
	};
	const writes = {
		readOnlyHint: false,
		destructiveHint: false,
		openWorldHint: false,
		idempotentHint: false,
	};

	const shares = {
		readOnlyHint: false,
		destructiveHint: false,
		openWorldHint: true,
		idempotentHint: false,
	};

	const replaces = {
		readOnlyHint: false,
		destructiveHint: true,
		openWorldHint: false,
		idempotentHint: false,
	};

	for (const [name, value] of Object.entries(annotations)) {
		expect({ name, ...value }).toEqual({
			name,
			...(name === "settings_update"
				? replaces
				: ["share_answer", "save_answer", "run_questions"].includes(name)
					? shares
					: [
								"find",
								"read",
								"sql",
								"agent_feedback",
								"measures",
								"patterns",
								"checks",
							].includes(name)
						? writes
						: readOnly),
		});
	}
	expect(annotations.find).toEqual(writes);
	expect(annotations.read).toEqual(writes);
	for (const name of [
		"answers",
		"search_answers",
		"get_answer",
		"get_answer_evidence",
	])
		expect(annotations[name]).toEqual(readOnly);
	expect(annotations.save_answer).toEqual(shares);
	expect(annotations.share_answer).toEqual(shares);
});

/** Phrases that tell the model a member sees only their own sessions. */
const OWN_SESSIONS_ONLY =
	/(their|your) own sessions|members:? (see |analyze |count )?(only )?their own|admins (all|see|count)|admins: the whole team|owner or a workspace admin/i;

test("no tool says members see only their own sessions: every member reads every member's", async () => {
	const { listed } = await loaded;
	const claims = listed
		.map((tool) => [
			tool.name,
			JSON.stringify(tool).match(OWN_SESSIONS_ONLY)?.[0],
		])
		.filter(([, claim]) => claim);
	expect(claims).toEqual([]);
	const description = (name: string) =>
		listed.find((tool) => tool.name === name)?.description ?? "";
	expect(description("find")).toContain(
		"Every member sees every member's sessions",
	);
	expect(description("list_workspaces")).toContain(
		"every member counts the whole team's sessions",
	);
});

/** Words a user or reviewer would not know; tool texts explain instead. */
const JARGON =
	/\b(refs?|origin runs?|depth|raw chars|trace|cutoff|prior|posterior)\b/i;
const SECTIONS = [
	"What it does: ",
	"Use when: ",
	"Returns: ",
	"Side effects: ",
	"Limits: ",
];

function propertyDescriptions(
	schema: Record<string, unknown>,
	path = "",
): [string, unknown][] {
	const properties = (schema.properties ?? {}) as Record<
		string,
		Record<string, unknown>
	>;
	return Object.entries(properties).flatMap(([key, property]) => {
		const items = property.items as Record<string, unknown> | undefined;
		return [
			[`${path}${key}`, property.description] as [string, unknown],
			...(items?.properties
				? propertyDescriptions(items, `${path}${key}[].`)
				: []),
		];
	});
}

test("the model sees only the analysis tools, the dashboard and the workspace list", async () => {
	const { listed } = await loaded;
	expect(
		listed
			.filter((tool) => !tool._meta?.ui?.visibility?.includes("app"))
			.map((tool) => tool.name)
			.sort(),
	).toEqual(
		[
			"agent_feedback",
			"answers",
			"checks",
			"mcp_stats",
			"measures",
			"patterns",
			"search_answers",
			"get_answer",
			"get_answer_evidence",
			"estimate_questions",
			"find",
			"get_dashboard",
			"list_workspaces",
			"read",
			"run",
			"run_questions",
			"save_answer",
			"schema",
			"share_answer",
			"search",
			"sql",
		].sort(),
	);
});

test("without the retro tools, the model is listed exactly the tools of the published plugin", async () => {
	const { listed } = await loaded;
	const visible = listed.filter(
		(tool) => !tool._meta?.ui?.visibility?.includes("app"),
	);
	// Every hidden tool exists: a renamed tool would otherwise be listed to all.
	for (const name of RETRO_LISTED_TOOLS)
		expect(visible.map((tool) => tool.name)).toContain(name);
	// Plugin 1.2.1 as submitted to the OpenAI plugin directory.
	expect(
		toolsListedFor(visible, false)
			.map((tool) => tool.name)
			.sort(),
	).toEqual(
		[
			"find",
			"get_answer",
			"get_answer_evidence",
			"get_dashboard",
			"list_workspaces",
			"read",
			"save_answer",
			"search_answers",
			"share_answer",
		].sort(),
	);
	// App-only tools are listed either way.
	const appOnly = listed.filter((tool) =>
		tool._meta?.ui?.visibility?.includes("app"),
	);
	expect(toolsListedFor(appOnly, false)).toEqual(appOnly);
	expect(toolsListedFor(listed, true, true)).toEqual(listed);
	expect(toolsListedFor(listed, true).map((tool) => tool.name)).not.toContain(
		"mcp_stats",
	);
});

const LISTING_ENV = [
	"RETRO_TOOLS_WORKSPACES",
	"RETRO_TOOLS_NEW_SINCE",
	"VITE_ADMIN_ORGANIZATION_ID",
] as const;
const savedListingEnv = LISTING_ENV.map((name) => ({
	name,
	value: process.env[name],
}));
afterEach(() => {
	for (const { name, value } of savedListingEnv) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

test("a user in a workspace created since RETRO_TOOLS_NEW_SINCE is listed the retro tools; one only in older unlisted workspaces is not", async () => {
	const { listed } = await loaded;
	process.env.RETRO_TOOLS_WORKSPACES = "ws-listed";
	process.env.RETRO_TOOLS_NEW_SINCE = "2026-11-06";
	process.env.VITE_ADMIN_ORGANIZATION_ID = "ws-team";
	const old = { id: "ws-old", createdAt: new Date("2026-10-01T00:00:00Z") };
	const fresh = { id: "ws-new", createdAt: new Date("2026-11-06T09:30:00Z") };
	const names = (listing: { retro: boolean; admin: boolean }) =>
		toolsListedFor(listed, listing.retro, listing.admin).map(
			(tool) => tool.name,
		);

	expect(workspacesListing([old])).toEqual({ retro: false, admin: false });
	for (const name of RETRO_LISTED_TOOLS)
		expect(names(workspacesListing([old]))).not.toContain(name);

	expect(workspacesListing([old, fresh])).toEqual({
		retro: true,
		admin: false,
	});
	const retro = names(workspacesListing([old, fresh]));
	for (const name of RETRO_LISTED_TOOLS)
		expect({ name, listed: retro.includes(name) }).toEqual({
			name,
			listed: !ADMIN_LISTED_TOOLS.has(name),
		});

	expect(workspacesListing([{ id: "ws-team", createdAt: null }])).toEqual({
		retro: true,
		admin: true,
	});
	delete process.env.RETRO_TOOLS_NEW_SINCE;
	expect(workspacesListing([fresh])).toEqual({ retro: false, admin: false });
});

test("only a retro listing asks every model tool for context and llm_model, and offers format on read and run, url and peek; app-only tools never change", async () => {
	const { listed, retroListed } = await loaded;
	const analytics = ["context", "llm_model"];
	const extras: Record<string, string[]> = {
		find: ["parentSessionId", "filters", "offset", "verbosity", "peek"],
		read: ["format"],
		run: ["url", "format"],
		sql: ["peek"],
		measures: ["peek"],
		patterns: ["peek"],
		search: ["peek"],
	};
	for (const [index, tool] of listed.entries()) {
		const retro = retroListed[index];
		const keys = Object.keys(tool.inputSchema.properties ?? {});
		for (const name of [...analytics, "format", "url", "peek", "output"])
			expect({ tool: tool.name, name, listed: keys.includes(name) }).toEqual({
				tool: tool.name,
				name,
				listed: false,
			});
		if (tool._meta?.ui?.visibility?.includes("app")) {
			expect(retro).toEqual(tool);
			continue;
		}
		const properties = retro?.inputSchema.properties as Record<
			string,
			{ description: string }
		>;
		expect({
			tool: tool.name,
			added: Object.keys(properties).filter((key) => !keys.includes(key)),
			required: (retro?.inputSchema.required as string[]).filter((name) =>
				analytics.includes(name),
			),
			rest: {
				...retro,
				inputSchema: undefined,
				description: undefined,
				annotations: undefined,
			},
			annotations: retro?.annotations,
		}).toEqual({
			tool: tool.name,
			added: [...(extras[tool.name] ?? []), ...analytics],
			required: analytics,
			rest: {
				...tool,
				inputSchema: undefined,
				description: undefined,
				annotations: undefined,
			},
			annotations: {
				...tool.annotations,
				idempotentHint: tool.annotations.readOnlyHint === true,
			},
		});
		expect(properties.context?.description).toStartWith(
			"Explain in 15-25 words, in third person, why this tool is called",
		);
		expect(properties.llm_model?.description).toEndWith(
			'If you do not know your model identifier with certainty, pass "unknown" — never guess.',
		);
		for (const name of extras[tool.name] ?? [])
			expect(properties[name]?.description).not.toMatch(JARGON);
	}
});

test("the retro listing gives find its own description, with the check reminder and the same five short lines first", async () => {
	const { listed, retroDescriptions } = await loaded;
	const retro = retroDescriptions.find ?? "";
	const reminder =
		"When a failure keeps happening, offer to save it as a check.";
	expect(retro).toContain(reminder);
	expect(
		retro
			.split("\n")
			.slice(0, SECTIONS.length)
			.map((line, index) => line.startsWith(SECTIONS[index] ?? "?")),
	).toEqual(SECTIONS.map(() => true));
	expect(retro).toContain(
		"Nobody can see this unfinished answer, not even the user, until save_answer saves it.",
	);
	expect(retro).toContain("Every member sees every member's sessions");
	const listedFind = toolsListedFor(
		[{ name: "find", description: "plain", retroDescription: retro }],
		true,
	);
	expect(listedFind[0]?.description).toBe(retro);
	expect(
		toolsListedFor(
			[{ name: "find", description: "plain", retroDescription: retro }],
			false,
		)[0]?.description,
	).toBe("plain");
	expect(
		listed.find((tool) => tool.name === "measures")?.description,
	).toContain(reminder);
});

test("every tool the model sees has a plain title and the same five short description lines first, and every input is described in one plain line", async () => {
	const { listed } = await loaded;
	const visible = listed.filter(
		(tool) => !tool._meta?.ui?.visibility?.includes("app"),
	);
	for (const tool of visible) {
		const lines = tool.description.split("\n");
		const head = lines.slice(0, SECTIONS.length);
		expect({
			name: tool.name,
			title: tool.title.trim().length > 0,
			annotationTitle: tool.annotations.title,
			sections: head.map((line, index) =>
				line.startsWith(SECTIONS[index] ?? "?"),
			),
			guideAfterBlankLine:
				lines.length === SECTIONS.length || lines[SECTIONS.length] === "",
			short: head.join("\n").length < 600,
			jargon: tool.description.match(JARGON)?.[0] ?? null,
		}).toEqual({
			name: tool.name,
			title: true,
			annotationTitle: tool.title,
			sections: SECTIONS.map(() => true),
			guideAfterBlankLine: true,
			short: true,
			jargon: null,
		});
		for (const [path, description] of propertyDescriptions(tool.inputSchema))
			expect({
				tool: tool.name,
				path,
				described: typeof description === "string" && description.trim() !== "",
				oneLine: !`${description}`.includes("\n"),
				jargon: `${description}`.match(JARGON)?.[0] ?? null,
			}).toEqual({
				tool: tool.name,
				path,
				described: true,
				oneLine: true,
				jargon: null,
			});
	}
});

test("app-only tools have a plain title and one line saying the assistant does not call them", async () => {
	const { listed } = await loaded;
	const hidden = listed.filter((tool) =>
		tool._meta?.ui?.visibility?.includes("app"),
	);
	expect(hidden.length).toBeGreaterThan(20);
	for (const tool of hidden)
		expect({
			name: tool.name,
			title: /^[A-Z][^_.]*$/.test(tool.title),
			annotationTitle: tool.annotations.title,
			oneLine: !tool.description.includes("\n"),
			notCalled: tool.description.endsWith("Not called by the assistant."),
		}).toEqual({
			name: tool.name,
			title: true,
			annotationTitle: tool.title,
			oneLine: true,
			notCalled: true,
		});
});

test("find, read, save_answer and share_answer describe the private draft, the append-only save and sharing", async () => {
	const { listed } = await loaded;
	const description = (name: string) =>
		listed.find((tool) => tool.name === name)?.description ?? "";
	for (const name of ["find", "read"])
		expect(description(name)).toContain(
			"Nobody can see this unfinished answer, not even the user, until save_answer saves it.",
		);
	expect(description("save_answer")).toContain(
		"Nothing is published publicly or shared with other workspaces. OpenAI processes the title and topics to build the search index.",
	);
	expect(description("share_answer")).toContain(
		"Sharing shows the answer, its findings and the stored results behind it (which can include short excerpts from the sessions that were read) to members of your workspace; a workspace limited to own sessions may show those results only to admins and the session's owner.",
	);
	for (const name of ["search_answers", "get_answer", "get_answer_evidence"])
		expect(description(name)).toContain("Side effects: None.");
});

test("analysis tools hide drafts, publish once, refuse a second save with a plain message and link revisions", async () => {
	const { draft, revision: started, flow } = await loaded;
	const id = draft.analysis;

	expect(flow.getDraft).toEqual({
		error: `No saved analysis ${id} that you can see`,
	});
	expect(flow.queryDraft).toEqual({
		error: `No saved analysis ${id} that you can see`,
	});
	expect(flow.shareDraft).toEqual({
		error: `Analysis ${id} is an unsaved draft; save it with save_answer first, then share it`,
	});
	expect(flow.saveWithoutQuestion).toEqual({
		error:
			"question: required: the question this answer addresses, as a short title",
	});
	const report = `Open in Opaline: https://opaline.so/w/reports/${id}`;
	expect(flow.save).toEqual({
		result: `saved analysis=${id} status=finished\n${report}\ncoverage: stub`,
	});
	expect(flow.share).toEqual({
		result: `analysis=${id} shared=true\n${report}`,
	});
	expect(errorOf(flow.unshare)).toContain("shared");
	expect(flow.saveAgain).toEqual({
		error: `This analysis is already saved. To revise it, save a new analysis that passes updates=${id}.`,
	});
	expect(errorOf(flow.reviseWithoutChanges)).toBe(
		`Analysis ${started.analysis} updates ${id}, so changes needs exactly one item per finding saved now, naming its step by its step or query id (plus change=dropped items for findings of ${id} that no longer hold): no change for the finding of ${started.step} ("find source=runs"). Nothing was saved.`,
	);
	const saved = resultOf(flow.revise);
	expect(saved).toMatch(
		/^saved analysis=(a_\S+) status=finished\nOpen in Opaline: https:\/\/opaline\.so\/w\/reports\/\1\ncoverage: stub$/,
	);
	const revisionId = saved.split(/[= ]/)[2];
	const prior = resultOf(flow.getPrior);
	expect(prior.split("\n").at(-1)).toBe(report);
	expect(prior.split("\n")[0]).toMatch(
		new RegExp(
			`^analysis ${id} status=finished .* cutoff=\\S+ updates=none updatedBy=${revisionId}$`,
		),
	);
	expect(prior).toContain("final answer: Stale patches.");
	const revision = resultOf(flow.getRevision);
	expect(revision).toContain(`updates=${id} updatedBy=none`);
	expect(revision).toContain(
		`changes against ${id}:\n  weakened: step ${started.step}: fewer stale patches (4, was 11)`,
	);
});

function resultOf(outcome: Outcome | undefined): string {
	if (!outcome || !("result" in outcome))
		throw new Error(`Expected a result, got ${JSON.stringify(outcome)}`);
	return outcome.result;
}

function errorOf(outcome: Outcome | undefined): string {
	if (!outcome || !("error" in outcome))
		throw new Error(`Expected an error, got ${JSON.stringify(outcome)}`);
	return outcome.error;
}

test("get_dashboard never gives the model member ids; per-member rows appear by name only when split by member", async () => {
	const { summaries, schemas } = await loaded;
	expect(JSON.stringify(summaries)).not.toContain("user-secret-id");
	expect(summaries.plain).toMatchObject({
		top: { repositories: [{ id: "acme/web", label: "acme/web", value: 5 }] },
	});
	expect(
		(summaries.plain as { top: Record<string, unknown> }).top,
	).not.toHaveProperty("members");
	expect(summaries.byMember).toMatchObject({
		series: [{ label: "Alex" }],
		trend: [{ values: { Alex: 5 } }],
		top: { members: [{ label: "Alex", value: 5 }] },
	});
	expect(schemas.get_dashboard?.properties).not.toHaveProperty("members");
});

test("the dashboard app's first view gets no rows or series that name people", async () => {
	const { summaries } = await loaded;
	for (const widget of [summaries.widgetPlain, summaries.widgetByMember]) {
		const text = JSON.stringify(widget);
		expect(text).not.toContain("user-secret-id");
		expect(text).not.toContain("Alex");
		expect(text).toContain("acme/web");
	}
	expect(summaries.widgetByMember).toMatchObject({
		metrics: {
			cost: {
				total: 5,
				series: [],
				trend: [{ date: "2026-10-01", total: 5, values: {} }],
			},
		},
	});
});

test("list_workspaces marks the default workspace and counts sessions without content", async () => {
	const { listed } = await loaded;
	const tool = listed.find((entry) => entry.name === "list_workspaces") as
		| (ListedTool & { outputSchema?: Record<string, unknown> })
		| undefined;
	expect(tool?.outputSchema).toMatchObject({
		properties: {
			items: {
				items: {
					properties: {
						default: { type: "boolean" },
						sessionsLast365Days: { type: "integer" },
					},
				},
			},
		},
	});
	expect(tool?.description).toContain("default: true");
});
