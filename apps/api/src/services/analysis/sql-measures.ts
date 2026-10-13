import { getSafeClickHouseTable } from "../../clickhouse.js";
import { L1_EDGES_TABLE } from "../l1-edges/l1-edge-tables.js";
import { commandColumnsSql } from "./command-identity.js";
import {
	SETUP_SINCE_INDEX_VERSION,
	SETUP_SINCE_PARSER_VERSION,
} from "./received-setup.js";
import { forkReplayCtes } from "./run-index-sql.js";
import { records, toolErrorSql } from "./sql.js";
import type { SqlWindow } from "./sql-guard.js";
import type { SqlViewColumn } from "./sql-views.js";

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
 * Evidence no view can link yet: setup snapshots and embeddings are not in
 * L1. Their slices replace these with a real check.
 */
const NOT_IN_L1 = ["setup_snapshot", "embedding"] as const;

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
		definition: `Runs the member had to ask again for (interim definition): ${SAID_DONE_RULE} (said_done), and the next prompt in the same stream is one the word list marks negative or swearing (frustrated). Per week: GROUP BY toMonday(started_at). NULL runs are unknown (built before run index ${MESSAGES_SINCE}, or the stored final message was cut before it said done): report countIf(reasked IS NULL). ${RATES}`,
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

const UNKNOWN_EVIDENCE = `Evidence unknown for this row, never none: system_prompt (no system prompt recorded in the stream at or before the run, or the run was built before run index ${MESSAGES_SINCE}), received_setup (the setup the run received was not read: its session was built before run index ${SETUP_SINCE_INDEX_VERSION} or parsed before parser ${SETUP_SINCE_PARSER_VERSION}; setup_files has no rows for it), setup_snapshot (not in L1 yet), github_link (no stored L1 edge links the run to a commit, pull request or CI run, so its GitHub outcome is unknown) and embedding (not embedded yet). Say unknown for these, never zero.`;

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
		meaning: `Interim rule: true when ${SAID_DONE_RULE}. False when the run ended on a tool call.`,
		traps: [
			`NULL (unknown) for runs built before run index ${MESSAGES_SINCE}, and when the stored message was cut (final_message_cut) before any such word: the rest may say it. Words only: "Done?" counts, "all tests pass" does not.`,
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
			"Minutes from the call record to its last result record: the call's own time.",
		traps: [
			"NULL when no result was recorded (interrupted, or the session ended). Parallel calls overlap, so their sum can exceed the run's time; waiting for a person (AskUserQuestion) counts.",
		],
	},
	{
		name: "has_result",
		type: "UInt8",
		meaning: "1 when the call has a result in the transcript.",
		traps: [
			"A call without a result (interrupted, or the session ended) is neither failed nor succeeded.",
		],
	},
	{
		name: "failed",
		type: "UInt8",
		meaning: "1 when a result of the call is an error or exits non-zero.",
		traps: [
			"Compare failure rates over has_result = 1: a call without a result has failed = 0.",
		],
	},
	{
		name: "exit_code",
		type: "Nullable(Int32)",
		meaning: "Exit code a result recorded; NULL when none was recorded.",
		traps: [],
	},
	{
		name: "file_path",
		type: "String",
		meaning: "File the call names (read, edit, write); empty otherwise.",
		traps: [],
	},
	{
		name: "command_from",
		type: "String",
		meaning:
			"What carries the call's command: command (a shell command, or one a Codex code-mode script ran) or script (a whole Codex code-mode script); empty when the call carries none.",
		traps: [
			"From parser 5 a command a Codex code-mode script ran is a call of its own (command) next to the script's call (script); filter command_from = 'command' to count commands once.",
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
	const known = (expression: string) =>
		`if(index_version < ${MESSAGES_SINCE}, NULL, CAST(${expression} AS Nullable(Bool)))`;
	return `SELECT ${columns.map((column) => `r.${column} AS ${column}`).join(", ")},
			r.tokens AS tokens, r.said_done AS said_done, r.frustrated AS frustrated,
			CAST(r.said_done AND r.frustrated AS Nullable(Bool)) AS reasked,
			arrayConcat(
				if(r.index_version >= ${MESSAGES_SINCE} AND r.system_prompt_recorded, [], ['system_prompt']),
				if(r.index_version >= ${SETUP_SINCE_INDEX_VERSION} AND r.parser_version >= ${SETUP_SINCE_PARSER_VERSION}, [], ['received_setup']),
				${sqlArray([NOT_IN_L1[0]])},
				if(r.run_id IN (
					SELECT from_id FROM ${getSafeClickHouseTable(L1_EDGES_TABLE)} FINAL
					WHERE ${runs.owner} AND from_kind = 'run' AND is_active = 1
						AND to_kind IN ('commit', 'pull_request', 'ci_run')
				), [], ['github_link']),
				${sqlArray([NOT_IN_L1[1]])}) AS coverage_gaps,
			r.revision AS revision, r.parser_version AS parser_version
		FROM (
			SELECT *,
				uncached_input_tokens + cache_read_input_tokens + cache_write_5m_input_tokens
					+ cache_write_1h_input_tokens + output_tokens AS tokens,
				${known(said)} AS said_done,
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
		"file_path",
		"command_from",
		"command",
		"command_chars",
		"command_argv0",
		"command_prefix",
		"command_fingerprint",
		"command_simhash",
		"record_idx",
		"block_idx",
	];
	const call = "kind = 'tool_call'";
	const result = "kind = 'tool_result'";
	return `WITH ${[...(windowed ? [windowed.with] : []), forkReplayCtes(sessions, runs.owner)].join(",\n\t\t")}
		SELECT r.run_id AS run_id, c.user_id AS user_id, c.session_id AS session_id,
			c.agent_id AS agent_id, c.first_turn_idx AS turn_idx, r.source AS source,
			c.session_date AS session_date, c.call_id AS call_id, toLowCardinality(c.first_tool_name) AS tool_name,
			c.started_at AS started_at,
			if(c.results = 0, NULL, greatest(0, dateDiff('millisecond', c.started_at, c.result_at)) / 60000) AS call_minutes,
			toUInt8(c.results > 0) AS has_result, toUInt8(ifNull(c.result_failed, 0)) AS failed, c.result_exit_code AS exit_code,
			${first
				.filter((name) => !["turn_idx", "tool_name"].includes(name))
				.map((name) => `c.first_${name} AS ${name}`)
				.join(", ")},
			r.coverage_gaps AS coverage_gaps
		FROM (
			SELECT ${generation}, session_date, call_id,
				minIf(ts, ${call}) AS started_at,
				${first.map((name) => `argMinIf(${name}, position, ${call}) AS first_${name}`).join(",\n\t\t\t\t")},
				maxIf(ts, ${result}) AS result_at,
				countIf(${result}) AS results,
				max(${toolErrorSql()}) AS result_failed,
				anyIf(exit_code, ${result} AND exit_code IS NOT NULL) AS result_exit_code
			FROM (
				SELECT ${generation}, session_date, call_id, kind, ts, turn_idx, record_idx, block_idx,
					is_error, exit_code, (record_idx, block_idx) AS position, tool_name, file_path,
					${commandColumnsSql()},
					if(command_from = '', NULL, ifNull(command_text, head)) AS command,
					lengthUTF8(command_text) AS command_chars
				FROM ${records()}
				PREWHERE kind IN ('tool_call', 'tool_result')
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
