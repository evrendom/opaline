import { expect, test } from "bun:test";

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
	movedSave: unknown;
	movedShare: unknown;
	movedMessage: string;
	draft: { analysis: string };
	revision: { analysis: string; step: string };
	flow: Record<string, Outcome>;
}

async function loadTools(): Promise<LoadedTools> {
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`const { MCP_TOOLS, ANALYSES_MOVED_TO_SAVE_ANALYSIS, listedTool } = await import(${JSON.stringify(new URL("./mcp-tools.ts", import.meta.url).href)});
const { PLUGIN_TOOLS } = await import(${JSON.stringify(new URL("./plugin-tools.ts", import.meta.url).href)});
const service = await import(${JSON.stringify(new URL("../services/analysis-log/analysis-log.service.ts", import.meta.url).href)});
const { createMemoryAnalysisStore } = await import(${JSON.stringify(new URL("../services/analysis-log/memory-store.ts", import.meta.url).href)});
const { createLocalEmbedder } = await import(${JSON.stringify(new URL("../services/analysis-log/embedder.ts", import.meta.url).href)});
const tool = (name) => MCP_TOOLS.find((candidate) => candidate.name === name);
const context = { userId: "u", workspace: { id: "w", slug: "w" }, authSession: {} };
// The history procedures as the API runs them, over an in-memory log.
const log = { store: createMemoryAnalysisStore(), embedder: createLocalEmbedder(), now: () => new Date() };
const viewer = { workspaceId: "w", userId: "u", isAdmin: false, restrictResults: false };
const client = { analysis: { history: {
	save: (input) => service.saveAnalysis(log, viewer, input),
	share: (input) => service.shareAnalysis(log, viewer, input.analysis, input.shared),
	get: (input) => service.getAnalysisTree(log, viewer, input.analysis),
	search: (input) => service.searchAnalyses(log, viewer, input),
	query: (input) => service.getStoredQuery(log, viewer, input.query, async () => new Map()),
} } };
const record = (trace) => service.recordQuery(log, { workspaceId: "w", userId: "u", host: "plugin" }, { tool: "find", args: { source: "runs" }, trace, output: { ok: true }, outputChars: 11, sessions: [], owners: [] });
const outcome = (promise) => promise.then((result) => ({ result }), (error) => ({ error: error.message }));
const draft = await record({ question: "Why do agents fail?" });
const flow = {};
flow.getDraft = await outcome(tool("analyses").run(client, { action: "get", analysis: draft.analysis }, context));
flow.queryDraft = await outcome(tool("analyses").run(client, { action: "query", query: draft.query }, context));
flow.shareDraft = await outcome(tool("save_analysis").run(client, { action: "share", analysis: draft.analysis, shared: true }, context));
flow.save = await outcome(tool("save_analysis").run(client, { analysis: draft.analysis, finalAnswer: "Stale patches." }, context));
flow.saveAgain = await outcome(tool("save_analysis").run(client, { analysis: draft.analysis, finalAnswer: "Changed." }, context));
const revision = await record({ updates: draft.analysis });
const revisionFindings = [{ step: revision.step, finding: "fewer stale patches" }];
flow.reviseWithoutChanges = await outcome(tool("save_analysis").run(client, { analysis: revision.analysis, finalAnswer: "Fewer.", findings: revisionFindings }, context));
flow.revise = await outcome(tool("save_analysis").run(client, { analysis: revision.analysis, finalAnswer: "Fewer.", findings: revisionFindings, changes: [{ step: revision.step, change: "weakened", evidence: "4, was 11" }] }, context));
flow.getPrior = await outcome(tool("analyses").run(client, { action: "get", analysis: draft.analysis }, context));
flow.getRevision = await outcome(tool("analyses").run(client, { action: "get", analysis: revision.analysis }, context));
console.log(JSON.stringify({
	schemas: Object.fromEntries(MCP_TOOLS.map((tool) => [tool.name, tool.inputSchema])),
	annotations: Object.fromEntries(MCP_TOOLS.map((tool) => [tool.name, tool.annotations])),
	listed: [...MCP_TOOLS, ...PLUGIN_TOOLS].map(listedTool),
	movedSave: await tool("analyses").run({}, { action: "save", analysis: "a", finalAnswer: "x" }, context),
	movedShare: await tool("analyses").run({}, { action: "share", analysis: "a", shared: true }, context),
	movedMessage: ANALYSES_MOVED_TO_SAVE_ANALYSIS,
	draft,
	revision,
	flow,
}));`,
		],
		{
			env: {
				PATH: process.env.PATH,
				PG_CONNECTION_STRING: "postgres://unused@127.0.0.1:1/unused",
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
			source: { type: "string", enum: ["runs", "tool", "user"] },
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
	expect(schemas.analyses).toMatchObject({
		type: "object",
		additionalProperties: false,
		properties: {
			action: { enum: ["search", "get", "query"], default: "search" },
			limit: { default: 10 },
			analysis: { type: "string" },
			query: { type: "string" },
			workspace: { type: "string" },
		},
	});
	expect(schemas.analyses).not.toHaveProperty("required");
	expect(schemas.analyses?.properties).not.toHaveProperty("finalAnswer");
	expect(schemas.analyses?.properties).not.toHaveProperty("shared");
	expect(schemas.save_analysis).toMatchObject({
		type: "object",
		additionalProperties: false,
		properties: {
			action: { enum: ["save", "share"], default: "save" },
			analysis: { type: "string" },
			finalAnswer: { type: "string" },
			findings: { type: "array", default: [] },
			shared: { type: "boolean" },
			workspace: { type: "string" },
		},
	});
	expect(schemas.save_analysis).not.toHaveProperty("required");
});

test("every tool declares annotations, and only the tools that write are not read-only", async () => {
	const { annotations } = await loaded;
	const readOnly = {
		readOnlyHint: true,
		destructiveHint: false,
		openWorldHint: false,
	};
	const writes = {
		readOnlyHint: false,
		destructiveHint: false,
		openWorldHint: false,
	};

	for (const [name, value] of Object.entries(annotations)) {
		expect({ name, ...value }).toEqual({
			name,
			...(["find", "read", "save_analysis", "settings_update"].includes(name)
				? writes
				: readOnly),
		});
	}
	expect(annotations.find).toEqual(writes);
	expect(annotations.read).toEqual(writes);
	expect(annotations.analyses).toEqual(readOnly);
	expect(annotations.save_analysis).toEqual(writes);
});

test("analyses answers the old save and share actions with a plain pointer to save_analysis", async () => {
	const { movedSave, movedShare, movedMessage } = await loaded;

	expect(movedMessage).toContain("save_analysis");
	expect(movedSave).toBe(movedMessage);
	expect(movedShare).toBe(movedMessage);
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
			"analyses",
			"find",
			"get_dashboard",
			"list_workspaces",
			"read",
			"save_analysis",
		].sort(),
	);
});

test("every tool the model sees has a plain title and the same five short description lines, and every input is described in one plain line", async () => {
	const { listed } = await loaded;
	const visible = listed.filter(
		(tool) => !tool._meta?.ui?.visibility?.includes("app"),
	);
	for (const tool of visible) {
		const lines = tool.description.split("\n");
		expect({
			name: tool.name,
			title: tool.title.trim().length > 0,
			annotationTitle: tool.annotations.title,
			sections: lines.map((line, index) =>
				line.startsWith(SECTIONS[index] ?? "?"),
			),
			short: tool.description.length < 600,
			jargon: tool.description.match(JARGON)?.[0] ?? null,
		}).toEqual({
			name: tool.name,
			title: true,
			annotationTitle: tool.title,
			sections: SECTIONS.map(() => true),
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

test("find, read and save_analysis describe the private draft and the append-only save", async () => {
	const { listed } = await loaded;
	const description = (name: string) =>
		listed.find((tool) => tool.name === name)?.description ?? "";
	for (const name of ["find", "read"])
		expect(description(name)).toContain(
			"Nobody can see this unfinished answer, not even the user, until save_analysis saves it.",
		);
	expect(description("save_analysis")).toContain(
		"Nothing is posted outside Opaline. A saved answer is never changed or deleted; an update is saved as a new answer linked to it.",
	);
	expect(description("analyses")).toContain("Side effects: None.");
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
		error: `Analysis ${id} is an unsaved draft; save it with save_analysis first, then share it`,
	});
	expect(flow.save).toEqual({
		result: `saved analysis=${id} status=finished`,
	});
	expect(flow.saveAgain).toEqual({
		error: `This analysis is already saved. To revise it, save a new analysis that passes updates=${id}.`,
	});
	expect(errorOf(flow.reviseWithoutChanges)).toBe(
		`Analysis ${started.analysis} updates ${id}, so changes needs exactly one item per finding saved now, naming its step by id or exact sub-question (plus change=dropped items for findings of ${id} that no longer hold): no change for the finding of ${started.step} ("(no step given)"). Nothing was saved.`,
	);
	const saved = resultOf(flow.revise);
	expect(saved).toMatch(/^saved analysis=a_\S+ status=finished$/);
	const revisionId = saved.split(/[= ]/)[2];
	const prior = resultOf(flow.getPrior);
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
