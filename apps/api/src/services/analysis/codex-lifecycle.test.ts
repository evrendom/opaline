import { describe, expect, test } from "bun:test";
import {
	splitSessionTranscript,
	type TranscriptRecordDraft,
} from "@rudel/api-routes/transcript-records";
import {
	codexLifecycleFactsByRun,
	NO_CODEX_LIFECYCLE_FACTS,
	streamTurnKey,
} from "./codex-lifecycle.js";
import type { CodexLifecycleRow, CodexTurnMark } from "./run-index-sql.js";

const LIFECYCLE = new Set([
	"turn_context",
	"task_started",
	"task_complete",
	"turn_aborted",
]);
const RESPONSES = new Set([
	"assistant_text",
	"reasoning",
	"tool_call",
	"tool_result",
	"file_change",
]);

let second = 0;
const line = (type: string, payload: Record<string, unknown>) =>
	JSON.stringify({
		timestamp: new Date(Date.UTC(2026, 9, 1, 10, 0, second++)).toISOString(),
		type,
		payload,
	});
const event = (payload: Record<string, unknown>) => line("event_msg", payload);
const prompt = (text: string) =>
	line("response_item", {
		type: "message",
		role: "user",
		content: [{ type: "input_text", text }],
	});
const answer = (text: string) =>
	line("response_item", {
		type: "message",
		role: "assistant",
		content: [{ type: "output_text", text }],
	});

/**
 * Codex lines in the order Codex writes them: a turn's task_started and
 * turn_context come before its prompt, its task_complete or turn_aborted
 * after its work.
 */
const TRANSCRIPT = [
	line("session_meta", {
		id: "lifecycle",
		cli_version: "0.156.0",
		originator: "codex_exec",
		thread_source: "user",
	}),
	/* 2 */ event({
		type: "task_started",
		turn_id: "t1",
		model_context_window: 258400,
	}),
	/* 3 */ line("turn_context", {
		turn_id: "t1",
		approval_policy: "on-request",
		sandbox_policy: { type: "workspace-write", network_access: false },
		model: "gpt-a",
		effort: "high",
	}),
	/* 4 */ prompt("check the build"),
	/* 5 */ line("response_item", {
		type: "function_call",
		name: "exec_command",
		arguments: '{"cmd": "bun run build"}',
		call_id: "c1",
	}),
	/* 6 */ line("response_item", {
		type: "function_call_output",
		call_id: "c1",
		output: "ok",
	}),
	/* 7 */ answer("built"),
	/* 8 */ event({
		type: "task_complete",
		turn_id: "t1",
		duration_ms: 1000,
		time_to_first_token_ms: 100,
	}),
	/* 9 */ event({ type: "task_started", turn_id: "t2" }),
	/* 10 */ line("turn_context", {
		turn_id: "t2",
		approval_policy: "never",
		model: "gpt-b",
	}),
	/* 11 */ prompt("now ship it"),
	/* 12 */ answer("shipping"),
	/* 13 */ event({
		type: "turn_aborted",
		turn_id: "t2",
		reason: "interrupted",
		duration_ms: 500,
	}),
	// An agent version that records no turn id: the next prompt follows
	// with no response between.
	/* 14 */ line("turn_context", { model: "gpt-c" }),
	/* 15 */ prompt("try again"),
	// A turn_context inside its run, before the run's response; its turn
	// never completes in this upload.
	/* 16 */ line("turn_context", { turn_id: "t3", effort: "low" }),
	/* 17 */ answer("trying"),
	// The next turn started but its prompt is not in the upload yet.
	/* 18 */ event({ type: "task_started", turn_id: "t4" }),
	/* 19 */ line("turn_context", { turn_id: "t4", model: "gpt-d" }),
].join("\n");

/** The rows and marks the run index statements return, from parser drafts. */
function lifecycleInputs(drafts: readonly TranscriptRecordDraft[]): {
	rows: CodexLifecycleRow[];
	marks: CodexTurnMark[];
} {
	const fact = (draft: TranscriptRecordDraft, key: string) =>
		(draft.facts.extra as Record<string, string | undefined>)[key] ?? "";
	const rows = drafts
		.filter((draft) => draft.kind === "meta" && LIFECYCLE.has(draft.subtype))
		.map((draft) => ({
			agent_id: draft.agentId,
			record_idx: draft.recordIdx,
			block_idx: draft.blockIdx,
			turn_idx: draft.turnIdx,
			subtype: draft.subtype,
			turn_id: fact(draft, "turn_id"),
			task_duration_ms: draft.facts.durationMs,
			approval_policy: fact(draft, "approval_policy"),
			approvals_reviewer: fact(draft, "approvals_reviewer"),
			sandbox_policy: fact(draft, "sandbox_policy"),
			sandbox_network_access: fact(draft, "sandbox_network_access"),
			permission_profile: fact(draft, "permission_profile"),
			collaboration_mode: fact(draft, "collaboration_mode"),
			model: fact(draft, "model"),
			effort: fact(draft, "effort"),
			context_window: fact(draft, "context_window"),
			time_to_first_token_ms: fact(draft, "time_to_first_token_ms"),
			turn_error: fact(draft, "turn_error"),
			turn_error_kind: fact(draft, "turn_error_kind"),
			aborted: fact(draft, "aborted"),
			abort_reason: fact(draft, "abort_reason"),
		}));
	const marks = new Map<string, CodexTurnMark>();
	for (const draft of drafts) {
		const key = streamTurnKey(draft.agentId, draft.turnIdx);
		const mark = marks.get(key) ?? {
			agent_id: draft.agentId,
			turn_idx: draft.turnIdx,
			turn_start: draft.recordIdx,
			last_response: 0,
		};
		mark.turn_start = Math.min(mark.turn_start, draft.recordIdx);
		if (RESPONSES.has(draft.kind))
			mark.last_response = Math.max(mark.last_response, draft.recordIdx);
		marks.set(key, mark);
	}
	return { rows, marks: [...marks.values()] };
}

describe("Codex lifecycle attribution", () => {
	const drafts = [
		...splitSessionTranscript({
			content: TRANSCRIPT,
			sessionDate: "2026-10-01T10:00:00.000Z",
			source: "codex",
		}),
	];
	const { rows, marks } = lifecycleInputs(drafts);
	const byRun = codexLifecycleFactsByRun(rows, marks);
	const run = (turn: number) => byRun.get(streamTurnKey("", turn));

	test("the parser writes a turn's opening rows with the previous run's turn_idx", () => {
		expect(
			rows.map((row) => [row.record_idx, row.subtype, row.turn_idx]),
		).toEqual([
			[2, "task_started", 0],
			[3, "turn_context", 0],
			[8, "task_complete", 1],
			[9, "task_started", 1],
			[10, "turn_context", 1],
			[13, "turn_aborted", 2],
			[14, "turn_context", 2],
			[16, "turn_context", 3],
			[18, "task_started", 3],
			[19, "turn_context", 3],
		]);
	});

	test("a turn's rows join the run whose completion has their turn_id", () => {
		expect(run(1)).toEqual({
			...NO_CODEX_LIFECYCLE_FACTS,
			approvalPolicy: "on-request",
			sandboxPolicy: "workspace-write",
			sandboxNetworkAccess: "false",
			model: "gpt-a",
			models: ["gpt-a"],
			effort: "high",
			contextWindow: "258400",
			durationMs: 1000,
			timeToFirstTokenMs: "100",
		});
		expect(run(2)).toEqual({
			...NO_CODEX_LIFECYCLE_FACTS,
			approvalPolicy: "never",
			model: "gpt-b",
			models: ["gpt-b"],
			durationMs: 500,
			abortReason: "interrupted",
			abortedTrue: 1,
		});
	});

	test("without a completion, a row joins the next prompt with nothing between, else the run it opens", () => {
		expect(run(3)).toEqual({
			...NO_CODEX_LIFECYCLE_FACTS,
			model: "gpt-c",
			models: ["gpt-c"],
			effort: "low",
		});
	});

	test("a turn that has not reached its prompt gives no run its facts", () => {
		expect([...byRun.keys()].sort()).toEqual(
			[1, 2, 3].map((turn) => streamTurnKey("", turn)),
		);
		expect(
			[...byRun.values()].some((facts) => facts.models.includes("gpt-d")),
		).toBe(false);
	});
});

describe("a completion without a turn id", () => {
	const row = (
		subtype: string,
		recordIdx: number,
		turnIdx: number,
	): CodexLifecycleRow => ({
		agent_id: "",
		record_idx: recordIdx,
		block_idx: 0,
		turn_idx: turnIdx,
		subtype,
		turn_id: "",
		task_duration_ms: 300,
		approval_policy: "",
		approvals_reviewer: "",
		sandbox_policy: "",
		sandbox_network_access: "",
		permission_profile: "",
		collaboration_mode: "",
		model: "",
		effort: "",
		context_window: "",
		time_to_first_token_ms: "",
		turn_error: "",
		turn_error_kind: "",
		aborted: subtype === "turn_aborted" ? "true" : "",
		abort_reason: subtype === "turn_aborted" ? "interrupted" : "",
	});
	const mark = (turn: number, start: number, lastResponse: number) => ({
		agent_id: "",
		turn_idx: turn,
		turn_start: start,
		last_response: lastResponse,
	});
	// Turn 1: prompt at 4, last response at 7; turn 2's prompt at 11.
	const twoRuns = [mark(0, 1, 0), mark(1, 4, 7), mark(2, 11, 12)];
	const oneRun = [mark(0, 1, 0), mark(1, 4, 7)];

	for (const subtype of ["task_complete", "turn_aborted"]) {
		test(`${subtype} stays with the run it ended, never the next prompt's`, () => {
			const byRun = codexLifecycleFactsByRun([row(subtype, 8, 1)], twoRuns);
			expect([...byRun.keys()]).toEqual([streamTurnKey("", 1)]);
			expect(byRun.get(streamTurnKey("", 1))?.durationMs).toBe(300);
		});

		test(`${subtype} at the end of the upload stays with its run`, () => {
			const byRun = codexLifecycleFactsByRun([row(subtype, 8, 1)], oneRun);
			expect([...byRun.keys()]).toEqual([streamTurnKey("", 1)]);
		});
	}

	test("a completion before the first prompt belongs to no run", () => {
		expect(
			codexLifecycleFactsByRun([row("task_complete", 2, 0)], twoRuns).size,
		).toBe(0);
	});
});
