import type { ReceivedSetupKind } from "@rudel/api-routes/transcript-records";
import type {
	RudelCallFactsRow,
	RudelRunIndexRow,
	RudelRunRequestsRow,
} from "@rudel/ch-schema/generated";
import { z } from "zod";
import { commandIdentityOf } from "../analysis/call-identity.js";
import { setupFileIdentity } from "../analysis/received-setup.js";
import { unrecordedRunIndexColumns } from "../analysis/run-index-columns.js";
import {
	FORK_REPLAY_FILTER,
	forkReplayCtes,
} from "../analysis/run-index-sql.js";
import { pinnedFilter } from "../analysis/sql.js";
import { callRowsSql } from "../analysis/sql-call-rows.js";
import type { SessionIdentity } from "./l1-edge-ids.js";

const TIMEOUT_LIMIT_SINCE_PARSER_VERSION = 12;

export const CALL_FIELDS = [
	["agent_id", "agent_id"],
	["call_id", "call_id"],
	["turn_idx", "turn_idx"],
	["started_ms", "toUnixTimestamp64Milli(started_at)"],
	["finished_ms", "toUnixTimestamp64Milli(finished_at)"],
	["call_level", "toString(call_level)"],
	["parent_call_id", "parent_call_id"],
	["tool_name", "toString(tool_name)"],
	["call_minutes", "call_minutes"],
	["has_result", "has_result"],
	["failed", "failed"],
	["error_from_call_id", "error_from_call_id"],
	["exit_code", "exit_code"],
	["denial_kind", "toString(denial_kind)"],
	["denial_reason", "denial_reason"],
	["result_interrupted", "result_interrupted"],
	["result_timed_out_after_ms", "result_timed_out_after_ms"],
	["backgrounded", "backgrounded"],
	["task_id", "task_id"],
	["background_status", "background_status"],
	["background_exit_code", "background_exit_code"],
	["file_path", "file_path"],
	["file_op", "toString(file_op)"],
	["command_class", "toString(command_class)"],
	["command_classes", "command_classes"],
	["command_from", "command_from"],
	["command_head", "command_head"],
	["record_idx", "record_idx"],
	["block_idx", "block_idx"],
	["changed_files", "changed_files"],
	["changed_file_ops", "changed_file_ops"],
	["changed_files_basis", "changed_files_basis"],
	["files_read", "files_read"],
	["edit_route", "toString(edit_route)"],
	["error", "error"],
	["output_chars", "toString(output_chars)"],
	["output_cut", "output_cut"],
	["command_rows", "command_rows"],
	["cwd", "cwd"],
] as const;

const count = z.coerce.number();
const strings = z.array(z.string());
const CallTupleSchema = z.tuple([
	z.string(),
	z.string(),
	count,
	count,
	count.nullable(),
	z.string(),
	z.string(),
	z.string(),
	z.number().nullable(),
	count,
	count,
	z.string(),
	z.number().nullable(),
	z.string(),
	z.string(),
	count,
	count.nullable(),
	count,
	z.string().nullable(),
	z.string().nullable(),
	z.number().nullable(),
	z.string(),
	z.string(),
	z.string(),
	strings,
	z.string(),
	z.string().nullable(),
	count,
	count,
	strings,
	strings,
	strings,
	strings,
	z.string(),
	z.string().nullable(),
	z.string(),
	count,
	z.array(
		z.tuple([z.unknown(), z.string(), z.string().nullable(), z.string()]),
	),
	z.string(),
]);

export const CallTuplesSchema = z.array(CallTupleSchema);
export type CallTuple = z.infer<typeof CallTupleSchema>;

export function callFactsCtes(): string {
	return forkReplayCtes();
}

export function callTuplesSql(): string {
	return `SELECT groupArray(tuple(${CALL_FIELDS.map(([, expression]) => expression).join(", ")})) AS calls
		FROM (${callRowsSql({
			sessions: pinnedFilter(),
			fresh: FORK_REPLAY_FILTER,
			identity: false,
			programs: false,
			output: false,
			commandRows: true,
		})})`;
}

const INSTRUCTION_FILE =
	/(?:^|\/)(?:(?<claude>CLAUDE(?:\.local)?\.md)|(?<agents>AGENTS(?:\.override)?\.md)|(?<skill>SKILL\.md)|(?<rules>\.claude\/rules\/[^/]+\.md))$/u;

export function setupKindOfPath(path: string): ReceivedSetupKind | null {
	const match = INSTRUCTION_FILE.exec(path)?.groups;
	if (!match) return null;
	if (match.agents) return "agents_md";
	if (match.skill) return "skill_body";
	return "instructions";
}

export interface CallFactsContext {
	readonly organizationId: string;
	readonly session: SessionIdentity;
	readonly revision: string;
	readonly parserVersion: number;
	readonly indexVersion: number;
	readonly buildRevision: number;
	readonly builtAt: string;
	readonly sessionDate: string;
	readonly repository: string;
	readonly setupRepository: string | null;
	readonly threadSource: string;
}

export function streamKind(
	agentId: string,
	source: string,
	threadSource: string,
): string {
	if (agentId !== "") return source === "codex" ? "codex_thread" : "subagent";
	return threadSource === "subagent" ? "codex_thread" : "main";
}

const codePoints = (text: string) => {
	let length = 0;
	for (const _ of text) length++;
	return length;
};

function firstOf<T>(values: readonly (T | null)[]): T | null {
	for (const value of values) if (value !== null) return value;
	return null;
}

export type CallRequest = Pick<
	RudelRunRequestsRow,
	"agent_id" | "start_record" | "end_record" | "usage_model"
>;

const HARNESS_MODEL = "<synthetic>";

function knownModel(model: string | null | undefined): string | null {
	return model && model !== HARNESS_MODEL ? model : null;
}

function requestFinder(requests: readonly CallRequest[]) {
	const byStream = new Map<string, CallRequest[]>();
	for (const request of requests) {
		const stream = byStream.get(request.agent_id) ?? [];
		stream.push(request);
		byStream.set(request.agent_id, stream);
	}
	for (const stream of byStream.values())
		stream.sort((a, b) => a.start_record - b.start_record);
	return (agentId: string, recordIdx: number): CallRequest | undefined => {
		const stream = byStream.get(agentId);
		if (!stream) return undefined;
		let low = 0;
		let high = stream.length - 1;
		let found: CallRequest | undefined;
		while (low <= high) {
			const middle = (low + high) >> 1;
			const request = stream[middle] as CallRequest;
			if (request.start_record <= recordIdx) {
				found = request;
				low = middle + 1;
			} else high = middle - 1;
		}
		return found && recordIdx < found.end_record ? found : undefined;
	};
}

export function callFactRows(
	calls: readonly CallTuple[],
	runs: readonly RudelRunIndexRow[],
	requests: readonly CallRequest[],
	context: CallFactsContext,
): RudelCallFactsRow[] {
	const byTurn = new Map(
		runs.map((run) => [`${run.agent_id}\u0000${run.turn_idx}`, run]),
	);
	const requestOf = requestFinder(requests);
	return calls.map((call) => {
		const named = Object.fromEntries(
			CALL_FIELDS.map(([name], index) => [name, call[index]]),
		) as unknown as CallFields;
		const run = byTurn.get(`${named.agent_id}\u0000${named.turn_idx}`);
		const unrecorded: readonly string[] = run
			? run.unrecorded_facts
			: unrecordedRunIndexColumns(
					"run",
					context.parserVersion,
					context.session.source,
					named.agent_id,
				);
		const timeoutUnknown =
			unrecorded.includes("timed_out_calls") ||
			(context.session.source === "claude_code" &&
				named.agent_id !== "" &&
				context.parserVersion < TIMEOUT_LIMIT_SINCE_PARSER_VERSION);
		const rows = named.command_rows.map(([, from, text, head]) => ({
			from,
			text,
			head,
			identity: commandIdentityOf(from, text),
		}));
		const pick = <T>(value: (row: (typeof rows)[number]) => T | null) =>
			firstOf(rows.map(value));
		const programs = rows[0]?.identity.programs ?? [];
		const prefixes = rows[0]?.identity.prefixes ?? [];
		const setupReads = new Map<string, string>();
		for (const path of named.files_read) {
			const kind = setupKindOfPath(path);
			if (kind === null) continue;
			const file = setupFileIdentity(
				{ kind, path, name: "", cwd: named.cwd },
				{
					source: context.session.source,
					repository: context.setupRepository,
					memberId: context.session.userId,
				},
			).setupFile;
			if (!setupReads.has(file)) setupReads.set(file, path);
		}
		return {
			organization_id: context.organizationId,
			user_id: context.session.userId,
			session_id: context.session.sessionId,
			revision: context.revision,
			parser_version: context.parserVersion,
			index_version: context.indexVersion,
			build_revision: String(context.buildRevision),
			agent_id: named.agent_id,
			record_idx: named.record_idx,
			block_idx: named.block_idx,
			source: context.session.source,
			stream_kind: streamKind(
				named.agent_id,
				context.session.source,
				context.threadSource,
			),
			call_id: named.call_id,
			run_id: run?.run_id ?? "",
			turn_idx: named.turn_idx,
			repository: context.repository,
			model:
				knownModel(requestOf(named.agent_id, named.record_idx)?.usage_model) ??
				knownModel(run?.model),
			run_started_at: run ? run.started_at : null,
			session_date: context.sessionDate,
			built_at: context.builtAt,
			call_level: named.call_level,
			parent_call_id: named.parent_call_id,
			tool_name: named.tool_name,
			started_at: clickHouseTime(named.started_ms),
			finished_at:
				named.finished_ms === null ? null : clickHouseTime(named.finished_ms),
			call_minutes: named.call_minutes,
			has_result: named.has_result,
			failed: named.failed,
			error_from_call_id: named.error_from_call_id,
			exit_code: named.exit_code,
			denial_kind: named.denial_kind,
			denial_reason: named.denial_reason,
			interrupted: unrecorded.includes("interrupted_calls")
				? null
				: named.result_interrupted,
			timed_out: timeoutUnknown
				? null
				: named.result_timed_out_after_ms === null
					? 0
					: 1,
			timed_out_after_ms: timeoutUnknown
				? null
				: named.result_timed_out_after_ms,
			backgrounded: named.backgrounded,
			task_id: named.task_id,
			background_status: named.background_status,
			background_exit_code: named.background_exit_code,
			file_path: named.file_path,
			file_op: named.file_op,
			command_class: named.command_class,
			command_classes: named.command_classes,
			command_from: named.command_from,
			command: pick((row) => (row.from === "" ? null : (row.text ?? row.head))),
			command_chars: pick((row) =>
				row.text === null ? null : String(codePoints(row.text)),
			),
			command_argv0: pick((row) => row.identity.argv0),
			command_prefix: pick((row) => row.identity.prefix),
			command_programs: [...programs],
			command_prefixes: [...prefixes],
			command_fingerprint: pick((row) => row.identity.fingerprint),
			command_simhash: pick((row) =>
				row.identity.simhash === null ? null : String(row.identity.simhash),
			),
			command_head: named.command_head,
			changed_files: named.changed_files,
			changed_file_ops: named.changed_file_ops,
			changed_files_basis: named.changed_files_basis,
			files_read: named.files_read,
			setup_files_read: [...setupReads.keys()],
			setup_paths_read: [...setupReads.values()],
			edit_route: named.edit_route,
			error: named.error,
			output_chars: named.output_chars,
			output_cut: named.output_cut,
		};
	});
}

export interface CallFields {
	agent_id: string;
	call_id: string;
	turn_idx: number;
	started_ms: number;
	finished_ms: number | null;
	call_level: string;
	parent_call_id: string;
	tool_name: string;
	call_minutes: number | null;
	has_result: number;
	failed: number;
	error_from_call_id: string;
	exit_code: number | null;
	denial_kind: string;
	denial_reason: string;
	result_interrupted: number;
	result_timed_out_after_ms: number | null;
	backgrounded: number;
	task_id: string | null;
	background_status: string | null;
	background_exit_code: number | null;
	file_path: string;
	file_op: string;
	command_class: string;
	command_classes: string[];
	command_from: string;
	command_head: string | null;
	record_idx: number;
	block_idx: number;
	changed_files: string[];
	changed_file_ops: string[];
	changed_files_basis: string[];
	files_read: string[];
	edit_route: string;
	error: string | null;
	output_chars: string;
	output_cut: number;
	command_rows: [unknown, string, string | null, string][];
	cwd: string;
}

function clickHouseTime(ms: number): string {
	return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}
