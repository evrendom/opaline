import type postgres from "postgres";
import { z } from "zod";
import {
	addRunQuestion,
	listRunQuestions,
	RunQuestionError,
	turnOnRunQuestion,
} from "./catalogue.js";

/**
 * Adds run questions from a file (`run-questions:add`), through the
 * catalogue the internal form uses: each is added as a draft (or turned on
 * with `turnOn`), and a question whose wording is already in the catalogue
 * (not retired) is not added again (a draft of it is turned on with
 * `turnOn`). The catalogue keeps no key, so the wording is
 * a question's identity and `key` only labels it in the output.
 */

export const QuestionFileSchema = z.array(
	z.object({
		key: z.string().trim().min(1),
		instructions: z.string().trim().min(1),
		criteria: z
			.object({
				true: z.string().trim().min(1),
				false: z.string().trim().min(1),
			})
			.optional(),
	}),
);

export type QuestionFileEntry = z.infer<typeof QuestionFileSchema>[number];

export interface ImportedQuestion {
	readonly key: string;
	/** Null when it could not be added. */
	readonly id: string | null;
	/**
	 * added: new; exists: the same wording and criteria were there already;
	 * conflict: the wording is there with other criteria (edit it in the form);
	 * refused: the catalogue refused it (`error` says why).
	 */
	readonly status: "added" | "exists" | "conflict" | "refused";
	readonly state: "draft" | "on" | "retired" | null;
	readonly error?: string;
}

/** Parses the file's JSON, or says what is wrong with it. */
export function parseQuestionFile(text: string): QuestionFileEntry[] {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`The file is not JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const parsed = QuestionFileSchema.safeParse(json);
	if (!parsed.success)
		throw new Error(
			`Expected [{"key": "...", "instructions": "...", "criteria"?: {"true": "...", "false": "..."}}]: ${parsed.error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("; ")}`,
		);
	const keys = new Set<string>();
	for (const entry of parsed.data) {
		if (keys.has(entry.key))
			throw new Error(`The key ${entry.key} is listed twice.`);
		keys.add(entry.key);
	}
	return parsed.data;
}

export async function importRunQuestions(
	sql: postgres.Sql,
	entries: readonly QuestionFileEntry[],
	options: { turnOn: boolean },
): Promise<ImportedQuestion[]> {
	const live = new Map(
		(await listRunQuestions(sql))
			.filter((question) => question.state !== "retired")
			.map((question) => [question.question, question]),
	);
	const imported: ImportedQuestion[] = [];
	for (const entry of entries) {
		const existing = live.get(entry.instructions);
		if (existing) {
			const same =
				existing.criteria?.true === entry.criteria?.true &&
				existing.criteria?.false === entry.criteria?.false;
			// Left as it is, except that a draft is turned on when asked to.
			const state =
				same && options.turnOn && existing.state === "draft"
					? (await turnOnRunQuestion(sql, existing.id)).state
					: existing.state;
			imported.push({
				key: entry.key,
				id: existing.id,
				status: same ? "exists" : "conflict",
				state,
			});
			continue;
		}
		try {
			const added = await addRunQuestion(
				sql,
				entry.instructions,
				entry.criteria ?? null,
			);
			const question = options.turnOn
				? await turnOnRunQuestion(sql, added.id)
				: added;
			live.set(question.question, question);
			imported.push({
				key: entry.key,
				id: question.id,
				status: "added",
				state: question.state,
			});
		} catch (error) {
			if (!(error instanceof RunQuestionError)) throw error;
			imported.push({
				key: entry.key,
				id: null,
				status: "refused",
				state: null,
				error: error.message,
			});
		}
	}
	return imported;
}
