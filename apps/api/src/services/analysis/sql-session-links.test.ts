import { afterEach, describe, expect, test } from "bun:test";
import { splitSessionTranscript } from "@rudel/api-routes/transcript-records";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import type { AgentQueryLimiter } from "./agent-query-slots.js";
import { runFactsCtes } from "./run-index-sql.js";
import { runSql } from "./sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "./sql-results.js";
import {
	FORK_ORDINAL_PATH,
	FORKED_FROM_PATH,
	PARENT_THREAD_PATHS,
} from "./sql-session-links.js";
import { findSqlView } from "./sql-views.js";

const unlimited: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};

/** The statement and parameters the agent's query runs as, with ClickHouse answering nothing. */
async function sent(
	query: string,
	ownSessionsOnly = false,
): Promise<ClickHouseStatement> {
	const statements: ClickHouseStatement[] = [];
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {},
		insert: async () => {},
		query: async <T>(statement: ClickHouseStatement) => {
			statements.push(statement);
			return [] as T[];
		},
	};
	const outcome = await runSql(
		{
			workspaceId: "ws-1",
			reader: { userId: "member-1", role: "member", ownSessionsOnly },
		},
		{ query, title: "Session links" },
		{
			executor,
			results: createMemorySqlResultStore(),
			quota: createMemorySqlQuota({ queries: 10, windowMs: 3_600_000 }),
			limiter: unlimited,
			githubRepositories: async () => [],
		},
	);
	if (!outcome.ok)
		throw new Error(`Expected a result: ${outcome.error.message}`);
	const statement = statements.find(
		(item) =>
			item.clickhouse_settings?.readonly === "1" &&
			!item.query.startsWith("EXPLAIN AST "),
	);
	if (!statement) throw new Error("Expected the agent's statement");
	return statement;
}

const view = () => {
	const found = findSqlView("session_links");
	if (!found) throw new Error("Expected the session_links view");
	return found;
};

const consumers = process.env.SESSION_LINEAGE_CONSUMERS_ENABLED;
afterEach(() => {
	if (consumers === undefined)
		delete process.env.SESSION_LINEAGE_CONSUMERS_ENABLED;
	else process.env.SESSION_LINEAGE_CONSUMERS_ENABLED = consumers;
});

describe("the session_links view reads what the parser stores", () => {
	const meta = (payload: Record<string, unknown>) =>
		JSON.stringify({
			type: "session_meta",
			timestamp: "2026-10-09T09:00:00Z",
			payload,
		});
	const rows = [
		...splitSessionTranscript({
			source: "codex",
			sessionDate: "2026-10-09T09:00:00Z",
			content: [
				meta({
					id: "child",
					parent_thread_id: "parent",
					forked_from_id: "parent",
					subagent_history_start_ordinal: 4,
					source: {
						subagent: { thread_spawn: { parent_thread_id: "parent" } },
					},
				}),
				meta({ id: "parent", forked_from_id: "grandparent" }),
			].join("\n"),
		}),
	];

	test("a thread's parent, fork and fork point are components at the paths the view reads", () => {
		const own = rows[0];
		expect(own?.kind).toBe("meta");
		expect(own?.subtype).toBe("session_meta");
		expect(own?.agentId).toBe("");
		const paths = (
			key: "parent_session_components" | "fork_point_components",
		) =>
			(
				JSON.parse(own?.facts.extra[key] ?? "[]") as {
					path: string;
					value: unknown;
				}[]
			)
				.map((component) => [component.path, component.value])
				.sort();
		expect(paths("parent_session_components")).toEqual([
			[FORKED_FROM_PATH, "parent"],
			[PARENT_THREAD_PATHS[0], "parent"],
			[PARENT_THREAD_PATHS[1], "parent"],
		]);
		expect(paths("fork_point_components")).toEqual([[FORK_ORDINAL_PATH, 4]]);
	});

	test("only a thread's first session_meta is its own, as the run index's fork links read it", () => {
		// The copied parent meta comes later and names the grandparent.
		expect(rows[1]?.facts.extra.parent_session_components).toContain(
			'"value":"grandparent"',
		);
		expect(rows[0]?.recordIdx).toBeLessThan(rows[1]?.recordIdx ?? 0);
		const sql = view().sql(false);
		expect(sql).toContain(
			"argMin(tuple(ts, facts['parent_session_components']",
		);
		expect(sql).not.toContain("fork_replayed");
		expect(runFactsCtes()).toContain("min(record_idx)");
	});
});

describe("the session_links view keeps to the caller's sessions", () => {
	test("both ends must be sessions the run index holds for the workspace", async () => {
		const statement = await sent(
			"SELECT kind, count() FROM session_links GROUP BY kind",
		);
		const query = statement.query;
		expect(query).toContain(
			"(user_id, from_session_id) IN (SELECT user_id, session_id FROM session_links_readable)",
		);
		expect(query).toContain(
			"(user_id, to_session_id) IN (SELECT user_id, session_id FROM session_links_readable)",
		);
		// The run index, the transcript facts and the lineage table are each read for the workspace only.
		expect(
			query.match(/organization_id = \{opaline_workspace:String\}/g)?.length,
		).toBe(3);
		expect(query).not.toContain("opaline_member");
		expect(statement.query_params).toMatchObject({ opaline_workspace: "ws-1" });
	});

	test("a member kept to their own sessions reads only their own links", async () => {
		const statement = await sent("SELECT count() FROM session_links", true);
		expect(
			statement.query.match(
				/organization_id = \{opaline_workspace:String\} AND user_id = \{opaline_member:String\}/g,
			)?.length,
		).toBe(3);
		expect(statement.query_params).toMatchObject({
			opaline_workspace: "ws-1",
			opaline_member: "member-1",
		});
	});

	test("delegations are read only where the server reads matched lineage", () => {
		process.env.SESSION_LINEAGE_CONSUMERS_ENABLED = "false";
		const native = view().sql(false);
		expect(native).toContain(
			"confidence = 'native_parent_id' AND countable = 1",
		);
		expect(native).not.toContain("prompt_echo'");
		process.env.SESSION_LINEAGE_CONSUMERS_ENABLED = "true";
		expect(view().sql(false)).toContain(
			"OR confidence IN ('id_echo', 'prompt_echo', 'attested_temporal')",
		);
	});

	test("schema describes every column the statement selects", () => {
		const sql = view().sql(false);
		const select = sql.slice(
			sql.indexOf("SELECT user_id, from_session_id"),
			sql.indexOf("FROM ("),
		);
		for (const column of view().columns) {
			expect(select).toMatch(new RegExp(`\\b${column.name}\\b`));
		}
		expect(view().columns.map((column) => column.name)).toEqual([
			"user_id",
			"from_session_id",
			"from_source",
			"to_session_id",
			"to_source",
			"kind",
			"copies_history",
			"fork_ordinal",
			"basis",
			"carrier",
			"outcome",
			"from_call_id",
			"at",
		]);
	});
});
