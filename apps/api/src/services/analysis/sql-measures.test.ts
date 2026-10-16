import { expect, test } from "bun:test";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import type { AgentQueryLimiter } from "./agent-query-slots.js";
import { describeSchema } from "./sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "./sql-results.js";

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
		"events",
		"prompts",
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
