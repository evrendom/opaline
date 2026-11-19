import { RUN_REQUEST_COLUMNS } from "@rudel/ch-schema/run-index";
import { getSafeClickHouseTable } from "../../clickhouse.js";
import { RUN_REQUESTS_TABLE } from "../l1-edges/l1-edge-tables.js";
import type { SqlWindow } from "./sql-guard.js";
import type { CommittedRuns } from "./sql-measures.js";
import type { SqlView, SqlViewColumn } from "./sql-views.js";

type Runs = (memberOnly: boolean, window?: SqlWindow) => CommittedRuns;

const SCOPE_TRAP =
	"Only sessions you may read in this workspace (every member's, unless the workspace keeps members to their own). The server adds the workspace; never filter by it.";
const INDEXED_TRAP =
	"Only the sessions runs holds, from each session's committed build: a session is here once the worker indexed it (minutes after upload).";
const SPAN_GAP_MINUTES = 5;
const HARNESS_MODELS = "('', '<synthetic>')";

function stored(name: string, traps: readonly string[] = []): SqlViewColumn {
	const column = RUN_REQUEST_COLUMNS.find((each) => each.name === name);
	if (!column) throw new Error(`run_requests has no column ${name}`);
	return { name, type: column.type, meaning: column.comment, traps };
}

function column(
	name: string,
	type: string,
	meaning: string,
	traps: readonly string[] = [],
): SqlViewColumn {
	return { name, type, meaning, traps };
}

const TOKEN_TRAP =
	"NULL is unknown (no usage on the response, or the session's usage extraction was incomplete), not zero.";

const REQUEST_COLUMNS: readonly SqlViewColumn[] = [
	stored("run_id", ["Join runs ON run_id = runs.run_id."]),
	stored("user_id", [
		"For spotting a team-wide problem or one person's setup, never for ranking people.",
	]),
	stored("source"),
	stored("session_id"),
	stored("agent_id", [
		"A subagent's responses are its own stream; filter agent_id = '' for the main transcript only.",
	]),
	stored("session_date", ["UTC."]),
	stored("turn_idx"),
	column(
		"record_idx",
		"UInt32",
		"Raw record index of the response's first record (reasoning, text or tool call); read takes it as record. Orders the responses of a stream.",
	),
	stored("started_at", ["UTC."]),
	stored("ended_at", ["UTC."]),
	column(
		"model",
		"LowCardinality(Nullable(String))",
		"The model that answered: the model of the response's own usage, else its run's model.",
		[
			"Never the harness placeholder <synthetic>; NULL when neither the response nor its run names a model.",
		],
	),
	column(
		"effort",
		"LowCardinality(Nullable(String))",
		"The run's effort (runs.effort): Claude Code and Codex set effort per prompt, so a response has its run's.",
		[
			"Where runs.efforts lists more than one, the run changed effort and this is its first.",
		],
	),
	column(
		"calls",
		"UInt32",
		"Tool calls the response made (length of call_records).",
	),
	column("failed_calls", "UInt32", "Of calls, those that failed."),
	stored("call_records"),
	stored("call_tools"),
	stored("call_groups"),
	stored("call_classes"),
	stored("call_failed"),
	stored("text_record"),
	stored("text_block"),
	stored("text_head"),
	stored("usage_observations"),
	stored("usage_unpriced"),
	stored("cost_usd", [
		"NULL is unpriced or unknown, not free; frozen at the build's pricing.",
	]),
	stored("uncached_input_tokens", [TOKEN_TRAP]),
	stored("cache_read_input_tokens", [TOKEN_TRAP]),
	stored("cache_write_5m_input_tokens", [TOKEN_TRAP]),
	stored("cache_write_1h_input_tokens", [TOKEN_TRAP]),
	stored("output_tokens", [TOKEN_TRAP]),
	stored("reasoning_output_tokens", [
		TOKEN_TRAP,
		"Claude Code: the thinking tokens the API reported for the response (thinking_tokens), not the length of the thinking text, which the transcript stores only as a summary. 0 with usage_observations > 0 is a response without thinking.",
	]),
	stored("unrecorded_facts"),
];

const PASSTHROUGH = new Set(
	REQUEST_COLUMNS.map((each) => each.name).filter(
		(name) =>
			!["record_idx", "model", "effort", "calls", "failed_calls"].includes(
				name,
			),
	),
);

function requestsView(runs: Runs): SqlView {
	return {
		name: "requests",
		grain:
			"One row per model response and the calls it made, of every stream, from each session's committed build, with its own model, usage and tokens; joins runs by run_id.",
		traps: [
			"Each response is one row: superseded builds and older transcript generations are already left out, so count rows directly.",
			SCOPE_TRAP,
			INDEXED_TRAP,
			"Per-response measures (thinking tokens, a response with no thinking, calls per response) belong here, not on runs, whose tokens are sums over the run.",
			"Thinking before a run's first tool call: sum reasoning_output_tokens over the run's responses in record_idx order up to and including the first with calls > 0.",
			"Keep the time range as started_at >= … (and started_at < …) in the WHERE of the query that reads requests, joined to the rest with AND: the server then reads only the responses in it.",
		],
		columns: REQUEST_COLUMNS,
		recent: { column: "started_at", rows: "responses started" },
		windowColumn: "started_at",
		sql(memberOnly, window = {}) {
			const { table: runIndex, owner, committed } = runs(memberOnly, window);
			const range = [
				...(window.from === undefined
					? []
					: [`started_at >= (${window.from})`]),
				...(window.to === undefined ? [] : [`started_at <= (${window.to})`]),
			];
			const selected = [owner, committed, ...range].join("\n\t\t\t\t\tAND ");
			const columns: Readonly<Record<string, string>> = {
				record_idx: "q.start_record",
				model: `toLowCardinality(if(q.usage_model NOT IN ${HARNESS_MODELS}, q.usage_model, if(r.model IN ${HARNESS_MODELS}, NULL, r.model)))`,
				effort: "toLowCardinality(nullIf(r.effort, ''))",
				calls: "toUInt32(length(q.call_records))",
				failed_calls: "toUInt32(arraySum(q.call_failed))",
			};
			return `SELECT ${REQUEST_COLUMNS.map((each) => `${PASSTHROUGH.has(each.name) ? `q.${each.name}` : columns[each.name]} AS ${each.name}`).join(",\n\t\t\t\t")}
				FROM (
					SELECT * FROM ${getSafeClickHouseTable(RUN_REQUESTS_TABLE)} FINAL
					WHERE ${selected}
				) AS q
				LEFT ANY JOIN (
					SELECT user_id, session_id, run_id, model, effort FROM ${runIndex} FINAL
					WHERE ${owner} AND row_kind = 'run' AND ${committed}
				) AS r ON r.user_id = q.user_id AND r.session_id = q.session_id AND r.run_id = q.run_id`;
		},
	};
}

const ACTIVITY_COLUMNS: readonly SqlViewColumn[] = [
	column("user_id", "String", "The member who uploaded the session.", [
		"For spotting a team-wide problem or one person's setup, never for ranking people.",
	]),
	column(
		"source",
		"LowCardinality(String)",
		"The agent: claude_code or codex.",
	),
	column("session_id", "String", "Native session id."),
	column(
		"span_idx",
		"UInt64",
		"Number of the span within the session, from 1 in time order.",
	),
	column(
		"started_at",
		"DateTime64(3, 'UTC')",
		"Start of the span's first run (its prompt).",
		["UTC."],
	),
	column(
		"ended_at",
		"DateTime64(3, 'UTC')",
		"Last activity of the span's runs.",
		["UTC."],
	),
	column(
		"minutes",
		"Float64",
		"Wall-clock minutes from started_at to ended_at.",
	),
	column("runs", "UInt64", "Runs of every stream in the span."),
	column("main_runs", "UInt64", "Of runs, those of the main stream."),
	column(
		"streams",
		"UInt64",
		"Streams with a run in the span (the main one and each subagent).",
	),
	column(
		"genuine_prompts",
		"UInt64",
		"Prompts a person typed in the span (sum of runs.genuine_prompts).",
	),
	column(
		"idle_minutes_before",
		"Nullable(Float64)",
		"Minutes from the previous span's end to this span's start: how long the session sat idle before it resumed.",
		["NULL for a session's first span."],
	),
];

function sessionActivityView(runs: Runs): SqlView {
	const order =
		"PARTITION BY user_id, session_id ORDER BY started_at, agent_id, turn_idx";
	return {
		name: "session_activity",
		grain: `One row per span of activity of a session: its runs of every stream, merged while one starts at most ${SPAN_GAP_MINUTES} minutes after the latest end before it.`,
		traps: [
			SCOPE_TRAP,
			INDEXED_TRAP,
			"A session was working at time T when one of its spans has started_at <= T AND T <= ended_at. A change that falls between two spans happened while the session was idle, not mid-session: say how long (idle_minutes_before).",
			"A run lasts from its prompt to its last activity record, including the tool calls it waited on; the time between a run's end and the next prompt is idle.",
			"Spans are for when a session worked, not for how much: active time is runs.active_minutes.",
		],
		columns: ACTIVITY_COLUMNS,
		recent: { column: "started_at", rows: "spans that started" },
		sql(memberOnly, window) {
			const { table, owner, committed } = runs(memberOnly, window);
			return `SELECT user_id, source, session_id, span_idx, started_at, ended_at,
					round(dateDiff('millisecond', started_at, ended_at) / 60000, 2) AS minutes,
					runs, main_runs, streams, genuine_prompts,
					if(span_idx = 1, NULL, round(dateDiff('millisecond', previous_end, started_at) / 60000, 2)) AS idle_minutes_before
				FROM (
					SELECT *, lagInFrame(ended_at) OVER (PARTITION BY user_id, session_id ORDER BY span_idx
						ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS previous_end
					FROM (
						SELECT user_id, toLowCardinality(any(source)) AS source, session_id, span_idx,
							min(started_at) AS started_at, max(ended_at) AS ended_at, count() AS runs,
							countIf(agent_id = '') AS main_runs, uniqExact(agent_id) AS streams,
							toUInt64(sum(genuine_prompts)) AS genuine_prompts
						FROM (
							SELECT *, sum(toUInt8(earlier = 0 OR started_at > reach + INTERVAL ${SPAN_GAP_MINUTES} MINUTE))
								OVER (${order} ROWS UNBOUNDED PRECEDING) AS span_idx
							FROM (
								SELECT user_id, source, session_id, agent_id, turn_idx, started_at, ended_at, genuine_prompts,
									max(ended_at) OVER (${order} ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS reach,
									count() OVER (${order} ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS earlier
								FROM ${table} FINAL
								WHERE ${owner} AND row_kind = 'run' AND ${committed}
							)
						)
						GROUP BY user_id, session_id, span_idx
					)
				)`;
		},
	};
}

export function requestSqlViews(runs: Runs): SqlView[] {
	return [requestsView(runs), sessionActivityView(runs)];
}
