import { expect, test } from "bun:test";
import { LANGUAGE_SIGNAL_RULES } from "../rules.js";
import {
	LANGUAGE_SIGNAL_PATTERN,
	languageSignalPatternMatches,
} from "../scanner.js";

function raw(matches: Iterable<RegExpExecArray>) {
	return [...matches].map((match) => ({
		index: match.index,
		groups: [...match],
	}));
}

function random(seed: number) {
	let state = seed >>> 0 || 1;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) / 4_294_967_296;
	};
}

const SURFACES = LANGUAGE_SIGNAL_RULES.flatMap((rule) => rule.surfaces);
const PIECES = [
	" ",
	"  ",
	"\t",
	"\n",
	" ",
	"?",
	"??",
	"???",
	"!",
	".",
	"'",
	"’",
	"a",
	"Z",
	"7",
	"é",
	"ß",
	"ſ",
	"K",
	"😀",
	"\ud83d",
	"\ude00",
	"_",
	"don't ",
	"not ",
	"the agent read the file",
	"shell",
	"<system_instruction>",
];

function generatedText(next: () => number): string {
	let text = "";
	const parts = 1 + Math.floor(next() * 40);
	for (let index = 0; index < parts; index++) {
		if (next() < 0.45) {
			const surface = SURFACES[Math.floor(next() * SURFACES.length)] ?? "";
			const variant = next();
			text +=
				variant < 0.2
					? surface.toUpperCase()
					: variant < 0.3
						? surface.slice(0, Math.max(1, surface.length - 1))
						: surface;
		} else text += PIECES[Math.floor(next() * PIECES.length)] ?? "";
	}
	return text;
}

test("anchoring the pattern at each candidate yields the matches a scan of the whole text yields", () => {
	const next = random(20_261_109);
	let withMatches = 0;
	for (let sample = 0; sample < 4_000; sample++) {
		const text = generatedText(next);
		const expected = raw(text.matchAll(LANGUAGE_SIGNAL_PATTERN));
		expect(raw(languageSignalPatternMatches(text))).toEqual(expected);
		if (expected.length > 0) withMatches++;
	}
	expect(withMatches).toBeGreaterThan(2_000);
});

test("a long text without signals is scanned without trying the pattern at every position", () => {
	const text = "the agent read the file and ran the tests ".repeat(25_000);
	const startedAt = performance.now();
	expect(raw(languageSignalPatternMatches(text))).toEqual([]);
	const anchored = performance.now() - startedAt;
	const wholeStartedAt = performance.now();
	expect(raw(text.matchAll(LANGUAGE_SIGNAL_PATTERN))).toEqual([]);
	expect(anchored).toBeLessThan((performance.now() - wholeStartedAt) / 2);
});
