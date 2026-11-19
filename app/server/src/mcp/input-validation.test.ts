import { expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";
import {
	AnalysisFindInputSchema,
	AnalysisHistorySaveInputSchema,
	AnalysisReadInputSchema,
} from "@rudel/api-routes";
import { parseMcpInput } from "./input-validation.js";

test("MCP cross-field failures are actionable BAD_REQUEST field issues", () => {
	for (const validate of [
		() =>
			parseMcpInput(AnalysisFindInputSchema, {
				source: "tool",
				groupBy: "week",
			}),
		() =>
			parseMcpInput(AnalysisReadInputSchema, {
				refs: [{ sessionId: "session", agentId: "", turn: 1 }],
				depth: "record",
			}),
	]) {
		try {
			validate();
			throw new Error("expected validation failure");
		} catch (error) {
			expect(error).toBeInstanceOf(ORPCError);
			if (!(error instanceof ORPCError)) throw error;
			expect(error.code).toBe("BAD_REQUEST");
			expect(error.status).toBe(400);
			expect(error.data).toMatchObject({
				issues: [{ path: expect.any(Array), message: expect.any(String) }],
			});
			expect(error.message).not.toContain("Try again");
		}
	}
});

test("analyses save without an analysis id says to pass the id from a trace line", () => {
	expect(() =>
		parseMcpInput(AnalysisHistorySaveInputSchema, { finalAnswer: "answer" }),
	).toThrow(
		"analysis: required: pass the analysis id from the trace line of a find or read call (trace analysis=<id>); without one, nothing was logged to save",
	);
});

test("refs without agentId read the main transcript", () => {
	expect(
		parseMcpInput(AnalysisReadInputSchema, {
			refs: [{ sessionId: "session", turn: 2 }],
		}).refs,
	).toEqual([{ sessionId: "session", agentId: "", turn: 2 }]);
});
