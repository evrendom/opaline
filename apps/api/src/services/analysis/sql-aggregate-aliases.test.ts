import { describe, expect, test } from "bun:test";
import { PATTERN_KINDS } from "@rudel/api-routes";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import type { AgentQueryLimiter } from "./agent-query-slots.js";
import {
	PATTERN_PREFIX,
	patternDrillSql,
	patternFamilies,
	patternsListSql,
	patternsVerifySql,
	promptThemesSql,
} from "./patterns-sql.js";
import {
	digestCallsSql,
	digestEditsSql,
	digestRunsSql,
	digestSessionsSql,
	digestSeveritySql,
	digestUsageSql,
} from "./retro-digest-sql.js";
import type { MeasureParams } from "./retro-measure-sql.js";
import { RETRO_MEASURES } from "./retro-measures.js";
import { runSql } from "./sql-gateway.js";
import { prepareAgentSql, type SqlWindow } from "./sql-guard.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "./sql-results.js";
import { SQL_VIEWS } from "./sql-views.js";

const AGGREGATE =
	/^(?:any|anyLast|min|max|sum|count|avg|argMin|argMax|groupArray|groupUniqArray|uniq|uniqExact|topK|topKWeighted|quantile|median)(?:If|Array|Distinct|OrNull)*$/u;

function tokens(sql: string): string[] {
	return [
		...sql
			.replace(/'(?:\\.|''|[^'\\])*'/gu, "''")
			.matchAll(/[A-Za-z_]\w*|[().,]|\S/gu),
	].map((match) => match[0]);
}

/** The tokens of each SELECT's own scope, nested SELECTs left out. */
function scopes(sql: string): string[][] {
	const all = tokens(sql);
	const result: string[][] = [];
	all.forEach((token, start) => {
		if (token.toUpperCase() !== "SELECT") return;
		const scope: string[] = [];
		let depth = 0;
		for (let index = start + 1; index < all.length; index++) {
			const value = all[index] ?? "";
			if (depth === 0 && (value === ")" || /^(?:SELECT|UNION)$/iu.test(value)))
				break;
			if (value.toUpperCase() === "SELECT") {
				let nested = 0;
				for (; index < all.length; index++) {
					if (all[index] === "(") nested++;
					if (all[index] === ")") {
						if (nested === 0) break;
						nested--;
					}
				}
				depth--;
				continue;
			}
			if (value === "(") depth++;
			if (value === ")") depth--;
			scope.push(value);
		}
		result.push(scope);
	});
	return result;
}

/**
 * Aliases of aggregates that another aggregate or the WHERE of the same
 * SELECT reads: ClickHouse resolves the name to the alias there and refuses
 * the query with ILLEGAL_AGGREGATION.
 */
function aggregateAliasCollisions(sql: string): string[] {
	const collisions = new Set<string>();
	for (const scope of scopes(sql)) {
		const aliases = new Map<string, number>();
		const readers: { from: number; to: number }[] = [];
		let depth = 0;
		let where: { from: number; to: number } | undefined;
		for (let index = 0; index < scope.length; index++) {
			const value = scope[index] ?? "";
			if (value === "(") depth++;
			if (value === ")") depth--;
			if (depth === 0 && /^(?:PREWHERE|WHERE)$/iu.test(value))
				where = { from: index + 1, to: scope.length };
			if (
				where &&
				depth === 0 &&
				/^(?:GROUP|ORDER|HAVING|LIMIT|SETTINGS)$/iu.test(value) &&
				where.to === scope.length
			)
				where.to = index;
			if (!AGGREGATE.test(value) || scope[index + 1] !== "(") continue;
			let end = index;
			while (scope[end + 1] === "(") {
				let nested = 0;
				for (end++; end < scope.length; end++) {
					if (scope[end] === "(") nested++;
					if (scope[end] === ")" && --nested === 0) break;
				}
			}
			readers.push({ from: index + 2, to: end });
			if (scope[end + 1]?.toUpperCase() === "AS" && scope[end + 2])
				aliases.set(scope[end + 2] ?? "", readers.length - 1);
		}
		if (where) readers.push(where);
		for (const [alias, own] of aliases)
			readers.forEach((range, reader) => {
				if (reader === own) return;
				for (let index = range.from; index < range.to; index++)
					if (scope[index] === alias && scope[index - 1] !== ".")
						collisions.add(alias);
			});
	}
	return [...collisions].sort();
}

const unlimited: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};

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
		{ query, title: "Aliases" },
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
	return (
		statements.find(
			(item) =>
				item.clickhouse_settings?.readonly === "1" &&
				!item.query.startsWith("EXPLAIN AST "),
		)?.query ?? ""
	);
}

describe("aggregate aliases never shadow a column another aggregate reads", () => {
	test.each([
		[
			"SELECT anyIf(denial_kind, kind = 'tool_result' AND denial_kind != '') AS denial_kind, argMinIf(head, position, kind = 'tool_result' AND denial_kind != '') AS error_text FROM records",
			["denial_kind"],
		],
		[
			"SELECT sum(failed_calls) AS failed_calls, round(sum(failed_calls) / sum(tool_calls), 3) AS fail_rate FROM runs",
			["failed_calls"],
		],
		[
			"SELECT uid, min(at) AS at, argMax(cmd, at) AS last_cmd FROM cl GROUP BY uid",
			["at"],
		],
		["SELECT any(ts) AS ts FROM records WHERE ts > now()", ["ts"]],
		[
			"SELECT kind, sum(hits) AS hits, topKWeighted(1)(signature, hits)[1] AS signature FROM evk GROUP BY kind",
			["hits"],
		],
		[
			"SELECT anyIf(denial_kind, denial_kind != '') AS result_denial_kind, argMinIf(head, position, denial_kind != '') AS error_text FROM records",
			[],
		],
		[
			"SELECT sum(cost) AS cost, round(cost, 2) AS rounded FROM runs ORDER BY cost",
			[],
		],
		[
			"SELECT max(x) AS x FROM (SELECT sum(x) AS total FROM t WHERE y = 1) WHERE z = 'x'",
			[],
		],
	])("finds the collisions in %s", (sql, expected) => {
		expect(aggregateAliasCollisions(sql)).toEqual(expected);
	});

	for (const view of SQL_VIEWS)
		test(`the ${view.name} view`, async () => {
			const statement = await sent(`SELECT count() FROM ${view.name}`);
			expect(statement).not.toBe("");
			expect(aggregateAliasCollisions(statement)).toEqual([]);
		});

	const params: MeasureParams = {
		from: "2026-10-06",
		to: "2026-11-03",
		repository: "athena",
		limit: 20,
	};
	const retroStatements = [
		...RETRO_MEASURES.map((measure) => ({
			label: `measure ${measure.name}`,
			sql: measure.build(params),
		})),
		...[
			digestSessionsSql,
			digestCallsSql,
			digestEditsSql,
			digestUsageSql,
			digestRunsSql,
			digestSeveritySql,
		].map((build) => ({ label: `digest ${build.name}`, sql: build(params) })),
		...patternFamilies(PATTERN_KINDS).flatMap((part) => {
			const id = `${PATTERN_PREFIX[part.kinds[0] ?? "failing_call"]}_0123456789`;
			return [
				{
					label: `patterns ${part.family}`,
					sql: patternsListSql(params, part.family, {
						kinds: part.kinds,
						minCount: 2,
					}),
				},
				{
					label: `verify ${part.family}`,
					sql: patternsVerifySql(params, part.family, {
						kinds: part.kinds,
						minCount: 2,
						since: "2026-10-20",
					}),
				},
				{
					label: `drill ${part.family}`,
					sql: patternDrillSql(params, part.family, id),
				},
			];
		}),
		{ label: "prompt themes", sql: promptThemesSql(params) },
	];

	for (const { label, sql } of retroStatements)
		test(`the retro ${label} statement`, () => {
			const prepared = prepareAgentSql(
				sql,
				new Map(
					SQL_VIEWS.map((view) => [
						view.name,
						{
							windowColumn: view.windowColumn,
							statement: (window: SqlWindow) => view.sql(false, window),
						},
					]),
				),
				new Set(),
			);
			if (!prepared.ok) throw new Error(`${label} does not pass the guard`);
			expect(aggregateAliasCollisions(sql)).toEqual([]);
			expect(aggregateAliasCollisions(prepared.prepared.sql)).toEqual([]);
		});
});
