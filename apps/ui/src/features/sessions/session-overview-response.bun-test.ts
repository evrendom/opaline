import { expect, test } from "bun:test";
import { SessionOverviewAnalyticsSchema } from "@rudel/api-routes";
import seed from "../demo/seed.json";
import { parseSessionOverviewRows } from "./session-overview-response";

const seedRow = seed.sessions[0];
if (!seedRow) throw new Error("Demo seed must contain a session");
const enrichmentKeys = new Set([
	"repository_identity",
	"subagent_count",
	"native_subagents",
	"error_count",
	"member_swear_matches",
	"member_apology_matches",
	"member_positive_matches",
	"model_swear_matches",
	"model_apology_matches",
	"model_positive_matches",
]);
const deployedRow = Object.fromEntries(
	Object.entries(seedRow).filter(([key]) => !enrichmentKeys.has(key)),
);

test("the preview can transition to all live rows when an older API omits enrichment", () => {
	expect(parseSessionOverviewRows(seed.sessions)).toHaveLength(
		seed.sessions.length,
	);
	const liveRows = Array.from(
		{ length: seed.totalSessionCount },
		(_, index) => ({
			...deployedRow,
			session_id: `live-${index}`,
		}),
	);
	const parsed = parseSessionOverviewRows(liveRows);
	expect(parsed).toHaveLength(seed.totalSessionCount);
	expect(parsed.map((row) => row.session_id)).toEqual(
		liveRows.map((row) => row.session_id),
	);
	for (const row of parsed) {
		for (const key of enrichmentKeys) {
			expect(Object.hasOwn(row, key)).toBe(false);
		}
	}
});

test("complete metadata stays verbatim and the strict release gate still rejects omissions", () => {
	const parsed = parseSessionOverviewRows([seedRow]);
	expect(parsed).toEqual([SessionOverviewAnalyticsSchema.parse(seedRow)]);
	expect(SessionOverviewAnalyticsSchema.safeParse(deployedRow).success).toBe(
		false,
	);
});

test("malformed core data and malformed supplied enrichment still fail validation", () => {
	for (const input of [
		null,
		{},
		[null],
		[{ ...deployedRow, session_id: undefined }],
		[{ ...deployedRow, input_tokens: "123" }],
		[{ ...deployedRow, error_count: -1 }],
		[{ ...deployedRow, member_swear_matches: [123] }],
	]) {
		expect(() => parseSessionOverviewRows(input)).toThrow();
	}
});
