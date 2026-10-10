import { describe, expect, test } from "bun:test";
import {
	AnalysisFindInputSchema,
	AnalysisFindOutputSchema,
	AnalysisReadInputSchema,
	findLimit,
	parsePullRequestRef,
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
			question: "Where our agents get stuck",
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
				question: "Where our agents get stuck",
				finalAnswer: "answer",
			}).error?.issues[0]?.message,
		).toBe("Invalid input: expected string, received number");
	});
	test("saving needs the question as a short title; find and read take no conversation text", () => {
		expect(
			AnalysisHistorySaveInputSchema.safeParse({
				analysis: "a_1",
				finalAnswer: "answer",
			}).error?.issues,
		).toEqual([
			expect.objectContaining({
				path: ["question"],
				message:
					"required: the question this answer addresses, as a short title",
			}),
		]);
		for (const removed of ["question", "step", "parentStep", "updates"]) {
			expect(
				AnalysisFindInputSchema.safeParse({ source: "runs", [removed]: "x" })
					.success,
			).toBe(false);
			expect(
				AnalysisReadInputSchema.safeParse({
					refs: [{ sessionId: "s", turn: 1 }],
					[removed]: "x",
				}).success,
			).toBe(false);
		}
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

describe("find pullRequest", () => {
	test("reads owner/name#number and GitHub pull request URLs", () => {
		for (const value of [
			"opalinehq/athena#133",
			" opalinehq/athena#133 ",
			"https://github.com/opalinehq/athena/pull/133",
			"https://github.com/opalinehq/athena/pull/133/files",
			"https://www.github.com/opalinehq/athena/pull/133#issuecomment-1",
			"github.com/opalinehq/athena/pull/133?w=1",
		])
			expect(parsePullRequestRef(value)).toEqual({
				fullName: "opalinehq/athena",
				number: 133,
			});
		for (const value of [
			"opalinehq/athena",
			"#133",
			"opalinehq/athena#0",
			"https://gitlab.com/opalinehq/athena/pull/133",
			"https://github.com/opalinehq/athena/issues/133",
			"opalinehq/athena#133x",
		])
			expect(parsePullRequestRef(value)).toBeNull();
	});

	test("is only valid for source=git and must name a pull request", () => {
		expect(
			AnalysisFindInputSchema.parse({
				source: "git",
				pullRequest: "opalinehq/athena#133",
			}).pullRequest,
		).toBe("opalinehq/athena#133");
		expect(
			AnalysisFindInputSchema.safeParse({
				source: "runs",
				pullRequest: "opalinehq/athena#133",
			}).error?.issues,
		).toMatchObject([
			{
				path: ["pullRequest"],
				message: "pullRequest is only valid for source=git",
			},
		]);
		expect(
			AnalysisFindInputSchema.safeParse({ source: "git", pullRequest: "133" })
				.error?.issues,
		).toMatchObject([{ path: ["pullRequest"], code: "custom" }]);
	});
});

describe("find git output", () => {
	const event = {
		sessionId: "s1",
		agentId: "",
		turn: 1,
		record: 3,
		block: 0,
		call: "call",
		at: "2026-10-07T12:00:00.000Z",
		kind: "push_range",
		label: "observed",
		branch: "feat/links",
		sourceBranch: "feat/links",
		shortSha: "",
		pushFrom: "a1b2c3d",
		pushTo: "d4e5f6a",
		remote: "github.com:opalinehq/athena.git",
		prRepo: "",
		prNumber: null,
		commitHash: "",
		baseCommit: "",
		runId: "",
		generation: null,
		repository: null,
		github: {
			status: "unbound",
			reason: null,
			prFrom: null,
			ciFrom: null,
			coveredThrough: null,
		},
		sha: null,
		pullRequests: [],
		ciRuns: [],
		ciRunsObserved: 0,
		ciRunCount: null,
		ciRunCountThrough: null,
		ciRunCountUnknown: "github_status",
		ciConclusions: {},
		checksAfter: null,
		parentSessionId: null,
	};
	const header = {
		from: "2026-10-01",
		to: "2026-10-07",
		sessionsInScope: 1,
		indexedSessions: 1,
		runsInScope: 1,
		minutes: 1,
		activeMinutes: 1,
		pricedCostUsd: 0,
		unattributedCostUsd: 0,
		unpricedRuns: 0,
		rawChars: 0,
		truncated: false,
		notes: [],
		classifierVersion: 1,
	};
	test("results stored before links came from edges still parse, without a link source", () => {
		const stored = { source: "git", header, events: [event] };
		const parsed = AnalysisFindOutputSchema.parse(stored);
		// Nothing is added: the JSON is exactly the stored one.
		expect(JSON.parse(JSON.stringify(parsed))).toEqual(stored);
		// Stored while `edges` defaulted to null: still parses.
		const withNull = AnalysisFindOutputSchema.parse({
			...stored,
			events: [{ ...event, edges: null }],
			witnesses: [],
		});
		expect(withNull.source === "git" && withNull.events[0]?.edges).toBeNull();
	});

	test("an event says whether its links came from edges or query time", () => {
		const parsed = AnalysisFindOutputSchema.parse({
			source: "git",
			header,
			events: [
				{
					...event,
					edges: {
						linkedBy: "query",
						status: "not_built",
						builtAt: null,
					},
				},
			],
		});
		expect(parsed.source === "git" && parsed.events[0]?.edges).toEqual({
			linkedBy: "query",
			status: "not_built",
			builtAt: null,
		});
		expect(
			AnalysisFindOutputSchema.safeParse({
				source: "git",
				header,
				events: [
					{
						...event,
						edges: { linkedBy: "worker", status: "current", builtAt: null },
					},
				],
			}).success,
		).toBe(false);
	});
});
