import { describe, expect, test } from "bun:test";
import { buildConversationTrace, parseConversations } from "../index.js";
import {
	launchedAgentIdInText,
	parseBackgroundHandOff,
	parseTaskNotification,
} from "./background-tasks.js";

const MOVED =
	"Command did not complete within its 600s timeout and was moved to the background (ID: bcki3gu9l). Output is being written to: /private/tmp/claude-502/x/tasks/bcki3gu9l.output. You will be notified when it completes.";

const notification = (
	toolUseId: string,
	status: string,
	summary: string,
	extra = "",
) =>
	`<task-notification>\n<task-id>bcki3gu9l</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<output-file>/private/tmp/claude-502/x/tasks/bcki3gu9l.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>${extra}\n</task-notification>`;

describe("background tasks", () => {
	test("a timeout hand-off and a background start", () => {
		expect(parseBackgroundHandOff("Bash", MOVED)).toEqual({
			taskId: "bcki3gu9l",
			timedOut: true,
		});
		expect(
			parseBackgroundHandOff(
				"Bash",
				"Command running in background with ID: b4ntub6w0. Output is being written to: /tmp/x",
			),
		).toEqual({ taskId: "b4ntub6w0", timedOut: false });
		expect(parseBackgroundHandOff("Bash", "pushed")).toBeNull();
	});

	test("another tool's output quoting a hand-off went nowhere", () => {
		expect(
			parseBackgroundHandOff(
				"mcp__plugin_opaline_opaline__read",
				`record\t${MOVED}`,
			),
		).toBeNull();
		expect(parseBackgroundHandOff("Read", MOVED)).toBeNull();
		expect(parseBackgroundHandOff(undefined, MOVED)).toBeNull();
	});

	test("a notification's status, exit code and an agent's result", () => {
		expect(
			parseTaskNotification(
				notification(
					"toolu_1",
					"completed",
					'Background command "Wait for CI" completed (exit code 0)',
				),
			),
		).toEqual({
			exitCode: 0,
			result: null,
			status: "completed",
			summary: 'Background command "Wait for CI" completed (exit code 0)',
			taskId: "bcki3gu9l",
			toolUseId: "toolu_1",
		});
		const killed = parseTaskNotification(
			notification(
				"toolu_2",
				"killed",
				'Background command "Start the dev server" was stopped after reaching its background time limit',
				"\n<result>All four calls checked.</result>",
			),
		);
		expect(killed).toMatchObject({
			exitCode: null,
			result: "All four calls checked.",
			status: "killed",
		});
		expect(parseTaskNotification("Run the tests")).toBeNull();
	});

	test("a notification runs later ends the call that went to the background", () => {
		const entry = (
			uuid: string,
			timestamp: string,
			value: Record<string, unknown>,
		) =>
			JSON.stringify({
				uuid,
				parentUuid: null,
				sessionId: "session-1",
				timestamp,
				...value,
			});
		const lines = [
			entry("p1", "2026-10-14T08:50:00.000Z", {
				type: "user",
				message: { role: "user", content: "Push and wait for CI" },
			}),
			entry("a1", "2026-10-14T08:50:20.000Z", {
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_watch",
							name: "Bash",
							input: { command: "sleep 90; gh pr checks 301 --watch" },
						},
					],
				},
			}),
			entry("r1", "2026-10-14T09:00:21.000Z", {
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_watch",
							content: [{ type: "text", text: MOVED }],
							is_error: false,
						},
					],
				},
			}),
			entry("p2", "2026-10-14T09:02:00.000Z", {
				type: "user",
				message: { role: "user", content: "and the other org" },
			}),
			entry("n1", "2026-10-14T09:04:21.423Z", {
				type: "user",
				isMeta: true,
				message: {
					role: "user",
					content: notification(
						"toolu_watch",
						"completed",
						'Background command "Wait for CI" completed (exit code 0)',
					),
				},
			}),
		].join("\n");
		const watch = buildConversationTrace(parseConversations(lines))
			.flatMap((item) => (item.kind === "agent" ? item.events : []))
			.find((event) => event.kind === "tool");
		expect(watch?.kind === "tool" ? watch.background : undefined).toEqual({
			exitCode: 0,
			finishedAt: "2026-10-14T09:04:21.423Z",
			result: null,
			status: "completed",
			summary: 'Background command "Wait for CI" completed (exit code 0)',
			taskId: "bcki3gu9l",
			timedOut: true,
		});
	});
	test("a subagent's own launch names its subagent in the result text", () => {
		// Claude Code writes no toolUseResult for a launch a subagent makes:
		// the subagent it started is named only in the result.
		const launched =
			"Async agent launched successfully. (This tool result is internal metadata.)\nagentId: aa1bb0363f18d5e9e (internal ID - do not mention to user.)\nThe agent is working in the background.";
		const lines = [
			{
				type: "user",
				uuid: "p1",
				isSidechain: true,
				agentId: "a1a7656e349819a7d",
				timestamp: "2026-10-16T09:35:00.000Z",
				message: { role: "user", content: "Map the CLI's upload coverage" },
			},
			{
				type: "assistant",
				uuid: "a1",
				isSidechain: true,
				agentId: "a1a7656e349819a7d",
				timestamp: "2026-10-16T09:35:10.000Z",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_nested",
							name: "Agent",
							input: { description: "CLI upload coverage map", prompt: "…" },
						},
					],
				},
			},
			{
				type: "user",
				uuid: "r1",
				isSidechain: true,
				agentId: "a1a7656e349819a7d",
				timestamp: "2026-10-16T09:35:11.000Z",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_nested",
							content: [{ type: "text", text: launched }],
						},
					],
				},
			},
		]
			.map((line) => JSON.stringify({ sessionId: "session-1", ...line }))
			.join("\n");
		const launch = buildConversationTrace(parseConversations(lines))
			.flatMap((item) => (item.kind === "agent" ? item.events : []))
			.find((event) => event.kind === "tool");
		expect(launch?.kind === "tool" ? launch.result?.subagentId : null).toBe(
			"aa1bb0363f18d5e9e",
		);
		expect(launchedAgentIdInText(launched)).toBe("aa1bb0363f18d5e9e");
	});
});
