import { readPythonFileAccess } from "./python-file-access.js";
import type { CommandClass } from "./types.js";

/**
 * Deterministic shell command classification and file-mutation extraction.
 *
 * Rules are explicit and order-independent: each simple command is classified
 * by its executable and sub-command or script name, and a compound command takes
 * the highest-precedence class among its parts. Nothing is guessed from prose.
 */

/**
 * How firmly the command text supports a mutation. Nothing here observes the
 * file system, so even `direct` is only an attempt that the call result may
 * refute; the other two are weaker still:
 *
 * - `direct`: an unconditional command whose effect on the working tree is
 *   explicit. Counts as a file change when its tool call did not fail.
 * - `conditional`: the command sits in a branch that may never have run
 *   (`true || rm x`, `test -f x && rm x; ...`, `then rm x`).
 * - `index`: a Git operation that changes the index only (`git rm --cached`).
 */
export type ShellMutationBasis = "direct" | "conditional" | "index";

export interface ShellFileMutation {
	readonly basis: ShellMutationBasis;
	readonly operation: "write" | "edit" | "delete";
	readonly path: string;
}

/** The control operator that joined a command to the one before it. */
export type ShellConnector = "&&" | "||" | "|" | ";";

/** A here-document of a command: its delimiter and the body the shell feeds it. */
export interface ShellHeredoc {
	readonly delimiter: string;
	/** True when the delimiter was quoted, so the shell expands nothing in the body. */
	readonly quoted: boolean;
	readonly body: string;
}

export interface SimpleCommand {
	/** Null for the first command; `;` also covers newlines and `&`. */
	readonly connector: ShellConnector | null;
	/** Here-documents the command reads, in order (data, never commands). */
	readonly heredocs: readonly ShellHeredoc[];
	/**
	 * True inside a compound construct (`if`/`while`/`for`/`case` bodies,
	 * `{ }` groups, `( )` subshells). The splitter does not model their control
	 * flow, so nothing in them is known to have run.
	 */
	readonly nested: boolean;
	readonly redirects: readonly {
		readonly operator: string;
		readonly target: string;
	}[];
	/** The command's own source text, as written, without its operator. */
	readonly text: string;
	readonly words: readonly string[];
}

const CLASS_PRECEDENCE: readonly Exclude<CommandClass, "">[] = [
	"test",
	"typecheck",
	"lint",
	"build",
	"migrate",
	"install",
	"git",
	"other",
];

const SCRIPT_CLASS_RULES: readonly {
	readonly class: Exclude<CommandClass, "" | "git" | "other">;
	readonly pattern: RegExp;
}[] = [
	{
		class: "test",
		pattern:
			/(?:^|[:_./-])(?:test|tests|e2e|spec|vitest|jest|pytest)(?:$|[:_./-])/u,
	},
	{
		class: "typecheck",
		pattern:
			/(?:^|[:_./-])(?:typecheck|type-check|check-types|check-type|types|tsc)(?:$|[:_./-])/u,
	},
	{
		class: "lint",
		pattern:
			/(?:^|[:_./-])(?:lint|format|fmt|biome|eslint|prettier|oxlint)(?:$|[:_./-])/u,
	},
	{
		class: "build",
		pattern: /(?:^|[:_./-])(?:build|compile|bundle|dist|package)(?:$|[:_./-])/u,
	},
	{
		class: "migrate",
		pattern: /(?:^|[:_./-])(?:migrate|migrations?|db-push)(?:$|[:_./-])/u,
	},
	{
		class: "install",
		pattern: /(?:^|[:_./-])(?:install|bootstrap|setup)(?:$|[:_./-])/u,
	},
];

const JS_PACKAGE_MANAGERS: ReadonlySet<string> = new Set([
	"bun",
	"npm",
	"pnpm",
	"yarn",
	"deno",
]);
const SCRIPT_RUNNERS: ReadonlySet<string> = new Set([
	"make",
	"just",
	"task",
	"turbo",
	"nx",
	"lerna",
	"rush",
]);
const PASSTHROUGH_PREFIXES: ReadonlySet<string> = new Set([
	"sudo",
	"env",
	"time",
	"nohup",
	"command",
	"exec",
	"nice",
	"timeout",
	"caffeinate",
	"doppler",
	"dotenv",
	"xargs",
]);
const EXECUTOR_PREFIXES: ReadonlySet<string> = new Set([
	"npx",
	"bunx",
	"pnpx",
	"dlx",
	"uvx",
	"pipx",
	"safe-run",
]);
const JS_INSTALL_SUBCOMMANDS: ReadonlySet<string> = new Set([
	"install",
	"i",
	"add",
	"ci",
	"remove",
	"rm",
	"uninstall",
	"update",
	"up",
	"upgrade",
	"link",
	"unlink",
	"patch",
	"prune",
	"dedupe",
]);
const TEST_EXECUTABLES: ReadonlySet<string> = new Set([
	"vitest",
	"jest",
	"pytest",
	"py.test",
	"mocha",
	"ava",
	"tap",
	"rspec",
	"phpunit",
	"ctest",
	"bats",
	"nosetests",
	"karma",
	"jasmine",
]);
const TYPECHECK_EXECUTABLES: ReadonlySet<string> = new Set([
	"tsc",
	"vue-tsc",
	"svelte-check",
	"mypy",
	"pyright",
	"basedpyright",
	"pytype",
	"flow",
]);
const LINT_EXECUTABLES: ReadonlySet<string> = new Set([
	"eslint",
	"prettier",
	"oxlint",
	"ruff",
	"flake8",
	"pylint",
	"black",
	"isort",
	"rubocop",
	"golangci-lint",
	"gofmt",
	"shellcheck",
	"stylelint",
	"swiftlint",
	"markdownlint",
	"tslint",
	"standardrb",
	"dprint",
]);
const BUILD_EXECUTABLES: ReadonlySet<string> = new Set([
	"vite",
	"webpack",
	"rollup",
	"esbuild",
	"tsup",
	"parcel",
	"cmake",
	"ninja",
	"xcodebuild",
	"swc",
	"turbopack",
]);
const MIGRATE_EXECUTABLES: ReadonlySet<string> = new Set([
	"drizzle-kit",
	"alembic",
	"flyway",
	"goose",
	"dbmate",
	"sqitch",
	"chkit",
	"atlas",
]);
const INSTALL_EXECUTABLES: ReadonlySet<string> = new Set([
	"pip",
	"pip3",
	"safe-install",
	"safe-add",
	"safe-global",
	"apt",
	"apt-get",
	"brew",
	"gem",
	"bundle",
	"composer",
	"conda",
	"mamba",
	"nvm",
	"asdf",
	"mise",
	"rustup",
]);

/** Classify a shell command string. Empty input yields ''. */
export function classifyCommand(command: string): CommandClass {
	if (command.trim() === "") return "";
	const present = new Set<CommandClass>();
	for (const simple of parseShellCommand(command)) {
		present.add(classifySimpleCommand(simple.words));
	}
	for (const candidate of CLASS_PRECEDENCE) {
		if (present.has(candidate)) return candidate;
	}
	return "other";
}

/** Combine per-command classes (for scripts that run several commands). */
export function combineCommandClasses(
	classes: readonly CommandClass[],
): CommandClass {
	const present = new Set(classes);
	for (const candidate of CLASS_PRECEDENCE) {
		if (present.has(candidate)) return candidate;
	}
	return "";
}

/**
 * File writes that are explicit in a shell command: output redirects, `tee`,
 * `sed -i`, `mv`, `cp`, `rm`, `touch`, and `git checkout -- / restore / rm`.
 * Paths are reported exactly as written; the working directory is unknown.
 * Each mutation carries its {@link ShellMutationBasis}.
 */
export function extractShellFileMutations(
	command: string,
): readonly ShellFileMutation[] {
	const mutations = new Map<string, ShellFileMutation>();
	for (const {
		conditional,
		rawWords,
		simple,
		workingDirectory,
	} of walkShellCommands(command)) {
		const add = (
			operation: ShellFileMutation["operation"],
			rawPath: string,
			indexOnly = false,
		) => {
			const path = resolveAgainst(workingDirectory, rawPath);
			if (!isProjectPath(path)) return;
			const basis: ShellMutationBasis = conditional
				? "conditional"
				: indexOnly
					? "index"
					: "direct";
			const key = `${operation}\u0000${path}`;
			// An explicit mutation outranks a weaker duplicate of itself.
			if (mutations.get(key)?.basis === "direct") return;
			mutations.set(key, { basis, operation, path });
		};
		for (const redirect of simple.redirects) {
			if (isFileRedirect(redirect.operator)) add("write", redirect.target);
		}
		const words = stripPrefixes(rawWords);
		const executable = basename(words[0] ?? "");
		const args = words.slice(1);
		switch (executable) {
			case "tee":
				for (const path of positionals(args)) add("write", path);
				break;
			case "sed":
				for (const path of readSedTargets(args)) add("edit", path);
				break;
			case "perl":
				for (const path of readPerlInPlaceTargets(args)) add("edit", path);
				break;
			case "mv": {
				const paths = positionals(args);
				const destination = paths.at(-1);
				for (const source of paths.slice(0, -1)) add("delete", source);
				if (destination !== undefined && paths.length > 1) {
					add("write", destination);
				}
				break;
			}
			case "cp": {
				const paths = positionals(args);
				const destination = paths.at(-1);
				if (destination !== undefined && paths.length > 1) {
					add("write", destination);
				}
				break;
			}
			case "rm":
			case "unlink":
				for (const path of positionals(args)) add("delete", path);
				break;
			case "touch":
				for (const path of positionals(args)) add("write", path);
				break;
			case "git":
				for (const [operation, path, indexOnly] of readGitMutations(args)) {
					add(operation, path, indexOnly);
				}
				break;
			default:
				break;
		}
	}
	return [...mutations.values()];
}

const PYTHON_EXECUTABLE = /^python(?:\d+(?:\.\d+)*)?$/u;

/** A file an inline script writes, and whether it read the file first (an edit). */
export interface ScriptFileEdit {
	readonly basis: "direct" | "conditional";
	/**
	 * The file as one key across the calls of a stream: absolute, or joined
	 * to the directory the command's `cd` named as written; undefined when
	 * that directory is unknown.
	 */
	readonly key: string | undefined;
	readonly operation: "write" | "edit";
	readonly path: string;
}

/**
 * Files the inline Python scripts of a shell command write
 * ({@link readPythonFileAccess}): a here-document fed to `python3` (`python3 -
 * <<'EOF'`, `python3 <<EOF`) or a `python3 -c` argument. A script file run
 * by name (`python3 tool.py`) is not read. Relative paths resolve against an
 * absolute `cd` before the command, unless the script changes directory.
 * The files they only read are among {@link extractShellFileReads}.
 */
export function extractScriptFileAccess(
	command: string,
	/** The directory the command started in, for the edit keys. */
	cwd = "",
): readonly ScriptFileEdit[] {
	const edits = new Map<string, ScriptFileEdit>();
	for (const {
		conditional,
		rawWords,
		simple,
		symbolicDirectory,
		workingDirectory,
	} of walkShellCommands(command)) {
		const script = inlinePythonScript(stripPrefixes(rawWords), simple);
		if (script === undefined) continue;
		const access = readPythonFileAccess(script.text);
		for (const written of access.writes) {
			const path = resolveScriptPath(written, script, workingDirectory, access);
			if (!isProjectPath(path) || !isLiteralFilePath(path)) continue;
			const basis = conditional ? "conditional" : "direct";
			if (edits.get(path)?.basis === "direct") continue;
			// A relative `cd` from the start is relative to the call's directory.
			const base =
				symbolicDirectory === undefined
					? cwd
					: symbolicDirectory?.startsWith("./") === true
						? cwd === ""
							? null
							: `${cwd}${symbolicDirectory.slice(1)}`
						: symbolicDirectory;
			edits.set(path, {
				basis,
				key: path.startsWith("/")
					? normalizePath(path)
					: access.changesDirectory || base === null || base === ""
						? undefined
						: symbolicPath(`${base}/${path}`),
				operation: access.edits.includes(written) ? "edit" : "write",
				path,
			});
		}
	}
	return [...edits.values()];
}

/** A path a script names, resolved like a shell operand unless the script changes directory. */
function resolveScriptPath(
	path: string,
	script: { literal: boolean; text: string },
	workingDirectory: string | undefined,
	access = readPythonFileAccess(script.text),
): string {
	return access.changesDirectory || (!script.literal && /[$`]/u.test(path))
		? path
		: resolveAgainst(workingDirectory, path);
}

/** The inline script a Python command runs, and whether the shell left it unexpanded. */
function inlinePythonScript(
	words: readonly string[],
	simple: SimpleCommand,
): { text: string; literal: boolean } | undefined {
	if (!PYTHON_EXECUTABLE.test(basename(words[0] ?? ""))) return undefined;
	const args = words.slice(1);
	const flag = args.indexOf("-c");
	if (flag !== -1) {
		const text = args[flag + 1];
		return text === undefined ? undefined : { text, literal: false };
	}
	// Flags only (`-`, `-u`, `-I`), else it runs a script file.
	if (args.some((arg) => !arg.startsWith("-"))) return undefined;
	const heredoc = simple.heredocs[0];
	return heredoc === undefined
		? undefined
		: { text: heredoc.body, literal: heredoc.quoted };
}

/** Programs that print the files they are given. */
const FILE_PRINTERS: ReadonlySet<string> = new Set([
	"cat",
	"head",
	"tail",
	"less",
	"more",
	"bat",
	"nl",
]);
/** Flags of head and tail that take the next word as their value. */
const PRINTER_VALUE_FLAGS: ReadonlySet<string> = new Set([
	"-n",
	"-c",
	"--lines",
	"--bytes",
]);

/**
 * Files a shell command reads explicitly, in order: the operands of the
 * file printers (`cat`, `head`, `tail`, `less`, `more`, `bat`, `nl`) and of
 * a `sed` that does not edit in place. Like {@link extractShellFileMutations},
 * paths are as written (or resolved against an absolute `cd`); standard
 * input, patterns and expansions are never paths.
 */
export function extractShellFileReads(command: string): readonly string[] {
	const reads: string[] = [];
	for (const { rawWords, simple, workingDirectory } of walkShellCommands(
		command,
	)) {
		const words = stripPrefixes(rawWords);
		const executable = basename(words[0] ?? "");
		const args = words.slice(1);
		const script = inlinePythonScript(words, simple);
		const access =
			script === undefined ? undefined : readPythonFileAccess(script.text);
		const paths =
			script !== undefined && access !== undefined
				? access.reads.map((path) =>
						resolveScriptPath(path, script, workingDirectory, access),
					)
				: (FILE_PRINTERS.has(executable)
						? printerOperands(args)
						: executable === "sed"
							? readSedOperands(args)
							: []
					).map((operand) => resolveAgainst(workingDirectory, operand));
		for (const path of paths)
			if (isLiteralFilePath(path) && !reads.includes(path)) reads.push(path);
	}
	return reads;
}

/** A path that names one file as written: no expansion, pattern or descriptor. */
export function isLiteralFilePath(path: string): boolean {
	return (
		path !== "" &&
		path !== "-" &&
		!/[$`*?[\]{}\s]/u.test(path) &&
		!path.startsWith("-") &&
		!path.startsWith("/dev/")
	);
}

function printerOperands(args: readonly string[]): string[] {
	const operands: string[] = [];
	let optionsEnded = false;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index] ?? "";
		if (!optionsEnded && arg === "--") {
			optionsEnded = true;
			continue;
		}
		if (!optionsEnded && PRINTER_VALUE_FLAGS.has(arg)) {
			index++;
			continue;
		}
		// `tail +5` starts at a line; it is not a file.
		if (!optionsEnded && /^[-+]/u.test(arg) && arg !== "-") continue;
		operands.push(arg);
	}
	return operands;
}

/** The input files of a `sed` that prints rather than edits in place. */
function readSedOperands(args: readonly string[]): string[] {
	if (readSedTargets(args).length > 0) return [];
	if (
		args.some(
			(arg) =>
				arg === "-i" ||
				/^-[A-Za-z]*i/u.test(arg) ||
				arg.startsWith("--in-place"),
		)
	)
		return [];
	let hasExplicitScript = false;
	const operands: string[] = [];
	for (let index = 0; index < args.length; index++) {
		const arg = args[index] ?? "";
		if (arg === "--") {
			operands.push(...args.slice(index + 1));
			break;
		}
		if (
			arg === "-e" ||
			arg === "--expression" ||
			arg === "-f" ||
			arg === "--file"
		) {
			hasExplicitScript = true;
			index++;
			continue;
		}
		if (arg.startsWith("-") && arg !== "-") continue;
		operands.push(arg);
	}
	return hasExplicitScript ? operands : operands.slice(1);
}

/** One command of a shell script with what the commands before it established. */
interface WalkedCommand {
	/** True when the command may not have run (see {@link readConditionalFlags}). */
	readonly conditional: boolean;
	/** Its words without a leading function header, `{` or branch keyword. */
	readonly rawWords: readonly string[];
	readonly simple: SimpleCommand;
	/** The absolute directory an earlier `cd` moved to, else undefined. */
	readonly workingDirectory: string | undefined;
	/**
	 * The directory the earlier `cd` commands moved to as written (`~/repo`
	 * kept as is, `./sub` relative to the call's own directory): undefined
	 * before any `cd`, null once one is not literal.
	 */
	readonly symbolicDirectory: string | null | undefined;
}

/**
 * The commands of a shell script in order, `cd` commands consumed: only an
 * absolute `cd` makes later relative paths resolvable; anything else leaves
 * them exactly as written.
 */
function* walkShellCommands(command: string): Generator<WalkedCommand> {
	let workingDirectory: string | undefined;
	let symbolicDirectory: string | null | undefined;
	const commands = parseShellCommand(command);
	const conditionalFlags = readConditionalFlags(commands);
	for (const [commandIndex, simple] of commands.entries()) {
		let conditional =
			simple.nested || (conditionalFlags[commandIndex] ?? false);
		let rawWords = simple.words;
		if (
			rawWords[0] === "function" ||
			(/^[A-Za-z_][A-Za-z0-9_]*$/u.test(rawWords[0] ?? "") &&
				rawWords[1] === "()")
		) {
			conditional = true;
			const bodyStart = rawWords.indexOf("{");
			rawWords = bodyStart < 0 ? [] : rawWords.slice(bodyStart + 1);
		}
		if (rawWords[0] === "{") {
			conditional = true;
			rawWords = rawWords.slice(1);
		}
		if (CONTROL_KEYWORDS.has(rawWords[0] ?? "")) {
			// `then rm x`: the branch may never have run.
			conditional = true;
			rawWords = rawWords.slice(1);
		}
		if (basename(rawWords[0] ?? "") === "cd") {
			const target = positionals(rawWords.slice(1))[0];
			workingDirectory = resolveWorkingDirectory(workingDirectory, target);
			symbolicDirectory =
				target === undefined ||
				target === "-" ||
				/[$`]/u.test(target) ||
				symbolicDirectory === null ||
				conditional
					? null
					: target.startsWith("/") || target.startsWith("~")
						? target
						: `${symbolicDirectory ?? "."}/${target}`;
			continue;
		}
		yield {
			conditional,
			rawWords,
			simple,
			symbolicDirectory,
			workingDirectory,
		};
	}
}

/** Words that open a compound construct, closed by the matching closer. */
const CONSTRUCT_OPENERS: ReadonlySet<string> = new Set([
	"if",
	"while",
	"until",
	"for",
	"select",
	"case",
	"{",
]);
const CONSTRUCT_CLOSERS: ReadonlySet<string> = new Set([
	"fi",
	"done",
	"esac",
	"}",
]);

/** Shell keywords that open a branch body; the command after them is conditional. */
const CONTROL_KEYWORDS: ReadonlySet<string> = new Set([
	"then",
	"else",
	"elif",
	"do",
]);

/**
 * Per command: true when it may not have run. The first command of every
 * `;`-separated list always runs. After `||` nothing is certain. After `&&`
 * the command ran only if its predecessors succeeded, which a successful call
 * proves only for the last list of the script and only when that list has no
 * `||`: `a && b` exiting 0 means `b` ran, while `a && b; c` exiting 0 does not.
 * Pipeline members always run, so they inherit the flag of their list position.
 */
function readConditionalFlags(commands: readonly SimpleCommand[]): boolean[] {
	const flags = commands.map(() => false);
	let listStart = 0;
	while (listStart < commands.length) {
		let listEnd = listStart + 1;
		while (
			listEnd < commands.length &&
			commands[listEnd]?.connector !== null &&
			commands[listEnd]?.connector !== ";"
		) {
			listEnd++;
		}
		const list = commands.slice(listStart, listEnd);
		const hasOr = list.some((entry) => entry.connector === "||");
		const isLastList = listEnd === commands.length;
		let afterAnd = false;
		let afterOr = false;
		for (const [offset, entry] of list.entries()) {
			if (entry.connector === "&&") afterAnd = true;
			if (entry.connector === "||") afterOr = true;
			flags[listStart + offset] =
				afterOr || (afterAnd && (hasOr || !isLastList));
		}
		listStart = listEnd;
	}
	return flags;
}

function classifySimpleCommand(rawWords: readonly string[]): CommandClass {
	const words = stripPrefixes(rawWords);
	const executable = basename(words[0] ?? "");
	if (executable === "") return "other";
	const args = words.slice(1);

	if (executable === "git" || executable === "gh" || executable === "hub") {
		return "git";
	}
	if (EXECUTOR_PREFIXES.has(executable)) {
		return args.length > 0 ? classifySimpleCommand(args) : "other";
	}
	if (JS_PACKAGE_MANAGERS.has(executable)) {
		return classifyJsPackageManager(executable, args);
	}
	if (SCRIPT_RUNNERS.has(executable)) {
		return classifyScriptRunner(executable, args);
	}
	if (executable === "uv" || executable === "poetry" || executable === "pdm") {
		return classifyPythonRunner(executable, args);
	}
	if (/^python[\d.]*$/u.test(executable)) {
		return classifyPythonModule(args);
	}
	if (TEST_EXECUTABLES.has(executable)) return "test";
	if (TYPECHECK_EXECUTABLES.has(executable)) return "typecheck";
	if (LINT_EXECUTABLES.has(executable)) return "lint";
	if (executable === "biome") {
		const subcommand = firstPositional(args);
		return subcommand === "migrate" ? "migrate" : "lint";
	}
	if (BUILD_EXECUTABLES.has(executable)) return "build";
	if (MIGRATE_EXECUTABLES.has(executable)) return "migrate";
	if (INSTALL_EXECUTABLES.has(executable)) {
		return executable === "bundle" && firstPositional(args) === "exec"
			? classifySimpleCommand(args.slice(args.indexOf("exec") + 1))
			: "install";
	}
	const subcommand = firstPositional(args);
	switch (executable) {
		case "cargo":
			return classifyBySubcommand(subcommand, {
				test: ["test", "nextest", "bench"],
				typecheck: ["check"],
				lint: ["clippy", "fmt"],
				build: ["build", "b", "run", "doc", "publish", "package"],
				install: ["add", "install", "remove", "update", "fetch"],
			});
		case "go":
			return classifyBySubcommand(subcommand, {
				test: ["test"],
				typecheck: ["vet"],
				lint: ["fmt"],
				build: ["build", "run", "generate"],
				install: ["get", "install", "mod"],
			});
		case "dotnet":
			return classifyBySubcommand(subcommand, {
				test: ["test"],
				build: ["build", "publish", "run", "pack"],
				install: ["restore", "add", "tool"],
			});
		case "mvn":
		case "mvnw":
		case "gradle":
		case "gradlew":
			return classifyBuildTool(args);
		case "swift":
			return classifyBySubcommand(subcommand, {
				test: ["test"],
				build: ["build", "run", "package"],
			});
		case "mix":
			return classifyBySubcommand(subcommand, {
				test: ["test"],
				lint: ["format", "credo"],
				build: ["compile", "release"],
				migrate: ["ecto.migrate"],
				install: ["deps.get"],
			});
		case "rails":
		case "rake":
			return /\bdb:(?:migrate|rollback|schema|setup|prepare)/u.test(
				args.join(" "),
			)
				? "migrate"
				: /\btest\b/u.test(args.join(" "))
					? "test"
					: "other";
		case "docker":
		case "podman":
			return subcommand === "build" || args.includes("build")
				? "build"
				: "other";
		case "prisma":
			return subcommand === "migrate" || subcommand === "db"
				? "migrate"
				: subcommand === "generate"
					? "build"
					: "other";
		case "playwright":
			return subcommand === "install"
				? "install"
				: subcommand === "test" || subcommand === undefined
					? "test"
					: "other";
		case "cypress":
			return subcommand === "run" || subcommand === "open" ? "test" : "other";
		case "next":
		case "astro":
		case "nuxt":
		case "remix":
		case "gatsby":
			return subcommand === "build"
				? "build"
				: subcommand === "check"
					? "typecheck"
					: subcommand === "lint"
						? "lint"
						: "other";
		case "wrangler":
			return "other";
		default:
			return "other";
	}
}

function classifyJsPackageManager(
	manager: string,
	rawArgs: readonly string[],
): CommandClass {
	let args = rawArgs;
	args = dropValueFlags(args);
	const subcommand = firstPositional(args);
	if (subcommand === undefined) return "other";
	if (manager === "deno") {
		return classifyBySubcommand(subcommand, {
			test: ["test", "bench"],
			typecheck: ["check"],
			lint: ["lint", "fmt"],
			build: ["compile", "bundle"],
			install: ["install", "add", "remove"],
		});
	}
	if (subcommand === "test" || subcommand === "t") return "test";
	if (subcommand === "build") return "build";
	if (JS_INSTALL_SUBCOMMANDS.has(subcommand)) return "install";
	if (subcommand === "x" || subcommand === "dlx" || subcommand === "exec") {
		const rest = args.slice(args.indexOf(subcommand) + 1);
		return rest.length > 0 ? classifySimpleCommand(rest) : "other";
	}
	if (subcommand === "run" || subcommand === "run-script") {
		const afterRun = args.slice(args.indexOf(subcommand) + 1);
		const script = firstPositional(afterRun);
		return script === undefined ? "other" : classifyScriptName(script);
	}
	if (manager === "bun" && /\.(?:[cm]?[jt]sx?|sh)$/u.test(subcommand)) {
		return "other";
	}
	if (manager === "bun" && subcommand === "pm") return "install";
	// `pnpm lint`, `yarn typecheck`: the sub-command is the script name.
	return classifyScriptName(subcommand);
}

function classifyScriptRunner(
	runner: string,
	args: readonly string[],
): CommandClass {
	if (runner === "turbo" || runner === "nx" || runner === "lerna") {
		const targets = positionals(args).filter(
			(word) => word !== "run" && word !== "run-many" && word !== "exec",
		);
		const classes = targets.map(classifyScriptName);
		return combineCommandClasses(classes) || "other";
	}
	const target = firstPositional(args);
	if (target === undefined) return runner === "make" ? "build" : "other";
	return classifyScriptName(target);
}

function classifyPythonRunner(
	runner: string,
	args: readonly string[],
): CommandClass {
	const subcommand = firstPositional(args);
	if (subcommand === "run") {
		const rest = args.slice(args.indexOf("run") + 1);
		return rest.length > 0 ? classifySimpleCommand(rest) : "other";
	}
	if (
		subcommand === "sync" ||
		subcommand === "add" ||
		subcommand === "install" ||
		subcommand === "remove" ||
		subcommand === "lock" ||
		subcommand === "pip" ||
		subcommand === "update"
	) {
		return "install";
	}
	if (subcommand === "build" || subcommand === "publish") return "build";
	return runner === "uv" && subcommand === "tool" ? "install" : "other";
}

function classifyPythonModule(args: readonly string[]): CommandClass {
	const moduleIndex = args.indexOf("-m");
	const module = moduleIndex >= 0 ? args[moduleIndex + 1] : undefined;
	if (module === undefined) return "other";
	if (module === "pytest" || module === "unittest" || module === "nose") {
		return "test";
	}
	if (module === "mypy" || module === "pyright") return "typecheck";
	if (["ruff", "flake8", "pylint", "black", "isort"].includes(module)) {
		return "lint";
	}
	if (module === "pip") return "install";
	if (module === "build") return "build";
	if (module === "alembic") return "migrate";
	return "other";
}

function classifyBuildTool(args: readonly string[]): CommandClass {
	const goals = positionals(args);
	const classes = goals.map(classifyScriptName);
	const combined = combineCommandClasses(classes);
	if (combined !== "") return combined;
	return goals.some((goal) =>
		["package", "compile", "assemble", "install", "verify"].includes(goal),
	)
		? "build"
		: "other";
}

function classifyBySubcommand(
	subcommand: string | undefined,
	table: Partial<Record<Exclude<CommandClass, "" | "git" | "other">, string[]>>,
): CommandClass {
	if (subcommand === undefined) return "other";
	for (const className of CLASS_PRECEDENCE) {
		if (className === "git" || className === "other") continue;
		if (table[className]?.includes(subcommand)) return className;
	}
	return "other";
}

/** Classify a package.json script, Makefile target, or task name. */
export function classifyScriptName(name: string): CommandClass {
	const lowered = name.toLowerCase();
	for (const rule of SCRIPT_CLASS_RULES) {
		if (rule.pattern.test(lowered)) return rule.class;
	}
	return "other";
}

/** The program a simple command runs, after assignments and wrappers (`env`, `timeout`, `sudo`). */
export function commandProgram(words: readonly string[]): string {
	return basename(stripPrefixes(words)[0] ?? "");
}

function stripPrefixes(words: readonly string[]): readonly string[] {
	let index = 0;
	while (index < words.length) {
		const word = words[index] ?? "";
		if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(word)) {
			index++;
			continue;
		}
		const name = basename(word);
		if (PASSTHROUGH_PREFIXES.has(name)) {
			index++;
			// Skip the prefix's own flags and numeric arguments (timeout 30 cmd).
			while (
				index < words.length &&
				(/^-/u.test(words[index] ?? "") ||
					(name === "timeout" && /^\d+[smhd]?$/u.test(words[index] ?? "")) ||
					(name === "env" &&
						/^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[index] ?? "")))
			) {
				index++;
			}
			continue;
		}
		break;
	}
	return words.slice(index);
}

const VALUE_FLAGS: ReadonlySet<string> = new Set([
	"--filter",
	"-F",
	"--cwd",
	"--prefix",
	"-C",
	"--dir",
	"--workspace",
	"-w",
	"--config",
	"--registry",
]);

/** Remove package-manager flags that consume the next word (`--filter web`). */
function dropValueFlags(args: readonly string[]): readonly string[] {
	const result: string[] = [];
	for (let index = 0; index < args.length; index++) {
		const arg = args[index] ?? "";
		if (VALUE_FLAGS.has(arg)) {
			index++;
			continue;
		}
		result.push(arg);
	}
	return result;
}

function firstPositional(args: readonly string[]): string | undefined {
	return positionals(args)[0];
}

function positionals(args: readonly string[]): string[] {
	const result: string[] = [];
	let optionsEnded = false;
	for (const arg of args) {
		if (!optionsEnded && arg === "--") {
			optionsEnded = true;
			continue;
		}
		if (!optionsEnded && arg.startsWith("-") && arg !== "-") continue;
		result.push(arg);
	}
	return result;
}

function readSedTargets(args: readonly string[]): string[] {
	let inPlace = false;
	let hasExplicitScript = false;
	const operands: string[] = [];
	for (let index = 0; index < args.length; index++) {
		const arg = args[index] ?? "";
		if (arg === "--") {
			operands.push(...args.slice(index + 1));
			break;
		}
		if (arg === "-i" || arg === "--in-place") {
			inPlace = true;
			// BSD sed takes the backup suffix as a separate, possibly empty, word.
			if (arg === "-i" && args[index + 1] === "") index++;
			continue;
		}
		if (arg.startsWith("-i") || arg.startsWith("--in-place=")) {
			inPlace = true;
			continue;
		}
		if (
			arg === "-e" ||
			arg === "--expression" ||
			arg === "-f" ||
			arg === "--file"
		) {
			hasExplicitScript = true;
			index++;
			continue;
		}
		if (/^-[A-Za-z]*[Ei][A-Za-z]*$/u.test(arg) && arg.length > 2) {
			// Clustered flags such as -ni or -Ei.
			if (arg.includes("i")) inPlace = true;
			continue;
		}
		if (arg.startsWith("-") && arg !== "-") continue;
		operands.push(arg);
	}
	if (!inPlace) return [];
	return hasExplicitScript ? operands : operands.slice(1);
}

function readPerlInPlaceTargets(args: readonly string[]): string[] {
	let inPlace = false;
	let hasExplicitScript = false;
	const operands: string[] = [];
	for (let index = 0; index < args.length; index++) {
		const arg = args[index] ?? "";
		if (arg === "-e" || arg === "-E") {
			hasExplicitScript = true;
			index++;
			continue;
		}
		if (/^-[A-Za-z0-9.]*i/u.test(arg)) {
			inPlace = true;
			if (/e$/u.test(arg)) {
				hasExplicitScript = true;
				index++;
			}
			continue;
		}
		if (arg.startsWith("-")) continue;
		operands.push(arg);
	}
	if (!inPlace) return [];
	return hasExplicitScript ? operands : operands.slice(1);
}

/** `[operation, path, indexOnly]` for each path a git command touches. */
function readGitMutations(
	args: readonly string[],
): readonly (readonly ["edit" | "delete", string, boolean])[] {
	const subcommand = firstPositional(args);
	if (subcommand === undefined) return [];
	const rest = args.slice(args.indexOf(subcommand) + 1);
	if (subcommand === "rm") {
		if (rest.some((arg) => arg === "-n" || arg === "--dry-run")) return [];
		const indexOnly = rest.includes("--cached");
		return positionals(rest).map(
			(path) => ["delete", path, indexOnly] as const,
		);
	}
	if (subcommand === "restore") {
		// `--staged` alone restores the index; `--worktree` adds the working tree.
		const indexOnly =
			(rest.includes("--staged") || rest.includes("-S")) &&
			!(rest.includes("--worktree") || rest.includes("-W"));
		return positionals(rest).map((path) => ["edit", path, indexOnly] as const);
	}
	if (subcommand === "checkout") {
		const separator = rest.indexOf("--");
		if (separator === -1) return [];
		return rest
			.slice(separator + 1)
			.map((path) => ["edit", path, false] as const);
	}
	return [];
}

function resolveWorkingDirectory(
	current: string | undefined,
	target: string | undefined,
): string | undefined {
	if (target === undefined || target === "-" || target.startsWith("~")) {
		return undefined;
	}
	if (/[$`]/u.test(target)) return undefined;
	return target.startsWith("/")
		? normalizePath(target)
		: current === undefined
			? undefined
			: normalizePath(`${current}/${target}`);
}

function resolveAgainst(
	workingDirectory: string | undefined,
	path: string,
): string {
	if (
		workingDirectory === undefined ||
		path.startsWith("/") ||
		path.startsWith("~") ||
		/[$`]/u.test(path)
	) {
		return path;
	}
	return normalizePath(`${workingDirectory}/${path}`);
}

/** `normalizePath` that keeps a leading `~` as written. */
function symbolicPath(path: string): string {
	return path.startsWith("~")
		? `~${normalizePath(path.slice(1))}`
		: normalizePath(path);
}

function normalizePath(path: string): string {
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `/${parts.join("/")}`;
}

function isFileRedirect(operator: string): boolean {
	return (
		operator === ">" ||
		operator === ">>" ||
		operator === "1>" ||
		operator === "1>>" ||
		operator === "&>" ||
		operator === "&>>" ||
		operator === ">|"
	);
}

function isProjectPath(path: string): boolean {
	if (path === "" || path.startsWith("&") || path.startsWith("-")) return false;
	if (/[$`*?{}]/u.test(path) && !/\.[A-Za-z0-9]+$/u.test(path)) return false;
	return !(
		path.startsWith("/dev/") ||
		path.startsWith("/tmp/") ||
		path.startsWith("/private/tmp/") ||
		path.startsWith("/var/folders/") ||
		path === "/tmp"
	);
}

function basename(path: string): string {
	return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

/**
 * Tolerant shell splitter. Understands quotes, escapes, comments, `;`, `&&`,
 * `||`, `|`, `&`, newlines, subshell parentheses, redirects, and here-document
 * bodies (which are data, never commands). It never evaluates anything.
 */
export function parseShellCommand(command: string): readonly SimpleCommand[] {
	const commands: SimpleCommand[] = [];
	let words: string[] = [];
	let redirects: { operator: string; target: string }[] = [];
	let current = "";
	let hasCurrent = false;
	let quote: "'" | '"' | undefined;
	let pendingRedirect: string | undefined;
	let nextConnector: ShellConnector | null = null;
	let constructDepth = 0;
	let parenDepth = 0;
	let pendingFunctionBody = false;
	let index = 0;
	/** Where the command under construction starts in the source. */
	let commandStart: number | undefined;
	let heredocs: MutableHeredoc[] = [];
	const pendingHeredocs: MutableHeredoc[] = [];
	const mark = () => {
		commandStart ??= index;
	};

	const endWord = () => {
		if (!hasCurrent) return;
		if (pendingRedirect !== undefined) {
			redirects.push({ operator: pendingRedirect, target: current });
			pendingRedirect = undefined;
		} else {
			words.push(current);
		}
		current = "";
		hasCurrent = false;
	};
	/**
	 * Finish the command under construction. `next` is the operator that ends it;
	 * `"separator"` covers newlines and parentheses, which only start a new list
	 * when a command actually ended (`a && (b)` keeps `b` joined by `&&`).
	 */
	const endCommand = (next: ShellConnector | "separator") => {
		endWord();
		pendingRedirect = undefined;
		const ended = words.length > 0 || redirects.length > 0;
		if (ended) {
			let scopeIndex = 0;
			while (words[scopeIndex] === "time" || words[scopeIndex] === "!") {
				const prefix = words[scopeIndex++];
				if (prefix === "time" && words[scopeIndex] === "-p") scopeIndex++;
			}
			const keyword = words[scopeIndex] ?? "";
			const functionDeclaration =
				keyword === "function" ||
				(/^[A-Za-z_][A-Za-z0-9_]*$/u.test(keyword) &&
					words[scopeIndex + 1] === "()");
			if (functionDeclaration) {
				constructDepth++;
				pendingFunctionBody = !words.includes("{");
			} else if (CONSTRUCT_OPENERS.has(keyword)) {
				if (keyword !== "{" || !pendingFunctionBody) constructDepth++;
				pendingFunctionBody = false;
			}
			const nested =
				constructDepth > 0 ||
				parenDepth > 0 ||
				CONSTRUCT_OPENERS.has(keyword) ||
				CONSTRUCT_CLOSERS.has(keyword);
			if (CONSTRUCT_CLOSERS.has(keyword)) {
				constructDepth = Math.max(0, constructDepth - 1);
			}
			commands.push({
				connector: nextConnector,
				heredocs,
				nested,
				redirects,
				text: command.slice(commandStart ?? index, index).trim(),
				words,
			});
			nextConnector = null;
		}
		words = [];
		redirects = [];
		heredocs = [];
		commandStart = undefined;
		if (next !== "separator") nextConnector = next;
		else if (ended) nextConnector = ";";
	};

	while (index < command.length) {
		const character = command[index] ?? "";
		if (quote === "'") {
			if (character === "'") quote = undefined;
			else current += character;
			index++;
			continue;
		}
		if (quote === '"') {
			if (character === '"') {
				quote = undefined;
			} else if (character === "\\" && index + 1 < command.length) {
				current += command[index + 1] ?? "";
				index++;
			} else {
				current += character;
			}
			index++;
			continue;
		}
		if (character === "\\" && index + 1 < command.length) {
			const next = command[index + 1] ?? "";
			if (next !== "\n") {
				mark();
				current += next;
				hasCurrent = true;
			}
			index += 2;
			continue;
		}
		if (character === "'" || character === '"') {
			mark();
			quote = character;
			hasCurrent = true;
			index++;
			continue;
		}
		if (character === "#" && !hasCurrent) {
			while (index < command.length && command[index] !== "\n") index++;
			continue;
		}
		if (character === "\n") {
			endCommand("separator");
			index++;
			for (const heredoc of pendingHeredocs.splice(0)) {
				const end = skipHeredocBody(command, index, heredoc);
				heredoc.body = heredocBody(command, index, end, heredoc);
				index = end;
			}
			continue;
		}
		if (character === " " || character === "\t" || character === "\r") {
			endWord();
			index++;
			continue;
		}
		if (character === ";" || character === "(" || character === ")") {
			if (character === "(") {
				endWord();
				const signature = /^\(\s*\)/u.exec(command.slice(index));
				if (
					signature &&
					(words[0] === "function" ||
						(words.length === 1 &&
							/^[A-Za-z_][A-Za-z0-9_]*$/u.test(words[0] ?? "")))
				) {
					words.push("()");
					index += signature[0].length;
					continue;
				}
			}
			endCommand("separator");
			if (character === "(") parenDepth++;
			if (character === ")") parenDepth = Math.max(0, parenDepth - 1);
			index++;
			continue;
		}
		if (character === "|" || character === "&") {
			const next = command[index + 1];
			if (character === "&" && next === ">") {
				mark();
				endWord();
				const append = command[index + 2] === ">";
				pendingRedirect = append ? "&>>" : "&>";
				index += append ? 3 : 2;
				continue;
			}
			if (character === "|" && next === "&") {
				endCommand("|");
				index += 2;
				continue;
			}
			if (next === character) {
				endCommand(character === "&" ? "&&" : "||");
				index += 2;
				continue;
			}
			if (character === "&" && /[0-9]$/u.test(current) && pendingRedirect) {
				current += character;
				hasCurrent = true;
				index++;
				continue;
			}
			// A lone `&` backgrounds the command; both sides still run.
			endCommand(character === "|" ? "|" : ";");
			index++;
			continue;
		}
		if (character === "<" || character === ">") {
			mark();
			const digits = /^[0-9]+$/u.test(current) && hasCurrent ? current : "";
			if (digits !== "") {
				current = "";
				hasCurrent = false;
			} else {
				endWord();
			}
			if (
				character === "<" &&
				command[index + 1] === "<" &&
				command[index + 2] !== "<"
			) {
				const stripTabs = command[index + 2] === "-";
				const start = index + (stripTabs ? 3 : 2);
				const parsed = readHeredocDelimiter(command, start);
				if (parsed) {
					const heredoc: MutableHeredoc = {
						body: "",
						delimiter: parsed.delimiter,
						quoted: parsed.quoted,
						stripTabs,
					};
					heredocs.push(heredoc);
					pendingHeredocs.push(heredoc);
					index = parsed.end;
					continue;
				}
			}
			let operator = character;
			if (command[index + 1] === character) {
				operator += character;
				index++;
			} else if (character === ">" && command[index + 1] === "|") {
				operator += "|";
				index++;
			} else if (
				command[index + 1] === "&" &&
				/[0-9-]/u.test(command[index + 2] ?? "")
			) {
				// Descriptor duplication such as 2>&1 is not a file target.
				index += 3;
				continue;
			}
			index++;
			pendingRedirect = `${digits}${operator}`;
			continue;
		}
		mark();
		current += character;
		hasCurrent = true;
		index++;
	}
	endCommand("separator");
	return commands;
}

interface MutableHeredoc {
	body: string;
	readonly delimiter: string;
	readonly quoted: boolean;
	readonly stripTabs: boolean;
}

/** The lines of a here-document body before its delimiter line. */
function heredocBody(
	command: string,
	start: number,
	end: number,
	heredoc: { delimiter: string; stripTabs: boolean },
): string {
	const lines = command.slice(start, end).split("\n");
	// The delimiter line ends the body; an unterminated body runs to the end.
	const closing = lines.findIndex(
		(line) =>
			(heredoc.stripTabs ? line.replace(/^\t+/u, "") : line).trimEnd() ===
			heredoc.delimiter,
	);
	const body = closing === -1 ? lines : lines.slice(0, closing);
	return (
		heredoc.stripTabs ? body.map((line) => line.replace(/^\t+/u, "")) : body
	).join("\n");
}

function readHeredocDelimiter(
	command: string,
	start: number,
): { delimiter: string; end: number; quoted: boolean } | undefined {
	let index = start;
	while (command[index] === " " || command[index] === "\t") index++;
	const first = command[index];
	if (first === undefined) return undefined;
	let delimiter = "";
	if (first === "'" || first === '"') {
		const close = command.indexOf(first, index + 1);
		if (close === -1) return undefined;
		delimiter = command.slice(index + 1, close);
		return delimiter === ""
			? undefined
			: { delimiter, end: close + 1, quoted: true };
	}
	while (
		index < command.length &&
		/[A-Za-z0-9_.-]/u.test(command[index] ?? "")
	) {
		delimiter += command[index];
		index++;
	}
	return delimiter === ""
		? undefined
		: { delimiter, end: index, quoted: false };
}

function skipHeredocBody(
	command: string,
	start: number,
	heredoc: { delimiter: string; stripTabs: boolean },
): number {
	let lineStart = start;
	while (lineStart < command.length) {
		let lineEnd = command.indexOf("\n", lineStart);
		if (lineEnd === -1) lineEnd = command.length;
		let line = command.slice(lineStart, lineEnd);
		if (heredoc.stripTabs) line = line.replace(/^\t+/u, "");
		if (line.trimEnd() === heredoc.delimiter) return lineEnd + 1;
		lineStart = lineEnd + 1;
	}
	return command.length;
}
