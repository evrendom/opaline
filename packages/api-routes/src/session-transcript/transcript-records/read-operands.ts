const GREP_PROGRAMS: ReadonlySet<string> = new Set(["grep", "egrep", "fgrep"]);

const GREP_VALUE_FLAGS: ReadonlySet<string> = new Set([
	"-e",
	"-f",
	"-A",
	"-B",
	"-C",
	"-m",
	"-d",
	"-D",
	"--regexp",
	"--file",
	"--after-context",
	"--before-context",
	"--context",
	"--max-count",
	"--label",
	"--exclude",
	"--include",
	"--exclude-dir",
	"--exclude-from",
	"--binary-files",
	"--devices",
	"--directories",
]);

const GREP_SHORT_VALUE_LETTERS = "efABCmdD";

export function grepFileOperands(
	program: string,
	args: readonly string[],
): string[] {
	if (!GREP_PROGRAMS.has(program)) return [];
	const operands: string[] = [];
	let patternGiven = false;
	let optionsEnded = false;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index] ?? "";
		if (optionsEnded || arg === "-" || !arg.startsWith("-")) {
			operands.push(arg);
			continue;
		}
		if (arg === "--") {
			optionsEnded = true;
			continue;
		}
		if (arg.startsWith("--")) {
			const [name = "", value] = arg.split("=", 2);
			if (name === "--recursive" || name === "--dereference-recursive")
				return [];
			if (name === "--regexp" || name === "--file") patternGiven = true;
			if (value === undefined && GREP_VALUE_FLAGS.has(name)) index++;
			continue;
		}
		const letters = arg.slice(1);
		if (/[rR]/u.test(letters.replace(/[0-9].*$/u, ""))) return [];
		for (let at = 0; at < letters.length; at++) {
			const letter = letters[at] ?? "";
			if (!GREP_SHORT_VALUE_LETTERS.includes(letter)) continue;
			if (letter === "e" || letter === "f") patternGiven = true;
			if (at === letters.length - 1) index++;
			break;
		}
	}
	return patternGiven ? operands : operands.slice(1);
}

export function wcFileOperands(
	program: string,
	args: readonly string[],
): string[] {
	if (program !== "wc") return [];
	let optionsEnded = false;
	return args.filter((arg) => {
		if (optionsEnded) return true;
		if (arg === "--") {
			optionsEnded = true;
			return false;
		}
		return arg === "-" || !arg.startsWith("-");
	});
}
