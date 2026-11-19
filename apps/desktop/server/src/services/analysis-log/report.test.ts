import { describe, expect, test } from "bun:test";
import {
	recordQuery,
	saveAnalysis,
	shareAnalysis,
} from "./analysis-log.service.js";
import { createLocalEmbedder } from "./embedder.js";
import { createMemoryAnalysisStore } from "./memory-store.js";
import { getAnalysisReport, parsePipeRows } from "./report.js";
import type { AnalysisLog, AnalysisViewer } from "./types.js";

const viewer = (userId: string, workspaceId = "w"): AnalysisViewer => ({
	workspaceId,
	userId,
	isAdmin: false,
	restrictResults: false,
	onlyMember: null,
});
const author = viewer("author");
const teammate = viewer("teammate");
const outsider = viewer("author", "other");

const sqlOutput = {
	id: "sr_1",
	title: "Longest runs",
	query: "SELECT session_id, agent_id, turn_idx, minutes FROM runs",
	columns: ["session_id", "agent_id", "turn_idx", "minutes"],
	rows: 2,
	truncated: false,
	table:
		"session_id | agent_id | turn_idx | minutes\ns1 |  | 3 | 41.5\ns2 | a\\|b | 1 | 9",
	notices: ["not evidence: open the runs."],
	sessions: [],
	runs: [
		{ sessionId: "s1", agentId: "", turn: 3 },
		{ sessionId: "s2", agentId: "a|b", turn: 1 },
	],
};

async function savedAnalysis() {
	const log: AnalysisLog = {
		store: createMemoryAnalysisStore(),
		embedder: createLocalEmbedder(),
		now: () => new Date("2026-11-01T10:00:00Z"),
	};
	const actor = { workspaceId: "w", userId: "author", host: "plugin" as const };
	const sql = await recordQuery(log, actor, {
		tool: "sql",
		args: { query: sqlOutput.query, title: sqlOutput.title },
		trace: {},
		output: sqlOutput,
		outputChars: 120,
		sessions: [],
		owners: ["author"],
	});
	const read = await recordQuery(log, actor, {
		tool: "read",
		args: {
			refs: [
				{ sessionId: "s1", agentId: "", turn: 3 },
				{ sessionId: "s9", agentId: "", turn: 2 },
			],
			depth: "turn",
		},
		trace: { analysis: sql.analysis },
		output: { truncated: false, reads: [] },
		outputChars: 40,
		sessions: [],
		owners: ["author"],
	});
	await saveAnalysis(log, author, {
		analysis: sql.analysis,
		question: "Where our agents spend time",
		finalAnswer: "In long test runs.",
		findings: [
			{ step: sql.query, finding: "Test runs are the longest." },
			{ step: read.query, finding: "The agent reruns the suite." },
		],
		topics: [],
		changes: [],
	});
	return { log, sql, read };
}

describe("the report of a saved analysis", () => {
	test("shows its author the answer, findings, steps, stored sql rows and cited runs", async () => {
		const { log, sql, read } = await savedAnalysis();
		const report = await getAnalysisReport(log, author, sql.analysis);
		expect(report).toMatchObject({
			id: sql.analysis,
			question: "Where our agents spend time",
			finalAnswer: "In long test runs.",
			authorId: "author",
			mine: true,
			shared: false,
		});
		expect(report.steps.map((step) => step.finding)).toEqual([
			"Test runs are the longest.",
			"The agent reruns the suite.",
		]);
		expect(report.results).toEqual([
			{
				query: sql.query,
				title: "Longest runs",
				columns: ["session_id", "agent_id", "turn_idx", "minutes"],
				rows: [
					["s1", "", "3", "41.5"],
					["s2", "a|b", "1", "9"],
				],
				truncated: false,
			},
		]);
		expect(report.citedRuns).toEqual([
			{ step: sql.step, runs: sqlOutput.runs },
			{
				step: read.step,
				runs: [
					{ sessionId: "s1", agentId: "", turn: 3 },
					{ sessionId: "s9", agentId: "", turn: 2 },
				],
			},
		]);
	});

	test("is hidden from another member until it is shared, and never shown to another workspace", async () => {
		const { log, sql } = await savedAnalysis();
		await expect(
			getAnalysisReport(log, teammate, sql.analysis),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		await shareAnalysis(log, author, sql.analysis, true);
		const shared = await getAnalysisReport(log, teammate, sql.analysis);
		expect(shared).toMatchObject({ mine: false, shared: true });
		expect(shared.results).toHaveLength(1);

		await expect(
			getAnalysisReport(log, outsider, sql.analysis),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	test("leaves out the rows a restricting workspace keeps from other members", async () => {
		const { log, sql } = await savedAnalysis();
		await shareAnalysis(log, author, sql.analysis, true);
		const restricted = await getAnalysisReport(
			log,
			{ ...teammate, restrictResults: true, onlyMember: "teammate" },
			sql.analysis,
		);
		expect(restricted.results).toEqual([]);
		expect(restricted.steps[0]?.queries[0]?.unavailable).toBe("restricted");
	});
});

test("pipe tables split on unescaped separators only", () => {
	expect(parsePipeRows("(no rows)")).toEqual([]);
	expect(parsePipeRows("a | b\nx\\|y | ")).toEqual([["x|y", ""]]);
});
