import { findPythonEdits } from "../python-edits.js";
import { code, file, plural, type Segment, text } from "../sentence.js";
import {
	docLines,
	explains,
	positionals,
	type RuleContext,
	type RuleResult,
	values,
} from "./context.js";
import { looksLikePath } from "./packages.js";

export function interpreter(context: RuleContext): RuleResult {
	const language = context.program.startsWith("python")
		? "Python"
		: context.program === "node"
			? "JavaScript"
			: context.program;
	const inline = values(context, "-c", "-e", "--eval")[0];
	const module = values(context, "-m")[0];
	const takesValue = new Set([
		"-c",
		"-e",
		"--eval",
		"-m",
		"-W",
		"-X",
		"-r",
		"--require",
	]);
	const args: string[] = [];
	for (let i = 0; i < context.args.length; i++) {
		const arg = context.args[i] ?? "";
		if (takesValue.has(arg)) {
			i++;
			continue;
		}
		if (!arg.startsWith("-")) args.push(arg);
	}
	explains(context, "-I", "-u", "-B", "-S", "-E");
	const script =
		context.hereDoc ?? (language === "Python" ? inline : undefined);
	const edited =
		script && language === "Python" ? findPythonEdits(script) : null;
	if (edited) {
		const [first] = edited.edits;
		const before = edited.edits.reduce(
			(sum, edit) => sum + edit.before.split("\n").length,
			0,
		);
		const after = edited.edits.reduce(
			(sum, edit) => sum + edit.after.split("\n").length,
			0,
		);
		return {
			edits: edited.edits,
			sentence: [
				text("Change "),
				file(first?.file ?? ""),
				text(
					edited.edits.length > 1
						? ` in ${edited.edits.length} places, ${plural(before, "line")} replaced by ${after}`
						: `: ${plural(before, "line")} replaced by ${after}`,
				),
				...(edited.checksFirst
					? [text(", stopping if the old text isn't there")]
					: []),
			],
			title: "Edit",
		};
	}
	if (context.hereDoc !== null)
		return {
			sentence: [
				text(`Run a ${docLines(context.hereDoc)}-line ${language} script`),
			],
			title: "Run a script",
		};
	if (inline !== undefined) {
		const code_ = inline.split("\n").filter((line) => line.trim());
		return {
			sentence:
				code_.length > 1
					? [text(`Run ${code_.length} lines of ${language}`)]
					: [text(`Run a line of ${language}: `), code(code_[0] ?? "")],
			title: "Run code",
		};
	}
	if (module)
		return {
			sentence: [text("Run the module "), code(module)],
			title: "Run a module",
		};
	const scriptArgs = args[0]
		? context.args.slice(context.args.indexOf(args[0]) + 1)
		: [];
	explains(context, ...scriptArgs.filter((arg) => arg.startsWith("-")));
	return {
		sentence: [
			text("Run "),
			...(args[0] ? [file(args[0])] : [text(`${language}`)]),
			...(scriptArgs.length > 0
				? [
						text(" with "),
						...scriptArgs.flatMap((arg, index): Segment[] => [
							...(index > 0 ? [text(" ")] : []),
							looksLikePath(arg) && !arg.startsWith("-")
								? file(arg)
								: code(arg),
						]),
					]
				: []),
		],
		title: "Run a script",
	};
}

export function shell(context: RuleContext): RuleResult {
	const flag = context.args.findIndex((arg) => /^-[a-z]*c$/u.test(arg));
	const inline = flag >= 0 ? context.args[flag + 1] : undefined;
	const script = positionals(context)[0];
	if (inline)
		return {
			sentence: [text("Run in a new shell: "), code(inline)],
			title: "Run in a shell",
		};
	if (context.hereDoc !== null)
		return {
			sentence: [text(`Run a ${docLines(context.hereDoc)}-line shell script`)],
			title: "Run a script",
		};
	return {
		sentence: [text("Run "), ...(script ? [file(script)] : [text("a shell")])],
		title: "Run a script",
	};
}
