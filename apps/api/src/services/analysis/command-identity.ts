/**
 * Command identity of a call: the program it ran (`command_argv0`), its first
 * words (`command_prefix`), and a fingerprint and simhash of its normalized
 * text, so the same command or script can be found across sessions. All four
 * are computed by ClickHouse at query time from the text `calls` already
 * stores, so they always sit next to that text and change for every row at
 * once when these rules change. This file is the only definition.
 */

/** Shell tools whose call text is the command itself (Codex keeps the unwrapped command). */
export const SHELL_TOOLS = [
	"bash",
	"exec_command",
	"shell",
	"shell_command",
	"local_shell",
	"container.exec",
];

/** Extensions of written files whose content counts as a script. */
export const SCRIPT_EXTENSIONS = [
	"sh",
	"bash",
	"zsh",
	"py",
	"rb",
	"pl",
	"ps1",
	"js",
	"mjs",
	"cjs",
	"ts",
] as const;

/** `$(…)` with one level of nesting or quoted parentheses, or a backquoted substitution. */
const SUBSTITUTION = String.raw`\$\((?:[^()'"]|'[^']*'|"[^"]*"|\([^()]*\))*\)|\x60[^\x60]*\x60`;
const DOUBLE_QUOTED = String.raw`"(?:[^"\\$]|\\.|${SUBSTITUTION}|\$)*"`;
/** The words of one statement, quotes and substitutions included. */
const WORDS = String.raw`(?:[^;&|\n'"\x60$]|'[^']*'|${DOUBLE_QUOTED}|${SUBSTITUTION}|\$)*`;
/** `NAME=value` with a quoted, substituted or bare value. */
const ASSIGNMENT = String.raw`[A-Za-z_][A-Za-z0-9_]*=(?:${DOUBLE_QUOTED}|'[^']*'|${SUBSTITUTION}|[^\s;&|'"\x60$]|\$)*`;
/** A statement separator: `&&`, `||`, `;`, a newline. */
const SEPARATOR = String.raw`(?:&&|\|\||;|\n)`;
/**
 * Statements before the command that only set up the shell or print a label:
 * `cd x &&`, `export A=1;`, `source .env`, `A=$(…);`, `echo "== x =="`, a
 * comment line, and `REDACTED;` where the secret filter replaced one.
 */
const SETUP = String.raw`^(?:\s*(?:#[^\n]*(?:\n|$)|(?:cd|pushd|export|source|set|unset|\.|echo|printf)(?:[ \t]${WORDS})?${SEPARATOR}|(?:${ASSIGNMENT}(?:[ \t]+${ASSIGNMENT})*|REDACTED)[ \t]*${SEPARATOR}))*\s*`;
/**
 * What a fingerprint leaves out before a command: changing directory (`cd x
 * &&`), comment lines and `REDACTED;`. Assignments stay, since `A=$(…)` runs
 * a command too.
 */
const LEADING_CD = String.raw`^(?:\s*(?:#[^\n]*(?:\n|$)|(?:cd|pushd)(?:[ \t]${WORDS})?${SEPARATOR}|REDACTED[ \t]*${SEPARATOR}))*\s*`;
/**
 * Wrappers that run the command after them, each with its own options, so
 * argv0 and prefix name that command: `sudo -E bun test` runs bun, `rtk proxy
 * git push` runs git, `npx --yes tsc` runs tsc, `uv run python` runs python.
 * Script runners (`npm run`, `bun run`, `pnpm <script>`) are not wrappers: the
 * script is theirs. The fingerprint keeps wrappers as written.
 */
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
	// A token-saving proxy: `rtk proxy <cmd>` and `rtk <cmd>`.
	String.raw`rtk(?:[ \t]+proxy)?`,
	// Package runners that run a package's program.
	String.raw`(?:npx|bunx|pnpx|uvx|safe-run)(?:[ \t]+(?:-p|--package)[ \t]+\S+|[ \t]+-\S+)*(?:[ \t]+--)?`,
	String.raw`(?:pnpm|yarn|npm)[ \t]+(?:exec|dlx)(?:[ \t]+-\S+)*(?:[ \t]+--)?`,
	String.raw`bun[ \t]+x(?:[ \t]+-\S+)*`,
	String.raw`(?:uv|poetry|pipx)[ \t]+run(?:[ \t]+(?:--with|--project|--directory|--python|--group|--extra|--package)[ \t]+\S+|[ \t]+-\S+)*(?:[ \t]+--)?`,
	String.raw`conda[ \t]+run(?:[ \t]+(?:-n|-p|--name|--prefix)[ \t]+\S+|[ \t]+-\S+)*`,
	// Runners whose own arguments end at `--`.
	String.raw`(?:mise[ \t]+(?:exec|x)|doppler[ \t]+run|op[ \t]+run|dotenv)(?:[ \t]+[^\s;&|]+)*?[ \t]+--`,
];
const WRAPPER = `(?:${WRAPPERS.join("|")})`;
/** A whole command run through `bash -lc '…'`, `sh -c "…"`, `zsh -c …`. */
const SHELL_WRAPPER = String.raw`^\s*(?:\S*/)?(?:ba|z|da|k)?sh\s+(?:-[A-Za-z]+\s+)*-[A-Za-z]*c\s+`;
/** Package-manager and git flags that take the next word as their value. */
const VALUE_FLAGS =
	"(?:-C|--cwd|--filter|-F|--prefix|--dir|--workspace|-w|--config|--registry|--repo|-R)";

function lit(value: string): string {
	return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/**
 * `text` with line continuations joined and a whole-command shell wrapper
 * removed: `bash -lc 'git status'` is `git status`.
 */
function unwrapSql(text: string): string {
	const joined = `replaceRegexpAll(${text}, ${lit(String.raw`\\\n`)}, ' ')`;
	return `replaceRegexpOne(replaceRegexpOne(${joined}, ${lit(String.raw`(?s)${SHELL_WRAPPER}'(.*)'\s*$`)}, ${lit("\\1")}), ${lit(String.raw`(?s)${SHELL_WRAPPER}"(.*)"\s*$`)}, ${lit("\\1")})`;
}

/** The command after its setup statements, environment assignments and wrappers. */
function commandStartSql(text: string): string {
	const setup = `replaceRegexpOne(${unwrapSql(text)}, ${lit(SETUP)}, '')`;
	// A wrapper counts only when a program follows it: `env | grep x` and `rtk
	// --version` run `env` and `rtk`. A leading `&` is PowerShell's call operator.
	return `replaceRegexpOne(${setup}, ${lit(String.raw`^(?:(?:${ASSIGNMENT}|${WRAPPER})[ \t]+|[!({&][ \t]*)*([^\s;&|<>)-])`)}, ${lit("\\1")})`;
}

/** The first word of a command: a substitution `$(…)` whole, otherwise up to an operator. */
const PROGRAM_WORD = String.raw`^(${SUBSTITUTION}|[^\s;&|()<>]+)`;

/**
 * The program a shell command runs: the first word after setup statements
 * (`cd x &&`, `export A=1;`), environment assignments and wrappers (`sudo`,
 * `env`, `timeout 30`, `rtk proxy`, `npx`), without quotes or directory.
 */
export function commandArgv0Sql(command: string): string {
	const word = `extract(${commandStartSql(command)}, ${lit(PROGRAM_WORD)})`;
	return `if(startsWith(${word}, '$('), ${word}, replaceRegexpOne(replaceRegexpAll(${word}, '["\\']', ''), ${lit(String.raw`^.*[/\\]`)}, ''))`;
}

/**
 * The program and its subcommand when the word after it is one (lowercase
 * letters, digits, `-`, `_`, `:`; flags that take a value such as `git -C
 * dir` are passed over): `git push`, `gh pr`, `bun test`; a Python module
 * (`python3 -m pytest`); otherwise the program alone.
 */
export function commandPrefixSql(command: string, argv0: string): string {
	const rest = `replaceRegexpOne(${commandStartSql(command)}, ${lit(PROGRAM_WORD)}, '')`;
	const module = `extract(${rest}, ${lit(String.raw`^[ \t]+(-m[ \t]+[A-Za-z0-9_.]+)`)})`;
	const subcommand = `extract(${rest}, ${lit(String.raw`^(?:[ \t]+${VALUE_FLAGS}[ \t]+[^\s;&|]+)*[ \t]+([a-z][a-z0-9:_-]*)(?:\s|$|[;&|)])`)})`;
	return `multiIf(${argv0} = '', ${argv0}, ${module} != '', concat(${argv0}, ' ', replaceRegexpAll(${module}, '[ \\t]+', ' ')), ${subcommand} != '', concat(${argv0}, ' ', ${subcommand}), ${argv0})`;
}

interface NormalizationRule {
	/** RE2 pattern, replaced everywhere. */
	readonly pattern: string;
	readonly replacement: string;
	/**
	 * Applies to shell commands only. In a code-mode or written script the
	 * string literals are the commands it runs and the leading lines are code.
	 */
	readonly commandsOnly?: boolean;
}

/** `echo`/`printf` after a separator, with arguments up to the next statement. */
const STATUS_LINE = String.raw`${SEPARATOR}[ \t]*(?:echo|printf)(?:[ \t]+(?:<[a-z]+>|[^\s;&|<>])+)*[ \t]*(${SEPARATOR}|$)`;
/** An interpreter's inline program: `python3 -c`, `node -e`, `bash -c`, `pwsh -Command`. */
const INLINE_PROGRAM = String.raw`((?:^|[\s;&|(])(?:\S*/)?(?:python[0-9.]*|node|bun|deno|ruby|perl|php|osascript|(?:ba|z|da|k)?sh|pwsh|powershell)(?:\.exe)?(?:[ \t]+-[A-Za-z-]+)*?[ \t]+-(?:c|e|p|lc|ic|-eval|Command)[ \t]+)`;

/** What may stand before an absolute path. */
const PATH_START = String.raw`^|[^A-Za-z0-9_.@+%~$}/:\\<>-]`;
/** A path component, or a placeholder for a home, temp or worktree root. */
const SEGMENT = "(?:<home>|<tmp>|<worktree>|[A-Za-z0-9_.@+%<>-]+)";
/** An absolute path (from `/` or `$VAR/`): what precedes it, its last two components and what follows it. */
const LAST_TWO = String.raw`(${PATH_START})(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)?(?:/${SEGMENT})*?((?:/${SEGMENT})?/${SEGMENT})/?([^A-Za-z0-9_.@+%/<>-]|$)`;

/** Eight lowercase letters, digits or `_` with at least one digit: `mkdtemp`'s random part. */
const RANDOM_8 = `(?:${[0, 1, 2, 3, 4, 5, 6, 7].map((digit) => `[a-z_]{${digit}}[0-9][a-z0-9_]{${7 - digit}}`).join("|")})`;

/** Each replacement, in order. */
export const NORMALIZATION_RULES: readonly NormalizationRule[] = [
	// The working directory is not the command.
	{ pattern: LEADING_CD, replacement: "", commandsOnly: true },
	// Output plumbing: descriptor duplication, discarded output, head/tail trims.
	{ pattern: String.raw`[ \t]*[0-9]*>&[0-9-]+`, replacement: "" },
	{ pattern: String.raw`[ \t]*[0-9&]*>>?[ \t]*/dev/null`, replacement: "" },
	{
		pattern: String.raw`[ \t]*\|[ \t]*(?:head|tail)(?:[ \t]+-[nc])?(?:[ \t]+[-+]?[0-9]+|[ \t]*-[0-9]+)?([ \t]*(?:;|&&|\|\||\n|\)|$))`,
		replacement: "\\1",
	},
	{
		pattern: String.raw`[A-Za-z][A-Za-z0-9+.-]*://[^\s'"\x60<>)]+`,
		replacement: "<url>",
	},
	// An inline program is code, not data: its quotes are kept (marked until the end).
	{
		pattern: String.raw`${INLINE_PROGRAM}'([^'\n]*)'`,
		replacement: "\\1\x03\\2\x03",
		commandsOnly: true,
	},
	{
		pattern: String.raw`${INLINE_PROGRAM}"((?:[^"\\\n]|\\.)*)"`,
		replacement: "\\1\x04\\2\x04",
		commandsOnly: true,
	},
	// So is the command `ssh` runs on the remote host.
	{
		pattern: String.raw`((?:^|[\s;&|(])(?:\S*/)?ssh[ \t][^'"\n;&|]*)'([^'\n]*)'`,
		replacement: "\\1\x03\\2\x03",
		commandsOnly: true,
	},
	{
		pattern: String.raw`((?:^|[\s;&|(])(?:\S*/)?ssh[ \t][^'"\n;&|]*)"((?:[^"\\\n]|\\.)*)"`,
		replacement: "\\1\x04\\2\x04",
		commandsOnly: true,
	},
	// A quoted absolute path is a path (Windows too); a quoted relative path
	// keeps its words; other single-line quoted strings are data.
	{
		pattern: String.raw`["']((?:~|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|[A-Za-z]:)?[/\\][^\s"']*)["']`,
		replacement: "\\1",
		commandsOnly: true,
	},
	{
		pattern: String.raw`["']((?:[A-Za-z0-9_.@+%\[\]()-]+[/\\])+[A-Za-z0-9_.@+%\[\]()-]*)["']`,
		replacement: "\\1",
		commandsOnly: true,
	},
	{
		pattern: String.raw`'[^'\n]*'|"(?:[^"\\\n]|\\.)*"`,
		replacement: "<str>",
		commandsOnly: true,
	},
	// Absolute paths keep their last two components, the file and its folder;
	// the directories before them are the machine's. Home directories, temp
	// directories and agent worktrees first become `<home>`, `<tmp>` and
	// `<worktree>`, so `~/x/a.md` is `/Users/bob/x/a.md` and `/tmp/a.log` is
	// `/private/tmp/a.log`. Relative paths stay as written: `gh api
	// repos/a/b/pulls` is not `gh api repos/c/d/actions`.
	{
		pattern: String.raw`\b([A-Za-z]:)\\Users\\[^\\\s'";&|]+`,
		replacement: "\\1\\\\<home>",
		commandsOnly: true,
	},
	{
		pattern: String.raw`\b[A-Za-z]:\\(?:[^\\\s'";&|]+\\)*?(?:([^\\\s'";&|]+)\\)?([^\\\s'";&|]+)([\s'";&|]|$)`,
		replacement: "<path>/\\1/\\2\\3",
		commandsOnly: true,
	},
	{ pattern: "<path>//", replacement: "<path>/" },
	{
		pattern: `(${PATH_START})(?:/Users|/home)/[A-Za-z0-9_.@+%-]+`,
		replacement: "\\1/<home>",
	},
	{
		pattern: String.raw`(${PATH_START})(?:~|\$HOME|\$\{HOME\})(/|[\s'";&|)]|$)`,
		replacement: "\\1/<home>\\2",
	},
	{
		pattern: String.raw`(${PATH_START})(?:(?:/private)?/tmp|/var/folders/[^/\s]+/[^/\s]+/T|\$TMPDIR|\$\{TMPDIR\})(/|[\s'";&|)]|$)`,
		replacement: "\\1/<tmp>\\2",
	},
	{
		pattern: String.raw`/\.(?:claude|codex)/worktrees/[A-Za-z0-9_.@+%-]+`,
		replacement: "/<worktree>",
	},
	// A temp directory made per run (`mkdtemp`'s 8 random characters,
	// `mktemp`'s `tmp.XXXXXXXXXX`) is the same directory every run.
	{
		pattern: `(/<tmp>/(?:[A-Za-z0-9_.-]*[-_.])?)(?:${RANDOM_8}|tmp\\.[A-Za-z0-9]{6,12})(/|[^A-Za-z0-9_.@+%/-]|$)`,
		replacement: "\\1<rand>\\2",
	},
	// Twice: a path ends on the character the next one may start after.
	{ pattern: LAST_TWO, replacement: "\\1<path>\\2\\3" },
	{ pattern: LAST_TWO, replacement: "\\1<path>\\2\\3" },
	{
		pattern: String.raw`\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b`,
		replacement: "<uuid>",
	},
	{
		pattern: String.raw`\b[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)?\b`,
		replacement: "<time>",
	},
	{ pattern: String.raw`\b[0-9]+\b`, replacement: "<n>" },
	{ pattern: String.raw`\b[0-9a-fA-F]{7,64}\b`, replacement: "<hex>" },
	// Status lines after the command, twice for runs of them.
	{ pattern: STATUS_LINE, replacement: "\\1" },
	{ pattern: STATUS_LINE, replacement: "\\1" },
	{ pattern: String.raw`\x03`, replacement: "'" },
	{ pattern: String.raw`\x04`, replacement: '"' },
	{ pattern: String.raw`[ \t]*\n\s*`, replacement: "\n" },
	{ pattern: String.raw`[ \t]+`, replacement: " " },
];

/**
 * The normalized text of a call's command (`from` says what it is):
 * incidental values replaced by placeholders, whitespace collapsed.
 */
export function commandNormalizedSql(command: string, from: string): string {
	const chain = (rules: readonly NormalizationRule[]) => {
		let sql = unwrapSql(command);
		for (const rule of rules)
			sql = `replaceRegexpAll(${sql}, ${lit(rule.pattern)}, ${lit(rule.replacement)})`;
		return `trimBoth(${sql})`;
	};
	return `if(${from} = 'command', ${chain(NORMALIZATION_RULES)}, ${chain(NORMALIZATION_RULES.filter((rule) => !rule.commandsOnly))})`;
}

export function commandFingerprintSql(normalized: string): string {
	return `cityHash64(${normalized})`;
}

/**
 * Words a normalized command needs before it gets a simhash (32 bits). Under
 * 10 words equal simhashes are mostly unrelated texts; from 10 words on they
 * are as reliable as for long scripts, and 20 leaves out the one-liners the
 * fingerprint already groups.
 */
export const SIMHASH_MIN_WORDS = 20;

export function commandSimhashSql(normalized: string): string {
	return `if(countMatches(${normalized}, '[[:alnum:]_]+') >= ${SIMHASH_MIN_WORDS}, wordShingleSimHashUTF8(${normalized}), NULL)`;
}

/**
 * From this parser version a command run inside a Codex code-mode script is a
 * call of its own (subtype `nested`, from the completed item), so the script
 * no longer stands for it.
 */
export const NESTED_CALLS_SINCE_PARSER_VERSION = 5;

const EXEC_COMMAND_CALL = String.raw`tools\.exec_command\(`;
const EXEC_COMMAND_CMD = String.raw`tools\.exec_command\(\s*\{\s*"?cmd"?\s*:\s*("(?:[^"\\]|\\.)*")`;

/**
 * Per-row expressions over `rudel.transcript_records` columns, as `WITH`
 * aliases: the row's `command_from` ('' when it carries no command) and
 * `command_text`, NULL when only part of the text is stored.
 */
export function commandSourceSql(): string {
	const tool = `replaceRegexpOne(lower(tool_name), ${lit(String.raw`^functions\.`)}, '')`;
	const full =
		"multiIf(lengthUTF8(text) = text_chars, text, lengthUTF8(head) = text_chars, head, NULL)";
	const single = `countMatches(command_full, ${lit(EXEC_COMMAND_CALL)}) = 1 AND extract(command_full, ${lit(EXEC_COMMAND_CMD)}) != ''`;
	const script = `match(file_path, ${lit(String.raw`\.(?:${SCRIPT_EXTENSIONS.join("|")})$`)})`;
	// A patch that adds a file is its content with every line marked `+`.
	const added = `subtype = 'patch' AND NOT match(command_full, ${lit("(?m)^[^+]")})`;
	return `${tool} AS command_tool,
		multiIf(
			kind = 'tool_call' AND (command_tool IN (${SHELL_TOOLS.map(lit).join(", ")}) OR command_tool = 'powershell'), 'command',
			kind = 'tool_call' AND command_tool = 'exec', if(parser_version < ${NESTED_CALLS_SINCE_PARSER_VERSION} AND ${single}, 'command', 'script'),
			kind = 'file_change' AND file_op = 'write' AND ${script} AND (subtype = 'native' OR ${added}), 'written',
			'') AS command_from,
		${full} AS command_full,
		multiIf(
			command_from = 'command' AND command_tool = 'powershell', JSONExtractString(command_full, 'command'),
			command_from = 'command' AND command_tool = 'exec', JSONExtractString(concat('[', extract(command_full, ${lit(EXEC_COMMAND_CMD)}), ']'), 1),
			command_from = 'written' AND subtype = 'native', JSONExtractString(command_full, 'content'),
			command_from = 'written', replaceRegexpAll(command_full, ${lit(String.raw`(?m)^\+`)}, ''),
			command_from = '', NULL,
			command_full) AS command_text`;
}

/**
 * The command columns of a `rudel.transcript_records` row, as aliases:
 * `command_from` ('' when it carries no command), `command_text` (NULL when
 * only part of it is stored), `command_argv0`, `command_prefix` (NULL for
 * scripts), `command_normalized`, `command_fingerprint` and `command_simhash`.
 */
export function commandColumnsSql(): string {
	return `${commandSourceSql()},
		if(command_from = 'command', ${commandArgv0Sql("command_text")}, NULL) AS command_argv0,
		if(command_from = 'command', ${commandPrefixSql("command_text", "command_argv0")}, NULL) AS command_prefix,
		${commandNormalizedSql("command_text", "command_from")} AS command_normalized,
		${commandFingerprintSql("command_normalized")} AS command_fingerprint,
		${commandSimhashSql("command_normalized")} AS command_simhash`;
}
