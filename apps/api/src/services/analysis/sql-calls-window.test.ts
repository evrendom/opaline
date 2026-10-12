import { describe, expect, test } from "bun:test";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import type { AgentQueryLimiter } from "./agent-query-slots.js";
import { runSql } from "./sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "./sql-results.js";

/** Every query gets a slot at once. */
const unlimited: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};

/** The statement the agent's query runs as, with ClickHouse answering nothing. */
async function sent(query: string): Promise<string> {
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
			reader: { userId: "member-1", role: "member", ownSessionsOnly: false },
		},
		{ query, title: "Calls" },
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
	return statement?.query ?? "";
}

describe("the calls view reads only the time range a query keeps", () => {
	/** The started_at bounds the calls view read first, per reference of it. */
	async function windows(query: string): Promise<string[]> {
		const statement = await sent(query);
		expect(statement).not.toMatch(/FROM calls\b/u);
		return [
			...statement.matchAll(
				/WHERE [^\n]*? AND kind = 'tool_call' AND (ts [^\n]*?)\) AS opaline_window_sessions/gu,
			),
		].map((match) => match[1] ?? "");
	}

	test("a range ANDed into the WHERE that reads calls, on its own or through its alias, bounds the sessions read", async () => {
		expect(
			await windows(`SELECT tool_name, count() FROM calls
				WHERE started_at >= now() - INTERVAL 30 DAY AND tool_name != 'Read'
				GROUP BY tool_name`),
		).toEqual(["ts >= (now ( ) - INTERVAL 30 DAY)"]);
		expect(
			await windows(`SELECT c.tool_name, r.active_minutes FROM calls AS c
				JOIN runs AS r ON r.run_id = c.run_id
				WHERE '2026-10-01' > c.started_at AND c.started_at BETWEEN toDateTime('2026-09-01') AND now()`),
		).toEqual(["ts >= (toDateTime ( '2026-09-01' )) AND ts <= ('2026-10-01')"]);
		expect(
			await windows(`SELECT sum(active_minutes) FROM runs WHERE run_id IN (
				SELECT run_id FROM calls WHERE tool_name = 'Bash' AND started_at < today()) AND started_at >= today() - 7`),
		).toEqual(["ts <= (today ( ))"]);
		// OR inside parentheses or CASE does not reach the conditions ANDed with it.
		expect(
			await windows(`SELECT count() FROM calls
				WHERE (tool_name = 'Bash' OR tool_name = 'exec_command')
					AND CASE WHEN call_minutes > 1 OR call_minutes IS NULL THEN 1 ELSE 0 END = 1
					AND started_at >= toDate('2026-09-01')`),
		).toEqual(["ts >= (toDate ( '2026-09-01' ))"]);
	});

	test("a condition that may not hold for every row kept, or is not a constant range, reads every session as before", async () => {
		for (const query of [
			// Rows kept by the other side of OR may lie outside the range.
			"SELECT count() FROM calls WHERE started_at >= today() - 7 OR tool_name = 'Bash'",
			"SELECT count() FROM calls WHERE tool_name = 'Bash' ? 1 : call_minutes > 1 AND started_at >= today() - 7",
			// started_at names an expression here, not the view's column.
			"SELECT toStartOfDay(started_at) AS started_at, count() FROM calls WHERE started_at >= today() - 7 GROUP BY started_at",
			"SELECT started_at - INTERVAL 1 DAY started_at FROM calls WHERE started_at >= today() - 7",
			// An outer join keeps rows calls does not have.
			"SELECT count() FROM calls AS c RIGHT JOIN runs AS r ON r.run_id = c.run_id WHERE c.started_at < now()",
			// Pairs rows by position: fewer calls would pair differently.
			"SELECT c.call_id, r.run_id FROM calls AS c PASTE JOIN runs AS r WHERE c.started_at < now()",
			// Unqualified in a join, started_at may be the other table's.
			"SELECT count() FROM calls AS c JOIN runs AS r ON r.run_id = c.run_id WHERE started_at >= today() - 7",
			// Not constants: columns, inside functions too.
			"SELECT count() FROM calls WHERE started_at >= session_date",
			"SELECT count() FROM calls WHERE started_at >= now() - toIntervalSecond(length(tool_name))",
			"SELECT count() FROM calls WHERE NOT started_at < today() - 7",
		])
			expect(await windows(query)).toEqual([]);
	});
});

describe("a time range bounds every transcript read of the calls and prompts views", () => {
	test("the results calls are timed and failed by are read only in the sessions with calls in the range", async () => {
		const statement = await sent(
			`SELECT command_fingerprint, countIf(failed), sum(call_minutes) FROM calls
			WHERE started_at >= '2026-10-03 00:00:00' GROUP BY command_fingerprint`,
		);
		// The scan of the calls and their results, up to its grouping.
		const scan = statement.match(
			/PREWHERE kind IN \('tool_call', 'tool_result'\)[\s\S]*?HAVING/u,
		)?.[0];
		expect(scan).toContain("IN (SELECT arrayJoin(opaline_window_sessions))");
	});

	test("prompts read only the sessions with a prompt in the range, and their runs", async () => {
		const statement = await sent(
			`SELECT text FROM prompts WHERE at >= '2026-10-03 00:00:00' AND genuine = 1`,
		);
		expect(statement).toMatch(
			/WHERE [^\n]*? AND kind IN \('user_prompt', 'injected_context'\) AND ts >= \('2026-10-03 00:00:00'\)\) AS opaline_window_sessions/u,
		);
		expect(
			statement.match(/IN \(SELECT arrayJoin\(opaline_window_sessions\)\)/gu),
		).toHaveLength(2);
		const unbounded = await sent(
			"SELECT text FROM prompts WHERE at >= '2026-10-03 00:00:00' OR genuine = 1",
		);
		expect(unbounded).not.toContain("opaline_window_sessions");
	});
});
