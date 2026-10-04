import { expect, test } from "bun:test";

/**
 * Loads MCP_TOOLS in a child process: the module opens the Postgres pool on
 * import (without connecting), so it needs a connection string but no database.
 */
async function analysisToolSchemas(): Promise<Record<string, unknown>> {
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`const { MCP_TOOLS } = await import(${JSON.stringify(new URL("./mcp-tools.ts", import.meta.url).href)});
console.log(JSON.stringify(Object.fromEntries(MCP_TOOLS.filter((tool) => ["find", "read", "analyses"].includes(tool.name)).map((tool) => [tool.name, tool.inputSchema]))));`,
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

test("analysis tools publish closed input schemas with defaults and a workspace", async () => {
	const schemas = await analysisToolSchemas();

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
			action: {
				enum: ["search", "get", "query", "save", "share"],
				default: "search",
			},
			limit: { default: 10 },
			findings: { type: "array", default: [] },
			query: { type: "string" },
			shared: { type: "boolean" },
			workspace: { type: "string" },
		},
	});
	expect(schemas.analyses).not.toHaveProperty("required");
});
