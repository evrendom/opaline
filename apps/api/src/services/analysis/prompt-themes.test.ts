import { describe, expect, test } from "bun:test";
import {
	promptBody,
	promptOpening,
	promptPhrases,
	promptThemes,
	promptTokens,
	type ThemePrompt,
	templateKeys,
} from "./prompt-themes-sql.js";

describe("prompt body", () => {
	test("keeps what the person typed and drops code, tags, attachments and pasted logs", () => {
		expect(
			promptBody(
				[
					"the build is red again [Image #1]",
					"```",
					"const x = 1;",
					"```",
					"<environment_context><cwd>/repo</cwd></environment_context>",
					"    at Object.<anonymous> (/repo/src/a.ts:12:3)",
					"2026-08-01T10:00:00 ERROR boom",
					"error: connect refused",
					"src/a.ts:12:3 - TS2322",
					"can you look",
				].join("\n"),
			),
		).toBe("the build is red again can you look");
	});

	test("stops at a heading, also one pasted mid-line, so a tool's block never reads as words typed", () => {
		expect(
			promptBody(
				"move the button here ## Report: /settings/page\n**Viewport:** 1500×895\n### 1. <Panel>",
			),
		).toBe("move the button here");
		expect(promptBody("## Report: /settings/page\nfix it")).toBe("");
		expect(promptBody("issue # 5 is open")).toBe("issue # 5 is open");
	});
});

describe("prompt words", () => {
	test("tokens are lower-case words without links, paths or numbers", () => {
		expect(
			promptTokens(
				"Check https://example.com/a?b=c and ./docs/x.md: it’s Broken 42 times",
			),
		).toEqual(["check", "and", "it's", "broken", "times"]);
	});

	test("an opening is the first two words after fillers, when one of them says something", () => {
		expect(promptOpening(promptTokens("ok so logged out again"))).toBe(
			"logged out",
		);
		expect(promptOpening(promptTokens("Go ahead"))).toBe("go ahead");
		expect(promptOpening(promptTokens("can you do it"))).toBe("");
		expect(promptOpening(promptTokens("ok thanks"))).toBe("");
	});

	test("phrases are 2 to 4 words with a word that says something, never starting or ending on a joining word", () => {
		const phrases = promptPhrases(promptTokens("are you sure the agent ran"));
		expect(phrases).toContain("are you sure");
		expect(phrases).toContain("you sure");
		expect(phrases).not.toContain("sure the");
		expect(phrases).not.toContain("the agent");
		expect(phrases).toContain("agent ran");
		expect(promptPhrases(promptTokens("can you do it"))).toEqual([]);
	});
});

describe("templates", () => {
	test("a template is keyed by its heading wherever it starts, or by the prompt's opening past attached paths", () => {
		expect(templateKeys("move it ## Report: /a/b/c\n**x**").block).toBe(
			"## report: <path>",
		);
		expect(templateKeys("./notes/pasted.txt fix this now please").whole).toBe(
			"fix this now please",
		);
		expect(templateKeys("plain words only").block).toBe("");
	});
});

const sessions = (count: number, text: string, from = 0): ThemePrompt[] =>
	Array.from({ length: count }, (_, index) => ({
		session: `s${from + index}`,
		text,
	}));

const keys = (prompts: readonly ThemePrompt[]) =>
	promptThemes(prompts).map((theme) => `${theme.key} ${theme.sessions}`);

describe("themes", () => {
	test("a theme needs 3 sessions, whatever the tone, and ranks by sessions", () => {
		const themes = keys([
			...sessions(4, "logged out of the dashboard"),
			...sessions(3, "the dashboard logged out me", 10),
			...sessions(2, "rename the export button", 20),
		]);
		expect(themes[0]).toBe("phrase|logged out 7");
		expect(themes.some((theme) => theme.includes("export button"))).toBe(false);
	});

	test("a phrase inside a longer one that covers most of its prompts gives way to it, and so does a phrase an opening covers", () => {
		const themes = keys([
			...sessions(3, "are you sure it ran"),
			...sessions(3, "go ahead", 10),
		]);
		expect(themes).toContain("phrase|are you sure 3");
		expect(themes).not.toContain("phrase|you sure 3");
		expect(themes).toContain("open|go ahead 3");
		expect(themes).not.toContain("phrase|go ahead 3");
	});

	test("templated text is its own row: a recurring heading keeps the words typed before it, a long recurring prompt keeps none", () => {
		const plan = `Please implement this plan:\n${"step with details and more words ".repeat(60)}`;
		const themes = keys([
			...sessions(3, "logged out again ## Report: /a/1\n**Viewport:** 9"),
			...sessions(3, plan, 10),
		]);
		expect(themes).toContain("template|## report: <path> 3");
		expect(themes).toContain("open|logged out 3");
		expect(themes).toContain("template|please implement this plan: 3");
		expect(themes.some((theme) => theme.includes("step with details"))).toBe(
			false,
		);
	});
});
