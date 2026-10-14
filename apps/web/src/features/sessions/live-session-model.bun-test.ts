import { describe, expect, test } from "bun:test";
import type {
	LiveSessionSummary,
	LiveSessionTailOutput,
	LiveSessionTailStream,
} from "@rudel/api-routes";
import {
	formatLiveSessionActivity,
	formatLiveSessionAge,
	formatLiveSessionSource,
	isLiveSessionActive,
	liveSessionPollInterval,
	mergeLiveSessionTail,
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
		firstLine: 2,
		nextLine: 2,
		lines: [],
		truncatedBefore: true,
		...overrides,
	};
}

function response(
	streams: LiveSessionTailStream[],
	session: LiveSessionSummary = summary(),
): LiveSessionTailOutput {
	return { session, streams, uploaded: false };
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
		expect(formatLiveSessionAge("2026-10-13T11:59:56.000Z", NOW)).toBe("now");
		expect(formatLiveSessionAge("2026-10-13T11:59:55.000Z", NOW)).toBe(
			"5s ago",
		);
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
	test("keeps the session and streams that did not change, and the whole answer when nothing did", () => {
		const first = mergeLiveSessionTail(
			undefined,
			response([stream(), stream({ agentId: "sub", nextLine: 1 })]),
		);
		const same = mergeLiveSessionTail(
			first,
			response([stream(), stream({ agentId: "sub", nextLine: 1 })]),
		);
		expect(same).toBe(first);

		const moved = mergeLiveSessionTail(
			first,
			response(
				[
					stream({ firstLine: 3, nextLine: 3 }),
					stream({ agentId: "sub", nextLine: 1 }),
				],
				summary({ lastActivityAt: "2026-10-13T11:59:30.000Z" }),
			),
		);
		expect(moved).not.toBe(first);
		expect(moved.session?.lastActivityAt).toBe("2026-10-13T11:59:30.000Z");
		expect(moved.streams[0]).toEqual(stream({ firstLine: 3, nextLine: 3 }));
		expect(moved.streams[1]).toBe(first.streams[1]);
	});

	test("the upload landing is news, even without new lines", () => {
		const first = mergeLiveSessionTail(undefined, response([stream()]));
		expect(
			mergeLiveSessionTail(first, { ...response([stream()]), uploaded: true })
				.uploaded,
		).toBe(true);
	});

	test("a session that is gone reads as none", () => {
		const first = mergeLiveSessionTail(undefined, response([stream()]));
		const gone = mergeLiveSessionTail(first, {
			session: null,
			streams: [],
			uploaded: false,
		});
		expect(gone.session).toBeNull();
		expect(readLiveSessionState(gone.session, NOW)).toBe("none");
	});
});

describe("formatLiveSessionSource", () => {
	test("labels Claude Code and Codex sessions", () => {
		expect(formatLiveSessionSource("claude_code")).toBe("Claude Code");
		expect(formatLiveSessionSource("codex")).toBe("Codex");
	});
});
