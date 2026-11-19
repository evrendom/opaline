import {
	ASSIGNMENT,
	PROGRAM_WORD,
	SETUP,
	SHELL_WRAPPER,
	VALUE_FLAGS,
	WRAPPER,
} from "@rudel/api-routes/command-identity";
import { cityHash64, wordShingleSimHashUTF8 } from "./clickhouse-hashes.js";
import {
	FAMILY_HEREDOC,
	FAMILY_QUOTED,
	FAMILY_SKIPPED,
	FAMILY_SPLIT,
	NORMALIZATION_RULES,
	SIMHASH_MIN_WORDS,
} from "./command-identity.js";
import {
	countMatches,
	extract,
	replaceRegexpAll,
	replaceRegexpOne,
	splitByRegexp,
	trimLeftSpaces,
	trimSpaces,
} from "./re2.js";

export interface CommandIdentity {
	readonly argv0: string | null;
	readonly prefix: string | null;
	readonly fingerprint: string | null;
	readonly simhash: number | null;
	readonly programs: readonly string[];
	readonly prefixes: readonly string[];
}

const PROGRAM_START = String.raw`^(?:(?:${ASSIGNMENT}|${WRAPPER})[ \t]+|[!({&][ \t]*)*([^\s;&|<>)-])`;
const MODULE = String.raw`^[ \t]+(-m[ \t]+[A-Za-z0-9_.]+)`;
const SUBCOMMAND = String.raw`^(?:[ \t]+${VALUE_FLAGS}[ \t]+[^\s;&|]+)*[ \t]+([a-z][a-z0-9:_-]*)(?:\s|$|[;&|)])`;

export function unwrap(text: string): string {
	const joined = replaceRegexpAll(text, String.raw`\\\n`, " ");
	const single = replaceRegexpOne(
		joined,
		String.raw`(?s)${SHELL_WRAPPER}'(.*)'\s*$`,
		"\\1",
	);
	return replaceRegexpOne(
		single,
		String.raw`(?s)${SHELL_WRAPPER}"(.*)"\s*$`,
		"\\1",
	);
}

export function programStart(text: string): string {
	return replaceRegexpOne(text, PROGRAM_START, "\\1");
}

export function argv0OfStart(start: string): string {
	const word = extract(start, PROGRAM_WORD);
	if (word.startsWith("$(")) return word;
	return replaceRegexpOne(
		replaceRegexpAll(word, `["']`, ""),
		String.raw`^.*[/\\]`,
		"",
	);
}

export function prefixOfStart(start: string, argv0: string): string {
	const rest = replaceRegexpOne(start, PROGRAM_WORD, "");
	const module = extract(rest, MODULE);
	if (argv0 === "") return argv0;
	if (module !== "")
		return `${argv0} ${replaceRegexpAll(module, "[ \t]+", " ")}`;
	const subcommand = extract(rest, SUBCOMMAND);
	return subcommand !== "" ? `${argv0} ${subcommand}` : argv0;
}

export function commandNormalized(text: string, from: string): string {
	let normalized = unwrap(text);
	for (const rule of NORMALIZATION_RULES)
		if (from === "command" || !rule.commandsOnly)
			normalized = replaceRegexpAll(normalized, rule.pattern, rule.replacement);
	return trimSpaces(normalized);
}

function programStarts(text: string): (readonly [string, string])[] {
	const body = replaceRegexpOne(unwrap(text), FAMILY_HEREDOC, "");
	const quoted = replaceRegexpAll(
		replaceRegexpAll(body, FAMILY_QUOTED, "'Q'"),
		"[(){}]",
		" ",
	);
	return splitByRegexp(FAMILY_SPLIT, quoted)
		.map((statement) => programStart(trimLeftSpaces(statement)))
		.map((start) => [start, argv0OfStart(start)] as const)
		.filter(([, argv0]) => argv0 !== "" && !FAMILY_SKIPPED.includes(argv0));
}

const distinct = (values: readonly string[]) => [...new Set(values)];

export function commandIdentityOf(
	from: string,
	text: string | null,
): CommandIdentity {
	if (text === null || from === "")
		return {
			argv0: null,
			prefix: null,
			fingerprint: null,
			simhash: null,
			programs: [],
			prefixes: [],
		};
	const normalized = commandNormalized(text, from);
	const simhash =
		countMatches(normalized, "[[:alnum:]_]+") >= SIMHASH_MIN_WORDS
			? wordShingleSimHashUTF8(normalized)
			: null;
	const fingerprint = cityHash64(normalized).toString();
	if (from !== "command")
		return {
			argv0: null,
			prefix: null,
			fingerprint,
			simhash,
			programs: [],
			prefixes: [],
		};
	const start = programStart(replaceRegexpOne(unwrap(text), SETUP, ""));
	const argv0 = argv0OfStart(start);
	const starts = programStarts(text);
	return {
		argv0,
		prefix: prefixOfStart(start, argv0),
		fingerprint,
		simhash,
		programs: distinct(starts.map(([, program]) => program)),
		prefixes: distinct(
			starts.map(([statement, program]) => prefixOfStart(statement, program)),
		),
	};
}
