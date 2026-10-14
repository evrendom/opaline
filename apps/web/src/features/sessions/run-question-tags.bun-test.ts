import { describe, expect, test } from "bun:test";
import {
	formatRunQuestionProbability,
	matchRunAnswersToTurns,
	runQuestionTagLabel,
	runQuestionTagTitle,
} from "./run-question-tags";

describe("runQuestionTagLabel", () => {
	test("shows the catalogue's label when the question has one", () => {
		expect(
			runQuestionTagLabel({ label: " Hunted for files ", question: "x" }),
		).toBe("Hunted for files");
	});

	test("shows a short wording whole, without its question mark", () => {
		expect(
			runQuestionTagLabel({
				label: null,
				question: "Did the agent hunt for files?",
			}),
		).toBe("Did the agent hunt for files");
	});

	test("cuts a long wording at a word, dropping a dangling comma", () => {
		expect(
			runQuestionTagLabel({
				label: null,
				question:
					"The agent followed an instruction, doc or skill that turned out to be wrong or out of date for this codebase.",
			}),
		).toBe("The agent followed an instruction, doc or skill…");
		expect(
			runQuestionTagLabel({
				label: "",
				question:
					"The agent said the work was done or working, but the next prompt shows it was not.",
			}),
		).toBe("The agent said the work was done or working…");
	});
});

describe("runQuestionTagTitle", () => {
	test("names the wording and how sure the answer is", () => {
		expect(formatRunQuestionProbability(0.816)).toBe("82% yes");
		expect(
			runQuestionTagTitle({
				question: "Did the agent hunt for files?",
				probability: 0.5,
			}),
		).toBe("Did the agent hunt for files? · 50% yes");
	});
});

describe("matchRunAnswersToTurns", () => {
	const question = (id: string, probability: number) => ({
		id,
		question: `Q ${id}`,
		label: null,
		probability,
	});
	const turns = [
		{ turnId: "t-lead", startedAt: "2026-10-13T10:29:00.000Z" },
		{ turnId: "t1", startedAt: "2026-10-13T10:30:00.123Z" },
		{ turnId: "t2", startedAt: "2026-10-13T10:31:00.000+00:00" },
		{ turnId: "t-none", startedAt: null },
	];

	test("tags the turn that starts when the run does, with its yes answers only", () => {
		const matched = matchRunAnswersToTurns(
			[
				{
					agentId: "",
					turn: 1,
					startedAt: "2026-10-13T10:30:00.123Z",
					questions: [
						question("a", 0.9),
						question("b", 0.49),
						question("c", 0.5),
					],
				},
				{
					agentId: "",
					turn: 2,
					startedAt: "2026-10-13T10:31:00.000Z",
					questions: [question("a", 0.2)],
				},
				// A subagent's run belongs to no turn of the main transcript.
				{
					agentId: "sub",
					turn: 1,
					startedAt: "2026-10-13T10:30:00.123Z",
					questions: [question("a", 0.95)],
				},
				// A run the reader has no turn for.
				{
					agentId: "",
					turn: 3,
					startedAt: "2026-10-13T10:32:00.000Z",
					questions: [question("a", 0.95)],
				},
			],
			turns,
		);
		expect([...matched]).toEqual([
			["t1", [question("a", 0.9), question("c", 0.5)]],
		]);
	});

	test("matches times written differently for the same instant", () => {
		const matched = matchRunAnswersToTurns(
			[
				{
					agentId: "",
					turn: 2,
					startedAt: "2026-10-13T10:31:00.000Z",
					questions: [question("a", 0.7)],
				},
			],
			turns,
		);
		expect(matched.get("t2")).toEqual([question("a", 0.7)]);
	});
});
