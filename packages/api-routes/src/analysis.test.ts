import { describe, expect, test } from "bun:test";
import {
	AnalysisFindInputSchema,
	AnalysisReadInputSchema,
	findLimit,
} from "./analysis.js";
import { AnalysisHistorySaveInputSchema } from "./analysis-history.js";

const ref = { sessionId: "session", agentId: "", turn: 1 };
describe("analysis input validation", () => {
	test("find requires source, is strict, and defaults bounded rows and signals", () => {
		expect(AnalysisFindInputSchema.safeParse({}).success).toBe(false);
		expect(
			AnalysisFindInputSchema.safeParse({ source: "runs", wholeSession: true })
				.success,
		).toBe(false);
		expect(AnalysisFindInputSchema.parse({ source: "runs" })).toMatchObject({
			includeNoise: false,
			sort: "startedAt",
			reaction: ["negative", "swear", "apology"],
		});
	});
	test("find pages hold 50 items, 20 tool groups, or the given limit", () => {
		expect(findLimit(AnalysisFindInputSchema.parse({ source: "runs" }))).toBe(
			50,
		);
		expect(findLimit(AnalysisFindInputSchema.parse({ source: "user" }))).toBe(
			50,
		);
		expect(findLimit(AnalysisFindInputSchema.parse({ source: "tool" }))).toBe(
			20,
		);
		expect(
			findLimit(AnalysisFindInputSchema.parse({ source: "tool", limit: 200 })),
		).toBe(200);
	});
	test("refs default agentId to the main transcript", () => {
		const { agentId: _agentId, ...main } = ref;
		expect(AnalysisReadInputSchema.parse({ refs: [main] }).refs).toEqual([
			{ sessionId: "session", agentId: "", turn: 1 },
		]);
		expect(
			AnalysisFindInputSchema.parse({ source: "runs", refs: [main] }).refs,
		).toEqual([{ sessionId: "session", agentId: "", turn: 1 }]);
		expect(
			AnalysisReadInputSchema.parse({
				refs: [{ ...main, agentId: "agent-1" }],
			}).refs[0]?.agentId,
		).toBe("agent-1");
		expect(
			AnalysisReadInputSchema.safeParse({ refs: [{ ...main, extra: 1 }] })
				.success,
		).toBe(false);
	});
	test("saving without an analysis id says to pass the id from a trace line", () => {
		const result = AnalysisHistorySaveInputSchema.safeParse({
			finalAnswer: "answer",
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues).toEqual([
			expect.objectContaining({
				path: ["analysis"],
				message: expect.stringContaining(
					"pass the analysis id from the trace line of a find or read call",
				),
			}),
		]);
		expect(
			AnalysisHistorySaveInputSchema.safeParse({
				analysis: 7,
				finalAnswer: "answer",
			}).error?.issues[0]?.message,
		).toBe("Invalid input: expected string, received number");
	});
	test("find rejects invalid scope, enums, limits, reversed dates and excessive refs", () => {
		for (const input of [
			{ source: "invalid" },
			{ source: "runs", latest: 201 },
			{ source: "runs", latest: 0 },
			{ source: "runs", limit: 201 },
			{ source: "runs", limit: 1.5 },
			{ source: "runs", limit: 0 },
			{ source: "runs", cursor: "" },
			{ source: "runs", from: "2026-02-30" },
			{ source: "runs", from: "2026-10-03", to: "2026-10-02" },
			{ source: "tool", groupBy: "week" },
			{ source: "user", reaction: ["positive"] },
			{ source: "runs", refs: Array.from({ length: 201 }, () => ref) },
			{ source: "runs", refs: [{ ...ref, turn: 0 }] },
		])
			expect(AnalysisFindInputSchema.safeParse(input).success).toBe(false);
		expect(
			AnalysisFindInputSchema.parse({
				source: "tool",
				kind: "noise",
				includeNoise: true,
				latest: 200,
				limit: 200,
			}).latest,
		).toBe(200);
	});
	test("read is run-only, strict, bounded and defaults to exchange", () => {
		expect(AnalysisReadInputSchema.parse({ refs: [ref] })).toMatchObject({
			depth: "exchange",
			maxChars: 12_000,
		});
		for (const input of [
			{ refs: [] },
			{ refs: [{ ...ref, turn: 0 }] },
			{ refs: [{ ...ref, turn: 4_294_967_295 }] },
			{ refs: Array.from({ length: 11 }, () => ref) },
			{ refs: [ref], maxChars: 40_001 },
			{ refs: [ref], maxChars: 0 },
			{ refs: [ref], sessionId: "session" },
			{ refs: [ref], depth: "record" },
			{ refs: [ref, ref], depth: "record", record: 1 },
			{ refs: [ref], depth: "record", record: 4_294_967_295 },
			{ refs: [ref], record: 1 },
			{ refs: [ref], depth: "record", record: 2, fromChar: 10, toChar: 1 },
			{ refs: [ref], depth: "record", record: 1, fromChar: 0, toChar: 0 },
			{ refs: [ref], depth: "record", record: 1, fromChar: 10, toChar: 10 },
			{
				refs: [ref],
				depth: "record",
				record: 1,
				fromChar: Number.MAX_SAFE_INTEGER + 1,
			},
			{
				refs: [ref],
				depth: "record",
				record: 1,
				toChar: Number.MAX_SAFE_INTEGER + 1,
			},
		])
			expect(AnalysisReadInputSchema.safeParse(input).success).toBe(false);
		expect(
			AnalysisReadInputSchema.parse({
				refs: [ref],
				depth: "record",
				record: 2,
				block: 0,
				fromChar: 1,
				toChar: 5,
				maxChars: 40_000,
			}).depth,
		).toBe("record");
	});
});
