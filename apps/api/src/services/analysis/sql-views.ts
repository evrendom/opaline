import {
	FINDING_RUNS_COLUMNS,
	FINDING_RUNS_TABLE,
} from "@rudel/ch-schema/finding-runs";
import {
	RUN_INDEX_COLUMNS,
	type RunIndexColumn,
} from "@rudel/ch-schema/run-index";
import {
	RUN_QUESTION_ANSWER_COLUMNS,
	RUN_QUESTION_ANSWERS_TABLE,
} from "@rudel/ch-schema/run-question-answers";
import { getSafeClickHouseTable } from "../../clickhouse.js";
import { RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";
import {
	RUN_INDEX_FACT_COLUMNS,
	RUN_INDEX_NARROWED_COLUMNS,
	RUN_INDEX_USAGE_COLUMNS,
	type RunIndexColumnGate,
} from "./run-index-columns.js";
import { committedBuildSql } from "./run-index-reader.js";
import { eventsView } from "./sql-event-views.js";
import type { SqlWindow } from "./sql-guard.js";
import { l1SqlViews } from "./sql-l1-views.js";
import {
	CALL_COLUMNS,
	type CommittedRuns,
	callsSql,
	cohortOwner,
	measuredRunsSql,
	RUN_MEASURE_COLUMNS,
} from "./sql-measures.js";
import { requestSqlViews } from "./sql-request-views.js";
import { sessionLinksView } from "./sql-session-links.js";
import { setupSnapshotsView } from "./sql-setup-views.js";

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
 * `SQL_SCOPE_PARAMS.member`. GitHub facts are read only for the repositories
 * the workspace has bound and may see, `SQL_SCOPE_PARAMS.repositories`. The
 * reader is always bound as `SQL_SCOPE_PARAMS.viewer`, for views of analyses.
 * The agent cannot write any of them: query parameters are refused in its SQL.
 */

export const SQL_SCOPE_PARAMS = {
	workspace: "opaline_workspace",
	member: "opaline_member",
	/** Who reads: views of analyses show only their own and shared ones. */
	viewer: "opaline_viewer",
	repositories: "opaline_repositories",
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
	/**
	 * The column whose range in the agent's WHERE the view reads first, so it
	 * reads less; the rows it returns are the same.
	 */
	readonly windowColumn?: string;
	/** The time column `schema` counts top values over, and what a row is ("runs that started"). */
	readonly recent: { readonly column: string; readonly rows: string };
	/** The view's statement; `memberOnly` keeps the member's own sessions. */
	sql(memberOnly: boolean, window?: SqlWindow): string;
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
	run_id: "run takes it as id to open the run in the run view.",
	session_id:
		"A Codex subagent thread is a session of its own, so its runs have another session_id.",
	started_at: "UTC.",
	ended_at: "UTC.",
	session_date: "UTC.",
	cost_usd:
		"Frozen at the build's pricing_version; NULL is unpriced or unknown, not free.",
	repository:
		"One value per session, the same on every run: a session started outside a repository (a coordinator folder whose subagents work in other checkouts) puts all its runs on the repository the upload named. Use cwd_repository for the repository a run worked in.",
	cwd: "Shell commands only: a run of file tools (Read, Edit, Grep) keeps its first recorded cwd, which for a Claude Code subagent is its session's. Paths are as written, not resolved through links: the same checkout reached by a link is another path.",
	cwd_repository:
		"NULL means unknown, not the session's repository: count runs per repository WHERE cwd_repository IS NOT NULL, and say how many runs are unknown. A directory below one with evidence is taken to be the same repository (a nested repository or a link out of it is not told apart).",
	mcp_unavailable:
		"Empty is not proof every server worked: Codex records no server state (unrecorded_facts names mcp_unavailable), and a stream may record none. A server listed here can still connect later in the run; the run's mcp_servers says which servers its calls used.",
	cwd_repository_basis:
		"session_branch needs the upload's branch on a record at the session's own directory: a session whose folder has another branch (a coordinator folder) has none there.",
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

/** The run index columns the runs view shows. */
const runIndexColumns = runsColumns.map((column) => column.name);
const RUNS_COLUMNS = [...runsColumns, ...RUN_MEASURE_COLUMNS];
/** What the calls view needs of each run. */
const CALL_RUN_COLUMNS = [
	"run_id",
	"user_id",
	"session_id",
	"agent_id",
	"turn_idx",
	"source",
	"unrecorded_facts",
];

/** The committed run rows a view may read: the caller's workspace, and only their own sessions when `memberOnly`. */
function committedRuns(
	memberOnly: boolean,
	window: SqlWindow = {},
): CommittedRuns {
	const table = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const owner = cohortOwner(memberOwner(memberOnly), window);
	return {
		table,
		owner,
		committed: committedBuildSql(table, owner, ["user_id", "session_id"]),
	};
}

/** The caller's rows of a table keyed by workspace and member, as `committedRuns` scopes the run index. */
function memberOwner(memberOnly: boolean): string {
	return `organization_id = {${SQL_SCOPE_PARAMS.workspace}:String}${
		memberOnly ? ` AND user_id = {${SQL_SCOPE_PARAMS.member}:String}` : ""
	}`;
}

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
	columns: RUNS_COLUMNS,
	recent: { column: "started_at", rows: "runs that started" },
	sql(memberOnly, window) {
		return `SELECT ${RUNS_COLUMNS.map((column) => column.name).join(", ")}
			FROM (${measuredRunsSql(committedRuns(memberOnly, window), runIndexColumns)})`;
	},
};

const CALLS: SqlView = {
	name: "calls",
	grain:
		"One row per tool call of a run (every tool, with its command identity, its own time and its results reduced to one), from each session's committed build; joins runs by run_id. A Codex code-mode script is a call (call_level script) and so is each call it ran (call_level inner, parent_call_id the script).",
	traps: [
		"Older transcript generations, repeated copies and the calls a forked Codex session copied from its parent are already left out, but a Codex script and the commands it ran are rows of their own, and the script's command text names those commands again. Count commands (and search command text) over call_level != 'script'. Count the calls the agent made, and search output text, over call_level != 'inner': every such call holds its whole output, while an inner call has its own output only where the transcript recorded it (Codex 0.153 and later), so an output search over inner calls misses older sessions. Failures are on one row each (see failed), so countIf(failed = 1) needs no level filter.",
		"A group of calls has two times: its own calls (sum(call_minutes)) and the runs that contain it, each run once (sum(active_minutes) FROM runs WHERE run_id IN (SELECT run_id FROM calls WHERE ...)). Neither is time lost to it until those runs are read.",
		"Only sessions you may read in this workspace (every member's, unless the workspace keeps members to their own). The server adds the workspace; never filter by it.",
		"Only the sessions runs holds: a session is here once the worker indexed it (minutes after upload).",
		"Times are UTC.",
		"Keep the time range as started_at >= … (and started_at < …) in the WHERE of the query that reads calls, joined to the rest with AND: the server then reads only the sessions with calls in it. Without it, or behind OR, every session of the workspace is read and a long history can pass the memory or time limit. The command columns read the stored text: about a week of a busy workspace fits, a month may not; narrow by member or session first.",
	],
	columns: CALL_COLUMNS,
	recent: { column: "started_at", rows: "calls made" },
	windowColumn: "started_at",
	sql(memberOnly, window) {
		const runs = committedRuns(memberOnly, window);
		return callsSql(
			runs,
			(scoped) => measuredRunsSql(scoped, CALL_RUN_COLUMNS),
			window,
			memberOwner(memberOnly),
		);
	},
};

/** Storage and visibility columns of the finding runs table, which the view keeps to itself. */
const FINDING_RUNS_HIDDEN = new Set([
	"organization_id",
	"author_id",
	"shared",
	"quoted_owners",
	"visibility_revision",
]);

const FINDING_COLUMN_TRAPS: Readonly<Record<string, string>> = {
	step_id:
		"Open the finding's analysis with answers action=open; a step has one finding.",
	cost_usd:
		"NULL is unpriced or unknown, not free; frozen at the run's pricing when the analysis was saved.",
	turn_idx:
		"Join runs on session_id, agent_id and turn_idx for the run as it is now.",
};

const findingRunsColumns: readonly SqlViewColumn[] =
	FINDING_RUNS_COLUMNS.filter(
		(column) => !FINDING_RUNS_HIDDEN.has(column.name),
	).map((column) => ({
		name: column.name,
		type: column.type,
		meaning: column.comment,
		traps: FINDING_COLUMN_TRAPS[column.name]
			? [FINDING_COLUMN_TRAPS[column.name] ?? ""]
			: [],
	}));

const FINDING_RUNS: SqlView = {
	name: "finding_runs",
	recent: { column: "saved_at", rows: "findings saved" },
	grain:
		"One row per finding of a saved analysis and run it cites, with the run's cost, tokens and active time as the run index recorded them when the analysis was saved.",
	traps: [
		"Only findings of saved analyses you may open: your own, and those shared with the workspace.",
		"A finding cites the runs its step's result names (a grouped result's example runs, not every run behind a count); a run cited by several findings has a row for each, so count distinct (session_id, agent_id, turn_idx) for the runs themselves.",
		"Recorded measures only, nothing estimated: a cited run the run index did not hold is not here, and NULL is unknown, not zero.",
	],
	columns: findingRunsColumns,
	sql(memberOnly) {
		const table = getSafeClickHouseTable(FINDING_RUNS_TABLE);
		// Visibility is filtered after FINAL picks each row's highest
		// visibility revision: the analysis log's latest share or unshare.
		return `SELECT ${findingRunsColumns.map((column) => column.name).join(", ")}
			FROM (
				SELECT * FROM ${table} FINAL
				WHERE organization_id = {${SQL_SCOPE_PARAMS.workspace}:String}
			)
			WHERE (author_id = {${SQL_SCOPE_PARAMS.viewer}:String} OR shared = 1)${
				memberOnly ? ` AND user_id = {${SQL_SCOPE_PARAMS.member}:String}` : ""
			}`;
	},
};

/**
 * The runs of each readable session's committed build, with the given run
 * index columns, for the server where it needs a column the runs view hides
 * (the transcript `revision` an answer is for).
 */
export function committedRunsSql(
	memberOnly: boolean,
	columns: readonly string[],
): string {
	const { table, owner, committed } = committedRuns(memberOnly);
	return `SELECT ${columns.join(", ")}
			FROM ${table} FINAL
			WHERE ${owner} AND row_kind = 'run'
				AND ${committed}`;
}

/** Columns of run question answers the view shows: the run, the question, the probability. */
const RUN_ANSWER_COLUMNS = new Set([
	"user_id",
	"session_id",
	"agent_id",
	"turn_idx",
	"question_id",
	"question",
	"probability",
	"provider",
	"input",
	"model",
	"answered_at",
]);

const runAnswersColumns: readonly SqlViewColumn[] =
	RUN_QUESTION_ANSWER_COLUMNS.filter((column) =>
		RUN_ANSWER_COLUMNS.has(column.name),
	).map((column) => ({
		name: column.name,
		type: column.type,
		meaning: column.comment,
		traps: [],
	}));

/**
 * Run question answers (CONTEXT.md "Run question"): stored by run_questions,
 * reused by every later analysis. ReplacingMergeTree keyed by question, run
 * and transcript revision, so FINAL keeps one answer per key; only answers
 * given for the revision each session is committed at are shown, so an
 * answer never describes a transcript that changed since.
 */
const RUN_ANSWERS: SqlView = {
	name: "run_answers",
	grain:
		"One row per run question answered about a run: the probability that the answer is yes.",
	traps: [
		"Where the workspace has run questions, every run is answered for every question that is on within minutes of being indexed, and older runs by a backfill; a run without a row is not answered (yet), which is not no.",
		"A probability says where to read, not what happened: open the runs with read before naming a cause.",
		"question_id is one wording; a reworded question has a new id, and the old answers keep the old wording in question.",
		"An answer shows only while its session's transcript is unchanged: a session uploaded again with changes has no answers until asked again.",
		"Each provider answers separately (one row per provider and model version): filter provider = '...' before counting or joining, or compare providers side by side.",
		"Join to runs on session_id, agent_id and turn_idx.",
	],
	columns: runAnswersColumns,
	recent: { column: "answered_at", rows: "answers stored" },
	sql(memberOnly) {
		const run = ["user_id", "session_id", "agent_id", "turn_idx", "revision"];
		return `SELECT ${runAnswersColumns.map((column) => column.name).join(", ")}
			FROM ${getSafeClickHouseTable(RUN_QUESTION_ANSWERS_TABLE)} FINAL
			WHERE organization_id = {${SQL_SCOPE_PARAMS.workspace}:String}${
				memberOnly ? ` AND user_id = {${SQL_SCOPE_PARAMS.member}:String}` : ""
			}
				AND (${run.join(", ")}) IN (${committedRunsSql(memberOnly, run)})`;
	},
};

export const SQL_VIEWS: readonly SqlView[] = [
	RUNS,
	CALLS,
	...requestSqlViews(committedRuns),
	eventsView(committedRuns),
	...l1SqlViews(SQL_SCOPE_PARAMS),
	sessionLinksView(committedRuns, memberOwner),
	setupSnapshotsView(SQL_SCOPE_PARAMS),
	FINDING_RUNS,
	RUN_ANSWERS,
];

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
	const mainOnly = [
		...(gate.mainStreamOnly ?? []).map(
			(agent) => `${AGENT_NAMES[agent]} in its main stream only`,
		),
		...Object.entries(gate.subagentSinceBy ?? {}).map(
			([agent, since]) =>
				`${AGENT_NAMES[agent as keyof typeof AGENT_NAMES]} subagent streams from parser ${since}`,
		),
	];
	return `Recorded by ${[versions.join(" and "), ...mainOnly].join(", ")}; elsewhere unknown (NULL, arrays empty, named in unrecorded_facts), not none.`;
}
