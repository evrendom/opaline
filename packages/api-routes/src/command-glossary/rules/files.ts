import { code, file, files, list, plural, text } from "../sentence.js";
import {
	explains,
	has,
	positionals,
	type Rule,
	type RuleContext,
	type RuleResult,
} from "./context.js";

export function rm(context: RuleContext): RuleResult {
	const paths = positionals(context);
	return {
		sentence: [
			text("Delete "),
			...files(paths),
			...(has(context, "-r", "-R", "--recursive")
				? [text(` and everything in ${paths.length > 1 ? "them" : "it"}`)]
				: []),
			...(has(context, "-f", "--force") ? [text(", no error if missing")] : []),
		],
		title: "Delete",
	};
}

export const fileRule =
	(
		title: string,
		verb: string,
		extra?: (context: RuleContext) => string | null,
	): Rule =>
	(context) => {
		const paths = positionals(context);
		const more = extra?.(context);
		return {
			sentence: [
				text(`${verb} `),
				...files(paths),
				...(more ? [text(more)] : []),
			],
			title,
		};
	};

export function copyMove(context: RuleContext): RuleResult {
	const paths = positionals(context);
	const target = paths.at(-1);
	const sources = paths.slice(0, -1);
	const move = context.program === "mv";
	const name = (path: string) => path.replace(/\/+$/u, "").split("/").at(-1);
	const into =
		target && sources.length === 1 && name(sources[0] ?? "") === name(target);
	return {
		sentence: [
			text(move ? "Move " : "Copy "),
			...files(sources),
			...(target
				? into
					? [text(" into "), file(target.replace(/\/[^/]*$/u, "") || "/")]
					: [text(" to "), file(target)]
				: []),
		],
		title: move ? "Move" : "Copy",
	};
}

export const find: Rule = (context) => {
	const args = context.args;
	const start = args.findIndex((arg) => /^[-(!]/u.test(arg));
	const roots = start < 0 ? args : args.slice(0, start);
	const tests = start < 0 ? [] : args.slice(start);
	const after = (name: string) => {
		const at = tests.indexOf(name);
		return at >= 0 ? tests[at + 1] : undefined;
	};
	const valuesOf = (names: string[], negated: boolean) =>
		tests.flatMap((arg, index) =>
			names.includes(arg) &&
			(tests[index - 1] === "-not" || tests[index - 1] === "!") === negated
				? [tests[index + 1] ?? ""]
				: [],
		);
	const names = valuesOf(["-name", "-iname"], false);
	const notNames = valuesOf(["-name", "-iname"], true);
	const paths = valuesOf(["-path", "-wholename"], false);
	const notPaths = valuesOf(["-path", "-wholename"], true);
	const type = after("-type");
	const depth = after("-maxdepth");
	const exec = tests.indexOf("-exec");
	const run =
		exec >= 0
			? tests
					.slice(
						exec + 1,
						tests.findIndex(
							(arg, i) =>
								i > exec && (arg === ";" || arg === "+" || arg === "\\;"),
						),
					)
					.join(" ")
			: null;
	const known = new Set([
		"-name",
		"-iname",
		"-type",
		"-maxdepth",
		"-path",
		"-wholename",
		"-exec",
		"-delete",
		"-print",
		"-o",
		"-or",
		"-not",
		"!",
		"(",
		")",
		"-prune",
		"-a",
		"-and",
	]);
	const skip = new Set<number>();
	for (const [index, arg] of tests.entries())
		if (
			["-name", "-iname", "-type", "-maxdepth", "-path", "-wholename"].includes(
				arg,
			)
		)
			skip.add(index + 1);
	const other = tests.filter(
		(arg, index) => arg.startsWith("-") && !known.has(arg) && !skip.has(index),
	);
	explains(context, ...tests.filter((arg) => arg.startsWith("-")));
	return {
		also: other.map((arg) => {
			const next = tests[tests.indexOf(arg) + 1];
			return next && !next.startsWith("-") ? `${arg} ${next}` : arg;
		}),
		sentence: [
			text(
				`Find ${type === "d" ? "folders" : type === "f" ? "files" : "files and folders"}`,
			),
			...(names.length > 0
				? [text(" named "), ...list(names.map((name) => ({ term: name })))]
				: []),
			...(paths.length > 0
				? [
						text(" whose path matches "),
						...list(paths.map((path) => ({ term: path }))),
					]
				: []),
			text(" under "),
			...(roots.length > 0 ? files(roots) : [text("this folder")]),
			...(notNames.length > 0
				? [
						text(", leaving out those named "),
						...list(notNames.map((name) => ({ term: name }))),
					]
				: []),
			...(notPaths.length > 0
				? [
						text(", leaving out paths matching "),
						...list(notPaths.map((path) => ({ term: path }))),
					]
				: []),
			...(depth
				? [text(`, at most ${plural(Number(depth), "level")} deep`)]
				: []),
			...(tests.includes("-delete") ? [text(", and delete them")] : []),
			...(run ? [text(", and run "), code(run), text(" on each")] : []),
		],
		title: "Find files",
	};
};
