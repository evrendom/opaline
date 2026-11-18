// When Claude Code ran a reply's calls. It holds every call the model wrote
// as queued, and starts one only when nothing is running or when it and
// everything running are safe to run together: tools that only read
// (Read, Grep, Glob, web search and fetch, …) and shell commands it judges
// read-only. A call that changes something waits until every call before it
// is done, and holds back the calls after it (Claude Code 2.1.296's tool
// executor: canExecuteTool, isConcurrencySafe = isReadOnly for Bash).
// Members' transcripts agree: of their calls written together, only
// read-only ones ever came back in the opposite order.
//
// The transcript stamps when a call was written and when its result came
// back, not when it started: where it started is this rule applied.

const ALONGSIDE_TOOLS = new Set([
	"Agent",
	"Glob",
	"Grep",
	"LS",
	"ListAgents",
	"Read",
	"Task",
	"TaskGet",
	"TaskList",
	"ToolSearch",
	"WebFetch",
	"WebSearch",
]);

const READ_PROGRAMS = new Set([
	"basename",
	"cat",
	"cd",
	"cmp",
	"column",
	"cut",
	"date",
	"df",
	"diff",
	"dirname",
	"du",
	"echo",
	"egrep",
	"fgrep",
	"file",
	"find",
	"grep",
	"head",
	"jq",
	"ls",
	"md5",
	"nl",
	"od",
	"printf",
	"pwd",
	"readlink",
	"realpath",
	"rg",
	"sed",
	"sha256sum",
	"shasum",
	"sort",
	"stat",
	"strings",
	"tail",
	"test",
	"tr",
	"tree",
	"true",
	"type",
	"uniq",
	"wc",
	"which",
	"xxd",
]);

const READ_GIT = new Set([
	"blame",
	"cat-file",
	"describe",
	"diff",
	"for-each-ref",
	"grep",
	"log",
	"ls-files",
	"ls-tree",
	"merge-base",
	"rev-list",
	"rev-parse",
	"shortlog",
	"show",
	"status",
]);

function readsOnly(command: string): boolean {
	const words = command.trim().split(/\s+/u);
	while (
		words[0] &&
		(/^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[0]) ||
			words[0] === "command" ||
			words[0] === "env")
	)
		words.shift();
	const [program, ...rest] = words;
	if (!program) return true;
	if (program === "git") {
		let index = 0;
		while (rest[index]?.startsWith("-")) {
			index += rest[index] === "-C" || rest[index] === "-c" ? 2 : 1;
		}
		const subcommand = rest[index] ?? "";
		if (subcommand === "branch")
			return rest
				.slice(index + 1)
				.every((word) =>
					/^-(a|r|v|vv|l|-list|-show-current|-all)$/u.test(word),
				);
		if (subcommand === "remote")
			return rest.slice(index + 1).every((word) => word === "-v");
		return READ_GIT.has(subcommand);
	}
	if (!READ_PROGRAMS.has(program)) return false;
	if (program === "sed")
		return !rest.some((word) => /^-[a-zA-Z]*i/u.test(word));
	if (program === "find")
		return !rest.some((word) =>
			["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(word),
		);
	return true;
}

function unquoted(command: string): string | null {
	if (/`|\$\(/u.test(command)) return null;
	let out = "";
	let quote: string | null = null;
	for (let index = 0; index < command.length; index++) {
		const char = command[index] as string;
		if (quote) {
			if (char === "\\" && quote === '"') index++;
			else if (char === quote) {
				quote = null;
				out += "Q";
			}
			continue;
		}
		if (char === "\\") {
			index++;
			out += "Q";
		} else if (char === "'" || char === '"') quote = char;
		else out += char;
	}
	return out;
}

export function isReadOnlyCommand(chain: string): boolean {
	const bare = unquoted(chain);
	if (bare === null) return false;
	const quiet = bare.replace(/[\d&]?>&\d|[\d&]?>\s*\/dev\/null/gu, "");
	if (/>|\btee\b/u.test(quiet)) return false;
	return quiet.split(/&&|\|\||[;|\n]/u).every(readsOnly);
}

export function runsAlongside(toolName: string, command?: string): boolean {
	if (toolName === "Bash") return command ? isReadOnlyCommand(command) : false;
	return ALONGSIDE_TOOLS.has(toolName);
}
