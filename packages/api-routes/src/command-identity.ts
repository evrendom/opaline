import {
	classifyCommand,
	parseShellCommand,
} from "./session-transcript/transcript-records/command-class.js";
import type { CommandClass } from "./session-transcript/transcript-records/types.js";

export {
	classifyCommand,
	extractScriptFileAccess,
	extractShellFileMutations,
	extractShellFileReads,
	parseShellCommand,
	type ScriptFileEdit,
	type ShellFileMutation,
} from "./session-transcript/transcript-records/command-class.js";

export const SUBSTITUTION = String.raw`\$\((?:[^()'"]|'[^']*'|"[^"]*"|\([^()]*\))*\)|\x60[^\x60]*\x60`;
export const DOUBLE_QUOTED = String.raw`"(?:[^"\\$]|\\.|${SUBSTITUTION}|\$)*"`;
export const WORDS = String.raw`(?:[^;&|\n'"\x60$]|'[^']*'|${DOUBLE_QUOTED}|${SUBSTITUTION}|\$)*`;
export const ASSIGNMENT = String.raw`[A-Za-z_][A-Za-z0-9_]*=(?:${DOUBLE_QUOTED}|'[^']*'|${SUBSTITUTION}|[^\s;&|'"\x60$]|\$)*`;
export const SEPARATOR = String.raw`(?:&&|\|\||;|\n)`;
export const SETUP = String.raw`^(?:\s*(?:#[^\n]*(?:\n|$)|(?:cd|pushd|export|source|set|unset|\.|echo|printf)(?:[ \t]${WORDS})?${SEPARATOR}|(?:${ASSIGNMENT}(?:[ \t]+${ASSIGNMENT})*|REDACTED)[ \t]*${SEPARATOR}))*\s*`;
export const WRAPPERS = [
	String.raw`sudo(?:[ \t]+-[ugCDhpRT][ \t]+\S+|[ \t]+-\S+)*`,
	"doas",
	"command",
	"exec",
	"nohup",
	String.raw`caffeinate(?:[ \t]+-\S+)*`,
	String.raw`time(?:[ \t]+-p)?`,
	String.raw`nice(?:[ \t]+-n[ \t]*-?[0-9]+|[ \t]+-[0-9]+)?`,
	String.raw`stdbuf(?:[ \t]+-\S+)*`,
	"unbuffer",
	String.raw`env(?:[ \t]+-[uCS][ \t]+\S+|[ \t]+-\S+)*`,
	String.raw`timeout(?:[ \t]+-\S+)*[ \t]+[0-9.]+[smhd]?`,
	String.raw`rtk(?:[ \t]+proxy)?`,
	String.raw`(?:npx|bunx|pnpx|uvx|safe-run)(?:[ \t]+(?:-p|--package)[ \t]+\S+|[ \t]+-\S+)*(?:[ \t]+--)?`,
	String.raw`(?:pnpm|yarn|npm)[ \t]+(?:exec|dlx)(?:[ \t]+-\S+)*(?:[ \t]+--)?`,
	String.raw`bun[ \t]+x(?:[ \t]+-\S+)*`,
	String.raw`(?:uv|poetry|pipx)[ \t]+run(?:[ \t]+(?:--with|--project|--directory|--python|--group|--extra|--package)[ \t]+\S+|[ \t]+-\S+)*(?:[ \t]+--)?`,
	String.raw`conda[ \t]+run(?:[ \t]+(?:-n|-p|--name|--prefix)[ \t]+\S+|[ \t]+-\S+)*`,
	String.raw`(?:mise[ \t]+(?:exec|x)|doppler[ \t]+run|op[ \t]+run|dotenv)(?:[ \t]+[^\s;&|]+)*?[ \t]+--`,
];
export const WRAPPER = `(?:${WRAPPERS.join("|")})`;
export const SHELL_WRAPPER = String.raw`^\s*(?:\S*/)?(?:ba|z|da|k)?sh\s+(?:-[A-Za-z]+\s+)*-[A-Za-z]*c\s+`;
export const VALUE_FLAGS =
	"(?:-C|--cwd|--filter|-F|--prefix|--dir|--workspace|-w|--config|--registry|--repo|-R)";

export const PROGRAM_WORD = String.raw`^(${SUBSTITUTION}|[^\s;&|()<>]+)`;

const UNWRAP_QUOTES = ["'", '"'] as const;
const START = new RegExp(
	String.raw`^(?:(?:${ASSIGNMENT}|${WRAPPER})[ \t]+|[!({&][ \t]*)*([^\s;&|<>)-])`,
);
const SUBCOMMAND = new RegExp(
	String.raw`^(?:[ \t]+${VALUE_FLAGS}[ \t]+[^\s;&|]+)*[ \t]+([a-z][a-z0-9:_-]*)(?:\s|$|[;&|)])`,
);

export function commandIdentity(
	command: string,
): { argv0: string; prefix: string } | null {
	let text = command.replace(/\\\n/gu, " ");
	for (const quote of UNWRAP_QUOTES) {
		const whole = new RegExp(
			`${SHELL_WRAPPER}${quote}([\\s\\S]*)${quote}\\s*$`,
		).exec(text);
		if (whole?.[1] !== undefined) {
			text = whole[1];
			break;
		}
	}
	text = text.replace(new RegExp(SETUP), "").replace(START, "$1");
	const word = new RegExp(PROGRAM_WORD).exec(text)?.[1];
	if (!word) return null;
	const argv0 = word.startsWith("$(")
		? word
		: word.replace(/["']/gu, "").replace(/^.*[/\\]/u, "");
	if (!argv0) return null;
	const rest = text.replace(new RegExp(PROGRAM_WORD), "");
	const module = /^[ \t]+(-m[ \t]+[A-Za-z0-9_.]+)/u.exec(rest)?.[1];
	if (module)
		return { argv0, prefix: `${argv0} ${module.replace(/[ \t]+/gu, " ")}` };
	const subcommand = SUBCOMMAND.exec(rest)?.[1];
	return { argv0, prefix: subcommand ? `${argv0} ${subcommand}` : argv0 };
}

const LEADING_CD_STATEMENT =
	/^\s*(?:cd|pushd)[ \t]+("[^"\n]*"|'[^'\n]*'|[^\s;&|]+)[ \t]*(?:&&|;)\s*/u;

export function splitLeadingCd(command: string): {
	command: string;
	dir: string | null;
} {
	let rest = command;
	let dir: string | null = null;
	for (let match = LEADING_CD_STATEMENT.exec(rest); match; ) {
		const after = rest.slice(match[0].length);
		if (!after.trim()) break;
		const target = (match[1] ?? "").replace(/^(["'])(.*)\1$/u, "$2");
		dir =
			dir && !/^[/~]/u.test(target)
				? `${dir.replace(/\/$/u, "")}/${target}`
				: target;
		rest = after;
		match = LEADING_CD_STATEMENT.exec(rest);
	}
	return { command: rest, dir };
}

const SETUP_PROGRAMS = new Set([
	"cd",
	"pushd",
	"popd",
	"export",
	"source",
	".",
	"set",
	"unset",
	"echo",
	"printf",
	"true",
	":",
	"[",
	"[[",
	"test",
]);
const SHELL_KEYWORDS = new Set([
	"for",
	"in",
	"do",
	"done",
	"while",
	"until",
	"if",
	"then",
	"elif",
	"else",
	"fi",
	"case",
	"esac",
	"{",
	"}",
	"function",
]);
const ONLY_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const LOOP_HEADERS = new Set(["for", "case", "select"]);

type Pipeline = { argv0: string; class: CommandClass; stages: string[] };

function pipelinesOf(command: string): Pipeline[] {
	const pipelines: Pipeline[] = [];
	for (const statement of parseShellCommand(command)) {
		if (LOOP_HEADERS.has(statement.words[0] ?? "")) continue;
		const words = statement.words.filter(
			(word, index) => index > 0 || !SHELL_KEYWORDS.has(word),
		);
		const first = words[0];
		if (
			!first ||
			first.startsWith("-") ||
			words.every((word) => ONLY_ASSIGNMENT.test(word))
		)
			continue;
		const text = words.join(" ");
		const identity = commandIdentity(text);
		if (!identity || SETUP_PROGRAMS.has(identity.argv0)) continue;
		const open = pipelines.at(-1);
		if (statement.connector === "|" && open) open.stages.push(identity.prefix);
		else
			pipelines.push({
				argv0: identity.argv0,
				class: classifyCommand(text),
				stages: [identity.prefix],
			});
	}
	return pipelines;
}

function pipelinesRan(command: string): Pipeline[] {
	const flat = pipelinesOf(
		command.replace(new RegExp(SUBSTITUTION, "gu"), "SUB"),
	);
	return flat.length > 0 ? flat : pipelinesOf(command);
}

export function commandChain(command: string): string | null {
	const parts: { text: string; times: number }[] = [];
	for (const pipeline of pipelinesRan(command)) {
		const text = pipeline.stages.join(" | ");
		const last = parts.at(-1);
		if (last?.text === text) last.times++;
		else parts.push({ text, times: 1 });
	}
	return (
		parts
			.map((part) =>
				part.times > 1 ? `${part.text} ×${part.times}` : part.text,
			)
			.join(" · ") || null
	);
}

export type CommandKind =
	| Exclude<CommandClass, "" | "other">
	| "github"
	| "script"
	| "files"
	| "network"
	| "process"
	| "read"
	| "wait"
	| "shell";

const OTHER_KINDS: readonly [CommandKind, ReadonlySet<string>][] = [
	[
		"script",
		new Set([
			"python",
			"python3",
			"node",
			"deno",
			"ruby",
			"perl",
			"php",
			"osascript",
			"bun",
		]),
	],
	[
		"files",
		new Set([
			"rm",
			"mkdir",
			"cp",
			"mv",
			"touch",
			"ln",
			"chmod",
			"chown",
			"tar",
			"unzip",
			"zip",
			"rsync",
			"tee",
			"patch",
			"rmdir",
		]),
	],
	[
		"network",
		new Set(["curl", "wget", "http", "ssh", "scp", "nc", "ping", "dig"]),
	],
	[
		"process",
		new Set(["ps", "lsof", "kill", "pkill", "killall", "pgrep", "top"]),
	],
	[
		"read",
		new Set([
			"cat",
			"sed",
			"head",
			"tail",
			"less",
			"grep",
			"rg",
			"ag",
			"find",
			"fd",
			"ls",
			"tree",
			"wc",
			"jq",
			"yq",
			"awk",
			"cut",
			"sort",
			"uniq",
			"diff",
			"stat",
			"file",
			"du",
			"df",
			"which",
			"readlink",
			"realpath",
		]),
	],
	["wait", new Set(["sleep", "wait"])],
];

const GIT_WEIGHTS = [
	"checkout|switch|restore|stash",
	"merge|rebase|cherry-pick|reset|revert",
	"commit",
	"push",
].map((names) => new Set(names.split("|")));

function gitWeight(pipeline: Pipeline): number {
	const sub = pipeline.stages[0]?.split(" ")[1] ?? "";
	return GIT_WEIGHTS.findIndex((names) => names.has(sub)) + 1;
}

export function describeCommand(
	command: string,
): { chain: string; kind: CommandKind; lead: string } | null {
	const pipelines = pipelinesRan(command);
	const chain = commandChain(command);
	if (!chain || pipelines.length === 0) return null;
	const callClass = classifyCommand(command);
	const ofClass = pipelines.filter((pipeline) => pipeline.class === callClass);
	const classed =
		callClass === "git"
			? [...ofClass].sort((a, b) => gitWeight(b) - gitWeight(a))[0]
			: callClass !== "" && callClass !== "other"
				? ofClass[0]
				: undefined;
	if (classed && callClass !== "" && callClass !== "other") {
		const lead = classed.stages[0] ?? classed.argv0;
		const kind: CommandKind =
			callClass === "git" && classed.argv0 === "gh" ? "github" : callClass;
		return { chain, kind, lead };
	}
	for (const [kind, programs] of OTHER_KINDS) {
		const found = pipelines.find((pipeline) => programs.has(pipeline.argv0));
		if (found) return { chain, kind, lead: found.stages[0] ?? found.argv0 };
	}
	const first = pipelines[0] as Pipeline;
	return { chain, kind: "shell", lead: first.stages[0] ?? first.argv0 };
}

export const SEARCH_TOOLS: ReadonlySet<string> = new Set([
	"Glob",
	"Grep",
	"LS",
	"ToolSearch",
	"WebSearch",
	"file_search",
	"grep_search",
	"list_dir",
	"web_search",
]);

const SEARCH_PROGRAMS: ReadonlySet<string> = new Set([
	"ack",
	"ag",
	"egrep",
	"fd",
	"fgrep",
	"find",
	"grep",
	"locate",
	"ls",
	"rg",
	"tree",
]);

export function isSearchLead(lead: string): boolean {
	return (
		SEARCH_PROGRAMS.has(lead.split(/\s+/u)[0] ?? "") ||
		lead === "git grep" ||
		lead === "git ls-files"
	);
}
