import type { ParsedCommand } from "../parse-arguments.js";
import type { FileEdit } from "../python-edits.js";
import type { Segment } from "../sentence.js";

export type RuleContext = {
	program: string;
	args: string[];
	parsed: ParsedCommand | null;
	piped: boolean;
	hereDoc: string | null;
	output: string | null;
	asked: Set<string>;
};

export type RuleResult = {
	title: string;
	sentence: Segment[];
	edits?: FileEdit[];
	also?: string[];
	quiet?: boolean;
	saysOutput?: boolean;
};

export type Rule = (context: RuleContext) => RuleResult | null;
export type Filter = (context: RuleContext) => Segment[] | null;

export function duration(value: string): string {
	const match = /^([\d.]+)([smhd]?)$/u.exec(value);
	if (!match) return value;
	const seconds =
		Number(match[1]) *
		({ d: 86_400, h: 3_600, m: 60, s: 1, "": 1 }[match[2] ?? ""] ?? 1);
	if (seconds < 60) return `${seconds} s`;
	const minutes = Math.floor(seconds / 60);
	const rest = Math.round(seconds % 60);
	if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
	return `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ""}`.trim();
}

export const docLines = (script: string) =>
	script.split("\n").filter((line) => line.trim()).length;

export function isStrayFlag(parsed: ParsedCommand, index: number): boolean {
	const word = parsed.words[index];
	if (word?.kind !== "argument" || !/^--?[A-Za-z]/u.test(word.text))
		return false;
	return !parsed.words
		.slice(0, index)
		.some((before) => before.kind === "end_of_options");
}

export function writtenFlagNames(word: string): string[] {
	if (word.startsWith("--")) return [word.split("=")[0] ?? word];
	const letters = /^-([A-Za-z]+)/u.exec(word)?.[1] ?? "";
	return [...letters].map((letter) => `-${letter}`);
}

function flags(context: RuleContext): Set<string> {
	const set = new Set<string>();
	const addWritten = (args: readonly string[]) => {
		for (const arg of args) {
			if (/^-[A-Za-z]/u.test(arg)) set.add(arg.split("=")[0] ?? arg);
			for (const name of writtenFlagNames(arg)) set.add(name);
		}
	};
	if (context.parsed) {
		const { parsed } = context;
		for (const word of parsed.words)
			if (word.kind === "option")
				for (const name of word.option.n) set.add(name);
		addWritten(
			parsed.words
				.filter((_, index) => isStrayFlag(parsed, index))
				.map((word) => word.text),
		);
		return set;
	}
	addWritten(context.args);
	return set;
}

export const has = (context: RuleContext, ...names: string[]) => {
	for (const name of names) context.asked.add(name);
	const set = flags(context);
	return names.some((name) => set.has(name));
};

export const explains = (context: RuleContext, ...names: string[]) => {
	for (const name of names) context.asked.add(name);
};

export function values(context: RuleContext, ...names: string[]): string[] {
	for (const name of names) context.asked.add(name);
	const out: string[] = [];
	if (context.parsed) {
		const words = context.parsed.words;
		for (const [index, word] of words.entries()) {
			const next = words[index + 1];
			if (
				word.kind === "option" &&
				word.option.n.some((name) => names.includes(name)) &&
				next?.kind === "option_arg"
			)
				out.push(next.text);
		}
		if (out.length > 0) return out;
	}
	for (const [index, arg] of context.args.entries()) {
		const [flag, inline] = arg.split(/=(.*)/su);
		if (flag && names.includes(flag)) {
			const value = inline ?? context.args[index + 1];
			if (value !== undefined) out.push(value);
		}
	}
	return out;
}

export function positionals(context: RuleContext): string[] {
	if (context.parsed) {
		const { parsed } = context;
		return parsed.words.flatMap((word, index) =>
			word.kind === "argument" && !isStrayFlag(parsed, index)
				? [word.text]
				: [],
		);
	}
	return context.args.filter((arg) => !arg.startsWith("-"));
}

export const subcommandPath = (context: RuleContext) =>
	context.parsed?.subcommands.slice(1).map((sub) => sub.n[0]) ?? [];

export function lineCount(context: RuleContext, fallback = 10): number {
	const short = context.args.find((arg) => /^-\d+$/u.test(arg));
	if (short) return Number(short.slice(1));
	const value = values(context, "-n", "--lines")[0];
	const number = value ? Number(value.replace(/^\+/u, "")) : Number.NaN;
	return Number.isFinite(number) ? number : fallback;
}
