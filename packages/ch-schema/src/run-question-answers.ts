/**
 * Run question answers (CONTEXT.md "Run question"; docs/retro-architecture.md
 * "Run questions"): the probability of yes for one run question about one
 * run, keyed by workspace, question, run, the transcript revision the answer
 * was given for (so an answer never outlives the transcript it read) and the
 * provider and model version that gave it (so providers can be compared). A question id is one wording, so
 * a reworded question's answers stay under the wording they answered. Never
 * part of L1 (ADR 0005): an interpretation, read through its own view. Without
 * the schema toolkit, so the API imports it at runtime
 * (`@rudel/ch-schema/run-question-answers`).
 */

export const RUN_QUESTION_ANSWERS_TABLE = "rudel.run_question_answers";

export interface RunQuestionAnswerColumn {
	readonly name: string;
	readonly type: string;
	readonly comment: string;
}

export const RUN_QUESTION_ANSWER_COLUMNS = [
	{
		name: "organization_id",
		type: "String",
		comment: "Owning workspace ID; tenant boundary.",
	},
	{
		name: "user_id",
		type: "String",
		comment: "The member who uploaded the session the run belongs to.",
	},
	{
		name: "session_id",
		type: "String",
		comment: "Session of the run.",
	},
	{
		name: "agent_id",
		type: "String",
		comment:
			"Stream of the run: empty for the main transcript, else the subagent.",
	},
	{
		name: "turn_idx",
		type: "UInt32",
		comment: "The run within its stream, as in runs.turn_idx.",
	},
	{
		name: "revision",
		type: "UInt64",
		comment:
			"Transcript revision (generation) of the session the answer was given for; run_answers shows an answer only while its session is committed at this revision.",
	},
	{
		name: "question_id",
		type: "String",
		comment: "The run question, one wording; a reworded question has a new id.",
	},
	{
		name: "question",
		type: "String",
		comment: "The wording the answer answered.",
	},
	{
		name: "probability",
		type: "Float32",
		comment: "Probability (0 to 1) that the answer to the question is yes.",
	},
	{
		name: "provider",
		type: "LowCardinality(String)",
		comment:
			"Who answered: the provider as configured (e.g. subq, jev, subq:run for whole runs); part of the key, so providers can answer the same question side by side.",
	},
	{
		name: "input",
		type: "LowCardinality(String)",
		comment:
			"What the provider read: run (the run's whole text, secret-filtered) or note (the compact run note, sent when the run is larger than the provider takes or the provider reads notes).",
	},
	{
		name: "model",
		type: "LowCardinality(String)",
		comment: "The model version that answered, as the provider reported it.",
	},
	{
		name: "cost_usd",
		type: "Float64",
		comment:
			"What the answer cost: its share of the call that answered every question about the run.",
	},
	{
		name: "answered_at",
		type: "DateTime64(3, 'UTC')",
		comment: "UTC time the answer was stored.",
	},
] as const satisfies readonly RunQuestionAnswerColumn[];

export const RUN_QUESTION_ANSWERS_ORDER_BY = [
	"organization_id",
	"question_id",
	"session_id",
	"agent_id",
	"turn_idx",
	"revision",
	"provider",
	"model",
] as const;
