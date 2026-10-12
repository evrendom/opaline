import { RUN_QUESTION_ANSWERS_TABLE } from "@rudel/ch-schema/run-question-answers";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import {
	ANALYSIS_QUERY_SETTINGS,
	chunkByParamBytes,
	query,
} from "../analysis/sql.js";

/**
 * Run question answers in ClickHouse (`rudel.run_question_answers`), keyed by
 * workspace, question wording, run and the transcript revision the answer was
 * given for. An answer is stored once and reused by every later analysis of
 * the same transcript; once the session is uploaded again with changes, its
 * runs are answered anew. The `run_answers` sql view reads the same rows.
 */

export interface RunKey {
	readonly sessionId: string;
	readonly agentId: string;
	readonly turn: number;
}

/** A run as one transcript revision (generation) of its session has it. */
export interface RunVersion extends RunKey {
	/** The session's transcript revision, a UInt64 in decimal. */
	readonly revision: string;
}

export interface AnswerRow extends RunVersion {
	readonly workspaceId: string;
	/** The member whose session the run is. */
	readonly ownerId: string;
	readonly questionId: string;
	readonly question: string;
	readonly probability: number;
	readonly provider: string;
	/** What the provider read: the run's whole text or its compact note. */
	readonly input: "run" | "note";
	/** The model version that answered. */
	readonly model: string;
	readonly costUsd: number;
}

/** One key per run, stable across callers. */
export function runKey(run: RunKey): string {
	return JSON.stringify([run.sessionId, run.agentId, run.turn]);
}

/** One key per question and run revision. */
export function answerKey(questionId: string, run: RunVersion): string {
	return `${questionId}\u0000${runKey(run)}\u0000${run.revision}`;
}

/**
 * The probabilities a provider stored for these questions about these run
 * revisions, by `answerKey` (any model version of the provider; null reads
 * every provider's).
 */
export async function readAnswers(
	executor: ClickHouseExecutor,
	workspaceId: string,
	questionIds: readonly string[],
	runs: readonly RunVersion[],
	provider: string | null,
): Promise<Map<string, number>> {
	const answers = new Map<string, number>();
	if (questionIds.length === 0 || runs.length === 0) return answers;
	const wanted = new Set(runs.map((run) => answerKey("", run)));
	const sessions = [...new Set(runs.map((run) => run.sessionId))];
	for (const batch of chunkByParamBytes(sessions, (session) => [session]))
		for (const row of await query(executor, AnswerRowSchema, {
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
			query: `SELECT question_id, session_id, agent_id, turn_idx,
					toString(revision) AS revision, probability
				FROM ${getSafeClickHouseTable(RUN_QUESTION_ANSWERS_TABLE)} FINAL
				WHERE organization_id = {workspaceId:String}
					AND question_id IN {questionIds:Array(String)}
					AND session_id IN {sessionIds:Array(String)}${
						provider === null ? "" : " AND provider = {provider:String}"
					}
				ORDER BY answered_at`,
			query_params: {
				...(provider === null ? {} : { provider }),
				workspaceId,
				questionIds: [...questionIds],
				sessionIds: batch,
			},
		})) {
			const run = {
				sessionId: row.session_id,
				agentId: row.agent_id,
				turn: row.turn_idx,
				revision: row.revision,
			};
			if (wanted.has(answerKey("", run)))
				answers.set(answerKey(row.question_id, run), row.probability);
		}
	return answers;
}

export async function writeAnswers(
	executor: ClickHouseExecutor,
	rows: readonly AnswerRow[],
): Promise<void> {
	if (rows.length === 0) return;
	const answeredAt = new Date()
		.toISOString()
		.replace("T", " ")
		.replace("Z", "");
	await executor.insert({
		table: getSafeClickHouseTable(RUN_QUESTION_ANSWERS_TABLE),
		asyncInsert: false,
		values: rows.map((row) => ({
			organization_id: row.workspaceId,
			user_id: row.ownerId,
			session_id: row.sessionId,
			agent_id: row.agentId,
			turn_idx: row.turn,
			revision: row.revision,
			question_id: row.questionId,
			question: row.question,
			probability: row.probability,
			provider: row.provider,
			input: row.input,
			model: row.model,
			cost_usd: row.costUsd,
			answered_at: answeredAt,
		})),
	});
}

const AnswerRowSchema = z.object({
	question_id: z.string(),
	session_id: z.string(),
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	revision: z.string(),
	probability: z.coerce.number(),
});
