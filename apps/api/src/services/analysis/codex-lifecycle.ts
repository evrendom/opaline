import type { CodexLifecycleRow, CodexTurnMark } from "./run-index-sql.js";

/**
 * Codex turn lifecycle facts by run (docs/l1-literal-schema.md, "Parser v6
 * writes call facts…"). Codex writes `task_started` and `turn_context`
 * before the turn's prompt, so those rows carry the previous run's
 * `turn_idx`; each keeps the turn's `turn_id`, which the turn's
 * `task_complete` or `turn_aborted` also carries. A lifecycle row belongs to:
 *
 * 1. the run whose `task_complete` or `turn_aborted` has its `turn_id`: the
 *    turn's prompt precedes its completion, so the completion's run is the
 *    turn's run (a completion with a turn id is its own match);
 * 2. a completion without a turn id: the run it was written in, which its
 *    turn ended (Codex writes a turn's completion after its work); before
 *    the first prompt, no run;
 * 3. an opening row (`task_started`, `turn_context`) without a matching
 *    completion: the next run of the stream when no response record comes
 *    between the row and that run's prompt (its completion is not written
 *    yet, or the agent version records no turn id), else its own run when a
 *    response of that run follows it;
 * 4. else no run: the row's turn has not started a run, and its facts are
 *    not attributed.
 *
 * This never moves a record between runs: run starts, spans and counts stay
 * by `turn_idx`, so run ids stay the edges' ids.
 */

const COMPLETIONS: ReadonlySet<string> = new Set([
	"task_complete",
	"turn_aborted",
]);

/** The run facts Codex lifecycle rows give one run; '' and 0 mean none recorded. */
export interface CodexLifecycleFacts {
	approvalPolicy: string;
	approvalsReviewer: string;
	sandboxPolicy: string;
	sandboxNetworkAccess: string;
	permissionProfile: string;
	collaborationMode: string;
	model: string;
	models: string[];
	effort: string;
	/** Every effort of the run's rows, sorted; effort is the first. */
	efforts: string[];
	contextWindow: string;
	/** Sum of the run's task and abort durations; null when none records one. */
	durationMs: number | null;
	/** Of the run's first task_complete that records it. */
	timeToFirstTokenMs: string;
	turnError: string;
	turnErrorKind: string;
	/** Whether a row of the run records the turn error usage_limit_exceeded. */
	usageLimited: boolean;
	abortReason: string;
	abortedTrue: number;
	abortedFalse: number;
}

export const NO_CODEX_LIFECYCLE_FACTS: CodexLifecycleFacts = {
	approvalPolicy: "",
	approvalsReviewer: "",
	sandboxPolicy: "",
	sandboxNetworkAccess: "",
	permissionProfile: "",
	collaborationMode: "",
	model: "",
	models: [],
	effort: "",
	efforts: [],
	contextWindow: "",
	durationMs: null,
	timeToFirstTokenMs: "",
	turnError: "",
	turnErrorKind: "",
	usageLimited: false,
	abortReason: "",
	abortedTrue: 0,
	abortedFalse: 0,
};

export function streamTurnKey(agentId: string, turnIdx: number): string {
	return `${agentId}\u0000${turnIdx}`;
}

/** The run (`turn_idx`) a lifecycle row belongs to, or 0 for none. */
export function codexLifecycleRun(
	row: CodexLifecycleRow,
	completions: ReadonlyMap<string, number>,
	marks: ReadonlyMap<string, CodexTurnMark>,
): number {
	const completed =
		row.turn_id === ""
			? undefined
			: completions.get(`${row.agent_id}\u0000${row.turn_id}`);
	if (completed !== undefined) return completed;
	// Only an opening row precedes its turn's prompt; a completion never
	// belongs to a later run.
	if (COMPLETIONS.has(row.subtype)) return row.turn_idx;
	const own = marks.get(streamTurnKey(row.agent_id, row.turn_idx));
	const next = marks.get(streamTurnKey(row.agent_id, row.turn_idx + 1));
	const lastResponse = own?.last_response ?? 0;
	if (lastResponse < row.record_idx && next !== undefined)
		return row.turn_idx + 1;
	if (lastResponse > row.record_idx) return row.turn_idx;
	return 0;
}

/**
 * Lifecycle facts per run, keyed by `streamTurnKey`. `rows` are in record
 * order within each stream; each value is the first recorded in that order.
 */
export function codexLifecycleFactsByRun(
	rows: readonly CodexLifecycleRow[],
	marks: readonly CodexTurnMark[],
): Map<string, CodexLifecycleFacts> {
	const completions = new Map<string, number>();
	for (const row of rows) {
		if (!COMPLETIONS.has(row.subtype) || row.turn_id === "") continue;
		const key = `${row.agent_id}\u0000${row.turn_id}`;
		completions.set(
			key,
			Math.min(completions.get(key) ?? row.turn_idx, row.turn_idx),
		);
	}
	const marksByTurn = new Map(
		marks.map((mark) => [streamTurnKey(mark.agent_id, mark.turn_idx), mark]),
	);
	const ordered = [...rows].sort(
		(a, b) =>
			a.agent_id.localeCompare(b.agent_id) ||
			a.record_idx - b.record_idx ||
			a.block_idx - b.block_idx,
	);
	const byRun = new Map<string, CodexLifecycleFacts>();
	for (const row of ordered) {
		const run = codexLifecycleRun(row, completions, marksByTurn);
		if (run < 1) continue;
		const key = streamTurnKey(row.agent_id, run);
		const facts = byRun.get(key) ?? {
			...NO_CODEX_LIFECYCLE_FACTS,
			models: [],
			efforts: [],
		};
		facts.approvalPolicy ||= row.approval_policy;
		facts.approvalsReviewer ||= row.approvals_reviewer;
		facts.sandboxPolicy ||= row.sandbox_policy;
		facts.sandboxNetworkAccess ||= row.sandbox_network_access;
		facts.permissionProfile ||= row.permission_profile;
		facts.collaborationMode ||= row.collaboration_mode;
		facts.model ||= row.model;
		if (row.model !== "" && !facts.models.includes(row.model))
			facts.models = [...facts.models, row.model].sort();
		facts.effort ||= row.effort;
		if (row.effort !== "" && !facts.efforts.includes(row.effort))
			facts.efforts = [...facts.efforts, row.effort].sort();
		facts.contextWindow ||= row.context_window;
		facts.turnError ||= row.turn_error;
		facts.turnErrorKind ||= row.turn_error_kind;
		if (row.turn_error_kind === "usage_limit_exceeded")
			facts.usageLimited = true;
		facts.abortReason ||= row.abort_reason;
		if (row.subtype === "task_complete")
			facts.timeToFirstTokenMs ||= row.time_to_first_token_ms;
		if (COMPLETIONS.has(row.subtype) && row.task_duration_ms !== null)
			facts.durationMs = (facts.durationMs ?? 0) + row.task_duration_ms;
		if (row.aborted === "true") facts.abortedTrue++;
		if (row.aborted === "false") facts.abortedFalse++;
		byRun.set(key, facts);
	}
	return byRun;
}
