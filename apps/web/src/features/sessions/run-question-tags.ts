import {
	RUN_QUESTION_YES_PROBABILITY,
	type SessionRunAnswersRun,
} from "@rudel/api-routes";

// Run question answers as tags (CONTEXT.md "Run question"): a question
// answered yes about a run is a tag on that run in the reader and on its
// session in the sessions list. Shown only where the workspace's runs are
// answered; the API says so with `enabled`.

/** One question answered about a run, as the reader shows it. */
export type RunQuestionAnswer = SessionRunAnswersRun["questions"][number];

/** Characters of a wording shown as a tag when the question has no label. */
export const RUN_QUESTION_TAG_LABEL_CHARS = 48;

export function isRunQuestionYes(probability: number): boolean {
	return probability >= RUN_QUESTION_YES_PROBABILITY;
}

/** The tag's text: the catalogue's short label, else the wording cut at a word. */
export function runQuestionTagLabel(question: {
	label: string | null;
	question: string;
}): string {
	const label = question.label?.trim();
	if (label) return label;
	const wording = question.question.trim().replace(/[.?!]+$/u, "");
	if (wording.length <= RUN_QUESTION_TAG_LABEL_CHARS) return wording;
	const head = wording.slice(0, RUN_QUESTION_TAG_LABEL_CHARS);
	const cut = head.lastIndexOf(" ");
	return `${(cut > RUN_QUESTION_TAG_LABEL_CHARS / 2 ? head.slice(0, cut) : head).replace(/[,;:(]+$/u, "")}…`;
}

/** "82% yes", for a tag's title. */
export function formatRunQuestionProbability(probability: number): string {
	return `${Math.round(probability * 100)}% yes`;
}

/** The tag's title: the wording and how sure the answer is. */
export function runQuestionTagTitle(question: {
	question: string;
	probability: number;
}): string {
	return `${question.question} · ${formatRunQuestionProbability(question.probability)}`;
}

/**
 * The questions answered yes about each of the reader's turns, by turn id.
 * A run of the main transcript is the reader's turn that starts at the same
 * record, so they are matched by the prompt's time; a turn that starts with
 * no prompt, or a run whose prompt the reader did not take as one, has no
 * tags. Subagent runs belong to no turn here.
 */
export function matchRunAnswersToTurns(
	runs: readonly SessionRunAnswersRun[],
	turns: readonly { turnId: string; startedAt: string | null }[],
): ReadonlyMap<string, readonly RunQuestionAnswer[]> {
	const byStart = new Map<number, string>();
	for (const turn of turns) {
		const at =
			turn.startedAt === null ? Number.NaN : Date.parse(turn.startedAt);
		if (!Number.isNaN(at) && !byStart.has(at)) byStart.set(at, turn.turnId);
	}
	const questions = new Map<string, RunQuestionAnswer[]>();
	for (const run of runs) {
		if (run.agentId !== "") continue;
		const turnId = byStart.get(Date.parse(run.startedAt));
		if (turnId === undefined) continue;
		const yes = run.questions.filter((question) =>
			isRunQuestionYes(question.probability),
		);
		if (yes.length === 0) continue;
		questions.set(turnId, [...(questions.get(turnId) ?? []), ...yes]);
	}
	return questions;
}
