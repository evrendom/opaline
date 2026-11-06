import { PATTERN_KINDS, type PatternKind } from "@rudel/api-routes";
import { themeCtes } from "./prompt-themes-sql.js";
import {
	LOCAL_CHECK_CLASSES,
	type MeasureParams,
	sqlString,
	windowEnd,
	windowStart,
} from "./retro-measure-sql.js";
import { CALL_COLUMNS, regexLiteral, sqlLiteral } from "./sql-measures.js";
import { nativeEditToolSql } from "./tool-groups.js";

export const PATTERN_PREFIX: Readonly<Record<PatternKind, string>> = {
	failing_call: "fc",
	retry_loop: "rl",
	wrong_route: "wr",
	correction: "co",
	incomplete: "in",
	theme: "th",
};

export const FIX_TYPES = {
	install_or_agents_md:
		"Install the missing program, or add one AGENTS.md line naming the command to use instead.",
	script_and_pointer:
		"Add a package.json script that runs the command the right way, and point to it from AGENTS.md.",
	navigation_pointer:
		"Point to the file the agent kept looking for: an AGENTS.md line, or a comment at the entry point it starts from.",
	agents_md_rule:
		"Add a rule to AGENTS.md or CLAUDE.md (or the coding standards they point to).",
	instruction:
		"Write what the person had to say once, as an instruction in AGENTS.md or CLAUDE.md.",
	doc: "Write down what the agent kept getting wrong about the code, data or setup, in a doc AGENTS.md points to.",
	skill:
		"Add a skill or checklist for the step the person kept asking for, so the agent does it unasked.",
	read_prompts:
		"Context, not a diagnosis: read the prompts (drill) and the runs before them, then name the fix.",
	tool_schema:
		"Fix the tool's description or input schema so the first call is right.",
	allowlist:
		"Allow the command in the agent's permission settings, or say in AGENTS.md what to use instead.",
	align_ci_check:
		"Make the local check script run what CI runs, and run it before pushing.",
	pretooluse_hook:
		"Add a PreToolUse hook that stops the call before it goes wrong.",
	stop_hook:
		"Add a Stop hook that runs the check when files changed, or an AGENTS.md line to run it before saying done.",
	comment_at_entry:
		"Write the constraint where the agent works: a comment at the top of the file.",
} as const;

export type FixType = keyof typeof FIX_TYPES;

interface Signal {
	readonly kind: PatternKind;
	readonly fix: FixType;
	readonly hint: string;
	readonly meaning: string;
}

const t = "target";
const quoted = `concat('"', substring(splitByString(' ← after ', example)[1], 1, 100), '"')`;

export const PATTERN_SIGNALS: Readonly<Record<string, Signal>> = {
	hook_block: {
		kind: "failing_call",
		fix: "agents_md_rule",
		hint: `concat('AGENTS.md: what the hook blocks and what to run instead of ', ${t})`,
		meaning: "a hook refused the call",
	},
	permission_denial: {
		kind: "failing_call",
		fix: "allowlist",
		hint: `concat('allow ', ${t}, ' in the agent permission settings (.claude/settings.json permissions.allow), or AGENTS.md: what to use instead')`,
		meaning: "a permission rule or sandbox refused the call",
	},
	user_rejected: {
		kind: "failing_call",
		fix: "agents_md_rule",
		hint: `concat('AGENTS.md: when not to call ', ${t}, ' (the person refused it)')`,
		meaning: "the person refused the call",
	},
	refused: {
		kind: "failing_call",
		fix: "agents_md_rule",
		hint: `concat('AGENTS.md: when not to call ', ${t})`,
		meaning: "the call was cancelled before it ran",
	},
	missing_executable: {
		kind: "failing_call",
		fix: "install_or_agents_md",
		hint: `concat('install ', ${t}, ', or AGENTS.md: the command to use instead')`,
		meaning: "a program, module or package was missing",
	},
	environment: {
		kind: "failing_call",
		fix: "install_or_agents_md",
		hint: `concat('fix what ', ${t}, ' needs on this machine, or AGENTS.md: how to set it up')`,
		meaning: "an install or migrate command failed",
	},
	stale_edit: {
		kind: "failing_call",
		fix: "pretooluse_hook",
		hint: `concat('PreToolUse hook on ', ${t}, ': read the file again before editing it')`,
		meaning: "an edit used text the file no longer had",
	},
	wrong_cwd: {
		kind: "failing_call",
		fix: "pretooluse_hook",
		hint: `concat('PreToolUse hook that checks the directory before ', ${t}, ', or AGENTS.md: where to run it')`,
		meaning: "the call ran in the wrong directory",
	},
	argument_error: {
		kind: "failing_call",
		fix: "tool_schema",
		hint: `concat('the description or input schema of ', ${t})`,
		meaning: "a tool or command refused its arguments",
	},
	tool_error: {
		kind: "failing_call",
		fix: "tool_schema",
		hint: `concat('the description of ', ${t}, ': say when it fails like this and what to do instead')`,
		meaning: "an MCP or other tool failed",
	},
	empty_search: {
		kind: "failing_call",
		fix: "navigation_pointer",
		hint: `concat('AGENTS.md: where the code ', ${t}, ' searched for lives')`,
		meaning: "a search found nothing",
	},
	not_found: {
		kind: "failing_call",
		fix: "navigation_pointer",
		hint: `concat('AGENTS.md: the right path for what ', ${t}, ' did not find')`,
		meaning: "a file, path or resource was not there",
	},
	timed_out: {
		kind: "failing_call",
		fix: "script_and_pointer",
		hint: `concat('package.json script for ', ${t}, ' with a fitting timeout or run in the background, pointed to from AGENTS.md')`,
		meaning: "the call's own timeout stopped it",
	},
	check_failed: {
		kind: "failing_call",
		fix: "agents_md_rule",
		hint: `concat('AGENTS.md or coding standards rule so ', ${t}, ' passes the first time')`,
		meaning: "a test, typecheck, lint or build failed with this error",
	},
	command_error: {
		kind: "failing_call",
		fix: "script_and_pointer",
		hint: `concat('package.json script that runs ', ${t}, ' the right way, pointed to from AGENTS.md')`,
		meaning: "a shell command failed",
	},
	same_command: {
		kind: "retry_loop",
		fix: "script_and_pointer",
		hint: `concat('package.json script that runs ', ${t}, ' the right way, pointed to from AGENTS.md')`,
		meaning: "the same failing command ran 3 or more times in one run",
	},
	edit_check_fail: {
		kind: "retry_loop",
		fix: "agents_md_rule",
		hint: `concat('AGENTS.md: what ', ${t}, ' checks and how to pass it, before editing')`,
		meaning: "edit, check, fail, 3 or more times in one run",
	},
	edit_churn: {
		kind: "retry_loop",
		fix: "comment_at_entry",
		hint: `concat('comment at the top of ', ${t}, ' stating the constraint the edits kept missing')`,
		meaning:
			"the same file edited, left and edited again 3 or more times in one run",
	},
	hunted: {
		kind: "wrong_route",
		fix: "navigation_pointer",
		hint: `concat('pointer to ', ${t}, ' in AGENTS.md, or a comment at the entry point the agent starts from')`,
		meaning:
			"the file was read or searched 3 or more times before its first edit",
	},
	dead_end: {
		kind: "wrong_route",
		fix: "comment_at_entry",
		hint: `concat('comment at the top of ', ${t}, ': what it is not, and where to look instead')`,
		meaning:
			"the file was read before the run's first edit of another file and never used in the session",
	},
	overwritten: {
		kind: "wrong_route",
		fix: "comment_at_entry",
		hint: `concat('comment at the top of ', ${t}, ' with the shape it must keep, so edits there land the first time')`,
		meaning:
			"a file edited and later rewritten whole with Write in the same session",
	},
	re_ask: {
		kind: "correction",
		fix: "skill",
		hint: `concat('skill or checklist to run before saying done, from what the person asked again: ', ${quoted})`,
		meaning: "the agent said done and the person asked again",
	},
	interrupt: {
		kind: "correction",
		fix: "instruction",
		hint: `concat('AGENTS.md instruction from what the person said after stopping the agent: ', ${quoted})`,
		meaning: "the person stopped the agent and said this",
	},
	correction: {
		kind: "correction",
		fix: "instruction",
		hint: `concat('AGENTS.md instruction from what the person kept saying: ', ${quoted})`,
		meaning: "a prompt correcting the run before it",
	},
	unchecked: {
		kind: "incomplete",
		fix: "stop_hook",
		hint: `concat('Stop hook that runs the check for ', ${t}, ' when files there changed, or AGENTS.md: run it before saying done')`,
		meaning: "a run edited files and no check passed after its last edit",
	},
	ci_failed: {
		kind: "incomplete",
		fix: "align_ci_check",
		hint: `concat('make the local check script run what CI job ', ${t}, ' runs, and run it before pushing')`,
		meaning:
			"pushed after a passing local check or saying done, and CI failed on the pushed commit",
	},
	opening: {
		kind: "theme",
		fix: "read_prompts",
		hint: `concat('read the prompts that open "', ${t}, '": a request made again and again wants a skill or script; a report that keeps coming back wants its setup fixed or written down')`,
		meaning: "prompts in 3 or more sessions that open with the same words",
	},
	phrase: {
		kind: "theme",
		fix: "read_prompts",
		hint: `concat('read the prompts that say "', ${t}, '": a request made again and again wants a skill or script; a report that keeps coming back wants its setup fixed or written down')`,
		meaning: "prompts in 3 or more sessions with the same 2 to 4 words",
	},
	template: {
		kind: "theme",
		fix: "read_prompts",
		hint: `concat('a tool writes these prompts ("', ${t}, '…"): read what the runs after them did, not the wording')`,
		meaning:
			"a long or structured prompt whose opening recurs: written by a tool or a template, not typed",
	},
};

const DOC_HINT = `concat('doc AGENTS.md points to, on what the person kept explaining: ', ${quoted})`;

const rx = (pattern: string, caseless = true) =>
	regexLiteral(new RegExp(pattern, caseless ? "i" : ""));

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SHA = /\b[0-9a-f]{7,40}\b/;
const PATH = /(?:~|\.{1,2})?(?:\/[\w.@+-]+)+\/?(?::\d+(?::\d+)?)?/;
const FILE =
	/\b[\w.-]+\.(?:tsx?|jsx?|mjs|json|md|sql|ya?ml|css|html|py|sh|toml|lock)\b(?::\d+(?::\d+)?)?/;
const QUOTED = /"[^"]{0,200}"|'[^']{0,200}'|`[^`]{0,200}`/;
const NUMBER = /\d+(?:\.\d+)?/;

export function maskSql(text: string, chars = 140): string {
	const steps: [RegExp, string][] = [
		[UUID, "<id>"],
		[SHA, "<sha>"],
		[PATH, "<path>"],
		[FILE, "<file>"],
		[QUOTED, "'…'"],
		[NUMBER, "N"],
		[/\s+/, " "],
	];
	const masked = steps.reduce(
		(inner, [pattern, by]) =>
			`replaceRegexpAll(${inner}, ${regexLiteral(pattern)}, ${sqlLiteral(by)})`,
		text,
	);
	return `substring(trimBoth(${masked}), 1, ${chars})`;
}

export function relPathSql(path: string): string {
	const steps: [string, string][] = [
		["^.*?/conductor/workspaces/[^/]+/[^/]+/", ""],
		["^.*?/\\.claude/worktrees/[^/]+/", ""],
		["^.*?/wonder/workspaces/[^/]+/", ""],
		["^.*?/coding-projects/[^/]+/", ""],
		["^/Users/[^/]+/", "~/"],
	];
	return steps.reduce(
		(inner, [pattern, by]) =>
			`replaceRegexpOne(${inner}, ${rx(pattern, false)}, ${sqlLiteral(by)})`,
		path,
	);
}

const CHECKS = LOCAL_CHECK_CLASSES.map(sqlString).join(", ");

const FAILING_SUB = `multiIf(
			denial = 'hook' OR match(err, ${rx("hook error|blocked by (a |the )?hook")}), 'hook_block',
			denial IN ('permission-rule', 'Sandbox(Denied)') OR match(err, ${rx("permission denied|operation not permitted|\\bEACCES\\b|\\bEPERM\\b")}), 'permission_denial',
			denial IN ('user-rejected', 'Rejected'), 'user_rejected',
			denial != '', 'refused',
			match(err, ${rx("command not found|not installed|ModuleNotFoundError|No module named|Cannot find (module|package)|executable file not found|spawn \\S+ ENOENT|is not recognized as")}), 'missing_executable',
			match(err, ${rx("string to replace not found|modified since read|has not been read yet|read it again before|found \\d+ matches of the string")}), 'stale_edit',
			match(err, ${rx("not a git repository|cd: no such file|cd: not a directory|could not find .{0,40}package\\.json|no package\\.json|NO_IMPORTER_MANIFEST|script not found|missing script|current working directory is")}), 'wrong_cwd',
			match(err, ${rx("InputValidationError|invalid_type|invalid (arguments?|input|parameters?|option)|unrecognized (keys?|option|argument)|required (property|parameter|argument)|unknown (option|argument|flag)|unexpected (argument|keyword|property)|is not an input|error, recoverable")}), 'argument_error',
			startsWith(tool, 'mcp__'), 'tool_error',
			fk = 'probe' OR match(err, ${rx("no matches found")}), 'empty_search',
			match(err, ${rx("no such file|does not exist|not found|ENOENT|\\b404\\b")}), 'not_found',
			fk = 'timed_out', 'timed_out',
			fk = 'validation', 'check_failed',
			fk = 'environment', 'environment',
			prefix != '', 'command_error',
			'tool_error')`;

const CORRECTION_WORDS = rx(
	"^\\s*(no|nope|nah|stop|wait|wrong|undo|revert)\\b|\\b(don'?t|do not|never|instead|again|still|not what|i said|i told you|i asked|you forgot|you missed|you didn'?t|didn'?t work|doesn'?t work|not working|why did you|why are you|should not|shouldn'?t|not supposed|are (you|u) sure|did (you|u) (even|actually|really)|nothing (changed|happened)|same (issue|error|problem|bug|thing)|what happened|(you|u) (broke|removed|deleted|reverted|ignored)|come on|seriously|(i|we) (already|just) (said|told|asked)|that'?s not)\\b",
);

const MECHANICAL = rx(
	"`[^`]+`|\\b(bun|bunx|npm|npx|pnpm|yarn|git|gh|biome|tsc|eslint|prettier|pytest|cargo|make|docker|curl|uv|pip)\\b|\\b[\\w.-]+/[\\w./-]+|\\.(ts|tsx|js|jsx|json|md|py|sql|sh|css|yml|yaml)\\b|\\bimport\\b|\\brequire\\(|\\bfrom ['\"]|\\w+\\(\\)",
);

const STOP_WORDS = [
	"a",
	"an",
	"the",
	"to",
	"and",
	"or",
	"is",
	"it",
	"its",
	"it's",
	"of",
	"in",
	"on",
	"for",
	"this",
	"that",
	"these",
	"those",
	"i",
	"you",
	"we",
	"me",
	"my",
	"your",
	"be",
	"with",
	"as",
	"at",
	"so",
	"do",
	"just",
	"please",
	"can",
	"now",
	"then",
	"there",
	"here",
	"what",
	"how",
	"are",
	"was",
	"were",
	"have",
	"has",
	"if",
	"but",
	"all",
	"also",
	"let",
	"let's",
	"ok",
	"okay",
	"yes",
	"from",
	"by",
	"they",
	"them",
	"our",
	"us",
	"will",
	"would",
	"should",
	"could",
	"get",
	"make",
	"use",
];

const GENERIC_WORDS = [
	"no",
	"not",
	"don't",
	"dont",
	"never",
	"stop",
	"wait",
	"wrong",
	"again",
	"still",
	"instead",
	"why",
	"did",
	"didn't",
	"does",
	"doesn't",
	"work",
	"working",
	"works",
	"broken",
	"fix",
	"fixed",
	"done",
	"said",
	"told",
	"asked",
	"forgot",
	"missed",
	"undo",
	"revert",
	"nope",
	"nah",
	"really",
	"wtf",
	"what's",
	"see",
	"look",
	"try",
	"dude",
	"bro",
	"man",
	"pls",
	"plz",
	"u",
	"ur",
	"tho",
	"though",
	"kinda",
	"like",
	"want",
	"need",
	"whats",
	"going",
	"every",
	"single",
	"same",
	"thing",
	"things",
	"something",
	"think",
	"know",
	"sure",
	"maybe",
	"actually",
	"more",
	"some",
	"any",
	"way",
	"one",
	"even",
	"much",
	"very",
	"lol",
	"where",
	"when",
	"which",
	"cant",
	"can't",
	"im",
	"i'm",
	"gonna",
	"wanna",
];

const sqlArray = (values: readonly string[]) =>
	`[${values.map(sqlString).join(", ")}]`;

const SUBCOMMAND_PROGRAMS = [
	"git",
	"gh",
	"bun",
	"npm",
	"pnpm",
	"yarn",
	"cargo",
	"docker",
	"uv",
	"pip",
	"pip3",
	"kubectl",
	"go",
	"deno",
	"turbo",
	"vercel",
	"wrangler",
	"brew",
	"make",
	"opaline",
];

const PROBES = [
	"grep",
	"rg",
	"find",
	"fd",
	"ls",
	"test",
	"which",
	"pgrep",
	"diff",
	"cmp",
];

const COMMAND_START = rx(
	"^(?:\\s*(?:cd\\s+(?:\"[^\"]*\"|'[^']*'|\\S+)\\s*(?:&&|;)|export\\s+\\S+\\s*(?:&&|;)?|[A-Za-z_][A-Za-z0-9_]*=(?:\"[^\"]*\"|'[^']*'|\\S*)\\s|(?:sudo|env|time|nohup|exec|command)\\s|timeout\\s+\\S+\\s|(?:npx|bunx|pnpx)\\s+(?:-y\\s+)?|uv\\s+run\\s+|(?:bash|sh|zsh)\\s+-l?c\\s+['\"]?))*\\s*([^\\s;&|()'\"]+)(?:\\s+([a-z][a-z0-9:_-]*))?",
	false,
);

const SHELL_WORDS = [
	"for",
	"while",
	"until",
	"if",
	"case",
	"set",
	"source",
	".",
	"{",
	"do",
	"then",
];

function argv0Sql(cmd: string): string {
	const program = `replaceRegexpOne(extractGroups(${cmd}, ${COMMAND_START})[1], '^.*/', '')`;
	return `if(${program} IN (${SHELL_WORDS.map(sqlString).join(", ")}), 'shell script', ${program})`;
}

function prefixSql(cmd: string): string {
	const argv0 = argv0Sql(cmd);
	return `if(${argv0} IN (${SUBCOMMAND_PROGRAMS.map(sqlString).join(", ")}) AND extractGroups(${cmd}, ${COMMAND_START})[2] != '',
			concat(${argv0}, ' ', extractGroups(${cmd}, ${COMMAND_START})[2]), ${argv0})`;
}

const FAILURE = `multiIf(
			denial != '', 'refused',
			intr = 1, 'interrupted',
			timed = 1, 'timed_out',
			argv0 IN (${PROBES.map(sqlString).join(", ")}) AND exit = 1, 'probe',
			class IN (${CHECKS}), 'validation',
			class IN ('install', 'migrate'), 'environment',
			class = 'git', 'git',
			shell = 1, 'command',
			'tool')`;

const ORIENTATION = rx(
	"(^|/)(CLAUDE|AGENTS|README|SKILL|CONTEXT|CODING_STANDARDS)\\.md$|(^|/)package\\.json$|(^|/)tsconfig[^/]*\\.json$",
);

const DOCS = rx("\\.(md|mdx|txt|png|jpe?g|svg|gif)$");

const el = (tuple: string, index: number) => `tupleElement(${tuple}, ${index})`;

function evidence(fields: {
	kind: string;
	sub: string;
	key: string;
	signature: string;
	target: string;
	rid: string;
	aid: string;
	turn: string;
	at: string;
	cm: string;
	line: string;
	mech?: string;
	hits?: string;
	variant?: string;
}): string {
	return `(${fields.kind}, ${fields.sub}, ${fields.key}, ${fields.signature}, ${fields.target}, ${fields.rid}, ${fields.aid}, toUInt32(${fields.turn}), toDateTime64(${fields.at}, 3, 'UTC'), toFloat64(${fields.cm}), substring(${fields.line}, 1, 280), toUInt8(${fields.mech ?? "0"}), toUInt32(${fields.hits ?? "1"}), ${fields.variant ?? "''"})`;
}

const EV_COLUMNS = [
	"kind",
	"sub",
	"key",
	"signature",
	"target",
	"rid",
	"aid",
	"turn",
	"at",
	"cm",
	"line",
	"mech",
	"hits",
	"variant",
];

const CALL_FIELDS = new Set(CALL_COLUMNS.map((column) => column.name));

export const PARENT_CALL_SQL = CALL_FIELDS.has("parent_call_id")
	? "ifNull(parent_call_id, '')"
	: "''";

export const ERROR_FAMILY_WORDS = 5;
const FAMILY_CUT = /[:(]|\.$/;
const FAMILY_TAIL = /[:(].*$|\.$/;

export function errorFamily(masked: string): string {
	const words = masked
		.toLowerCase()
		.split(/\s+/u)
		.filter(Boolean)
		.slice(0, ERROR_FAMILY_WORDS);
	const cut =
		words.findIndex((word, index) => index >= 1 && FAMILY_CUT.test(word)) + 1;
	const size = cut === 0 ? words.length : cut;
	if (size === 0) return "";
	return [
		...words.slice(0, size - 1),
		(words[size - 1] ?? "").replace(FAMILY_TAIL, ""),
	]
		.join(" ")
		.trim();
}

export function errorFamilySql(masked: string): string {
	const words = `arraySlice(splitByWhitespace(lowerUTF8(${masked})), 1, ${ERROR_FAMILY_WORDS})`;
	const cut = `arrayFirstIndex((w, i) -> i >= 2 AND match(w, ${regexLiteral(FAMILY_CUT)}), ${words}, arrayEnumerate(${words}))`;
	const size = `if(${cut} = 0, length(${words}), ${cut})`;
	return `trimBoth(concat(arrayStringConcat(arraySlice(${words}, 1, ${size} - 1), ' '), ' ', replaceRegexpOne(${words}[${size}], ${regexLiteral(FAMILY_TAIL)}, '')))`;
}

export const PLACEHOLDER_ERRORS = ["(no output)"];

export function failingCallKey(
	tool: string,
	subject: string,
	family: string,
): string {
	const own =
		tool.startsWith("mcp__") ||
		PLACEHOLDER_ERRORS.includes(family) ||
		!/\p{L}{3}/u.test(family);
	return `${own ? subject : ""}|${family}`;
}

export function failingCallKeySql(
	tool: string,
	subject: string,
	family: string,
): string {
	return `concat(if(startsWith(${tool}, 'mcp__') OR has(${sqlArray(PLACEHOLDER_ERRORS)}, ${family})
		OR NOT match(${family}, '\\p{L}{3}'), ${subject}, ''), '|', ${family})`;
}

function evRows(from: string, array: string): string {
	return `SELECT uid, sid, ${EV_COLUMNS.map((name, index) => `${el("e", index + 1)} AS ${name}`).join(", ")}
		FROM (SELECT uid, sid, e FROM (${from}) ARRAY JOIN ${array} AS e)`;
}

function textEvidence(params: MeasureParams): string[] {
	const f = (index: number) => (x: string) => el(x, index);
	const at = f(1);
	const cm = f(2);
	const sub = f(3);
	const subject = f(4);
	const masked = f(5);
	const argv0 = f(6);
	const cmd = f(7);
	const err = f(8);
	const prefix = f(9);
	const cmdMask = f(10);
	const family = f(11);
	const tool = f(12);
	return [
		`tx_calls AS (
		SELECT *, ${FAILING_SUB} AS sub, if(prefix != '', prefix, tool) AS subject, ${maskSql("err")} AS masked,
			${errorFamilySql("masked")} AS family,
			if(shell = 1 AND cmd != '' AND fk != 'probe', ${maskSql("cmd", 120)}, '') AS cmd_mask
		FROM (
			SELECT *, if(shell = 1, ${argv0Sql("cmd")}, '') AS argv0, if(shell = 1, ${prefixSql("cmd")}, '') AS prefix,
				${FAILURE} AS fk
			FROM (
				SELECT *, countIf(parent != '') OVER (PARTITION BY uid, sid, aid, if(parent = '', cid, parent)) AS failing_inner
				FROM (
				SELECT user_id AS uid, session_id AS sid, run_id AS rid, agent_id AS aid, turn_idx AS turn, started_at AS at,
					call_id AS cid, ${PARENT_CALL_SQL} AS parent,
					toFloat64(if(backgrounded = 1, 0, ifNull(call_minutes, 0))) AS cm, toString(tool_name) AS tool,
					ifNull(command_head, '') AS cmd,
					ifNull(error, '') AS err, toString(denial_kind) AS denial, toUInt8(ifNull(interrupted, 0)) AS intr,
					toUInt8(ifNull(timed_out, 0)) AS timed, ifNull(exit_code, 0) AS exit, toString(command_class) AS class,
					toUInt8(command_head IS NOT NULL) AS shell
				FROM calls
				WHERE started_at >= ${windowStart(params)} AND (failed = 1 OR denial_kind != '') AND ifNull(interrupted, 0) = 0
					AND (backgrounded = 0 OR (background_status = 'failed' AND ifNull(error, '') != '(no output)'))
				)
			)
			WHERE parent != '' OR failing_inner = 0
		)
	)`,
		`tx_runs AS (
		SELECT uid, sid, rid, any(aid) AS aid, any(turn) AS turn,
			groupArray((at, cm, sub, subject, masked, argv0, cmd, err, prefix, cmd_mask, family, tool)) AS fs,
			arrayFilter(m -> m != '', groupArray(cmd_mask)) AS masks
		FROM tx_calls
		GROUP BY uid, sid, rid
	)`,
		`ev AS (
		${evRows(
			"SELECT * FROM tx_runs",
			`arrayConcat(
			arrayMap(x -> ${evidence({
				kind: "'failing_call'",
				sub: sub("x"),
				key: failingCallKeySql(tool("x"), subject("x"), family("x")),
				signature: `concat(${subject("x")}, ': ', ${masked("x")})`,
				variant: `concat(${subject("x")}, ': ', ${masked("x")})`,
				target: `if(${sub("x")} IN ('missing_executable', 'environment') AND ${argv0("x")} != '', ${argv0("x")}, ${subject("x")})`,
				rid: "rid",
				aid: "aid",
				turn: "turn",
				at: at("x"),
				cm: cm("x"),
				line: `concat(if(${cmd("x")} != '', concat(substring(${cmd("x")}, 1, 120), ' → '), ''), ${err("x")})`,
			})}, fs),
			arrayMap(m -> ${evidence({
				kind: "'retry_loop'",
				sub: "'same_command'",
				key: "concat('cmd|', m)",
				signature: "concat('the same failing command 3+ times in a run: ', m)",
				target: `${prefix(`arrayFirst(x -> ${cmdMask("x")} = m, fs)`)}`,
				rid: "rid",
				aid: "aid",
				turn: "turn",
				at: `arrayMin(arrayMap(x -> ${at("x")}, arrayFilter(x -> ${cmdMask("x")} = m, fs)))`,
				cm: `arraySum(arrayMap(x -> ${cm("x")}, arrayFilter(x -> ${cmdMask("x")} = m, fs)))`,
				line: `concat(toString(countEqual(masks, m)), ' failures of ', substring(${cmd(`arrayFirst(x -> ${cmdMask("x")} = m, fs)`)}, 1, 120), ' → ', ${err(`arrayFirst(x -> ${cmdMask("x")} = m, fs)`)})`,
				hits: "countEqual(masks, m)",
			})}, arrayFilter(m -> countEqual(masks, m) >= 3, arrayDistinct(masks))))`,
		)}
	)`,
	];
}

const PER_SESSION_HITS = ["edit_check_fail", "edit_churn", "hunted"];

function flowCalls(params: MeasureParams): string[] {
	const edit = "is_edit = 1";
	const evidenceFor = (sub: string, fields: Parameters<typeof evidence>[0]) =>
		`if(has(subs, ${sqlString(sub)}), [${evidence(fields)}], [])`;
	const rel = relPathSql("path");
	return [
		`fl_calls AS (
		SELECT user_id AS uid, session_id AS sid, run_id AS rid, agent_id AS aid, turn_idx AS turn, started_at AS at,
			call_id AS cid, toFloat64(ifNull(call_minutes, 0)) AS cm, toString(tool_name) AS tool, file_path AS path, failed,
			toString(command_class) AS class,
			toUInt8(${nativeEditToolSql("tool_name")} AND failed = 0) AS is_edit,
			toUInt8(command_class IN (${CHECKS}) AND has_result = 1) AS is_check,
			multiIf(${nativeEditToolSql("tool_name")}, 'edit',
				command_class IN (${CHECKS}), 'check',
				file_op = 'read' OR lower(tool_name) = 'read', 'read',
				lower(tool_name) IN ('grep', 'glob', 'ls'), 'search',
				'other') AS act
		FROM calls
		WHERE started_at >= ${windowStart(params)}
			AND (${nativeEditToolSql("tool_name")} OR command_class IN (${CHECKS}) OR file_op = 'read'
				OR lower(tool_name) IN ('read', 'grep', 'glob', 'ls'))
	)`,
		`fl_marked AS (
		SELECT *,
			toUInt8(is_edit = 1 AND path != '' AND NOT match(path, ${DOCS})) AS is_code_edit,
			toUInt8(is_check = 1 AND failed = 0) AS is_pass,
			toUInt8(is_edit = 1 OR is_check = 1) AS in_sequence,
			if(is_edit = 1, path, if(is_check = 1, '#check', '')) AS touch
		FROM fl_calls
	)`,
		`fl_w1 AS (
		SELECT *,
			ifNull(sum(toUInt32(is_check)) OVER (PARTITION BY rid ORDER BY at, cid ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS checks_before,
			lagInFrame(touch, 1, '') OVER (PARTITION BY rid, in_sequence ORDER BY at, cid ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS prev_touch,
			countIf(is_edit = 1) OVER (PARTITION BY rid) AS run_edits,
			minIf(at, is_edit = 1) OVER (PARTITION BY rid) AS run_first_edit,
			maxIf(at, is_code_edit = 1) OVER (PARTITION BY rid) AS run_last_code_edit,
			countIf(is_code_edit = 1) OVER (PARTITION BY rid) AS run_code_edits,
			maxIf(at, is_pass = 1) OVER (PARTITION BY rid) AS run_last_pass,
			countIf(is_pass = 1) OVER (PARTITION BY rid) AS run_passes,
			countIf(is_edit = 1) OVER (PARTITION BY uid, sid, path) AS path_edits,
			minIf(at, is_edit = 1) OVER (PARTITION BY uid, sid, path) AS path_first_edit,
			argMinIf((rid, aid, turn), at, is_edit = 1) OVER (PARTITION BY uid, sid, path) AS path_edit_run,
			max(at) OVER (PARTITION BY uid, sid, path) AS path_last_touch,
			ifNull(countIf(is_edit = 1 AND lower(tool) != 'write') OVER (PARTITION BY uid, sid, path ORDER BY at, cid ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior_edits
		FROM fl_marked
	)`,
		`fl_w2 AS (
		SELECT *, countIf(is_edit = 1) OVER (PARTITION BY rid, checks_before) AS segment_edits
		FROM fl_w1
	)`,
		`fl_w3 AS (
		SELECT *, arrayStringConcat(arraySlice(splitByChar('/', ${rel}), 1, if(length(splitByChar('/', ${rel})) > 2, 2, 1)), '/') AS area,
			arrayFilter(x -> x != '', [
				if(is_check = 1 AND failed = 1 AND segment_edits > 0, 'edit_check_fail', ''),
				if(${edit} AND path != '' AND prev_touch != path, 'edit_churn', ''),
				if(act IN ('read', 'search') AND path != '' AND path_edits > 0 AND at < path_first_edit, 'hunted', ''),
				if(act = 'read' AND failed = 0 AND path != '' AND path_edits = 0 AND run_edits > 0 AND at < run_first_edit
					AND path_last_touch < run_first_edit AND NOT match(path, ${ORIENTATION}), 'dead_end', ''),
				if(${edit} AND lower(tool) = 'write' AND prior_edits > 0, 'overwritten', ''),
				if(is_code_edit = 1 AND at = run_last_code_edit AND (run_passes = 0 OR run_last_pass < run_last_code_edit)
					AND NOT match(${rel}, '^[/~]'), 'unchecked', ''),
				'']) AS subs
		FROM fl_w2
	)`,
		`fl_ev AS (
		${evRows(
			"SELECT * FROM fl_w3 WHERE notEmpty(subs)",
			`arrayConcat(
			${evidenceFor("edit_check_fail", {
				kind: "'retry_loop'",
				sub: "'edit_check_fail'",
				key: "concat('cycle|', class)",
				signature:
					"concat('edit, ', class, ' fails, edit again: 3+ cycles in a run')",
				target: "class",
				rid: "rid",
				aid: "aid",
				turn: "turn",
				at: "at",
				cm: "cm",
				line: "concat('a failing ', class, ' command after ', toString(segment_edits), ' edits')",
			})},
			${evidenceFor("edit_churn", {
				kind: "'retry_loop'",
				sub: "'edit_churn'",
				key: `concat('churn|', ${rel})`,
				signature: `concat('the same file edited back and forth in a run: ', ${rel})`,
				target: rel,
				rid: "rid",
				aid: "aid",
				turn: "turn",
				at: "at",
				cm: "cm",
				line: `concat(tool, ' came back to it after ', if(prev_touch = '#check', 'a check', if(prev_touch = '', 'nothing', 'another file')))`,
			})},
			${evidenceFor("hunted", {
				kind: "'wrong_route'",
				sub: "'hunted'",
				key: `concat('hunted|', ${rel})`,
				signature: `concat('read or searched 3+ times before its first edit: ', ${rel})`,
				target: rel,
				rid: el("path_edit_run", 1),
				aid: el("path_edit_run", 2),
				turn: el("path_edit_run", 3),
				at: "at",
				cm: "cm",
				line: `concat(tool, ' ', toString(round(dateDiff('second', at, path_first_edit) / 60, 1)), ' minutes before the first edit')`,
			})},
			${evidenceFor("dead_end", {
				kind: "'wrong_route'",
				sub: "'dead_end'",
				key: `concat('dead|', ${rel})`,
				signature: `concat('read before editing other files, never used: ', ${rel})`,
				target: rel,
				rid: "rid",
				aid: "aid",
				turn: "turn",
				at: "at",
				cm: "cm",
				line: "'read, then the run edited other files and the session never came back to it'",
			})},
			${evidenceFor("overwritten", {
				kind: "'wrong_route'",
				sub: "'overwritten'",
				key: `concat('overwritten|', ${rel})`,
				signature: `concat('edits overwritten by a later full rewrite: ', ${rel})`,
				target: rel,
				rid: "rid",
				aid: "aid",
				turn: "turn",
				at: "at",
				cm: "cm",
				line: "concat(tool, ' rewrote it after ', toString(prior_edits), ' earlier edits in the session')",
			})},
			${evidenceFor("unchecked", {
				kind: "'incomplete'",
				sub: "'unchecked'",
				key: "concat('unchecked|', area)",
				signature:
					"concat('edits in ', area, ' with no passing check after the last edit')",
				target: "area",
				rid: "rid",
				aid: "aid",
				turn: "turn",
				at: "at",
				cm: "0",
				line: `concat(toString(run_code_edits), ' code edits, last ', ${rel}, if(run_passes = 0, '; no check passed in the run', '; the last passing check came before it'))`,
			})})`,
		)}
	)`,
	];
}

function ciCtes(params: MeasureParams): string[] {
	return [
		`in_pushes AS (
		SELECT user_id AS uid, session_id AS sid, agent_id AS aid, ifNull(turn_idx, 0) AS turn, run_id AS rid,
			at, evidence_id AS evidence, push_to_sha AS sha
		FROM git_events
		WHERE kind = 'push_range' AND at >= ${windowStart(params)} AND at < ${windowEnd(params)}
	)`,
		`in_pushed AS (
		SELECT DISTINCT user_id AS uid, session_id AS sid, evidence_id AS evidence, to_id AS commit_id
		FROM edges
		WHERE relation = 'commit_pushed' AND from_kind = 'run'
			AND (user_id, session_id, evidence_id) IN (SELECT uid, sid, evidence FROM in_pushes)
	)`,
		`in_ci AS (
		SELECT DISTINCT from_id AS commit_id, to_id AS ci_run
		FROM edges
		WHERE relation = 'ci_on_sha' AND from_kind = 'commit' AND to_kind = 'ci_run'
			AND from_id IN (SELECT commit_id FROM in_pushed)
	)`,
		`in_ev AS (
		SELECT p.uid AS uid, p.sid AS sid, 'incomplete' AS kind, 'ci_failed' AS sub, concat('ci|', min(j.name)) AS key,
			concat('pushed, then CI failed: ', min(j.name)) AS signature, min(j.name) AS target, p.rid AS rid,
			p.aid AS aid, toUInt32(p.turn) AS turn, toDateTime64(p.at, 3, 'UTC') AS at, toFloat64(0) AS cm,
			substring(concat('push of ', p.sha, if(max(r.said) = 1, ' after the agent said done', ''), '; failed: ',
				arrayStringConcat(arraySlice(arraySort(groupUniqArray(j.name)), 1, 4), ', ')), 1, 280) AS line,
			toUInt8(0) AS mech, toUInt32(1) AS hits, '' AS variant
		FROM in_pushes AS p
		INNER JOIN in_pushed AS d ON d.uid = p.uid AND d.sid = p.sid AND d.evidence = p.evidence
		INNER JOIN in_ci AS c ON c.commit_id = d.commit_id
		INNER JOIN (SELECT ci_run_id, name FROM ci_jobs WHERE conclusion IN ('failure', 'timed_out')) AS j ON j.ci_run_id = c.ci_run
		INNER JOIN (SELECT run_id, toUInt8(ifNull(said_done, false)) AS said FROM runs) AS r ON r.run_id = p.rid
		GROUP BY p.uid, p.sid, p.aid, p.turn, p.rid, p.at, p.sha
	)`,
	];
}

function correctionCtes(): string[] {
	const tokens = `arrayFilter(w -> length(w) > 1 AND NOT has(${sqlArray(STOP_WORDS)}, w) AND NOT match(w, '^[a-f]+$'),
				extractAll(lowerUTF8(replaceRegexpAll(ph, ${rx("\\[(?:image|pasted)[^\\]]*\\]|<[^>]*>|\\S*[/=:@#]\\S*")}, ' ')), ${rx("\\p{L}[\\p{L}'’]*", false)}))`;
	const generic = sqlArray(GENERIC_WORDS);
	return [
		`co_ev AS (
		SELECT c.uid AS uid, c.sid AS sid, p.rid AS rid, p.aid AS aid, p.turn AS turn, c.at AS at, c.ph AS ph,
			multiIf(p.reasked = 1, 're_ask', p.interrupts > 0, 'interrupt', 'correction') AS sub,
			toUInt8(match(c.ph, ${MECHANICAL})) AS mech, p.said AS said,
			toUInt8(p.reasked = 1 OR p.interrupts > 0 OR hasAny(c.reactions, ['negative', 'swear'])
				OR match(c.ph, ${CORRECTION_WORDS})) AS is_correction,
			arrayDistinct(arrayFilter(g -> g != '', arrayMap(i -> if(
				(has(${generic}, c.words[i]) OR length(c.words[i]) < 4) AND (has(${generic}, c.words[i + 1]) OR length(c.words[i + 1]) < 4), '',
				concat(c.words[i], ' ', c.words[i + 1])), range(1, toUInt32(greatest(length(c.words), 1)))))) AS grams
		FROM (
			SELECT user_id AS uid, session_id AS sid, agent_id AS aid, turn_idx AS turn, started_at AS at, ph,
				prompt_reactions AS reactions, ${tokens} AS words
			FROM (SELECT *, trimBoth(replaceRegexpAll(ifNull(prompt_head, ''), '\\s+', ' ')) AS ph FROM runs)
			WHERE agent_id = '' AND ifNull(thread_source, '') != 'subagent' AND ph != ''
		) AS c
		INNER JOIN (
			SELECT user_id AS uid, session_id AS sid, run_id AS rid, agent_id AS aid, turn_idx AS turn,
				toUInt8(ifNull(reasked, false)) AS reasked, interrupt_markers AS interrupts,
				substring(trimBoth(replaceRegexpAll(ifNull(final_message, ''), '\\s+', ' ')), 1, 90) AS said
			FROM runs
			WHERE agent_id = ''
		) AS p ON p.uid = c.uid AND p.sid = c.sid AND p.turn + 1 = c.turn
	)`,
		`co_grams AS (
		SELECT uid, sid, rid, aid, turn, at, ph, sub, mech, said, gram, is_correction,
			if(gram = '', toUInt64(0), uniqExactIf(sid, is_correction = 1) OVER (PARTITION BY gram)) AS support,
			if(gram = '', toUInt64(0), uniqExact(sid) OVER (PARTITION BY gram)) AS used
		FROM co_ev
		LEFT ARRAY JOIN grams AS gram
	)`,
		`co_rows AS (
		SELECT uid, sid, rid, any(aid) AS aid, any(turn) AS turn, at, any(ph) AS ph, any(sub) AS sub, any(mech) AS mech,
			any(said) AS said, argMax(gram, (if(support * 2 >= used, support, 0), gram)) AS best,
			max(if(support * 2 >= used, support, 0)) AS best_support
		FROM co_grams
		WHERE is_correction = 1
		GROUP BY uid, sid, rid, at
	)`,
	];
}

const CORRECTION_SELECT = `SELECT uid, sid, 'correction' AS kind, sub,
		if(best_support >= 3, concat('gram|', best), concat('one|', sid, '|', toString(at))) AS key,
		concat('the person said "', if(best_support >= 3, best, substring(ph, 1, 60)), '"') AS signature,
		if(best_support >= 3, best, '') AS target, rid, aid, toUInt32(turn) AS turn, toDateTime64(at, 3, 'UTC') AS at,
		toFloat64(0) AS cm,
		substring(concat(ph, ' ← after ', if(said != '', concat('"', said, '"'), 'no final message')), 1, 280) AS line,
		toUInt8(mech) AS mech, toUInt32(1) AS hits, '' AS variant
	FROM co_rows`;

export type PatternFamily = "text" | "flow" | "talk" | "ci" | "theme";

const FAMILY_KINDS: Readonly<Record<PatternFamily, readonly PatternKind[]>> = {
	text: ["failing_call", "retry_loop"],
	flow: ["retry_loop", "wrong_route", "incomplete"],
	talk: ["correction"],
	ci: ["incomplete"],
	theme: ["theme"],
};

export const SHARDED_FAMILIES: readonly PatternFamily[] = ["text", "flow"];

export const SHARD_DAYS = 35;

export function shardWindows(params: MeasureParams): MeasureParams[] {
	const day = 86_400_000;
	const start = Date.parse(`${params.from}T00:00:00Z`);
	const days =
		Math.round((Date.parse(`${params.to}T00:00:00Z`) - start) / day) + 1;
	const count = Math.max(1, Math.ceil(days / SHARD_DAYS));
	const size = Math.ceil(days / count);
	return Array.from({ length: count }, (_, index) => ({
		...params,
		from: new Date(start + index * size * day).toISOString().slice(0, 10),
		to: new Date(start + (Math.min(days, (index + 1) * size) - 1) * day)
			.toISOString()
			.slice(0, 10),
	}));
}

export function patternFamilies(
	kinds: readonly PatternKind[],
): { family: PatternFamily; kinds: PatternKind[] }[] {
	return (["text", "flow", "talk", "ci", "theme"] as const)
		.map((family) => ({
			family,
			kinds: kinds.filter((kind) => FAMILY_KINDS[family].includes(kind)),
		}))
		.filter((part) => part.kinds.length > 0);
}

function evidenceCtes(
	params: MeasureParams,
	family: PatternFamily,
	kinds: readonly PatternKind[],
): string {
	const only = `kind IN (${kinds.map(sqlString).join(", ")})`;
	const built =
		family === "text"
			? { ctes: textEvidence(params), from: "ev" }
			: family === "flow"
				? { ctes: flowCalls(params), from: "fl_ev" }
				: family === "ci"
					? { ctes: ciCtes(params), from: "in_ev" }
					: family === "theme"
						? { ctes: themeCtes(params), from: "th_ev" }
						: { ctes: correctionCtes(), from: `(${CORRECTION_SELECT})` };
	return `${built.ctes.join(",\n\t")},
	evk AS (SELECT *, hits AS weight FROM ${built.from} WHERE ${only})`;
}

export function patternIdSql(kind: string, key: string): string {
	const prefix = `multiIf(${PATTERN_KINDS.map((name) => `${kind} = ${sqlString(name)}, ${sqlString(PATTERN_PREFIX[name])}`).join(", ")}, 'pt')`;
	return `concat(${prefix}, '_', substring(lower(hex(SHA256(concat(${kind}, '|', ${key})))), 1, 10))`;
}

function perRunCte(where = ""): string {
	return `per_run AS (
		SELECT kind, key, rid, ${patternIdSql("kind", "key")} AS id, topKWeighted(1)(sub, weight)[1] AS sub,
			topKWeighted(1)(signature, weight)[1] AS signature, topKWeighted(1)(target, weight)[1] AS target, any(uid) AS uid, any(sid) AS sid, any(aid) AS aid, any(turn) AS turn, sum(hits) AS hits,
			sum(cm) AS cm, min(at) AS first_at, argMin(line, at) AS line, max(mech) AS mech,
			sumMap([variant], [toUInt64(weight)]) AS vmap
		FROM evk
		GROUP BY kind, key, rid
		HAVING NOT (sub IN (${PER_SESSION_HITS.map(sqlString).join(", ")}) AND hits < 3)${where ? ` AND ${where}` : ""}
	)`;
}

function ref(alias: string): string {
	return `concat(${alias}.sid, if(${alias}.aid = '', '', concat(':', ${alias}.aid)), '#', toString(${alias}.turn))`;
}

export const SESSION_IDS = 1000;

export const RUN_TIME_KINDS: readonly PatternKind[] = [
	"correction",
	"incomplete",
	"theme",
];

export const PATTERN_DETAILS = 5;

const THEME_EXAMPLES = 3;

const LINE_KINDS = ["correction", "theme"];

function detailSql(): string {
	const keys = "tupleElement(vsum, 1)";
	const counts = "tupleElement(vsum, 2)";
	const variants = `arrayMap(i -> concat(toString(${counts}[i]), '× ', ${keys}[i]),
				arraySlice(arrayReverseSort(i -> ${counts}[i], arrayFilter(i -> ${keys}[i] != '', arrayEnumerate(${keys}))), 1, ${PATTERN_DETAILS}))`;
	const said = `arraySlice(arrayMap(x -> ${el("x", 3)}, arrayFilter((x, i) -> indexOf(arrayMap(y -> ${el("y", 2)}, said_sorted), ${el("x", 2)}) = i,
				said_sorted, arrayEnumerate(said_sorted))), 1, ${THEME_EXAMPLES})`;
	return `sumMap(tupleElement(g.vmap, 1), tupleElement(g.vmap, 2)) AS vsum,
			arraySort(x -> ${el("x", 1)}, groupArrayIf((g.first_at, g.sid, concat(${ref("g")}, ': ', g.line)), g.kind IN (${LINE_KINDS.map(sqlString).join(", ")}))) AS said_sorted,
			if(g.kind IN (${LINE_KINDS.map(sqlString).join(", ")}), ${said}, ${variants}) AS detail`;
}

function patternsCte(change = false): string {
	return `pat AS (
		SELECT g.id AS id, g.kind AS kind, any(g.key) AS key, topKWeighted(1)(g.sub, g.hits)[1] AS sub,
			topKWeighted(1)(g.signature, g.hits)[1] AS signature, topKWeighted(1)(g.target, g.hits)[1] AS target,
			sum(g.hits) AS count, count() AS runs, uniqExact(g.sid) AS sessions, uniqExact(g.uid) AS members,
			groupUniqArray(${SESSION_IDS})(g.sid) AS sids,
			round(sum(r.active_minutes), 1) AS run_minutes, round(sum(g.cm), 1) AS call_minutes,
			if(g.kind IN (${RUN_TIME_KINDS.map(sqlString).join(", ")}), run_minutes, call_minutes) AS minutes,
			min(g.first_at) AS first_seen, max(g.first_at) AS last_seen, groupArray(toMonday(g.first_at)) AS weeks_hit,
			arraySlice(arrayMap(x -> ${el("x", 3)}, arrayReverseSort(x -> (${el("x", 1)}, ${el("x", 2)}), groupArray((g.hits, g.cm, ${ref("g")})))), 1, 5) AS examples,
			argMax((g.sid, g.aid, g.turn), (g.hits, g.cm, g.rid)) AS ex, argMax(g.line, (g.hits, g.cm, g.rid)) AS example,
			countIf(g.mech = 1) AS mech_runs, ${detailSql()}${
				change
					? `,
			countIf(g.first_at < c.changed_at) AS before_runs, countIf(g.first_at >= c.changed_at) AS after_runs`
					: ""
			}
		FROM per_run AS g
		LEFT JOIN (SELECT run_id, active_minutes FROM runs) AS r ON r.run_id = g.rid${change ? "\n\t\tCROSS JOIN change AS c" : ""}
		GROUP BY g.id, g.kind${change ? ", c.changed_at" : ""}
	)`;
}

export function fixTypeSql(): string {
	const bySub = Object.entries(PATTERN_SIGNALS)
		.map(([sub, signal]) => `sub = ${sqlString(sub)}, ${sqlString(signal.fix)}`)
		.join(", ");
	return `multiIf(kind = 'correction' AND mech_runs * 2 >= runs, 'doc', ${bySub}, 'agents_md_rule')`;
}

export function fixHintSql(): string {
	const bySub = Object.entries(PATTERN_SIGNALS)
		.map(([sub, signal]) => `sub = ${sqlString(sub)}, ${signal.hint}`)
		.join(",\n\t\t\t");
	return `substring(multiIf(kind = 'correction' AND mech_runs * 2 >= runs, ${DOC_HINT},
			${bySub},
			signature), 1, 200)`;
}

function weeks(params: MeasureParams): { first: string; count: number } {
	const monday = (day: string) => {
		const date = new Date(`${day}T00:00:00Z`);
		date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
		return date;
	};
	const first = monday(params.from);
	const count =
		Math.round((monday(params.to).getTime() - first.getTime()) / 604_800_000) +
		1;
	return { first: first.toISOString().slice(0, 10), count };
}

export const PATTERN_MIN_SESSIONS = 3;

export interface PromptThemeScope {
	readonly repository?: string;
	readonly from: string;
	readonly to: string;
	readonly sessions?: readonly string[];
	readonly latest?: number;
	readonly limit?: number;
}

export function promptThemesSql(scope: PromptThemeScope): string {
	return patternsListSql({ ...scope, limit: scope.limit ?? 100 }, "theme", {
		kinds: ["theme"],
		minCount: 1,
	});
}

export interface PatternListOptions {
	readonly kinds: readonly PatternKind[];
	readonly minCount: number;
	readonly minRuns?: number;
	readonly minSessions?: number;
	readonly ids?: readonly string[];
	readonly weeksOf?: MeasureParams;
}

function idFilter(ids: readonly string[] | undefined): string {
	return ids?.length ? ` AND id IN (${ids.map(sqlString).join(", ")})` : "";
}

export function patternsListSql(
	params: MeasureParams,
	family: PatternFamily,
	options: PatternListOptions,
): string {
	const week = weeks(options.weeksOf ?? params);
	return `WITH ${evidenceCtes(params, family, options.kinds)},
	${perRunCte()},
	${patternsCte()}
	SELECT id, kind, signature, count, runs, sessions, members, minutes, toDate(first_seen) AS first_seen,
		toDate(last_seen) AS last_seen, weekly, fix_type, fix_hint, detail, examples,
		tupleElement(ex, 1) AS session_id, tupleElement(ex, 2) AS agent_id, tupleElement(ex, 3) AS turn_idx, sids
	FROM (
		SELECT *, ${fixTypeSql()} AS fix_type, ${fixHintSql()} AS fix_hint,
			arrayStringConcat(arrayMap(w -> toString(countEqual(weeks_hit, w)),
				arrayMap(i -> addWeeks(toDate(${sqlString(week.first)}), i), range(${week.count}))), ' ') AS weekly
		FROM pat
		WHERE count >= ${options.minCount} AND runs >= ${options.minRuns ?? 2}
			AND sessions >= ${options.minSessions ?? PATTERN_MIN_SESSIONS}${idFilter(options.ids)}
	)
	ORDER BY sessions DESC, minutes DESC, count DESC, id
	LIMIT ${params.limit} BY kind`;
}

export function patternKindOf(id: string): PatternKind | undefined {
	const prefix = id.split("_")[0];
	return PATTERN_KINDS.find((kind) => PATTERN_PREFIX[kind] === prefix);
}

export function patternDrillSql(
	params: MeasureParams,
	family: PatternFamily,
	id: string,
): string {
	const kind = patternKindOf(id);
	const window = "OVER ()";
	return `WITH ${evidenceCtes(params, family, kind ? [kind] : PATTERN_KINDS)},
	${perRunCte(`id = ${sqlString(id)}`)}
	SELECT if(row_number() OVER (ORDER BY session_first, sid, first_at, rid) = 1,
			concat(id, ' ', kind, ': ', signature, ' · ', toString(count), ' in ', toString(runs), ' runs · fix ', ${fixTypeSql()}, ': ', ${fixHintSql()}), '') AS pattern,
		sid AS session_id, aid AS agent_id, turn AS turn_idx, first_at AS at, hits, round(cm, 1) AS call_minutes,
		round(r.active_minutes, 1) AS run_minutes, line AS evidence
	FROM (
		SELECT *, min(first_at) OVER (PARTITION BY sid) AS session_first, sum(hits) ${window} AS count,
			count() ${window} AS runs, countIf(mech = 1) ${window} AS mech_runs,
			argMax(line, (hits, cm, rid)) ${window} AS example
		FROM per_run
	) AS g
	LEFT JOIN (SELECT run_id, active_minutes FROM runs) AS r ON r.run_id = g.rid
	ORDER BY session_first, sid, first_at, rid
	LIMIT ${params.limit}`;
}

export const SETUP_CHANGE_KINDS = [
	"instructions",
	"nested_memory",
	"agents_md",
	"skill_body",
];

export interface PatternVerifyOptions extends PatternListOptions {
	readonly since?: string;
}

export function patternsVerifySql(
	params: MeasureParams,
	family: PatternFamily,
	options: PatternVerifyOptions,
): string {
	const change = options.since
		? `change AS (
		SELECT ${sqlString(`since ${options.since}`)} AS file,
			toNullable(toDateTime64(${sqlString(`${options.since} 00:00:00`)}, 3, 'UTC')) AS changed_at
	)`
		: `change AS (
		SELECT if(count() = 0, '', concat(argMax(v.setup_file, v.first_at), ' @ ', argMax(v.name, v.first_at))) AS file,
			if(count() = 0, NULL, max(v.first_at)) AS changed_at
		FROM (
			SELECT setup_file, version, any(version_name) AS name, min(received_at) AS first_at,
				min(min(received_at)) OVER (PARTITION BY setup_file) AS earliest
			FROM setup_files
			WHERE started_at >= ${windowStart(params)} AND received_at < ${windowEnd(params)}
				AND kind IN (${SETUP_CHANGE_KINDS.map(sqlString).join(", ")})
				AND NOT match(setup_file, '/memory/') AND (kind IN ('agents_md', 'skill_body') OR match(path, ${rx("(^|/)(CLAUDE|AGENTS)(\\.local)?\\.md$")}))
			GROUP BY setup_file, version
		) AS v
		WHERE v.first_at > v.earliest
	)`;
	return `WITH ${evidenceCtes(params, family, options.kinds)},
	${perRunCte()},
	${change},
	${patternsCte(true)},
	totals AS (
		SELECT countIf(r.started_at < c.changed_at) AS before_total, countIf(r.started_at >= c.changed_at) AS after_total
		FROM (SELECT started_at FROM runs) AS r
		CROSS JOIN change AS c
	)
	SELECT p.id AS id, p.kind AS kind, p.signature AS signature, p.minutes AS minutes, c.file AS changed,
		toDate(c.changed_at) AS changed_on, p.before_runs AS runs_before,
		round(100 * p.before_runs / nullIf(t.before_total, 0), 2) AS per_100_before, p.after_runs AS runs_after,
		round(100 * p.after_runs / nullIf(t.after_total, 0), 2) AS per_100_after,
		t.before_total AS cohort_runs_before, t.after_total AS cohort_runs_after,
		multiIf(c.changed_at IS NULL OR t.after_total < 10 OR t.before_total < 10, 'no_change_yet',
			ifNull(per_100_after, 0) <= ifNull(per_100_before, 0) * 0.5 AND p.before_runs >= 2, 'improved',
			ifNull(per_100_after, 0) >= greatest(ifNull(per_100_before, 0) * 1.5, 0.01) AND p.after_runs >= 2, 'worse',
			'unchanged') AS status
	FROM (
		SELECT * FROM pat
		WHERE count >= ${options.minCount} AND runs >= 2${idFilter(options.ids)}
		ORDER BY minutes DESC, count DESC, id
		LIMIT ${params.limit}
	) AS p
	CROSS JOIN change AS c
	CROSS JOIN totals AS t
	ORDER BY p.minutes DESC, p.count DESC, p.id`;
}
