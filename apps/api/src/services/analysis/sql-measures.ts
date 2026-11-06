import { getSafeClickHouseTable } from "../../clickhouse.js";
import { L1_EDGES_TABLE } from "../l1-edges/l1-edge-tables.js";
import { commandColumnsSql, SHELL_TOOLS } from "./command-identity.js";
import { PREAMBLE, STRONG } from "./failure-classifier.js";
import {
	SETUP_SINCE_INDEX_VERSION,
	SETUP_SINCE_PARSER_VERSION,
} from "./received-setup.js";
import { forkReplayCtes, runToolErrorSql } from "./run-index-sql.js";
import { records, toolErrorSql } from "./sql.js";
import type { SqlWindow } from "./sql-guard.js";
import { capturedSetupSessionsSql } from "./sql-setup-views.js";
import type { SqlViewColumn } from "./sql-views.js";
import {
	editRouteSql,
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
		definition: `Runs the member had to ask again for (interim definition): ${SAID_DONE_RULE} (said_done), and the next prompt in the same stream is one the word list marks negative or swearing (frustrated). A run a queued prompt ended mid-work (ended_by_queued_prompt) is never re-asked: the person spoke while it worked. Per week: GROUP BY toMonday(started_at). NULL runs are unknown (built before run index ${MESSAGES_SINCE}, or the stored final message was cut before it said done): report countIf(reasked IS NULL). ${RATES}`,
	},
	{
		name: "frustration",
		sql: "countIf(frustrated)",
		definition: `Runs whose next prompt in the same stream the language-signals word list marks negative or swearing: the member reacted unhappily to the run. Words only, so sarcasm, polite complaints and other languages are missed. ${RATES}`,
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
			"The next run's prompt in the same stream is one the language-signals word list marks negative or swearing (its prompt_reactions).",
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

/** First parser version that links background tasks and hook blocks to their calls. */
const BACKGROUND_SINCE_PARSER_VERSION = 11;

// From parser 11 a task notification carries the call id of the call whose
// background work it reports on, so it joins the call's group (the only
// injected context the scan keeps). One that ended the task records
// interrupted (true when killed or stopped), is_error (failed or killed),
// its exit code and the task's output file in the record's own columns,
// and the hand-off result names that file. They fold into the call's
// result states (its last record, failure and exit code), so a call costs
// two more aggregate states, never a read of the facts map.
export const CALL_TASK_NOTIFICATION_SQL = "kind = 'injected_context'";
export const CALL_TASK_END_SQL = `${CALL_TASK_NOTIFICATION_SQL} AND interrupted IS NOT NULL`;
export const CALL_COMPLETION_SQL = `kind = 'meta' AND call_id != '' AND (subtype IN ('exec_command_end', 'patch_apply_end') OR startsWith(subtype, 'item_completed:'))`;
export const CALL_HAND_OFF_SQL = `kind = 'tool_result' AND parser_version >= ${BACKGROUND_SINCE_PARSER_VERSION} AND match(file_path, '/tasks/[A-Za-z0-9_-]+\\\\.output$')`;

/** First parser version that reads a Claude Code subagent call's timeout limit from its hand-off text. */
const TIMEOUT_LIMIT_SINCE_PARSER_VERSION = 12;

const INNER_PARENT_SINCE_PARSER_VERSION = 14;

/** The call view's columns. */
export const CALL_COLUMNS: readonly SqlViewColumn[] = [
	{
		name: "run_id",
		type: "String",
		meaning: "The run the call belongs to; joins runs.run_id.",
		traps: [],
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
		meaning: "The run's number within the stream.",
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
			"A shell command's file_path is as written, often relative to cwd: match it to an absolute path by its end.",
		],
	},
	{
		name: "command_class",
		type: "LowCardinality(String)",
		meaning:
			"What the shell command does, by its program and subcommand: test, typecheck, lint, build, migrate, install, git or other; a compound command takes its first class in that order. Empty when the call carries no shell command.",
		traps: [
			"Rules over the command text only: a script named test.sh is test, a test runner hidden behind a make target is other.",
		],
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
			"Paths as written: absolute from Codex patches, sometimes relative to cwd from shell commands. Files under /tmp, /private/tmp, /var/folders and /dev are left out of shell writes.",
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
				if(ifNull(ended_by_queued_prompt, false), ${known("false")}, ${known(said)}) AS said_done,
				${known(`hasAny(leadInFrame(prompt_reactions) OVER stream, ${sqlArray(UNHAPPY)})`)} AS frustrated
			FROM ${runs.table} FINAL
			WHERE ${runs.owner} AND row_kind = 'run' AND ${runs.committed}
			WINDOW stream AS (PARTITION BY user_id, session_id, agent_id ORDER BY turn_idx
				ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING)
		) AS r`;
}

/**
 * One row per tool call of the committed runs: what it called (its command
 * identity, `command-identity.ts`), its time from the call record to its
 * last result record, whether a result failed, and its run's coverage. A
 * call's result records share its `call_id` in its stream; a call recorded
 * twice (a resumed transcript repeats it) is one row, its first record. Calls
 * a forked Codex session replays from its parent, and their results, are left
 * out as the run index leaves them out (`forkReplayCtes`).
 *
 * `window` is the started_at range the agent's query keeps, when the gateway
 * can tell (`sql-guard.ts`): only sessions with a call record in it are read
 * (`windowSessionsSql`), calls and results alike, so a short window over a
 * long history stays within the memory limit. Every call in the range has
 * its call record there, so the rows the query keeps are the same.
 */
export function callsSql(
	runs: CommittedRuns,
	measuredRuns: string,
	window: SqlWindow = {},
	parentOwner: string = runs.owner,
): string {
	const windowed = windowSessionsSql(runs.owner, "kind = 'tool_call'", window);
	const sessions = `${runs.owner}
				AND (user_id, session_id, revision, parser_version) IN (
					SELECT user_id, session_id, committed.1, committed.2 FROM (
						SELECT user_id, session_id, max((revision, parser_version, index_version, build_revision)) AS committed
						FROM ${runs.table} WHERE ${runs.owner} AND row_kind = 'receipt'
						GROUP BY user_id, session_id))${windowed?.sessions ?? ""}`;
	const fresh = `facts['fork_replayed'] != 'true'
				AND (user_id, session_id, agent_id, call_id) NOT IN (SELECT user_id, session_id, agent_id, call_id FROM replayed_calls)`;
	const generation = "user_id, session_id, revision, parser_version, agent_id";
	/**
	 * What the call's first record says, each its own aggregate, so a query
	 * that reads none of the command columns reads no stored text.
	 */
	const first = [
		"turn_idx",
		"tool_name",
		"subtype",
		"parent",
		"file_path",
		"file_op",
		"command_class",
		"command_from",
		"command",
		"command_chars",
		"command_argv0",
		"command_prefix",
		"command_fingerprint",
		"command_simhash",
		"command_head",
		"record_idx",
		"block_idx",
	];
	const call = "kind = 'tool_call'";
	const result = "kind = 'tool_result'";
	const mirror = CALL_COMPLETION_SQL;
	const change = `kind = 'file_change' AND file_path != '' AND (file_op IN ('write', 'edit', 'delete')
				OR subtype IN ('shell_conditional', 'shell_script_conditional') AND file_op IN ('inferred_write', 'inferred_edit', 'inferred_delete'))`;
	const stored = "if(lengthUTF8(text) >= lengthUTF8(head), text, head)";
	const piece = `if(text_chars > lengthUTF8(${stored}) + lengthUTF8(tail),
					concat(${stored}, '\\n[opaline: output cut, ', toString(lengthUTF8(${stored}) + lengthUTF8(tail)), ' of ', toString(text_chars), ' characters stored]\\n', tail),
					${stored})`;
	const notification = CALL_TASK_NOTIFICATION_SQL;
	const taskEnd = CALL_TASK_END_SQL;
	const handOff = CALL_HAND_OFF_SQL;
	// A Claude Code subagent stream records a timeout only in its hand-off
	// text, whose limit the parser reads from version 12; the run index
	// counts that hand-off from parser 11, without the limit.
	const timeoutUnknown = `has(r.unrecorded_facts, 'timed_out_calls') OR (r.source = 'claude_code' AND c.agent_id != '' AND c.parser_version < ${TIMEOUT_LIMIT_SINCE_PARSER_VERSION})`;
	return `WITH ${[...(windowed ? [windowed.with] : []), forkReplayCtes(sessions, parentOwner)].join(",\n\t\t")}
		SELECT r.run_id AS run_id, c.user_id AS user_id, c.session_id AS session_id,
			c.agent_id AS agent_id, c.first_turn_idx AS turn_idx, r.source AS source,
			c.session_date AS session_date, c.call_id AS call_id,
			toLowCardinality(multiIf(r.source = 'codex' AND c.first_subtype IN ('nested', 'script'), 'inner',
				c.first_command_from = 'script', 'script', 'top')) AS call_level,
			multiIf(call_level != 'inner', '', c.first_parent != '', c.first_parent,
				c.first_subtype = 'script' AND position(c.call_id, '#') > 0, substring(c.call_id, 1, position(c.call_id, '#') - 1), '') AS parent_call_id,
			toLowCardinality(c.first_tool_name) AS tool_name,
			c.started_at AS started_at,
			if(finished_at IS NULL, NULL, greatest(0, dateDiff('millisecond', c.started_at, finished_at)) / 60000) AS call_minutes,
			toUInt8(c.results > 0) AS has_result,
			toUInt8(ifNull(c.result_failed, 0)) AS failed, c.error_from_call_id AS error_from_call_id,
			c.result_exit_code AS exit_code,
			toLowCardinality(c.result_denial_kind) AS denial_kind, c.denial_reason AS denial_reason,
			if(has(r.unrecorded_facts, 'interrupted_calls'), NULL, toUInt8(c.result_interrupted)) AS interrupted,
			if(${timeoutUnknown}, NULL, toUInt8(c.result_timed_out_after_ms IS NOT NULL)) AS timed_out,
			if(${timeoutUnknown}, NULL, c.result_timed_out_after_ms) AS timed_out_after_ms,
			toUInt8(c.task_file != '') AS backgrounded,
			nullIf(extract(c.task_file, '/tasks/([A-Za-z0-9_-]+)\\\\.output$'), '') AS task_id,
			if(c.task_end.1 IS NULL, NULL,
				multiIf(c.task_end.1 AND c.task_end.2, 'killed', c.task_end.1, 'stopped', c.task_end.2, 'failed', 'completed')) AS background_status,
			if(c.task_end.1 IS NULL, NULL, c.result_exit_code) AS background_exit_code,
			if(c.task_file != '' AND c.task_end.1 IS NULL OR c.results = 0, NULL, c.result_at) AS finished_at,
			${first
				.filter(
					(name) =>
						!["turn_idx", "tool_name", "subtype", "parent"].includes(name),
				)
				.map((name) =>
					name === "file_path"
						? "if(c.first_file_path != '', c.first_file_path, c.changes[1].2) AS file_path"
						: name === "file_op"
							? "toLowCardinality(if(c.first_file_op != '', c.first_file_op, c.changes[1].3)) AS file_op"
							: name === "command_class"
								? `toLowCardinality(c.first_${name}) AS ${name}`
								: `c.first_${name} AS ${name}`,
				)
				.join(", ")},
			arrayMap(x -> x.2, c.changes) AS changed_files, arrayMap(x -> x.3, c.changes) AS changed_file_ops,
			arrayMap(x -> x.4, c.changes) AS changed_files_basis,
			toLowCardinality(${editRouteSql({ tool: "c.first_tool_name", from: "c.first_command_from", head: "c.first_command_head", files: "c.changes", basis: "arrayMap(x -> x.4, c.changes)" })}) AS edit_route,
			if(ifNull(c.result_failed, 0) OR c.result_denial_kind != '', ${errorLineSql("if(c.result_error_head = '' AND c.result_error_tail = '', concat(c.result_head, char(10), c.result_tail), concat(c.result_error_head, char(10), c.result_error_tail))")}, NULL) AS error,
			arrayStringConcat(arrayMap(x -> x.2, c.outputs), char(10)) AS output,
			c.output_chars AS output_chars, toUInt8(c.output_cut) AS output_cut,
			r.coverage_gaps AS coverage_gaps
		FROM (
			SELECT ${generation}, session_date, call_id,
				minIf(ts, ${call}) AS started_at,
				${first.map((name) => `argMinIf(${name}, position, ${call}) AS first_${name}`).join(",\n\t\t\t\t")},
				maxIf(ts, ${result} OR ${taskEnd}) AS result_at,
				countIf(${result}) AS results,
				max(${runToolErrorSql()} OR (${taskEnd} AND (is_error OR ifNull(exit_code, 0) != 0))) AS result_failed,
				anyIf(exit_code, (${result} OR ${taskEnd} OR (${mirror})) AND exit_code IS NOT NULL) AS result_exit_code,
				anyIf(denial_kind, ${result} AND denial_kind != '') AS result_denial_kind,
				argMinIf(facts['denial_reason'], position, ${result} AND facts['denial_reason'] != '') AS denial_reason,
				argMinIf(facts['error_from_call_id'], position, ${result} AND facts['error_from_call_id'] != '') AS error_from_call_id,
				argMinIf(head, position, ${toolErrorSql()} OR (${result} AND refused)) AS result_error_head,
				argMinIf(tail, position, ${toolErrorSql()} OR (${result} AND refused)) AS result_error_tail,
				argMinIf(head, position, ${result}) AS result_head,
				argMinIf(tail, position, ${result}) AS result_tail,
				arraySort(groupArrayIf((position, ${piece}), ${result})) AS outputs,
				sumIf(text_chars, ${result}) AS output_chars,
				maxIf(text_chars > lengthUTF8(${stored}), ${result}) AS output_cut,
				arraySort(groupArrayIf((position, file_path, replaceRegexpOne(toString(file_op), '^inferred_', ''),
					multiIf(subtype IN ('shell_script', 'shell_script_conditional'), 'script', startsWith(subtype, 'shell'), 'shell', 'tool')), ${change})) AS changes,
				max(${result} AND ifNull(interrupted, false)) AS result_interrupted,
				maxIf(timed_out_after_ms, ${result}) AS result_timed_out_after_ms,
				anyIf(file_path, (${handOff} OR ${notification}) AND file_path != '') AS task_file,
				argMaxIf((interrupted, is_error), position, ${taskEnd}) AS task_end
			FROM (
				SELECT ${generation}, session_date, call_id, kind, subtype, source, ts, turn_idx, record_idx, block_idx,
					is_error, exit_code, denial_kind, denial_kind != '' AS refused, head, tail, text, text_chars, facts,
					(record_idx, block_idx) AS position, tool_name, file_path, file_op, command_class,
					interrupted, timed_out_after_ms, facts['script_call_id'] AS parent,
					${commandColumnsSql()},
					if(command_from = '', NULL, ifNull(command_text, head)) AS command,
					lengthUTF8(command_text) AS command_chars,
					if(kind = 'tool_call' AND replaceRegexpOne(lower(tool_name), '^functions\\.', '') IN (${SHELL_TOOLS.map((tool) => `'${tool}'`).join(", ")}),
						substring(head, 1, 300), NULL) AS command_head
				FROM ${records()}
				PREWHERE kind IN ('tool_call', 'tool_result')
					OR (kind = 'injected_context' AND subtype = 'task_notification' AND call_id != '')
					OR (${mirror}) OR (${change})
				WHERE ${sessions} AND ${fresh}
			)
			GROUP BY ${generation}, session_date, call_id,
				if(call_id = '', position, (0, 0))
			HAVING countIf(${call}) > 0
		) AS c
		INNER JOIN (${measuredRuns}) AS r ON r.user_id = c.user_id AND r.session_id = c.session_id
			AND r.revision = c.revision AND r.parser_version = c.parser_version
			AND r.agent_id = c.agent_id AND r.turn_idx = c.first_turn_idx`;
}

export function sqlLiteral(text: string): string {
	return `'${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

export function regexLiteral(pattern: RegExp): string {
	const source = pattern.source.replace(/\\u([0-9a-fA-F]{4})/gu, "\\x{$1}");
	return sqlLiteral(pattern.flags.includes("i") ? `(?i)${source}` : source);
}

const STACK_FRAME = /^(?:at\s|node:internal|[\w.$]+\($|\^+$|\d+\s*\|)/;

export function errorLineSql(text: string): string {
	const lines = `arrayFilter(l -> l != '' AND NOT match(l, ${regexLiteral(PREAMBLE)}),
				arrayMap(l -> trimBoth(l), splitByRegexp(${sqlLiteral("\\r?\\n")},
					replaceRegexpAll(replaceRegexpAll(${text}, ${sqlLiteral("\\x1b\\[[0-?]*[ -/]*[@-~]")}, ''), ${sqlLiteral("</?tool_use_error>")}, char(10)))))`;
	const strong = `arrayFirst(l -> match(l, ${regexLiteral(STRONG)}) AND length(l) > 6 AND NOT match(l, ${regexLiteral(STACK_FRAME)}), ${lines})`;
	return `substring(if(${strong} != '', ${strong}, if(empty(${lines}), '(no output)', ${lines}[1])), 1, 300)`;
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
