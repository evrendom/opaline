import {
	RUN_QUESTION_YES_PROBABILITY,
	type SessionRunAnswers,
	type SessionRunAnswersRun,
	type SessionRunQuestionTag,
	type SessionRunQuestionTags,
} from "@rudel/api-routes";
import { RUN_QUESTION_ANSWERS_TABLE } from "@rudel/ch-schema/run-question-answers";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { committedBuildSql } from "../analysis/run-index-reader.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "../analysis/sql.js";
import { RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";

/**
 * Run question answers as the dashboard shows them (CONTEXT.md "Run
 * question"): the questions answered yes about a session's runs, as tags on
 * the sessions list, and every answer per run for the reader. Only a
 * workspace whose runs are answered and that is on the tags rollout
 * (`mayAnswer`; env.ts) gets anything; elsewhere nothing is read. Like the
 * `run_answers` sql view, an answer shows only for the transcript revision
 * each session is committed at, and the newest answer per question and run
 * wins where two providers answered.
 */

export interface SessionAnswersEnv {
	readonly executor: ClickHouseExecutor;
	/** Whether the workspace's runs are answered and the dashboard may show them (env.ts). */
	mayAnswer(workspaceId: string): Promise<boolean>;
	/** The short names of these questions from the catalogue, by id; a question without one maps to null. */
	labelsOf(
		questionIds: readonly string[],
	): Promise<ReadonlyMap<string, string | null>>;
}

export interface SessionAnswersScope {
	readonly workspaceId: string;
	/** The one member whose sessions may be read, or null for every member's. */
	readonly member: string | null;
}

/** One stored answer about one run of a session's committed transcript. */
export interface StoredRunAnswer {
	readonly sessionId: string;
	readonly agentId: string;
	readonly turn: number;
	/** ISO time of the run's first record, its prompt. */
	readonly startedAt: string;
	readonly questionId: string;
	readonly question: string;
	readonly probability: number;
}

/** The questions answered yes about each session's runs, for the sessions list. */
export async function sessionRunQuestionTags(
	env: SessionAnswersEnv,
	scope: SessionAnswersScope,
	sessionIds: readonly string[],
): Promise<SessionRunQuestionTags> {
	if (!(await env.mayAnswer(scope.workspaceId)))
		return { enabled: false, sessions: [] };
	const answers = (await readSessionAnswers(env, scope, sessionIds)).filter(
		(answer) => answer.probability >= RUN_QUESTION_YES_PROBABILITY,
	);
	const labels = await labelsFor(env, answers);
	const sessions = new Map<string, Map<string, SessionRunQuestionTag>>();
	for (const answer of answers) {
		const questions =
			sessions.get(answer.sessionId) ??
			new Map<string, SessionRunQuestionTag>();
		sessions.set(answer.sessionId, questions);
		const tag = questions.get(answer.questionId);
		questions.set(answer.questionId, {
			id: answer.questionId,
			question: answer.question,
			label: labels.get(answer.questionId) ?? null,
			runs: (tag?.runs ?? 0) + 1,
			probability: Math.max(tag?.probability ?? 0, answer.probability),
		});
	}
	return {
		enabled: true,
		sessions: [...sessions].map(([sessionId, questions]) => ({
			sessionId,
			questions: [...questions.values()].sort(
				(a, b) => b.runs - a.runs || b.probability - a.probability,
			),
		})),
	};
}

/**
 * Every answer about each run of one session, for the reader. The workspace
 * gate and `readMember`, the caller's access check that names the member whose
 * session it is (and throws where the caller may not open it), run together;
 * in a workspace whose runs are not answered its outcome is ignored.
 */
export async function sessionRunAnswers(
	env: SessionAnswersEnv,
	workspaceId: string,
	readMember: () => Promise<string | null>,
	sessionId: string,
): Promise<SessionRunAnswers> {
	const [answered, member] = await Promise.allSettled([
		env.mayAnswer(workspaceId),
		readMember(),
	]);
	if (answered.status === "rejected") throw answered.reason;
	if (!answered.value) return { enabled: false, runs: [] };
	if (member.status === "rejected") throw member.reason;
	const answers = await readSessionAnswers(
		env,
		{ workspaceId, member: member.value },
		[sessionId],
	);
	const labels = await labelsFor(env, answers);
	const runs = new Map<string, SessionRunAnswersRun>();
	for (const answer of answers) {
		const key = `${answer.agentId}\u0000${answer.turn}`;
		const run = runs.get(key) ?? {
			agentId: answer.agentId,
			turn: answer.turn,
			startedAt: answer.startedAt,
			questions: [],
		};
		runs.set(key, run);
		run.questions.push({
			id: answer.questionId,
			question: answer.question,
			label: labels.get(answer.questionId) ?? null,
			probability: answer.probability,
		});
	}
	return {
		enabled: true,
		runs: [...runs.values()]
			.map((run) => ({
				...run,
				questions: run.questions.sort(
					(a, b) => b.probability - a.probability || a.id.localeCompare(b.id),
				),
			}))
			.sort((a, b) => a.agentId.localeCompare(b.agentId) || a.turn - b.turn),
	};
}

/**
 * The newest answer per question and run of these sessions, from the
 * sessions the reader may read, for the runs of each session's committed
 * build only.
 */
export async function readSessionAnswers(
	env: Pick<SessionAnswersEnv, "executor">,
	scope: SessionAnswersScope,
	sessionIds: readonly string[],
): Promise<StoredRunAnswer[]> {
	if (sessionIds.length === 0) return [];
	const answers = getSafeClickHouseTable(RUN_QUESTION_ANSWERS_TABLE);
	const runs = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const owner = `organization_id = {workspaceId:String} AND session_id IN {sessionIds:Array(String)}${
		scope.member === null ? "" : " AND user_id = {member:String}"
	}`;
	const rows = await query(env.executor, AnswerRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT a.session_id AS session_id, a.agent_id AS agent_id, a.turn_idx AS turn_idx,
				toUnixTimestamp64Milli(r.started_at) AS started_ms,
				a.question_id AS question_id, a.question AS question, a.probability AS probability
			FROM (
				SELECT user_id, session_id, agent_id, turn_idx, revision,
					question_id, question, probability, answered_at
				FROM ${answers} FINAL
				WHERE ${owner}
			) AS a
			INNER JOIN (
				SELECT user_id, session_id, agent_id, turn_idx, revision, started_at
				FROM ${runs} FINAL
				WHERE ${owner} AND row_kind = 'run'
					AND ${committedBuildSql(runs, owner, ["user_id", "session_id"])}
			) AS r
				ON r.user_id = a.user_id AND r.session_id = a.session_id
					AND r.agent_id = a.agent_id AND r.turn_idx = a.turn_idx
					AND r.revision = a.revision
			ORDER BY a.answered_at`,
		query_params: {
			workspaceId: scope.workspaceId,
			sessionIds: [...new Set(sessionIds)],
			...(scope.member === null ? {} : { member: scope.member }),
		},
	});
	// Ordered by answered_at, so the newest answer per key is stored last.
	const newest = new Map<string, StoredRunAnswer>();
	for (const row of rows)
		newest.set(
			[row.session_id, row.agent_id, row.turn_idx, row.question_id].join(
				"\u0000",
			),
			{
				sessionId: row.session_id,
				agentId: row.agent_id,
				turn: row.turn_idx,
				startedAt: new Date(row.started_ms).toISOString(),
				questionId: row.question_id,
				question: row.question,
				probability: row.probability,
			},
		);
	return [...newest.values()];
}

async function labelsFor(
	env: Pick<SessionAnswersEnv, "labelsOf">,
	answers: readonly StoredRunAnswer[],
): Promise<ReadonlyMap<string, string | null>> {
	const ids = [...new Set(answers.map((answer) => answer.questionId))];
	return ids.length === 0 ? new Map() : env.labelsOf(ids);
}

const AnswerRowSchema = z.object({
	session_id: z.string(),
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	started_ms: z.coerce.number(),
	question_id: z.string(),
	question: z.string(),
	probability: z.coerce.number(),
});
