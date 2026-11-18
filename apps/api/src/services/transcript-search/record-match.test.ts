import { expect, test } from "bun:test";
import {
	escapeLikePattern,
	literalOf,
	recordKinds,
	recordMatchSql,
	recordPattern,
} from "./record-match.js";

test("a LIKE pattern escapes backslash, percent and underscore as PostHog's _escape_like_pattern does", () => {
	expect(escapeLikePattern("50%_off\\x")).toBe("50\\%\\_off\\\\x");
	expect(recordPattern("50%_off", "exact")).toBe("%50\\%\\_off%");
	expect(recordPattern("gh pr (create|edit)", "regex")).toBe(
		"gh pr (create|edit)",
	);
});

test("every mode but regex matches records by exact string", () => {
	expect(literalOf("regex")).toBe("regex");
	expect(["hybrid", "meaning", "exact"].map(literalOf)).toEqual([
		"exact",
		"exact",
		"exact",
	]);
});

test("injected context and compaction summaries are read with user prompts, never with other kinds", () => {
	expect(recordKinds([])).toEqual([
		"user_prompt",
		"assistant_text",
		"reasoning",
		"tool_call",
		"tool_result",
		"file_change",
		"injected_context",
		"compaction",
	]);
	expect(recordKinds(["tool_result", "user_prompt"])).toEqual([
		"tool_result",
		"user_prompt",
		"injected_context",
		"compaction",
	]);
	expect(recordKinds(["tool_call"])).toEqual(["tool_call"]);
});

test("a record matches in its kept text, in its head when no text was kept, or in its tail; exact ignores case, regex runs in RE2", () => {
	const bound = {
		text: "{t:String}",
		pattern: "{p:String}",
		snippetChars: 240,
	};
	const exact = recordMatchSql("exact", bound);
	expect(exact.matched).toBe(
		"(text ILIKE {p:String} OR (empty(text) AND head ILIKE {p:String}) OR tail ILIKE {p:String})",
	);
	expect(exact.snippet).toContain(
		"positionCaseInsensitiveUTF8(text, {t:String})",
	);
	const regex = recordMatchSql("regex", bound);
	expect(regex.matched).toBe(
		"(match(text, {p:String}) OR (empty(text) AND match(head, {p:String})) OR match(tail, {p:String}))",
	);
	expect(regex.snippet).toContain("regexpExtract(text, {p:String}, 0)");
	expect(exact.partial).toBe(
		"(text_chars > if(empty(text), lengthUTF8(head), lengthUTF8(text)) + lengthUTF8(tail))",
	);
});
