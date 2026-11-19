import { schema, table } from "@chkit/core";
import {
	RUN_QUESTION_ANSWER_COLUMNS,
	RUN_QUESTION_ANSWERS_ORDER_BY,
} from "../../run-question-answers.js";

/**
 * `run_question_answers` (CONTEXT.md "Run question"): one row per answer, the
 * probability of yes for one question wording about one run. Written only by
 * the API's run question worker after it checks no answer is stored for the
 * same key; a retried write can store the same key twice, so readers keep the
 * newest row per key. Kept until the account or workspace purge deletes it.
 */
export const runQuestionAnswersTable = table({
	database: "rudel",
	name: "run_question_answers",
	engine: "SharedReplacingMergeTree(answered_at)",
	columns: RUN_QUESTION_ANSWER_COLUMNS.map(({ name, type, comment }) => ({
		name,
		type,
		comment,
	})),
	primaryKey: [...RUN_QUESTION_ANSWERS_ORDER_BY],
	orderBy: [...RUN_QUESTION_ANSWERS_ORDER_BY],
	settings: {
		index_granularity: "8192",
		storage_policy: "'s3'",
	},
	comment:
		"Run question answers: the probability of yes per question wording and run; written only by the API's run question worker.",
});

export default schema(runQuestionAnswersTable);
