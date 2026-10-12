import type {
	TRANSCRIPT_RECORD_FACT_KEYS,
	TranscriptRecordFacts,
	TranscriptSource,
} from "@rudel/api-routes/transcript-records";
import type { RudelRunIndexRow } from "@rudel/ch-schema/generated";

/**
 * Which run index fact columns a generation can hold (docs/l1-literal-schema.md,
 * rule 2: unknown is not false). A column is recordable when the generation's
 * transcript-records parser version stores every fact it is read from and the
 * agent writes them. Otherwise its value is unknown: a scalar is NULL and the
 * column is listed in the row's `unrecorded_facts` (arrays and maps cannot be
 * NULL, so the list is what tells their emptiness apart). A recordable column
 * with no value is '' (strings), empty (arrays) or NULL (numbers and flags,
 * which have no empty value); `unrecorded_facts` says which NULL is which.
 *
 * Columns not listed here (spans, call counts, edits, usage) come from record
 * kinds and usage events every generation has.
 */

type TypedFact = Exclude<keyof TranscriptRecordFacts, "extra">;
export type RunIndexFactSource =
	| TypedFact
	| keyof typeof TRANSCRIPT_RECORD_FACT_KEYS;

export interface RunIndexColumnGate {
	/** First parser version that stores everything the column is read from. */
	readonly since: number;
	/** A later first version for one agent, whose form of the fact a later parser learned. */
	readonly sinceBy?: Readonly<Partial<Record<TranscriptSource, number>>>;
	/** Agents whose transcripts record it. */
	readonly agents: readonly TranscriptSource[];
	/**
	 * Parser facts it is read from; empty for record kinds and text every
	 * parser version kept (a Skill call's input, a slash command's name).
	 */
	readonly facts: readonly RunIndexFactSource[];
	readonly factsBy?: Readonly<
		Partial<Record<TranscriptSource, readonly RunIndexFactSource[]>>
	>;
	/** Run rows, the receipt (session facts), or both (totals and merged sets). */
	readonly rows: "run" | "receipt" | "both";
	/**
	 * Agents that record it only in their main stream: Claude Code subagent
	 * transcripts keep no `toolUseResult`, so facts read from it are unknown
	 * on their runs.
	 */
	readonly mainStreamOnly?: readonly TranscriptSource[];
}

const CLAUDE: readonly TranscriptSource[] = ["claude_code"];
const CODEX: readonly TranscriptSource[] = ["codex"];
const BOTH: readonly TranscriptSource[] = ["claude_code", "codex"];
/** The parser version every generation in storage has; record kinds date from it. */
const ALWAYS = 1;

const gate = (
	since: number,
	agents: readonly TranscriptSource[],
	facts: readonly RunIndexFactSource[],
	rows: RunIndexColumnGate["rows"] = "run",
	sinceBy?: RunIndexColumnGate["sinceBy"],
	factsBy?: RunIndexColumnGate["factsBy"],
): RunIndexColumnGate => ({
	since,
	agents,
	facts,
	rows,
	...(sinceBy === undefined ? {} : { sinceBy }),
	...(factsBy === undefined ? {} : { factsBy }),
});

export const RUN_INDEX_NARROWED_COLUMNS = {
	duration_ms: {
		claude_code:
			"Claude durationMs/durationSeconds time individual tool results, not a turn. Session cost-state totalDuration is cumulative. Neither can be summed or copied as Codex task_complete/turn_aborted run duration.",
	},
	turn_origin: {
		codex:
			"Codex prompt_origin stores a communication author's identity, not the turnOrigin classification. Keep sender provenance in components; do not invent a classification.",
	},
	prompt_source: {
		codex:
			"Codex author identifies a sender, not Claude's promptSource classification. There is no equivalent source label to project.",
	},
	origin_kind: {
		codex:
			"Codex author is a sender path, not an origin.kind enum. Converting every author to 'agent' would fabricate an unrecorded kind.",
	},
	compact_pre_tokens: {
		codex:
			"Codex latest_token_usage_record is the latest request's usage snapshot, not context tokens immediately before compaction. Cumulative total_tokens/thread_token_usage and last-request input tokens are not this measurement.",
	},
	refusals: {
		codex:
			"Codex generic terminal errors include cyber_policy/misalignment_policy_violation; these report policy termination, not a recorded model refusal. Counting all errors or policy stops as model refusals changes the meaning.",
	},
} satisfies Partial<
	Record<keyof RudelRunIndexRow, Partial<Record<TranscriptSource, string>>>
>;

export const RUN_INDEX_FACT_COLUMNS = {
	failed_edits: gate(9, BOTH, []),
	refused_edits: gate(9, BOTH, []),
	agent_version: gate(6, BOTH, ["agentVersion"]),
	entrypoint: gate(6, BOTH, ["entrypoint"]),
	// The typed duration is older, but Codex task durations came with parser 7.
	duration_ms: gate(7, CODEX, ["durationMs"]),
	time_to_first_token_ms: gate(7, CODEX, ["time_to_first_token_ms"]),
	turn_origin: gate(8, CLAUDE, ["turn_origin"]),
	prompt_source: gate(8, CLAUDE, ["prompt_source"]),
	origin_kind: gate(8, CLAUDE, ["origin_kind"]),
	trigger_turn: gate(8, CODEX, ["trigger_turn"]),
	thread_source: gate(8, CODEX, ["thread_source"], "both"),
	permission_mode: gate(7, CLAUDE, ["permission_mode"]),
	permission_modes: gate(7, CLAUDE, ["permission_mode"]),
	auto_mode_bash_first: gate(7, CLAUDE, ["auto_mode_bash_first"]),
	auto_mode_bash_first_steer: gate(7, CLAUDE, ["auto_mode_bash_first_steer"]),
	auto_mode_bypass: gate(7, CLAUDE, ["auto_mode_bypass"]),
	auto_mode_steer_only: gate(7, CLAUDE, ["auto_mode_steer_only"]),
	auto_mode_consent_flow: gate(7, CLAUDE, ["auto_mode_consent_flow"]),
	approval_policy: gate(7, CODEX, ["approval_policy"]),
	approvals_reviewer: gate(7, CODEX, ["approvals_reviewer"]),
	sandbox_policy: gate(7, CODEX, ["sandbox_policy"]),
	sandbox_network_access: gate(7, CODEX, ["sandbox_network_access"]),
	permission_profile: gate(9, CODEX, ["permission_profile"]),
	collaboration_mode: gate(7, CODEX, ["collaboration_mode"]),
	model: gate(7, BOTH, ["model"]),
	models: gate(7, BOTH, ["model"], "both"),
	effort: gate(7, BOTH, ["effort"]),
	per_turn_effort: gate(7, BOTH, ["per_turn_effort"], "run", undefined, {
		codex: ["effort"],
	}),
	context_window: gate(7, CODEX, ["context_window"]),
	// Codex refusals and stopped calls are read from its output since parser 8.
	denied_calls: gate(9, BOTH, ["denialKind"], "both"),
	interrupted_calls: gate(6, BOTH, ["interrupted"], "run", { codex: 8 }),
	timed_out_calls: gate(6, CLAUDE, ["timedOutAfterMs"]),
	mcp_calls: gate(6, BOTH, ["mcpServer"], "run", { claude_code: 9 }),
	mcp_servers: gate(6, BOTH, ["mcpServer"], "run", { claude_code: 9 }),
	skills: gate(
		6,
		BOTH,
		["attributionSkill"],
		"both",
		{ codex: 9 },
		{
			codex: ["skill_components"],
		},
	),
	slash_commands: gate(ALWAYS, CLAUDE, [], "both"),
	subagent_types: gate(
		ALWAYS,
		BOTH,
		[],
		"both",
		{ codex: 9 },
		{
			codex: ["subagent_type_components"],
		},
	),
	compact_trigger: gate(7, CLAUDE, ["compact_trigger"]),
	compact_pre_tokens: gate(7, CLAUDE, ["compact_pre_tokens"]),
	aborted: gate(7, BOTH, ["aborted"]),
	abort_reason: gate(
		7,
		BOTH,
		["abort_reason"],
		"run",
		{ claude_code: 9 },
		{
			claude_code: ["abort_reason_components"],
		},
	),
	turn_error: gate(7, CODEX, ["turn_error"]),
	turn_error_kind: gate(7, CODEX, ["turn_error_kind"]),
	stop_reason: gate(7, CLAUDE, ["stop_reason"]),
	hook_stop_reason: gate(7, CLAUDE, ["hook_stop_reason"]),
	prevented_continuation: gate(7, CLAUDE, ["prevented_continuation"]),
	hook_count: gate(7, CLAUDE, ["hook_count"]),
	hook_errors: gate(7, CLAUDE, ["hook_errors"]),
	hook_runs: gate(7, CLAUDE, ["hook_runs"]),
	api_errors: gate(
		7,
		BOTH,
		["api_error", "api_error_status"],
		"both",
		{ codex: 9 },
		{
			codex: ["api_errors_components"],
		},
	),
	api_error: gate(
		7,
		BOTH,
		["api_error"],
		"run",
		{ codex: 9 },
		{
			codex: ["api_errors_components"],
		},
	),
	api_error_statuses: gate(
		7,
		BOTH,
		["api_error_status"],
		"run",
		{ codex: 9 },
		{
			codex: ["api_errors_components"],
		},
	),
	retry_attempts: gate(7, CLAUDE, ["retry_attempt"]),
	refusals: gate(7, CLAUDE, ["refusal_category"]),
	fallback_model: gate(7, CLAUDE, ["fallback_model"]),
	goal: gate(7, CODEX, ["goal"]),
	git_operations: gate(6, CLAUDE, ["gitOperation"]),
	pushed_branches: gate(6, CLAUDE, ["git.push.branch"]),
	commit_shas: gate(6, CLAUDE, ["git.commit.sha"]),
	pr_urls: gate(
		6,
		BOTH,
		["git.pr.url", "pr_url"],
		"run",
		{ codex: ALWAYS },
		{
			codex: [],
		},
	),
	facts_truncated: gate(6, BOTH, ["facts_truncated"], "both"),
	// Claude Code's own reading of a search's exit code is the only record of
	// a no-match search that printed something; Codex records exit codes and
	// output in every version.
	not_found: {
		...gate(
			6,
			BOTH,
			["return_code_interpretation"],
			"run",
			{ codex: ALWAYS },
			{ codex: [] },
		),
		mainStreamOnly: CLAUDE,
	},
	title: gate(8, CLAUDE, ["title"], "receipt"),
	cost_state: gate(8, CLAUDE, ["cost_usd"], "receipt"),
} as const satisfies Partial<
	Record<keyof RudelRunIndexRow, RunIndexColumnGate>
>;

export type RunIndexFactColumn = keyof typeof RUN_INDEX_FACT_COLUMNS;

/**
 * Whether a generation of `parserVersion` from `source` can record the
 * column, on the stream `agentId` (empty for the main stream).
 */
export function isRunIndexColumnRecordable(
	column: RunIndexFactColumn,
	parserVersion: number,
	source: string,
	agentId = "",
): boolean {
	const columnGate: RunIndexColumnGate = RUN_INDEX_FACT_COLUMNS[column];
	const agent = source as TranscriptSource;
	return (
		parserVersion >= (columnGate.sinceBy?.[agent] ?? columnGate.since) &&
		columnGate.agents.includes(agent) &&
		(agentId === "" || !columnGate.mainStreamOnly?.includes(agent))
	);
}

/** The fact columns of a row kind that a generation cannot record on a stream, sorted. */
export function unrecordedRunIndexColumns(
	rowKind: "run" | "receipt",
	parserVersion: number,
	source: string,
	agentId = "",
): RunIndexFactColumn[] {
	return (Object.keys(RUN_INDEX_FACT_COLUMNS) as RunIndexFactColumn[])
		.filter((column) => {
			const { rows } = RUN_INDEX_FACT_COLUMNS[column];
			return (
				(rows === "both" || rows === rowKind) &&
				!isRunIndexColumnRecordable(column, parserVersion, source, agentId)
			);
		})
		.sort();
}

/**
 * Usage columns. They are unknown, not zero, when the session's newest usage
 * extraction is incomplete or inconsistent: the row names them in
 * `unrecorded_facts`, and the nullable ones are NULL.
 */
export const RUN_INDEX_USAGE_COLUMNS = [
	"usage_observations",
	"usage_unpriced",
	"usage_model",
	"cost_usd",
	"model_costs",
	"uncached_input_tokens",
	"cache_read_input_tokens",
	"cache_write_5m_input_tokens",
	"cache_write_1h_input_tokens",
	"output_tokens",
	"reasoning_output_tokens",
	"context_input_tokens_at_start",
] as const satisfies readonly (keyof RudelRunIndexRow)[];

/**
 * The row with every column it cannot record set to unknown: scalars NULL,
 * arrays and maps empty, all of them named in `unrecorded_facts`. With
 * `usageUnknown`, the usage columns too.
 */
export function gateRunIndexRow(
	row: RudelRunIndexRow,
	options: { usageUnknown?: boolean } = {},
): RudelRunIndexRow {
	const unrecorded = unrecordedRunIndexColumns(
		row.row_kind === "receipt" ? "receipt" : "run",
		row.parser_version,
		row.source,
		row.agent_id,
	);
	const gated: Record<string, unknown> = { ...row };
	for (const column of unrecorded) {
		const value = gated[column];
		gated[column] = Array.isArray(value)
			? []
			: value !== null && typeof value === "object"
				? {}
				: null;
	}
	if (options.usageUnknown)
		Object.assign(gated, {
			usage_observations: 0,
			usage_unpriced: 0,
			usage_model: "",
			cost_usd: null,
			model_costs: [],
			uncached_input_tokens: null,
			cache_read_input_tokens: null,
			cache_write_5m_input_tokens: null,
			cache_write_1h_input_tokens: null,
			output_tokens: null,
			reasoning_output_tokens: null,
			context_input_tokens_at_start: null,
		} satisfies Pick<
			RudelRunIndexRow,
			(typeof RUN_INDEX_USAGE_COLUMNS)[number]
		>);
	return {
		...(gated as RudelRunIndexRow),
		unrecorded_facts: [
			...unrecorded,
			...(options.usageUnknown ? RUN_INDEX_USAGE_COLUMNS : []),
		].sort(),
	};
}
