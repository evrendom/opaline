import type { parseShellCommand } from "../session-transcript/transcript-records/command-class.js";
import type { WordAnnotation } from "./parse-arguments.js";
import {
	isStrayFlag,
	type RuleContext,
	type RuleResult,
	writtenFlagNames,
} from "./rules/context.js";
import type { ExplainedStep, Segment } from "./sentence.js";

type Statement = ReturnType<typeof parseShellCommand>[number];

export function wordMeanings(
	words: readonly WordAnnotation[],
): ExplainedStep["words"] {
	return words.flatMap((word) => {
		const meaning =
			word.kind === "subcommand"
				? word.spec.d
				: word.kind === "option"
					? word.option.d
					: word.kind === "option_arg"
						? (word.arg?.d ?? word.arg?.n)
						: word.kind === "argument"
							? (word.arg?.d ?? word.arg?.n)
							: "End of options";
		return meaning ? [{ meaning, text: word.text }] : [];
	});
}

export function redirectNotes(
	statement: Statement,
	output: string | null,
): Segment[][] {
	return statement.redirects.flatMap((redirect): Segment[][] => {
		if (
			/^\d?>&\d$/u.test(redirect.operator + redirect.target) ||
			redirect.target === "&1"
		)
			return [];
		if (redirect.target === "/dev/null")
			return [
				[
					{
						text: redirect.operator.startsWith("2")
							? "errors hidden"
							: "output thrown away",
					},
				],
			];
		if (redirect.operator.includes("<"))
			return [[{ text: "reading " }, { file: redirect.target }]];
		if (redirect.operator.includes(">>"))
			return [[{ text: "added to " }, { file: redirect.target }]];
		if (redirect.operator.startsWith("2"))
			return [[{ text: "errors saved to " }, { file: redirect.target }]];
		if (redirect.target === output) return [];
		return [[{ text: "saved to " }, { file: redirect.target }]];
	});
}

export const QUIET_FLAGS = ["-q", "--quiet"];

export function versionOrHelp(context: RuleContext): RuleResult | null {
	const [only, ...rest] = context.args;
	if (rest.length > 0 || !only) return null;
	if (["--version", "-V", "--help", "-h"].includes(only))
		context.asked.add(only);
	if (only === "--version" || only === "-V")
		return {
			sentence: [{ text: "Show the version of " }, { code: context.program }],
			title: "Version",
		};
	if (only === "--help" || only === "-h")
		return {
			sentence: [{ text: "Show the help of " }, { code: context.program }],
			title: "Help",
		};
	return null;
}

export function unexplained(context: RuleContext): Segment[][] {
	const missing: string[] = [];
	const said = (word: string) =>
		context.asked.has(word.split("=")[0] ?? word) ||
		writtenFlagNames(word).every((name) => context.asked.has(name));
	if (context.parsed) {
		const { parsed } = context;
		const words = parsed.words;
		for (const [index, word] of words.entries()) {
			if (isStrayFlag(parsed, index)) {
				if (!said(word.text)) missing.push(word.text);
				continue;
			}
			if (word.kind !== "option") continue;
			if (word.option.n.some((name) => context.asked.has(name))) continue;
			const next = words[index + 1];
			const flag = word.text.startsWith("-") ? word.text : word.flag;
			missing.push(
				next?.kind === "option_arg"
					? flag.endsWith("=")
						? `${flag}${next.text}`
						: `${flag} ${next.text}`
					: flag,
			);
		}
	} else {
		for (const arg of context.args)
			if (/^--?[A-Za-z]/u.test(arg) && !said(arg)) missing.push(arg);
	}
	return alsoNote(missing);
}

export function alsoNote(words: readonly string[]): Segment[][] {
	if (words.length === 0) return [];
	return [
		[
			{ text: "also " },
			...words.flatMap((word, index): Segment[] => [
				...(index > 0 ? [{ text: " " }] : []),
				{ code: word },
			]),
		],
	];
}

export function bracketed(notes: Segment[][]): Segment[] {
	if (notes.length === 0) return [];
	return [
		{ text: " (" },
		...notes.flatMap((note, index) =>
			index > 0 ? [{ text: ", " }, ...note] : note,
		),
		{ text: ")" },
	];
}
