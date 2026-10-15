import type {
	AgentRun,
	AgentRuns,
	AgentRunsFilter,
	RunQuestion,
} from "@rudel/api-routes";
import { RUN_QUESTION_ANSWERS_TABLE } from "@rudel/ch-schema/run-question-answers";
import { z } from "zod";
import { getSafeClickHouseTable } from "../../clickhouse.js";
import { committedBuildSql } from "../analysis/run-index-reader.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "../analysis/sql.js";
import { RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";
import {
	readSessionAnswers,
	type SessionAnswersEnv,
	type SessionAnswersScope,
} from "./session-answers.js";

/**
 * The Agent traces page: every run of the sessions' committed run index
 * builds that started in a date range, newest first, each with the newest
 * answer per question (CONTEXT.md "Run question"). A filter keeps the runs
 * whose answer to one question lies in a probability range, so a run with
 * no answer to a filtered question is left out. Where the workspace's runs
 * are not answered (`mayAnswer`), the runs are listed without answers and
 * filters are ignored.
 */

export interface AgentRunsEnv extends Pick<SessionAnswersEnv, "executor"> {
	mayAnswer(workspaceId: string): Promise<boolean>;
	/** The questions answered now, to filter and name answers by. */
	onQuestions(): Promise<Pick<RunQuestion, "id" | "question" | "label">[]>;
}

export interface AgentRunsRequest {
	readonly startDate: string;
	readonly endDate: string;
	readonly filters: readonly AgentRunsFilter[];
	readonly limit: number;
	readonly cursor?: string;
}

export class InvalidAgentRunsCursorError extends Error {}

export async function listAgentRuns(
	env: AgentRunsEnv,
	scope: SessionAnswersScope,
	request: AgentRunsRequest,
): Promise<AgentRuns> {
	const enabled = await env.mayAnswer(scope.workspaceId);
	const cursor =
		request.cursor === undefined ? null : parseCursor(request.cursor);
	const [rows, questions] = await Promise.all([
		readRuns(env, scope, request, enabled ? request.filters : [], cursor),
		enabled ? env.onQuestions() : Promise.resolve([]),
	]);
	const page = rows.slice(0, request.limit);
	const answers = enabled
		? await readSessionAnswers(
				env,
				scope,
				page.map((row) => row.session_id),
			)
		: [];
	const byRun = new Map<string, AgentRun["answers"]>();
	for (const answer of answers) {
		const key = runKey(answer.sessionId, answer.agentId, answer.turn);
		byRun.set(key, [
			...(byRun.get(key) ?? []),
			{ id: answer.questionId, probability: answer.probability },
		]);
	}
	const last = page.at(-1);
	return {
		enabled,
		questions: questions.map(({ id, question, label }) => ({
			id,
			question,
			label,
		})),
		runs: page.map((row) => ({
			sessionId: row.session_id,
			userId: row.user_id,
			agentId: row.agent_id,
			turn: row.turn_idx,
			startedAt: new Date(row.started_ms).toISOString(),
			endedAt: new Date(row.ended_ms).toISOString(),
			source: row.source,
			model: row.model || null,
			prompt: row.prompt_head,
			minutes: row.minutes,
			costUsd: row.cost_usd,
			toolCalls: row.tool_calls,
			failedCalls: row.failed_calls,
			repository: row.repository,
			answers: (
				byRun.get(runKey(row.session_id, row.agent_id, row.turn_idx)) ?? []
			).sort(
				(a, b) => b.probability - a.probability || a.id.localeCompare(b.id),
			),
		})),
		nextCursor:
			rows.length > request.limit && last
				? JSON.stringify([
						last.started_ms,
						last.session_id,
						last.agent_id,
						last.turn_idx,
					])
				: null,
	};
}

/** One page of runs (and one more, to tell whether another page follows). */
function readRuns(
	env: Pick<AgentRunsEnv, "executor">,
	scope: SessionAnswersScope,
	request: AgentRunsRequest,
	filters: readonly AgentRunsFilter[],
	cursor: Cursor | null,
) {
	const answers = getSafeClickHouseTable(RUN_QUESTION_ANSWERS_TABLE);
	const runs = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const owner = `organization_id = {workspaceId:String}${
		scope.member === null ? "" : " AND user_id = {member:String}"
	}`;
	// The newest answer per run decides, as `readSessionAnswers` keeps it.
	const filterSql = filters.map(
		(_, index) => `
				AND (user_id, session_id, agent_id, turn_idx, revision) IN (
					SELECT user_id, session_id, agent_id, turn_idx, revision
					FROM ${answers}
					WHERE ${owner} AND question_id = {question${index}:String}
					GROUP BY user_id, session_id, agent_id, turn_idx, revision
					HAVING argMax(probability, answered_at) BETWEEN {min${index}:Float64} AND {max${index}:Float64}
				)`,
	);
	const cursorSql =
		cursor === null
			? ""
			: `
				AND (toUnixTimestamp64Milli(started_at), session_id, agent_id, turn_idx)
					< ({cursorMs:Int64}, {cursorSession:String}, {cursorAgent:String}, {cursorTurn:UInt32})`;
	return query(env.executor, RunRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT user_id, session_id, agent_id, turn_idx, source,
				toUnixTimestamp64Milli(started_at) AS started_ms,
				toUnixTimestamp64Milli(ended_at) AS ended_ms,
				model, prompt_head, minutes, cost_usd, tool_calls, failed_calls, repository
			FROM ${runs} FINAL
			WHERE ${owner} AND row_kind = 'run'
				AND started_at >= toDateTime64({startDate:String}, 3, 'UTC')
				AND started_at < toDateTime64({endDate:String}, 3, 'UTC') + INTERVAL 1 DAY
				AND ${committedBuildSql(runs, owner, ["user_id", "session_id"])}${filterSql.join("")}${cursorSql}
			ORDER BY started_ms DESC, session_id DESC, agent_id DESC, turn_idx DESC
			LIMIT {limit:UInt32}`,
		query_params: {
			workspaceId: scope.workspaceId,
			...(scope.member === null ? {} : { member: scope.member }),
			startDate: request.startDate,
			endDate: request.endDate,
			limit: request.limit + 1,
			...Object.fromEntries(
				filters.flatMap((filter, index) => [
					[`question${index}`, filter.questionId],
					[`min${index}`, filter.min],
					[`max${index}`, filter.max],
				]),
			),
			...(cursor === null
				? {}
				: {
						cursorMs: cursor.startedMs,
						cursorSession: cursor.sessionId,
						cursorAgent: cursor.agentId,
						cursorTurn: cursor.turn,
					}),
		},
	});
}

interface Cursor {
	readonly startedMs: number;
	readonly sessionId: string;
	readonly agentId: string;
	readonly turn: number;
}

const CursorSchema = z.tuple([
	z.number().int().nonnegative(),
	z.string(),
	z.string(),
	z.number().int().nonnegative(),
]);

function parseCursor(cursor: string): Cursor {
	let parsed: unknown;
	try {
		parsed = JSON.parse(cursor);
	} catch {
		throw new InvalidAgentRunsCursorError("Invalid agent runs cursor.");
	}
	const result = CursorSchema.safeParse(parsed);
	if (!result.success)
		throw new InvalidAgentRunsCursorError("Invalid agent runs cursor.");
	const [startedMs, sessionId, agentId, turn] = result.data;
	return { startedMs, sessionId, agentId, turn };
}

function runKey(sessionId: string, agentId: string, turn: number): string {
	return [sessionId, agentId, turn].join("\u0000");
}

const RunRowSchema = z.object({
	user_id: z.string(),
	session_id: z.string(),
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	source: z.string(),
	started_ms: z.coerce.number(),
	ended_ms: z.coerce.number(),
	model: z.string().nullable(),
	prompt_head: z.string().nullable(),
	minutes: z.coerce.number(),
	cost_usd: z.coerce.number().nullable(),
	tool_calls: z.coerce.number(),
	failed_calls: z.coerce.number(),
	repository: z.string(),
});
