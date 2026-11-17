import { describe, expect, test } from "bun:test";
import {
	mayContainLanguageSignal,
	scanLanguageSignals,
	scanMemberLanguageSignals,
} from "../index.js";

function signals(text: string, scan = scanMemberLanguageSignals) {
	return scan(text).map(({ category, ruleId, matchedText }) => ({
		category,
		ruleId,
		matchedText,
	}));
}

function unhappy(text: string): string[] {
	return scanMemberLanguageSignals(text)
		.filter(
			(match) => match.category === "negative" || match.category === "swear",
		)
		.map((match) => match.ruleId);
}

describe("frustration rules", () => {
	test.each([
		["negative.verdict", "the settings page is horrible"],
		["negative.verdict", "that chart looks ugly now"],
		["negative.verdict", "the export is useless like this"],
		["negative.verdict", "the spacing is so bad"],
		["negative.verdict", "the modal feels cheap"],
		["negative.janky", "scrolling the list is janky"],
		["negative.nonsense", "this number makes no sense"],
		["negative.nonsense", "that doesn't make any sense"],
		["negative.worse", "the sidebar got worse"],
		["negative.hate", "i hate this layout"],
		["negative.still", "the button still doesnt respond"],
		["negative.still", "it still shows the old title"],
		["negative.still", "the header is still very unstable"],
		["negative.still-unchanged", "the toast overlaps the footer still."],
		["negative.still-unchanged", "still"],
		["negative.again", "i thought we fixed the login loop"],
		["negative.again", "we keep going in circles here"],
		["negative.again", "the build failed again"],
		["negative.again-alone", "use one accent color. again."],
		["negative.not-loading", "the report doesnt load"],
		["negative.not-loading", "why is the preview not loading"],
		["negative.not-loading", "every time i run it the editor crashes"],
		["negative.too-slow", "the page took way too long"],
		["negative.too-slow", "it renders waaaay too many rows"],
		["negative.at-agent", "are you dumb, the file is right there"],
		["negative.at-agent", "i already told you to keep the tests"],
		["negative.disbelief", "what are you talking about, it is open"],
		["negative.disbelief", "i cant believe this broke"],
		["negative.disbelief", "no way this is the default"],
		["negative.disbelief", "uggh the dialog again"],
		["negative.insult", "that was an idiotic rename"],
		["negative.exclamation-run", "use the shared icon!!!"],
		["swear.fuck-variant", "why does the fuckign build hang"],
		["swear.fuck-variant", "the fcuking cache is stale"],
		["swear.fuck-variant", "now th efucking toggle is gone"],
		["swear.as-fuck", "the import is slow af"],
		["swear.as-fuck", "this is annoying as hell"],
		["swear.abbreviations", "wth is this layout"],
	])("%s flags %p", (ruleId, text) => {
		expect(unhappy(text)).toContain(ruleId);
	});

	test("bare still and again only count where they stand alone", () => {
		expect(unhappy("is it still running?")).toEqual([]);
		expect(unhappy("we still need a migration for this")).toEqual([]);
		expect(unhappy("run the suite again")).toEqual([]);
		expect(unhappy("again, keep the tests green")).toEqual([]);
	});

	test("calm reports and instructions stay unflagged", () => {
		for (const text of [
			"don't load the whole file",
			"don't show the sidebar on mobile",
			"it does not start with a number but with a dot",
			"this is a bad request handler, rename it",
			"move it to the trash folder",
			"what is the state of this branch",
			"a dumb component is fine here",
			"is this approach worse for memory?",
		])
			expect(unhappy(text)).toEqual([]);
	});

	test("a swear next to praise counts as positive", () => {
		expect(signals("that is so fucking fast")).toEqual([
			{
				category: "positive",
				ruleId: "positive.swear-intensified",
				matchedText: "fucking",
			},
		]);
		expect(signals("hell yeah").map(({ category }) => category)).toEqual([
			"positive",
		]);
		expect(signals("damn good work")[0]?.category).toBe("positive");
		expect(signals("this loads fast af")).toEqual([
			{
				category: "positive",
				ruleId: "positive.swear-intensified",
				matchedText: "af",
			},
		]);
		expect(unhappy("this is fucking broken")).toEqual(["swear.fuck"]);
		expect(unhappy("this better fucking work")).toEqual(["swear.fuck"]);
	});

	test("question runs count after a word or at the end, never between operands", () => {
		expect(unhappy("const port = env.PORT ?? 3000")).toEqual([]);
		expect(unhappy("value ??= fallback")).toEqual([]);
		expect(unhappy("why??")).toEqual(["negative.question-run"]);
		expect(unhappy("is it deployed ??")).toEqual(["negative.question-run"]);
	});

	test("fishy counts unless the prompt asks to look for problems", () => {
		expect(unhappy("anything else you find fishy?")).toEqual([]);
		expect(unhappy("whats fishy in these costs")).toEqual([]);
		expect(unhappy("this retry count looks fishy")).toEqual(["negative.fishy"]);
	});

	test("an exclamation run after praise in the same sentence stays positive", () => {
		expect(unhappy("perfect, thanks!!")).toEqual([]);
		expect(unhappy("thanks. now fix the header!!")).toEqual([
			"negative.exclamation-run",
		]);
	});

	test("quoted, code and attached text in a prompt is not the member's own words", () => {
		for (const text of [
			"the error says ```\nthis is horrible\n``` in the log",
			"rename `uselessHelper` to helper",
			"> this is so bad\nsummarize the quote above",
			'the doc says "the old flow was awful" and i agree it changed',
			"the doc says “the old flow was awful” and i agree it changed",
			"<pasted>it still does not load</pasted> summarize this",
			"[Attached image: horrible-screenshot.png] what does it show",
		])
			expect(unhappy(text)).toEqual([]);
	});

	test("member offsets point into the original text around skipped quotes", () => {
		const text = 'the "awful" label is ugly';
		const [match] = scanMemberLanguageSignals(text);
		expect(match?.matchedText).toBe("ugly");
		expect(text.slice(match?.start, match?.end)).toBe("ugly");
	});

	test("model text keeps every word, quoted or not", () => {
		expect(
			signals('the "fucking" header', scanLanguageSignals).map(
				({ category }) => category,
			),
		).toEqual(["swear"]);
	});

	test("the prefilter passes texts whose swears turn positive or positives turn negative", () => {
		expect(mayContainLanguageSignal("so fucking fast", "positive")).toBe(true);
		expect(mayContainLanguageSignal("not nice at all", "negative")).toBe(true);
	});
});
