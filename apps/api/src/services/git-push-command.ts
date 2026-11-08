import { parseShellCommand } from "@rudel/api-routes/transcript-records";

export interface CommandPush {
	readonly branch: string;
	readonly sourceBranch: string;
}

const GIT_VALUE_OPTIONS: ReadonlySet<string> = new Set([
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--exec-path",
]);

const PUSH_VALUE_FLAGS: ReadonlySet<string> = new Set([
	"-o",
	"--push-option",
	"--repo",
	"--receive-pack",
	"--exec",
]);

const LEADING_WORDS: ReadonlySet<string> = new Set([
	"do",
	"then",
	"else",
	"{",
	"!",
	"time",
	"command",
	"exec",
]);

const NOT_A_PUSH_FLAGS =
	/^(?:-n|--dry-run|-d|--delete|--prune|--mirror|-[A-Za-z]*n[A-Za-z]*)$/u;

export function commandPushes(command: string): CommandPush[] {
	const pushes: CommandPush[] = [];
	let afterOr = false;
	for (const statement of parseShellCommand(command)) {
		if (statement.connector === null || statement.connector === ";")
			afterOr = false;
		else if (statement.connector === "||") afterOr = true;
		if (afterOr) continue;
		const args = pushArguments(statement.words);
		if (args === undefined) continue;
		if (args.some((arg) => NOT_A_PUSH_FLAGS.test(arg.split("=", 1)[0] ?? "")))
			continue;
		const positionals: string[] = [];
		for (let index = 0; index < args.length; index++) {
			const arg = args[index] ?? "";
			if (PUSH_VALUE_FLAGS.has(arg)) {
				index++;
				continue;
			}
			if (arg.startsWith("-")) continue;
			positionals.push(arg);
		}
		const refspec = positionals[1] ?? "";
		const [source = "", destination] = refspec
			.replace(/^\+/u, "")
			.split(":", 2);
		const branch = refName(destination ?? source);
		pushes.push({
			branch: branch === "HEAD" ? "" : branch,
			sourceBranch: refName(source) === "HEAD" ? "" : refName(source),
		});
	}
	return pushes;
}

function pushArguments(words: readonly string[]): string[] | undefined {
	let index = 0;
	while (
		LEADING_WORDS.has(words[index] ?? "") ||
		/^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[index] ?? "")
	)
		index++;
	if ((words[index] ?? "").split("/").at(-1) !== "git") return undefined;
	index++;
	while (index < words.length && (words[index] ?? "").startsWith("-")) {
		const option = words[index] ?? "";
		index += GIT_VALUE_OPTIONS.has(option) ? 2 : 1;
	}
	return words[index] === "push" ? words.slice(index + 1) : undefined;
}

function refName(ref: string): string {
	return /^[$`]/u.test(ref) ? "" : ref.replace(/^refs\/heads\//u, "");
}
