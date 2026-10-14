import { describe, expect, test } from "bun:test";
import type { LiveSessionSummary, SessionAnalytics } from "@rudel/api-routes";
import {
	compareLiveSessionRows,
	isLiveOnlySessionRow,
	liveSessionRow,
	mergeLiveSessionRows,
} from "./live-session-rows";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");

function live(overrides: Partial<LiveSessionSummary> = {}): LiveSessionSummary {
	return {
		sessionId: "live-1",
		userId: "member-1",
		source: "claude_code",
		projectPath: "/work/repo",
		gitRemote: "git@github.com:example/repo.git",
		gitBranch: "feature/live",
		startedAt: "2026-10-13T11:00:00.000Z",
		lastActivityAt: "2026-10-13T11:59:30.000Z",
		endedAt: null,
		...overrides,
	};
}

function uploaded(overrides: Partial<SessionAnalytics> = {}): SessionAnalytics {
	return {
		session_id: "uploaded-1",
		user_id: "member-2",
		source: "claude_code",
		session_date: "2026-10-13T10:00:00",
		project_path: "/work/other",
		repository: "example/other",
		model_used: "claude-sonnet-4",
		estimated_cost: 0.5,
		duration_min: 12,
		total_tokens: 1_000,
		input_tokens: 600,
		output_tokens: 400,
		total_interactions: 4,
		subagent_types: [],
		skills: [],
		slash_commands: [],
		...overrides,
	};
}

describe("liveSessionRow", () => {
	test("carries the live session's facts without transcript metrics", () => {
		const row = liveSessionRow(live());
		expect(row).toMatchObject({
			live_session: live(),
			session_id: "live-1",
			user_id: "member-1",
			source: "claude_code",
			session_date: "2026-10-13T11:00:00.000Z",
			project_path: "/work/repo",
			git_remote: "git@github.com:example/repo.git",
			git_branch: "feature/live",
			model_used: "",
			estimated_cost: null,
			total_tokens: 0,
		});
		expect(isLiveOnlySessionRow(row)).toBe(true);
		expect(isLiveOnlySessionRow(uploaded())).toBe(false);
		expect(isLiveOnlySessionRow({ ...uploaded(), live_session: live() })).toBe(
			false,
		);
	});
});

describe("mergeLiveSessionRows", () => {
	test("puts the sessions running right now first, most recently active first", () => {
		const older = live({
			sessionId: "live-older",
			lastActivityAt: "2026-10-13T11:58:00.000Z",
		});
		const rows = mergeLiveSessionRows([uploaded()], [older, live()], NOW);
		expect(rows.map((row) => row.session_id)).toEqual([
			"live-1",
			"live-older",
			"uploaded-1",
		]);
		expect(rows[0]?.live_session).toEqual(live());
	});

	test("marks an uploaded session's own row while it runs again, and leaves it alone once it stopped", () => {
		const resumed = live({ sessionId: "uploaded-1", userId: "member-2" });
		const running = mergeLiveSessionRows(
			[uploaded({ session_id: "other" }), uploaded()],
			[resumed],
			NOW,
		);
		expect(running.map((row) => row.session_id)).toEqual([
			"uploaded-1",
			"other",
		]);
		expect(running[0]).toMatchObject({
			live_session: resumed,
			model_used: "claude-sonnet-4",
			total_tokens: 1_000,
		});
		expect(isLiveOnlySessionRow(running[0] as SessionAnalytics)).toBe(false);

		const ended = mergeLiveSessionRows(
			[uploaded({ session_id: "other" }), uploaded()],
			[live({ ...resumed, endedAt: "2026-10-13T11:59:40.000Z" })],
			NOW,
		);
		expect(ended.map((row) => row.session_id)).toEqual(["other", "uploaded-1"]);
		expect(ended[1]?.live_session).toBeUndefined();

		const quiet = mergeLiveSessionRows(
			[uploaded()],
			[live({ ...resumed, lastActivityAt: "2026-10-13T11:50:00.000Z" })],
			NOW,
		);
		expect(quiet[0]?.live_session).toBeUndefined();
	});

	test("keeps an ended session that is not uploaded yet, and tells sources apart", () => {
		const rows = mergeLiveSessionRows(
			[uploaded({ session_id: "live-1", source: "codex" })],
			[live({ endedAt: "2026-10-13T11:59:40.000Z" })],
			NOW,
		);
		expect(rows.map((row) => `${row.source}:${row.session_id}`)).toEqual([
			"claude_code:live-1",
			"codex:live-1",
		]);
	});

	test("without live sessions the rows are as they were", () => {
		const rows = [uploaded()];
		expect(mergeLiveSessionRows(rows, [], NOW)).toEqual(rows);
	});
});

describe("compareLiveSessionRows", () => {
	test("orders live rows first and by activity, leaving the rest to the table", () => {
		const newer = liveSessionRow(live());
		const older = liveSessionRow(
			live({
				sessionId: "live-older",
				lastActivityAt: "2026-10-13T11:00:00.000Z",
			}),
		);
		expect(compareLiveSessionRows(newer, older)).toBeLessThan(0);
		expect(compareLiveSessionRows(older, newer)).toBeGreaterThan(0);
		expect(compareLiveSessionRows(uploaded(), newer)).toBeGreaterThan(0);
		expect(compareLiveSessionRows(newer, uploaded())).toBeLessThan(0);
		expect(compareLiveSessionRows(uploaded(), uploaded())).toBe(0);
	});
});
