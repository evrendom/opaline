import { describe, expect, test } from "bun:test";
import {
	parseRunId,
	type ReportSpec,
	reportIssues,
	reportReferences,
} from "./repository-report.js";

const runId = "u1/claude_code/s1//1978";
const run = { runId };

const retro: ReportSpec = {
	root: "report",
	elements: {
		report: {
			type: "Report",
			props: { title: "Where agents struggle in athena", kind: "retro" },
			children: ["shell-edits"],
		},
		"shell-edits": {
			type: "Problem",
			props: {
				title: "Agents edit through shell scripts and miss their own changes",
				strength: "strong",
				step: "q3",
			},
			children: ["how-often", "moment", "rule", "fix"],
		},
		"how-often": {
			type: "Measure",
			props: {
				result: "sr_abc123",
				shape: "number",
				column: "runs",
				label: "Runs",
			},
			children: [],
		},
		moment: {
			type: "Moment",
			props: {
				...run,
				at: { kind: "next_prompt" },
				note: "The user asks again for the edit the agent said it made.",
			},
			children: [],
		},
		rule: {
			type: "SetupLine",
			props: {
				setupFile: "repository:github.com/opalinehq/athena:CLAUDE.md",
				version: "v1",
				from: 12,
				to: 14,
			},
			children: [],
		},
		fix: {
			type: "Fix",
			props: {
				target: { kind: "path", path: "CLAUDE.md" },
				before: "Edit files however is quickest.",
				after:
					"Edit files with the Edit tool; check the diff before saying done.",
				why: "Shell edits leave no diff the agent can check.",
			},
			children: [],
		},
	},
};

describe("reportIssues", () => {
	test("a retro of one problem with its measure, moment, setup line and fix is clean", () => {
		expect(reportIssues(retro)).toEqual([]);
	});

	test("numbers only come from sql results, and a fix closes a problem rather than standing alone", () => {
		const spec: ReportSpec = {
			root: "report",
			elements: {
				...retro.elements,
				report: {
					...retro.elements.report,
					children: ["shell-edits", "fix"],
				} as ReportSpec["elements"][string],
				"how-often": {
					type: "Measure",
					props: { result: "42 runs", shape: "number", label: "Runs" },
					children: [],
				},
			},
		};
		expect(
			reportIssues(spec)
				.map(({ element, code }) => `${element} ${code}`)
				.sort(),
		).toEqual([
			"fix shared_child",
			"how-often invalid_props",
			"report child_not_allowed",
		]);
	});

	test("the root is a Report, children exist, and leaves take no children", () => {
		const codes = reportIssues({
			root: "p",
			elements: {
				p: { type: "Prose", props: { markdown: "x" }, children: ["gone", "q"] },
				q: { type: "Prose", props: { markdown: "y" }, children: [] },
			},
		}).map((issue) => issue.code);
		expect(codes).toEqual([
			"root_not_report",
			"dangling_child",
			"child_not_allowed",
		]);
	});
});

describe("reportReferences", () => {
	test("collects every id the report points at, for checking against the analysis", () => {
		expect(reportReferences(retro)).toEqual({
			results: ["sr_abc123"],
			sessions: [],
			runs: [runId],
			calls: [],
			setupFiles: ["repository:github.com/opalinehq/athena:CLAUDE.md"],
			paths: ["CLAUDE.md"],
			nodes: [],
		});
	});
});

describe("parseRunId", () => {
	test("reads the session, stream and start record out of a run_id", () => {
		expect(parseRunId("u1/claude_code/s1/agent%2F1/42")).toEqual({
			userId: "u1",
			source: "claude_code",
			sessionId: "s1",
			agentId: "agent/1",
			startRecord: 42,
		});
		expect(parseRunId("not-a-run")).toBeNull();
	});
});
