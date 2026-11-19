import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

const ORIGIN_MAIN_PUBLISHED_SHA256 =
	"713e34b25b485bd883399f89fca351d67d373f8204d3dcd76943435349b1d646";

interface Listed {
	name: string;
	description: string;
	inputSchema: {
		properties: Record<string, { enum?: string[]; description?: string }>;
	};
	annotations: Record<string, unknown>;
}

async function listings(): Promise<{ published: string; retro: Listed[] }> {
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`const { MCP_TOOLS, listedTool, retroListedTool } = await import(${JSON.stringify(new URL("./mcp-tools.ts", import.meta.url).href)});
const { PLUGIN_TOOLS } = await import(${JSON.stringify(new URL("./plugin-tools.ts", import.meta.url).href)});
const { toolsListedFor } = await import(${JSON.stringify(new URL("./retro-listing.ts", import.meta.url).href)});
const tools = [...MCP_TOOLS, ...PLUGIN_TOOLS];
console.log(JSON.stringify({ published: JSON.stringify(toolsListedFor(tools, false).map(listedTool)), retro: toolsListedFor(tools, true).map(retroListedTool) }));`,
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

const loaded = listings();

test("the published tool list is byte-identical to origin/main's", async () => {
	const { published } = await loaded;
	expect(createHash("sha256").update(published).digest("hex")).toBe(
		ORIGIN_MAIN_PUBLISHED_SHA256,
	);
	for (const retroOnly of ["idempotentHint", "CRITICAL: Be minimalist"])
		expect({ retroOnly, published: published.includes(retroOnly) }).toEqual({
			retroOnly,
			published: false,
		});
});

test("the retro find lists filters, random order, offset, verbosity and its long description", async () => {
	const { retro } = await loaded;
	const find = retro.find((tool) => tool.name === "find");
	const properties = find?.inputSchema.properties ?? {};
	for (const key of ["filters", "parentSessionId", "offset", "verbosity"])
		expect(Object.keys(properties)).toContain(key);
	expect(properties.sort?.enum).toContain("random");
	expect(find?.description).toContain("CRITICAL: Be minimalist");
	expect(find?.annotations.idempotentHint).toBe(false);
});
