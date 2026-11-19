import { describe, expect, test } from "bun:test";
import { EXPLAINED } from "./sql-notices.fixtures.js";
import { resultNotices, sqlTraps } from "./sql-notices.js";

const now = new Date("2026-11-07T12:00:00Z");
const notices = (name: string) =>
	sqlTraps(EXPLAINED[name]?.ast ?? [], now).notices;

describe("sql notices", () => {
	test("a main-stream filter on a view of what agents did says subagent streams are left out", () => {
		expect(notices("mainCalls")).toEqual([
			expect.stringContaining(
				"agent_id = '' keeps only the main stream of calls, so subagent streams are left out",
			),
		]);
		expect(notices("mainCte")).toEqual([
			expect.stringContaining("main stream of calls"),
		]);
		expect(notices("mainRunsOnly")).toEqual([]);
		expect(notices("mainUnderOr")).toEqual([]);
	});

	test("a path matched by a directory says shell paths can be relative; a match by the end or an exclusion does not", () => {
		expect(notices("dirRegex")).toEqual([
			expect.stringContaining(
				"a path is matched by a directory ('(athena[^/]*)/AGENTS\\.md$'). A shell path after cd ~/… can be relative",
			),
		]);
		expect(notices("lambdaChanged")).toEqual([
			expect.stringContaining("('%apps/web/%')"),
		]);
		expect(notices("endRegex")).toEqual([]);
		expect(notices("negated")).toEqual([]);
	});

	test("a LIKE or regex over free text with no time filter or more than 14 days says so; a week or one session does not", () => {
		expect(notices("textNoWindow")).toEqual([
			expect.stringContaining("a LIKE or regex on command with no time filter"),
		]);
		expect(notices("textLong")).toEqual([
			expect.stringContaining("a LIKE or regex on command over 31 days"),
		]);
		expect(notices("textShort")).toEqual([]);
		expect(notices("textSession")).toEqual([]);
	});

	test("rates per time bucket without a count() of their own say to show the row count and that empty buckets are missing", () => {
		const unshown = [
			expect.stringContaining(
				"rates per time bucket are shown without the row count behind them. Add count() per bucket",
			),
		];
		expect(notices("rateByDay")).toEqual(unshown);
		expect(notices("rateByWeekExpression")).toEqual(unshown);
		expect(notices("rateByPosition")).toEqual(unshown);
		expect(notices("rateInSubquery")).toEqual(unshown);
		expect(notices("rateByDayCounted")).toEqual([]);
		expect(notices("rateNoBucket")).toEqual([]);
		expect(notices("bucketNoRate")).toEqual([]);
	});

	test("an empty result, or a count that is 0 in every row, asks for a broader check before saying none", () => {
		const traps = sqlTraps(EXPLAINED.mainCalls?.ast ?? [], now);
		expect(traps.counted).toEqual(["reads"]);
		expect(resultNotices(traps, [])).toEqual([
			expect.stringContaining("check: no rows."),
		]);
		expect(resultNotices(traps, [{ reads: "0" }, { reads: 0 }])).toEqual([
			expect.stringContaining(
				"check: reads is 0 in every row. Before saying none or 0 of N",
			),
		]);
		expect(resultNotices(traps, [{ reads: "0" }, { reads: 2 }])).toEqual([]);
		expect(resultNotices(traps, [{ reads: null }])).toEqual([]);
	});
});
