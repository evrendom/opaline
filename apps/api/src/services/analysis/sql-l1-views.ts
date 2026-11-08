import { TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX } from "@rudel/api-routes/transcript-records";
import { CALL_FACTS_TABLE } from "@rudel/ch-schema/call-facts";
import {
	RUN_SETUP_COLUMNS,
	RUN_SETUP_TABLE,
} from "@rudel/ch-schema/received-setup";
import { getSafeClickHouseTable } from "../../clickhouse.js";
import { L1_EDGES_TABLE, RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";
import { committedBuildSql } from "./run-index-reader.js";
import { GENUINE_PROMPT_SQL, records } from "./sql.js";
import { cohortOwner, windowSessionsSql } from "./sql-measures.js";
import type { SqlView, SqlViewColumn } from "./sql-views.js";

/**
 * The SQL views over L1 next to `runs` and `calls` (`sql-measures.ts`;
 * docs/adr/0005-agents-query-l1-with-sql.md): prompts, git events, edges and
 * CI jobs, each at a stable grain and joinable to `runs` by `run_id`. Each
 * reuses the rule its readers already use: transcript records of the
 * generation each session's committed run index build was built from (the
 * committed generation find pins, once indexed), without the records a forked
 * Codex session replays from its parent (as the run index leaves them out),
 * git observations of that generation chosen as find source=git chooses
 * them, the latest revision of each edge while it is active (ADR 0003), and
 * the latest version of each GitHub fact.
 *
 * Session rows are scoped like `runs`: the workspace, and the member only
 * where the reader may read only their own sessions. GitHub facts belong to
 * the workspace, not to a session, and are read only for the repositories the
 * workspace has bound and may see (`SQL_SCOPE_PARAMS.repositories`).
 */

/** The bound parameters a view statement reads; see `SQL_SCOPE_PARAMS`. */
export interface SqlScopeParams {
	readonly workspace: string;
	readonly member: string;
	readonly repositories: string;
}

const SCOPE_TRAP =
	"Only sessions you may read in this workspace (every member's, unless the workspace keeps members to their own). The server adds the workspace; never filter by it.";
const INDEXED_TRAP =
	"Only the sessions runs holds, in the transcript generation runs was built from, so rows add up to the runs they join: a session is here once the worker indexed it (minutes after upload).";
const UTC = "UTC.";

/** Columns every session view starts with, in this order. */
const SESSION_COLUMNS: readonly SqlViewColumn[] = [
	column(
		"run_id",
		"String",
		"The run the row belongs to: runs.run_id and edges.from_id of the run.",
		["Join runs ON run_id = runs.run_id."],
	),
	column("user_id", "String", "The member who uploaded the session.", [
		"For spotting a team-wide problem or one person's setup, never for ranking people.",
	]),
	column(
		"source",
		"LowCardinality(String)",
		"The agent: claude_code or codex.",
	),
	column("session_id", "String", "Native session id."),
	column("agent_id", "String", "Transcript stream; empty for the main one.", [
		"A subagent's rows are its own stream; filter agent_id = '' for the main transcript only.",
	]),
	column("session_date", "DateTime64(3, 'UTC')", "Session date.", [UTC]),
];

export function l1SqlViews(params: SqlScopeParams): SqlView[] {
	const owner = (memberOnly: boolean) =>
		`organization_id = {${params.workspace}:String}${
			memberOnly ? ` AND user_id = {${params.member}:String}` : ""
		}`;
	const repositories = `repository_id IN {${params.repositories}:Array(String)}`;
	const edgeOwner = (memberOnly: boolean) =>
		`organization_id = {${params.workspace}:String} AND ${repositories}${
			memberOnly ? ` AND user_id IN ({${params.member}:String}, '')` : ""
		}`;
	return [
		promptsView(owner),
		gitEventsView(owner),
		edgesView(edgeOwner),
		setupFilesView(owner),
		ciJobsView(
			`workspace_id = {${params.workspace}:String} AND provider = 'github' AND ${repositories}`,
		),
	];
}

type Owner = (memberOnly: boolean) => string;

function promptsView(owner: Owner): SqlView {
	const columns: readonly SqlViewColumn[] = [
		...SESSION_COLUMNS,
		column(
			"turn_idx",
			"UInt32",
			"Run number within the stream: runs.turn_idx; 0 before the first prompt.",
			[
				"Injected context before the first prompt belongs to no run: turn_idx is 0 and run_id empty.",
			],
		),
		column(
			"record_idx",
			"UInt32",
			"Raw transcript line; read takes it as record.",
		),
		column("block_idx", "UInt16", "Content block within the line."),
		column("at", "DateTime64(3, 'UTC')", "When it was sent or injected.", [
			UTC,
		]),
		column(
			"kind",
			"LowCardinality(String)",
			"user_prompt (typed by a person, or a parent's task to a subagent) or injected_context (text the harness added: slash commands, skill bodies, instructions, task notifications, shell output, interrupts).",
		),
		column(
			"subtype",
			"LowCardinality(String)",
			"For user_prompt: delegation (a parent agent's task to a subagent), queued (typed while the agent was busy) or empty; for injected_context its kind: slash_command, skill_body, agents_md, system_instruction, task_notification, local_command, user_shell, interrupt, developer, environment_context, ide_context, system_reminder, meta.",
		),
		column(
			"genuine",
			"UInt8",
			"1 for a prompt a person typed: user_prompt and not a delegation.",
		),
		column("text", "String", "The text as stored.", [
			"Long texts are stored cut: text_cut says so, and read (record) returns the rest.",
		]),
		column("text_chars", "UInt32", "Characters of the whole text, cut or not."),
		column("text_cut", "UInt8", "1 when text is shorter than the original."),
	];
	return {
		name: "prompts",
		grain:
			"One row per prompt or injected context, from the transcript generation each session's runs were built from.",
		traps: [
			"Each prompt is one row: older transcript generations, repeated copies and the prompts a forked Codex session copied from its parent are already left out, so count rows directly.",
			SCOPE_TRAP,
			INDEXED_TRAP,
			"Count genuine = 1 for what people typed; a run starts at a prompt, so runs.genuine_prompts already counts them per run.",
			"Keep the time range as at >= … (and at < …) in the WHERE of the query that reads prompts, joined to the rest with AND: the server then reads only the sessions with prompts in it. Without it, or behind OR, every session's stored text is read and a long history can pass the memory or time limit.",
		],
		columns,
		recent: { column: "at", rows: "prompts sent" },
		windowColumn: "at",
		sql(memberOnly, window = {}) {
			const scope = cohortOwner(owner(memberOnly), window);
			// Only the sessions with a prompt in the window the query keeps,
			// so the rows are the same and a short window reads little.
			const windowed = windowSessionsSql(
				scope,
				"kind IN ('user_prompt', 'injected_context')",
				window,
			);
			const sessions = windowed?.sessions ?? "";
			return `${windowed ? `WITH ${windowed.with}\n\t\t\t\t` : ""}SELECT r.run_id AS run_id, p.user_id AS user_id, p.source AS source, p.session_id AS session_id,
					p.agent_id AS agent_id, p.session_date AS session_date, p.turn_idx AS turn_idx,
					p.record_idx AS record_idx, p.block_idx AS block_idx, p.ts AS at, p.kind AS kind,
					p.subtype AS subtype, p.genuine AS genuine, p.shown AS text, p.text_chars AS text_chars,
					toUInt8(lengthUTF8(p.shown) < p.text_chars) AS text_cut
				FROM (
					SELECT user_id, source, session_id, agent_id, session_date, turn_idx, record_idx, block_idx,
						ts, kind, subtype, text_chars, toUInt8(${GENUINE_PROMPT_SQL}) AS genuine,
						if(lengthUTF8(text) >= lengthUTF8(head), text, head) AS shown
					FROM ${records()} FINAL
					PREWHERE kind IN ('user_prompt', 'injected_context')
					WHERE ${scope} AND ${indexedGenerationSql(scope)}${sessions}
						AND facts['fork_replayed'] != 'true'
				) AS p
				LEFT ANY JOIN (${committedRunsSql(scope)}${sessions}) AS r ON ${sameKey("p", "r", "turn_idx")}`;
		},
	};
}

function gitEventsView(owner: Owner): SqlView {
	const columns: readonly SqlViewColumn[] = [
		...SESSION_COLUMNS,
		column(
			"turn_idx",
			"Nullable(UInt32)",
			"Run number within the stream: runs.turn_idx; NULL before the first prompt or when the run is not in runs yet.",
		),
		column(
			"record_idx",
			"UInt32",
			"Raw transcript line of the call that shows the event; read takes it as record.",
		),
		column("call_id", "String", "The call that shows the event."),
		column(
			"evidence_id",
			"String",
			"Id of the event as evidence: edges.evidence_id of the edges it witnesses.",
			[
				"Join edges ON edges.evidence_id = evidence_id AND edges.session_id = session_id AND edges.user_id = user_id: evidence ids repeat across sessions.",
			],
		),
		column("at", "DateTime64(3, 'UTC')", "When the call showed the event.", [
			UTC,
		]),
		column(
			"kind",
			"LowCardinality(String)",
			"commit_created (a commit's output), push_range (a push: its output, else its command), pr_url (a PR URL the session showed), mcp_pr_created (a PR an MCP tool created), ci_check (a CI status read: gh pr checks, gh run view|watch|list, an MCP CI tool), codex_session_meta (Codex session metadata).",
		),
		column(
			"label",
			"LowCardinality(String)",
			"observed; forced_update (a forced push); unconfirmed (a CI check the command does not show ran); pr_link and git_operation for events Claude Code recorded itself; command (git extractor 6: a push recognised from its git push command, whose output shows no ref update, as git push -q … | tail does: no SHAs, branch only when the refspec names it).",
		),
		column(
			"short_sha",
			"String",
			"Abbreviated commit SHA a commit's output showed.",
		),
		column(
			"branch",
			"String",
			"Branch the commit, push, check or metadata names.",
		),
		column(
			"push_from_sha",
			"String",
			"Abbreviated SHA before the push; empty for a new branch.",
		),
		column(
			"push_to_sha",
			"String",
			"Abbreviated SHA the push moved the branch to.",
		),
		column("push_source_branch", "String", "Local branch the push sent."),
		column("pr_repo", "String", "owner/name of a PR the event names."),
		column(
			"pr_number",
			"UInt32",
			"Number of a PR the event names; 0 when none.",
		),
		column(
			"commit_hash",
			"String",
			"Full commit SHA in Codex metadata or a check's --commit.",
		),
		column(
			"repository_url",
			"String",
			"Remote the push went to (To <remote>) or Codex metadata's repository URL.",
		),
		column(
			"github_run_id",
			"String",
			"GitHub run id a CI check names (gh run view|watch <id>); empty otherwise.",
		),
		column(
			"transcript_current",
			"UInt8",
			"1 when the events come from the session's committed transcript generation; 0 when only an older one was extracted.",
		),
		column(
			"checks_after",
			"Nullable(UInt32)",
			"For a push: CI check calls later in the same stream that ran (any of their ci_check rows not unconfirmed), one per call however many runs it linked; NULL for other kinds. As find source=git checksAfter.count.",
			[
				"0 means the agent never checked CI after this push in the same stream, not that CI did not run: CI runs are edges and ci_jobs.",
			],
		),
		column(
			"unconfirmed_checks_after",
			"Nullable(UInt32)",
			"For a push: later CI check calls none of whose ci_check rows shows they ran; NULL for other kinds.",
		),
		column(
			"checks_same_call",
			"Nullable(UInt32)",
			"For a push: CI checks in the same call as the push (order within the call unknown); NULL for other kinds.",
		),
	];
	return {
		name: "git_events",
		grain:
			"One row per git or GitHub event a session's transcript shows (commit, push, PR, CI check), from the git observations of the transcript generation each session's runs were built from (else its newest, transcript_current = 0), as find source=git reads them.",
		traps: [
			"Each event is one row: older extractions are already left out, so count rows directly.",
			SCOPE_TRAP,
			"What the transcript shows, not what GitHub holds: which commit, PR and CI run an event resolved to are edges (by evidence_id); an event without edges was not resolved, which does not mean it has none.",
			"Sessions without extracted git observations have no rows here; that is unknown, not no git activity.",
			INDEXED_TRAP,
			"find source=git's window is session dates: filter session_date to compare with it.",
		],
		columns,
		recent: { column: "at", rows: "events shown" },
		sql(memberOnly) {
			const scope = owner(memberOnly);
			const observations = getSafeClickHouseTable(
				"rudel.session_git_observations",
			);
			const run =
				"arrayFirst(x -> e.record_idx >= x.1 AND e.record_idx < x.2, s.runs)";
			const pushOnly = (count: string) =>
				`if(e.kind = 'push_range', toUInt32(arrayCount(x -> ${count}, k.checks)), NULL)`;
			// Per session in runs, the git extraction of the transcript
			// generation runs was built from, else its newest one, as find
			// source=git picks it (`loadObservationGenerations`).
			return `WITH opaline_view_generations AS (
					${indexedReceiptsSql(scope, "user_id, session_id, revision, parser_version, session_date")}
				), opaline_view_picks AS (
					SELECT user_id, session_id, picked.1 AS revision, picked.2 AS parser_version,
						transcript_current, session_date
					FROM (
						SELECT o.user_id AS user_id, o.session_id AS session_id,
							argMax((o.revision, o.parser_version),
								(o.revision = g.revision AND o.transcript_parser_version = g.parser_version, o.revision, o.parser_version)) AS picked,
							toUInt8(max(o.revision = g.revision AND o.transcript_parser_version = g.parser_version)) AS transcript_current,
							any(g.session_date) AS session_date
						FROM (
							SELECT DISTINCT user_id, session_id, revision, parser_version, transcript_parser_version
							FROM ${observations}
							WHERE ${scope} AND kind = 'receipt'
						) AS o
						INNER JOIN opaline_view_generations AS g ON o.user_id = g.user_id AND o.session_id = g.session_id
						GROUP BY o.user_id, o.session_id
					)
				), opaline_view_events AS (
					SELECT o.*, p.transcript_current AS transcript_current, p.session_date AS session_date
					FROM (
						SELECT user_id, source, session_id, revision, parser_version, agent_id, record_idx, block_idx,
							call_id, kind, label, short_sha, branch, push_from_sha, push_to_sha, push_source_branch,
							pr_repo, pr_number, commit_hash, repository_url, run_id, ts
						FROM ${observations} FINAL
						WHERE ${scope} AND kind != 'receipt'
					) AS o
					INNER JOIN opaline_view_picks AS p ON o.user_id = p.user_id AND o.session_id = p.session_id
						AND o.revision = p.revision AND o.parser_version = p.parser_version
				)
				SELECT ${run}.4 AS run_id, e.user_id AS user_id, e.source AS source, e.session_id AS session_id,
					e.agent_id AS agent_id, e.session_date AS session_date,
					if(${run}.4 = '', NULL, ${run}.3) AS turn_idx, e.record_idx AS record_idx, e.call_id AS call_id,
					concat('obs:', ${idComponentSql("e.agent_id")}, ':', toString(e.record_idx), ':', toString(e.block_idx), ':', e.kind) AS evidence_id,
					e.ts AS at, e.kind AS kind, e.label AS label, e.short_sha AS short_sha, e.branch AS branch,
					e.push_from_sha AS push_from_sha, e.push_to_sha AS push_to_sha, e.push_source_branch AS push_source_branch,
					e.pr_repo AS pr_repo, e.pr_number AS pr_number, e.commit_hash AS commit_hash,
					e.repository_url AS repository_url, e.run_id AS github_run_id, e.transcript_current AS transcript_current,
					${pushOnly("x.1 > e.record_idx AND x.2 = 1")} AS checks_after,
					${pushOnly("x.1 > e.record_idx AND x.2 = 0")} AS unconfirmed_checks_after,
					${pushOnly("x.1 = e.record_idx")} AS checks_same_call
				FROM opaline_view_events AS e
				LEFT ANY JOIN (
					SELECT user_id, session_id, agent_id, groupArray((record_idx, confirmed)) AS checks
					FROM (
						SELECT user_id, session_id, agent_id, record_idx, call_id,
							toUInt8(max(label != 'unconfirmed')) AS confirmed
						FROM opaline_view_events WHERE kind = 'ci_check'
						GROUP BY user_id, session_id, agent_id, record_idx, call_id
					)
					GROUP BY user_id, session_id, agent_id
				) AS k ON e.user_id = k.user_id AND e.session_id = k.session_id AND e.agent_id = k.agent_id
				LEFT ANY JOIN (
					SELECT user_id, session_id, agent_id, groupArray((start_record, end_record, turn_idx, run_id)) AS runs
					FROM (${committedRunsSql(scope)})
					GROUP BY user_id, session_id, agent_id
				) AS s ON e.user_id = s.user_id AND e.session_id = s.session_id AND e.agent_id = s.agent_id`;
		},
	};
}

function edgesView(owner: Owner): SqlView {
	const columns: readonly SqlViewColumn[] = [
		column(
			"run_id",
			"String",
			"The run the edge starts from: runs.run_id; empty when it starts from a session, commit or pull request.",
			["Join runs ON run_id = runs.run_id."],
		),
		column(
			"relation",
			"LowCardinality(String)",
			"What the evidence states. From a run: commit_created, commit_pushed, sha_mentioned, pr_named, pr_branch_head (it pushed or checked the PR's head branch), ci_named (it named the CI run), ci_on_branch_window (CI on a branch it checked, from the day before). From a session: commit_captured, pr_listed, sha_mentioned. From GitHub: commit_in_pr, ci_on_sha (commit to CI run), ci_for_pr (PR to CI run).",
			[
				"Creating, pushing and mentioning a commit are different relations; a run that pushed a commit did not necessarily write it.",
			],
		),
		column(
			"basis",
			"LowCardinality(String)",
			"Where the evidence came from: transcript, capture, hook or github.",
		),
		column(
			"from_kind",
			"LowCardinality(String)",
			"run, session, commit or pull_request.",
		),
		column(
			"from_id",
			"String",
			"The source node: a run's run_id; a session's user/source/session/agent; a commit's repository/SHA; a pull request's repository/number.",
		),
		column(
			"to_kind",
			"LowCardinality(String)",
			"commit, pull_request or ci_run.",
		),
		column(
			"to_id",
			"String",
			"The target node: commit repository/SHA, pull_request repository/number, ci_run repository/kind/run id/attempt (ci_jobs.ci_run_id).",
			[
				"Chain edges by to_id = from_id (run to commit to pull request or CI run); join ci_jobs ON ci_jobs.ci_run_id = to_id.",
			],
		),
		column(
			"evidence_id",
			"String",
			"The evidence row that witnesses the edge: a git_events evidence_id (obs:…), a capture or snapshot, or a GitHub row.",
		),
		column(
			"user_id",
			"String",
			"The session's member for session evidence; empty for GitHub edges.",
			[
				"For spotting a team-wide problem or one person's setup, never for ranking people.",
			],
		),
		column(
			"source",
			"LowCardinality(String)",
			"claude_code or codex for session evidence; empty for GitHub edges.",
		),
		column(
			"session_id",
			"String",
			"The session for session evidence; empty for GitHub edges.",
		),
		column(
			"agent_id",
			"String",
			"Transcript stream for session evidence; empty for the main one.",
		),
		column(
			"turn_idx",
			"UInt32",
			"runs.turn_idx when the edge starts from a run; 0 otherwise.",
		),
		column(
			"repository_id",
			"String",
			"GitHub repository id the edge resolved in.",
		),
		column(
			"observed_at",
			"DateTime64(3, 'UTC')",
			"Time of the evidence (observation, capture, snapshot or GitHub fact).",
			[UTC],
		),
		column(
			"matched_value",
			"String",
			"The literal value the evidence matched: an abbreviated SHA, branch, PR number or run id.",
		),
		column(
			"match_rule",
			"LowCardinality(String)",
			"How it matched: full_sha, unique_prefix, number, branch_head, run_id, branch_window, membership, merge_commit, head_sha, or GitHub's link basis.",
		),
		column(
			"candidate_count",
			"UInt32",
			"How many targets the value matched; more than one (a shared branch) means one edge per candidate.",
			["Count distinct to_id, not rows, when candidate_count > 1."],
		),
		column(
			"details",
			"String",
			"Small JSON object of further literal values (check label, branch window, whether the PR head still contains the commit).",
		),
	];
	return {
		name: "edges",
		grain:
			"One row per relationship that holds now between runs, sessions, commits, pull requests and CI runs (the latest revision of each edge, retracted ones left out), in the GitHub repositories the workspace has connected.",
		traps: [
			"Edges are evidence only where they exist: a push or check without an edge was not resolved (no GitHub binding, an ambiguous SHA, not collected yet), which does not mean it has no PR or CI. git_events lists every event.",
			"Only repositories the workspace has connected to GitHub and may see; empty when GitHub is not connected or its outcomes are not shown in this workspace.",
			"Session edges follow session visibility (every member's, unless the workspace keeps members to their own); GitHub edges (user_id empty) are the workspace's.",
			"A session whose edges are being rebuilt may briefly show part of the new build.",
		],
		columns,
		recent: { column: "observed_at", rows: "edges observed" },
		sql(memberOnly) {
			const table = getSafeClickHouseTable(L1_EDGES_TABLE);
			return `SELECT if(from_kind = 'run', from_id, '') AS run_id, relation, basis, from_kind, from_id,
					to_kind, to_id, evidence_id, user_id, source, session_id, agent_id, turn_idx, repository_id,
					observed_at, matched_value, match_rule, candidate_count, details
				FROM (
					SELECT * FROM ${table} FINAL
					WHERE ${owner(memberOnly)}
				)
				WHERE is_active = 1`;
		},
	};
}

/** Columns of `rudel.run_setup` the setup_files view shows, with their traps. */
const SETUP_FILE_TRAPS: Readonly<Record<string, readonly string[]>> = {
	run_id: [
		"Join runs ON run_id = runs.run_id; open the run's setup with run(id, sections=['setup']).",
	],
	user_id: [
		"For spotting a team-wide problem or one person's setup, never for ranking people.",
	],
	agent_id: [
		"A subagent's stream has only the setup its own transcript recorded; filter agent_id = '' for the main transcript.",
	],
	setup_file: [
		"The same file on two members' machines, in any clone or worktree, is one setup_file; group by it to compare versions across members.",
		"A repository file is named relative to the session's working directory: a session started in a subdirectory names the repository's files above it by their path in the member's home instead.",
	],
	version: [
		"Two runs had the same version only when the text was identical; a different version can differ by one character. Read both before naming a change.",
		"NULL for read_by_agent rows: which version the agent read is not recorded.",
	],
	uncommitted: [
		"NULL is unknown, not committed: Codex records no git status, and a status Claude Code cut may miss files.",
	],
	carried: [
		"A run has every setup file version it had: those received during it (carried = false) and the latest version of each received earlier in its stream (carried = true). Filter carried = false for what arrived during the run.",
	],
	compacted_since: [
		"After a compaction the harness may have dropped the text or sent it again; true says only that one happened.",
	],
	kind: [
		"skill_body for Codex is a whole SKILL.md the agent printed with cat; partial reads (sed, head) and reads of several files at once are not received setup.",
	],
	chars: ["NULL for read_by_agent rows."],
};
const READ_TYPES: Readonly<Record<string, string>> = {
	version: "Nullable(String)",
	chars: "Nullable(UInt32)",
};
const SETUP_FILE_COLUMNS = [
	"run_id",
	"user_id",
	"source",
	"session_id",
	"agent_id",
	"turn_idx",
	"run_started_at",
	"kind",
	"setup_file",
	"scope",
	"owner",
	"path",
	"version",
	"version_name",
	"uncommitted",
	"carried",
	"compacted_since",
	"chars",
	"recorded_path",
	"received_at",
	"received_record",
] as const;

/**
 * Received setup (CONTEXT.md "Received setup"): each run with every setup
 * file version it had, from the committed run index build of its session,
 * so the agent lists the runs per version of one setup file across members
 * and compares the version a failing run used with the others'.
 */
function setupFilesView(owner: Owner): SqlView {
	const columns: readonly SqlViewColumn[] = SETUP_FILE_COLUMNS.map((name) => {
		const found = RUN_SETUP_COLUMNS.find(
			(candidate) => candidate.name === name,
		);
		if (!found) throw new Error(`run_setup has no column ${name}`);
		const time = name === "run_started_at" || name === "received_at";
		return column(
			name === "run_started_at" ? "started_at" : name,
			READ_TYPES[name] ?? found.type,
			found.comment,
			[...(SETUP_FILE_TRAPS[name] ?? []), ...(time ? [UTC] : [])],
		);
	}).concat([
		column(
			"read_by_agent",
			"UInt8",
			"1 when the agent read the file itself (a Read call, cat, head, sed and the like) in any stream: CLAUDE.md, CLAUDE.local.md, AGENTS.md, AGENTS.override.md, SKILL.md and .claude/rules files, from the call's files_read; 0 for setup the harness loaded.",
			[
				"Did an agent see a file: rows of it with either value. A read row is the call that read it: received_at and received_record are the call's, recorded_path is the path read, carried and compacted_since are false.",
				"A read before the stream's first prompt has turn_idx 0, an empty run_id and started_at the call's time.",
				"A read through a variable, a glob or a script is not seen (calls.files_read). A partial read (head, an offset) counts as a read.",
			],
		),
	]);
	return {
		name: "setup_files",
		grain:
			"One row per run and setup file version it had (system prompt, instruction files, skill bodies, MCP instructions, AGENTS.md, developer messages), as its transcript recorded them, from each session's committed run index build.",
		traps: [
			"Each run and version is one row: superseded builds and older transcript generations are already left out, so count rows directly; count distinct run_id for runs.",
			SCOPE_TRAP,
			"Received setup is what the transcript recorded, never what was on disk: a file the agent had but its transcript does not record is not here, and a run whose session was built before received setup was read has no rows (runs.coverage_gaps has received_setup). Say unknown for those, never none.",
			"The text is not a column: open it with run(run_id, expand=['s<n>']) after run(run_id, sections=['setup']) lists the run's setup with its s-ids.",
			"Keep the time range as started_at >= … in the WHERE: a run with many setup files has a row for each.",
			"Instruction and skill files an agent read itself are rows too (read_by_agent = 1), from every stream: filter read_by_agent = 0 for what the harness loaded.",
		],
		columns,
		recent: { column: "started_at", rows: "run setup files" },
		sql(memberOnly, window = {}) {
			const scope = cohortOwner(owner(memberOnly), window);
			const table = getSafeClickHouseTable(RUN_SETUP_TABLE);
			const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
			const received = SETUP_FILE_COLUMNS.map((name) =>
				name === "run_started_at" ? "run_started_at AS started_at" : name,
			).join(", ");
			const parts = "extractGroups(setup_file, '^([^:]*):([^:]*):(.*)$')";
			const read: Readonly<Record<string, string>> = {
				run_started_at: "ifNull(run_started_at, started_at) AS started_at",
				kind: `toLowCardinality(multiIf(match(path, '(^|/)SKILL[.]md$'), 'skill_body', match(path, '(^|/)AGENTS[^/]*[.]md$'), 'agents_md', 'instructions')) AS kind`,
				scope: `toLowCardinality(${parts}[1]) AS scope`,
				owner: `${parts}[2] AS owner`,
				path: `${parts}[3] AS path`,
				version: "CAST(NULL, 'Nullable(String)') AS version",
				version_name: "'' AS version_name",
				uncommitted: "CAST(NULL, 'Nullable(Bool)') AS uncommitted",
				carried: "false AS carried",
				compacted_since: "false AS compacted_since",
				chars: "CAST(NULL, 'Nullable(UInt32)') AS chars",
				recorded_path: "recorded_path",
				received_at: "started_at AS received_at",
				received_record: "record_idx AS received_record",
			};
			return `SELECT ${received}, 0 AS read_by_agent
				FROM ${table} FINAL
				WHERE ${scope}
					AND ${committedBuildSql(runIndex, scope, ["user_id", "session_id"])}
				UNION ALL
				SELECT ${SETUP_FILE_COLUMNS.map((name) => read[name] ?? name).join(", ")}, 1 AS read_by_agent
				FROM ${getSafeClickHouseTable(CALL_FACTS_TABLE)} FINAL
				ARRAY JOIN setup_files_read AS setup_file, setup_paths_read AS recorded_path
				WHERE ${scope} AND notEmpty(setup_files_read)
					AND ${committedBuildSql(runIndex, scope, ["user_id", "session_id"])}`;
		},
	};
}

function ciJobsView(scope: string): SqlView {
	const time = "DateTime64(3, 'UTC')";
	const columns: readonly SqlViewColumn[] = [
		column(
			"ci_run_id",
			"String",
			"The CI run attempt the job ran in: edges.to_id of its ci_run (repository/actions_run/run id/attempt).",
			[
				"A job reaches runs only through edges: runs.run_id = edges.run_id, then edges.to_id (a commit or PR) = edges.from_id of a ci_run edge, whose to_id = ci_run_id.",
			],
		),
		column("repository_id", "String", "GitHub repository id."),
		column("github_run_id", "String", "GitHub's workflow run id."),
		column(
			"attempt",
			"UInt32",
			"Run attempt; a rerun is a new attempt with its own jobs.",
		),
		column("job_id", "String", "GitHub's job id."),
		column("name", "String", "Job name as GitHub shows it."),
		column(
			"status",
			"LowCardinality(String)",
			"queued, in_progress or completed, as last collected.",
		),
		column(
			"conclusion",
			"LowCardinality(Nullable(String))",
			"success, failure, cancelled, skipped, timed_out, action_required or neutral; NULL while the job has not completed.",
		),
		column("created_at", `Nullable(${time})`, "When GitHub created the job.", [
			UTC,
		]),
		column("started_at", `Nullable(${time})`, "When the job started.", [UTC]),
		column(
			"completed_at",
			`Nullable(${time})`,
			"When the job completed; NULL until then.",
			[UTC],
		),
		column(
			"seconds",
			"Nullable(Int64)",
			"completed_at minus started_at, in seconds; NULL until both are known.",
		),
		column("runner_name", "String", "Runner that ran the job."),
		column("labels", "Array(String)", "Runner labels the job asked for."),
		column(
			"workflow_name",
			"String",
			"Workflow of the run; empty when the run was not collected.",
		),
		column("workflow_path", "String", "Workflow file of the run."),
		column(
			"event",
			"LowCardinality(String)",
			"What triggered the run: push, pull_request, …",
		),
		column("head_sha", "String", "Commit the run ran on."),
		column("head_branch", "String", "Branch the run ran on."),
		column(
			"run_conclusion",
			"LowCardinality(Nullable(String))",
			"Conclusion of the whole run attempt.",
		),
	];
	return {
		name: "ci_jobs",
		grain:
			"One row per job of a GitHub Actions run attempt, as GitHub last reported it, in the repositories the workspace has connected.",
		traps: [
			"Each job is one row: older reports of it are already left out, so count rows directly.",
			"Only repositories the workspace has connected to GitHub and may see; empty when GitHub is not connected or its outcomes are not shown in this workspace.",
			"Jobs belong to the workspace's repositories, not to a session: every member reads them; they reach runs only through edges.",
			"Only GitHub Actions runs have jobs; other checks (check runs, commit statuses) are not here.",
			"Collection covers a window per repository: a run without jobs here may not have been collected, which does not mean it had none.",
		],
		columns,
		recent: { column: "created_at", rows: "CI jobs created" },
		sql() {
			const jobs = getSafeClickHouseTable("rudel.github_ci_jobs");
			const runs = getSafeClickHouseTable("rudel.github_ci_runs");
			return `SELECT concat(${idComponentSql("j.repository_id")}, '/actions_run/', ${idComponentSql("j.run_id")}, '/', toString(j.attempt)) AS ci_run_id,
					j.repository_id AS repository_id, j.run_id AS github_run_id, j.attempt AS attempt, j.job_id AS job_id,
					j.name AS name, j.status AS status, j.conclusion AS conclusion, j.created_at AS created_at,
					j.started_at AS started_at, j.completed_at AS completed_at,
					dateDiff('second', j.started_at, j.completed_at) AS seconds,
					j.runner_name AS runner_name, j.labels AS labels, r.workflow_name AS workflow_name,
					r.workflow_path AS workflow_path, r.event AS event, r.head_sha AS head_sha,
					r.head_branch AS head_branch, r.conclusion AS run_conclusion
				FROM (SELECT * FROM ${jobs} FINAL WHERE ${scope}) AS j
				LEFT ANY JOIN (
					SELECT repository_id, run_id, attempt, workflow_name, workflow_path, event, head_sha, head_branch, conclusion
					FROM ${runs} FINAL
					WHERE ${scope} AND kind = 'actions_run'
				) AS r ON j.repository_id = r.repository_id AND j.run_id = r.run_id AND j.attempt = r.attempt`;
		},
	};
}

/**
 * The same stream and `last` on both sides of a join. Joining on the owner
 * and session columns themselves (not a hash of them) lets ClickHouse push
 * the agent's user_id and session_id filters into the joined side too.
 */
function sameKey(left: string, right: string, last: string): string {
	return ["user_id", "session_id", "agent_id", last]
		.map((name) => `${left}.${name} = ${right}.${name}`)
		.join(" AND ");
}

/**
 * One component of an L1 node or evidence id as `l1-edge-ids.ts` writes it
 * (JavaScript's encodeURIComponent, which leaves !'()* as they are), so the
 * ids a view builds equal the edges' ids.
 */
export function idComponentSql(value: string): string {
	let sql = `encodeURLComponent(${value})`;
	for (const char of ["!", "'", "(", ")", "*"])
		sql = `replaceAll(${sql}, '%${char.charCodeAt(0).toString(16).toUpperCase()}', '${char === "'" ? "\\'" : char}')`;
	return sql;
}

/**
 * The receipts of each session's committed run index build (`columns` of
 * them): the transcript generation `runs` was built from.
 */
function indexedReceiptsSql(scope: string, columns: string): string {
	const table = getSafeClickHouseTable(RUN_INDEX_TABLE);
	return `SELECT ${columns}
				FROM ${table} FINAL
				WHERE ${scope} AND row_kind = 'receipt'
					AND ${committedBuildSql(table, scope, ["user_id", "session_id"])}`;
}

/**
 * Keeps only records of the transcript generation each session's committed
 * run index build was built from: the generation `runs` reads, which is the
 * session's committed generation (its newest receipt, as find pins it) once
 * the worker indexed it. Matching the storage key's prefix, it reads only
 * that generation's parts of `transcript_records`, so prompts join
 * runs exactly, turn by turn, and never cost a scan of older generations.
 */
function indexedGenerationSql(scope: string): string {
	const generation = "user_id, source, session_id, revision, parser_version";
	return `(${generation}) IN (${indexedReceiptsSql(scope, generation)})
			AND record_idx < ${TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX}`;
}

/**
 * The runs of each session's committed run index build, as the runs view
 * reads them, with the record range each run covers.
 */
function committedRunsSql(scope: string): string {
	const table = getSafeClickHouseTable(RUN_INDEX_TABLE);
	return `SELECT user_id, session_id, agent_id, turn_idx, start_record, end_record, run_id
		FROM ${table} FINAL
		WHERE ${scope} AND row_kind = 'run'
			AND ${committedBuildSql(table, scope, ["user_id", "session_id"])}`;
}

function column(
	name: string,
	type: string,
	meaning: string,
	traps: readonly string[] = [],
): SqlViewColumn {
	return { name, type, meaning, traps };
}
