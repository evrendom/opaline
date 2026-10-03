import { expect, test } from "bun:test";
import type { AnalysisFindOutput, AnalysisReadOutput } from "@rudel/api-routes";
import { budgetReadOutput } from "../services/analysis/read-output.js";
import { renderFind, renderRead } from "./analysis-renderers.js";

/** What analysis.read returns: its output already fitted to maxChars. */
function renderBudgeted(output: AnalysisReadOutput): string {
	return renderRead(budgetReadOutput(output, output.maxChars ?? 12_000));
}

const ref = { sessionId: "session", agentId: "", turn: 1 };
const header: AnalysisFindOutput["header"] = {
	from: "2026-10-01",
	to: "2026-10-03",
	sessionsInScope: 2,
	indexedSessions: 1,
	runsInScope: 1,
	minutes: 1,
	pricedCostUsd: 0.25,
	unattributedCostUsd: 0,
	unpricedRuns: 0,
	rawChars: 1_000,
	truncated: false,
	notes: ["indexed only"],
	classifierVersion: 1,
};

test("runs render compact TSV, all facts, escaped cells and null pricing", () => {
	const text = renderFind({
		source: "runs",
		header,
		rows: [
			{
				ref,
				startedAt: "2026-10-03T00:00:00Z",
				minutes: 1,
				costUsd: null,
				model: "model",
				repository: "repo",
				agent: "claude_code",
				promptHead: "hello\nnext\tcolumn",
				edits: 1,
				toolCalls: 2,
				failedCalls: 1,
				readCalls: 1,
				searchCalls: 0,
				notFound: 1,
				nextReaction: null,
				rawChars: 1_000,
			},
		],
	});
	expect(text).toContain("sessions=2 indexed=1 runs=1");
	expect(text).toContain("classifier=1 truncated=false");
	expect(text).toContain("ref\tstartedAt\tminutes\tcostUsd");
	expect(text).toContain('"agentId":"","turn":1');
	expect(text).toContain("hello\\nnext\\tcolumn");
	expect(text).toContain("\t1\tnull\tmodel\t");
	expect(text).not.toContain('"header":');
});

test("all group modes and reaction origins render with table headers", () => {
	expect(
		renderFind({
			source: "runs",
			header,
			groups: [
				{ key: "model", runs: 1, sessions: 1, minutes: 1, costUsd: 0.25 },
			],
		}),
	).toContain("key\truns\tsessions\tminutes\tcostUsd\nmodel\t1\t1\t1\t0.25");
	expect(
		renderFind({
			source: "tool",
			header,
			groups: [
				{
					toolGroup: "read",
					cause: "path does not exist",
					detail: "src/a.ts",
					kind: "mistake",
					count: 1,
					sessions: 1,
					firstSeen: "2026-10-03",
					lastSeen: "2026-10-03",
					topCommands: ["cat <path>"],
					minutes: 1,
					costUsd: 0.25,
					examples: [{ ref, record: 3, errorLine: "ENOENT" }],
				},
			],
		}),
	).toContain('"turn":1}@3 ENOENT');
	const user = renderFind({
		source: "user",
		header,
		events: [
			{
				type: "swear",
				terms: ["fuck"],
				eventRef: { ...ref, turn: 2, record: 5 },
				quote: "fuck",
				partial: true,
				originRef: ref,
				originMinutes: 1,
				originCostUsd: 0.25,
			},
		],
		groups: [{ type: "swear", count: 1, sessions: 1 }],
	});
	expect(user).toContain(
		"eventRef\toriginRef\toriginMinutes\toriginCostUsd\tpartial\tquote",
	);
	expect(user).toContain("\t1\t0.25\ttrue\tfuck");
	expect(user).toContain("type\tcount\tsessions\nswear\t1\t1");
});

test("read renders shared cuts, empty reads, and escaped raw text", () => {
	const output: AnalysisReadOutput = {
		truncated: true,
		reads: [
			{
				ref,
				header: "run facts",
				found: true,
				truncated: true,
				sections: [{ name: "record", text: "line 1\nline 2\tcolumn\\path" }],
			},
		],
	};
	const text = renderBudgeted(output);
	expect(text).toContain("read truncated=true\nref ");
	expect(text).toContain("section\ttext");
	expect(text).toContain("line 1\\nline 2\\tcolumn\\\\path");
	expect(text).toEndWith("[cut]");
	expect(renderBudgeted({ truncated: false, reads: [] })).toBe(
		"read truncated=false",
	);
});

test("read charges framing, long refs, metadata and escapes and reserves a cut marker", () => {
	const output: AnalysisReadOutput = {
		maxChars: 1200,
		truncated: false,
		reads: [
			{
				ref: { sessionId: "s".repeat(200), agentId: "a".repeat(200), turn: 1 },
				header: "facts",
				found: true,
				truncated: false,
				sections: Array.from({ length: 200 }, (_, index) => ({
					name: "record",
					text: "\\\n\t".repeat(20),
					record: {
						index,
						block: 0,
						kind: "tool_result",
						tool: "Read",
						callId: "call",
						path: "/file",
						commandClass: "read",
						isError: true,
						exitCode: 1,
						cut: false,
					},
				})),
			},
		],
	};
	const text = renderBudgeted(output);
	expect(text.length).toBeLessThanOrEqual(1200);
	expect(text.match(/"sessionId"/gu)).toHaveLength(1);
	expect(text).toContain("tool_result\tRead\tcall\t/file\tread\ttrue\t1");
	expect(text).toEndWith("[cut]");
});

test("read budgets include Unicode, every escape and tiny-budget cut markers", () => {
	for (const maxChars of [1, 4, 5, 20, 26, 200, 1000]) {
		const text = renderBudgeted({
			maxChars,
			truncated: false,
			reads: [
				{
					ref,
					header: "😀\n\\facts",
					found: true,
					truncated: false,
					sections: [{ name: "😀\tsection", text: "😀\n\t\\".repeat(1000) }],
				},
			],
		});
		expect(text.length).toBeLessThanOrEqual(maxChars);
		if (maxChars >= 5) expect(text).toEndWith("[cut]");
	}
});
