import { describe, expect, test } from "bun:test";
import {
	AnalysisFindInputSchema,
	AnalysisHistoryQueryOutputSchema,
	AnalysisReadInputSchema,
} from "../index.js";

const storedQuery = {
	id: "query",
	analysis: "analysis",
	step: "step",
	createdAt: "2026-10-01T00:00:00.000Z",
	stale: false,
	unavailable: null,
};

describe("analysis contract", () => {
	test("find and read keep their cross-field checks", () => {
		expect(
			AnalysisFindInputSchema.safeParse({ source: "tool", groupBy: "week" })
				.error?.issues,
		).toMatchObject([{ path: ["groupBy"], code: "custom" }]);
		expect(
			AnalysisReadInputSchema.safeParse({
				refs: [{ sessionId: "s", agentId: "", turn: 1 }],
				depth: "record",
			}).error?.issues,
		).toMatchObject([{ path: ["record"], code: "custom" }]);
	});

	test("stored query args are partial, unrefined and closed", () => {
		const parsed = AnalysisHistoryQueryOutputSchema.parse({
			...storedQuery,
			call: {
				tool: "read",
				args: { depth: "record", maxChars: 500 },
				output: null,
			},
		});
		expect(parsed.call.args).toEqual({ depth: "record", maxChars: 500 });

		expect(
			AnalysisHistoryQueryOutputSchema.safeParse({
				...storedQuery,
				call: { tool: "find", args: { unknown: true }, output: null },
			}).success,
		).toBe(false);
	});
});
