import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { toolsListedFor } from "./retro-listing.js";

interface Listed {
	name: string;
	description: string;
	inputSchema: { properties: Record<string, { description?: string }> };
}

const PUBLISHED_TOOLS_SHA256 =
	"c97f6a8b8d7064cb74c7d1998e7cb84d169a5386f66fd04fe64f58b8df33192e";

const SESSIONS_REMINDER =
	"use groupBy=session instead of calling find once per session";

async function listings(): Promise<{ listed: Listed[]; retro: Listed[] }> {
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`const { MCP_TOOLS, listedTool, retroListedTool } = await import(${JSON.stringify(new URL("./mcp-tools.ts", import.meta.url).href)});
const { PLUGIN_TOOLS } = await import(${JSON.stringify(new URL("./plugin-tools.ts", import.meta.url).href)});
const { toolsListedFor } = await import(${JSON.stringify(new URL("./retro-listing.ts", import.meta.url).href)});
const tools = [...MCP_TOOLS, ...PLUGIN_TOOLS];
console.log(JSON.stringify({ listed: tools.map(listedTool), retro: toolsListedFor(tools, true, true).map(retroListedTool) }));`,
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

test("the published tool list is byte-identical: the sessions guidance and drill reach only the retro listing", async () => {
	const { listed } = await loaded;
	const published = JSON.stringify(toolsListedFor(listed, false));
	expect(createHash("sha256").update(published).digest("hex")).toBe(
		PUBLISHED_TOOLS_SHA256,
	);
	expect(published).not.toContain(SESSIONS_REMINDER);
	expect(published).not.toContain("drill");
});

test("the retro find says to list the sessions behind a group with groupBy=session, in its use, examples and reminders", async () => {
	const { listed, retro } = await loaded;
	const find = retro.find((tool) => tool.name === "find");
	const published = listed.find((tool) => tool.name === "find");
	const lines = find?.description.split("\n") ?? [];
	expect(lines[1]).toStartWith(
		"Use when: Start here for questions about how agents worked",
	);
	expect(lines[1]).toContain(SESSIONS_REMINDER);
	const examples = lines.slice(
		lines.indexOf("Examples:"),
		lines.indexOf("Reminders:"),
	);
	expect(examples.some((line) => line.includes('"groupBy":"session"'))).toBe(
		true,
	);
	const reminders = lines.slice(lines.indexOf("Reminders:"));
	expect(reminders.some((line) => line.includes(SESSIONS_REMINDER))).toBe(true);
	expect(reminders).toContain(
		"- When a failure keeps happening, offer to save it as a check.",
	);
	const groupBy = find?.inputSchema.properties.groupBy;
	const publishedGroupBy = published?.inputSchema.properties.groupBy;
	expect(groupBy?.description).toStartWith(
		publishedGroupBy?.description ?? "?",
	);
	expect(groupBy?.description).toContain(
		"source=tool, user or calls: session gives one row per session",
	);
	expect({ ...groupBy, description: "" }).toEqual({
		...publishedGroupBy,
		description: "",
	});
});

test("measures run takes drill, and its description says to use it instead of one call per session", async () => {
	const { retro } = await loaded;
	const measures = retro.find((tool) => tool.name === "measures");
	expect(Object.keys(measures?.inputSchema.properties ?? {})).toContain(
		"drill",
	);
	const description = measures?.description ?? "";
	for (const part of [
		"for the sessions behind a row, use drill, not one find per session",
		"time_lost_by_cause {kind, cause}",
		"files_hunted_before_edit {file}",
		"repeated_commands {family}",
		"local_pass_then_ci_fail {outcome}",
		"cohort and repeated_corrections rows are sessions already",
		"Examples:",
		"Reminders:",
	])
		expect({ part, has: description.includes(part) }).toEqual({
			part,
			has: true,
		});
});
