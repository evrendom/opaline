import {
	commandProgram,
	parseShellCommand,
	type SimpleCommand,
} from "./command-class.js";

/**
 * Which part of a compound shell command decided its exit status, by shell
 * semantics and nothing else (parser 12):
 *
 * - a list (`a; b`, newlines, `&`) exits with its last part, so the
 *   statuses of the parts before it are lost (`exit_masked` `list`);
 * - an and-or chain exits with the last pipeline that ran: the last one when
 *   it is joined by `&&` and the chain succeeded, or by `||` and it failed;
 *   otherwise it is unknown, unless the output names the one part that
 *   failed (zsh `no matches found: <pattern>`, `command not found: <name>`)
 *   in a chain of `&&` only;
 * - a pipeline without `set -o pipefail` exits with its last stage, so when
 *   that stage is a filter (grep, tail, head, wc …) the statuses of the
 *   commands feeding it are lost (`exit_masked` `pipe`).
 *
 * Commands with compound constructs (`if`, loops, functions, subshells,
 * groups) and `set -e` failures are left unknown: their control flow is not
 * modelled, so no part is named.
 */

export interface ShellExitStage {
	readonly program: string;
	/** The stage's source text, clipped. */
	readonly text: string;
	/** Its first words, clipped, to match the part the output names. */
	readonly words: readonly string[];
}

export interface ShellExitPipeline {
	/** The operator that joined it to the pipeline before; null for the first. */
	readonly connector: "&&" | "||" | null;
	readonly stages: readonly ShellExitStage[];
}

/** The exit-deciding structure of a shell command, read when the call is made. */
export interface ShellExitShape {
	/** The and-or chain of the command's last list. */
	readonly chain: readonly ShellExitPipeline[];
	readonly lists: number;
	readonly pipefail: boolean;
	readonly errexit: boolean;
}

/** Filters a pipeline ends in: they exit 0 whatever the command before them did. */
const FILTERS: ReadonlySet<string> = new Set([
	"awk",
	"cat",
	"column",
	"cut",
	"egrep",
	"fgrep",
	"fold",
	"grep",
	"head",
	"jq",
	"less",
	"more",
	"nl",
	"paste",
	"rev",
	"rg",
	"sed",
	"sort",
	"tail",
	"tee",
	"tr",
	"uniq",
	"wc",
]);
const STAGE_TEXT_MAX = 256;
const STAGE_WORDS_MAX = 16;
const NAMED_SCAN_CHARS = 2_048;
/** zsh writes these for a part that never ran; the pattern or name is literal. */
const NO_MATCHES_PATTERN =
	/^(?:\(eval\)|zsh|[\w./-]*sh)(?::\d+)?: no matches found: (.+)$/gmu;
const NOT_FOUND_ZSH_PATTERN =
	/^(?:\(eval\)|zsh)(?::\d+)?: command not found: (\S+)$/gmu;
const NOT_FOUND_SH_PATTERN =
	/^(?:[\w./-]*sh: )?(?:line \d+: )?(\S+): command not found$/gmu;
const CLAUDE_EXIT_LINE = /^\s*Exit code:? -?\d+[ \t]*(?:\n|$)/u;
const CLAUDE_CWD_FOOTER = /(?:^|\n)Shell cwd was reset to [^\n]*\s*$/u;
const CLAUDE_NO_OUTPUT = "(Bash completed with no output)";

/** The exit structure of a command, or undefined when its control flow is not modelled. */
export function readShellExitShape(
	command: string,
): ShellExitShape | undefined {
	if (command.trim() === "") return undefined;
	const commands = parseShellCommand(command);
	if (commands.length === 0 || commands.some((simple) => simple.nested))
		return undefined;
	let pipefail = false;
	let errexit = false;
	const lists: SimpleCommand[][] = [];
	for (const simple of commands) {
		if (simple.words[0] === "set") {
			const args = simple.words.slice(1);
			for (const [index, arg] of args.entries()) {
				if (/^-[a-z]*e/u.test(arg)) errexit = true;
				if (/^-[a-z]*o$/u.test(arg)) {
					if (args[index + 1] === "pipefail") pipefail = true;
					if (args[index + 1] === "errexit") errexit = true;
				}
			}
		}
		if (simple.connector === null || simple.connector === ";")
			lists.push([simple]);
		else lists.at(-1)?.push(simple);
	}
	const chain: ShellExitPipeline[] = [];
	for (const simple of lists.at(-1) ?? []) {
		const stage: ShellExitStage = {
			program: commandProgram(simple.words),
			text: clip(simple.text, STAGE_TEXT_MAX),
			words: simple.words
				.slice(0, STAGE_WORDS_MAX)
				.map((word) => clip(word, STAGE_TEXT_MAX)),
		};
		const last = chain.at(-1);
		if (simple.connector === "|" && last !== undefined)
			chain[chain.length - 1] = { ...last, stages: [...last.stages, stage] };
		else
			chain.push({
				connector:
					simple.connector === "&&" || simple.connector === "||"
						? simple.connector
						: null,
				stages: [stage],
			});
	}
	return chain.length === 0
		? undefined
		: { chain, lists: lists.length, pipefail, errexit };
}

export interface ShellExitFacts {
	/** The source text of the part whose status is the call's exit code. */
	readonly decidedBy?: string;
	/** Why statuses of other parts never reached the exit code: `list`, `pipe`, or both. */
	readonly masked?: string;
}

/**
 * Which part decided a finished command's exit code, given whether it exited
 * 0 (undefined when the transcript does not say) and its output.
 */
export function readShellExitFacts(
	shape: ShellExitShape,
	succeeded: boolean | undefined,
	output: string,
): ShellExitFacts {
	const last = shape.chain.at(-1);
	if (last === undefined) return {};
	let pipeline: ShellExitPipeline | undefined;
	if (shape.errexit && succeeded !== true) pipeline = undefined;
	else if (
		last.connector === null ||
		(last.connector === "&&" && succeeded === true) ||
		(last.connector === "||" && succeeded === false)
	)
		pipeline = last;
	else if (
		succeeded === false &&
		shape.chain.every((entry) => entry.connector !== "||")
	)
		pipeline = namedFailure(shape.chain, output);
	const lastStage = pipeline?.stages.at(-1);
	// With pipefail a failed pipeline exits with its last failing stage.
	const stage =
		pipeline !== undefined &&
		pipeline.stages.length > 1 &&
		shape.pipefail &&
		succeeded !== true
			? undefined
			: lastStage;
	const masks: string[] = [];
	if (shape.lists > 1 && !shape.errexit) masks.push("list");
	if (
		pipeline !== undefined &&
		lastStage !== undefined &&
		pipeline.stages.length > 1 &&
		!shape.pipefail &&
		FILTERS.has(lastStage.program)
	)
		masks.push("pipe");
	return {
		...(stage === undefined ? {} : { decidedBy: stage.text }),
		...(masks.length === 0 ? {} : { masked: masks.join(",") }),
	};
}

/**
 * The pipeline of an `&&` chain the output names as the one that failed: a
 * pattern zsh found no match for, or a program the shell did not find, in
 * exactly one stage, which must end its pipeline to decide its status.
 */
function namedFailure(
	chain: readonly ShellExitPipeline[],
	output: string,
): ShellExitPipeline | undefined {
	const scanned =
		output.length <= NAMED_SCAN_CHARS * 2
			? output
			: `${output.slice(0, NAMED_SCAN_CHARS)}\n${output.slice(-NAMED_SCAN_CHARS)}`;
	const patterns = [...scanned.matchAll(NO_MATCHES_PATTERN)].map((match) =>
		(match[1] ?? "").trim(),
	);
	const missing = [
		...scanned.matchAll(NOT_FOUND_ZSH_PATTERN),
		...scanned.matchAll(NOT_FOUND_SH_PATTERN),
	].map((match) => match[1] ?? "");
	const named = chain.flatMap((pipeline) =>
		pipeline.stages.flatMap((stage, index) =>
			stage.words.some((word) => patterns.includes(word)) ||
			missing.includes(stage.program) ||
			missing.includes(stage.words[0] ?? "")
				? [{ pipeline, last: index === pipeline.stages.length - 1 }]
				: [],
		),
	);
	const only = named.length === 1 ? named[0] : undefined;
	return only?.last === true ? only.pipeline : undefined;
}

/**
 * True when a Claude Code Bash result printed nothing: its text is empty, or
 * only Claude Code's own `(Bash completed with no output)`, once the `Exit
 * code N` line and the `Shell cwd was reset to …` footer it adds are removed.
 */
export function isEmptyClaudeShellOutput(text: string): boolean {
	const body = text
		.replace(CLAUDE_EXIT_LINE, "")
		.replace(CLAUDE_CWD_FOOTER, "")
		.trim();
	return body === "" || body === CLAUDE_NO_OUTPUT;
}

function clip(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
