import {
	code,
	file,
	files,
	lines,
	list,
	plural,
	type Segment,
	text,
} from "../sentence.js";
import {
	docLines,
	explains,
	has,
	lineCount,
	positionals,
	type RuleContext,
	type RuleResult,
	values,
} from "./context.js";
import { alternation, isBlankPattern, termItems, terms } from "./patterns.js";

export function grep(context: RuleContext): RuleResult {
	const fromOption = values(context, "-e", "--regexp");
	const words = positionals(context);
	const patterns = fromOption.length > 0 ? fromOption : words.slice(0, 1);
	const paths = fromOption.length > 0 ? words : words.slice(1);
	const syntax = alternation(context);
	const invert = has(context, "-v", "--invert-match");
	const count = has(context, "-c", "--count");
	const onlyFiles = has(context, "-l", "--files-with-matches");
	const filesWithout = has(context, "-L", "--files-without-match");
	const check = has(context, "-q", "--quiet", "--silent");
	const blank = patterns.length === 1 && isBlankPattern(patterns[0] ?? "");
	const every = patterns.length === 1 && patterns[0] === "";
	const what: Segment[] = every
		? [text(invert ? "no lines" : "lines")]
		: blank
			? [text(invert ? "lines that aren't blank" : "blank lines")]
			: [
					text(invert ? "lines not containing " : "lines containing "),
					...list(
						patterns.flatMap((pattern) => termItems(pattern, syntax)),
						"or",
					),
				];
	const verb = check
		? "Check for "
		: count
			? "Count the "
			: filesWithout
				? "List the files without "
				: onlyFiles
					? "List the files with "
					: "Find the ";
	const recursive =
		context.program === "rg" || has(context, "-r", "-R", "--recursive");
	const where: Segment[] =
		paths.length > 0
			? [text(" in "), ...files(paths)]
			: recursive
				? [text(" in every file under this folder")]
				: [];
	const lines = (names: string[], place: string): Segment[][] => {
		const value = values(context, ...names)[0];
		return value
			? [[text(`with ${plural(Number(value), "line")} of context ${place}`)]]
			: [];
	};
	const said = (on: boolean, words: string): Segment[][] =>
		on ? [[text(words)]] : [];
	const include = [
		...values(context, "--include"),
		...values(context, "-g", "--glob"),
	];
	const exclude = values(context, "--exclude", "--exclude-dir");
	const how: Segment[][] = [
		...(include.length > 0
			? [[text("only in files matching "), ...list(include.map(code))]]
			: []),
		...(exclude.length > 0
			? [[text("skipping "), ...list(exclude.map(code))]]
			: []),
		...said(
			has(context, "-n", "--line-number") &&
				!count &&
				!onlyFiles &&
				!filesWithout,
			"with line numbers",
		),
		...said(has(context, "-i", "--ignore-case"), "ignoring case"),
		...said(has(context, "-w", "--word-regexp"), "as whole words"),
		...said(has(context, "-o", "--only-matching"), "only the matching part"),
		...lines(["-A", "--after-context"], "after each"),
		...lines(["-B", "--before-context"], "before each"),
		...lines(["-C", "--context"], "around each"),
		...said(has(context, "-h", "--no-filename"), "without file names"),
	];
	explains(context, "-s", "--no-messages");
	return {
		sentence: [
			text(verb),
			...what,
			...where,
			...how.flatMap((part) => [text(", "), ...part]),
		],
		title: check ? "Check" : count ? "Count lines" : "Search",
	};
}

function hasBare(part: string, delimiter: string): boolean {
	for (let i = 0; i < part.length; i++) {
		if (part[i] === "\\") i++;
		else if (part[i] === delimiter) return true;
	}
	return false;
}

export function sed(context: RuleContext): RuleResult {
	const scripts = values(context, "-e", "--expression");
	const words = positionals(context);
	const script = scripts[0] ?? words[0] ?? "";
	const paths = scripts.length > 0 ? words : words.slice(1);
	const inPlace =
		has(context, "-i", "--in-place") ||
		context.args.some((arg) => /^-i/u.test(arg));
	const where = paths.length > 0 ? [text(" of "), ...files(paths)] : [];
	const range = /^(\d+|\$)(?:,(\d+|\$))?p$/u.exec(script);
	if (range && has(context, "-n", "--quiet", "--silent")) {
		const [, from = "", to] = range;
		const lines = to
			? `lines ${from}–${to === "$" ? "the end" : to}`
			: `line ${from === "$" ? "the last" : from}`;
		return { sentence: [text(`Show ${lines}`), ...where], title: "Show lines" };
	}
	const block =
		/^\/((?:[^/\\]|\\.)+)\/,(\$|\d+|\/((?:[^/\\]|\\.)+)\/)p$/su.exec(script);
	if (block && has(context, "-n", "--quiet", "--silent")) {
		const [, start = "", end = "", endPattern] = block;
		return {
			sentence: [
				text("Show from the line matching "),
				...terms(start),
				...(end === "$"
					? [text(" to the end")]
					: endPattern
						? [text(" to the next line matching "), ...terms(endPattern)]
						: [text(` to line ${end}`)]),
				...where,
			],
			title: "Show a block",
		};
	}
	const substitute = /^s(.)(.*?)\1(.*?)\1([gimI0-9]*)$/su.exec(script);
	if (
		substitute &&
		!hasBare(substitute[2] ?? "", substitute[1] ?? "") &&
		!hasBare(substitute[3] ?? "", substitute[1] ?? "")
	) {
		const [, , from = "", to = ""] = substitute;
		return {
			sentence: [
				text(inPlace ? "Replace " : "Print with "),
				{ term: from },
				text(inPlace ? " with " : " replaced by "),
				{ term: to },
				...(inPlace ? [text(" in "), ...files(paths)] : where),
				...(/\\n/u.test(from)
					? [
							text(", but it never matches: sed reads one line at a time, so "),
							code("\\n"),
							text(" finds no line break"),
						]
					: []),
			],
			title: inPlace ? "Edit" : "Rewrite",
		};
	}
	const remove = /^\/((?:[^/\\]|\\.)*)\/d$/su.exec(script);
	if (remove)
		return {
			sentence: [
				text("Remove the lines containing "),
				{ term: remove[1] ?? "" },
				...(inPlace ? [text(" from "), ...files(paths)] : where),
			],
			title: inPlace ? "Edit" : "Filter lines",
		};
	const picks = has(context, "-n", "--quiet", "--silent");
	return {
		sentence: [
			text(inPlace ? "Edit " : "Run the sed script "),
			...(inPlace ? files(paths) : [code(script), ...where]),
			...(picks ? [text(", printing only the lines it picks")] : []),
		],
		title: inPlace ? "Edit" : "Transform text",
	};
}

export function awkWords(context: RuleContext): {
	program: string;
	fromFile: string | null;
	paths: string[];
	notes: Segment[];
} {
	const notes: Segment[] = [];
	const rest: string[] = [];
	let fromFile: string | null = null;
	const args = context.args;
	for (let i = 0; i < args.length; i++) {
		const word = args[i] ?? "";
		const flag = word.slice(0, 2);
		if (
			rest.length === 0 &&
			(flag === "-F" || flag === "-v" || flag === "-f")
		) {
			const value = word.length > 2 ? word.slice(2) : (args[++i] ?? "");
			if (flag === "-F") notes.push(text(", splitting lines at "), code(value));
			else if (flag === "-v") notes.push(text(", with "), code(value));
			else fromFile = value;
			continue;
		}
		rest.push(word);
	}
	explains(context, "-F", "-v", "-f");
	if (fromFile !== null) return { fromFile, notes, paths: rest, program: "" };
	const [program = "", ...paths] = rest;
	return { fromFile, notes, paths, program };
}

export function awk(context: RuleContext): RuleResult {
	const { fromFile, notes, paths, program } = awkWords(context);
	const where = [
		...(paths.length > 0 ? [text(" in "), ...files(paths)] : []),
		...notes,
	];
	if (fromFile !== null)
		return {
			sentence: [text("Run the awk program in "), file(fromFile), ...where],
			title: "Transform text",
		};
	const range = /^\/(.+)\/\s*,\s*\/(.+)\/\s*$/su.exec(program);
	if (range)
		return {
			sentence: [
				text("Show from the line matching "),
				...terms(range[1] ?? ""),
				text(" to the next line matching "),
				...terms(range[2] ?? ""),
				...where,
			],
			title: "Show a block",
		};
	const columns = /^\{\s*print\s+((?:\$\d+[\s,]*)+)\}$/u.exec(program.trim());
	if (columns)
		return {
			sentence: [
				text(
					`Show column ${(columns[1] ?? "").match(/\d+/gu)?.join(", ") ?? ""}`,
				),
				...where,
			],
			title: "Show columns",
		};
	return {
		sentence: [text("Run the awk program "), code(program), ...where],
		title: "Transform text",
	};
}

export function headTail(context: RuleContext): RuleResult {
	const first = context.program === "head";
	if (!first && has(context, "-f", "-F", "--follow"))
		return {
			sentence: [
				text("Follow "),
				...files(positionals(context)),
				text(" as it grows"),
			],
			title: "Follow a file",
		};
	const bytes = values(context, "-c", "--bytes")[0];
	const paths = positionals(context).filter(
		(path) => !/^-?\d+$/u.test(path) && !(!first && path.startsWith("+")),
	);
	if (bytes)
		return {
			sentence: [
				text(`Show the ${first ? "first" : "last"} ${bytes} bytes`),
				...(paths.length > 0 ? [text(" of "), ...files(paths)] : []),
			],
			title: "Show bytes",
		};
	const from = first
		? undefined
		: (values(context, "-n", "--lines")[0] ??
			context.args.find((arg) => /^\+/u.test(arg)));
	if (from?.startsWith("+")) {
		const line = from.slice(1);
		return {
			sentence: [
				text("Show "),
				...(paths.length > 0 ? [...files(paths), text(" ")] : []),
				...(/^\d+$/u.test(line)
					? [text(`from line ${line} on`)]
					: [text("from line "), code(line), text(" on")]),
			],
			title: "Show lines",
		};
	}
	const count = lineCount(context);
	return {
		sentence: [
			text(`Show ${lines(first ? "first" : "last", count)}`),
			...(paths.length > 0 ? [text(" of "), ...files(paths)] : []),
		],
		title: "Show lines",
	};
}

export function cat(context: RuleContext): RuleResult {
	const paths = positionals(context).filter((path) => path !== "-");
	if (paths.length === 0 && context.output)
		return {
			saysOutput: true,
			sentence: [
				text(
					context.hereDoc !== null
						? `Write ${plural(docLines(context.hereDoc), "line")} to `
						: "Write to ",
				),
				file(context.output),
			],
			title: "Write a file",
		};
	return {
		sentence: [
			text("Show "),
			...files(paths),
			...(has(context, "-n", "--number") ? [text(", with line numbers")] : []),
		],
		title: paths.length > 1 ? "Show files" : "Show a file",
	};
}

export function cutWhat(
	context: RuleContext,
): { what: string; split: Segment[] } | null {
	const fields = values(context, "-f", "--fields")[0];
	const delimiter = values(context, "-d", "--delimiter")[0];
	const characters =
		values(context, "-c", "--characters")[0] ??
		context.args.find((arg) => /^-c\d/u.test(arg))?.slice(2);
	if (fields)
		return {
			split:
				delimiter === undefined || delimiter === "\t"
					? []
					: delimiter === " "
						? [text(", split at spaces")]
						: [text(", split at "), code(delimiter)],
			what: `${/^\d+$/u.test(fields) ? "field" : "fields"} ${fields.replace("-", "–")}`,
		};
	if (characters)
		return { split: [], what: `characters ${characters.replace("-", "–")}` };
	return null;
}
