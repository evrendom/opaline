import { createHighlighterCore } from "shiki/core";
import bash from "shiki/dist/langs/bash.mjs";
import css from "shiki/dist/langs/css.mjs";
import diff from "shiki/dist/langs/diff.mjs";
import html from "shiki/dist/langs/html.mjs";
import javascript from "shiki/dist/langs/javascript.mjs";
import json from "shiki/dist/langs/json.mjs";
import jsx from "shiki/dist/langs/jsx.mjs";
import markdown from "shiki/dist/langs/markdown.mjs";
import python from "shiki/dist/langs/python.mjs";
import sql from "shiki/dist/langs/sql.mjs";
import tsx from "shiki/dist/langs/tsx.mjs";
import typescript from "shiki/dist/langs/typescript.mjs";
import yaml from "shiki/dist/langs/yaml.mjs";
import darkPlus from "shiki/dist/themes/dark-plus.mjs";
import lightPlus from "shiki/dist/themes/light-plus.mjs";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type {
	CodeHighlightRequest,
	CodeHighlightResponse,
} from "./code-highlight-types";

const highlighterPromise = createHighlighterCore({
	engine: createJavaScriptRegexEngine(),
	langs: [
		bash,
		css,
		diff,
		html,
		javascript,
		json,
		jsx,
		markdown,
		python,
		sql,
		tsx,
		typescript,
		yaml,
	],
	themes: [darkPlus, lightPlus],
});

function normalizeCodeLanguage(language: string) {
	switch (language.toLowerCase()) {
		case "bash":
		case "shell":
		case "shellscript":
		case "sh":
		case "zsh":
			return "shellscript";
		case "css":
			return "css";
		case "diff":
		case "patch":
			return "diff";
		case "htm":
		case "html":
		case "xml":
			return "html";
		case "javascript":
		case "js":
			return "javascript";
		case "jsx":
			return "jsx";
		case "json":
		case "jsonc":
			return "json";
		case "markdown":
		case "md":
			return "markdown";
		case "python":
		case "py":
			return "python";
		case "sql":
			return "sql";
		case "tsx":
			return "tsx";
		case "typescript":
		case "ts":
			return "typescript";
		case "yaml":
		case "yml":
			return "yaml";
		default:
			return undefined;
	}
}

const OPAL = (lightness: number, chroma: number, hue: number) =>
	`oklch(${lightness} ${chroma} ${hue})`;
const SHELL_OPALINE: Record<"dark" | "light", Record<string, string>> = {
	dark: {
		"#569CD6": OPAL(0.76, 0.14, 302.391),
		"#6A9955": OPAL(0.62, 0, 0),
		"#9CDCFE": OPAL(0.76, 0.14, 281.458),
		"#B5CEA8": OPAL(0.76, 0.15, 323.991),
		"#C586C0": OPAL(0.76, 0.14, 281.458),
		"#CE9178": OPAL(0.78, 0.13, 344.619),
		"#D7BA7D": OPAL(0.76, 0.15, 323.991),
		"#DCDCAA": OPAL(0.76, 0.14, 262.833),
	},
	light: {
		"#0000FF": OPAL(0.52, 0.24, 302.391),
		"#001080": OPAL(0.5, 0.22, 281.458),
		"#008000": OPAL(0.55, 0, 0),
		"#098658": OPAL(0.52, 0.24, 323.991),
		"#795E26": OPAL(0.5, 0.21, 262.833),
		"#A31515": OPAL(0.52, 0.22, 344.619),
		"#AF00DB": OPAL(0.5, 0.22, 281.458),
		"#EE0000": OPAL(0.52, 0.24, 323.991),
	},
};

const VIOLET = 292.717;
const GREEN = 149.579;
const AMBER = 55;
const BLUE = 259.815;
const CYAN = 215.221;
const RED = 25.331;

const CODE_OPALINE: Record<"dark" | "light", Record<string, string>> = {
	dark: {
		"#000080": OPAL(0.76, 0.13, BLUE),
		"#4EC9B0": OPAL(0.78, 0.11, CYAN),
		"#4FC1FF": OPAL(0.8, 0.14, AMBER),
		"#569CD6": OPAL(0.74, 0.16, VIOLET),
		"#646695": OPAL(0.62, 0, 0),
		"#6796E6": OPAL(0.76, 0.13, BLUE),
		"#6A9955": OPAL(0.62, 0, 0),
		"#808080": OPAL(0.62, 0, 0),
		"#9CDCFE": OPAL(0.88, 0.03, BLUE),
		"#B5CEA8": OPAL(0.8, 0.14, AMBER),
		"#C586C0": OPAL(0.74, 0.16, VIOLET),
		"#CE9178": OPAL(0.78, 0.14, GREEN),
		"#D16969": OPAL(0.78, 0.14, GREEN),
		"#D7BA7D": OPAL(0.8, 0.14, AMBER),
		"#DCDCAA": OPAL(0.76, 0.13, BLUE),
		"#F44747": OPAL(0.7, 0.19, RED),
	},
	light: {
		"#000080": OPAL(0.5, 0.18, BLUE),
		"#0000FF": OPAL(0.5, 0.2, VIOLET),
		"#001080": OPAL(0.32, 0.04, BLUE),
		"#0070C1": OPAL(0.56, 0.16, AMBER),
		"#008000": OPAL(0.55, 0, 0),
		"#0451A5": OPAL(0.5, 0.18, BLUE),
		"#098658": OPAL(0.56, 0.16, AMBER),
		"#267F99": OPAL(0.52, 0.11, CYAN),
		"#795E26": OPAL(0.5, 0.18, BLUE),
		"#800000": OPAL(0.5, 0.2, VIOLET),
		"#811F3F": OPAL(0.52, 0.14, GREEN),
		"#A31515": OPAL(0.52, 0.14, GREEN),
		"#AF00DB": OPAL(0.5, 0.2, VIOLET),
		"#CD3131": OPAL(0.55, 0.2, RED),
		"#D16969": OPAL(0.52, 0.14, GREEN),
		"#E50000": OPAL(0.32, 0.04, BLUE),
		"#EE0000": OPAL(0.56, 0.16, AMBER),
	},
};

const warmLanguages = new Set<string>();

globalThis.addEventListener(
	"message",
	async (event: MessageEvent<CodeHighlightRequest>) => {
		const startedAt = performance.now();
		const language = normalizeCodeLanguage(event.data.language);
		const firstInLanguage =
			language !== undefined && !warmLanguages.has(language);
		if (language) warmLanguages.add(language);
		const lines = language
			? (await highlighterPromise).codeToTokens(event.data.code, {
					lang: language,
					theme: event.data.theme === "dark" ? "dark-plus" : "light-plus",
					tokenizeMaxLineLength: 4_000,
					// Shiki's own default the first time, room for the grammar.
					tokenizeTimeLimit: firstInLanguage ? 500 : 32,
				}).tokens
			: event.data.code.split("\n").map((line) => [
					{
						color: undefined,
						content: line,
						fontStyle: undefined,
						offset: 0,
					},
				]);
		const response: CodeHighlightResponse = {
			charCount: event.data.code.length,
			durationMs: performance.now() - startedAt,
			key: event.data.key,
			language: event.data.language,
			lines: lines.map((line) =>
				line.map((token) => ({
					color: token.color
						? ((language === "shellscript" ? SHELL_OPALINE : CODE_OPALINE)[
								event.data.theme === "dark" ? "dark" : "light"
							][token.color.toUpperCase()] ?? token.color)
						: undefined,
					content: token.content,
					fontStyle: token.fontStyle,
					offset: token.offset,
				})),
			),
		};
		globalThis.postMessage(response);
	},
);
