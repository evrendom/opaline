import type { AnalysisReadOutput, AnalysisRunOutput } from "@rudel/api-routes";
import { budgetReadOutput } from "../services/analysis/read-output.js";

const record = (
	index: number,
	kind: string,
	extra: Partial<{
		tool: string;
		callId: string;
		path: string;
		commandClass: string;
		isError: boolean;
		exitCode: number | null;
	}> = {},
) => ({
	index,
	block: 0,
	kind,
	tool: "",
	callId: "",
	path: "",
	commandClass: "",
	isError: false,
	exitCode: null,
	cut: false,
	...extra,
});

export const READ_OUTPUT: AnalysisReadOutput = budgetReadOutput(
	{
		maxChars: 2_000,
		truncated: false,
		reads: [
			{
				ref: { sessionId: "sess-1", agentId: "", turn: 1 },
				header: "run 1 of sess-1 · claude_code · 6 min · $0.875",
				found: true,
				truncated: false,
				sections: [
					{
						name: "record",
						text: "Deploy the billing service and fix the flaky test",
						record: record(4, "user_prompt"),
					},
					{
						name: "record",
						text: "I'll run the tests first.",
						record: record(5, "assistant_text"),
					},
					{
						name: "record",
						text: "bun test billing",
						record: record(6, "tool_call", {
							tool: "Bash",
							callId: "toolu_1",
							commandClass: "test",
						}),
					},
					{
						name: "record",
						text: "error: expected 200, got 503 (billing timeout)",
						record: record(7, "tool_result", {
							tool: "Bash",
							callId: "toolu_1",
							commandClass: "test",
							isError: true,
							exitCode: 1,
						}),
					},
					{
						name: "record",
						text: `The billing test fails on a timeout. ${"Details ".repeat(400)}`,
						record: record(8, "assistant_text"),
					},
				],
			},
			{
				ref: { sessionId: "sess-2", agentId: "", turn: 3 },
				header: "run 3 of sess-2 · codex",
				found: true,
				truncated: false,
				sections: [{ name: "prompt", text: "Never shown: over budget" }],
			},
		],
	},
	2_000,
);

export const RUN_OUTPUT: AnalysisRunOutput = {
	id: "u1/claude_code/sess-1//4",
	phaseRule: 1,
	truncated: true,
	text: "run u1/claude_code/sess-1//4 · claude_code · 6 min\np1 test: q5 c6 (failed)",
	ref: { sessionId: "sess-1", agentId: "", turn: 1 },
	view: {
		id: "u1/claude_code/sess-1//4",
		agent: "claude_code",
		prompt: "Deploy the billing service and fix the flaky test",
		task: null,
		minutes: 6,
		tokens: 52_000,
		costUsd: 0.875,
		requestsIndexed: true,
		previous: {
			id: "u1/claude_code/sess-1//1",
			prompt: "Set up the repo",
			end: "Done: dependencies installed.",
		},
		next: {
			id: "u1/claude_code/sess-1//9",
			prompt: "No, the test still fails",
		},
		requests: [
			{
				record: 5,
				startedMs: 1_760_000_000_000,
				endedMs: 1_760_000_004_000,
				calls: [
					{
						tool: "Bash",
						group: "shell",
						commandClass: "test",
						failed: true,
						record: 6,
					},
				],
				text: { record: 5, block: 0, head: "I'll run the tests first." },
				tokens: 30_000,
				costUsd: 0.5,
			},
			{
				record: 8,
				startedMs: 1_760_000_010_000,
				endedMs: 1_760_000_012_500,
				calls: [],
				text: {
					record: 8,
					block: 0,
					head: "The billing test fails on a timeout.",
				},
				tokens: 22_000,
				costUsd: 0.375,
			},
		],
		setup: [],
	},
};
