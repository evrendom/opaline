import { getSafeClickHouseTable } from "../../clickhouse.js";
import { L1_EDGES_TABLE } from "../l1-edges/l1-edge-tables.js";
import {
	SETUP_SINCE_INDEX_VERSION,
	SETUP_SINCE_PARSER_VERSION,
} from "./received-setup.js";
import { forkReplayOnceCtes } from "./run-index-sql.js";
import { records } from "./sql.js";
import {
	BACKGROUND_SINCE_PARSER_VERSION,
	callRowsSql,
} from "./sql-call-rows.js";
import type { SqlWindow } from "./sql-guard.js";
import { capturedSetupSessionsSql } from "./sql-setup-views.js";
import type { SqlViewColumn } from "./sql-views.js";
import {
	OTHER_SHELL_EDIT_ROUTE,
	SCRIPT_EDIT_ROUTE,
	SHELL_EDIT_ROUTES,
} from "./tool-groups.js";

/**
 * The approved impact measures (CONTEXT.md, Impact): defined once, so two
 * analyses never compute "time lost" or "re-asks" differently and a later
 * update compares like with like. Each is a named aggregate over a view
 * column the server computes here, and `schema` lists them before the agent
 * writes its own SQL. Every view also says which evidence is unknown for its
 * rows (`coverage_gaps`), so a gap is reported as unknown, never as zero.
 *
 * Re-ask is interim until OPL-381 settles it: a run whose final message said
 * the work was done (a literal word rule, `COMPLETION_WORDS`) and whose next
 * prompt in the same stream the language-signals word list marks negative
 * or swearing. The run index stores only what the messages say (index 4,
 * `run-messages.ts`); the rules live here, so changing one rebuilds nothing.
 * Each reads the run index's message columns only from index 4 on (later
 * versions keep them): older builds read as unknown.
 */

export interface SqlMeasure {
	readonly name: string;
	readonly definition: string;
	/** The aggregate, or the statement for measures that combine views. */
	readonly sql: string;
}

/** Words that, in a run's final message, say the agent finished the work. */
const COMPLETION_WORDS = [
	"done",
	"fixed",
	"implemented",
	"completed",
	"finished",
	"resolved",
] as const;
/** The word list's categories that make a prompt unhappy. */
const UNHAPPY = ["negative", "swear"] as const;
/** Run index version from which runs store their messages. */
const MESSAGES_SINCE = 4;
/**
 * Evidence no view can link yet: embeddings are not in L1. Its slice
 * replaces this with a real check.
 */
const NOT_IN_L1 = ["embedding"] as const;

const words = COMPLETION_WORDS.join(", ");
/** Only a member's prompt can follow a run unhappily; subagent streams have none. */
const RATES =
	"For a rate, divide by the runs a member answers: agent_id = '' AND ifNull(thread_source, '') != 'subagent' (subagent runs are never frustrated).";
const SAID_DONE_RULE = `its final message (final_message) contains ${words} as a word that does not come right after not, never or n't (one such word is enough, whatever else the message denies)`;

export const SQL_MEASURES: readonly SqlMeasure[] = [
	{
		name: "active_time",
		sql: "sum(active_minutes)",
		definition:
			"Minutes the runs were active: the gaps between a run's records, each counted up to five minutes, so waiting for a person or a stalled stream is left out. For a group of calls, show both group_run_time and group_call_time.",
	},
	{
		name: "cost",
		sql: "sum(cost_usd)",
		definition:
			"Priced cost in US dollars at each build's pricing version. A NULL cost_usd is unpriced or unknown usage, not free: report countIf(cost_usd IS NULL) next to it.",
	},
	{
		name: "tokens",
		sql: "sum(tokens)",
		definition:
			"Input (uncached, cache reads and cache writes) plus output tokens; reasoning tokens are part of output. A NULL is unknown usage: report countIf(tokens IS NULL) next to it.",
	},
	{
		name: "runs",
		sql: "count()",
		definition:
			"Runs in the group: one human prompt and everything the agent did until the next, in one stream.",
	},
	{
		name: "members",
		sql: "uniqExact(user_id)",
		definition:
			"Members with runs in the group: how widely it is felt. Never to rank or compare people.",
	},
	{
		name: "re_asks",
		sql: "countIf(reasked)",
		definition: `Runs the member had to ask again for (interim definition): ${SAID_DONE_RULE} (said_done), and the next prompt in the same stream is one the language-signals rules mark negative or swearing (frustrated). A run a queued prompt ended mid-work (ended_by_queued_prompt) is never re-asked: the person spoke while it worked. Per week: GROUP BY toMonday(started_at). NULL runs are unknown (built before run index ${MESSAGES_SINCE}, or the stored final message was cut before it said done): report countIf(reasked IS NULL). ${RATES}`,
	},
	{
		name: "frustration",
		sql: "countIf(frustrated)",
		definition: `Runs whose next prompt in the same stream the language-signals rules mark negative or swearing: the member reacted unhappily to the run (complaints, swearing, still-broken and again reports, exasperation at the agent; quoted and code text in the prompt is not read, and swearing next to praise counts as praise). Words only, so sarcasm, calm corrections, polite complaints and other languages are missed. ${RATES}`,
	},
	{
		name: "group_run_time",
		sql: "SELECT sum(active_minutes) FROM runs WHERE run_id IN (SELECT run_id FROM calls WHERE <the group>)",
		definition:
			"A group of calls' time as the active minutes of the runs that contain it, each run once. Not time lost to the group until those runs are read.",
	},
	{
		name: "group_call_time",
		sql: "SELECT sum(call_minutes) FROM calls WHERE <the group>",
		definition:
			"The group's own time: minutes from each of its calls to the call's result. Calls that ran in parallel each count in full; a call without a result has none.",
	},
];

const UNKNOWN_EVIDENCE = `Evidence unknown for this row, never none: system_prompt (no system prompt recorded in the stream at or before the run, or the run was built before run index ${MESSAGES_SINCE}), received_setup (the setup the run received was not read: its session was built before run index ${SETUP_SINCE_INDEX_VERSION} or parsed before parser ${SETUP_SINCE_PARSER_VERSION}; setup_files has no rows for it), setup_snapshot (no capture of the setup on the member's machine was taken by the session's own hooks: the CLI did not upload evidence for it, or uploaded it before setup was recorded; setup_snapshots has no rows for it at session time), github_link (no stored L1 edge links the run to a commit, pull request or CI run, so its GitHub outcome is unknown) and embedding (not embedded yet). Say unknown for these, never zero.`;

export const COVERAGE_COLUMN: SqlViewColumn = {
	name: "coverage_gaps",
	type: "Array(String)",
	meaning: UNKNOWN_EVIDENCE,
	traps: [
		"Filter NOT has(coverage_gaps, 'github_link') before counting GitHub outcomes.",
	],
};

/** The measure columns the runs view adds to the run index's. */
export const RUN_MEASURE_COLUMNS: readonly SqlViewColumn[] = [
	{
		name: "tokens",
		type: "Nullable(UInt64)",
		meaning:
			"Input (uncached, cache reads, cache writes) plus output tokens of the run; reasoning is part of output.",
		traps: ["NULL when the run's usage is unknown, not zero."],
	},
	{
		name: "said_done",
		type: "Nullable(Bool)",
		meaning: `Interim rule: true when ${SAID_DONE_RULE}. False when the run ended on a tool call, or a queued prompt ended it mid-work (ended_by_queued_prompt): its last message was not its final one.`,
		traps: [
			`NULL (unknown) for runs built before run index ${MESSAGES_SINCE}, and when the stored message was cut (final_message_cut) before any such word: the rest may say it. Words only: "Done?" counts, "all tests pass" does not.`,
		],
	},
	{
		name: "ended_by_queued_prompt",
		type: "Nullable(Bool)",
		meaning:
			"The next run in the same stream starts with a queued prompt (prompt_subtype queued): one the person sent while the agent worked, which the agent reads at its next request. That starts a new run, so this run ends mid-work; the work goes on in the next run.",
		traps: [
			"Its final_message and stop_reason are where the work was when the prompt arrived, not a stop: said_done and reasked are false for it. Read the next run for how the work ended; count the two runs as one piece of work when timing or costing it.",
			"NULL when prompt_subtype is NULL (subagent streams before parser 11, runs built before the column existed) and for Codex, which records no queued prompt. A delegation (a parent agent's message to a subagent) is not queued.",
		],
	},
	{
		name: "frustrated",
		type: "Nullable(Bool)",
		meaning:
			"The next run's prompt in the same stream is one the language-signals rules mark negative or swearing (its prompt_reactions).",
		traps: [
			`NULL (unknown) for runs built before run index ${MESSAGES_SINCE}. False for a stream's last run: a reaction in a new session is not linked.`,
		],
	},
	{
		name: "reasked",
		type: "Nullable(Bool)",
		meaning:
			"Interim re-ask: said_done and frustrated. The next run is the member asking again.",
		traps: [
			`NULL (unknown) for runs built before run index ${MESSAGES_SINCE}. Count the re-asked run; the re-ask prompt opens the next run.`,
		],
	},
	COVERAGE_COLUMN,
];

export {
	CALL_COMPLETION_SQL,
	CALL_HAND_OFF_SQL,
	CALL_TASK_END_SQL,
	CALL_TASK_NOTIFICATION_SQL,
	errorLineSql,
	regexLiteral,
	sqlLiteral,
} from "./sql-call-rows.js";

/** First parser version that reads a Claude Code subagent call's timeout limit from its hand-off text. */
const TIMEOUT_LIMIT_SINCE_PARSER_VERSION = 12;

const INNER_PARENT_SINCE_PARSER_VERSION = 14;

/** The call view's columns. */
export const CALL_COLUMNS: readonly SqlViewColumn[] = [
	{
		name: "run_id",
		type: "String",
		meaning:
			"The run the call belongs to; joins runs.run_id. Empty for a call made before its stream's first prompt (turn_idx 0), which belongs to no run.",
		traps: [
			"Calls before the first prompt (a subagent or session reading its instructions before its task arrives, hooks at start) are rows with turn_idx 0 and run_id empty: joins to runs leave them out, so count them from calls alone when they matter.",
		],
	},
	{
		name: "user_id",
		type: "String",
		meaning: "The member who uploaded the session.",
		traps: ["Never for ranking people."],
	},
	{ name: "session_id", type: "String", meaning: "The session.", traps: [] },
	{
		name: "agent_id",
		type: "String",
		meaning: "The stream; empty for the main transcript.",
		traps: [],
	},
	{
		name: "turn_idx",
		type: "UInt32",
		meaning:
			"The run's number within the stream; 0 for a call before the stream's first prompt.",
		traps: [],
	},
	{
		name: "source",
		type: "LowCardinality(String)",
		meaning: "claude_code or codex.",
		traps: [],
	},
	{
		name: "session_date",
		type: "DateTime64(3, 'UTC')",
		meaning: "Session date of the generation.",
		traps: [
			"When the session started, not when the call was made: a resumed session's calls can come days later. Filter started_at for a time range.",
		],
	},
	{
		name: "call_id",
		type: "String",
		meaning:
			"The call's id within its stream, as recorded; its results carry the same id.",
		traps: ["Empty for a few Codex calls; those have no result."],
	},
	{
		name: "call_level",
		type: "LowCardinality(String)",
		meaning:
			"Where the call sits: top (a call the agent made itself), script (a whole Codex code-mode script, also a call the agent made) or inner (a call a script ran: a command, MCP call, patch or search, with parent_call_id its script).",
		traps: [
			"Count each command once over call_level != 'script': the script's command is its whole source, which names its inner commands again. Count calls the agent made, and search output text, over call_level != 'inner': an inner call has its own output only where the transcript recorded it (Codex 0.153 and later).",
			`An inner call names its script from parser ${INNER_PARENT_SINCE_PARSER_VERSION}; before it parent_call_id is empty except for commands an older Codex script ran (call_id <script call_id>#<n>).`,
		],
	},
	{
		name: "parent_call_id",
		type: "String",
		meaning:
			"For an inner call, the call_id of the script that ran it; empty for top and script calls.",
		traps: [
			"A command a script left running in the background can complete after a later script started; it then names the script running when it completed.",
		],
	},
	{
		name: "tool_name",
		type: "LowCardinality(String)",
		meaning:
			"Tool the agent called, as recorded (Bash, Read, exec_command, mcp__server__tool).",
		traps: [],
	},
	{
		name: "started_at",
		type: "DateTime64(3, 'UTC')",
		meaning: "Timestamp of the call record. UTC.",
		traps: [],
	},
	{
		name: "call_minutes",
		type: "Nullable(Float64)",
		meaning:
			"Minutes from the call record to when its work finished (finished_at): its last result, or for a call whose work went on in the background, the task notification that reported its end.",
		traps: [
			"NULL when no result was recorded (interrupted, or the session ended), and for a backgrounded call no notification reported the end of: its time is unknown, not the moment it was handed off. Parallel calls overlap, so their sum can exceed the run's time; waiting for a person (AskUserQuestion) counts.",
		],
	},
	{
		name: "has_result",
		type: "UInt8",
		meaning: "1 when the call has a result in the transcript.",
		traps: [
			"A call without a result (interrupted, or the session ended) is neither failed nor succeeded.",
			"From parser 13 a command an older Codex code-mode script ran (no command item recorded) has no result of its own: its output and outcome are on the script's call (call_id before the #).",
		],
	},
	{
		name: "failed",
		type: "UInt8",
		meaning:
			"1 when a result of the call is an error or exits non-zero, Codex recorded its completed item as failed (an MCP js call's own output does not say), or its background task ended failed or killed or with a non-zero exit code.",
		traps: [
			"Compare failure rates over has_result = 1: a call without a result has failed = 0.",
			"A refused call (denial_kind not empty) is failed too but never ran; filter denial_kind = '' to count commands that ran and failed.",
			"Each failure is on one row: a script whose failure an inner call records (the error an MCP call threw, a command's refusal or exit code) has failed = 0 and error_from_call_id naming that call, so countIf(failed = 1) over every level counts each failure once.",
		],
	},
	{
		name: "error_from_call_id",
		type: "String",
		meaning:
			"On a script whose failure an inner call of it records, that inner call's call_id; empty otherwise.",
		traps: [
			"A failed top-level call is failed = 1 OR error_from_call_id != '' among call_level != 'inner'.",
		],
	},
	{
		name: "exit_code",
		type: "Nullable(Int32)",
		meaning:
			"Exit code a result recorded, else the one its background task's notification reported; NULL when none was recorded.",
		traps: [],
	},
	{
		name: "denial_kind",
		type: "LowCardinality(String)",
		meaning:
			"Why the call was refused before it ran, as recorded: hook (a PreToolUse hook blocked it), permission-rule, user-rejected, cancelled, interrupted (Claude Code toolDenialKind), Sandbox(Denied) or Rejected (Codex), or guard (its output is a guard's or shim's refusal: a line starting STOP: or BLOCKED, or a first line saying Denied or not allowed); empty when it was not refused.",
		traps: [
			`hook is recorded from parser ${BACKGROUND_SINCE_PARSER_VERSION}; before it a hook block reads as a failed call with no exit code.`,
			`guard is recorded from parser ${INNER_PARENT_SINCE_PARSER_VERSION}. It is read from the output, so a refusal worded otherwise is not one: search output for the guard's own words too.`,
			"A script that ran a refused command is guard when its stream records no inner commands (older Codex); where it does, the inner command is guard and the script names it in error_from_call_id. Count refused agent calls as uniqExactIf(if(parent_call_id = '', call_id, parent_call_id), denial_kind != '').",
		],
	},
	{
		name: "denial_reason",
		type: "String",
		meaning:
			"What the refusal said: the guard's refusal line, a blocking hook's message, a Codex Rejected(...) reason or a Claude Code refusal text; empty when the call was not refused or none was recorded.",
		traps: [],
	},
	{
		name: "interrupted",
		type: "Nullable(UInt8)",
		meaning:
			"1 when a result of the call records that it was interrupted: Claude Code toolUseResult.interrupted, its interrupted denial kind, or the interrupt text as the result ('[Request interrupted by user for tool use]'); a Codex call aborted by the user.",
		traps: [
			"NULL when the run cannot record it (its unrecorded_facts has interrupted_calls): Claude Code subagent streams before parser 12. 0 for a call without a result (has_result = 0): an interruption that wrote no result is not seen here, and a run's interrupt markers count it on runs.",
			"A user rejection is a refusal (denial_kind user-rejected), not an interruption, also when Claude Code writes the interrupt text after it.",
		],
	},
	{
		name: "timed_out",
		type: "Nullable(UInt8)",
		meaning:
			"1 when the call's own timeout stopped it: Claude Code moved it to the background (its work may still finish there: see background_status), with timed_out_after_ms the limit.",
		traps: [
			"NULL when the run cannot record it: Codex (it records no call timeout) and Claude Code subagent streams before parser 12. A command's own timeout inside its output (timeout 10 …, a test runner) is not this.",
		],
	},
	{
		name: "timed_out_after_ms",
		type: "Nullable(UInt32)",
		meaning:
			"The limit after which the call's timeout stopped it, in milliseconds: Claude Code toolUseResult.timedOutAfterMs, else the seconds its hand-off text names ('within its 600s timeout').",
		traps: ["NULL when timed_out is not 1."],
	},
	{
		name: "backgrounded",
		type: "UInt8",
		meaning:
			"1 when the call's work went on in the background and its hand-off or task notification names the task's output file: Claude Code Bash run in the background or moved there by its timeout, an async Agent.",
		traps: [
			`Recorded by Claude Code from parser ${BACKGROUND_SINCE_PARSER_VERSION}; 0 before it.`,
			"A Monitor names no output file: it reads 0 here and its time ends at its own result.",
		],
	},
	{
		name: "task_id",
		type: "Nullable(String)",
		meaning:
			"The background task's id (its output file is tasks/<task_id>.output); NULL when the call was not backgrounded.",
		traps: [],
	},
	{
		name: "background_status",
		type: "Nullable(String)",
		meaning:
			"How the background task ended, from its latest task notification: completed, failed, killed (stopped at its time limit), stopped; NULL when no notification reported an end.",
		traps: [
			"The notification can come in a later run of the same stream. An async Agent can notify more than once; the latest counts.",
		],
	},
	{
		name: "background_exit_code",
		type: "Nullable(Int32)",
		meaning:
			"The exit code the background task's latest notification reported; NULL when none did.",
		traps: [],
	},
	{
		name: "finished_at",
		type: "Nullable(DateTime64(3, 'UTC'))",
		meaning:
			"When the call's work finished: its background task's latest ending notification for a backgrounded call, else its last result. UTC.",
		traps: [
			"NULL when there is no result, or for a backgrounded call no notification reported its end (still running when the session stopped, or the notification never came).",
		],
	},
	{
		name: "file_path",
		type: "String",
		meaning:
			"File the call names (read, edit, write), else the first file it changes; empty otherwise.",
		traps: [],
	},
	{
		name: "file_op",
		type: "LowCardinality(String)",
		meaning:
			"What the call does to file_path as the parser read it: read (a Read call, or a shell command that reads the file), else the first change it makes (write, edit, delete); empty otherwise.",
		traps: [
			"From parser 15 absolute where the call's working directory is known (its cwd, each cd before it, ~ as the home); parser 14 and older kept a shell command's path as written, often relative to cwd: match those by their end.",
		],
	},
	{
		name: "command_class",
		type: "LowCardinality(String)",
		meaning:
			"What the shell command does, by its program and subcommand: test, typecheck, lint, build, migrate, install, git or other; a compound command takes its first class in that order. Empty when the call carries no shell command.",
		traps: [
			"Rules over the command text only: a script named test.sh is test, a test runner hidden behind a make target is other.",
			"One class per call: bun test && bun run check-types is test. Count typechecks inside compound commands with has(command_classes, 'typecheck').",
		],
	},
	{
		name: "command_classes",
		type: "Array(String)",
		meaning:
			"The class of each program the shell command runs (test, typecheck, lint, build, migrate, install, git, other), distinct, in the order they first run, setup commands (cd, export, echo) left out; command_class is the one that comes first by precedence. Empty when the call carries no shell command.",
		traps: ["From parser 15; older calls hold their one command_class."],
	},
	{
		name: "command_from",
		type: "String",
		meaning:
			"What carries the call's command: command (a shell command, or one a Codex code-mode script ran) or script (a whole Codex code-mode script); empty when the call carries none.",
		traps: [
			"From parser 5 a command a Codex code-mode script ran is a call of its own (command) next to the script's call (script); filter command_from = 'command' to count commands once. From parser 13 that holds for scripts of Codex versions that recorded no command items too (call_id <script call_id>#<n>).",
			"A script file the agent wrote (find source=calls commandFrom=written) is a file change, not a call's command: its Write or patch call carries none here.",
		],
	},
	{
		name: "command",
		type: "Nullable(String)",
		meaning:
			"The command or script text as stored; NULL when the call carries none.",
		traps: [
			"Only the start is stored when the text was too long; command_chars is then NULL and the identity columns are NULL.",
		],
	},
	{
		name: "command_chars",
		type: "Nullable(UInt64)",
		meaning:
			"Characters of the command; NULL when only part of it is stored or the call carries none.",
		traps: [],
	},
	{
		name: "command_argv0",
		type: "Nullable(String)",
		meaning:
			"The program the shell command runs, after cd, export, assignments and wrappers (sudo, env, timeout, npx, uv run, bash -lc): git, bun, gh.",
		traps: ["NULL for scripts and calls without a command."],
	},
	{
		name: "command_prefix",
		type: "Nullable(String)",
		meaning:
			"The program and its subcommand: git push, gh pr, bun test, python3 -m pytest; the program alone otherwise.",
		traps: ["NULL for scripts and calls without a command."],
	},
	{
		name: "command_programs",
		type: "Array(String)",
		meaning:
			"Each program the shell command runs, read like command_argv0 from every statement of its chains and pipelines (&&, ||, ;, |, newlines), setup statements and shell keywords left out, distinct, in the order they first run: cd x && bun run check-types | tail -3 is [bun, tail].",
		traps: [
			"Empty for scripts, calls without a command and a command only partly stored. A here-document's body and what follows it are not read.",
		],
	},
	{
		name: "command_prefixes",
		type: "Array(String)",
		meaning:
			"Each program with its subcommand, as command_prefix reads it, for every statement command_programs lists: git add -A && git push is [git add, git push].",
		traps: [
			"Filter with has(command_prefixes, 'git push') to find a program anywhere in a chain; command_prefix is the first only.",
		],
	},
	{
		name: "command_fingerprint",
		type: "Nullable(UInt64)",
		meaning:
			"Hash of the normalized command: the same command or script across sessions, members and machines (paths keep their last two parts; numbers, SHAs, UUIDs, times, URLs and quoted strings are placeholders; a leading cd and output trims are dropped).",
		traps: [
			"Group by it to find a command that recurs or keeps failing across the team; it is the commandFingerprint of find source=calls.",
		],
	},
	{
		name: "command_simhash",
		type: "Nullable(UInt64)",
		meaning:
			"32-bit simhash of the normalized command, for copies with small edits.",
		traps: [
			"NULL under 20 words. Two calls are near-duplicates when bitCount(bitXor(a, b)) <= 3.",
		],
	},
	{
		name: "command_head",
		type: "Nullable(String)",
		meaning:
			"The first 300 characters of a shell command's stored text, read without the full text: cheap to match or group on over a long window; NULL when the call is not a shell command.",
		traps: [
			"Cut at 300 characters and not normalized: a leading cd and paths are as written; command_fingerprint groups copies.",
		],
	},
	{
		name: "record_idx",
		type: "UInt32",
		meaning: "Raw transcript line of the call; read takes it as record.",
		traps: [],
	},
	{
		name: "block_idx",
		type: "UInt16",
		meaning: "Content block of the call within its line.",
		traps: [],
	},
	{
		name: "changed_files",
		type: "Array(String)",
		meaning:
			"Every file the call asks to change, in order: an edit tool's file, each file of a patch (apply_patch, or a patch a Codex script ran), a file a shell command writes or deletes (a redirect, tee, sed -i, perl -i, mv, cp, rm, touch, git checkout/restore/rm), and a file an inline Python script of a Claude Code shell call writes (python3 - <<EOF or python3 -c with open(..., 'w'), write_text and the like). changed_file_ops holds each one's write, edit or delete, changed_files_basis how it was found. Every count of file edits reads these.",
		traps: [
			"A request, not proof: a failed or refused call (failed = 1) changed nothing, and a shell write after && or || (cd dir && python3 - <<EOF) may not have run even when the call succeeded. A patch's files sit on the call that holds the patch text: the script whose source has it, or the inner apply_patch call that adds files the source did not name.",
			"From parser 15 shell paths are absolute where the call's working directory is known (its cwd, each cd before it, ~ as the home); parser 14 and older kept them as written, sometimes relative to cwd, as Codex patch paths may be. Files under /tmp, /private/tmp, /var/folders and /dev are left out of shell writes.",
			"Not read from shell text: Codex inline Python scripts, node/bun/ruby scripts (writeFileSync and the like), and a git index-only change (git rm --cached).",
		],
	},
	{
		name: "changed_file_ops",
		type: "Array(String)",
		meaning: "write, edit or delete for each of changed_files.",
		traps: [],
	},
	{
		name: "changed_files_basis",
		type: "Array(String)",
		meaning:
			"How each of changed_files was found: tool (an edit tool's request or a patch), shell (read from a shell command's text) or script (read from an inline Python script's text).",
		traps: [],
	},
	{
		name: "files_read",
		type: "Array(String)",
		meaning:
			"Every file the call reads, in order: a Read call's file, and the files a shell command prints (cat, head, tail, less, more, bat, nl, a printing sed), counts (wc), searches (a non-recursive grep) or opens for reading from an inline Python script; absolute where the call's working directory is known.",
		traps: [
			"From parser 15. Parser 12 to 14 list a Read call's file or a shell command's printed and Python-read files, as written (often relative); older parsers a Read call's file only.",
			"Read from the command text: a file read through a variable, a glob, a recursive grep (a directory) or a script file the command runs is not listed.",
		],
	},
	{
		name: "edit_route",
		type: "LowCardinality(String)",
		meaning: `How the call changed files, the first that holds: 'edit tool <tool_name>' (Edit, Write, MultiEdit, NotebookEdit, apply_patch), 'code-mode script' (a Codex script), '${SCRIPT_EDIT_ROUTE}' (a changed file has basis script), 'other tool <tool_name>' (any other non-shell tool), else the first pattern the shell command's first 300 characters match: ${SHELL_EDIT_ROUTES.map(([name, pattern]) => `'${name}' (${pattern})`).join(", ")}, else '${OTHER_SHELL_EDIT_ROUTE}'. Empty when changed_files is empty.`,
		traps: [
			"One route per call: count calls with count(), file touches with sum(length(changed_files)).",
		],
	},
	{
		name: "error",
		type: "Nullable(String)",
		meaning:
			"The line of a failed or refused call's result that names the error (its first line saying error, failed, not found, denied and the like, else its first line past the exit code), up to 300 characters; NULL when the call did not fail and was not refused.",
		traps: [
			"Read from the stored start and end of the result: an error in the middle of a long output is missed, and the line may be cut. Search output for the whole text.",
		],
	},
	{
		name: "output",
		type: "String",
		meaning:
			"The text of the call's results as stored, in order (several results joined by a newline); empty when it has none.",
		traps: [
			"Stored with the transcript's caps: a result over its cap keeps its start and end around a line [opaline: output cut, <n> of <m> characters stored], and output_cut is 1.",
			"A command an older Codex script ran (no command item recorded) has no output of its own: it is in the script's output.",
			"The widest column: select it only for the calls you read, never across a long window.",
		],
	},
	{
		name: "output_chars",
		type: "UInt64",
		meaning:
			"Characters of the call's results before any cap (code points), so a cut output names its full size.",
		traps: [],
	},
	{
		name: "output_cut",
		type: "UInt8",
		meaning: "1 when part of the output was not stored (see output).",
		traps: [],
	},
	COVERAGE_COLUMN,
	{
		name: "repository",
		type: "String",
		meaning:
			"The session's repository as uploaded (runs.repository), on every call of the session, turn 0 included.",
		traps: [
			"One value per session: filter repository here instead of joining runs. A session started outside a repository puts all its calls on the repository the upload named; runs.cwd_repository says where a run worked.",
		],
	},
	{
		name: "stream_kind",
		type: "LowCardinality(String)",
		meaning:
			"Which stream made the call: main (the session's own transcript), subagent (a Claude Code subagent stream, agent_id not empty) or codex_thread (a Codex thread a parent agent started: a stream of this session, or a session of its own whose thread_source is subagent).",
		traps: [
			"Every stream is here. Reads of instructions and skills mostly happen in subagents: filter stream_kind = 'main' only when the question is about the main transcript.",
		],
	},
	{
		name: "model",
		type: "LowCardinality(Nullable(String))",
		meaning:
			"The model of the response that made the call (its request's usage model), else its run's model (runs.model).",
		traps: [
			"NULL for a call before the first prompt (no run) and when neither the response nor the run names a model; never `<synthetic>`.",
			"Sessions not yet rebuilt at run index 10 give their run's model, so a call in a run that switched models carries the run's first.",
		],
	},
	{
		name: "run_started_at",
		type: "Nullable(DateTime64(3, 'UTC'))",
		meaning: "When the call's run started (runs.started_at). UTC.",
		traps: ["NULL for a call before the first prompt (no run)."],
	},
];

/** How a view reads the run index: its table, the owner condition and committed builds. */
export interface CommittedRuns {
	readonly table: string;
	readonly owner: string;
	readonly committed: string;
}

/**
 * Each committed run with the run index columns `columns` and the measure
 * columns, plus the generation keys the call view joins on.
 */
export function measuredRunsSql(
	runs: CommittedRuns,
	columns: readonly string[],
): string {
	const word = (prefix: string) =>
		sqlString(`(?i)${prefix}\\b(${COMPLETION_WORDS.join("|")})\\b`);
	// A word the cut may have split is not read; negated words are taken out
	// one by one, so another word in the message still counts.
	const kept =
		"if(final_message_cut, replaceRegexpOne(final_message, '\\\\w+$', ''), final_message)";
	const said = `multiIf(final_message IS NULL, false,
			match(replaceRegexpAll(${kept}, ${word("(\\bnot|\\bnever|n['’]t)\\s+(yet\\s+)?(been\\s+)?")}, ' '), ${word("")}), true,
			final_message_cut, NULL, false)`;
	// A run a queued prompt split ended mid-work: its last message was not
	// its final one, so it said nothing done (ended_by_queued_prompt).
	const known = (expression: string) =>
		`if(index_version < ${MESSAGES_SINCE}, NULL, CAST(${expression} AS Nullable(Bool)))`;
	return `SELECT ${columns.map((column) => `r.${column} AS ${column}`).join(", ")},
			r.tokens AS tokens, r.said_done AS said_done, r.ended_by_queued_prompt AS ended_by_queued_prompt,
			r.frustrated AS frustrated,
			CAST(r.said_done AND r.frustrated AS Nullable(Bool)) AS reasked,
			arrayConcat(
				if(r.index_version >= ${MESSAGES_SINCE} AND r.system_prompt_recorded, [], ['system_prompt']),
				if(r.index_version >= ${SETUP_SINCE_INDEX_VERSION} AND r.parser_version >= ${SETUP_SINCE_PARSER_VERSION}, [], ['received_setup']),
				if((r.user_id, r.session_id) IN (${capturedSetupSessionsSql(runs.owner)}), [], ['setup_snapshot']),
				if(r.run_id IN (
					SELECT from_id FROM ${getSafeClickHouseTable(L1_EDGES_TABLE)} FINAL
					WHERE ${runs.owner} AND from_kind = 'run' AND is_active = 1
						AND to_kind IN ('commit', 'pull_request', 'ci_run')
				), [], ['github_link']),
				${sqlArray([NOT_IN_L1[0]])}) AS coverage_gaps,
			r.revision AS revision, r.parser_version AS parser_version
		FROM (
			SELECT *,
				uncached_input_tokens + cache_read_input_tokens + cache_write_5m_input_tokens
					+ cache_write_1h_input_tokens + output_tokens AS tokens,
				if(source = 'codex' OR prompt_subtype IS NULL, NULL,
					CAST(ifNull(leadInFrame(prompt_subtype) OVER stream, '') = 'queued' AS Nullable(Bool))) AS ended_by_queued_prompt,
				if(ifNull(ended_by_queued_prompt, false), ${known("false")}, said_in_message) AS said_done,
				${known(`hasAny(leadInFrame(prompt_reactions) OVER stream, ${sqlArray(UNHAPPY)})`)} AS frustrated
			FROM (
				SELECT *, ${known(said)} AS said_in_message
				FROM ${runs.table} FINAL
				WHERE ${runs.owner} AND row_kind = 'run' AND ${runs.committed}
			)
			WINDOW stream AS (PARTITION BY user_id, session_id, agent_id ORDER BY turn_idx
				ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING)
		) AS r`;
}

export function callsSql(
	runs: CommittedRuns,
	measuredRuns: (runs: CommittedRuns) => string,
	window: SqlWindow = {},
	parentOwner: string = runs.owner,
): string {
	const windowed = windowSessionsSql(runs.owner, "kind = 'tool_call'", window);
	const windowedRuns = windowed
		? { ...runs, owner: `${runs.owner}${windowed.sessions}` }
		: runs;
	const sessions = `${runs.owner}
				AND (user_id, session_id, revision, parser_version) IN (
					SELECT user_id, session_id, committed.1, committed.2 FROM (
						SELECT user_id, session_id, max((revision, parser_version, index_version, build_revision)) AS committed
						FROM ${runs.table} WHERE ${runs.owner} AND row_kind = 'receipt'
						GROUP BY user_id, session_id))${windowed?.sessions ?? ""}`;
	const fresh = `facts['fork_replayed'] != 'true'
				AND (user_id, session_id, agent_id, call_id) NOT IN (SELECT user_id, session_id, agent_id, call_id FROM replayed_calls)`;
	const reads = (...names: string[]) =>
		window.words === undefined ||
		["*", ...names].some((word) => window.words?.has(word));
	const programs = reads("command_programs", "command_prefixes");
	const timeoutUnknown = `r.run_id = '' OR has(r.unrecorded_facts, 'timed_out_calls') OR (c.source = 'claude_code' AND c.agent_id != '' AND c.parser_version < ${TIMEOUT_LIMIT_SINCE_PARSER_VERSION})`;
	const columns: Readonly<Record<string, string>> = {
		run_id: "r.run_id",
		interrupted: `if(r.run_id = '' OR has(r.unrecorded_facts, 'interrupted_calls'), NULL, c.result_interrupted)`,
		timed_out: `if(${timeoutUnknown}, NULL, toUInt8(c.result_timed_out_after_ms IS NOT NULL))`,
		timed_out_after_ms: `if(${timeoutUnknown}, NULL, c.result_timed_out_after_ms)`,
		coverage_gaps: "r.coverage_gaps",
		repository: "s.repository",
		stream_kind: `toLowCardinality(${streamKindSql("c.agent_id", "c.source", "s.thread_source")})`,
		model:
			"toLowCardinality(if(r.run_id = '' OR r.model IN ('', '<synthetic>'), NULL, r.model))",
		run_started_at: "if(r.run_id = '', NULL, r.started_at)",
		output: reads("output") ? "c.output" : "''",
		...(programs
			? {}
			: {
					command_programs: "CAST([], 'Array(String)')",
					command_prefixes: "CAST([], 'Array(String)')",
				}),
	};
	return `WITH ${[...(windowed ? [windowed.with] : []), forkReplayOnceCtes(sessions, parentOwner)].join(",\n\t\t")}
		SELECT ${CALL_COLUMNS.map((column) => `${columns[column.name] ?? `c.${column.name}`} AS ${column.name}`).join(",\n\t\t\t")}
		FROM (${callRowsSql({ sessions, fresh, identity: true, programs, output: reads("output"), commandRows: false })}) AS c
		LEFT JOIN (${measuredRuns(windowedRuns)}) AS r ON r.user_id = c.user_id AND r.session_id = c.session_id
			AND r.revision = c.revision AND r.parser_version = c.parser_version
			AND r.agent_id = c.agent_id AND r.turn_idx = c.turn_idx
		LEFT ANY JOIN (
			SELECT user_id, session_id, repository, ifNull(thread_source, '') AS thread_source
			FROM ${runs.table} FINAL
			WHERE ${windowedRuns.owner} AND row_kind = 'receipt' AND ${runs.committed}
		) AS s ON s.user_id = c.user_id AND s.session_id = c.session_id`;
}

export function streamKindSql(
	agentId: string,
	source: string,
	threadSource: string,
): string {
	return `multiIf(${agentId} != '', if(${source} = 'codex', 'codex_thread', 'subagent'), ${threadSource} = 'subagent', 'codex_thread', 'main')`;
}

export function cohortOwner(owner: string, window: SqlWindow): string {
	return window.cohort
		? `${owner} AND (user_id, session_id) IN (SELECT arrayJoin(${window.cohort}))`
		: owner;
}

/** The sessions with a record in the window, named in a view's statement. */
const WINDOW_SESSIONS = "opaline_window_sessions";

/**
 * The sessions of `owner` with a record that `kinds` selects whose `ts`
 * lies in `window`, read once (`with`, for the statement's WITH), and the
 * condition that keeps a scan to them (`sessions`, to append with AND):
 * matching the storage key's prefix, each scan then reads only those
 * sessions' parts. Nothing when the window is unbounded.
 */
export function windowSessionsSql(
	owner: string,
	kinds: string,
	window: SqlWindow,
): { with: string; sessions: string } | undefined {
	const bounds = [
		...(window.from === undefined ? [] : [`ts >= (${window.from})`]),
		...(window.to === undefined ? [] : [`ts <= (${window.to})`]),
	];
	if (bounds.length === 0) return undefined;
	return {
		with: `(SELECT groupUniqArray((user_id, session_id)) FROM ${records()}
			WHERE ${owner} AND ${kinds} AND ${bounds.join(" AND ")}) AS ${WINDOW_SESSIONS}`,
		sessions: `
				AND (user_id, session_id) IN (SELECT arrayJoin(${WINDOW_SESSIONS}))`,
	};
}

function sqlArray(values: readonly string[]): string {
	return `[${values.map(sqlString).join(", ")}]`;
}

function sqlString(value: string): string {
	return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}
