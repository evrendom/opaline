import { code, file, files, list, type Segment, text } from "../sentence.js";
import { explains, type RuleContext, type RuleResult } from "./context.js";

const SCRIPT_TITLES: Record<string, string> = {
	build: "Build",
	"check-types": "Check types",
	dev: "Start the dev server",
	lint: "Lint",
	test: "Run tests",
	typecheck: "Check types",
	vitest: "Run tests",
	biome: "Lint",
	tsc: "Check types",
};

const PACKAGE_FOLDER_FLAGS = new Set(["--cwd", "--prefix", "-C", "--dir"]);
const PACKAGE_FILTER_FLAGS = new Set(["--filter", "-F"]);
const PACKAGE_VERBS = new Set([
	"run",
	"test",
	"install",
	"i",
	"add",
	"remove",
	"rm",
	"exec",
	"x",
	"dlx",
]);
const TEST_VALUE_FLAGS = new Set([
	"--preload",
	"-r",
	"--timeout",
	"-t",
	"--test-name-pattern",
	"--rerun-each",
	"--seed",
	"--reporter",
	"--coverage-dir",
	"--max-concurrency",
]);
const isScriptFile = (word: string) => /\.[cm]?[jt]sx?$/u.test(word);
export const looksLikePath = (word: string) =>
	/[/.]/u.test(word) && !/\s/u.test(word);

export function packageManager(context: RuleContext): RuleResult | null {
	const folders: string[] = [];
	const filters: string[] = [];
	const valued = new Map<string, string>();
	const leading: string[] = [];
	let verb: string | null = null;
	let target: string | null = null;
	const rest: string[] = [];
	const words = context.args;
	for (let i = 0; i < words.length; i++) {
		const word = words[i] ?? "";
		if (target !== null) {
			rest.push(word);
			continue;
		}
		const [flag = "", inline] = word.split(/=(.*)/su);
		const takesValue =
			PACKAGE_FOLDER_FLAGS.has(flag) ||
			PACKAGE_FILTER_FLAGS.has(flag) ||
			(verb === "test" && TEST_VALUE_FLAGS.has(flag));
		if (takesValue) {
			const value = inline ?? words[++i] ?? "";
			if (PACKAGE_FOLDER_FLAGS.has(flag)) folders.push(value);
			else if (PACKAGE_FILTER_FLAGS.has(flag)) filters.push(value);
			else valued.set(flag, value);
			continue;
		}
		if (word.startsWith("-")) {
			leading.push(word);
			continue;
		}
		if (verb === null && PACKAGE_VERBS.has(word)) {
			verb = word;
			continue;
		}
		if (verb === "test") rest.push(word);
		else target = word;
	}
	explains(
		context,
		...words
			.filter((word) => word.startsWith("-"))
			.map((word) => word.split("=")[0] ?? word),
	);
	const where: Segment[] = [
		...(folders.length > 0 ? [text(" in "), ...files(folders)] : []),
		...(filters.length > 0 ? [text(" for "), ...list(filters.map(code))] : []),
	];
	const say = (title: string, ...sentence: Segment[]): RuleResult => ({
		...(leading.length > 0 ? { also: leading } : {}),
		sentence: [...sentence, ...where],
		title,
	});
	const shown = (words: string[]) =>
		words.map((word) =>
			looksLikePath(word) && !word.startsWith("-") ? file(word) : code(word),
		);
	if (verb === "test") {
		const preload = valued.get("--preload") ?? valued.get("-r");
		const pattern =
			valued.get("-t") ?? valued.get("--test-name-pattern") ?? null;
		const timeout = valued.get("--timeout");
		const testFiles = rest.filter((word) => !word.startsWith("-"));
		return {
			...say(
				"Run tests",
				text(testFiles.length > 0 ? "Run the tests in " : "Run the tests"),
				...files(testFiles),
				...(pattern ? [text(" whose names match "), { term: pattern }] : []),
				...(preload ? [text(", loading "), file(preload), text(" first")] : []),
				...(timeout ? [text(`, each allowed ${timeout} ms`)] : []),
			),
			also: [...leading, ...rest.filter((word) => word.startsWith("-"))],
		};
	}
	if (verb === "install" || verb === "i")
		return target
			? say(
					"Add a package",
					text("Add the package "),
					...list([target, ...rest].map(code)),
				)
			: say("Install", text("Install the packages"));
	if (verb === "add")
		return say(
			"Add a package",
			text("Add the package "),
			...list([target ?? "", ...rest].map(code)),
		);
	if (verb === "remove" || verb === "rm")
		return say(
			"Remove a package",
			text("Remove the package "),
			...list([target ?? "", ...rest].map(code)),
		);
	if (verb === "exec" || verb === "x" || verb === "dlx" || !target) return null;
	if (isScriptFile(target) || (verb === null && looksLikePath(target)))
		return say(
			"Run a file",
			text("Run "),
			file(target),
			...(rest.length > 0 ? [text(" with "), ...list(shown(rest))] : []),
		);
	if (verb === null && context.program === "npm") return null;
	if (target === "vitest") {
		const testFiles = rest.filter(
			(word) => word !== "run" && !word.startsWith("-"),
		);
		return say(
			"Run tests",
			text(testFiles.length > 0 ? "Run the tests in " : "Run the tests"),
			...files(testFiles),
		);
	}
	const title = SCRIPT_TITLES[target];
	return say(
		title ?? "Run a script",
		text(title ? `${title}: ` : "Run the script "),
		code([target, ...rest].join(" ")),
	);
}
