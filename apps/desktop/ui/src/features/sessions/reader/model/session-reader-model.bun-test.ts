import { describe, expect, test } from "bun:test";
import {
	formatReaderBytes,
	formatReaderCost,
	formatReaderDuration,
	getCostQuintiles,
	getCostShade,
	getReaderFinalMessage,
	getReaderMemberText,
	getReaderTurnMarks,
	getReaderTurnSignals,
	getReaderWaterfall,
	type SessionReaderBody,
} from "./session-reader-model";

const at = "2026-10-09T10:00:00.000Z";

const body: SessionReaderBody = {
	userItems: [
		{
			content: [
				"Fix the flaky test",
				{ type: "tool_result", tool_use_id: "t0", content: "ignored" },
			],
			id: "u1",
			kind: "user",
			timestamp: at,
		},
	],
	responseItems: [
		{
			events: [
				{
					id: "m1",
					kind: "message",
					content: "Looking.",
					text: "Looking.",
					timestamp: at,
				},
				{
					id: "t1",
					input: { command: "bun test" },
					kind: "tool",
					result: { content: "1 failed", isError: true },
					timestamp: at,
					toolName: "Bash",
				},
				{
					id: "t2",
					input: { command: "bun test" },
					kind: "tool",
					result: { content: "ok", isError: false },
					timestamp: at,
					toolName: "Bash",
				},
				{
					id: "t3",
					input: { path: "a.ts" },
					kind: "tool",
					timestamp: at,
					toolName: "Read",
				},
				{
					id: "m2",
					kind: "message",
					content: "Fixed it.",
					text: "Fixed it.",
					timestamp: at,
				},
			],
			executionMode: "default",
			id: "a1",
			kind: "agent",
			timestamp: at,
		},
	],
};

describe("session reader model", () => {
	test("member text keeps typed prose and drops tool-result transport", () => {
		expect(getReaderMemberText(body)).toBe("Fix the flaky test");
	});

	test("the final message is the agent's last message", () => {
		expect(getReaderFinalMessage(body)).toBe("Fixed it.");
		expect(
			getReaderFinalMessage({ userItems: [], responseItems: [] }),
		).toBeNull();
	});

	test("without result times, tools run until the model writes again", () => {
		const ts = (second: number) =>
			new Date(Date.UTC(2026, 9, 9, 10, 0, second)).toISOString();
		const usage = (second: number, outputTokens: number) => ({
			at: ts(second),
			cacheCreationInputTokens: 0,
			cacheReadInputTokens: 0,
			contextWindow: null,
			freshInputTokens: 100,
			model: "claude-opus-4-6",
			outputTokens,
		});
		const waterfall = getReaderWaterfall(
			{
				userItems: [],
				responseItems: [
					{
						events: [
							{ id: "r1", kind: "reasoning", text: "…", timestamp: ts(2) },
							{
								id: "t1",
								input: {},
								kind: "tool",
								result: { content: "", isError: false },
								timestamp: ts(3),
								toolName: "Read",
							},
							{
								id: "t2",
								input: { subagent_type: "Explore" },
								kind: "tool",
								result: { content: "", isError: true, subagentId: "s1" },
								timestamp: ts(3),
								toolName: "Agent",
							},
							{
								id: "m1",
								kind: "message",
								content: "Done.",
								text: "Done.",
								timestamp: ts(20),
							},
						],
						executionMode: "default",
						id: "a1",
						kind: "agent",
						timestamp: ts(2),
					},
				],
			},
			{
				endedAt: ts(21),
				startedAt: ts(0),
				usageCalls: [usage(3, 50), usage(20, 10)],
			},
			null,
		);
		const start = Date.parse(ts(0));
		expect(waterfall?.startMs).toBe(start);
		expect(waterfall?.endMs).toBe(Date.parse(ts(21)));
		expect(waterfall?.model).toBe("claude-opus-4-6");
		expect(
			waterfall?.steps.map((step) => [
				step.kind,
				step.name,
				step.isError,
				(step.startMs - start) / 1000,
				(step.endMs - start) / 1000,
			]),
		).toEqual([
			// The first output runs from the prompt.
			["thinking", "Thinking", false, 0, 2],
			["thinking", "Thinking", false, 2, 3],
			// Tools run until the model writes again with their results.
			["tool", "Read", false, 3, 20],
			["agent", "Explore", true, 3, 20],
			// Output right after tools is a point; the last message is the answer.
			["message", "Response", false, 20, 20],
		]);
		expect(waterfall?.steps[3]?.result).toBe("");
		expect(waterfall?.steps[4]?.text).toBe("Done.");
	});

	test("tools end at their result and the model resumes from there", () => {
		const ts = (second: number) =>
			new Date(Date.UTC(2026, 9, 8, 17, 1, second)).toISOString();
		const thinking = (id: string, second: number) => ({
			id,
			kind: "reasoning" as const,
			text: "…",
			timestamp: ts(second),
		});
		const bash = (id: string, second: number, resultSecond: number) => ({
			id,
			input: { command: "ls" },
			kind: "tool" as const,
			result: { content: "ok", isError: false, timestamp: ts(resultSecond) },
			timestamp: ts(second),
			toolName: "Bash",
		});
		const waterfall = getReaderWaterfall(
			{
				userItems: [],
				responseItems: [
					{
						events: [
							thinking("r1", 3),
							bash("t1", 4, 5),
							thinking("r2", 9),
							bash("t2", 10, 11),
							{
								id: "m1",
								kind: "message",
								content: "Found it.",
								text: "Found it.",
								timestamp: ts(14),
							},
						],
						executionMode: "default",
						id: "a1",
						kind: "agent",
						timestamp: ts(3),
					},
				],
			},
			{ endedAt: ts(14), startedAt: ts(0), usageCalls: [] },
			null,
		);
		const start = Date.parse(ts(0));
		expect(
			waterfall?.steps.map((step) => [
				step.name,
				(step.startMs - start) / 1000,
				(step.endMs - start) / 1000,
			]),
		).toEqual([
			["Thinking", 0, 3],
			["Thinking", 3, 4],
			["ls", 4, 5],
			// The model thinks between the result and its next output.
			["Thinking", 5, 9],
			["Thinking", 9, 10],
			["ls", 10, 11],
			["Response", 11, 14],
		]);
	});

	test("a turn with no agent output has no waterfall", () => {
		expect(
			getReaderWaterfall(
				{ userItems: [], responseItems: [] },
				{ endedAt: null, startedAt: null, usageCalls: [] },
				null,
			),
		).toBeNull();
	});

	test("turn signals: red for errors or negative language, then apology, then positive", () => {
		const signal = (category: "apology" | "negative" | "positive") => ({
			category,
			matchedText: "…",
		});
		expect(
			getReaderTurnSignals({ errorCount: 0, signalOccurrences: [] }),
		).toEqual([]);
		expect(
			getReaderTurnSignals({
				errorCount: 2,
				signalOccurrences: [signal("positive"), signal("apology")],
			}),
		).toEqual(["trouble", "apology", "positive"]);
		expect(
			getReaderTurnSignals({
				errorCount: 0,
				signalOccurrences: [signal("negative"), signal("negative")],
			}),
		).toEqual(["trouble"]);
	});

	test("turn marks: skills, then files added, edited and removed", () => {
		const marks = getReaderTurnMarks(
			{
				editedFiles: ["src/a.ts"],
				fileEvents: [
					{ at, count: 1, operation: "created", path: "src/new.ts" },
					{ at, count: 1, operation: "edited", path: "src/new.ts" },
					{ at, count: 1, operation: "read", path: "src/read.ts" },
				],
				skills: ["frontend-design"],
			},
			{
				userItems: [],
				responseItems: [
					{
						events: [
							{
								activity: {
									actions: [],
									files: [{ operation: "deleted", path: "src/old.ts" }],
									kind: "executing",
									skills: [],
									status: "succeeded",
									verb: "Ran",
								},
								id: "t1",
								input: { command: "rm src/old.ts" },
								kind: "tool",
								timestamp: at,
								toolName: "Bash",
							},
						],
						executionMode: "default",
						id: "a1",
						kind: "agent",
						timestamp: at,
					},
				],
			},
		);
		expect(marks).toEqual([
			{ items: ["frontend-design"], kind: "skill" },
			{ items: ["src/new.ts"], kind: "file-added" },
			// A file added in the turn counts as added, not also edited.
			{ items: ["src/a.ts"], kind: "file-edited" },
			{ items: ["src/old.ts"], kind: "file-removed" },
		]);
		expect(
			getReaderTurnMarks({ editedFiles: [], fileEvents: [], skills: [] }, null),
		).toEqual([]);
	});

	test("a step's own id: sent as nativeId, else a Claude line UUID, never a Codex hash", () => {
		const uuid = "36526acb-6c14-481b-9bf8-116aa70eaf0c";
		const waterfall = getReaderWaterfall(
			{
				userItems: [],
				responseItems: [
					{
						events: [
							{ id: `${uuid}-0`, kind: "reasoning", text: "…", timestamp: at },
							{
								id: `${uuid}-1`,
								input: {},
								kind: "tool",
								nativeId: "toolu_019raFo3ugM6F48t9WCpVaHz",
								timestamp: at,
								toolName: "Bash",
							},
							{
								id: "codex-abc123-0",
								kind: "message",
								content: "Done.",
								provider: "codex",
								text: "Done.",
								timestamp: at,
							},
						],
						executionMode: "default",
						id: "a1",
						kind: "agent",
						timestamp: at,
					},
				],
			},
			{ endedAt: at, startedAt: at, usageCalls: [] },
			null,
		);
		expect(waterfall?.steps.map((step) => step.nativeId)).toEqual([
			uuid,
			"toolu_019raFo3ugM6F48t9WCpVaHz",
			null,
		]);
	});

	test("transcript sizes read in KB, MB or GB", () => {
		expect(formatReaderBytes(512)).toBe("512 B");
		expect(formatReaderBytes(48_000)).toBe("47 KB");
		expect(formatReaderBytes(12_582_912)).toBe("12.0 MB");
		expect(formatReaderBytes(2_147_483_648)).toBe("2.00 GB");
	});

	test("cost heat buckets against the session's quintiles", () => {
		const thresholds = getCostQuintiles([0, 1, 2, 3, 4, 5]);
		expect(thresholds).toEqual([2, 3, 4, 5]);
		expect(getCostShade(0.5, thresholds)).toBe("text-success");
		expect(getCostShade(9, thresholds)).toBe("text-error");
		expect(getCostShade(null, thresholds)).toBeUndefined();
	});

	test("durations read at a glance", () => {
		expect(formatReaderDuration(null)).toBe("—");
		expect(formatReaderDuration(0.2)).toBe("<1s");
		expect(formatReaderDuration(42)).toBe("42s");
		expect(formatReaderDuration(125)).toBe("2m 5s");
		expect(formatReaderDuration(3_720)).toBe("1h");
		expect(formatReaderDuration(15 * 3_600 + 20 * 60)).toBe("15.5h");
		expect(formatReaderDuration(15 * 3_600 + 50 * 60)).toBe("16h");
	});

	test("durations roll seconds over into minutes and minutes into hours", () => {
		expect(formatReaderDuration(59.4)).toBe("59s");
		expect(formatReaderDuration(59.6)).toBe("1m");
		expect(formatReaderDuration(60)).toBe("1m");
		expect(formatReaderDuration(119.6)).toBe("2m");
		expect(formatReaderDuration(3_599.4)).toBe("59m 59s");
		expect(formatReaderDuration(3_599.6)).toBe("1h");
		expect(formatReaderDuration(3_600)).toBe("1h");
	});

	test("costs read in cents", () => {
		expect(formatReaderCost(null)).toBe("—");
		expect(formatReaderCost(0.004)).toBe("<$0.01");
		expect(formatReaderCost(0.04)).toBe("$0.04");
		expect(formatReaderCost(9.994)).toBe("$9.99");
		expect(formatReaderCost(12.345)).toBe("$12");
		expect(formatReaderCost(95.73)).toBe("$96");
	});
});
