import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";
import { AnalysisFindInputSchema, type FindFilter } from "@rudel/api-routes";
import { compileFindFilters, filterView } from "./find-filter-queries.js";
import {
	closestKeys,
	compileFilters,
	type FilterView,
	filterKind,
} from "./find-filters.js";

const view: FilterView = {
	name: "runs",
	columns: [
		{ name: "repository", type: "String" },
		{ name: "prompt_head", type: "Nullable(String)" },
		{ name: "agent_id", type: "String" },
		{ name: "model", type: "LowCardinality(Nullable(String))" },
		{ name: "cost_usd", type: "Nullable(Float64)" },
		{ name: "turn_idx", type: "UInt32" },
		{ name: "command_fingerprint", type: "Nullable(UInt64)" },
		{ name: "started_at", type: "DateTime64(3, 'UTC')" },
		{ name: "said_done", type: "Nullable(Bool)" },
		{ name: "failed", type: "UInt8" },
		{ name: "skills", type: "Array(String)" },
		{
			name: "model_costs",
			type: "Array(Tuple(String, Nullable(Float64), UInt32))",
		},
		{ name: "facts", type: "Map(String, String)" },
	],
	unsupported: ["coverage_gaps"],
};

function compiled(...filters: FindFilter[]) {
	return compileFilters(filters, view, "runs");
}

function refusal(...filters: FindFilter[]): string {
	try {
		compiled(...filters);
	} catch (error) {
		expect(error).toBeInstanceOf(ORPCError);
		return (error as ORPCError<"BAD_REQUEST", unknown>).message;
	}
	throw new Error("filters were accepted");
}

describe("filter column types", () => {
	test("each view type maps to the operators PostHog gives its value type", () => {
		expect(
			Object.fromEntries(
				view.columns.map((column) => [column.name, filterKind(column.type)]),
			),
		).toEqual({
			repository: "string",
			prompt_head: "string",
			agent_id: "string",
			model: "string",
			cost_usd: "number",
			turn_idx: "integer",
			command_fingerprint: "integer",
			started_at: "date",
			said_done: "boolean",
			failed: "boolean",
			skills: "array",
			model_costs: "array",
			facts: null,
		});
	});

	test("the runs and calls views give every filterable column a type", () => {
		for (const source of ["runs", "calls"] as const)
			for (const column of filterView(source).columns)
				expect({
					column: column.name,
					kind: filterKind(column.type),
				}).not.toEqual({
					column: column.name,
					kind: null,
				});
	});
});

describe("filter SQL per operator", () => {
	test("string operators bind their values as parameters", () => {
		const result = compiled(
			{ key: "repository", operator: "exact", value: ["web", "api"] },
			{ key: "repository", operator: "is_not", value: "docs" },
			{ key: "prompt_head", operator: "icontains", value: "Deploy" },
			{ key: "prompt_head", operator: "not_icontains", value: "test" },
			{ key: "prompt_head", operator: "regex", value: "(?i)migrat" },
			{ key: "prompt_head", operator: "not_regex", value: "^/" },
			{ key: "agent_id", operator: "is_set" },
			{ key: "model", operator: "is_not_set" },
		);
		expect(result.sql.split(" AND ")).toEqual([
			"(ifNull(repository IN {filter0:Array(String)}, 0))",
			"(ifNull(repository NOT IN {filter1:Array(String)}, 1))",
			"(ifNull(positionCaseInsensitiveUTF8(prompt_head, {filter2:String}) > 0, 0))",
			"(ifNull(positionCaseInsensitiveUTF8(prompt_head, {filter3:String}) = 0, 1))",
			"(ifNull(match(prompt_head, {filter4:String}), 0))",
			"(ifNull(NOT match(prompt_head, {filter5:String}), 1))",
			"(ifNull(agent_id, '') != '')",
			"(ifNull(model, '') = '')",
		]);
		expect(result.params).toEqual({
			filter0: ["web", "api"],
			filter1: ["docs"],
			filter2: "Deploy",
			filter3: "test",
			filter4: "(?i)migrat",
			filter5: "^/",
		});
		expect(result.text).toContain('prompt_head regex "(?i)migrat"');
	});

	test("a value never reaches the SQL text", () => {
		const result = compiled({
			key: "repository",
			operator: "exact",
			value: "x') OR 1=1 --",
		});
		expect(result.sql).not.toContain("OR 1=1");
		expect(result.params.filter0).toEqual(["x') OR 1=1 --"]);
	});

	test("numbers compare as floats, integers exactly as decimal text", () => {
		const result = compiled(
			{ key: "cost_usd", operator: "gt", value: 1.5 },
			{ key: "cost_usd", operator: "lt", value: "10" },
			{ key: "cost_usd", operator: "exact", value: [0.25, 2] },
			{
				key: "command_fingerprint",
				operator: "exact",
				value: "5517826819981700007",
			},
			{ key: "turn_idx", operator: "is_set" },
		);
		expect(result.sql.split(" AND ")).toEqual([
			"(ifNull(cost_usd > {filter0:Float64}, 0))",
			"(ifNull(cost_usd < {filter1:Float64}, 0))",
			"(ifNull(has({filter2:Array(Float64)}, toFloat64(cost_usd)), 0))",
			"(ifNull(has({filter3:Array(String)}, toString(command_fingerprint)), 0))",
			"(turn_idx IS NOT NULL)",
		]);
		expect(result.params).toEqual({
			filter0: 1.5,
			filter1: 10,
			filter2: [0.25, 2],
			filter3: ["5517826819981700007"],
		});
	});

	test("dates, booleans and arrays", () => {
		const result = compiled(
			{ key: "started_at", operator: "is_date_exact", value: "2026-10-27" },
			{ key: "started_at", operator: "is_date_before", value: "2026-11-01" },
			{
				key: "started_at",
				operator: "is_date_after",
				value: "2026-10-28T12:00:00Z",
			},
			{ key: "said_done", operator: "exact", value: true },
			{ key: "failed", operator: "exact", value: "false" },
			{ key: "skills", operator: "icontains", value: "review" },
			{ key: "skills", operator: "not_icontains", value: "deploy" },
			{ key: "skills", operator: "is_not_set" },
		);
		expect(result.sql.split(" AND ")).toEqual([
			"(ifNull(toDate(started_at) = {filter0:Date}, 0))",
			"(ifNull(started_at < parseDateTime64BestEffort({filter1:String}, 3, 'UTC'), 0))",
			"(ifNull(started_at > parseDateTime64BestEffort({filter2:String}, 3, 'UTC'), 0))",
			"(ifNull(toUInt8(said_done) IN {filter3:Array(UInt8)}, 0))",
			"(ifNull(toUInt8(failed) IN {filter4:Array(UInt8)}, 0))",
			"(arrayExists(element -> positionCaseInsensitiveUTF8(toString(element), {filter5:String}) > 0, skills))",
			"(NOT arrayExists(element -> positionCaseInsensitiveUTF8(toString(element), {filter6:String}) > 0, skills))",
			"(empty(skills))",
		]);
		expect(result.params.filter3).toEqual([1]);
		expect(result.params.filter4).toEqual([0]);
	});
});

describe("filter validation", () => {
	test("an unknown key lists the closest keys first and says how to look values up", () => {
		const message = refusal({
			key: "promt_head",
			operator: "regex",
			value: "x",
		});
		expect(message).toStartWith(
			'filters[0]: "promt_head" is not a column of the runs view, which source=runs filters. Closest: prompt_head,',
		);
		expect(message).toContain("Valid keys: repository, prompt_head");
		expect(message).toContain(
			"DO NOT GUESS a key or its values: you MUST run schema view=runs column=<key>",
		);
		expect(closestKeys("cost", ["repository", "cost_usd", "costs"])).toEqual([
			"costs",
			"cost_usd",
			"repository",
		]);
	});

	test("operators must fit the column type", () => {
		expect(refusal({ key: "repository", operator: "gt", value: 1 })).toBe(
			"filters[0]: operator gt does not apply to repository (string, String); use one of: exact, is_not, icontains, not_icontains, regex, not_regex, is_set, is_not_set",
		);
		expect(
			refusal({ key: "skills", operator: "exact", value: "review" }),
		).toContain("use one of: icontains, not_icontains, is_set, is_not_set");
		expect(
			refusal({ key: "started_at", operator: "gt", value: "2026-10-01" }),
		).toContain("is_date_exact, is_date_before, is_date_after");
		expect(refusal({ key: "facts", operator: "exact", value: "a" })).toContain(
			"which find cannot filter; read it with sql",
		);
	});

	test("values must fit the operator", () => {
		expect(refusal({ key: "cost_usd", operator: "gt" })).toBe(
			"filters[0]: gt needs a value",
		);
		expect(refusal({ key: "agent_id", operator: "is_set", value: "x" })).toBe(
			"filters[0]: is_set takes no value",
		);
		expect(refusal({ key: "cost_usd", operator: "gt", value: [1, 2] })).toBe(
			"filters[0]: gt takes one value; only exact and is_not take an array",
		);
		expect(refusal({ key: "cost_usd", operator: "gt", value: "cheap" })).toBe(
			'filters[0]: "cheap" is not a number',
		);
		expect(refusal({ key: "turn_idx", operator: "exact", value: 1.5 })).toBe(
			"filters[0]: 1.5 is not an integer",
		);
		expect(refusal({ key: "said_done", operator: "exact", value: "yes" })).toBe(
			'filters[0]: "yes" is not true or false',
		);
		expect(
			refusal({
				key: "started_at",
				operator: "is_date_exact",
				value: "2026-10-27T10:00:00Z",
			}),
		).toContain("is_date_exact takes a day as YYYY-MM-DD");
		expect(
			refusal(
				{ key: "repository", operator: "is_set" },
				{ key: "started_at", operator: "is_date_after", value: "soon" },
			),
		).toStartWith('filters[1]: "soon" is not a date');
	});

	test("a calls column find cannot compute points at sql", () => {
		const input = AnalysisFindInputSchema.parse({
			source: "calls",
			filters: [
				{ key: "background_status", operator: "exact", value: "killed" },
			],
		});
		expect(() => compileFindFilters(input)).toThrow(
			"filters[0]: background_status is a column of the calls view that find source=calls cannot filter on; read it with sql",
		);
	});

	test("each source filters the columns of its view", () => {
		const runs = compileFindFilters(
			AnalysisFindInputSchema.parse({
				source: "tool",
				filters: [{ key: "cwd_repository", operator: "is_set" }],
			}),
		);
		expect(runs?.view).toBe("runs");
		const calls = compileFindFilters(
			AnalysisFindInputSchema.parse({
				source: "calls",
				filters: [
					{ key: "call_minutes", operator: "gt", value: 2 },
					{ key: "command", operator: "regex", value: "^bun test" },
				],
			}),
		);
		expect(calls?.view).toBe("calls");
		expect(calls?.sql).toBe(
			"(ifNull(call_minutes > {filter0:Float64}, 0)) AND (ifNull(match(command, {filter1:String}), 0))",
		);
	});
});

describe("find input", () => {
	const issues = (input: Record<string, unknown>) => {
		const parsed = AnalysisFindInputSchema.safeParse(input);
		return parsed.success
			? []
			: parsed.error.issues.map((issue) => issue.message);
	};

	test("regex values stop at 800 characters", () => {
		expect(
			issues({
				source: "runs",
				filters: [
					{ key: "prompt_head", operator: "regex", value: "a".repeat(801) },
				],
			}),
		).toHaveLength(1);
		expect(
			issues({
				source: "runs",
				filters: [
					{ key: "prompt_head", operator: "regex", value: "a".repeat(800) },
				],
			}),
		).toEqual([]);
	});

	test("random order samples rows of runs and calls only", () => {
		expect(issues({ source: "runs", sort: "random" })).toEqual([]);
		expect(issues({ source: "calls", sort: "random" })).toEqual([]);
		expect(issues({ source: "runs", sort: "random", groupBy: "week" })).toEqual(
			[
				"sort=random samples rows of source=runs or source=calls without groupBy",
			],
		);
		expect(issues({ source: "tool", sort: "random" })).toHaveLength(1);
	});

	test("weekly takes no filters or session tree; sessionId and parentSessionId exclude each other", () => {
		expect(
			issues({
				source: "weekly",
				filters: [{ key: "repository", operator: "is_set" }],
				parentSessionId: "s",
			}),
		).toEqual([
			"parentSessionId is not valid for source=weekly, which sums whole weeks per member and agent",
			"filters is not valid for source=weekly, which sums whole weeks per member and agent",
		]);
		expect(
			issues({ source: "runs", sessionId: "a", parentSessionId: "a" }),
		).toEqual([
			"pass sessionId or parentSessionId, not both: parentSessionId already includes the session itself",
		]);
		expect(issues({ source: "runs", offset: 10_001 })).toHaveLength(1);
	});
});
