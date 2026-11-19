import {
	commandColumnsSql,
	commandSourceSql,
	SHELL_TOOLS,
} from "./command-identity.js";
import {
	COMMAND_CLASSES_SQL,
	commandProgramColumnsSql,
	FILES_READ_SQL,
} from "./command-programs.js";
import { PREAMBLE, STRONG } from "./failure-classifier.js";
import { FIRST_CWD, HAS_FIRST_CWD } from "./run-directories.js";
import { runToolErrorSql } from "./run-index-sql.js";
import { records, toolErrorSql } from "./sql.js";
import { editRouteSql } from "./tool-groups.js";

export const BACKGROUND_SINCE_PARSER_VERSION = 11;

export const CALL_TASK_NOTIFICATION_SQL = "kind = 'injected_context'";
export const CALL_TASK_END_SQL = `${CALL_TASK_NOTIFICATION_SQL} AND interrupted IS NOT NULL`;
export const CALL_COMPLETION_SQL = `kind = 'meta' AND call_id != '' AND (subtype IN ('exec_command_end', 'patch_apply_end') OR startsWith(subtype, 'item_completed:'))`;
export const CALL_HAND_OFF_SQL = `kind = 'tool_result' AND parser_version >= ${BACKGROUND_SINCE_PARSER_VERSION} AND match(file_path, '/tasks/[A-Za-z0-9_-]+\\\\.output$')`;

const FILE_CHANGE_SQL = `kind = 'file_change' AND file_path != '' AND (file_op IN ('write', 'edit', 'delete')
					OR subtype IN ('shell_conditional', 'shell_script_conditional') AND file_op IN ('inferred_write', 'inferred_edit', 'inferred_delete'))`;

const CALL_RECORD_KINDS = `kind IN ('tool_call', 'tool_result')
					OR (kind = 'injected_context' AND subtype = 'task_notification' AND call_id != '')
					OR (${CALL_COMPLETION_SQL}) OR (${FILE_CHANGE_SQL})`;

const STORED_TEXT = "if(lengthUTF8(text) >= lengthUTF8(head), text, head)";

export const OUTPUT_PIECE_SQL = `if(text_chars > lengthUTF8(${STORED_TEXT}) + lengthUTF8(tail),
						concat(${STORED_TEXT}, '\\n[opaline: output cut, ', toString(lengthUTF8(${STORED_TEXT}) + lengthUTF8(tail)), ' of ', toString(text_chars), ' characters stored]\\n', tail),
						${STORED_TEXT})`;

export interface CallRowsOptions {
	readonly sessions: string;
	readonly fresh: string;
	readonly identity: boolean;
	readonly programs: boolean;
	readonly output: boolean;
	readonly commandRows: boolean;
}

export function callRowsSql(options: CallRowsOptions): string {
	const generation = "user_id, session_id, revision, parser_version, agent_id";
	const first = [
		"turn_idx",
		"tool_name",
		"subtype",
		"parent",
		"file_path",
		"file_op",
		"command_class",
		"command_classes",
		"command_from",
		...(options.commandRows ? [] : ["command", "command_chars"]),
		...(options.identity ? ["command_argv0", "command_prefix"] : []),
		...(options.programs ? ["command_programs", "command_prefixes"] : []),
		...(options.identity ? ["command_fingerprint", "command_simhash"] : []),
		"command_head",
		"record_idx",
		"block_idx",
		"files_read",
	];
	const shown = first.filter(
		(name) =>
			!["turn_idx", "tool_name", "subtype", "parent", "files_read"].includes(
				name,
			),
	);
	const call = "kind = 'tool_call'";
	const result = "kind = 'tool_result'";
	const mirror = CALL_COMPLETION_SQL;
	const change = FILE_CHANGE_SQL;
	const notification = CALL_TASK_NOTIFICATION_SQL;
	const taskEnd = CALL_TASK_END_SQL;
	const handOff = CALL_HAND_OFF_SQL;
	return `SELECT c.user_id AS user_id, c.session_id AS session_id, c.revision AS revision,
				c.parser_version AS parser_version, c.agent_id AS agent_id, toLowCardinality(c.call_source) AS source,
				c.first_turn_idx AS turn_idx, c.session_date AS session_date, c.call_id AS call_id,
				toLowCardinality(multiIf(c.call_source = 'codex' AND c.first_subtype IN ('nested', 'script'), 'inner',
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
				toUInt8(c.result_interrupted) AS result_interrupted,
				c.result_timed_out_after_ms AS result_timed_out_after_ms,
				toUInt8(c.task_file != '') AS backgrounded,
				nullIf(extract(c.task_file, '/tasks/([A-Za-z0-9_-]+)\\\\.output$'), '') AS task_id,
				if(c.task_end.1 IS NULL, NULL,
					multiIf(c.task_end.1 AND c.task_end.2, 'killed', c.task_end.1, 'stopped', c.task_end.2, 'failed', 'completed')) AS background_status,
				if(c.task_end.1 IS NULL, NULL, c.result_exit_code) AS background_exit_code,
				if(c.task_file != '' AND c.task_end.1 IS NULL OR c.results = 0, NULL, c.result_at) AS finished_at,
				${shown
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
				arrayMap(x -> x.4, c.changes) AS changed_files_basis, c.first_files_read AS files_read,
				toLowCardinality(${editRouteSql({ tool: "c.first_tool_name", from: "c.first_command_from", head: "c.first_command_head", files: "c.changes", basis: "arrayMap(x -> x.4, c.changes)" })}) AS edit_route,
				if(ifNull(c.result_failed, 0) OR c.result_denial_kind != '',
					multiIf(c.result_error_text, c.result_error_line, ifNull(d.done_line, '') != '', d.done_line,
						c.running_process != '' AND c.settled_results = 0 AND c.result_exit_code IS NOT NULL,
						concat('Process exited with code ', toString(c.result_exit_code), '; the output after it kept running is not recorded'),
						c.results > 0, c.result_first_line, ${errorLineSql("char(10)")}), NULL) AS error,
				${options.output ? "arrayStringConcat(arrayMap(x -> x.2, c.outputs), char(10)) AS output," : ""}
				${options.commandRows ? "c.command_rows AS command_rows, c.cwd AS cwd," : ""}
				c.output_chars AS output_chars, toUInt8(c.output_cut) AS output_cut
			FROM (
				SELECT ${generation}, any(source) AS call_source, session_date, call_id,
					minIf(ts, ${call}) AS started_at,
					${first.map((name) => `argMinIf(${name}, position, ${call}) AS first_${name}`).join(",\n\t\t\t\t")},
					${
						options.commandRows
							? `arraySort(x -> x.1, groupArrayIf((position, command_from, command_text, if(command_text IS NULL, head, '')), ${call})) AS command_rows,
					ifNull(argMinIf(${FIRST_CWD}, position, ${HAS_FIRST_CWD}), '') AS cwd,`
							: ""
					}
					maxIf(ts, ${result} OR ${taskEnd}) AS result_at,
					countIf(${result}) AS results,
					max(${runToolErrorSql()} OR (${taskEnd} AND (is_error OR ifNull(exit_code, 0) != 0))) AS result_failed,
					anyIf(exit_code, (${result} OR ${taskEnd} OR (${mirror})) AND exit_code IS NOT NULL) AS result_exit_code,
					anyIf(denial_kind, ${result} AND denial_kind != '') AS result_denial_kind,
					argMinIf(facts['denial_reason'], position, ${result} AND facts['denial_reason'] != '') AS denial_reason,
					argMinIf(facts['error_from_call_id'], position, ${result} AND facts['error_from_call_id'] != '') AS error_from_call_id,
					argMinIf(result_line, position, ${toolErrorSql()} OR (${result} AND refused)) AS result_error_line,
					argMinIf(head != '' OR tail != '', position, ${toolErrorSql()} OR (${result} AND refused)) AS result_error_text,
					argMinIf(result_line, position, ${result}) AS result_first_line,
					argMinIf(process, position, process != '') AS running_process,
					minIf(record_idx, process != '') AS running_record,
					countIf(${result} AND subtype != 'running') AS settled_results,
					${options.output ? `arraySort(groupArrayIf((position, ${OUTPUT_PIECE_SQL}), ${result})) AS outputs,` : ""}
					sumIf(text_chars, ${result}) AS output_chars,
					maxIf(text_chars > lengthUTF8(${STORED_TEXT}), ${result}) AS output_cut,
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
						if(${result}, ${errorLineSql("concat(head, char(10), tail)")}, '') AS result_line,
						if(${result} AND subtype = 'running', extract(head, ${sqlLiteral(`${RUNNING_PROCESS}([0-9]+)`)}), '') AS process,
						${options.identity ? commandColumnsSql() : commandSourceSql()},
						${options.programs ? `${commandProgramColumnsSql()},` : ""}
						${FILES_READ_SQL} AS files_read,
						${COMMAND_CLASSES_SQL} AS command_classes,
						if(command_from = '', NULL, ifNull(command_text, head)) AS command,
						lengthUTF8(command_text) AS command_chars,
						if(kind = 'tool_call' AND replaceRegexpOne(lower(tool_name), '^functions\\.', '') IN (${SHELL_TOOLS.map((tool) => `'${tool}'`).join(", ")}),
							substring(head, 1, 300), NULL) AS command_head
					FROM ${records()}
					PREWHERE ${CALL_RECORD_KINDS}
					WHERE ${options.sessions} AND ${options.fresh}
				)
				GROUP BY ${generation}, session_date, call_id,
					if(call_id = '', position, (0, 0))
				HAVING countIf(${call}) > 0
			) AS c
			ASOF LEFT JOIN (${processEndsSql(options.sessions)}) AS d ON d.user_id = c.user_id AND d.session_id = c.session_id
				AND d.revision = c.revision AND d.parser_version = c.parser_version AND d.agent_id = c.agent_id
				AND d.polled_process = c.running_process AND c.running_record <= d.done_record`;
}

export function callOutputsSql(sessions: string): string {
	const generation = "user_id, session_id, revision, parser_version, agent_id";
	return `SELECT ${generation}, call_id,
				arrayStringConcat(arrayMap(x -> x.2, arraySort(groupArray((position, piece)))), char(10)) AS output
			FROM (
				SELECT ${generation}, call_id, (record_idx, block_idx) AS position, ${OUTPUT_PIECE_SQL} AS piece
				FROM ${records()}
				PREWHERE kind = 'tool_result' AND call_id != ''
				WHERE ${sessions} AND facts['fork_replayed'] != 'true'
			)
			GROUP BY ${generation}, call_id`;
}

const RUNNING_PROCESS = "Process running with session ID ";

function processEndsSql(sessions: string): string {
	const call = "kind = 'tool_call'";
	const done = "kind = 'tool_result' AND exit_code IS NOT NULL";
	return `SELECT * FROM (
			SELECT user_id, session_id, revision, parser_version, agent_id,
				anyIf(extract(head, ${sqlLiteral('"session_id"[[:space:]]*:[[:space:]]*([0-9]+)')}), ${call}) AS polled_process,
				minIf(record_idx, ${done}) AS done_record,
				argMinIf(${errorLineSql("concat(head, char(10), tail)")}, (record_idx, block_idx), ${done}) AS done_line
			FROM ${records()}
			PREWHERE kind IN ('tool_call', 'tool_result') AND replaceRegexpOne(lower(tool_name), '^functions\\.', '') = 'write_stdin'
			WHERE ${sessions} AND source = 'codex'
			GROUP BY user_id, session_id, revision, parser_version, agent_id, call_id
			HAVING countIf(${done}) > 0
		) WHERE polled_process != ''`;
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
