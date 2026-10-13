import { expect, test } from "bun:test";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import type { AgentQueryLimiter } from "../analysis/agent-query-slots.js";
import {
	runSql,
	type SqlCaller,
	type SqlOutcome,
} from "../analysis/sql-gateway.js";
import { checkParsedSql } from "../analysis/sql-guard.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "../analysis/sql-results.js";
import { createSearchAccess } from "./access.js";
import type { TranscriptEmbedder } from "./config.js";
import { createMemoryEmbeddingQuota } from "./quota.js";
import { createSqlSearchFunction, searchTranscripts } from "./search.js";

/** Every agent query gets a slot at once. */
const unlimitedSlots: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};

/**
 * search('…') inside sql as the gateway runs it: a table the agent joins to
 * the views, replaced by the server's search statement, scoped by the bound
 * workspace like the views, its text and query vector bound as parameters.
 * ClickHouse is a stand-in that keeps every statement; OpenAI is a fake.
 */

const JOINED =
	"SELECT r.prompt_head, s.why FROM search('flaky login') AS s JOIN runs AS r USING (run_id) WHERE r.agent_id = ''";
/** ClickHouse's parse of JOINED (EXPLAIN AST on 26.8). */
const JOINED_AST = [
	"SelectWithUnionQuery (children 1)",
	" ExpressionList (children 1)",
	"  SelectQuery (children 3)",
	"   ExpressionList (children 2)",
	"    Identifier r.prompt_head",
	"    Identifier s.why",
	"   TablesInSelectQuery (children 2)",
	"    TablesInSelectQueryElement (children 1)",
	"     TableExpression (children 1)",
	"      Function search (alias s) (children 1)",
	"       ExpressionList (children 1)",
	"        Literal 'flaky login'",
	"    TablesInSelectQueryElement (children 2)",
	"     TableExpression (children 1)",
	"      TableIdentifier runs (alias r)",
	"     TableJoin (children 1)",
	"      ExpressionList (children 1)",
	"       Identifier run_id",
	"   Function equals (children 1)",
	"    ExpressionList (children 2)",
	"     Identifier r.agent_id",
	"     Literal ''",
];

/** A GitHub token pasted into a search: it is filtered before it is embedded or bound. */
const TOKEN = `ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`;

const teammate: SqlCaller = {
	workspaceId: "ws-1",
	reader: { userId: "member-1", role: "member", ownSessionsOnly: false },
};
const ownOnly: SqlCaller = {
	workspaceId: "ws-1",
	reader: { userId: "member-1", role: "member", ownSessionsOnly: true },
};

function fakeEmbedder(): TranscriptEmbedder & { texts: string[] } {
	const texts: string[] = [];
	return {
		texts,
		model: "fake@3",
		async embed(input) {
			texts.push(...input);
			return { vectors: input.map(() => [0.6, 0.8, 0]), tokens: 7 };
		},
	};
}

function environment(
	options: {
		quotaTokens?: number;
		embedder?: TranscriptEmbedder | null;
		embeddingDeadlineMs?: number;
		/** Workspaces with an active subscription; ws-1 by default. */
		paid?: readonly string[];
	} = {},
) {
	const statements: ClickHouseStatement[] = [];
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {},
		insert: async () => {},
		query: async <T>(statement: ClickHouseStatement) => {
			statements.push(statement);
			if (statement.query.startsWith("EXPLAIN AST "))
				return JOINED_AST.map((explain) => ({ explain })) as T[];
			return [] as T[];
		},
	};
	const embedder =
		options.embedder === undefined ? fakeEmbedder() : options.embedder;
	const quota = createMemoryEmbeddingQuota({
		tokens: options.quotaTokens ?? 1_000,
		windowMs: 86_400_000,
	});
	const access = createSearchAccess(
		{
			subscriptionStatus: async (workspaceId) =>
				(options.paid ?? ["ws-1"]).includes(workspaceId) ? "active" : null,
		},
		{ paidPlans: true },
	);
	const sqlQuota = createMemorySqlQuota({ queries: 100, windowMs: 3_600_000 });
	const taken: string[] = [];
	return {
		statements,
		quota,
		embedder,
		taken,
		access,
		env: {
			executor,
			results: createMemorySqlResultStore(),
			limiter: unlimitedSlots,
			githubRepositories: async () => [],
			quota: {
				...sqlQuota,
				take: (workspaceId: string) => {
					taken.push(workspaceId);
					return sqlQuota.take(workspaceId);
				},
			},
			functions: [
				createSqlSearchFunction({
					executor,
					quota,
					access,
					embedderFor: (workspaceId) =>
						workspaceId === "ws-1" ? embedder : null,
					now: () => new Date("2026-10-12T12:00:00.000Z"),
					embeddingDeadlineMs: options.embeddingDeadlineMs,
				}),
			],
		},
	};
}

const agentStatement = (statements: readonly ClickHouseStatement[]) =>
	statements.find(
		(statement) =>
			statement.clickhouse_settings?.readonly === "1" &&
			!statement.query.startsWith("EXPLAIN AST "),
	);

function ok(outcome: SqlOutcome) {
	if (!outcome.ok)
		throw new Error(`Expected a result: ${outcome.error.message}`);
	return outcome.result;
}

function failure(outcome: SqlOutcome) {
	if (outcome.ok) throw new Error("Expected an error, got a result");
	return outcome.error;
}

test("search('…') joined to runs runs the server's search statement in its place, scoped and bound, never the agent's text", async () => {
	const { env, statements, embedder, quota } = environment();

	ok(await runSql(teammate, { query: JOINED, title: "Flaky login runs" }, env));

	const sent = agentStatement(statements);
	expect(sent?.query).not.toContain("flaky login");
	expect(sent?.query).not.toContain("search(");
	expect(sent?.query).toContain("rudel.transcript_chunk_hits");
	expect(sent?.query).toContain("{opaline_search0_text:String}");
	expect(sent?.query).toContain(") AS s JOIN (");
	expect(sent?.query).not.toContain("{opaline_member:String}");
	expect(sent?.query_params).toMatchObject({
		opaline_workspace: "ws-1",
		opaline_search0_text: "flaky login",
		opaline_search0_vector: [0.6, 0.8, 0],
		opaline_search0_meaning: 1,
		opaline_search0_exact: 1,
		opaline_search0_since: "2026-09-12 12:00:00.000",
		opaline_search0_kinds: [],
	});
	expect(embedder && "texts" in embedder ? embedder.texts : []).toEqual([
		"flaky login",
	]);
	expect((await quota.usage("ws-1")).used).toBe(7);
});

test("held to their own sessions, a member's search reads only theirs; each call has its own parameters, mode and days, and a credential in its text is filtered before it is embedded or bound", async () => {
	const { env, statements, embedder } = environment();

	ok(
		await runSql(
			ownOnly,
			{
				query: `SELECT a.run_id FROM search('--legacy', 'exact', 90) AS a JOIN search('it''s flaky with ${TOKEN}') AS b USING (run_id)`,
				title: "Both",
			},
			env,
		),
	);

	const sent = agentStatement(statements);
	expect(sent?.query).toContain("{opaline_member:String}");
	expect(sent?.query_params).toMatchObject({
		opaline_member: "member-1",
		opaline_search0_text: "--legacy",
		opaline_search0_meaning: 0,
		opaline_search0_exact: 1,
		opaline_search0_since: "2026-07-14 12:00:00.000",
		opaline_search1_text: "it's flaky with [REDACTED:github-pat]",
		opaline_search1_meaning: 1,
	});
	expect(embedder && "texts" in embedder ? embedder.texts : []).toEqual([
		"it's flaky with [REDACTED:github-pat]",
	]);
	expect(JSON.stringify(sent?.query_params)).not.toContain(TOKEN);
});

test("search() takes literal arguments in FROM or JOIN only, with a known mode and 1 to 180 days", async () => {
	const { env, statements } = environment();
	const refused = async (query: string) =>
		failure(await runSql(teammate, { query, title: "x" }, env));

	expect(
		await refused("SELECT * FROM search(lower('flaky login')) AS s"),
	).toMatchObject({
		kind: "recoverable",
		message: "search() takes literal arguments only.",
	});
	expect(
		await refused("SELECT * FROM runs WHERE run_id IN search('flaky')"),
	).toMatchObject({
		kind: "recoverable",
		message: "search() is a table, not a function of a row.",
	});
	expect(await refused("SELECT * FROM search('flaky', 'fuzzy')")).toMatchObject(
		{
			kind: "recoverable",
			message: "search() mode must be hybrid, meaning or exact, not fuzzy.",
		},
	);
	expect(
		await refused("SELECT * FROM search('flaky', 'exact', 365)"),
	).toMatchObject({
		message: "search() reads 1 to 180 days back, not 365.",
	});
	expect(await refused("SELECT * FROM search('x')")).toMatchObject({
		kind: "recoverable",
	});
	expect(statements).toEqual([]);
});

test("over the OpenAI quota, search in sql finds exact strings and says so; meaning alone is refused with what to do", async () => {
	const { env, statements, quota } = environment({ quotaTokens: 5 });
	await quota.charge("ws-1", 5);

	const result = ok(
		await runSql(teammate, { query: JOINED, title: "Flaky" }, env),
	);
	expect(agentStatement(statements)?.query_params).toMatchObject({
		opaline_search0_meaning: 0,
		opaline_search0_exact: 1,
	});
	expect(result.notices[0]).toStartWith(
		"search('flaky login'): only exact matches: search by meaning is not available (the workspace used its OpenAI quota of 5 tokens; embedding stopped until ",
	);

	expect(
		failure(
			await runSql(
				teammate,
				{
					query: "SELECT * FROM search('flaky login', 'meaning') AS s",
					title: "x",
				},
				env,
			),
		),
	).toMatchObject({
		kind: "recoverable",
		fix: "Search with mode exact for a literal string (a flag, file name or error), or use sql and read.",
	});
});

test("a workspace whose transcripts are not embedded searches exact strings only", async () => {
	const { env, statements } = environment({ embedder: null });

	const result = ok(
		await runSql(teammate, { query: JOINED, title: "Flaky" }, env),
	);

	expect(agentStatement(statements)?.query_params).toMatchObject({
		opaline_search0_meaning: 0,
	});
	expect(result.notices).toContain(
		"search('flaky login'): only exact matches: search by meaning is not available (this workspace's transcripts are not embedded).",
	);
});

test("ClickHouse's parse may show search only in a table position with literal arguments", () => {
	const tables = {
		views: new Set(["runs"]),
		ctes: new Set<string>(),
		functions: new Set(["search"]),
	};
	expect(checkParsedSql(JOINED_AST, tables)).toBeNull();
	expect(
		checkParsedSql(JOINED_AST, { ...tables, functions: new Set() }),
	).toMatchObject({ kind: "fatal" });
	const computed = [
		"SelectWithUnionQuery (children 1)",
		" ExpressionList (children 1)",
		"  SelectQuery (children 2)",
		"   ExpressionList (children 1)",
		"    Asterisk",
		"   TablesInSelectQuery (children 1)",
		"    TablesInSelectQueryElement (children 1)",
		"     TableExpression (children 1)",
		"      Function search (children 1)",
		"       ExpressionList (children 1)",
		"        Function lower (children 1)",
		"         ExpressionList (children 1)",
		"          Literal 'x'",
	];
	expect(checkParsedSql(computed, tables)).toMatchObject({
		kind: "fatal",
		fragment: "search",
	});
});

test("a query may call search() at most three times; a fourth is refused before any quota or embedding is spent", async () => {
	const { env, statements, embedder, quota, taken } = environment();
	const calls = ["a1", "b2", "c3", "d4"]
		.map((text, index) => `search('${text}') AS s${index}`)
		.join(" JOIN ");

	const error = failure(
		await runSql(
			teammate,
			{ query: `SELECT 1 FROM ${calls}`, title: "x" },
			env,
		),
	);

	expect(error).toMatchObject({
		kind: "recoverable",
		message: "A query may call search() at most 3 times.",
	});
	expect(statements).toEqual([]);
	expect(embedder && "texts" in embedder ? embedder.texts : []).toEqual([]);
	expect((await quota.usage("ws-1")).used).toBe(0);
	expect(taken).toEqual([]);
});

test("a query that expands past what ClickHouse parses is refused before any quota or embedding is spent", async () => {
	const { env, statements, embedder, taken } = environment();
	const query = [
		"SELECT s.run_id FROM search('flaky login') AS s",
		...Array.from({ length: 120 }, () => "SELECT run_id FROM runs"),
	].join(" UNION ALL ");

	const error = failure(await runSql(teammate, { query, title: "x" }, env));

	expect(error).toMatchObject({ kind: "recoverable" });
	expect(error.message).toStartWith(
		"The query is too large once its views and search() calls are expanded",
	);
	expect(statements.filter((s) => !s.query.startsWith("EXPLAIN AST "))).toEqual(
		[],
	);
	expect(embedder && "texts" in embedder ? embedder.texts : []).toEqual([]);
	expect(taken).toEqual([]);
});

test("the embeddings of a query's search() calls share one deadline: past it every request is cancelled and the calls search exact strings", async () => {
	const signals: AbortSignal[] = [];
	const hanging: TranscriptEmbedder = {
		model: "fake@3",
		embed: (_texts, signal) =>
			new Promise((_resolve, reject) => {
				if (signal) signals.push(signal);
				signal?.addEventListener("abort", () => reject(signal.reason));
			}),
	};
	const { env, statements, quota } = environment({
		embedder: hanging,
		embeddingDeadlineMs: 50,
	});
	const started = Date.now();

	const result = ok(
		await runSql(
			teammate,
			{
				query:
					"SELECT a.run_id FROM search('flaky login') AS a JOIN search('slow build') AS b USING (run_id)",
				title: "Both",
			},
			env,
		),
	);

	expect(Date.now() - started).toBeLessThan(1_000);
	expect(signals).toHaveLength(2);
	expect(signals.every((signal) => signal.aborted)).toBe(true);
	expect(agentStatement(statements)?.query_params).toMatchObject({
		opaline_search0_meaning: 0,
		opaline_search1_meaning: 0,
	});
	expect(result.notices).toContain(
		"search('slow build'): only exact matches: search by meaning is not available (the embedding service did not answer in time).",
	);
	// Abandoned requests may still be billed: they are charged as estimated.
	expect((await quota.usage("ws-1")).used).toBeGreaterThan(0);
});

test("when one search() call cannot run, the other calls' embedding requests are cancelled", async () => {
	const signals: AbortSignal[] = [];
	const embedder: TranscriptEmbedder = {
		model: "fake@3",
		embed: (texts, signal) =>
			texts[0] === "refused"
				? Promise.reject(new Error("OpenAI is down"))
				: new Promise((_resolve, reject) => {
						if (signal) signals.push(signal);
						signal?.addEventListener("abort", () => reject(signal.reason));
					}),
	};
	const { env, statements } = environment({
		embedder,
		embeddingDeadlineMs: 60_000,
	});
	const started = Date.now();

	const error = failure(
		await runSql(
			teammate,
			{
				query:
					"SELECT a.run_id FROM search('slow build') AS a JOIN search('refused', 'meaning') AS b USING (run_id)",
				title: "Both",
			},
			env,
		),
	);

	expect(Date.now() - started).toBeLessThan(1_000);
	expect(error.message).toBe(
		"Search by meaning is not available: the embedding service did not answer; retry later.",
	);
	expect(signals).toHaveLength(1);
	expect(signals[0]?.aborted).toBe(true);
	expect(agentStatement(statements)).toBeUndefined();
});

test("the search tool counts coverage once for a window, not with every search, and binds its text without credentials", async () => {
	const { env, statements, embedder, quota, access } = environment({
		paid: ["ws-coverage"],
	});
	const caller: SqlCaller = { ...teammate, workspaceId: "ws-coverage" };
	const search = (text: string) =>
		searchTranscripts(
			caller,
			{ text, mode: "exact", filters: { since: "2026-09-01" } },
			{
				executor: env.executor,
				quota,
				sqlQuota: env.quota,
				limiter: unlimitedSlots,
				embedderFor: () => embedder,
				access,
				now: () => new Date("2026-10-12T12:00:00.000Z"),
			},
		);

	expect((await search("flaky login")).ok).toBe(true);
	const first = statements.length;
	const second = await search(`--legacy ${TOKEN}`);

	expect(first).toBe(2);
	expect(statements.length - first).toBe(1);
	expect(statements.at(-1)?.query_params).toMatchObject({
		opaline_search_text: "--legacy [REDACTED:github-pat]",
	});
	expect(JSON.stringify(second)).not.toContain(TOKEN);
});

test("a workspace without a paid plan is told search is on paid plans; its searches embed nothing and find only exact strings indexed before", async () => {
	const { env, statements, embedder, quota, access } = environment({
		paid: [],
	});

	const inSql = ok(
		await runSql(teammate, { query: JOINED, title: "Flaky" }, env),
	);
	const meaning = failure(
		await runSql(
			teammate,
			{
				query: "SELECT * FROM search('flaky login', 'meaning') AS s",
				title: "x",
			},
			env,
		),
	);
	const tool = await searchTranscripts(
		teammate,
		{ text: "flaky login", mode: "hybrid" },
		{
			executor: env.executor,
			quota,
			sqlQuota: env.quota,
			limiter: unlimitedSlots,
			embedderFor: () => embedder,
			access,
		},
	);

	expect(inSql.notices).toContain(
		"search('flaky login'): only exact matches: search by meaning is not available (search is available on paid plans: this workspace's uploads are not indexed for search).",
	);
	expect(meaning.message).toBe(
		"Search by meaning is not available: search is available on paid plans: this workspace's uploads are not indexed for search.",
	);
	expect(agentStatement(statements)?.query_params).toMatchObject({
		opaline_search0_meaning: 0,
	});
	if (!tool.ok) throw new Error(tool.error.message);
	expect(tool.result).toMatchObject({ mode: "exact", quota: null });
	expect(tool.result.notices[0]).toContain("search is available on paid plans");
	const exact = await searchTranscripts(
		teammate,
		{ text: "--legacy", mode: "exact" },
		{
			executor: env.executor,
			quota,
			sqlQuota: env.quota,
			limiter: unlimitedSlots,
			embedderFor: () => embedder,
			access,
		},
	);
	expect(exact.ok && exact.result.notices[0]).toBe(
		"search is available on paid plans: this workspace's uploads are not indexed for search; only sessions indexed before can match.",
	);
	expect(embedder && "texts" in embedder ? embedder.texts : []).toEqual([]);
});
