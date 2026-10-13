import { describe, expect, test } from "bun:test";
import type {
	LiveSessionSummary,
	LiveSessionTailOutput,
	LiveSessionTailStream,
} from "@rudel/api-routes";
import {
	buildLiveSessionTailCursor,
	formatLiveSessionActivity,
	formatLiveSessionSource,
	isLiveSessionActive,
	liveSessionPollInterval,
	mergeLiveSessionTail,
	readLatestLiveSessionModel,
	readLiveSessionState,
} from "./live-session-model";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");

function summary(
	overrides: Partial<LiveSessionSummary> = {},
): LiveSessionSummary {
	return {
		sessionId: "session-1",
		userId: "member-1",
		source: "claude_code",
		projectPath: "/work/repo",
		gitRemote: null,
		gitBranch: null,
		startedAt: "2026-10-13T11:00:00.000Z",
		lastActivityAt: "2026-10-13T11:59:00.000Z",
		endedAt: null,
		...overrides,
	};
}

function stream(
	overrides: Partial<LiveSessionTailStream> = {},
): LiveSessionTailStream {
	return {
		agentId: null,
		generation: 0,
		firstLine: 0,
		nextLine: 2,
		lines: ["a", "b"],
		truncatedBefore: false,
		...overrides,
	};
}

function response(streams: LiveSessionTailStream[]): LiveSessionTailOutput {
	return { session: summary(), streams, uploaded: false };
}

describe("live session activity", () => {
	test("a session runs until it ends or has been quiet for five minutes", () => {
		expect(
			isLiveSessionActive(
				summary({ lastActivityAt: "2026-10-13T11:55:00.000Z" }),
				NOW,
			),
		).toBe(true);
		expect(
			isLiveSessionActive(
				summary({ lastActivityAt: "2026-10-13T11:54:59.999Z" }),
				NOW,
			),
		).toBe(false);
		expect(
			isLiveSessionActive(
				summary({ endedAt: "2026-10-13T11:59:30.000Z" }),
				NOW,
			),
		).toBe(false);
	});

	test("the page polls a running session every 2 seconds, a quiet one every 30, an ended one for two minutes", () => {
		expect(liveSessionPollInterval(summary(), NOW)).toBe(2_000);
		const quiet = summary({ lastActivityAt: "2026-10-13T11:54:59.999Z" });
		expect(readLiveSessionState(quiet, NOW)).toBe("idle");
		expect(liveSessionPollInterval(quiet, NOW)).toBe(30_000);
		expect(
			liveSessionPollInterval(
				summary({ endedAt: "2026-10-13T11:58:00.001Z" }),
				NOW,
			),
		).toBe(2_000);
		const ended = summary({ endedAt: "2026-10-13T11:58:00.000Z" });
		expect(readLiveSessionState(ended, NOW)).toBe("ended");
		expect(liveSessionPollInterval(ended, NOW)).toBe(false);
		expect(readLiveSessionState(null, NOW)).toBe("none");
		expect(liveSessionPollInterval(null, NOW)).toBe(false);
	});

	test("reads recent activity in seconds, minutes and hours", () => {
		expect(formatLiveSessionActivity("2026-10-13T11:59:56.000Z", NOW)).toBe(
			"active now",
		);
		expect(formatLiveSessionActivity("2026-10-13T11:59:55.000Z", NOW)).toBe(
			"active 5s ago",
		);
		expect(formatLiveSessionActivity("2026-10-13T11:59:00.000Z", NOW)).toBe(
			"active 1m ago",
		);
		expect(formatLiveSessionActivity("2026-10-13T09:00:00.000Z", NOW)).toBe(
			"active 3h ago",
		);
	});
});

describe("mergeLiveSessionTail", () => {
	test("appends lines that continue a stream and keeps an unchanged stream's object", () => {
		const first = mergeLiveSessionTail(
			undefined,
			response([
				stream(),
				stream({ agentId: "sub", lines: ["s"], nextLine: 1 }),
			]),
		);
		expect(buildLiveSessionTailCursor(first)).toEqual([
			{ agentId: null, generation: 0, nextLine: 2 },
			{ agentId: "sub", generation: 0, nextLine: 1 },
		]);
		const second = mergeLiveSessionTail(
			first,
			response([
				stream({ firstLine: 2, nextLine: 3, lines: ["c"] }),
				stream({ agentId: "sub", firstLine: 1, nextLine: 1, lines: [] }),
			]),
		);
		expect(second.streams[0]).toEqual(
			stream({ firstLine: 0, nextLine: 3, lines: ["a", "b", "c"] }),
		);
		expect(second.streams[1]).toBe(first.streams[1]);
		// An answer with nothing new keeps what the page holds.
		expect(
			mergeLiveSessionTail(
				second,
				response([
					stream({ firstLine: 3, nextLine: 3, lines: [] }),
					stream({ agentId: "sub", firstLine: 1, nextLine: 1, lines: [] }),
				]),
			),
		).toBe(second);
		// The upload landing is news, even without new lines.
		expect(
			mergeLiveSessionTail(second, {
				...response([
					stream({ firstLine: 3, nextLine: 3, lines: [] }),
					stream({ agentId: "sub", firstLine: 1, nextLine: 1, lines: [] }),
				]),
				uploaded: true,
			}).uploaded,
		).toBe(true);
	});

	test("keeps only the newest 1,000 main and 300 subagent lines", () => {
		const lines = Array.from({ length: 1_001 }, (_, index) => `${index}`);
		const merged = mergeLiveSessionTail(
			undefined,
			response([
				stream({ lines, nextLine: 1_001 }),
				stream({
					agentId: "sub",
					lines: lines.slice(0, 301),
					nextLine: 301,
				}),
			]),
		);
		expect(merged.streams[0]).toMatchObject({
			firstLine: 1,
			nextLine: 1_001,
			truncatedBefore: true,
		});
		expect(merged.streams[0]?.lines).toEqual(lines.slice(1));
		expect(merged.streams[1]).toMatchObject({
			firstLine: 1,
			truncatedBefore: true,
		});
		expect(merged.streams[1]?.lines).toHaveLength(300);
	});

	test("has no cursor before the first answer", () => {
		expect(buildLiveSessionTailCursor(undefined)).toBeUndefined();
	});
});

describe("readLatestLiveSessionModel", () => {
	test("names the model of the newest assistant line", () => {
		expect(
			readLatestLiveSessionModel([
				JSON.stringify({ type: "assistant", message: { model: "claude-old" } }),
				JSON.stringify({ type: "assistant", message: { model: "claude-new" } }),
				JSON.stringify({ type: "user", message: { content: '"assistant"' } }),
				'{"type":"assistant", broken',
			]),
		).toBe("claude-new");
		expect(readLatestLiveSessionModel(["{}"])).toBeUndefined();
	});

	test("names the model of a Codex turn context", () => {
		expect(
			readLatestLiveSessionModel([
				JSON.stringify({
					type: "turn_context",
					payload: { model: "gpt-5-codex" },
				}),
				JSON.stringify({
					type: "response_item",
					payload: { role: "assistant" },
				}),
			]),
		).toBe("gpt-5-codex");
	});
});

describe("formatLiveSessionSource", () => {
	test("labels Claude Code and Codex sessions", () => {
		expect(formatLiveSessionSource("claude_code")).toBe("Claude Code");
		expect(formatLiveSessionSource("codex")).toBe("Codex");
	});
});
