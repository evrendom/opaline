import { describe, expect, test } from "bun:test";
import { parseError } from "@clickhouse/client-web";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import {
	AgentQueryBusyError,
	type AgentQueryLimiter,
} from "./agent-query-slots.js";
import {
	describeSchema,
	NOT_EVIDENCE,
	runSql,
	type SqlCaller,
	type SqlOutcome,
} from "./sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "./sql-results.js";

/**
 * ClickHouse as the gateway sees it: every statement it sends is kept, and
 * each answers with the rows (or the error) the test gives for it.
 */
function clickhouse(
	answer: (statement: ClickHouseStatement) => unknown[] | Error = () => [],
) {
	const statements: ClickHouseStatement[] = [];
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {},
		insert: async () => {},
		query: async <T>(statement: ClickHouseStatement) => {
			statements.push(statement);
			const rows = answer(statement);
			if (rows instanceof Error) throw rows;
			return rows as T[];
		},
	};
	return { executor, statements };
}

const callerOf = (
	userId: string,
	role: "member" | "admin",
	ownSessionsOnly: boolean,
): SqlCaller => ({
	workspaceId: "ws-1",
	reader: { userId, role, ownSessionsOnly },
});
/** A member of a workspace with the own-sessions-only option on: reads only their own sessions. */
const member = callerOf("member-1", "member", true);
/** An admin of that workspace: reads every member's sessions. */
const admin = callerOf("admin-1", "admin", true);
/** A member of a workspace with the option off (the default): reads every member's sessions. */
const teammate = callerOf("member-1", "member", false);

function environment(
	answer?: Parameters<typeof clickhouse>[0],
	queries = 100,
	{ busy = false } = {},
) {
	const { executor, statements } = clickhouse(answer);
	const results = createMemorySqlResultStore();
	/** Statements sent while a query slot was held, with the slot's workspace. */
	const slotted: { workspaceId: string; statement: ClickHouseStatement }[] = [];
	let holder: string | null = null;
	const limiter: AgentQueryLimiter = {
		async withAgentQuerySlot(workspaceId, work) {
			if (busy) throw new AgentQueryBusyError();
			holder = workspaceId;
			try {
				return await work();
			} finally {
				holder = null;
			}
		},
	};
	return {
		statements,
		slotted,
		results,
		env: {
			executor: {
				...executor,
				query: async <T>(statement: ClickHouseStatement) => {
					if (holder !== null) slotted.push({ workspaceId: holder, statement });
					return executor.query<T>(statement);
				},
			},
			results,
			quota: createMemorySqlQuota({ queries, windowMs: 3_600_000 }),
			limiter,
		},
	};
}

/** A ClickHouse refusal as the client reports it. */
const refusal = (text: string) =>
	parseError(`Code: 1. DB::Exception: ${text} (version 26.8.2.1)\n`);

/** The agent's own statement: the one that runs read-only (lookups do not). */
const isParse = (statement: ClickHouseStatement) =>
	statement.query.startsWith("EXPLAIN AST ");
const isAgentStatement = (statement: ClickHouseStatement) =>
	statement.clickhouse_settings?.readonly === "1" && !isParse(statement);
const agentStatement = (statements: readonly ClickHouseStatement[]) =>
	statements.find(isAgentStatement);

function ok(outcome: SqlOutcome) {
	if (!outcome.ok)
		throw new Error(`Expected a result: ${outcome.error.message}`);
	return outcome.result;
}

function failure(outcome: SqlOutcome) {
	if (outcome.ok) throw new Error("Expected an error, got a result");
	return outcome.error;
}

const RANKING = `SELECT session_id, agent_id, turn_idx, active_minutes
	FROM runs
	WHERE started_at >= now() - INTERVAL 30 DAY
	ORDER BY active_minutes DESC
	LIMIT 20`;

describe("sql over the runs view", () => {
	test("with own sessions only on, a member's query reads only their own runs in the workspace, bound as parameters, read-only and within limits", async () => {
		const { env, statements } = environment((statement) =>
			isAgentStatement(statement)
				? [
						{
							session_id: "s1",
							agent_id: "",
							turn_idx: 3,
							active_minutes: 41.5,
						},
					]
				: [],
		);

		const result = ok(
			await runSql(member, { query: RANKING, title: "Longest runs" }, env),
		);

		const sent = agentStatement(statements);
		expect(sent?.query_params).toMatchObject({
			opaline_workspace: "ws-1",
			opaline_member: "member-1",
		});
		// The ids travel only as bound parameters, never inside the SQL text.
		expect(sent?.query).not.toContain("ws-1");
		expect(sent?.query).not.toContain("member-1");
		expect(sent?.clickhouse_settings).toMatchObject({
			readonly: "1",
			max_execution_time: 10,
		});
		expect(result.table).toBe(
			[
				"session_id | agent_id | turn_idx | active_minutes",
				"s1 |  | 3 | 41.5",
			].join("\n"),
		);
		expect(result.title).toBe("Longest runs");
		expect(result.id).toMatch(/^sr_/);
	});
});

describe("scope and storage", () => {
	test("by default a member reads every member's runs of the workspace, and the result covers every member", async () => {
		const { env, statements, results } = environment((statement) =>
			statement.query.includes("DISTINCT user_id")
				? [{ user_id: "member-1" }, { user_id: "member-2" }]
				: [],
		);

		const result = ok(
			await runSql(teammate, { query: RANKING, title: "Team" }, env),
		);

		expect(agentStatement(statements)?.query_params).toEqual({
			opaline_workspace: "ws-1",
		});
		expect(agentStatement(statements)?.query).not.toContain("opaline_member");
		expect(results.records.get(result.id)?.owners).toEqual([
			"member-1",
			"member-2",
		]);
	});

	test("with own sessions only on, a member's result covers only them", async () => {
		const { env, results } = environment();
		const result = ok(
			await runSql(member, { query: RANKING, title: "Mine" }, env),
		);
		expect(results.records.get(result.id)?.owners).toEqual(["member-1"]);
	});

	test("an admin's query reads every member's runs of the workspace and is stored with the members it covered and the sessions it names", async () => {
		const { env, statements, results } = environment((statement) => {
			if (isAgentStatement(statement))
				return [
					{ session_id: "s1", user_id: "member-1", minutes: 3 },
					{ session_id: "s2", user_id: "member-2", minutes: 2 },
				];
			if (statement.query.includes("DISTINCT user_id"))
				return [{ user_id: "member-1" }, { user_id: "member-2" }];
			if (statement.query.includes("any(user_id)"))
				return [
					{ session_id: "s1", user_id: "member-1" },
					{ session_id: "s2", user_id: "member-2" },
				];
			return [
				{
					session_id: statement.query_params?.sessionIds
						? (statement.query_params.sessionIds as string[])[0]
						: "",
					revision_text: "7",
					parser_version: 9,
				},
			];
		});

		const result = ok(
			await runSql(
				admin,
				{
					query: "SELECT session_id, user_id, minutes FROM runs",
					title: "All",
				},
				env,
			),
		);

		const sent = agentStatement(statements);
		expect(sent?.query_params).toEqual({ opaline_workspace: "ws-1" });
		expect(result.sessions).toEqual([
			{ sessionId: "s1", ownerId: "member-1", revision: "7", parserVersion: 9 },
			{ sessionId: "s2", ownerId: "member-2", revision: "7", parserVersion: 9 },
		]);
		expect(results.records.get(result.id)).toMatchObject({
			workspaceId: "ws-1",
			authorId: "admin-1",
			title: "All",
			query: "SELECT session_id, user_id, minutes FROM runs",
			owners: ["member-1", "member-2"],
			output: { table: result.table, sessions: result.sessions },
		});
	});

	test("the runs view keeps each session's committed build and runs only, under any alias, in subqueries and WITH", async () => {
		const { env, statements } = environment();

		ok(
			await runSql(
				member,
				{
					query: `WITH top AS (SELECT session_id, sum(active_minutes) AS m FROM runs GROUP BY session_id)
						SELECT r.session_id, top.m FROM runs AS r JOIN top ON top.session_id = r.session_id
						WHERE r.session_id IN (SELECT session_id FROM runs WHERE failed_calls > 0)`,
					title: "Join",
				},
				env,
			),
		);

		const sent = agentStatement(statements)?.query ?? "";
		// Three references, each replaced by the view: none reads the table bare.
		expect(sent.match(/FROM rudel\.run_index FINAL/gu)?.length).toBe(3);
		expect(sent.match(/row_kind = 'run'/gu)?.length).toBe(3);
		expect(sent).toContain(
			"max((revision, parser_version, index_version, build_revision)) AS committed",
		);
		expect(sent).not.toMatch(/FROM runs\b/u);
		expect(sent).not.toContain("WITH top AS");
		// The agent's own alias names the view; no second alias is added.
		expect(sent).toMatch(/\) AS r JOIN opaline_cte_top AS top ON/u);
		expect(sent).not.toContain("AS runs AS r");
	});

	test("ARRAY JOIN unfolds a column and is not a table", async () => {
		const { env } = environment();
		ok(
			await runSql(
				member,
				{
					query:
						"SELECT skill, count() FROM runs ARRAY JOIN skills AS skill GROUP BY skill",
					title: "Skills",
				},
				env,
			),
		);
	});
});

describe("refused queries", () => {
	const refused = [
		["a raw table", "SELECT * FROM claude_sessions"],
		["a database-qualified table", "SELECT * FROM rudel.run_index"],
		["a system table", "SELECT * FROM system.tables"],
		["a quoted raw table", 'SELECT * FROM "transcript_records"'],
		["a table function", "SELECT * FROM url('http://example.com', CSV)"],
		["a second table after a comma", "SELECT * FROM runs, claude_sessions"],
		[
			"a joined table",
			"SELECT * FROM runs JOIN usage_events USING (session_id)",
		],
		[
			"a table in a subquery",
			"SELECT * FROM runs WHERE session_id IN (SELECT session_id FROM claude_sessions)",
		],
		[
			"a table after IN",
			"SELECT * FROM runs WHERE session_id IN claude_sessions",
		],
		[
			"a parenthesized table after IN",
			"SELECT * FROM runs WHERE session_id IN (claude_sessions)",
		],
		[
			"in() as a function",
			"SELECT * FROM runs WHERE in(session_id, claude_sessions)",
		],
		[
			"the workspace column",
			"SELECT * FROM runs WHERE organization_id = 'ws-2'",
		],
		["another statement", "SELECT 1; DROP TABLE rudel.run_index"],
		["a write", "INSERT INTO rudel.run_index SELECT * FROM runs"],
		["a non-SELECT statement", "SHOW TABLES"],
		[
			"a quoted in() call",
			'SELECT "in"(session_id, rudel.run_index) FROM runs',
		],
		[
			"a qualified table in parentheses after IN",
			"SELECT count() FROM runs WHERE session_id IN (rudel.run_index)",
		],
		[
			"a table after SAMPLE … OFFSET",
			"SELECT * FROM runs SAMPLE 1/2 OFFSET 1/2, claude_sessions",
		],
		[
			"a FROM-first subquery",
			"SELECT 1 FROM runs WHERE session_id IN (FROM claude_sessions SELECT session_id)",
		],
		["a server table named anywhere", "SELECT run_index FROM runs"],
		[
			"a table function after USING (…) and a comma",
			"SELECT * FROM runs AS a JOIN runs AS b USING (session_id), merge('rudel', '^run_index$')",
		],
		[
			"a table function after an alias named distinct",
			"SELECT 1 AS distinct FROM url('http://example.com/x', CSV, 'a String')",
		],
		[
			"a table function joined after an alias named array",
			"SELECT * FROM runs AS array JOIN url('http://example.com/', CSV, 'session_id String') USING (session_id)",
		],
		[
			"a FROM-first branch after UNION",
			"SELECT * FROM runs WHERE session_id IN ((SELECT '') UNION ALL FROM claude_sessions SELECT session_id)",
		],
		[
			"a materialized view",
			"WITH weekly_totals_mv AS (SELECT 1) SELECT * FROM weekly_totals_mv",
		],
	] as const;

	for (const [what, query] of refused)
		test(`${what} is refused as fatal and never reaches ClickHouse`, async () => {
			const { env, statements } = environment();
			const error = failure(await runSql(member, { query, title: what }, env));
			expect(error.kind).toBe("fatal");
			expect(error.fix).toContain("Do not retry");
			expect(statements.filter(isAgentStatement)).toEqual([]);
		});

	test("a WITH name used outside the query that defines it never reads a table of that name", async () => {
		const { env, statements } = environment((statement) =>
			isParse(statement)
				? []
				: refusal(
						"Unknown table expression identifier 'opaline_cte_shadow' in scope SELECT 1. (UNKNOWN_TABLE)",
					),
		);
		const error = failure(
			await runSql(
				member,
				{
					query:
						"SELECT * FROM (WITH shadow AS (SELECT 1) SELECT 1) AS a, shadow",
					title: "x",
				},
				env,
			),
		);
		const sent = agentStatement(statements)?.query ?? "";
		// Read under the server's prefix, which no table has; the name stays only as an alias.
		expect(sent).toContain(", opaline_cte_shadow AS shadow");
		expect(sent).not.toMatch(/(FROM|JOIN|,)\s+shadow/u);
		expect(error).toMatchObject({ kind: "recoverable", fragment: "shadow" });
	});

	test("a WITH subquery cannot take the name of a server table", async () => {
		const { env, statements } = environment();
		const error = failure(
			await runSql(
				member,
				{
					query:
						"SELECT * FROM (WITH claude_sessions AS (SELECT 1) SELECT 1) AS a, claude_sessions",
					title: "x",
				},
				env,
			),
		);
		expect(error.kind).toBe("fatal");
		expect(statements).toEqual([]);
	});

	test("ClickHouse's own parse of the query must show only the views and WITH subqueries", async () => {
		// EXPLAIN AST as ClickHouse 26.8 prints it for a table function the
		// token check might miss; the gateway refuses before running anything.
		const ast = [
			"SelectWithUnionQuery (children 1)",
			" ExpressionList (children 1)",
			"  SelectQuery (children 2)",
			"   ExpressionList (children 1)",
			"    Literal UInt64_1",
			"   TablesInSelectQuery (children 2)",
			"    TablesInSelectQueryElement (children 1)",
			"     TableExpression (children 1)",
			"      TableIdentifier runs",
			"    TablesInSelectQueryElement (children 2)",
			"     TableExpression (children 1)",
			"      Function merge (children 1)",
			"       ExpressionList (children 2)",
			"        Literal \\'rudel\\'",
			"        Literal \\'.*\\'",
			"     TableJoin",
		];
		const { env, statements } = environment((statement) =>
			isParse(statement) ? ast.map((explain) => ({ explain })) : [],
		);
		const error = failure(
			await runSql(member, { query: "SELECT 1 FROM runs", title: "x" }, env),
		);
		expect(error.kind).toBe("fatal");
		expect(error.message).toContain('"merge"');
		expect(
			statements.filter(isParse).map((statement) => statement.query),
		).toEqual(["EXPLAIN AST SELECT 1 FROM runs"]);
		expect(statements.filter(isAgentStatement)).toEqual([]);
	});

	test("ClickHouse's parse decodes names: a function hidden by escapes is not on the list, a table after IN is refused", async () => {
		const parsed = (lines: string[]) =>
			environment((statement) =>
				isParse(statement) ? lines.map((explain) => ({ explain })) : [],
			);
		const qualified = parsed([
			"SelectWithUnionQuery (children 1)",
			" ExpressionList (children 1)",
			"  SelectQuery (children 2)",
			"   ExpressionList (children 1)",
			"    Function getSetting (children 1)",
			"     ExpressionList (children 1)",
			"      Literal \\'x\\'",
			"   TablesInSelectQuery (children 1)",
			"    TablesInSelectQueryElement (children 1)",
			"     TableExpression (children 1)",
			"      TableIdentifier runs",
		]);
		expect(
			failure(
				await runSql(
					member,
					{ query: "SELECT 1 FROM runs", title: "x" },
					qualified.env,
				),
			),
		).toMatchObject({
			kind: "recoverable",
			fragment: "getSetting",
			message: expect.stringContaining("getSetting()"),
		});
		const inTable = parsed([
			"SelectWithUnionQuery (children 1)",
			" ExpressionList (children 1)",
			"  SelectQuery (children 3)",
			"   ExpressionList (children 1)",
			"    Literal UInt64_1",
			"   TablesInSelectQuery (children 1)",
			"    TablesInSelectQueryElement (children 1)",
			"     TableExpression (children 1)",
			"      TableIdentifier runs",
			"   Function in (children 1)",
			"    ExpressionList (children 2)",
			"     Identifier session_id",
			"     Identifier claude_sessions",
		]);
		expect(
			failure(
				await runSql(
					member,
					{ query: "SELECT 1 FROM runs", title: "x" },
					inTable.env,
				),
			),
		).toMatchObject({
			kind: "fatal",
			message: expect.stringContaining("claude_sessions"),
		});
	});

	test("the refusal names the failing part", async () => {
		const { env } = environment();
		const error = failure(
			await runSql(
				member,
				{ query: "SELECT * FROM runs, claude_sessions WHERE 1", title: "x" },
				env,
			),
		);
		expect(error.fragment).toBe("claude_sessions WHERE 1");
		expect(error.message).toContain("Allowed views: runs");
	});

	const unavailableFunctions = [
		["url", "SELECT url('http://example.com/x') FROM runs"],
		["file", "SELECT file('x') FROM runs"],
		["remote", "SELECT remote('host', 'rudel', 'run_index') FROM runs"],
		["getSetting", "SELECT getSetting('max_threads') FROM runs"],
		["currentUser", "SELECT currentUser() FROM runs"],
		["hostName", "SELECT hostName() FROM runs"],
		["dictGet", "SELECT dictGet('d', 'x', 1) FROM runs"],
		["dictGet", "SELECT `dictGet`('d', 'x', 1) FROM runs"],
		["joinGet", "SELECT joinGet('t', 'x', 1) FROM runs"],
		["version", "SELECT version() FROM runs"],
		["madeUpFunction", "SELECT madeUpFunction(model) FROM runs"],
	] as const;
	for (const [name, query] of unavailableFunctions)
		test(`${name}() is not on the function list: a recoverable error naming it, before ClickHouse runs anything`, async () => {
			const { env, statements } = environment();
			const error = failure(await runSql(member, { query, title: name }, env));
			expect(error.kind).toBe("recoverable");
			expect(error.message).toContain(`${name}()`);
			expect(error.fragment).toStartWith(
				query.includes("`") ? `\`${name}\`` : name,
			);
			expect(statements).toEqual([]);
		});

	test("an analysis query using aggregates with combinators, quantiles, dates, strings, arrays, conditions, JSON and windows is accepted", async () => {
		const { env, statements } = environment();
		ok(
			await runSql(
				member,
				{
					query: `SELECT toMonday(started_at) AS week, toStartOfDay(started_at) AS day,
						count() AS runs, countIf(failed_calls > 0) AS failing, sumArray(api_error_statuses = []) AS x,
						uniqExact(session_id), uniqIf(user_id, edits > 0), quantileExact(0.9)(active_minutes),
						quantilesTDigest(0.5, 0.9)(minutes), avgIf(cost_usd, cost_usd IS NOT NULL), median(minutes),
						dateDiff('minute', min(started_at), max(ended_at)), formatDateTime(max(started_at), '%F'),
						lower(coalesce(any(model), '')), replaceRegexpAll(any(prompt_head), '\\s+', ' '),
						match(any(prompt_head), 'fix'), positionCaseInsensitive(any(prompt_head), 'test'),
						groupUniqArrayArray(skills), has(groupArray(model), 'x'), length(groupArray(models)),
						arrayFilter(s -> s != '', groupArray(model)), if(sum(edits) > 10, 'big', 'small'),
						multiIf(count() > 5, 'a', count() > 2, 'b', 'c'), ifNull(sum(not_found), 0), round(sum(minutes), 1),
						toString(max(turn_idx)), toFloat64OrZero('1'), JSONExtractString(any(hook_runs), 'command'),
						row_number() OVER (ORDER BY count() DESC), argMax(session_id, active_minutes)
					FROM runs
					WHERE started_at >= now() - INTERVAL 30 DAY AND model NOT IN ('x') AND prompt_head ILIKE '%login%'
					GROUP BY week, day ORDER BY week DESC`,
					title: "Analysis",
				},
				env,
			),
		);
		expect(agentStatement(statements)?.query).toContain(
			"FROM rudel.run_index FINAL",
		);
	});

	test("ClickHouse's parse is held to the function list too, operators included", async () => {
		const parse = (functionName: string) => [
			"SelectWithUnionQuery (children 1)",
			" ExpressionList (children 1)",
			"  SelectQuery (children 3)",
			"   ExpressionList (children 1)",
			`    Function ${functionName} (children 1)`,
			"     ExpressionList (children 1)",
			"      Identifier model",
			"   TablesInSelectQuery (children 1)",
			"    TablesInSelectQueryElement (children 1)",
			"     TableExpression (children 1)",
			"      TableIdentifier runs",
			"   Function and (children 1)",
			"    ExpressionList (children 2)",
			"     Function notIn (children 1)",
			"      ExpressionList (children 2)",
			"       Identifier model",
			"       Function tuple (children 1)",
			"        ExpressionList (children 1)",
			"         Literal \\'x\\'",
			"     Function multiIf (children 1)",
			"      ExpressionList (children 1)",
			"       Function lambda (children 1)",
		];
		const run = async (functionName: string) => {
			const { env } = environment((statement) =>
				isParse(statement)
					? parse(functionName).map((explain) => ({ explain }))
					: [],
			);
			return runSql(
				member,
				{ query: "SELECT lower(model) FROM runs", title: "x" },
				env,
			);
		};
		expect((await run("lower")).ok).toBe(true);
		expect(await run("hostName")).toMatchObject({
			ok: false,
			error: { kind: "recoverable", fragment: "hostName" },
		});
	});

	const fixable = [
		[
			"SETTINGS",
			"SELECT * FROM runs SETTINGS max_execution_time = 600",
			"SETTINGS",
		],
		["FORMAT", "SELECT * FROM runs FORMAT CSV", "FORMAT"],
		["query parameters", "SELECT * FROM runs WHERE user_id = {u:String}", "{u"],
		[
			"escapes in quoted names",
			"SELECT `dictG\\x65t`('d', 'x', 1) FROM runs",
			"`dictG",
		],
		["an open string", "SELECT * FROM runs WHERE model = 'x", "'x"],
	] as const;
	for (const [what, query, fragment] of fixable)
		test(`${what} is a recoverable error with the failing part and a fix`, async () => {
			const { env, statements } = environment();
			const error = failure(await runSql(member, { query, title: what }, env));
			expect(error.kind).toBe("recoverable");
			expect(error.fragment).toStartWith(fragment);
			expect(error.fix.length).toBeGreaterThan(0);
			expect(statements).toEqual([]);
		});

	const accepted = [
		[
			"IN a WITH subquery",
			"WITH top AS (SELECT session_id FROM runs) SELECT count() FROM runs WHERE session_id IN (top)",
		],
		[
			"EXTRACT … FROM",
			"SELECT EXTRACT(HOUR FROM started_at) AS h, count() FROM runs GROUP BY h",
		],
		["trim … FROM", "SELECT trim(BOTH ' ' FROM prompt_head) FROM runs"],
		[
			"substring … FROM",
			"SELECT substring(prompt_head FROM 2 FOR 5) FROM runs",
		],
		[
			"IS DISTINCT FROM",
			"SELECT count() FROM runs WHERE model IS NOT DISTINCT FROM effort",
		],
		[
			"USING a column list",
			"SELECT count() FROM runs AS a JOIN runs AS b USING session_id, agent_id",
		],
		["FROM before SELECT", "FROM runs SELECT count()"],
	] as const;
	for (const [what, query] of accepted)
		test(`${what} reads only the views and is accepted`, async () => {
			const { env, statements } = environment();
			ok(await runSql(member, { query, title: what }, env));
			const sent = agentStatement(statements)?.query ?? "";
			expect(sent).toContain("FROM rudel.run_index FINAL");
			// A set after IN is read as named, without an alias.
			expect(sent).not.toMatch(/IN \([^()]* AS \w+\)/u);
		});

	test("a trailing semicolon and the format() function are fine", async () => {
		const { env, statements } = environment();
		ok(
			await runSql(
				member,
				{
					query: "SELECT format('{}-{}', model, effort) FROM runs;",
					title: "ok",
				},
				env,
			),
		);
		// The client appends FORMAT, which a semicolon would leave outside the statement.
		for (const statement of statements.filter(
			(sent) => isAgentStatement(sent) || isParse(sent),
		))
			expect(statement.query).not.toEndWith(";");
	});
});

describe("limits and errors from ClickHouse", () => {
	test("each query carries the time, memory, read and result limits", async () => {
		const { env, statements } = environment();
		ok(await runSql(member, { query: RANKING, title: "x" }, env));
		expect(agentStatement(statements)?.clickhouse_settings).toMatchObject({
			readonly: "1",
			max_execution_time: 10,
			max_memory_usage: String(512 * 1024 * 1024),
			max_rows_to_read: "50000000",
			limit: "201",
			max_result_bytes: String(16 * 1024 * 1024),
			// A result over its byte limit fails instead of arriving cut without a notice.
			result_overflow_mode: "throw",
			max_threads: 2,
		});
	});

	const overTime = [
		[
			"time",
			"Timeout exceeded: elapsed 10.1 s, maximum: 10 s. (TIMEOUT_EXCEEDED)",
			"10 seconds",
		],
		[
			"result size",
			"Limit for result exceeded, max bytes: 16.00 MiB, current bytes: 17.00 MiB. (TOO_MANY_ROWS_OR_BYTES)",
			"16 MiB",
		],
	] as const;
	for (const [limit, text, said] of overTime)
		test(`over the ${limit} limit: a recoverable error saying how to narrow it`, async () => {
			const { env } = environment(() => refusal(text));
			const error = failure(
				await runSql(member, { query: RANKING, title: "x" }, env),
			);
			expect(error.kind).toBe("recoverable");
			expect(error.message).toContain(said);
			expect(error.fix).toStartWith("Narrow it: a shorter started_at range");
		});

	const overReads = [
		[
			"memory",
			"Query memory limit exceeded: would use 600 MiB, maximum: 512 MiB. (MEMORY_LIMIT_EXCEEDED)",
			"512 MiB",
		],
		[
			"rows read",
			"Limit for rows (controlled by 'max_rows_to_read' setting) exceeded, max rows: 50.00 million. (TOO_MANY_ROWS)",
			"50,000,000 rows",
		],
		[
			"bytes read",
			"Limit for (controlled by 'max_bytes_to_read' setting) exceeded, max bytes: 4.00 GiB. (TOO_MANY_BYTES)",
			"4 GiB",
		],
	] as const;
	for (const [limit, text, said] of overReads)
		test(`over the ${limit} limit: fatal, so the agent does not run the same query again, and says to aggregate or narrow the window`, async () => {
			const { env } = environment(() => refusal(text));
			const error = failure(
				await runSql(member, { query: RANKING, title: "x" }, env),
			);
			expect(error.kind).toBe("fatal");
			expect(error.message).toContain(said);
			expect(error.message).toContain(
				"this query reads too much; aggregate or narrow the window",
			);
			expect(error.fix).toStartWith(
				"Do not run this query again. A narrower one can pass: a shorter started_at range",
			);
		});

	for (const text of [
		"Memory limit (total) exceeded: would use 5.10 GiB, maximum: 5.04 GiB. (MEMORY_LIMIT_EXCEEDED)",
		"Memory limit (for user) exceeded: would use 3.00 GiB, maximum: 3.00 GiB. (MEMORY_LIMIT_EXCEEDED)",
	])
		test(`ClickHouse short of memory overall, not over the query's own limit, is recoverable: retry in a moment (${text.slice(0, 26)})`, async () => {
			const { env } = environment(() => refusal(text));
			const error = failure(
				await runSql(member, { query: RANKING, title: "x" }, env),
			);
			expect(error).toMatchObject({
				kind: "recoverable",
				message: "The analysis service is busy; retry in a moment.",
			});
		});

	test("an unknown column is recoverable and names the column, never the server's statement", async () => {
		const { env } = environment(() =>
			refusal(
				"Unknown expression identifier `minutez` in scope SELECT minutez FROM (SELECT x FROM rudel.run_index FINAL WHERE organization_id = {opaline_workspace:String}). (UNKNOWN_IDENTIFIER)",
			),
		);
		const error = failure(
			await runSql(
				member,
				{ query: "SELECT minutez FROM runs", title: "x" },
				env,
			),
		);
		expect(error).toMatchObject({
			kind: "recoverable",
			fragment: "minutez",
			message: "Unknown expression identifier `minutez`",
		});
		expect(error.fix).toContain("schema view=runs");
	});

	test("a syntax error points at the agent's own text, not the rewritten statement", async () => {
		const query = "SELECT count( FROM runs WHERE model = 'x'";
		const { env, statements } = environment((statement) => {
			// ClickHouse counts from 1; the agent's WHERE is the last one.
			const position = statement.query.lastIndexOf("WHERE") + 1;
			return refusal(
				`Syntax error: failed at position ${position} (WHERE): WHERE model. Expected one of: ... (SYNTAX_ERROR)`,
			);
		});
		const error = failure(await runSql(member, { query, title: "x" }, env));
		expect(statements.length).toBe(1);
		expect(error.kind).toBe("recoverable");
		expect(error.fragment).toBe("WHERE model = 'x'");
	});

	test("a syntax error message never repeats the server's view statement", async () => {
		const { env } = environment((statement) =>
			isParse(statement)
				? []
				: refusal(
						`Syntax error: failed at position 13 (() (line 1, col 13): ${statement.query.slice(12, 200)}... Unmatched parentheses: (. (SYNTAX_ERROR)`,
					),
		);
		const error = failure(
			await runSql(
				member,
				{ query: "SELECT count( FROM runs WHERE model = 'x'", title: "x" },
				env,
			),
		);
		expect(error.message).toBe(
			"Syntax error at the failing part. Unmatched parentheses: (.",
		);
		expect(error.fragment).toBe("( FROM runs WHERE model = 'x'");
	});

	test("a permission refusal is fatal", async () => {
		const { env } = environment(() =>
			refusal(
				"default: Not enough privileges. To execute this query, it's necessary to have the grant SELECT ON system.numbers. (ACCESS_DENIED)",
			),
		);
		const error = failure(
			await runSql(member, { query: RANKING, title: "x" }, env),
		);
		expect(error.kind).toBe("fatal");
		expect(error.fix).toStartWith("Do not retry");
	});

	test("a failure that is not a ClickHouse refusal is not dressed up as one", async () => {
		const { env } = environment(() => new Error("socket hang up"));
		await expect(
			runSql(member, { query: RANKING, title: "x" }, env),
		).rejects.toThrow("socket hang up");
	});

	test("the agent's query and the lookups for its result run while its workspace holds a query slot", async () => {
		const { env, statements, slotted } = environment((statement) =>
			isAgentStatement(statement)
				? [{ session_id: "s1", turn_idx: 3, active_minutes: 41.5 }]
				: [],
		);
		ok(await runSql(teammate, { query: RANKING, title: "x" }, env));
		const afterParse = statements.filter((statement) => !isParse(statement));
		// The query, the sessions it names and the members it covered.
		expect(afterParse.length).toBe(3);
		expect(slotted).toEqual(
			afterParse.map((statement) => ({ workspaceId: "ws-1", statement })),
		);
	});

	test("while every query slot is taken, a query is a recoverable error to retry in a moment, sends nothing and uses no quota", async () => {
		const busy = environment(() => [], 1, { busy: true });
		const error = failure(
			await runSql(member, { query: RANKING, title: "x" }, busy.env),
		);
		expect(error).toMatchObject({
			kind: "recoverable",
			message: "The analysis service is busy; retry in a moment.",
		});
		expect(busy.statements.filter(isAgentStatement)).toEqual([]);
		// The refused query took nothing from the workspace's quota of 1.
		ok(
			await runSql(
				member,
				{ query: RANKING, title: "x" },
				{ ...busy.env, limiter: environment().env.limiter },
			),
		);
	});

	test("the workspace quota refuses further queries until its window ends", async () => {
		const { env, statements } = environment(() => [], 1);
		ok(await runSql(member, { query: RANKING, title: "first" }, env));
		const error = failure(
			await runSql(admin, { query: RANKING, title: "second" }, env),
		);
		expect(error.kind).toBe("fatal");
		expect(error.message).toContain("quota of 1 queries per 60 minutes");
		expect(statements.filter(isAgentStatement).length).toBe(1);
	});
});

describe("caps and notices", () => {
	const rows = (count: number, text = "x") =>
		Array.from({ length: count }, (_, index) => ({
			turn_idx: index,
			prompt_head: text,
		}));

	test("every result says it is not evidence, empty ones too", async () => {
		const { env } = environment();
		const result = ok(
			await runSql(member, { query: RANKING, title: "x" }, env),
		);
		expect(result.table).toBe("(no rows)");
		expect(result.truncated).toBe(false);
		expect(result.notices).toEqual([
			"not evidence: these rows say where to look, not why. Open the runs with read (session_id, agent_id, and turn_idx as its turn) before naming a cause.",
		]);
	});

	test("more rows than the cap: the first 200 are shown with a notice to aggregate or page", async () => {
		const { env } = environment((statement) =>
			isAgentStatement(statement) ? rows(201) : [],
		);
		const result = ok(
			await runSql(member, { query: RANKING, title: "x" }, env),
		);
		expect(result.rows).toBe(200);
		expect(result.table.split("\n").length).toBe(201);
		expect(result.truncated).toBe(true);
		expect(result.notices[0]).toBe(
			"cut: the query returned more than 200 rows; only the first 200 are shown. Cut rows are not missing data: aggregate (GROUP BY with count(), sum(), avg()) or page with ORDER BY … LIMIT 200 OFFSET 200.",
		);
		expect(result.notices.at(-1)).toStartWith("not evidence:");
	});

	test("long cells are cut and the table stops at its character cap, each with a notice", async () => {
		const { env } = environment((statement) =>
			isAgentStatement(statement) ? rows(150, "y".repeat(400)) : [],
		);
		const result = ok(
			await runSql(member, { query: RANKING, title: "x" }, env),
		);
		expect(result.table.length).toBeLessThanOrEqual(24_000);
		expect(result.rows).toBeLessThan(150);
		expect(result.table.split("\n")[1]).toBe(`0 | ${"y".repeat(299)}…`);
		expect(result.notices).toEqual([
			`cut: only the first ${result.rows} of 150 rows fit 24000 characters. Cut rows are not missing data: select fewer or shorter columns, aggregate, or page with LIMIT ${result.rows} OFFSET ${result.rows}.`,
			'cut: 150 cells were longer than 300 characters and end in "…"; select substring(column, 301, 300) to read on.',
			NOT_EVIDENCE,
		]);
	});

	test("cells keep the table one line per row: pipes, tabs and newlines are escaped", async () => {
		const { env } = environment((statement) =>
			isAgentStatement(statement)
				? [{ prompt_head: "a | b\nc", models: ["x", "y"], cost_usd: null }]
				: [],
		);
		const result = ok(
			await runSql(member, { query: RANKING, title: "x" }, env),
		);
		expect(result.table).toBe(
			'prompt_head | models | cost_usd\na \\| b\\nc | ["x","y"] | null',
		);
	});

	test("credentials in results are redacted before they are shown or stored", async () => {
		const { env, results } = environment((statement) =>
			isAgentStatement(statement)
				? [{ prompt_head: "run it with PASSWORD=hunter2-very-secret" }]
				: [],
		);
		const result = ok(
			await runSql(member, { query: RANKING, title: "x" }, env),
		);
		expect(result.table).toBe("prompt_head\nrun it with PASSWORD=[redacted]");
		expect(JSON.stringify(results.records.get(result.id))).not.toContain(
			"hunter2",
		);
	});
});

describe("schema", () => {
	test("walks the views, then a view's columns with meaning and traps, then a column's top values", async () => {
		const { env, statements } = environment((statement) =>
			isAgentStatement(statement)
				? [
						{ value: "claude-opus-4-1", runs: "12" },
						{ value: null, runs: "3" },
					]
				: [],
		);

		const views = await describeSchema(member, {}, env);
		expect(views).toMatchObject({
			ok: true,
			result: { level: "views", views: [{ name: "runs" }] },
		});

		const columns = await describeSchema(member, { view: "runs" }, env);
		if (!columns.ok || columns.result.level !== "columns")
			throw new Error("Expected columns");
		const names = columns.result.columns.map((column) => column.name);
		expect(names).toContain("active_minutes");
		expect(names).toContain("turn_idx");
		// Every run row carries its session's repository (run index version 3).
		expect(names).toContain("repository");
		for (const hidden of [
			"organization_id",
			"revision",
			"build_revision",
			"row_kind",
			"title",
			"session_model",
		])
			expect(names).not.toContain(hidden);
		const permission = columns.result.columns.find(
			(column) => column.name === "permission_mode",
		);
		expect(permission?.meaning).toStartWith("First Claude permissionMode");
		expect(permission?.traps).toEqual([
			"Recorded by Claude Code from parser 7; elsewhere unknown (NULL, arrays empty, named in unrecorded_facts), not none.",
		]);
		expect(columns.result.traps[0]).toContain("count rows directly");
		const notFound = columns.result.columns.find(
			(column) => column.name === "not_found",
		);
		expect(notFound?.type).toBe("Nullable(UInt32)");
		expect(notFound?.traps).toEqual([
			"Recorded by Claude Code from parser 6 and Codex, Claude Code in its main stream only; elsewhere unknown (NULL, arrays empty, named in unrecorded_facts), not none.",
		]);

		const values = await describeSchema(
			member,
			{ view: "runs", column: "model" },
			env,
		);
		expect(values).toEqual({
			ok: true,
			result: {
				level: "values",
				view: "runs",
				column: expect.objectContaining({ name: "model" }),
				over: "runs that started in the last 30 days",
				values: [
					{ value: "claude-opus-4-1", runs: 12 },
					{ value: "null", runs: 3 },
				],
				notices: ["every value is listed."],
			},
		});
		expect(agentStatement(statements)?.query_params).toEqual({
			opaline_workspace: "ws-1",
			opaline_member: "member-1",
		});
	});

	test("a column's top values run in a query slot of the workspace, and are refused as busy like sql", async () => {
		const { env, slotted } = environment();
		expect(
			await describeSchema(member, { view: "runs", column: "model" }, env),
		).toMatchObject({ ok: true });
		expect(
			slotted.filter(({ statement }) => isAgentStatement(statement)),
		).toEqual([{ workspaceId: "ws-1", statement: expect.anything() }]);

		const busy = environment(() => [], 100, { busy: true });
		expect(
			await describeSchema(member, { view: "runs", column: "model" }, busy.env),
		).toMatchObject({
			ok: false,
			error: {
				kind: "recoverable",
				message: "The analysis service is busy; retry in a moment.",
			},
		});
		expect(busy.statements.filter(isAgentStatement)).toEqual([]);
	});

	test("an unknown view or column is a recoverable error naming it", async () => {
		const { env } = environment();
		expect(await describeSchema(member, { view: "calls" }, env)).toMatchObject({
			ok: false,
			error: { kind: "recoverable", fragment: "calls" },
		});
		expect(
			await describeSchema(
				member,
				{ view: "runs", column: "organization_id" },
				env,
			),
		).toMatchObject({
			ok: false,
			error: { kind: "recoverable", fragment: "organization_id" },
		});
	});
});
