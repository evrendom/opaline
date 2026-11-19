import { expect, test } from "bun:test";
import { getAgentRunDuration } from "@rudel/api-routes";
import { captureSessionAgentRuns } from "../services/session-agent-runs.js";

function user(id: string, text: string, timestamp = "2026-09-18T10:00:00Z") {
	return {
		type: "user",
		uuid: id,
		sessionId: "runs",
		timestamp,
		message: { role: "user", content: text },
	};
}
function assistant(
	id: string,
	text: string,
	timestamp = "2026-09-18T10:01:00Z",
) {
	return {
		type: "assistant",
		uuid: id,
		sessionId: "runs",
		timestamp,
		message: {
			role: "assistant",
			model: "claude-sonnet-4",
			content: [{ type: "text", text }],
		},
	};
}
function scan(entries: readonly unknown[]) {
	return captureSessionAgentRuns(
		entries.map((entry) => JSON.stringify(entry)).join("\n"),
	);
}

test("attributes only the immediately following reply to the previous run, once", () => {
	const runs = scan([
		user("u1", "Great! Start the task."),
		assistant("a1", "Sorry. Done."),
		user("u2", "Great, great work!", "2026-09-18T10:02:00Z"),
		assistant("a2", "Done", "2026-09-18T10:03:00Z"),
		user("u3", "Continue with the next file", "2026-09-18T10:04:00Z"),
		assistant("a3", "Done", "2026-09-18T10:05:00Z"),
	]);
	expect(runs.map((run) => run.signal)).toEqual([
		"positive",
		"none",
		"noReply",
	]);
	expect(runs.map((run) => run.elapsedSeconds)).toEqual([60, 60, 60]);
	expect(runs).toHaveLength(3);
});

test("does not treat quoted code as feedback or tool results as user replies", () => {
	const runs = scan([
		user("u1", "Start"),
		assistant("a1", "Done"),
		{
			...user("tool", ""),
			message: {
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "t1", content: "Great" }],
			},
		},
		user("u2", "`Great`", "2026-09-18T10:02:00Z"),
		assistant("a2", "Done", "2026-09-18T10:03:00Z"),
	]);
	expect(runs.map((run) => run.signal)).toEqual(["none", "noReply"]);
});

test("excludes unanswered prompts, orphan assistant history and copied context", () => {
	expect(
		scan([assistant("orphan", "old response"), user("pending", "Start")]),
	).toEqual([]);
	expect(
		scan([
			{ ...user("context", "Great"), isMeta: true },
			assistant("a1", "Injected history"),
		]),
	).toEqual([]);
});

test("keeps invalid durations unknown and measured zero valid", () => {
	const runs = scan([
		user("u1", "Start", "bad-date"),
		assistant("a1", "Done"),
		user("u2", "Continue", "2026-09-18T10:02:00Z"),
		assistant("a2", "Done", "2026-09-18T10:02:00Z"),
	]);
	expect(runs.map((run) => run.elapsedSeconds)).toEqual([undefined, 0]);
});

test("keeps duration boundaries exhaustive and handles long outliers", () => {
	expect(
		[
			0,
			59.999,
			60,
			299.999,
			300,
			900,
			1800,
			3600,
			10800,
			43200,
			1000000,
			undefined,
			-1,
			NaN,
		].map(getAgentRunDuration),
	).toEqual([
		"under1m",
		"under1m",
		"1to5m",
		"1to5m",
		"5to15m",
		"15to30m",
		"30to60m",
		"1to3h",
		"3to12h",
		"12hPlus",
		"12hPlus",
		"unknown",
		"unknown",
		"unknown",
	]);
});

test("records skills on their own run and counts mixed feedback once", () => {
	const skill = {
		...assistant("skill", ""),
		message: {
			role: "assistant",
			model: "claude-sonnet-4",
			content: [
				{
					type: "tool_use",
					id: "skill-call",
					name: "Skill",
					input: { skill: "design" },
				},
			],
		},
	};
	const runs = scan([
		user("u1", "Start"),
		skill,
		assistant("a1", "Done"),
		user("u2", "Great. It didn’t work", "2026-09-18T10:02:00Z"),
		assistant("a2", "Done", "2026-09-18T10:03:00Z"),
		user("u3", "It didn’t work", "2026-09-18T10:04:00Z"),
	]);
	expect(runs.map((run) => run.hasSkills)).toEqual([true, false]);
	expect(runs.map((run) => run.signal)).toEqual(["mixed", "negative"]);
});

test("does not assign a completed duration to a tool-only run", () => {
	const runs = scan([
		user("u1", "Start"),
		{
			...assistant("tool", ""),
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool",
						name: "Bash",
						input: { command: "pwd" },
					},
				],
			},
		},
	]);
	expect(runs).toHaveLength(1);
	expect(runs[0]?.elapsedSeconds).toBeUndefined();
});

test("counts Codex response cycles and attributes their next user reply", () => {
	const runs = scan([
		{
			type: "session_meta",
			timestamp: "2026-09-18T10:00:00Z",
			payload: {
				id: "codex-runs",
				cwd: "/repo",
				originator: "codex_cli_rs",
				cli_version: "0.110.0",
			},
		},
		{
			type: "response_item",
			timestamp: "2026-09-18T10:00:00Z",
			payload: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "Start" }],
			},
		},
		{
			type: "response_item",
			timestamp: "2026-09-18T10:03:00Z",
			payload: {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Done" }],
			},
		},
		{
			type: "response_item",
			timestamp: "2026-09-18T10:04:00Z",
			payload: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "Great" }],
			},
		},
		{
			type: "response_item",
			timestamp: "2026-09-18T10:05:00Z",
			payload: {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Done" }],
			},
		},
	]);
	expect(runs.map((run) => run.signal)).toEqual(["positive", "noReply"]);
	expect(runs.map((run) => run.elapsedSeconds)).toEqual([180, 60]);
});
