import { describe, expect, test } from "bun:test";
import { IconBrandGithub, IconMessage, IconUser } from "@tabler/icons-react";
import type { SessionReaderStep } from "./session-reader-run-steps";
import { laneKeysOf, stepLaneLook } from "./session-reader-step-lanes";

const shell = (command: string, extra: Record<string, unknown> = {}) =>
	({
		children: [],
		command: { chain: "cd · gh pr", kind: "github", lead: "gh pr" },
		detail: null,
		endMs: 10,
		icon: null,
		id: "watch",
		isError: false,
		kind: "tool",
		name: "gh pr",
		nativeId: null,
		result: null,
		startMs: 0,
		text: null,
		toolEvent: {
			id: "watch",
			input: { command },
			kind: "tool",
			timestamp: "2026-10-16T10:00:00.000Z",
			toolName: "Bash",
		},
		...extra,
	}) as unknown as SessionReaderStep;

describe("step lanes", () => {
	test("watching a PR's checks is CI's, rose where they failed", () => {
		const watch = shell(
			"cd ~/athena && gh pr checks 312 --watch --interval 30 > /tmp/ci.log 2>&1",
		);
		expect(stepLaneLook(watch)).toEqual({
			glyph: IconBrandGithub,
			tint: "var(--color-zinc-400)",
		});
		expect(laneKeysOf(watch)).toEqual([]);
		expect(stepLaneLook({ ...watch, isError: true }).tint).toBe(
			"var(--color-rose-500)",
		);
	});

	test("another call handed to the background is the background's too", () => {
		const step = shell("sleep 90; bun run e2e", {
			backgroundFromMs: 5,
			command: { chain: "sleep · bun run", kind: "build", lead: "bun run" },
		});
		expect(laneKeysOf(step)).toContain("background");
		expect(stepLaneLook(step).tint).toBe("var(--color-blue-400)");
	});

	test("a message to a subagent is the messages lane's", () => {
		const message = shell("", {
			command: undefined,
			name: "SendMessage",
			toolEvent: {
				id: "send",
				input: { message: "Use the new schema", to: "a417" },
				kind: "tool",
				timestamp: "2026-10-16T10:00:00.000Z",
				toolName: "SendMessage",
			},
		});
		expect(laneKeysOf(message)).toEqual(["message"]);
		expect(stepLaneLook(message).glyph).toBe(IconMessage);
		const resumed = { ...message, backgroundFromMs: 1 };
		expect(laneKeysOf(resumed)).toEqual(["message"]);
		expect(stepLaneLook(resumed).glyph).toBe(IconMessage);
	});

	test("a subagent's report is the messages lane's; a command's end isn't", () => {
		const report = shell("", {
			harness: "notification",
			notification: { agent: true, taskId: "a72c", toolUseId: null },
			toolEvent: null,
		});
		expect(laneKeysOf(report)).toEqual(["message"]);
		expect(
			laneKeysOf({
				...report,
				notification: { agent: false, taskId: "b9", toolUseId: null },
			}),
		).toEqual([]);
	});

	test("what the member wrote while the agent worked is theirs", () => {
		const redirect = shell("", { harness: "member", toolEvent: null });
		expect(laneKeysOf(redirect)).toEqual([]);
		expect(stepLaneLook(redirect).glyph).toBe(IconUser);
	});

	test("other gh calls stay git's", () => {
		expect(laneKeysOf(shell("gh pr view 312"))).toEqual(["git"]);
	});
});
