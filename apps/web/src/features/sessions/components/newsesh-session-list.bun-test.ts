import { describe, expect, test } from "bun:test";
import { getNewseshLanguageSignalMatches } from "./newsesh-session-language-signal";

describe("newsesh session language signal matches", () => {
	test("separates member and model words before selecting visible tags", () => {
		const session = {
			member_swears: 1,
			member_apologies: 1,
			member_positive: 1,
			model_swears: 1,
			model_apologies: 10,
			model_positive: 1,
			member_swear_matches: ["wtf"],
			member_apology_matches: ["sorry"],
			member_positive_matches: ["great"],
			model_swear_matches: ["shit"],
			model_apology_matches: [
				"my mistake",
				"sorry",
				"I misunderstood",
				"I misread",
			],
			model_positive_matches: ["nice"],
		};
		const member = getNewseshLanguageSignalMatches(session, "member");
		const model = getNewseshLanguageSignalMatches(session, "model");
		expect(member.map((signal) => signal.matchedText)).toEqual([
			"wtf",
			"sorry",
			"great",
		]);
		expect(member.every((signal) => signal.speaker === "member")).toBe(true);
		expect(model.map((signal) => signal.matchedText)).toEqual([
			"my mistake",
			"sorry",
			"I misunderstood",
			"I misread",
			"shit",
			"nice",
		]);
		expect(model.every((signal) => signal.speaker === "model")).toBe(true);
	});

	test("does not borrow the other speaker's matches for an empty column", () => {
		const session = {
			member_swears: 1,
			member_apologies: 0,
			member_positive: 0,
			model_swears: 0,
			model_apologies: 0,
			model_positive: 0,
			member_swear_matches: ["wtf"],
		};
		expect(getNewseshLanguageSignalMatches(session, "model")).toEqual([]);
		expect(getNewseshLanguageSignalMatches(session, "member")).toHaveLength(1);
	});

	test("never substitutes categories or counts for missing matched words", () => {
		const signals = getNewseshLanguageSignalMatches({
			member_swears: 4,
			member_apologies: 0,
			member_positive: 23,
			model_swears: 0,
			model_apologies: 3,
			model_positive: 0,
		});
		expect(signals).toEqual([]);
	});

	test("preserves exact words and omits count-only categories", () => {
		const signals = getNewseshLanguageSignalMatches({
			member_swears: 1,
			member_apologies: 0,
			member_positive: 0,
			model_swears: 0,
			model_apologies: 2,
			model_positive: 0,
			member_swear_matches: ["fuck"],
			model_apology_matches: [],
		});
		expect(signals.map((signal) => signal.matchedText)).toEqual(["fuck"]);
	});

	test("builds tags from exact persisted matches in count-priority order", () => {
		const signals = getNewseshLanguageSignalMatches({
			member_swears: 2,
			member_apologies: 0,
			member_positive: 1,
			model_swears: 0,
			model_apologies: 3,
			model_positive: 0,
			member_swear_matches: ["fuck"],
			member_positive_matches: ["Great work"],
			model_apology_matches: ["My bad"],
		});

		expect(signals.map((signal) => signal.matchedText)).toEqual([
			"My bad",
			"fuck",
			"Great work",
		]);
	});

	test("returns no tags when every persisted count is zero", () => {
		expect(
			getNewseshLanguageSignalMatches({
				member_swears: 0,
				member_apologies: 0,
				member_positive: 0,
				model_swears: 0,
				model_apologies: 0,
				model_positive: 0,
				member_swear_matches: [],
			}),
		).toEqual([]);
	});
});
