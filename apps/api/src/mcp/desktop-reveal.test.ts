import { expect, test } from "bun:test";

async function shownPages(env: Record<string, string>): Promise<string[]> {
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`const { desktopApp } = await import(${JSON.stringify(new URL("../selfhost/desktop-app.ts", import.meta.url).href)});
const { MCP_TOOLS } = await import(${JSON.stringify(new URL("./mcp-tools.ts", import.meta.url).href)});
const shown = [];
const show = desktopApp.show;
desktopApp.show = (url) => { shown.push(url); return false; };
const tool = (name) => MCP_TOOLS.find((candidate) => candidate.name === name);
const context = { userId: "u", workspace: { id: "w", slug: "acme" }, authSession: {} };
const metric = { total: 1, incomplete: false, series: [], trend: [{ date: "2026-11-01", total: 1, values: {} }], breakdowns: {} };
const client = {
	analysis: {
		coverage: async () => ({ line: "" }),
		history: { save: async () => ({ analysis: "an_1", status: "saved" }) },
	},
	analytics: { overview: { costs: async () => ({ availableMetrics: ["cost"], splitBy: "none", metrics: { cost: metric } }) } },
	listMyOrganizations: async () => [{ id: "w", slug: "acme", name: "Acme" }],
};
await tool("save_answer").run(client, { analysis: "an_1", question: "Q", finalAnswer: "A" }, context);
await tool("get_dashboard").run(client, { startDate: "2026-11-01", endDate: "2026-11-07", repositories: ["a/b"] }, context);
desktopApp.show = show;
console.log(JSON.stringify({ shown, real: desktopApp.show("http://localhost:4100/acme/reports/an_1") }));`,
		],
		{
			env: {
				PATH: process.env.PATH ?? "",
				PG_CONNECTION_STRING: "postgres://unused@127.0.0.1:1/unused",
				ALLOWED_ORIGIN: "http://localhost:4100",
				...env,
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
	const { shown, real } = JSON.parse(stdout);
	expect(real).toBe(false);
	return shown;
}

test("save_answer and get_dashboard ask the desktop app to show their page", async () => {
	expect(await shownPages({})).toEqual([
		"http://localhost:4100/acme/reports/an_1",
		"http://localhost:4100/acme/dashboard?from=2026-11-01&to=2026-11-07&repo=a%2Fb",
	]);
});
