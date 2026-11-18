import { randomBytes } from "node:crypto";
import type { RunQuestion, RunQuestionCriteria } from "@rudel/api-routes";
import type postgres from "postgres";
import { recordedFact } from "./l1-facts.js";

/**
 * The run question catalogue (CONTEXT.md "Run question"), managed only by
 * Opaline in its internal form. A row is one wording with its optional
 * criteria (what a yes and a no look like): changing either retires the row
 * and adds a draft that replaces it, so answers stored under the old id keep
 * the old wording. Agents may ask only questions that are on.
 */

export type RunQuestionErrorCode =
	| "NOT_FOUND"
	| "BAD_REQUEST"
	| "CONFLICT"
	| "FORBIDDEN";

/** A refusal the form or the agent can act on; its message says what to do. */
export class RunQuestionError extends Error {
	constructor(
		readonly code: RunQuestionErrorCode,
		message: string,
	) {
		super(message);
	}
}

interface QuestionRow {
	id: string;
	question: string;
	label: string | null;
	criteria_true: string | null;
	criteria_false: string | null;
	state: RunQuestion["state"];
	replaces: string | null;
	tested_runs: number | null;
	tested_precision: number | null;
	tested_provider: string | null;
	/** A string through the API's client: drizzle replaces its date parsers. */
	created_at: Date | string;
}

export async function listRunQuestions(
	sql: postgres.Sql,
): Promise<RunQuestion[]> {
	const rows = await sql<QuestionRow[]>`
		SELECT id, question, label, criteria_true, criteria_false, state, replaces, tested_runs, tested_precision, tested_provider, created_at
		FROM run_question
		ORDER BY (state = 'retired'), created_at DESC, id
	`;
	return rows.map(toQuestion);
}

/** The questions agents may ask, with their tested precision, for `schema`. */
export async function listOnRunQuestions(
	sql: postgres.Sql,
): Promise<
	Pick<
		RunQuestion,
		"id" | "question" | "testedRuns" | "testedPrecision" | "testedProvider"
	>[]
> {
	const rows = await sql<QuestionRow[]>`
		SELECT id, question, label, criteria_true, criteria_false, state, replaces, tested_runs, tested_precision, tested_provider, created_at
		FROM run_question WHERE state = 'on'
		ORDER BY created_at DESC, id
	`;
	return rows
		.map(toQuestion)
		.map(({ id, question, testedRuns, testedPrecision, testedProvider }) => ({
			id,
			question,
			testedRuns,
			testedPrecision,
			testedProvider,
		}));
}

/** Adds a draft; a question about a fact L1 records exactly is refused. */
export async function addRunQuestion(
	sql: postgres.Sql,
	wording: string,
	criteria: RunQuestionCriteria | null = null,
	replaces: string | null = null,
	label: string | null = null,
): Promise<RunQuestion> {
	const question = wording.trim();
	const fact = recordedFact(question);
	if (fact)
		throw new RunQuestionError(
			"BAD_REQUEST",
			`L1 already records this exactly (${fact}); query it with sql instead of asking a model.`,
		);
	try {
		const [row] = await sql<QuestionRow[]>`
			INSERT INTO run_question (id, question, label, criteria_true, criteria_false, replaces)
			VALUES (
				${newQuestionId()}, ${question}, ${label?.trim() || null},
				${criteria?.true.trim() ?? null}, ${criteria?.false.trim() ?? null}, ${replaces}
			)
			RETURNING id, question, label, criteria_true, criteria_false, state, replaces, tested_runs, tested_precision, tested_provider, created_at
		`;
		return toQuestion(required(row));
	} catch (error) {
		if (isUniqueViolation(error))
			throw new RunQuestionError(
				"CONFLICT",
				"A question with this wording already exists.",
			);
		throw error;
	}
}

/**
 * A new wording or new criteria make a new question: the old one is retired
 * (its answers keep their wording) and a draft replaces it, to be tested and
 * turned on again. The label is not part of the wording: a new label alone
 * changes the question in place, and a reworded question keeps its label.
 */
export async function editRunQuestion(
	sql: postgres.Sql,
	id: string,
	wording: string,
	criteria: RunQuestionCriteria | null = null,
	label: string | null = null,
): Promise<RunQuestion> {
	return sql.begin(async (transaction) => {
		// postgres-js types a transaction without the tagged-template call
		// signature (`Omit<Sql, ...>`); at runtime it is one.
		const tx = transaction as unknown as postgres.Sql;
		const current = await liveQuestion(tx, id);
		const nextLabel = label?.trim() || null;
		if (
			current.question === wording.trim() &&
			current.criteria?.true === criteria?.true.trim() &&
			current.criteria?.false === criteria?.false.trim()
		) {
			if (current.label === nextLabel)
				throw new RunQuestionError(
					"BAD_REQUEST",
					"The wording, criteria and label are unchanged.",
				);
			const [row] = await tx<QuestionRow[]>`
				UPDATE run_question SET label = ${nextLabel} WHERE id = ${id}
				RETURNING id, question, label, criteria_true, criteria_false, state, replaces, tested_runs, tested_precision, tested_provider, created_at
			`;
			return toQuestion(required(row));
		}
		await retire(tx, id);
		return addRunQuestion(tx, wording, criteria, id, nextLabel);
	});
}

export async function removeRunQuestion(
	sql: postgres.Sql,
	id: string,
): Promise<RunQuestion> {
	await liveQuestion(sql, id);
	return toQuestion(required(await retire(sql, id)));
}

/** Turns a draft on, so agents may ask it. */
export async function turnOnRunQuestion(
	sql: postgres.Sql,
	id: string,
): Promise<RunQuestion> {
	await liveQuestion(sql, id);
	const [row] = await sql<QuestionRow[]>`
		UPDATE run_question SET state = 'on' WHERE id = ${id}
		RETURNING id, question, label, criteria_true, criteria_false, state, replaces, tested_runs, tested_precision, tested_provider, created_at
	`;
	return toQuestion(required(row));
}

/** Stores the precision the operator's verdicts on a provider's test gave. */
export async function recordTestedPrecision(
	sql: postgres.Sql,
	id: string,
	tested: { runs: number; precision: number | null; provider: string | null },
): Promise<RunQuestion> {
	await liveQuestion(sql, id);
	const [row] = await sql<QuestionRow[]>`
		UPDATE run_question SET tested_runs = ${tested.runs}, tested_precision = ${tested.precision},
			tested_provider = ${tested.provider}
		WHERE id = ${id}
		RETURNING id, question, label, criteria_true, criteria_false, state, replaces, tested_runs, tested_precision, tested_provider, created_at
	`;
	return toQuestion(required(row));
}

/** Questions by id with their state, in the order asked; unknown ids are left out. */
export async function findRunQuestions(
	sql: postgres.Sql,
	ids: readonly string[],
): Promise<RunQuestion[]> {
	if (ids.length === 0) return [];
	const rows = await sql<QuestionRow[]>`
		SELECT id, question, label, criteria_true, criteria_false, state, replaces, tested_runs, tested_precision, tested_provider, created_at
		FROM run_question WHERE id = ANY(${[...ids]}::text[])
	`;
	const byId = new Map(rows.map((row) => [row.id, toQuestion(row)]));
	return ids.flatMap((id) => byId.get(id) ?? []);
}

/** A question that is not retired, or why it cannot be changed. */
export async function liveQuestion(
	sql: postgres.Sql,
	id: string,
): Promise<RunQuestion> {
	const [question] = await findRunQuestions(sql, [id]);
	if (!question)
		throw new RunQuestionError("NOT_FOUND", `No run question ${id}.`);
	if (question.state === "retired")
		throw new RunQuestionError(
			"BAD_REQUEST",
			`Run question ${id} was removed or reworded; its answers stay, but it cannot change.`,
		);
	return question;
}

async function retire(
	sql: postgres.Sql,
	id: string,
): Promise<QuestionRow | undefined> {
	const [row] = await sql<QuestionRow[]>`
		UPDATE run_question SET state = 'retired', retired_at = now() WHERE id = ${id}
		RETURNING id, question, label, criteria_true, criteria_false, state, replaces, tested_runs, tested_precision, tested_provider, created_at
	`;
	return row;
}

function toQuestion(row: QuestionRow): RunQuestion {
	return {
		id: row.id,
		question: row.question,
		label: row.label,
		criteria:
			row.criteria_true !== null && row.criteria_false !== null
				? { true: row.criteria_true, false: row.criteria_false }
				: null,
		state: row.state,
		replaces: row.replaces,
		testedRuns: row.tested_runs,
		testedPrecision: row.tested_precision,
		testedProvider: row.tested_provider,
		createdAt: new Date(row.created_at).toISOString(),
	};
}

function required<T>(row: T | undefined): T {
	if (row === undefined) throw new RunQuestionError("NOT_FOUND", "Not found.");
	return row;
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "23505"
	);
}

function newQuestionId(): string {
	return `rq_${randomBytes(9).toString("base64url")}`;
}
