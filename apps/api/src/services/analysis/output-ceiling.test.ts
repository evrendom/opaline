import { expect, test } from "bun:test";
import type { AnalysisFindOutput, AnalysisReadOutput } from "@rudel/api-routes";
import { MCP_TOOL_OUTPUT_CHAR_BUDGET } from "./compact.js";
import { renderFind } from "./find-text.js";
import {
	ANALYSIS_OUTPUT_MAX_BYTES,
	fitFindOutput,
	fitReadOutput,
	jsonBytes,
	TRACE_RESERVE_BYTES,
	withFindTrace,
	withReadTrace,
} from "./output-ceiling.js";

const header: AnalysisFindOutput["header"] = {
	from: "2026-09-01",
	to: "2026-10-01",
	sessionsInScope: 1_000,
	indexedSessions: 1_000,
	runsInScope: 20_000,
	minutes: 1,
	activeMinutes: 1,
	pricedCostUsd: 1,
	unattributedCostUsd: 0,
	unpricedRuns: 0,
	rawChars: 1,
	truncated: false,
	notes: ["existing note"],
	classifierVersion: 1,
};

/** The trace with ids at the 40-character limit the API accepts. */
const longestTrace = {
	analysis: `a_${"x".repeat(38)}`,
	step: `s_${"x".repeat(38)}`,
	query: `q_${"x".repeat(38)}`,
};

test("a find result within the ceiling is returned unchanged", () => {
	const output: AnalysisFindOutput = { source: "tool", header, groups: [] };
	expect(fitFindOutput(output)).toBe(output);
});

test("200 tool groups are cut to the leading groups whose delivered text fits, with a marker and no note", () => {
	const ref = { sessionId: crypto.randomUUID(), agentId: "", turn: 1 };
	const groups = Array.from({ length: 200 }, (_, index) => ({
		toolGroup: "shell",
		cause: `cause ${index}`,
		detail: "detail",
		kind: "mistake",
		count: 1,
		sessions: 1,
		firstSeen: "2026-09-01T00:00:00.000Z",
		lastSeen: "2026-09-01T00:00:00.000Z",
		topCommands: Array.from(
			{ length: 3 },
			(_, n) => `${index}.${n} ${"c".repeat(200)}`,
		),
		minutes: 1,
		activeMinutes: 1,
		costUsd: null,
		examples: Array.from({ length: 5 }, (_, record) => ({
			ref,
			record,
			errorLine: `${index}.${record} ${"e\t".repeat(100)}`,
			parentSessionId: null,
		})),
	}));
	const output: AnalysisFindOutput = { source: "tool", header, groups };
	expect(renderFind(output).length).toBeGreaterThan(
		2 * MCP_TOOL_OUTPUT_CHAR_BUDGET,
	);

	const fitted = fitFindOutput(output);
	expect(fitted.source).toBe("tool");
	expect(jsonBytes(fitted)).toBeLessThanOrEqual(ANALYSIS_OUTPUT_MAX_BYTES);
	const kept = fitted.source === "tool" ? fitted.groups : [];
	expect(kept.length).toBeGreaterThan(0);
	expect(kept).toEqual(groups.slice(0, kept.length));
	const text = renderFind(fitted);
	expect(text.length).toBeLessThanOrEqual(MCP_TOOL_OUTPUT_CHAR_BUDGET);
	expect(text.length).toBeGreaterThan(MCP_TOOL_OUTPUT_CHAR_BUDGET / 2);
	expect(fitted.header.truncated).toBe(true);
	expect(fitted.header.omitted).toBe(200 - kept.length);
	expect(fitted.header.notes).toEqual(["existing note"]);
	expect(text).toContain(
		`\n… [${200 - kept.length} more rows omitted to fit the response size limit]`,
	);
	expect(output.header.notes).toEqual(["existing note"]);
});

test("200 tool groups of multibyte text whose JSON outgrows the stored-result ceiling are cut to it, with a note", () => {
	const ref = { sessionId: crypto.randomUUID(), agentId: "", turn: 1 };
	const groups = Array.from({ length: 200 }, (_, index) => ({
		toolGroup: "shell",
		cause: `cause ${index}`,
		detail: "detail",
		kind: "mistake",
		count: 1,
		sessions: 1,
		firstSeen: "2026-09-01T00:00:00.000Z",
		lastSeen: "2026-09-01T00:00:00.000Z",
		topCommands: Array.from({ length: 3 }, () => "命".repeat(200)),
		minutes: 1,
		activeMinutes: 1,
		costUsd: null,
		examples: Array.from({ length: 5 }, (_, record) => ({
			ref,
			record,
			errorLine: "错\n".repeat(150),
			parentSessionId: null,
		})),
	}));
	const output: AnalysisFindOutput = { source: "tool", header, groups };
	expect(jsonBytes(output)).toBeGreaterThan(4 * ANALYSIS_OUTPUT_MAX_BYTES);

	const fitted = fitFindOutput(output);
	expect(fitted.source).toBe("tool");
	expect(jsonBytes(fitted)).toBeLessThanOrEqual(ANALYSIS_OUTPUT_MAX_BYTES);
	const kept = fitted.source === "tool" ? fitted.groups : [];
	expect(kept.length).toBeGreaterThan(0);
	expect(kept).toEqual(groups.slice(0, kept.length));
	expect(
		jsonBytes({ ...fitted, groups: groups.slice(0, kept.length + 1) }),
	).toBeGreaterThan(ANALYSIS_OUTPUT_MAX_BYTES - TRACE_RESERVE_BYTES);
	expect(fitted.header.truncated).toBe(true);
	expect(fitted.header.notes).toEqual([
		"existing note",
		`only the first ${kept.length} of 200 groups fit the 256 KiB result ceiling; narrow the scope or lower limit`,
	]);
	expect(renderFind(fitted).length).toBeLessThanOrEqual(
		MCP_TOOL_OUTPUT_CHAR_BUDGET,
	);
});

test("a find page cut to the ceiling continues after its last kept item", () => {
	const ref = { sessionId: crypto.randomUUID(), agentId: "", turn: 1 };
	const events = Array.from({ length: 500 }, (_, index) => ({
		type: "negative" as const,
		terms: ["wrong"],
		eventRef: { ...ref, turn: index + 1, record: 1 },
		quote: `${index}${"错".repeat(200)}`,
		partial: false,
		originRef: null,
		originMinutes: null,
		originCostUsd: null,
		parentSessionId: null,
	}));
	const output: AnalysisFindOutput = {
		source: "user",
		header: { ...header, truncated: true, cursor: "after-499" },
		events,
		groups: [],
	};

	const fitted = fitFindOutput(output, (index) => `after-${index}`);
	const kept = fitted.source === "user" ? fitted.events : [];
	expect(kept.length).toBeGreaterThan(0);
	expect(kept.length).toBeLessThan(events.length);
	const text = renderFind(fitted);
	expect(text.length).toBeLessThanOrEqual(MCP_TOOL_OUTPUT_CHAR_BUDGET);
	expect(fitted.header.cursor).toBe(`after-${kept.length - 1}`);
	expect(fitted.header.omitted).toBe(500 - kept.length);
	expect(text.split("\n").at(-1)).toBe(
		`Showing ${kept.length} results. More results exist: call find again with the same arguments and cursor=after-${kept.length - 1} to get the next page.`,
	);
});

test("a read whose escaped text exceeds the ceiling keeps its leading sections and is truncated", () => {
	const section = (index: number) => ({
		name: "record",
		text: "\u0001".repeat(40),
		record: {
			index,
			block: 0,
			kind: "tool_result",
			tool: "Bash",
			callId: "call",
			path: "",
			commandClass: "",
			isError: false,
			exitCode: null,
			cut: false,
		},
	});
	const reads = Array.from({ length: 4 }, (_, read) => ({
		ref: { sessionId: `session_${read}`, agentId: "", turn: 1 },
		header: "run",
		found: true,
		truncated: false,
		sections: Array.from({ length: 600 }, (_, index) => section(index)),
	}));
	const output: AnalysisReadOutput = {
		maxChars: 40_000,
		truncated: false,
		reads,
	};
	expect(jsonBytes(output)).toBeGreaterThan(ANALYSIS_OUTPUT_MAX_BYTES);

	const fitted = fitReadOutput(output);
	expect(jsonBytes(fitted)).toBeLessThanOrEqual(ANALYSIS_OUTPUT_MAX_BYTES);
	expect(fitted.truncated).toBe(true);
	const kept = fitted.reads.flatMap((read) => read.sections);
	expect(kept.length).toBeGreaterThan(0);
	expect(kept).toEqual(
		reads.flatMap((read) => read.sections).slice(0, kept.length),
	);
	expect(fitted.reads.map((read) => read.ref)).toEqual(
		reads.map((read) => read.ref),
	);
	expect(fitted.reads.at(-1)?.truncated).toBe(true);
	expect(fitReadOutput(fitted)).toBe(fitted);
});

test("a find body of exactly 256 KiB is cut so the response with its trace still fits", () => {
	const groups = Array.from({ length: 200 }, (_, index) => ({
		toolGroup: "shell",
		cause: `cause ${index}`,
		detail: "detail",
		kind: "mistake",
		count: 1,
		sessions: 1,
		firstSeen: "2026-09-01T00:00:00.000Z",
		lastSeen: "2026-09-01T00:00:00.000Z",
		topCommands: ["c".repeat(200)],
		minutes: 1,
		activeMinutes: 1,
		costUsd: null,
		examples: [
			{
				ref: { sessionId: crypto.randomUUID(), agentId: "", turn: 1 },
				record: 1,
				errorLine: "e".repeat(700),
				parentSessionId: null,
			},
		],
	}));
	const unpadded: AnalysisFindOutput = {
		source: "tool",
		header: { ...header, notes: [""] },
		groups,
	};
	const output: AnalysisFindOutput = {
		...unpadded,
		header: {
			...header,
			notes: ["n".repeat(ANALYSIS_OUTPUT_MAX_BYTES - jsonBytes(unpadded))],
		},
	};
	expect(jsonBytes(output)).toBe(ANALYSIS_OUTPUT_MAX_BYTES);

	const fitted = fitFindOutput(output);
	expect(fitted.header.truncated).toBe(true);
	expect(jsonBytes(withFindTrace(fitted, longestTrace))).toBeLessThanOrEqual(
		ANALYSIS_OUTPUT_MAX_BYTES,
	);
});

test("a read cut to the ceiling still fits with its trace", () => {
	const reads = Array.from({ length: 2 }, (_, read) => ({
		ref: { sessionId: `session_${read}`, agentId: "", turn: 1 },
		header: "run",
		found: true,
		truncated: false,
		sections: Array.from({ length: 2_000 }, (_, index) => ({
			name: `section ${index}`,
			text: "t".repeat(100),
		})),
	}));
	const fitted = fitReadOutput({ maxChars: 40_000, truncated: false, reads });
	expect(fitted.truncated).toBe(true);
	expect(jsonBytes(withReadTrace(fitted, longestTrace))).toBeLessThanOrEqual(
		ANALYSIS_OUTPUT_MAX_BYTES,
	);
});

test("pullRequest witnesses are fitted too, leaving events the rest, and a cut list says so", () => {
	const witness = (index: number) => ({
		sessionId: `session-${index}`,
		agentId: "é".repeat(200),
		turn: 1,
		relation: "pr_named",
		matchedValue: "133",
		at: "2026-09-15T10:00:00.000Z",
		evidenceId: `obs:${"%C3%A9".repeat(200)}:${index}:0:pr_url`,
		generation: { revision: "1", parserVersion: 773 },
		reason: "transcript_unavailable" as const,
	});
	const event = {
		sessionId: "s1",
		agentId: "",
		turn: 1,
		record: 3,
		block: 0,
		call: "call",
		at: "2026-10-03T00:00:00Z",
		kind: "push_range" as const,
		label: "observed",
		branch: "x".repeat(2_000),
		sourceBranch: "",
		shortSha: "",
		pushFrom: "",
		pushTo: "",
		remote: "",
		prRepo: "",
		prNumber: null,
		commitHash: "",
		baseCommit: "",
		runId: "",
		generation: null,
		repository: null,
		github: {
			status: "unbound" as const,
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
		ciRunCountUnknown: "github_status" as const,
		ciConclusions: {},
		checksAfter: null,
		parentSessionId: null,
	};
	const output: AnalysisFindOutput = {
		source: "git",
		header,
		events: Array.from({ length: 50 }, () => event),
		witnesses: Array.from({ length: 200 }, (_, index) => witness(index)),
	};
	expect(jsonBytes(output)).toBeGreaterThan(ANALYSIS_OUTPUT_MAX_BYTES * 1.5);
	const fitted = fitFindOutput(output);
	if (fitted.source !== "git") throw new Error("expected a git result");
	expect(jsonBytes(fitted)).toBeLessThanOrEqual(
		ANALYSIS_OUTPUT_MAX_BYTES - TRACE_RESERVE_BYTES,
	);
	const kept = fitted.witnesses?.length ?? 0;
	expect(kept).toBeGreaterThan(0);
	expect(kept).toBeLessThan(200);
	// Events keep the larger share.
	expect(fitted.events.length).toBeGreaterThan(50 / 2);
	expect(fitted.header.truncated).toBe(true);
	expect(fitted.header.notes).toContain(
		`… [${200 - kept} more witnesses omitted to fit the response size limit]; narrow the dates or sessions to see them`,
	);
	expect(renderFind(fitted).length).toBeLessThanOrEqual(
		MCP_TOOL_OUTPUT_CHAR_BUDGET,
	);

	// Witnesses alone still fit together with the note that says they were cut.
	const alone = fitFindOutput({ ...output, events: [] });
	if (alone.source !== "git") throw new Error("expected a git result");
	expect(alone.header.truncated).toBe(true);
	expect(jsonBytes(alone)).toBeLessThanOrEqual(
		ANALYSIS_OUTPUT_MAX_BYTES - TRACE_RESERVE_BYTES,
	);
});
