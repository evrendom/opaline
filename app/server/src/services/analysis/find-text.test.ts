import { expect, test } from "bun:test";
import type { AnalysisFindOutput } from "@rudel/api-routes";
import { truncatedMarker } from "./compact.js";
import { findRowCosts, renderFind } from "./find-text.js";

const header: AnalysisFindOutput["header"] = {
	from: "2026-10-01",
	to: "2026-10-03",
	sessionsInScope: 1,
	indexedSessions: 1,
	runsInScope: 6,
	minutes: 1,
	activeMinutes: 1,
	pricedCostUsd: 1,
	unattributedCostUsd: 0,
	unpricedRuns: 0,
	rawChars: 1,
	truncated: false,
	notes: [],
	classifierVersion: 1,
};

type GitEvent = Extract<
	AnalysisFindOutput,
	{ source: "git" }
>["events"][number];

const pullRequest = {
	repositoryId: 7,
	number: 285,
	state: "closed",
	draft: false,
	mergedAt: "2026-10-13 08:32:34.000",
	mergeCommitSha: "",
	headRef: "perf/dashboard-one-session-query",
	headSha: "36732053aa863fc8a12d4e588fcf4e9f50084a2a",
	headRepositoryId: 7,
	bases: ["named"],
	commitInHead: null,
	title: "perf(dashboard): one session query per dashboard load",
} as unknown as GitEvent["pullRequests"][number];

const ciRun = (runId: number) =>
	({
		repositoryId: 7,
		kind: "actions_run",
		runId,
		attempt: 1,
		workflow: "CI",
		status: "completed",
		conclusion: "success",
		event: "pull_request",
		branch: "perf/dashboard-one-session-query",
		headSha: "36732053aa863fc8a12d4e588fcf4e9f50084a2a",
		createdAt: "2026-10-13 07:30:18.000",
		startedAt: "2026-10-13 07:30:18.000",
		completedAt: "2026-10-13 07:30:31.000",
		edges: [{ basis: "pull_request", linkBasis: "head-sha", prNumber: 285 }],
	}) as unknown as GitEvent["ciRuns"][number];

const gitEvent = (record: number): GitEvent =>
	({
		sessionId: "s1",
		agentId: "",
		turn: 5,
		record,
		block: 0,
		call: "",
		at: "2026-10-13T08:30:22.219Z",
		kind: "pr_url",
		label: "pr_link",
		branch: "",
		sourceBranch: "",
		shortSha: "",
		pushFrom: "",
		pushTo: "",
		remote: "",
		prRepo: "opalinehq/athena",
		prNumber: 285,
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
		pullRequests: [pullRequest],
		ciRuns: [ciRun(1), ciRun(2), ciRun(3)],
		ciRunsObserved: 3,
		ciRunCount: null,
		ciRunCountThrough: null,
		ciRunCountUnknown: "before_coverage",
		ciConclusions: { success: 3 },
		checksAfter: null,
		parentSessionId: null,
		edges: null,
	}) as unknown as GitEvent;

const git: AnalysisFindOutput = {
	source: "git",
	header,
	events: Array.from({ length: 15 }, (_, index) => gitEvent(900 + index)),
	witnesses: [],
};

test("a pull request and CI runs every event shares are printed once and referenced per row", () => {
	const text = renderFind(git);
	const lines = text.split("\n");
	const columns = lines.find((line) => line.startsWith("ref\t"))?.split("\t");
	const rows = lines.filter((line) => line.startsWith('{"sessionId"'));
	expect(rows).toHaveLength(15);
	for (const row of rows) {
		const cells = row.split("\t");
		expect(cells[columns?.indexOf("pullRequests") ?? -1]).toBe("=v1");
		expect(cells[columns?.indexOf("ciRuns") ?? -1]).toBe("=v2");
	}
	expect(text.match(/perf\(dashboard\)/gu)).toHaveLength(1);
	expect(text.match(/actions_run#1\.1/gu)).toHaveLength(1);
	const legend = lines.indexOf("shared values: a cell =vN repeats value vN");
	expect(lines[legend + 1]).toBe("key\tcolumn\trows\tvalue");
	expect(lines[legend + 2]).toStartWith(
		"v1\tpullRequests\t15\trepo=7#285 closed",
	);
	expect(lines[legend + 3]).toStartWith(
		"v2\tciRuns\t15\trepo=7 actions_run#1.1",
	);
});

test("deduping makes the PR blob page several times smaller and row costs follow it", () => {
	const text = renderFind(git);
	const naive = 15 * renderFind({ ...git, events: [gitEvent(900)] }).length;
	expect(text.length * 3).toBeLessThan(naive);
	const costs = findRowCosts(git);
	expect(costs).toHaveLength(15);
	for (const cost of costs) expect(cost).toBeLessThan(250);
});

test("a value shorter than 64 characters or seen once stays in its row", () => {
	const text = renderFind({ ...git, events: [gitEvent(1)] });
	expect(text).not.toContain("shared values");
	expect(text).toContain("perf(dashboard)");
});

test("examples with one error line print the line once after all their runs", () => {
	const ref = { sessionId: "s", agentId: "", turn: 1 };
	const text = renderFind({
		source: "tool",
		header,
		groups: [
			{
				toolGroup: "edit",
				cause: "stale edit",
				detail: "Write",
				kind: "mistake",
				count: 3,
				sessions: 1,
				firstSeen: "2026-10-01",
				lastSeen: "2026-10-02",
				topCommands: [],
				minutes: 1,
				costUsd: 1,
				examples: [
					{ ref, record: 1, errorLine: "File modified", parentSessionId: null },
					{ ref, record: 2, errorLine: "File modified", parentSessionId: null },
					{ ref, record: 3, errorLine: "Other", parentSessionId: null },
				],
			},
		],
	});
	expect(text).toContain(
		'{"sessionId":"s","agentId":"","turn":1}@1, {"sessionId":"s","agentId":"","turn":1}@2 File modified; {"sessionId":"s","agentId":"","turn":1}@3 Other',
	);
	expect(text.match(/File modified/gu)).toHaveLength(1);
});

test("summary drops free-text columns and names them once in a header line", () => {
	const ref = { sessionId: "s", agentId: "", turn: 1 };
	const output: AnalysisFindOutput = {
		source: "tool",
		header: { ...header, cursor: "next" },
		groups: [
			{
				toolGroup: "shell",
				cause: "test failed",
				detail: "bun test",
				kind: "validation",
				count: 2,
				sessions: 1,
				firstSeen: "2026-10-01",
				lastSeen: "2026-10-02",
				topCommands: ["bun test <path>"],
				minutes: 3,
				costUsd: 0.5,
				examples: [
					{ ref, record: 1, errorLine: "1 fail", parentSessionId: null },
				],
			},
		],
	};
	const summary = renderFind(output, "summary").split("\n");
	expect(summary).toContain(
		'omitted: topCommands, examples — call again with verbosity: "full" for them',
	);
	expect(summary).toContain(
		"toolGroup\tcause\tdetail\tkind\tcount\tsessions\tfirstSeen\tlastSeen\tminutes\tcostUsd",
	);
	expect(summary).toContain(
		"shell\ttest failed\tbun test\tvalidation\t2\t1\t2026-10-01\t2026-10-02\t3\t0.5",
	);
	expect(summary.join("\n")).not.toContain("1 fail");
	expect(summary.at(-1)).toBe(
		"Showing 1 result. More results exist: call find again with the same arguments and cursor=next to get the next page.",
	);
	const full = renderFind(output);
	expect(full).not.toContain("omitted:");
	expect(full).toContain("bun test <path>");
	expect(renderFind(git, "summary")).toContain(
		'omitted: ciRuns — call again with verbosity: "full" for them',
	);
});

test("a cell past 10,000 characters is cut with a counted marker", () => {
	const command = "z".repeat(12_345);
	const text = renderFind({
		source: "calls",
		header,
		rows: [
			{
				ref: { sessionId: "s", agentId: "", turn: 1 },
				record: 1,
				block: 0,
				at: "2026-10-01",
				agent: "codex",
				tool: "exec",
				commandFrom: "command",
				filePath: "",
				failed: false,
				exitCode: 0,
				commandArgv0: "z",
				commandPrefix: "z",
				commandFingerprint: "1",
				commandSimhash: "2",
				commandChars: 12_345,
				parentSessionId: null,
				command,
			},
		],
	} as unknown as AnalysisFindOutput);
	expect(text).toContain(
		`${"z".repeat(10_000)}${truncatedMarker(2_345, 12_345)}`,
	);
	expect(text).not.toContain("z".repeat(10_001));
});

test("refs are never replaced by a shared key, so they can be copied into read", () => {
	const originRef = { sessionId: "a".repeat(36), agentId: "", turn: 3 };
	const event = {
		type: "negative" as const,
		terms: ["wrong"],
		eventRef: { ...originRef, turn: 4, record: 9 },
		quote: "this is wrong again and again and again and again",
		partial: false,
		originRef,
		originMinutes: 1,
		originCostUsd: 1,
		parentSessionId: null,
	};
	const text = renderFind({
		source: "user",
		header,
		events: [event, event, event],
		groups: [{ type: "negative", count: 3, sessions: 1 }],
	});
	expect(text.split('"turn":3}')).toHaveLength(4);
	expect(text.split('"turn":4}@9')).toHaveLength(4);
	expect(text).toContain("v1\tquote\t3\tthis is wrong again");
});

test("calls show each call's own minutes, each group's call and run time, and the matching calls' totals", () => {
	const callsHeader = { ...header, matchedCalls: 12, groupCallTime: 7.5 };
	const rows = renderFind({
		source: "calls",
		header: callsHeader,
		rows: [
			{
				ref: { sessionId: "s", agentId: "", turn: 1 },
				record: 1,
				block: 0,
				at: "2026-10-01",
				agent: "claude_code",
				tool: "Bash",
				commandFrom: "command",
				filePath: "",
				failed: true,
				exitCode: 1,
				callMinutes: 4.25,
				commandArgv0: "bun",
				commandPrefix: "bun test",
				commandFingerprint: "1",
				commandSimhash: null,
				commandChars: 8,
				parentSessionId: null,
				command: "bun test",
			},
		],
	});
	const [first, , table] = rows.split("\n");
	expect(first).toEndWith("runs=6 matchedCalls=12 groupCallTime=7.5");
	expect(table?.split("\t").slice(5, 8)).toEqual([
		"failed",
		"exitCode",
		"callMinutes",
	]);
	expect(rows).toContain("\ttrue\t1\t4.25\tbun\t");
	const groups = renderFind({
		source: "calls",
		header: callsHeader,
		groups: [
			{
				key: "1",
				calls: 12,
				sessions: 3,
				failedCalls: 12,
				groupCallTime: 7.5,
				groupRunTime: 41.2,
				firstSeen: "2026-10-01",
				lastSeen: "2026-10-03",
				normalized: "bun test",
				examples: [],
			},
		],
	});
	expect(groups).toContain(
		"key\tcalls\tsessions\tfailedCalls\tgroupCallTime\tgroupRunTime\tfirstSeen",
	);
	expect(groups).toContain("1\t12\t3\t12\t7.5\t41.2\t2026-10-01");
});
