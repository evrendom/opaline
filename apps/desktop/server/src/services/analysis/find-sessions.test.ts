import { describe, expect, test } from "bun:test";
import {
	AnalysisFindInputSchema,
	type AnalysisFindOutput,
} from "@rudel/api-routes";
import { classifyFailure } from "./failure-classifier.js";
import { findAnalysis } from "./find.service.js";
import { renderFind } from "./find-text.js";
import { clickhouse, DAY, run, session } from "./find-world.fixtures.js";

const scope = { organizationId: "org", userId: null };

function failure(sessionId: string, turn: number, minute: number) {
	return {
		session_id: sessionId,
		agent_id: "",
		record_idx: turn * 10 + minute,
		block_idx: 0,
		turn_idx: turn,
		started_ms: DAY + minute * 60_000,
		tool_name: "Bash",
		tool_group: "shell",
		command_class: "install",
		exit_code: 2,
		head: "PreToolUse:Bash hook error: STOP: This command cannot install or download packages.",
		tail: "",
		command: "bun add left-pad",
		partial: 0,
	};
}

const cause = classifyFailure({
	tool: "Bash",
	commandClass: "install",
	command: "bun add left-pad",
	body: failure("s1", 1, 0).head,
	tail: "",
	exitCode: 2,
});

function find(
	world: ReturnType<typeof clickhouse>,
	input: Record<string, unknown>,
) {
	return findAnalysis(scope, AnalysisFindInputSchema.parse(input), {
		executor: world.executor,
		edges: null,
	});
}

function sessionsOf(output: AnalysisFindOutput) {
	return output.source === "sessions" ? output : null;
}

describe("find groupBy=session", () => {
	const world = () =>
		clickhouse({
			sessions: [session("s1"), session("s2")],
			runs: [run("s1", 1, 1), run("s1", 2, 1), run("s2", 1, 1)],
			failures: [
				failure("s1", 1, 5),
				failure("s1", 2, 9),
				failure("s1", 2, 7),
				failure("s2", 1, 3),
			],
		});

	test("source=tool lists each session behind a cause once, with its rows, times and runs", async () => {
		const output = sessionsOf(
			await find(world(), {
				source: "tool",
				cause: cause.cause,
				groupBy: "session",
			}),
		);
		expect(output?.of).toBe("tool");
		expect(output?.sessionTotals).toEqual({
			sessions: 2,
			rows: 4,
			firstSeen: new Date(DAY + 3 * 60_000).toISOString(),
			lastSeen: new Date(DAY + 9 * 60_000).toISOString(),
		});
		expect(output?.sessions).toEqual([
			{
				sessionId: "s1",
				repository: "web",
				agent: "claude_code",
				startedAt: new Date(DAY + 60_000).toISOString(),
				rows: 3,
				firstSeen: new Date(DAY + 5 * 60_000).toISOString(),
				lastSeen: new Date(DAY + 9 * 60_000).toISOString(),
				groupRunTime: 3,
				groupCallTime: null,
				failedCalls: 3,
				example: { ref: { sessionId: "s1", agentId: "", turn: 1 }, record: 15 },
				parentSessionId: null,
			},
			{
				sessionId: "s2",
				repository: "web",
				agent: "claude_code",
				startedAt: new Date(DAY + 60_000).toISOString(),
				rows: 1,
				firstSeen: new Date(DAY + 3 * 60_000).toISOString(),
				lastSeen: new Date(DAY + 3 * 60_000).toISOString(),
				groupRunTime: 1,
				groupCallTime: null,
				failedCalls: 1,
				example: { ref: { sessionId: "s2", agentId: "", turn: 1 }, record: 13 },
				parentSessionId: null,
			},
		]);
		const text = renderFind(output as AnalysisFindOutput);
		expect(text.split("\n")[0]).toStartWith("tool groupBy=session ");
		expect(text).toContain(
			`sessions behind the rows: sessions=2 rows=4 firstSeen=${new Date(DAY + 3 * 60_000).toISOString()}`,
		);
	});

	test("pages by rows, then first time, then session, with a cursor", async () => {
		const first = sessionsOf(
			await find(world(), {
				source: "tool",
				cause: cause.cause,
				groupBy: "session",
				limit: 1,
			}),
		);
		expect(first?.sessions.map((row) => row.sessionId)).toEqual(["s1"]);
		expect(first?.sessionTotals.sessions).toBe(2);
		const second = sessionsOf(
			await find(world(), {
				source: "tool",
				cause: cause.cause,
				groupBy: "session",
				limit: 1,
				cursor: first?.header.cursor,
			}),
		);
		expect(second?.sessions.map((row) => row.sessionId)).toEqual(["s2"]);
		expect(second?.header.cursor).toBeUndefined();
	});

	test("source=calls sums each session's calls, failures and call time from one grouped statement", async () => {
		const group = (sessionId: string, calls: number, failed: number) => ({
			key: sessionId,
			calls,
			sessions: 1,
			failed_calls: failed,
			first_ms: DAY,
			last_ms: DAY + 60_000,
			call_minutes: 1.5,
			runs: [[1, "", 1]],
			examples: [[DAY + 60_000, [sessionId, "", 1, 4, 0]]],
		});
		const calls = clickhouse({
			sessions: [session("s1"), session("s2")],
			runs: [run("s1", 1, 1), run("s2", 1, 1)],
			groups: (params) =>
				[group("s1", 2, 1), group("s2", 5, 5)].filter((row) =>
					(params.sessionIds as string[]).includes(row.key),
				),
		});
		const output = sessionsOf(
			await find(calls, { source: "calls", groupBy: "session" }),
		);
		expect(output?.header).toMatchObject({
			matchedCalls: 7,
			groupCallTime: 3,
		});
		expect(
			output?.sessions.map(
				({ sessionId, rows, failedCalls, groupCallTime }) => ({
					sessionId,
					rows,
					failedCalls,
					groupCallTime,
				}),
			),
		).toEqual([
			{ sessionId: "s2", rows: 5, failedCalls: 5, groupCallTime: 1.5 },
			{ sessionId: "s1", rows: 2, failedCalls: 1, groupCallTime: 1.5 },
		]);
		const grouped = calls.statements.find((statement) =>
			statement.query.includes("AS text_runs"),
		);
		expect(grouped?.query).toContain("SELECT session_id AS key");
	});

	test("is refused for sources it does not apply to", () => {
		expect(
			AnalysisFindInputSchema.safeParse({ source: "git", groupBy: "session" })
				.success,
		).toBe(false);
		for (const source of ["tool", "user", "calls", "runs"])
			expect(
				AnalysisFindInputSchema.safeParse({ source, groupBy: "session" })
					.success,
			).toBe(true);
	});
});
