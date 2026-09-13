import { describe, expect, test } from "bun:test";
import {
	buildEpochs,
	buildFilteredMvSql,
	type CensusRow,
	changedCensusRows,
} from "../../scripts/backfill-subagent-metrics.js";

function censusRow(overrides: Partial<CensusRow> = {}): CensusRow {
	return {
		digest: "a".repeat(64),
		ingested_at_ms: "1787337601000",
		month: "202608",
		organization_id: "org-one",
		session_date_ms: "1787337600000",
		session_id: "shared-session",
		source: "codex",
		user_id: "user-one",
		...overrides,
	};
}

describe("subagent metrics backfill runner", () => {
	test("allocates the strict correction and writer-floor ladder", () => {
		expect(buildEpochs(1_000)).toEqual({
			c0: 1_001,
			c1: 1_002,
			c2: 1_003,
			floor: 1_004,
			s: 1_000,
		});
	});

	test("selects exact raw tuples and keeps cross-user session ids distinct", () => {
		const sql = buildFilteredMvSql([
			censusRow(),
			censusRow({
				digest: "b".repeat(64),
				organization_id: "org-two",
				user_id: "user-two",
			}),
		]);

		expect(sql).toContain("cs.organization_id = base64Decode(");
		expect(sql).toContain("cs.user_id = base64Decode(");
		expect(sql).toContain("cs.session_id = base64Decode(");
		expect(sql).toContain("toUnixTimestamp64Milli(cs.session_date)");
		expect(sql).toContain("toUnixTimestamp64Milli(cs.ingested_at)");
		expect(sql).toContain("a".repeat(64));
		expect(sql).toContain("b".repeat(64));
		expect(sql).not.toContain("session_id IN");
	});

	test("detects equal-timestamp content or metadata digest changes", () => {
		const before = [censusRow()];
		const after = [censusRow({ digest: "c".repeat(64) })];

		expect(changedCensusRows(before, after)).toEqual(after);
		expect(changedCensusRows(before, [])).toEqual(before);
		expect(changedCensusRows(after, after)).toEqual([]);
	});

	test("rejects batches that mix source MVs", () => {
		expect(() =>
			buildFilteredMvSql([censusRow(), censusRow({ source: "claude_code" })]),
		).toThrow("exactly one source");
	});
});
