import { expect, test } from "bun:test";
import {
	type AnalysisFindOutput,
	type AnalysisHistoryGetOutput,
	type AnalysisReadOutput,
	WEEKLY_MEASURES,
	WEEKLY_NULLABLE_MEASURES,
} from "@rudel/api-routes";
import { budgetReadOutput } from "../services/analysis/read-output.js";
import {
	renderAnalysisTree,
	renderFind,
	renderRead,
} from "./analysis-renderers.js";

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
	activeMinutes: 0.5,
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
				activeMinutes: 1,
				costUsd: null,
				model: "model",
				models: ["model", "other-model"],
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
				parentSessionId: null,
				depth: 0,
			},
			{
				ref: { sessionId: "child", agentId: "", turn: 1 },
				startedAt: "2026-10-03T00:01:00Z",
				minutes: 1,
				activeMinutes: 1,
				costUsd: 0.5,
				model: "model",
				models: ["model", "other-model"],
				repository: "repo",
				agent: "codex",
				promptHead: "",
				edits: 0,
				toolCalls: 0,
				failedCalls: 0,
				readCalls: 0,
				searchCalls: 0,
				notFound: 0,
				nextReaction: null,
				rawChars: 10,
				parentSessionId: "session",
				depth: 1,
			},
		],
	});
	expect(text).toContain("sessions=2 indexed=1 runs=1");
	expect(text).toContain("rawChars=1000 truncated=false");
	expect(text).not.toContain("classifier=");
	expect(text).toContain("ref\tstartedAt\tminutes\tactiveMinutes\tcostUsd");
	expect(text).toContain('"agentId":"","turn":1');
	expect(text).toContain("hello\\nnext\\tcolumn");
	expect(text).toContain("\t1\t1\tnull\tmodel\tmodel,other-model\trepo\t");
	expect(text).toContain("\tparentSessionId\tdepth\tpromptHead");
	expect(text).toContain("\t1000\tnull\t0\thello");
	expect(text).toContain("\t10\tsession\t1\t");
	expect(text).not.toContain('"header":');
});

test("a page with more results ends with the next-page hint; the last page says hasMore=false", () => {
	const more = renderFind({
		source: "runs",
		header: { ...header, truncated: true, cursor: "abc_-123" },
		groups: [],
	});
	expect(more).toContain("truncated=true hasMore=true");
	expect(more.split("\n").at(-1)).toBe(
		"Showing 0 results. More results exist: call find again with the same arguments and cursor=abc_-123 to get the next page.",
	);
	const last = renderFind({ source: "runs", header, groups: [] });
	expect(last).toContain("truncated=false hasMore=false");
	expect(last).not.toContain("More results exist");
});

test("all group modes and reaction origins render with table headers", () => {
	expect(
		renderFind({
			source: "runs",
			header,
			groups: [
				{
					key: "model",
					runs: 1,
					sessions: 1,
					minutes: 1,
					activeMinutes: 0.5,
					costUsd: 0.25,
				},
			],
		}),
	).toContain(
		"key\truns\tsessions\tminutes\tactiveMinutes\tcostUsd\nmodel\t1\t1\t1\t0.5\t0.25",
	);
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
					examples: [
						{ ref, record: 3, errorLine: "ENOENT", parentSessionId: null },
						{
							ref: { ...ref, sessionId: "child" },
							record: 4,
							at: "2026-10-02T09:15:30.250Z",
							errorLine: "ENOENT",
							parentSessionId: "session",
						},
					],
				},
			],
		}),
	).toContain(
		'"turn":1}@3, {"sessionId":"child","agentId":"","turn":1}@4 at 2026-10-02T09:15:30.250Z (subagent thread of session) ENOENT',
	);
	const user = renderFind({
		source: "user",
		header,
		events: [
			{
				type: "swear",
				terms: ["fuck"],
				eventRef: { ...ref, turn: 2, record: 5 },
				at: "2026-10-02T09:16:00.000Z",
				quote: "fuck",
				partial: true,
				originRef: ref,
				originMinutes: 1,
				originCostUsd: 0.25,
				parentSessionId: "parent",
			},
		],
		groups: [{ type: "swear", count: 1, sessions: 1 }],
	});
	expect(user).toContain(
		"eventRef\toriginRef\toriginMinutes\toriginCostUsd\tpartial\tparentSessionId\tquote",
	);
	expect(user).toContain(
		'"turn":2}@5 at 2026-10-02T09:16:00.000Z\t{"sessionId"',
	);
	expect(user).toContain("\t1\t0.25\ttrue\tparent\tfuck");
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
	expect(text).not.toContain("[cut]");
	expect(text).not.toContain("omitted");
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
	expect(text).toMatch(
		/… \[truncated \d+ of 60 chars — open it in Opaline for the full value\]\n… \[197 more sections omitted to fit the response size limit\]$/u,
	);
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
		if (maxChars < 200) expect(text).toBe("…");
		else if (maxChars === 200)
			expect(text).toBe(
				"read truncated=true\n… [1 more runs omitted to fit the response size limit]",
			);
		else
			expect(text).toEndWith(
				"… [truncated 4625 of 5000 chars — open it in Opaline for the full value]",
			);
	}
});

test("an analysis shows its data cutoff, the prior it updates, its revisions and how each finding changed", () => {
	const analysis: AnalysisHistoryGetOutput = {
		id: "a_new",
		question: "Why do agents fail?",
		status: "finished",
		authorId: "u",
		mine: true,
		shared: false,
		host: "plugin",
		scope: { from: "2026-09-01", to: "2026-10-01", filters: {} },
		cutoff: "2026-10-01T09:00:00.000Z",
		createdAt: "2026-10-01T08:00:00.000Z",
		updates: "a_old",
		topics: [],
		finalAnswer: "Fewer stale patches.",
		notes: [],
		cost: null,
		changes: [
			{
				step: "s_1",
				finding: "stale patches",
				change: "weakened",
				evidence: "4, was 11",
			},
			{
				step: "s_2",
				finding: "lint\tloops",
				change: "new",
				evidence: "3 runs",
			},
		],
		updatedBy: ["a_newer"],
		steps: [],
		// Uploaded chats are not part of the plugin's output.
		chatSessions: [
			{
				sessionId: "chat",
				source: "codex",
				userId: "u",
				uploadedAt: "2026-10-01T09:00:00.000Z",
			},
		],
	};

	expect(renderAnalysisTree(analysis).split("\n")).toEqual([
		"analysis a_new status=finished mine=true shared=false cutoff=2026-10-01T09:00:00.000Z updates=a_old updatedBy=a_newer",
		"scope 2026-09-01..2026-10-01",
		"question: Why do agents fail?",
		"changes against a_old:",
		"  weakened: step s_1: stale patches (4, was 11)",
		"  new: step s_2: lint\\tloops (3 runs)",
		"final answer: Fewer stale patches.",
	]);
	expect(
		renderAnalysisTree({
			...analysis,
			updates: null,
			changes: [],
			updatedBy: [],
		}).split("\n")[0],
	).toEndWith("updates=none updatedBy=none");
});

test("git events print their link source only when it is not current edges, with one summary line", () => {
	const event: Extract<
		AnalysisFindOutput,
		{ source: "git" }
	>["events"][number] = {
		sessionId: "session",
		agentId: "",
		turn: 1,
		record: 3,
		block: 0,
		call: "call",
		at: "2026-10-03T00:00:00Z",
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
			status: "linked",
			reason: null,
			prFrom: null,
			ciFrom: null,
			coveredThrough: null,
		},
		sha: null,
		pullRequests: [],
		ciRuns: [],
		ciRunsObserved: 0,
		ciRunCount: 0,
		ciRunCountThrough: "2026-10-04T00:00:00Z",
		ciRunCountUnknown: null,
		ciConclusions: {},
		checksAfter: null,
		parentSessionId: null,
		edges: {
			linkedBy: "edges",
			status: "current",
			builtAt: "2026-10-03T01:00:00Z",
		},
	};
	const text = renderFind({
		source: "git",
		header,
		events: [
			event,
			event,
			{
				...event,
				call: "frozen",
				edges: {
					linkedBy: "edges",
					status: "frozen",
					builtAt: "2026-09-01T00:00:00Z",
				},
			},
			{
				...event,
				call: "unbuilt",
				edges: { linkedBy: "query", status: "not_built", builtAt: null },
			},
			{
				...event,
				call: "stale",
				edges: {
					linkedBy: "query",
					status: "stale",
					builtAt: "2026-10-02T00:00:00Z",
				},
			},
		],
		witnesses: [],
	});
	expect(text).toContain(
		"links: 3 events from edges (1 frozen), 2 linked at query time (1 not built, 1 stale)",
	);
	const rows = text
		.split("\n")
		.filter((line) => line.startsWith('{"sessionId"'));
	expect(rows[0]?.split("\t")[4]).toBe("=v1");
	expect(text).toContain(
		"shared values: a cell =vN repeats value vN\nkey\tcolumn\trows\tvalue\nv1\tliteral\t2\tcall=call branch=feat/links",
	);
	expect(rows.map((row) => /links=\S+/u.exec(row)?.[0] ?? null)).toEqual([
		null,
		null,
		"links=edges:frozen",
		"links=query:not_built",
		"links=query:stale",
	]);
	expect(rows[2]).toContain("builtAt=2026-09-01T00:00:00Z");
	expect(text).not.toContain("witnesses:");
	// The worker off, results stored before edges, or GitHub outcomes hidden:
	// no link line and no marker, exactly the old output.
	const old = renderFind({
		source: "git",
		header,
		events: [{ ...event, edges: null }],
		witnesses: [],
	});
	expect(old).not.toMatch(/links[:=]/u);
	// A retained edge whose transcript expired is listed, compactly.
	expect(
		renderFind({
			source: "git",
			header,
			events: [],
			witnesses: [
				{
					sessionId: "session",
					agentId: "",
					turn: 3,
					relation: "pr_named",
					matchedValue: "133",
					at: "2026-09-15T10:00:00.000Z",
					evidenceId: "obs::10:0:pr_url",
					generation: { revision: "1", parserVersion: 773 },
					reason: "transcript_unavailable",
				},
			],
		})
			.split("\n")
			.slice(-3),
	).toEqual([
		"witnesses: retained edges whose evidence row is not readable",
		"session\tat\trelation\tmatched\tevidence\treason",
		"session/main turn 3\t2026-09-15T10:00:00.000Z\tpr_named\t133\tobs::10:0:pr_url@1/773\ttranscript_unavailable",
	]);
});

test("weekly totals render the snapshot and every measure, unknown sums as null", () => {
	const text = renderFind({
		source: "weekly",
		header,
		snapshot: {
			id: "host 2026-10-04",
			refreshedAt: "2026-10-04T03:00:00.000Z",
		},
		totals: [
			{
				week: "2026-09-28",
				member: "u1",
				agent: "codex",
				weeks: 1,
				sessions: 2,
				...(Object.fromEntries(WEEKLY_MEASURES.map((name) => [name, 3])) as {
					[K in (typeof WEEKLY_MEASURES)[number]]: number;
				}),
				...(Object.fromEntries(
					WEEKLY_NULLABLE_MEASURES.map((name) => [name, null]),
				) as { [K in (typeof WEEKLY_NULLABLE_MEASURES)[number]]: null }),
				deniedCalls: 1,
			},
		],
	});
	const lines = text.split("\n");
	expect(lines).toContain(
		"snapshot host 2026-10-04 refreshedAt=2026-10-04T03:00:00.000Z",
	);
	const columns = lines.find((line) => line.startsWith("week\t"))?.split("\t");
	expect(columns).toEqual([
		"week",
		"member",
		"agent",
		"weeks",
		"sessions",
		...WEEKLY_MEASURES,
		...WEEKLY_NULLABLE_MEASURES,
	]);
	const row = lines.at(-1)?.split("\t") ?? [];
	expect(row.slice(0, 6)).toEqual(["2026-09-28", "u1", "codex", "1", "2", "3"]);
	expect(row[(columns ?? []).indexOf("deniedCalls")]).toBe("1");
	expect(row[(columns ?? []).indexOf("costUsd")]).toBe("null");
});
