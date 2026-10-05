import { expect, test } from "bun:test";

/**
 * Loads MCP_TOOLS in a child process: the module opens the Postgres pool on
 * import (without connecting), so it needs a connection string but no database.
 */
interface LoadedTools {
	schemas: Record<string, Record<string, unknown>>;
	annotations: Record<string, Record<string, boolean>>;
	movedSave: unknown;
	movedShare: unknown;
	movedMessage: string;
}

async function loadTools(): Promise<LoadedTools> {
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`const { MCP_TOOLS, ANALYSES_MOVED_TO_SAVE_ANALYSIS } = await import(${JSON.stringify(new URL("./mcp-tools.ts", import.meta.url).href)});
const analyses = MCP_TOOLS.find((tool) => tool.name === "analyses");
const context = { userId: "u", workspace: { id: "w", slug: "w" }, authSession: {} };
console.log(JSON.stringify({
	schemas: Object.fromEntries(MCP_TOOLS.map((tool) => [tool.name, tool.inputSchema])),
	annotations: Object.fromEntries(MCP_TOOLS.map((tool) => [tool.name, tool.annotations])),
	movedSave: await analyses.run({}, { action: "save", analysis: "a", finalAnswer: "x" }, context),
	movedShare: await analyses.run({}, { action: "share", analysis: "a", shared: true }, context),
	movedMessage: ANALYSES_MOVED_TO_SAVE_ANALYSIS,
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
			...(["save_analysis", "settings_update"].includes(name)
				? writes
				: readOnly),
		});
	}
	expect(annotations.find).toEqual(readOnly);
	expect(annotations.read).toEqual(readOnly);
	expect(annotations.analyses).toEqual(readOnly);
	expect(annotations.save_analysis).toEqual(writes);
});

test("analyses answers the old save and share actions with a plain pointer to save_analysis", async () => {
	const { movedSave, movedShare, movedMessage } = await loaded;

	expect(movedMessage).toContain("save_analysis");
	expect(movedSave).toBe(movedMessage);
	expect(movedShare).toBe(movedMessage);
});
