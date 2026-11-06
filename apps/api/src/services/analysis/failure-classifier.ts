// Deterministic cause classification for a failed tool call: which family of
// failure it is, the specific recurring detail (lint rule, TS code, test,
// missing module, hook), and whether it is friction the agent should never
// have hit or a validation check doing its job.

export const CLASSIFIER_VERSION = 1;

export type FailureKind =
	/** Blocked by policy or environment before anything ran. */
	| "friction"
	/** The agent's own wrong assumption (stale patch, wrong path, bad flag): avoidable with better context. */
	| "mistake"
	/** Lint, typecheck or tests rejecting code: the check works; recurring rules are avoidable. */
	| "validation"
	/** Missing dependencies, services not running, credentials: setup problems. */
	| "environment"
	/** Non-zero exit that is the expected answer (a search with no hits, a probe, a stopped server). */
	| "noise"
	| "other";

export interface FailureCause {
	readonly cause: string;
	readonly detail: string;
	readonly kind: FailureKind;
	readonly ruleIds: readonly string[];
}

export const PREAMBLE =
	/^(?:exit code:?\s*-?\d+|process exited with code -?\d+|wall time:.*|output:?|chunk id:.*|original token count:.*|total output lines:.*|command:.*|\[?std(?:err|out)\]?:?|<\/?tool_use_error>|<\/?error>|error:?$|shell cwd was reset.*|script failed|script error:?|\$ .*|> .*)$/iu;
export const STRONG =
	/(\berror\b|\bfail(?:ed|ure)?\b|✖|✗|✕|×|fatal:|exception|ERR!|ERR_PNPM_|panic|denied|not found|no such file|traceback|cannot|can't|unable to|refused|invalid|unknown (?:option|command|argument|flag)|timed out|rejected)/iu;
const ESCAPE = String.fromCharCode(27);
const BELL = String.fromCharCode(7);
const ANSI_COLOR = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "gu");
const ANSI_CSI = new RegExp(`${ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "gu");
const ANSI_OSC = new RegExp(
	`${ESCAPE}\\][^${BELL}]*(?:${BELL}|${ESCAPE}\\\\)`,
	"gu",
);

export function errorLine(body: string, tail: string): string {
	const text = stripAnsi(`${body}\n${tail}`).replace(
		/<\/?tool_use_error>/gu,
		"\n",
	);
	const lines = text
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => line !== "" && !PREAMBLE.test(line));
	const preferred = lines.find((line) => STRONG.test(line) && line.length > 6);
	return (preferred ?? lines[0] ?? "(no output)").slice(0, 300);
}

export function normalize(text: string): string {
	return text
		.replace(ANSI_COLOR, "")
		.replace(
			/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu,
			"<id>",
		)
		.replace(/\b[0-9a-f]{7,40}\b/gu, "<sha>")
		.replace(/(?:~|\.{1,2})?(?:\/[\w.@+-]+)+\/?(?::\d+(?::\d+)?)?/gu, "<path>")
		.replace(
			/\b[\w.-]+\.(?:tsx?|jsx?|mjs|json|md|sql|ya?ml|css|html|py|sh|toml|lock)\b(?::\d+(?::\d+)?)?/gu,
			"<file>",
		)
		.replace(/"[^"]{0,200}"|'[^']{0,200}'|`[^`]{0,200}`/gu, "'…'")
		.replace(/\d+(?:\.\d+)?/gu, "N")
		.replace(/\s+/gu, " ")
		.trim()
		.slice(0, 140);
}

/** A path relative to its Conductor workspace or worktree, so copies merge. */
export function relativePath(path: string): string {
	return path
		.replace(/^.*?\/conductor\/workspaces\/[^/]+\/[^/]+\//u, "")
		.replace(/^.*?\/\.claude\/worktrees\/[^/]+\//u, "")
		.replace(/^.*?\/coding-projects\/[^/]+\//u, "")
		.replace(/^\/Users\/[^/]+\//u, "~/");
}

const rule = (
	cause: string,
	detail: string,
	kind: FailureKind,
	ruleIds: readonly string[] = [],
): FailureCause => ({ cause, detail, kind, ruleIds });

export function classifyFailure(input: {
	readonly tool: string;
	readonly commandClass?: string;
	readonly command: string;
	readonly body: string;
	readonly tail: string;
	readonly exitCode: number | null;
}): FailureCause {
	const text = stripAnsi(`${input.body}\n${input.tail}`);
	const command = input.command;
	const line = errorLine(input.body, input.tail);
	let match: RegExpExecArray | null;
	if (
		/ENOSPC|no space left on device|disk (?:is )?full|not enough (?:free )?(?:disk )?space/iu.test(
			text,
		)
	)
		return rule("disk exhaustion", firstWords(command, 2), "environment");

	// Friction: hooks and guards that stop a command before it runs.
	if (
		/package-command-policy|cannot install or download packages|Blocked: bunx remote install|fail closed on dependency mutations|Multiple lockfiles detected/iu.test(
			text,
		)
	)
		return rule(
			"hook: package policy blocked an install",
			firstWord(command),
			"friction",
		);
	if (
		/\bpkg-review\b/u.test(`${command}\n${text}`) &&
		/(?:^|\n)\s*FAIL\b|blocked|denied|reject/iu.test(text)
	)
		return rule("package review rejected", firstWords(command, 2), "friction");
	match =
		/This agent is isolated in the worktree[^,]*, but (this command [^.]*)/iu.exec(
			text,
		);
	if (match)
		return rule(
			"hook: worktree isolation guard refused",
			normalize(match[1] ?? ""),
			"friction",
		);
	match = /(PreToolUse|PostToolUse)[^\n]*hook error: \[([^\]]+)\]/u.exec(text);
	if (match)
		return rule(
			"hook: blocked by a hook",
			relativePath(match[2] ?? ""),
			"friction",
		);
	if (/Projects \(classic\) is being deprecated/u.test(text))
		return rule(
			"gh pr edit fails on GitHub's Projects (classic) deprecation",
			"gh pr edit",
			"friction",
		);
	if (/zsh:\d+: no matches found:/u.test(text))
		return rule(
			"unquoted path with [brackets] or ? expanded by zsh",
			globTarget(text),
			"mistake",
		);
	if (
		/The engine "node" is incompatible|incompatible environment|fnm env. was not applied|Can't infer shell|Unsupported engine|requires node/iu.test(
			text,
		)
	)
		return rule(
			"Node version mismatch / version-manager setup",
			repoTool(command),
			"environment",
		);
	if (/Unknown process id|session not found|No such process/iu.test(text))
		return rule("polled a process that already exited", input.tool, "mistake");
	if (
		/InputValidationError|Invalid tool parameters|invalid_arguments|missing required (?:field|parameter)/iu.test(
			text,
		)
	)
		return rule(
			"tool called with invalid parameters",
			`${input.tool}: ${normalize(line)}`,
			"mistake",
		);

	// Mistakes: stale context, wrong paths, wrong flags.
	match = /Failed to find expected lines in ([^\n:]+)/u.exec(text);
	if (match)
		return rule(
			"stale patch: expected lines not in file",
			fileType(match[1] ?? ""),
			"mistake",
		);
	if (
		/File has been modified since read|String to replace not found|old_string not found|has not been read yet/iu.test(
			text,
		)
	)
		return rule(
			"stale edit: file changed since it was read",
			input.tool,
			"mistake",
		);
	if (/apply_patch verification failed/iu.test(text))
		return rule("invalid patch", normalize(line), "mistake");
	match = /read-only variable:\s*(\w+)/u.exec(text);
	if (match)
		return rule(
			match[1] === "status"
				? "zsh reserved status variable"
				: "read-only shell variable",
			match[1] ?? "",
			"mistake",
		);
	if (
		/Cannot determine intended module format|ERR_AMBIGUOUS_MODULE_SYNTAX|both require\(\) and top-level await/iu.test(
			text,
		)
	)
		return rule(
			"ambiguous require / top-level-await module syntax",
			firstWord(command),
			"mistake",
		);
	if (/unsettled top-level await/iu.test(text))
		return rule("unsettled top-level await", firstWord(command), "mistake");
	match = /^ModuleNotFoundError: No module named ['"]([^'"]+)['"]/mu.exec(text);
	if (match)
		return rule("Python module missing", match[1] ?? "(module)", "environment");
	if (
		/ERR_PACKAGE_PATH_NOT_EXPORTED|Package subpath .*not (?:defined|exported)|No "exports" main defined/iu.test(
			text,
		)
	)
		return rule(
			"unsupported package export",
			importTarget(text),
			"environment",
		);
	if (
		/TS2688|Could not find a declaration file|Cannot find type definition file/iu.test(
			text,
		)
	)
		return rule("missing type declarations", importTarget(text), "validation");
	if (
		/TS2307|Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|Module not found|Could not resolve|Can't resolve/iu.test(
			text,
		)
	) {
		const target = importTarget(text);
		if (/generated|__generated__/iu.test(target))
			return rule(
				"generated artifact import unresolved",
				relativePath(target),
				"environment",
			);
		if (/^(?:\.|\/)/u.test(target))
			return rule(
				"relative source import unresolved",
				relativePath(target),
				"mistake",
			);
		if (target === "(module)")
			return rule(
				"import unresolved (target not retained)",
				normalize(line),
				"other",
			);
		return rule(
			"package import unresolved",
			packageName(target),
			"environment",
		);
	}
	match = /error TS(\d+): ([^\n]*)/u.exec(text);
	if (match)
		return rule(
			"typecheck error",
			`TS${match[1]}: ${normalize(match[2] ?? "")}`,
			"validation",
		);
	match =
		/Type error:\s*([^\n]+)|Property [^\n]+ does not exist on type [^\n]+|Type [^\n]+ is not assignable to type [^\n]+/u.exec(
			text,
		);
	if (match)
		return rule(
			"typecheck error",
			normalize(match[1] ?? match[0]),
			"validation",
		);
	if (
		/command not found|: not found$|No such command|is not recognized as/imu.test(
			text,
		)
	)
		return rule(
			"command not installed",
			firstWord(command) || normalize(line),
			"environment",
		);
	if (
		/another instance of next dev|Another next dev server is already running|Unable to acquire lock/iu.test(
			text,
		)
	)
		return rule(
			"dev server already running",
			firstWords(command, 2),
			"environment",
		);
	if (
		/ECONNREFUSED|ERR_CONNECTION_REFUSED|Connection refused|Is the server running|could not connect to server|Docker daemon|connect ENOENT|Failed to connect to|Couldn't connect to server/iu.test(
			text,
		)
	)
		return rule(
			/ERR_CONNECTION_REFUSED|playwright|puppeteer|browser|page\.goto/iu.test(
				`${command}\n${text}`,
			)
				? "browser automation connection refused"
				: "service not running (db / docker / dev server)",
			firstWord(command),
			"environment",
		);
	if (
		/Authentication failed|permission denied \(publickey\)|401 Unauthorized|bad credentials|not logged in|gh auth login|token.*expired/iu.test(
			text,
		)
	)
		return rule("not authenticated", firstWord(command), "environment");
	if (
		/EADDRINUSE|address already in use|port \d+ is (?:already )?in use/iu.test(
			text,
		)
	)
		return rule("port already in use", firstWord(command), "environment");
	if (
		/\brg\b/u.test(command) &&
		(/unrecognized (?:flag|option)|unknown (?:flag|option)/iu.test(text) ||
			/(?:^|\n)\s*(?:rg:\s*)?-{1,2}[\w-]+:\s*(?:IO error[^\n]*|No such file|.*os error 2)/mu.test(
				text,
			))
	)
		return rule(
			"rg option / argument placement error",
			firstWords(command, 2),
			"mistake",
		);
	if (
		/unknown (?:option|flag|argument|command)|unrecognized (?:option|argument|flag)|invalid option|illegal option|Unknown JSON field/iu.test(
			text,
		)
	)
		return rule(
			"wrong command flags or subcommand",
			firstWords(command, 2),
			"mistake",
		);
	if (/No such file or directory|\(os error 2\)|ENOENT/iu.test(text)) {
		const target = missingTarget(text);
		return rule(
			/node_modules[\\/]/u.test(target)
				? "node_modules filesystem path missing"
				: "path does not exist",
			target,
			/node_modules[\\/]/u.test(target) ? "environment" : "mistake",
		);
	}
	if (
		/Invalid project directory provided|No packages matched the filter|No projects matched the filters/iu.test(
			text,
		)
	)
		return rule(
			"wrong command flags or subcommand",
			firstWords(command, 2),
			"mistake",
		);
	if (/Failed to write file/u.test(text))
		return rule(
			"could not write file (sandbox or path)",
			input.tool,
			"environment",
		);
	if (
		/timed out|TimeoutError|ETIMEDOUT|deadline exceeded|(?:Test )?timeout(?: of)?\s+\d+\s*ms\s+exceeded/iu.test(
			text,
		)
	)
		return rule(
			/playwright|puppeteer|browser|page\.|locator\./iu.test(
				`${command}\n${text}`,
			)
				? "browser automation timed out"
				: "timed out",
			firstWords(command, 2) || input.tool,
			"other",
		);
	match =
		/HTTP(?:\/\d(?:\.\d)?)?[^\n]{0,20}\b([45]\d\d)\b|(?:request|response|status(?: code)?)[^\n]{0,30}\b([45]\d\d)\b/iu.exec(
			text,
		);
	if (match)
		return rule(
			"HTTP request failed",
			match[1] ?? match[2] ?? "",
			"environment",
		);
	if (
		/^(?:python3?|node)\b[^\n]*<</u.test(command.trim()) &&
		/Traceback|SyntaxError|ReferenceError|TypeError|NameError|Cannot determine intended module format|<anonymous_script>/u.test(
			text,
		)
	)
		return rule("ad-hoc inline script crashed", firstWord(command), "mistake");
	if (/SyntaxError/u.test(text) && input.tool === "exec")
		return rule("code-mode script syntax error", input.tool, "mistake");
	if (
		/rejected|non-fast-forward|CONFLICT|merge conflict|would be overwritten|not a git repository|detached HEAD/iu.test(
			text,
		) &&
		/\bgit\b/u.test(command)
	)
		return rule(
			"git refused (conflict / rejected / state)",
			firstWords(command, 2),
			"mistake",
		);

	// Validation: lint, typecheck, tests.
	const ruleIds = lintRuleIds(text);
	if (ruleIds.length > 0)
		return rule("lint rule", ruleIds[0] ?? "", "validation", ruleIds);
	if (
		/Formatter would have printed|format(?:ting)? (?:issues|errors)|prettier\/prettier|Code style issues/iu.test(
			text,
		)
	)
		return rule("formatting not applied", firstWords(command, 3), "validation");
	if (/no tests? found|no test files? found/iu.test(text))
		return rule(
			"test discovery found no tests",
			firstWords(command, 3),
			"environment",
		);
	match =
		/^\s*(?:\(fail\)|✕|×|FAIL(?=\s+[^\n]*\.(?:test|spec)\.)|❯(?=\s+[^\n]*\d+ failed))\s+([^\n]+)/mu.exec(
			text,
		);
	if (
		match ||
		/^\s*\d+ fail(?:ed|ing)?\b|^\s*(?:Test Files|Tests)\s+\d+ failed|^\s*Tests? failed/imu.test(
			text,
		)
	)
		return rule(
			"test failed",
			match ? testName(match[1] ?? "") : firstWords(command, 3),
			"validation",
		);
	if (
		/\b(?:lint|biome|eslint)\b/iu.test(command) &&
		/problem|error/iu.test(text)
	)
		return rule("lint rule", normalize(line), "validation");
	if (
		/Failed to compile|Failed to type check|Build failed|build failed/u.test(
			text,
		)
	)
		return rule("build failed", firstWords(command, 3), "validation");

	// Expected non-zero exits: the exit code is the answer, not a failure.
	if (
		/^\^C$/mu.test(text) ||
		(/\b(?:dev|serve|start|preview)\b/u.test(firstWords(command, 3)) &&
			/SIGINT|SIGTERM|terminated/u.test(text))
	)
		return rule("long-running server stopped", firstWords(command, 2), "noise");
	if (
		/^\s*(?:command -v|which|type|lsof|pgrep|test |\[ )/u.test(command) ||
		/require\.resolve/u.test(command)
	)
		return rule(
			"probe answered 'not found' (exit 1 is the answer)",
			firstWords(command, 2),
			"noise",
		);

	// A search or check that exits 1 with nothing to report.
	match = /(?:^|[|;&(]\s*)(rg|grep|egrep|git grep|fd|find)\b/u.exec(command);
	if (match && input.exitCode === 1 && !STRONG.test(stripPreamble(text)))
		return rule("search found nothing (exit 1)", match[1] ?? "rg", "noise");
	if (input.exitCode === 1 && !STRONG.test(stripPreamble(text)))
		return rule(
			"exit 1 without an error message",
			firstWords(command, 2) || input.tool,
			"other",
		);
	return rule(
		"other error",
		`${firstWords(command, 2) || input.tool}: ${normalize(line)}`,
		"other",
	);
}

function globTarget(text: string): string {
	const match = /no matches found: (\S+)/u.exec(text);
	const target = relativePath(match?.[1] ?? "");
	return (
		target.replace(/^[^[?*]*?\/(?=[^/]*[[?*])/u, "…/").slice(0, 80) || "(glob)"
	);
}

function repoTool(command: string): string {
	const match = /\b(fnm|nvm|volta|mise|asdf)\b/u.exec(command);
	return match?.[1] ?? firstWords(command, 2);
}

function stripPreamble(text: string): string {
	return text
		.split(/\r?\n/u)
		.filter((line) => !PREAMBLE.test(line.trim()))
		.join("\n");
}

function firstWord(command: string): string {
	return firstWords(command, 1);
}

function firstWords(command: string, count: number): string {
	const words = command
		.replace(/^\s*(?:cd\s+\S+\s*(?:&&|;)\s*)+/u, "")
		.replace(/^(?:\w+=\S+\s+)+/u, "")
		.trim()
		.split(/\s+/u)
		.filter((word) => !word.startsWith("-"));
	return words.slice(0, count).join(" ").slice(0, 60);
}

function fileType(path: string): string {
	const rel = relativePath(path.trim());
	const ext = /\.(\w+)$/u.exec(rel)?.[1] ?? "file";
	return `.${ext}`;
}

function packageName(spec: string): string {
	if (!spec) return "(module)";
	const rel = relativePath(spec);
	const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/u.exec(rel);
	if (match) return match[1] ?? rel;
	if (spec.startsWith(".") || spec.startsWith("/")) return "(relative import)";
	return spec
		.split("/")
		.slice(0, spec.startsWith("@") ? 2 : 1)
		.join("/");
}

function missingTarget(text: string): string {
	const match =
		/ENOENT[^\n]*?(?:open|stat|scandir|access|unlink) ['"]([^'"]+)['"]/u.exec(
			text,
		) ??
		/(?:^|\s|')([^\s':]+?)(?::\s*(?:IO error[^\n]*?No such file or directory|No such file or directory)|'?: No such file)/mu.exec(
			text,
		) ??
		/\bpath:\s*['"]([^'"]+)['"]/u.exec(text) ??
		/File does not exist[.:]?\s*([^\n]*)/u.exec(text);
	const target = match?.[1]?.trim() ?? "";
	return target ? relativePath(target).slice(0, 120) : "(path)";
}

function testName(raw: string): string {
	return raw
		.replace(/\s*\[\d+(?:\.\d+)?m?s\]\s*$/u, "")
		.replace(/\s*\(\d+(?:\.\d+)? ?m?s\)\s*$/u, "")
		.replace(/^\s*(?:client|server)\s+/u, "")
		.trim()
		.slice(0, 120);
}

function stripAnsi(text: string): string {
	return text.replace(ANSI_CSI, "").replace(ANSI_OSC, "");
}

function importTarget(text: string): string {
	const match =
		/(?:Cannot find (?:module|package)|Could not resolve|Can't resolve|No module named|Could not find a declaration file for module|Cannot find type definition file for)\s*['"]([^'"]+)['"]/iu.exec(
			text,
		) ??
		/Module not found[^\n]*['"]([^'"]+)['"]/iu.exec(text) ??
		/Package subpath ['"]([^'"]+)['"]/iu.exec(text);
	return match?.[1] ?? "(module)";
}

function lintRuleIds(text: string): string[] {
	const matches: { index: number; id: string }[] = [];
	for (const pattern of [
		/"ruleId"\s*:\s*"([^"\n]+)"/gu,
		/\b(?:error|warning)\s+[^\n]*?\s{2,}((?:@[\w-]+\/)?[\w-]+(?:\/[\w-]+)*)\s*$/gmu,
		/\b((?:lint|assist)\/[\w-]+\/[\w-]+)\b/gu,
	]) {
		for (const match of text.matchAll(pattern)) {
			if (match[1]) matches.push({ index: match.index, id: match[1] });
		}
	}
	return [
		...new Set(
			matches
				.sort((left, right) => left.index - right.index)
				.map((match) => match.id),
		),
	];
}
