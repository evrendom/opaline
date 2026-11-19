import { describe, expect, test } from "bun:test";
import {
	runCiByTurnStart,
	runCiStartedAt,
	runCiStartKey,
	turnRunCi,
} from "@rudel/api-routes";
import { splitSessionTranscript } from "@rudel/api-routes/transcript-records";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import {
	deriveSessionDetail,
	type SessionDetailRawSnapshot,
} from "../session-detail-derivation.service.js";
import { sessionRunCi } from "./session-run-ci.js";

const SESSION_DATE = "2026-10-29T09:59:00.000Z";
const TURN_STARTS = [
	"2026-10-29T10:00:00.123456Z",
	"2026-10-29T10:05:00Z",
	"2026-10-29T10:10:00.999Z",
];

const line = (value: unknown) => JSON.stringify(value);

const later = (iso: string, seconds: number) =>
	new Date(Date.parse(iso) + seconds * 1000).toISOString();

function transcript(): string {
	return TURN_STARTS.flatMap((start, turn) => [
		line({
			message: { content: `Ship change ${turn}`, role: "user" },
			sessionId: "session-1",
			timestamp: start,
			type: "user",
			uuid: `user-${turn}`,
		}),
		line({
			message: {
				content: [
					{
						id: `push-${turn}`,
						input: { command: "git push" },
						name: "Bash",
						type: "tool_use",
					},
				],
				id: `message-${turn}-1`,
				model: "claude-opus-4-1",
				role: "assistant",
				usage: { input_tokens: 10, output_tokens: 5 },
			},
			sessionId: "session-1",
			timestamp: later(start, 2),
			type: "assistant",
			uuid: `assistant-${turn}-1`,
		}),
		line({
			message: {
				content: [
					{
						content: "pushed",
						tool_use_id: `push-${turn}`,
						type: "tool_result",
					},
				],
				role: "user",
			},
			sessionId: "session-1",
			timestamp: later(start, 3),
			type: "user",
			uuid: `result-${turn}`,
		}),
		line({
			message: {
				content: [{ text: `Pushed change ${turn}.`, type: "text" }],
				id: `message-${turn}-2`,
				model: "claude-opus-4-1",
				role: "assistant",
				usage: { input_tokens: 12, output_tokens: 6 },
			},
			sessionId: "session-1",
			timestamp: later(start, 4),
			type: "assistant",
			uuid: `assistant-${turn}-2`,
		}),
	]).join("\n");
}

function snapshot(content: string): SessionDetailRawSnapshot {
	return {
		content,
		durationMinutes: 11,
		gitBranch: null,
		gitRemote: "",
		gitSha: null,
		inputTokens: 0,
		lastInteractionDate: later(TURN_STARTS.at(-1) as string, 4),
		modelUsed: "claude-opus-4-1",
		organizationId: "org-1",
		outputTokens: 0,
		ownerId: "user-1",
		packageName: "",
		projectPath: "/repo",
		revision: "1",
		sessionDate: SESSION_DATE,
		sessionId: "session-1",
		skills: [],
		slashCommands: [],
		source: "claude_code",
		subagents: {},
		totalTokens: 0,
	};
}

function runStartsOf(content: string): Map<number, number> {
	const first = new Map<
		number,
		{ blockIdx: number; recordIdx: number; ts: string }
	>();
	for (const record of splitSessionTranscript({
		content,
		sessionDate: SESSION_DATE,
		source: "claude_code",
	})) {
		if (record.agentId !== "" || record.turnIdx < 1) continue;
		const seen = first.get(record.turnIdx);
		if (
			!seen ||
			record.recordIdx < seen.recordIdx ||
			(record.recordIdx === seen.recordIdx && record.blockIdx < seen.blockIdx)
		)
			first.set(record.turnIdx, record);
	}
	return new Map(
		[...first].map(([turnIdx, record]) => [turnIdx, Date.parse(record.ts)]),
	);
}

function linkRowsOf(runStarts: ReadonlyMap<number, number>) {
	return [...runStarts].map(([turnIdx, startedMs]) => ({
		agent_id: "",
		turn_idx: turnIdx,
		started_ms: String(startedMs),
		ended_ms: String(startedMs + 60_000),
		ci_run_id: `1/actions_run/${turnIdx}/1`,
		repository_id: "1",
		github_run_id: String(turnIdx),
		attempt: 1,
		workflow_name: "CI",
		event: "push",
		head_branch: "main",
		head_sha: `sha-${turnIdx}`,
		conclusion: "success",
		created_ms: String(startedMs + 10_000),
		exact_relations: ["commit_pushed"],
		window_relations: [],
		pr_nodes: [],
	}));
}

function executorOf(links: readonly Record<string, unknown>[]) {
	return {
		async close() {},
		async execute() {},
		async insert() {},
		async query<T>(statement: ClickHouseStatement) {
			return (
				statement.query.includes("rudel.github_ci_jobs") ? [] : links
			) as T[];
		},
	} satisfies ClickHouseExecutor;
}

describe("a turn's CI, found by the start its run and its turn share", () => {
	test("a run's start reads back as the key it was written from", () => {
		for (const ms of [0, 1_761_732_000_123, Date.parse(TURN_STARTS[0] ?? "")])
			expect(runCiStartKey(runCiStartedAt(ms))).toBe(ms);
		expect(runCiStartKey(null)).toBeNull();
		expect(runCiStartKey("not a time")).toBeNull();
	});

	test("each turn of a transcript gets the CI of the run it began", async () => {
		const content = transcript();
		const { turnSummaries } = deriveSessionDetail(snapshot(content));
		const runStarts = runStartsOf(content);
		expect(runStarts.size).toBe(TURN_STARTS.length);
		const answer = await sessionRunCi(
			{
				executor: executorOf(linkRowsOf(runStarts)),
				enabled: async () => true,
				repositories: async () => [
					{ fullName: "opalinehq/athena", repositoryId: "1" },
				],
			},
			{ member: null, workspaceId: "org-1" },
			"session-1",
		);
		const byStart = runCiByTurnStart(answer.runs);
		expect(
			turnSummaries.map((turn) => [
				turn.startedAt,
				turnRunCi(byStart, turn).map((ci) => ci.githubRunId),
			]),
		).toEqual(TURN_STARTS.map((start, index) => [start, [String(index + 1)]]));
	});
});
