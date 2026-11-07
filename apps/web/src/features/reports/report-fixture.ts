import type { AnalysisHistoryReportOutput } from "@rudel/api-routes";

const healthLines = [
	{ type: "Summary", headline: "Tests are slow and agents skip them." },
	{
		type: "Action",
		rank: 2,
		title: "Document the focused test command",
		why: "Agents run the whole suite to check one file.",
		area: "testing",
		impact: "medium",
		effort: "minutes",
	},
	{
		type: "Action",
		rank: 1,
		title: "Cache the database fixture",
		why: "Every run rebuilds it for four minutes.",
		area: "testing",
		impact: "high",
		effort: "hour",
	},
	{
		type: "Signal",
		id: "tests-before-done",
		area: "testing",
		label: "Tests run before done",
		status: "warn",
		rule: "r",
		observed: "o",
		evidence: "e",
	},
];

export const REPORT_FIXTURE: AnalysisHistoryReportOutput = {
	id: "a_fixture",
	question: "Where our agents spend time",
	status: "finished",
	authorId: "user-1",
	mine: true,
	shared: false,
	host: "plugin",
	scope: { from: "2026-10-01", to: "2026-10-31", filters: {} },
	cutoff: "2026-10-31T23:59:59.000Z",
	createdAt: "2026-11-01T10:00:00.000Z",
	updates: null,
	topics: ["time"],
	finalAnswer: [
		"Most time goes to **long test runs**.",
		"",
		"```opaline-health",
		...healthLines.map((line) => JSON.stringify(line)),
		"```",
	].join("\n"),
	notes: [],
	cost: null,
	changes: [],
	updatedBy: [],
	chatSessions: [],
	steps: [
		{
			id: "s_sql",
			parent: null,
			question: "sql Longest runs",
			reply: null,
			finding: "Test runs are the longest.",
			queries: [
				{
					id: "q_sql",
					tool: "sql",
					args: {},
					outputChars: 120,
					createdAt: "2026-11-01T09:00:00.000Z",
					unavailable: null,
				},
			],
		},
		{
			id: "s_read",
			parent: null,
			question: "read runs=1 depth=turn",
			reply: null,
			finding: "The agent reruns the suite after every edit.",
			queries: [
				{
					id: "q_read",
					tool: "read",
					args: {},
					outputChars: 40,
					createdAt: "2026-11-01T09:10:00.000Z",
					unavailable: "expired",
				},
			],
		},
	],
	results: [
		{
			query: "q_sql",
			title: "Longest runs",
			columns: ["session_id", "turn_idx", "minutes"],
			rows: [
				["3f2a9c1d-session", "3", "41.5"],
				["9b7e0c2a-session", "1", "17.2"],
			],
			truncated: false,
		},
	],
	citedRuns: [
		{
			step: "s_sql",
			runs: [{ sessionId: "3f2a9c1d-session", agentId: "", turn: 3 }],
		},
		{
			step: "s_read",
			runs: [{ sessionId: "9b7e0c2a-session", agentId: "", turn: 1 }],
		},
	],
};
