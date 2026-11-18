import { expect, test } from "bun:test";
import {
	apologySnippets,
	frustratedSnippets,
	openingOf,
	type Snippet,
	snippetsOf,
} from "./session-reader-said";

const read = (snippet: Snippet) =>
	`${snippet.cutStart ? "…" : ""}${snippet.parts
		.map((part) => (part.match ? `[${part.text}]` : part.text))
		.join("")}${snippet.cutEnd ? "…" : ""}`;

test("the word itself, and eight words either side", () => {
	const text =
		"one two three four five six seven eight nine ten this does not work at all one two three four five six seven eight nine";
	expect(snippetsOf(text, ["does not work"]).map(read)).toEqual([
		"…four five six seven eight nine ten this [does not work] at all one two three four five six…",
	]);
});

test("near the start or the end: nothing cut there", () => {
	expect(snippetsOf("wtf is this", ["wtf"]).map(read)).toEqual([
		"[wtf] is this",
	]);
	expect(
		snippetsOf("still not man.\nnow its all other wtf.", ["wtf"]).map(read),
	).toEqual(["still not man. now its all other [wtf]."]);
});

test("words close together share a snippet; far apart, each its own", () => {
	const near = snippetsOf("this is broken and still broken", ["broken"]);
	expect(near.map(read)).toEqual(["this is [broken] and still [broken]"]);
	const filler = Array.from({ length: 30 }, (_, index) => `w${index}`).join(
		" ",
	);
	const far = snippetsOf(`broken ${filler} broken`, ["broken"]);
	expect(far).toHaveLength(2);
});

test("a prompt with no word that reads so: its opening", () => {
	expect(read(openingOf("a b c"))).toBe("a b c");
	expect(frustratedSnippets("can we have more data please").map(read)).toEqual([
		"can we have more data please",
	]);
});

test("frustrated words found and marked", () => {
	const [snippet] = frustratedSnippets("ok this is fucking wrong, fix it");
	expect(snippet?.parts.some((part) => part.match)).toBe(true);
});

test("an apology: its words and those around them", () => {
	const snippets = apologySnippets([
		"I checked the layout. You're right, I apologize for the confusion — the fold loop was wrong.",
	]);
	expect(snippets.map(read)).toEqual([
		"I checked the layout. You're right, I [apologize] for the confusion — the fold loop was…",
	]);
});
