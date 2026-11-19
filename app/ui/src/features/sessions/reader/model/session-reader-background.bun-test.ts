import { describe, expect, test } from "bun:test";
import type { TraceToolBackground } from "@rudel/api-routes";
import { formatRanOn } from "../detail/waterfall/session-reader-waterfall-chips";
import { getReaderWaterfall } from "./session-reader-model";
import { laneKeysOf, stepLaneLook } from "./session-reader-step-lanes";

const ts = (second: number) =>
	new Date(Date.UTC(2026, 9, 14, 8, 50, 0) + second * 1_000).toISOString();

const watch = (background: TraceToolBackground) =>
	getReaderWaterfall(
		{
			userItems: [],
			responseItems: [
				{
					events: [
						{
							background,
							id: "watch",
							input: { command: "sleep 90; gh pr checks 301 --watch" },
							kind: "tool",
							nativeId: "toolu_watch",
							result: {
								content: "moved to the background (ID: bcki3gu9l)",
								isError: false,
								timestamp: ts(600),
							},
							timestamp: ts(0),
							toolName: "Bash",
						},
						{
							content: "Waiting on CI.",
							id: "answer",
							kind: "message",
							text: "Waiting on CI.",
							timestamp: ts(601),
						},
					],
					executionMode: "default",
					id: "root",
					kind: "agent",
					timestamp: ts(0),
				},
			],
		},
		{ endedAt: ts(601), startedAt: ts(0), usageCalls: [] },
		null,
	);

describe("calls that went on in the background", () => {
	test("run on to their notification, past the run, without stretching it", () => {
		const waterfall = watch({
			exitCode: 0,
			finishedAt: ts(841),
			result: null,
			status: "completed",
			summary: "completed (exit code 0)",
			taskId: "bcki3gu9l",
			timedOut: true,
		});
		const step = waterfall?.steps[0];
		expect(step?.backgroundFromMs).toBe(Date.parse(ts(600)));
		expect(step?.endMs).toBe(Date.parse(ts(841)));
		expect(step?.isError).toBe(false);
		expect(waterfall?.endMs).toBe(Date.parse(ts(601)));
		if (!step) throw new Error("no step");
		expect(laneKeysOf(step)).toEqual([]);
		expect(stepLaneLook(step).tint).toBe("var(--color-zinc-400)");
	});

	test("one killed, failed or with a non-zero exit failed", () => {
		for (const ended of [
			{ exitCode: null, status: "killed" },
			{ exitCode: null, status: "failed" },
			{ exitCode: 1, status: "completed" },
		]) {
			const step = watch({
				...ended,
				finishedAt: ts(700),
				result: null,
				summary: null,
				taskId: "b1",
				timedOut: false,
			})?.steps[0];
			expect(step?.isError).toBe(true);
		}
	});

	test("what the agent wrote after a notification woke it began there", () => {
		const message = (id: string, second: number) => ({
			content: id,
			id,
			kind: "message" as const,
			text: id,
			timestamp: ts(second),
		});
		const waterfall = getReaderWaterfall(
			{
				userItems: [],
				responseItems: [
					{
						events: [
							{
								background: {
									exitCode: 0,
									finishedAt: ts(300),
									result: null,
									status: "completed",
									summary: null,
									taskId: "b3",
									timedOut: false,
								},
								id: "backfill",
								input: { command: "bun run backfill", run_in_background: true },
								kind: "tool",
								nativeId: "toolu_backfill",
								result: {
									content: "Command running in background with ID: b3",
									isError: false,
									timestamp: ts(10),
								},
								timestamp: ts(9),
								toolName: "Bash",
							},
							message("Waiting on the backfill.", 11),
							message("Backfill done.", 305),
						],
						executionMode: "default",
						id: "root",
						kind: "agent",
						timestamp: ts(0),
					},
				],
			},
			{ endedAt: ts(305), startedAt: ts(0), usageCalls: [] },
			null,
		);
		const done = waterfall?.steps.find((step) => step.id === "Backfill done.");
		expect(done?.startMs).toBe(Date.parse(ts(300)));
		expect(done?.endMs).toBe(Date.parse(ts(305)));
	});

	test("an older payload's notification, a system item of its own, counts too", () => {
		const waterfall = getReaderWaterfall(
			{
				userItems: [],
				responseItems: [
					{
						events: [
							{
								id: "watch",
								input: { command: "gh pr checks 301 --watch" },
								kind: "tool",
								nativeId: "toolu_watch",
								result: {
									content: "Command running in background with ID: b9",
									isError: false,
									timestamp: ts(2),
								},
								timestamp: ts(1),
								toolName: "Bash",
							},
							{
								content: "Watching CI.",
								id: "waiting",
								kind: "message",
								text: "Watching CI.",
								timestamp: ts(3),
							},
							{
								content: "CI passed.",
								id: "passed",
								kind: "message",
								text: "CI passed.",
								timestamp: ts(400),
							},
						],
						executionMode: "default",
						id: "root",
						kind: "agent",
						timestamp: ts(0),
					},
					{
						id: "notice",
						kind: "system",
						systemType: "notification",
						text: "<task-notification>\n<task-id>b9</task-id>\n<tool-use-id>toolu_watch</tool-use-id>\n<status>completed</status>\n<summary>Background command completed (exit code 0)</summary>\n</task-notification>",
						timestamp: ts(390),
					},
				],
			},
			{ endedAt: ts(400), startedAt: ts(0), usageCalls: [] },
			null,
		);
		const watched = waterfall?.steps.find((step) => step.id === "watch");
		expect(watched?.backgroundFromMs).toBe(Date.parse(ts(2)));
		expect(watched?.endMs).toBe(Date.parse(ts(390)));
		expect(watched?.isError).toBe(false);
		const passed = waterfall?.steps.find((step) => step.id === "passed");
		expect(passed?.startMs).toBe(Date.parse(ts(390)));
	});

	test("a background agent's launch takes its task's latest notification", () => {
		const notice = (call: string, second: number) => ({
			id: `notice-${second}`,
			kind: "system" as const,
			systemType: "notification" as const,
			text: `<task-notification>\n<task-id>a417</task-id>\n<tool-use-id>${call}</tool-use-id>\n<status>completed</status>\n<summary>Agent "review" finished</summary>\n</task-notification>`,
			timestamp: ts(second),
		});
		const waterfall = getReaderWaterfall(
			{
				userItems: [],
				responseItems: [
					{
						events: [
							{
								id: "launch",
								input: { description: "review", prompt: "review the diff" },
								kind: "tool",
								nativeId: "toolu_launch",
								result: {
									content:
										"Async agent launched successfully.\nagentId: a417 (internal ID)",
									isError: false,
									subagentId: "a417",
									timestamp: ts(2),
								},
								timestamp: ts(1),
								toolName: "Agent",
							},
							{
								content: "Reviewing in the background.",
								id: "waiting",
								kind: "message",
								text: "Reviewing in the background.",
								timestamp: ts(3),
							},
							{
								content: "The review is in.",
								id: "in",
								kind: "message",
								text: "The review is in.",
								timestamp: ts(700),
							},
						],
						executionMode: "default",
						id: "root",
						kind: "agent",
						timestamp: ts(0),
					},
					notice("toolu_message_1", 300),
					notice("toolu_message_2", 690),
				],
			},
			{ endedAt: ts(700), startedAt: ts(0), usageCalls: [] },
			null,
		);
		const launch = waterfall?.steps.find((step) => step.id === "launch");
		expect(launch?.backgroundFromMs).toBe(Date.parse(ts(2)));
		expect(launch?.endMs).toBe(Date.parse(ts(690)));
		const done = waterfall?.steps.find((step) => step.id === "in");
		expect(done?.startMs).toBe(Date.parse(ts(690)));
		const ids = waterfall?.steps.map((step) => step.id) ?? [];
		const back = waterfall?.steps.find((step) => step.id === "notice-690");
		expect(back).toMatchObject({
			harness: "notification",
			name: 'Agent "review" finished',
			notification: { agent: true, taskId: "a417" },
			startMs: Date.parse(ts(690)),
		});
		expect(ids.indexOf("notice-690")).toBeLessThan(ids.indexOf("in"));
	});

	test("a message to a subagent is answered by its next notification, not run on to it", () => {
		const waterfall = getReaderWaterfall(
			{
				userItems: [],
				responseItems: [
					{
						events: [
							{
								id: "send",
								input: { message: "Use the new schema", to: "a72c" },
								kind: "tool",
								nativeId: "toolu_send",
								result: {
									content: "Message queued for a72c",
									isError: false,
									timestamp: ts(11),
								},
								timestamp: ts(10),
								toolName: "SendMessage",
							},
							{
								content: "Waiting.",
								id: "after",
								kind: "message",
								text: "Waiting.",
								timestamp: ts(400),
							},
						],
						executionMode: "default",
						id: "root",
						kind: "agent",
						timestamp: ts(0),
					},
					{
						id: "other",
						kind: "system",
						systemType: "notification",
						text: "<task-notification>\n<task-id>a417</task-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n</task-notification>",
						timestamp: ts(200),
					},
					{
						id: "answer",
						kind: "system",
						systemType: "notification",
						text: "<task-notification>\n<task-id>a72c</task-id>\n<tool-use-id>toolu_launch</tool-use-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n</task-notification>",
						timestamp: ts(390),
					},
				],
			},
			{ endedAt: ts(400), startedAt: ts(0), usageCalls: [] },
			null,
		);
		const send = waterfall?.steps.find((step) => step.id === "send");
		expect(send?.endMs).toBe(Date.parse(ts(11)));
		expect(send?.backgroundFromMs).toBeUndefined();
		expect(send?.toolEvent?.background?.finishedAt).toBe(ts(390));
	});

	test("one never reported ends at its hand-off", () => {
		const waterfall = watch({
			exitCode: null,
			finishedAt: null,
			result: null,
			status: null,
			summary: null,
			taskId: "b2",
			timedOut: true,
		});
		expect(waterfall?.steps[0]?.backgroundFromMs).toBeUndefined();
		expect(waterfall?.steps[0]?.endMs).toBe(Date.parse(ts(600)));
	});
});

describe("how long a call ran on past its run", () => {
	test("reads in hours, to the half hour, from an hour up", () => {
		expect(formatRanOn(42 * 60_000)).toBe("42m");
		expect(formatRanOn(15 * 3_600_000 + 10 * 60_000)).toBe("15h");
		expect(formatRanOn(15 * 3_600_000 + 20 * 60_000)).toBe("15.5h");
		expect(formatRanOn(15 * 3_600_000 + 50 * 60_000)).toBe("16h");
	});
});
