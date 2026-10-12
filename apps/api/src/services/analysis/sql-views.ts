import {
	RUN_INDEX_COLUMNS,
	type RunIndexColumn,
} from "@rudel/ch-schema/run-index";
import { getSafeClickHouseTable } from "../../clickhouse.js";
import { RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";
import {
	RUN_INDEX_FACT_COLUMNS,
	RUN_INDEX_NARROWED_COLUMNS,
	RUN_INDEX_USAGE_COLUMNS,
	type RunIndexColumnGate,
} from "./run-index-columns.js";
import { committedBuildSql } from "./run-index-reader.js";

/**
 * The views an agent's SQL may read (docs/adr/0005-agents-query-l1-with-sql.md).
 * Each is a stable grain over L1 that hides the storage traps, defined here
 * once: `schema` describes it from the same columns the SQL reads, and the
 * gateway puts its statement in place of every reference to its name.
 *
 * A view reads only the caller's sessions: the workspace is the bound
 * parameter `SQL_SCOPE_PARAMS.workspace`; every member reads every member's
 * sessions (ADR 0004), and only where `session-visibility.ts` holds the
 * reader to their own sessions is the member bound too, as
 * `SQL_SCOPE_PARAMS.member`. The agent cannot write either: query parameters
 * are refused in its SQL.
 */

export const SQL_SCOPE_PARAMS = {
	workspace: "opaline_workspace",
	member: "opaline_member",
} as const;

export interface SqlViewColumn {
	readonly name: string;
	readonly type: string;
	readonly meaning: string;
	readonly traps: readonly string[];
}

export interface SqlView {
	readonly name: string;
	readonly grain: string;
	readonly traps: readonly string[];
	readonly columns: readonly SqlViewColumn[];
	/** The view's statement; `memberOnly` keeps the member's own sessions. */
	sql(memberOnly: boolean): string;
}

/**
 * Run index columns the runs view leaves out: the tenant column (the server
 * scopes it), the generation and build that pick the committed snapshot, the
 * row kind, record positions and the receipt's session facts.
 */
const STORAGE_COLUMNS = new Set([
	"organization_id",
	"revision",
	"parser_version",
	"index_version",
	"build_revision",
	"built_at",
	"row_kind",
	"start_record",
	"end_record",
]);
const RECEIPT_ONLY = "Receipt:";

/** Traps the column comments do not say; one line each, only where needed. */
const COLUMN_TRAPS: Readonly<Record<string, string>> = {
	user_id:
		"The member who uploaded the session. For spotting a team-wide problem or one person's setup, never for ranking people.",
	agent_id:
		"Empty for the main transcript. A subagent's runs are rows of their own; filter agent_id = '' to count only the main transcript.",
	turn_idx:
		"read takes it as turn, with session_id and agent_id, to open the run.",
	session_id:
		"A Codex subagent thread is a session of its own, so its runs have another session_id.",
	started_at: "UTC.",
	ended_at: "UTC.",
	session_date: "UTC.",
	cost_usd:
		"Frozen at the build's pricing_version; NULL is unpriced or unknown, not free.",
};

const AGENT_NAMES = { claude_code: "Claude Code", codex: "Codex" } as const;

const runsColumns: readonly SqlViewColumn[] = RUN_INDEX_COLUMNS.filter(
	(column) =>
		!STORAGE_COLUMNS.has(column.name) &&
		!column.comment.startsWith(RECEIPT_ONLY),
).map((column) => ({
	name: column.name,
	type: column.type,
	meaning: column.comment,
	traps: columnTraps(column),
}));

const RUNS: SqlView = {
	name: "runs",
	grain:
		"One row per run (one human prompt and everything the agent did until the next prompt, in one stream), from each session's committed build.",
	traps: [
		"Each run is one row: superseded builds, older transcript generations and session receipts are already left out, so count rows directly, without FINAL or LIMIT 1 BY.",
		"Only sessions you may read in this workspace (every member's, unless the workspace keeps members to their own). The server adds the workspace; never filter by it.",
		"Subagent streams are runs too (agent_id is not empty), and a Codex subagent thread is a session of its own.",
		"Unknown is not zero: a fact the agent or its parser version cannot record is NULL (arrays empty) and named in unrecorded_facts; compare rates over the runs that can record it.",
		"Times are UTC. Costs are frozen at each build's pricing_version.",
	],
	columns: runsColumns,
	sql(memberOnly) {
		const table = getSafeClickHouseTable(RUN_INDEX_TABLE);
		const owner = `organization_id = {${SQL_SCOPE_PARAMS.workspace}:String}${
			memberOnly ? ` AND user_id = {${SQL_SCOPE_PARAMS.member}:String}` : ""
		}`;
		return `SELECT ${runsColumns.map((column) => column.name).join(", ")}
			FROM ${table} FINAL
			WHERE ${owner} AND row_kind = 'run'
				AND ${committedBuildSql(table, owner, ["user_id", "session_id"])}`;
	},
};

export const SQL_VIEWS: readonly SqlView[] = [RUNS];

export function findSqlView(name: string): SqlView | undefined {
	return SQL_VIEWS.find((view) => view.name === name.toLowerCase());
}

/**
 * A column's traps, from what the run index already records about it: which
 * agents and parser versions can record it, agent-specific narrowings, and
 * usage that is unknown when the session's usage extraction was incomplete.
 */
function columnTraps(column: RunIndexColumn): string[] {
	const traps: string[] = [];
	const own = COLUMN_TRAPS[column.name];
	if (own) traps.push(own);
	const gate: RunIndexColumnGate | undefined =
		RUN_INDEX_FACT_COLUMNS[column.name as keyof typeof RUN_INDEX_FACT_COLUMNS];
	if (gate) traps.push(gateTrap(gate));
	const narrowed: Readonly<Record<string, string>> | undefined =
		RUN_INDEX_NARROWED_COLUMNS[
			column.name as keyof typeof RUN_INDEX_NARROWED_COLUMNS
		];
	for (const [agent, text] of Object.entries(narrowed ?? {}))
		traps.push(
			`${AGENT_NAMES[agent as keyof typeof AGENT_NAMES] ?? agent}: ${text}`,
		);
	if ((RUN_INDEX_USAGE_COLUMNS as readonly string[]).includes(column.name))
		traps.push(
			"Unknown when the session's usage extraction was incomplete: then NULL (counts 0) and named in unrecorded_facts.",
		);
	return traps;
}

function gateTrap(gate: RunIndexColumnGate): string {
	const versions = gate.agents.map((agent) => {
		const since = gate.sinceBy?.[agent] ?? gate.since;
		return since > 1
			? `${AGENT_NAMES[agent]} from parser ${since}`
			: AGENT_NAMES[agent];
	});
	const mainOnly = (gate.mainStreamOnly ?? []).map(
		(agent) => `${AGENT_NAMES[agent]} in its main stream only`,
	);
	return `Recorded by ${[versions.join(" and "), ...mainOnly].join(", ")}; elsewhere unknown (NULL, arrays empty, named in unrecorded_facts), not none.`;
}
