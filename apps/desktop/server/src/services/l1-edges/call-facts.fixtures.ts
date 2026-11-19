import { CALL_FIELDS, type CallFields, type CallTuple } from "./call-facts.js";

const DEFAULTS: CallFields = {
	agent_id: "",
	call_id: "c",
	turn_idx: 1,
	started_ms: Date.parse("2026-10-08T11:00:00.000Z"),
	finished_ms: Date.parse("2026-10-08T11:00:30.000Z"),
	call_level: "top",
	parent_call_id: "",
	tool_name: "Bash",
	call_minutes: 0.5,
	has_result: 1,
	failed: 0,
	error_from_call_id: "",
	exit_code: 0,
	denial_kind: "",
	denial_reason: "",
	result_interrupted: 0,
	result_timed_out_after_ms: null,
	backgrounded: 0,
	task_id: null,
	background_status: null,
	background_exit_code: null,
	file_path: "",
	file_op: "",
	command_class: "other",
	command_classes: ["other"],
	command_from: "command",
	command_head: "ls",
	record_idx: 1,
	block_idx: 0,
	changed_files: [],
	changed_file_ops: [],
	changed_files_basis: [],
	files_read: [],
	edit_route: "",
	error: null,
	output_chars: "0",
	output_cut: 0,
	command_rows: [[[1, 0], "command", "ls", ""]],
	cwd: "/w/app",
};

export function callTuple(fields: Partial<CallFields>): CallTuple {
	const call = { ...DEFAULTS, ...fields };
	return CALL_FIELDS.map(([name]) => call[name]) as unknown as CallTuple;
}
