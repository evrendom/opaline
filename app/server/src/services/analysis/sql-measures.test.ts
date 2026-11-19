import { expect, test } from "bun:test";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import type { AgentQueryLimiter } from "./agent-query-slots.js";
import { describeSchema } from "./sql-gateway.js";
import { regexLiteral } from "./sql-measures.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "./sql-results.js";
import { SQL_VIEWS } from "./sql-views.js";

/** Every query gets a slot at once. */
const unlimited: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};

const unused: ClickHouseExecutor = {
	close: async () => {},
	execute: async () => {},
	insert: async () => {},
	query: async () => {
		throw new Error("listing the views reads nothing");
	},
};

test("schema lists the approved impact measures with their definitions next to the views", async () => {
	const outcome = await describeSchema(
		{
			workspaceId: "ws-1",
			reader: { userId: "member-1", role: "member", ownSessionsOnly: false },
		},
		{},
		{
			executor: unused,
			results: createMemorySqlResultStore(),
			quota: createMemorySqlQuota({ queries: 1, windowMs: 60_000 }),
			limiter: unlimited,
			githubRepositories: async () => [],
		},
	);
	if (!outcome.ok || outcome.result.level !== "views")
		throw new Error("Expected views");
	const measures = new Map(
		outcome.result.measures.map((measure) => [measure.name, measure]),
	);
	expect([...measures.keys()]).toEqual([
		"active_time",
		"cost",
		"tokens",
		"runs",
		"members",
		"re_asks",
		"frustration",
		"group_run_time",
		"group_call_time",
	]);
	expect(measures.get("re_asks")).toMatchObject({ sql: "countIf(reasked)" });
	expect(measures.get("re_asks")?.definition).toContain("said_done");
	expect(measures.get("group_call_time")?.sql).toContain("FROM calls");
	expect(outcome.result.notes.join(" ")).toContain("approved measures");
	expect(outcome.result.views.map((view) => view.name)).toEqual([
		"runs",
		"calls",
		"requests",
		"session_activity",
		"events",
		"prompts",
		"model_text",
		"git_events",
		"edges",
		"setup_files",
		"ci_jobs",
		"session_links",
		"setup_snapshots",
		"finding_runs",
		"run_answers",
	]);
});

test("regexps reach ClickHouse in RE2 syntax: code points as \\x{…}, never \\u", () => {
	const literal = regexLiteral(/(\berror\b|\u2717)/iu);
	expect(literal).toStartWith("'(?i)(\\\\berror\\\\b|");
	expect(literal).toContain("\\\\x{2717}");
	expect(literal).not.toMatch(/\\u[0-9a-fA-F]{4}/u);
	for (const view of SQL_VIEWS)
		expect({
			view: view.name,
			escapes: /\\\\u[0-9a-fA-F]{4}/u.test(view.sql(false, {})),
		}).toEqual({
			view: view.name,
			escapes: false,
		});
});
