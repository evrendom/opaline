import { describe, expect, test } from "bun:test";
import { getReaderWaterfall } from "./session-reader-model";
import { getLaunchedSubagentKey } from "./session-reader-run-steps";

describe("subagents in the turn waterfall", () => {
	test("a Codex subagent working inline nests under the call that spawned it", () => {
		const ts = (second: number) =>
			new Date(Date.UTC(2026, 9, 10, 9, 0, second)).toISOString();
		const waterfall = getReaderWaterfall(
			{
				userItems: [],
				responseItems: [
					{
						events: [
							{
								id: "codex-a-0",
								input: {
									__rudel_codex_operation: {
										operationId: "call_spawn1",
										provider: "codex",
									},
									agent_type: "worker",
								},
								kind: "tool",
								provider: "codex",
								result: {
									content: "spawned",
									isError: false,
									subagentId: "worker",
								},
								timestamp: ts(1),
								toolName: "spawn_agent",
							},
							{
								id: "codex-c-0",
								kind: "message",
								content: "Done.",
								provider: "codex",
								text: "Done.",
								timestamp: ts(30),
							},
						],
						executionMode: "default",
						id: "root",
						kind: "agent",
						timestamp: ts(1),
					},
					{
						agentName: "worker",
						events: [
							{
								id: "codex-b-0",
								kind: "reasoning",
								provider: "codex",
								text: "Looking.",
								timestamp: ts(5),
							},
							{
								id: "codex-b-1",
								kind: "message",
								content: "Found it.",
								provider: "codex",
								text: "Found it.",
								timestamp: ts(20),
							},
						],
						executionMode: "default",
						id: "worker-item",
						kind: "agent",
						timestamp: ts(2),
					},
				],
			},
			{ endedAt: ts(30), startedAt: ts(0), usageCalls: [] },
			null,
		);
		const spawn = waterfall?.steps[0];
		// No task name given, the call reads as a subagent, not its tool.
		expect(waterfall?.steps.map((step) => step.name)).toEqual([
			"Subagent",
			"Response",
		]);
		// The call's id comes from the operation metadata the parser attaches.
		expect(spawn?.nativeId).toBe("call_spawn1");
		expect(spawn?.children.map((step) => step.text)).toEqual([
			"Looking.",
			"Found it.",
		]);
		// The call runs at least as long as its subagent does.
		expect(spawn?.endMs).toBeGreaterThanOrEqual(Date.parse(ts(20)));
		expect(waterfall?.allSteps.map((step) => step.id)).toEqual([
			"codex-a-0",
			"codex-b-0",
			"codex-b-1",
			"codex-c-0",
		]);
	});

	test("a Claude subagent's fetched transcript nests under its Agent call", () => {
		const ts = (second: number) =>
			new Date(Date.UTC(2026, 9, 10, 9, 0, second)).toISOString();
		const agentCall = {
			id: "11111111-1111-4111-8111-111111111111-0",
			input: { description: "Find the bug", subagent_type: "Explore" },
			kind: "tool" as const,
			result: { content: "found", isError: false, subagentId: "agent-1" },
			timestamp: ts(1),
			toolName: "Agent",
		};
		const fetched = new Map([
			[
				"agent-1",
				[
					{
						events: [
							{
								id: "22222222-2222-4222-8222-222222222222-0",
								input: { file_path: "a.ts" },
								kind: "tool" as const,
								timestamp: ts(4),
								toolName: "Read",
							},
						],
						executionMode: "default" as const,
						id: "sub",
						kind: "agent" as const,
						timestamp: ts(2),
					},
				],
			],
		]);
		const turn = { endedAt: ts(10), startedAt: ts(0), usageCalls: [] };
		const body = {
			userItems: [],
			responseItems: [
				{
					events: [agentCall],
					executionMode: "default" as const,
					id: "root",
					kind: "agent" as const,
					timestamp: ts(1),
				},
			],
		};
		// Without the transcript, the call stands alone; with it, the
		// subagent's Read nests beneath.
		expect(getReaderWaterfall(body, turn, null)?.steps[0]?.children).toEqual(
			[],
		);
		const nested = getReaderWaterfall(body, turn, null, fetched);
		expect(nested?.steps[0]?.name).toBe("Explore");
		expect(nested?.steps[0]?.children.map((step) => step.name)).toEqual([
			"Read",
		]);
	});
	test("Codex's spawn_agent names its subagent session by agent path", () => {
		const spawn = (output: string) => ({
			id: "codex-a-0",
			input: { task_name: "athena_privacy" },
			kind: "tool" as const,
			provider: "codex" as const,
			result: { content: output, isError: false },
			timestamp: "2026-10-06T10:08:30.000Z",
			toolName: "spawn_agent",
		});
		expect(
			getLaunchedSubagentKey(spawn('{"task_name":"/root/athena_privacy"}')),
		).toBe("/root/athena_privacy");
		expect(getLaunchedSubagentKey(spawn("not json"))).toBeNull();
	});
});
