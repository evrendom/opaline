import { RUN_INDEX_COLUMNS, type RunIndexColumn } from "./run-index.js";

/**
 * Finding impact (docs/retro-architecture.md, "Finding impact"): when an
 * analysis is saved, each finding's cited runs with the cost, tokens and
 * active time the run index recorded for them, so later analyses can sum
 * what retros found with SQL. Nothing is estimated: a run the committed run
 * index does not hold is left out, and a fact it holds as unknown stays
 * NULL. Without the schema toolkit, so the API imports it at runtime
 * (`@rudel/ch-schema/finding-runs`).
 *
 * Rows are written once per save; sharing or unsharing the analysis writes
 * them again with its new `visibility_revision` (from the analysis log, which
 * is authoritative), the table's version column, and readers read them with
 * FINAL: the highest revision wins whatever order the writes land in.
 * Account deletion deletes the rows of the account's runs, of its analyses
 * and of every analysis its deletion deletes (`quoted_owners`, ADR 0001 as
 * amended); workspace deletion deletes the workspace's rows.
 */

export const FINDING_RUNS_TABLE = "rudel.analysis_finding_runs";

export type FindingRunsColumn = RunIndexColumn;

/** Run index measures copied for each cited run, with their run index meaning. */
export const FINDING_RUNS_MEASURES = [
	"started_at",
	"minutes",
	"active_minutes",
	"cost_usd",
	"uncached_input_tokens",
	"cache_read_input_tokens",
	"cache_write_5m_input_tokens",
	"cache_write_1h_input_tokens",
	"output_tokens",
	"reasoning_output_tokens",
	"unrecorded_facts",
] as const;

const COPIED =
	"Copied from the run's committed run index build when the analysis was saved.";

function measure(
	name: (typeof FINDING_RUNS_MEASURES)[number],
): FindingRunsColumn {
	const column = RUN_INDEX_COLUMNS.find((candidate) => candidate.name === name);
	if (!column) throw new Error(`Run index has no column ${name}`);
	return { name, type: column.type, comment: `${column.comment} ${COPIED}` };
}

/** Every column of `rudel.analysis_finding_runs`, in table order. */
export const FINDING_RUNS_COLUMNS: readonly FindingRunsColumn[] = [
	{
		name: "organization_id",
		type: "String",
		comment: "Workspace of the analysis; tenant boundary.",
	},
	{ name: "analysis_id", type: "String", comment: "Saved analysis id." },
	{
		name: "step_id",
		type: "String",
		comment: "Step whose finding cites the run; one finding per step.",
	},
	{
		name: "finding",
		type: "String",
		comment: "The finding as the analysis saved it.",
	},
	{
		name: "author_id",
		type: "String",
		comment:
			"Author of the analysis; only they read its rows until it is shared.",
	},
	{
		name: "shared",
		type: "UInt8",
		comment:
			"1 while the analysis is shared with its workspace, else 0, as of visibility_revision.",
	},
	{
		name: "visibility_revision",
		type: "UInt64",
		comment:
			"Revision of the analysis's visibility these rows hold, from the analysis log; the highest wins under FINAL, so an older share or unshare written late never replaces a newer one.",
	},
	{
		name: "quoted_owners",
		type: "Array(String)",
		comment:
			"Members whose deletion deletes the analysis and these rows: every member a query of it read and quoted, and every member a finding's result names a session of.",
	},
	{
		name: "saved_at",
		type: "DateTime64(3, 'UTC')",
		comment: "UTC time the analysis was saved.",
	},
	{
		name: "user_id",
		type: "String",
		comment: "Member who owns the run's session.",
	},
	{ name: "session_id", type: "String", comment: "Session of the run." },
	{
		name: "agent_id",
		type: "String",
		comment: "Stream of the run; empty for the main transcript.",
	},
	{
		name: "turn_idx",
		type: "UInt32",
		comment: "Run number within the stream, as in runs.",
	},
	...FINDING_RUNS_MEASURES.map(measure),
];

export const FINDING_RUNS_ORDER_BY = [
	"organization_id",
	"analysis_id",
	"step_id",
	"user_id",
	"session_id",
	"agent_id",
	"turn_idx",
] as const;

export const FINDING_RUNS_COMMENT =
	"Each saved finding's cited runs with their recorded cost, tokens and active time; written when an analysis is saved or shared.";
