import { getSafeClickHouseTable } from "../../clickhouse.js";
import { commandFamiliesSql } from "./command-identity.js";
import {
	inPickedSet,
	LOCAL_CHECK_CLASSES,
	type MeasureParams,
	pickedSetCte,
	sqlString,
	windowStart,
} from "./retro-measure-sql.js";

export const DIGEST_IDS = 3;

export const DIGEST_LIMITS = {
	repeats: 40,
	streams: 5000,
	models: 12,
	links: 2000,
	edits: 200_000,
	sub_spans: 20_000,
	compactions: 20,
} as const;

const kept = (columns: string, select: string, rest: string, limit: number) =>
	`(SELECT (groupArray((${columns})), any(total)) FROM (SELECT ${select}, count() OVER () AS total ${rest} LIMIT ${limit}))`;

export const HOME_SQL = (expr: string) =>
	`replaceRegexpOne(${expr}, '^/(?:Users|home)/[^/]+', '~')`;

const example = (sid: string, aid: string, turn: string) =>
	`concat(${sid}, if(${aid} = '', '', concat(':', ${aid})), '#', toString(${turn}))`;

export const AGENT_LEVEL = "call_level != 'inner'";

export const SLEEP_POLL_RE = String.raw`(^|[;&|(]\s*|\s)sleep\s+[0-9]|\bgh\s+(pr\s+checks|run\s+watch)\b|--watch\b|(^|[;&|(]\s*)(until|while)\s[^\n]*;\s*do\b`;

export const CI_POLL_RE = String.raw`\bgh\s+(pr\s+checks|run\s+(watch|view|list)|pr\s+view\b[^\n|;&]*(statusCheckRollup|checks))`;

export const INLINE_SCRIPT_RE = String.raw`(^|[;&|(]\s*|\s)(python3?|node|bun|deno|ruby|perl|tsx)\s+(-c\s|-e\s|-p\s|--eval\s|-\s*<<|<<)`;

export const SCRIPT_FUNCTION_RE = String.raw`((?:def|function)\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)\n]{0,40}\))`;

export const INTERPRETER_RE = String.raw`\b(python3?|node|bun|deno|ruby|perl|tsx)\b`;

export function digestSessionsSql(params: MeasureParams): string[] {
	const start = windowStart(params);
	const ctes = `WITH ${pickedSetCte(params)},
	main AS (
		SELECT user_id AS uid, session_id AS sid, turn_idx AS turn, source AS src, ifNull(entrypoint, '') AS launcher,
			minutes AS wall_min, active_minutes AS active_min, genuine_prompts AS asked,
			if(interrupt_markers = 0 AND ifNull(aborted, '') = 'true' AND ifNull(abort_reason, '') = 'interrupted', 1, interrupt_markers) AS interrupts,
			ifNull(reasked, false) AS reask
		FROM runs
		WHERE agent_id = '' AND ${inPickedSet()}
	),
	per_session AS (
		SELECT uid, sid, any(src) AS source, argMin(launcher, turn) AS launched_by, min(turn) AS first_turn,
			sum(asked) AS prompts, sum(interrupts) AS interrupts_n, countIf(reask) AS reasks,
			round(sum(wall_min), 1) AS wall, round(sum(active_min), 1) AS active, count() AS main_runs,
			argMax(turn, wall_min) AS longest_turn
		FROM main
		GROUP BY uid, sid
	),
	start_files AS (
		SELECT user_id AS uid, session_id AS sid,
			arraySort(groupUniqArray(concat(kind, ' ', scope, ' ', if(scope = 'member', path, setup_file)))) AS files
		FROM setup_files
		WHERE started_at >= ${start} AND agent_id = '' AND ${inPickedSet()}
			AND kind IN ('instructions', 'agents_md', 'nested_memory', 'skill_body')
			AND (user_id, session_id, turn_idx) IN (SELECT uid, sid, first_turn FROM per_session)
		GROUP BY user_id, session_id
	),
	asked AS (
		SELECT user_id AS uid, session_id AS sid, count() AS genuine_n, countIf(subtype = 'queued') AS queued_n
		FROM prompts
		WHERE at >= ${start} AND genuine = 1 AND agent_id = '' AND ${inPickedSet()}
		GROUP BY user_id, session_id
	),
	repeats AS (
		SELECT uid, sid, said, count() AS times, min(turn) AS first_turn
		FROM (
			SELECT user_id AS uid, session_id AS sid, turn_idx AS turn,
				lowerUTF8(trimBoth(replaceRegexpAll(substring(text, 1, 400), '\\s+', ' '))) AS said
			FROM prompts
			WHERE at >= ${start} AND genuine = 1 AND agent_id = '' AND ${inPickedSet()} AND lengthUTF8(trimBoth(text)) >= 12
		)
		GROUP BY uid, sid, said
		HAVING times >= 2
	),
	streams AS (
		SELECT session_id AS sid, agent_id AS aid, min(turn_idx) AS turn
		FROM runs
		WHERE agent_id != '' AND ${inPickedSet()}
		GROUP BY session_id, agent_id
	),
	models AS (
		SELECT ifNull(model, '') AS key, session_id AS sid, agent_id = '' AS main_stream
		FROM runs
		WHERE ${inPickedSet()}
	)`;
	const streams = kept(
		"sid, aid, turn",
		"sid, aid, turn",
		"FROM streams ORDER BY sid, aid",
		DIGEST_LIMITS.streams,
	);
	const models = kept(
		"key, runs, sessions, main_runs",
		"key, count() AS runs, uniqExact(sid) AS sessions, countIf(main_stream) AS main_runs",
		"FROM models GROUP BY key ORDER BY runs DESC, key",
		DIGEST_LIMITS.models,
	);
	return [
		`${ctes}
	SELECT groupArray((p.sid, p.source, p.launched_by, p.first_turn, p.prompts, p.interrupts_n, p.reasks, p.wall,
		p.active, p.main_runs, a.genuine_n, a.queued_n, f.files, p.longest_turn, p.uid)) AS sessions
	FROM per_session AS p
	LEFT JOIN start_files AS f ON f.uid = p.uid AND f.sid = p.sid
	LEFT JOIN asked AS a ON a.uid = p.uid AND a.sid = p.sid`,
		`${ctes}
	SELECT groupArray((said, times, sid, first_turn)) AS repeats FROM (
		SELECT substring(said, 1, 90) AS said, times, sid, first_turn FROM repeats ORDER BY times DESC, sid, said LIMIT ${DIGEST_LIMITS.repeats})`,
		`${ctes}
	SELECT (SELECT (count(), uniqExact(sid)) FROM repeats) AS repeat_totals,
		tupleElement(${streams}, 1) AS streams, tupleElement(${streams}, 2) AS streams_total,
		tupleElement(${models}, 1) AS models, tupleElement(${models}, 2) AS models_total`,
		`${ctes}
	SELECT (SELECT groupArray((source, fact, n, runs_n)) FROM (
			SELECT source, fact, count() AS n, any(runs_n) AS runs_n
			FROM (SELECT source, arrayJoin(unrecorded_facts) AS fact, count() OVER (PARTITION BY source) AS runs_n FROM runs WHERE ${inPickedSet()})
			GROUP BY source, fact ORDER BY source, fact)) AS unrecorded,
		(SELECT groupArray((source, runs_n)) FROM (SELECT source, count() AS runs_n FROM runs WHERE ${inPickedSet()} GROUP BY source ORDER BY source)) AS runs_by_source`,
		`${ctes}
	SELECT groupArray((kind, from_session_id, to_session_id, from_source, to_source)) AS links, any(total) AS links_total FROM (
		SELECT kind, from_session_id, to_session_id, from_source, to_source, count() OVER () AS total
		FROM session_links
		WHERE ${inPickedSet("", "from_session_id")} OR ${inPickedSet("", "to_session_id")}
		ORDER BY kind, from_session_id, to_session_id LIMIT ${DIGEST_LIMITS.links})`,
	];
}

export const CALL_METRICS = {
	refusals: { order: "n", limit: 6 },
	checks: { order: "w", limit: 6 },
	families: { order: "w", limit: 8 },
	families_n: { order: "n", limit: 5 },
	tools: { order: "w", limit: 5 },
	loops: { order: "w", limit: 6 },
	ci_polls: { order: "w", limit: 1 },
	stopped: { order: "w", limit: 5 },
	routes: { order: "n", limit: 16 },
	edit_basis: { order: "n", limit: 3 },
	inline_all: { order: "n", limit: 1 },
	inline_scripts: { order: "sessions", limit: 5 },
} as const;

export type CallMetric = keyof typeof CALL_METRICS;

const metricList = (order: string) =>
	Object.entries(CALL_METRICS)
		.filter(([, metric]) => metric.order === order)
		.map(([name]) => sqlString(name))
		.join(", ");

const TIMED =
	"toUInt8(call_minutes IS NOT NULL AND NOT (call_level = 'inner' AND call_minutes = 0))";

const tag = (
	when: string,
	metric: CallMetric,
	key: string,
	weight: string,
	failed: string,
	label = "''",
) =>
	`if(${when}, [(${sqlString(metric)}, ${key}, toFloat64(${weight}), toUInt8(${failed}), ${label}, ${TIMED})], [])`;

const HEAD_LABEL = `substring(replaceRegexpAll(ifNull(command_head, tool_name), '\\s+', ' '), 1, 70)`;

export function digestCallsSql(params: MeasureParams, piece = false): string[] {
	const checks = [...LOCAL_CHECK_CLASSES, "install"].map(sqlString).join(", ");
	const shell = "command_from = 'command' AND command_head IS NOT NULL";
	const DENIAL_LABEL = `multiIf(denial_kind IN ('user-rejected', 'Rejected'), 'the person rejected the tool call at its permission prompt', denial_kind = 'permission-rule', 'blocked by a permission rule', denial_kind = 'hook', 'blocked by a hook', denial_kind)`;
	const reason = `if(trimBoth(denial_reason) = '', ${DENIAL_LABEL}, concat(${DENIAL_LABEL}, ': ', substring(replaceRegexpAll(replaceRegexpAll(denial_reason, '\\[[^\\]]*\\]', '[…]'), '\\s+', ' '), 1, 70)))`;
	const loopKey = `multiIf(match(command_head, ${sqlString(String.raw`\bgh\s`)}), 'gh checks/watch',
				match(command_head, ${sqlString(String.raw`(^|[;&|(]\s*)(until|while)\s`)}), 'until/while loop', 'sleep')`;
	const inlineKey = `if(match(command_head, ${sqlString(SCRIPT_FUNCTION_RE)}),
				concat(extract(command_head, ${sqlString(INTERPRETER_RE)}), ': ',
					replaceRegexpAll(extract(command_head, ${sqlString(SCRIPT_FUNCTION_RE)}), '\\s+', ' ')), '')`;
	const inline = `command_from IN ('command', 'script') AND match(command_head, ${sqlString(INLINE_SCRIPT_RE)})`;
	const weight = `if(metric IN (${metricList("w")}), sw, toFloat64(sn))`;
	const ctes = `WITH ${pickedSetCte(params)},
	c AS (
		SELECT session_id AS sid, agent_id AS aid, turn_idx AS turn, call_level, tool_name, failed, denial_kind,
			denial_reason, command_class, command_from, command_head, call_minutes, ifNull(call_minutes, 0) AS mins, timed_out,
			background_status, changed_files, changed_files_basis, edit_route, ${example("session_id", "agent_id", "turn_idx")} AS ex
		FROM calls
		WHERE started_at >= ${windowStart(params)} AND ${inPickedSet()}
	),
	tagged AS (
		SELECT sid, ex, arrayConcat(
			${tag("denial_kind != ''", "refusals", reason, "mins", "1")},
			${tag(`command_from = 'command' AND command_class IN (${checks})`, "checks", "command_class", "mins", "failed")},
			if(${shell}, arrayMap(family -> ('families', family, toFloat64(mins), toUInt8(failed), ${HEAD_LABEL}, ${TIMED}), ${commandFamiliesSql("command_head")}), []),
			if(${shell}, arrayMap(family -> ('families_n', family, toFloat64(mins), toUInt8(failed), ${HEAD_LABEL}, ${TIMED}), ${commandFamiliesSql("command_head")}), []),
			${tag(`${shell} AND match(command_head, ${sqlString(SLEEP_POLL_RE)})`, "loops", loopKey, "mins", "failed", HEAD_LABEL)},
			${tag("tool_name IN ('sleep', 'wait', 'wait_agent')", "loops", "concat(tool_name, ' tool')", "mins", "failed")},
			${tag(AGENT_LEVEL, "tools", "if(command_from = 'script', concat(tool_name, ' (script)'), tool_name)", "mins", "failed")},
			${tag(`${shell} AND match(command_head, ${sqlString(CI_POLL_RE)})`, "ci_polls", "'gh CI status'", "mins", "failed", HEAD_LABEL)},
			${tag("ifNull(timed_out, 0) = 1 OR background_status IN ('killed', 'stopped')", "stopped", "if(ifNull(timed_out, 0) = 1, 'timed out', concat('background ', ifNull(background_status, '')))", "mins", "1", HEAD_LABEL)},
			${tag("edit_route != '' AND failed = 0", "routes", "edit_route", "length(changed_files)", "0", HEAD_LABEL)},
			if(edit_route != '' AND failed = 0, arrayMap(basis -> ('edit_basis', basis, toFloat64(countEqual(changed_files_basis, basis)), toUInt8(0), '', ${TIMED}), arrayDistinct(changed_files_basis)), []),
			${tag(inline, "inline_all", "''", "mins", "failed")},
			${tag(`${inline} AND match(command_head, ${sqlString(SCRIPT_FUNCTION_RE)})`, "inline_scripts", inlineKey, "mins", "failed")}
		) AS tags
		FROM c
	),
	items AS (
		SELECT t.1 AS metric, t.2 AS key, t.3 AS w, t.4 AS f, t.5 AS label, t.6 AS timed, sid, ex
		FROM tagged ARRAY JOIN tags AS t
	),
	per_session AS (
		SELECT metric, key, sid, count() AS sn, sum(f) AS sf, sum(w) AS sw, sum(timed) AS st,
			argMax(ex, (w, ex)) AS sex, argMax(label, (w, ex)) AS slabel
		FROM items
		GROUP BY metric, key, sid
	),
	grouped AS (
		${
			piece
				? `SELECT metric, key, sum(sn) AS n, sum(sf) AS f, sum(sw) AS w, count() AS sessions, sum(st) AS timed,
			arraySlice(arrayReverseSort(groupArray((${weight}, sn, sf, sid))), 1, ${DIGEST_IDS}) AS ids,
			argMax((sex, slabel), (${weight}, sn, sid)) AS lead, max((${weight}, sn, sid)) AS lead_key`
				: `SELECT metric, key, sum(sn) AS n, sum(sf) AS f, round(sum(sw), 1) AS w, count() AS sessions, sum(st) AS timed,
			arraySlice(arrayMap(x -> x.4, arrayReverseSort(x -> (x.1, x.2, x.3, x.4),
				groupArray((${weight}, sn, sf, sid)))), 1, ${DIGEST_IDS}) AS ids,
			argMax(sex, (${weight}, sn, sid)) AS ex,
			argMax(slabel, (${weight}, sn, sid)) AS label`
		}
		FROM per_session
		GROUP BY metric, key
	),
	limited AS (
		SELECT *, count() OVER (PARTITION BY metric) AS keys FROM grouped${
			piece
				? ""
				: `
		WHERE metric != 'inline_scripts' OR sessions >= 3
		ORDER BY metric, multiIf(metric IN (${metricList("w")}), w, metric IN (${metricList("sessions")}), toFloat64(sessions), toFloat64(n)) DESC, n DESC, key
		LIMIT ${Math.max(...Object.values(CALL_METRICS).map((metric) => metric.limit))} BY metric`
		}
	),
	push_events AS (
		SELECT session_id AS sid, evidence_id AS evidence
		FROM git_events
		WHERE kind = 'push_range' AND at >= ${windowStart(params)} AND ${inPickedSet()}
	),
	pushed AS (
		SELECT DISTINCT evidence_id AS evidence, to_id AS commit_id
		FROM edges
		WHERE relation = 'commit_pushed' AND from_kind = 'run' AND ${inPickedSet()}
	),
	ci AS (
		SELECT DISTINCT from_id AS commit_id, to_id AS ci_run
		FROM edges
		WHERE relation = 'ci_on_sha' AND from_kind = 'commit' AND to_kind = 'ci_run'
			AND from_id IN (SELECT commit_id FROM pushed)
	),
	jobs AS (
		SELECT ci_run_id AS ci_run, countIf(conclusion = 'failure' OR conclusion = 'timed_out') AS failed_jobs
		FROM ci_jobs
		WHERE ci_run_id IN (SELECT ci_run FROM ci)
		GROUP BY ci_run_id
	),
	push_ci AS (
		SELECT pd.evidence AS evidence, sum(j.failed_jobs) AS failed_jobs
		FROM pushed AS pd
		INNER JOIN ci AS r ON r.commit_id = pd.commit_id
		INNER JOIN jobs AS j ON j.ci_run = r.ci_run
		GROUP BY pd.evidence
	)`;
	return [
		`${ctes}
	SELECT groupArray((metric, rows, keys)) AS ranked FROM (
		SELECT metric, groupArray((key, n, f, w, sessions, ids, ${piece ? "lead, lead_key" : "ex, label"}, timed)) AS rows, any(keys) AS keys
		FROM limited GROUP BY metric)`,
		`${ctes}
	SELECT (countIf(${AGENT_LEVEL}), countIf(${AGENT_LEVEL} AND failed = 1),
		countIf(${AGENT_LEVEL} AND aid = ''), countIf(${AGENT_LEVEL} AND aid = '' AND failed = 1),
		countIf(call_level = 'inner'), countIf(call_level = 'inner' AND failed = 1),
		uniqExactIf(sid, ${AGENT_LEVEL} AND failed = 1), countIf(call_level = 'inner' AND ${TIMED} = 1)) AS share
	FROM c`,
		`${ctes}
	SELECT (count(), uniqExact(p.sid), countIf(f.evidence != ''), countIf(f.failed_jobs > 0)) AS push_stats
	FROM push_events AS p
	LEFT JOIN push_ci AS f ON f.evidence = p.evidence`,
	];
}

export function digestEditsSql(params: MeasureParams): string {
	return `WITH ${pickedSetCte(params)},
	run_dirs AS (
		SELECT run_id, ifNull(cwd, '') AS run_cwd FROM runs WHERE ${inPickedSet()}
	),
	edits AS (
		SELECT e.session_id AS sid, e.agent_id AS aid, e.turn_idx AS turn, toUnixTimestamp64Milli(e.started_at) AS at,
			e.changed_files AS files, e.changed_file_ops AS ops, r.run_cwd AS run_cwd
		FROM calls AS e
		LEFT JOIN run_dirs AS r ON r.run_id = e.run_id
		WHERE e.started_at >= ${windowStart(params)} AND ${inPickedSet("e")} AND notEmpty(e.changed_files) AND e.failed = 0
	)
	SELECT groupArray((sid, aid, turn, at, files, ops, run_cwd)) AS edits, any(total) AS edits_total
	FROM (SELECT *, count() OVER () AS total FROM edits ORDER BY sid, at, aid LIMIT ${DIGEST_LIMITS.edits})`;
}

export function digestUsageSql(params: MeasureParams): string[] {
	const ctes = `WITH ${pickedSetCte(params)},
	children AS (
		SELECT user_id AS uid, from_session_id AS parent, to_session_id AS child
		FROM session_links
		WHERE kind = 'parent_thread' AND ${inPickedSet("", "from_session_id")}
	),
	streams AS (
		SELECT session_id AS sid, agent_id AS aid, source, turn_idx AS turn, tokens, cost_usd, compactions, compact_trigger,
			toUnixTimestamp64Milli(started_at) AS t0, toUnixTimestamp64Milli(ended_at) AS t1
		FROM runs
		WHERE ${inPickedSet()}
		UNION ALL
		SELECT c.parent AS sid, concat('thread ', r.session_id) AS aid, r.source, r.turn_idx AS turn, r.tokens, r.cost_usd,
			r.compactions, r.compact_trigger, toUnixTimestamp64Milli(r.started_at) AS t0, toUnixTimestamp64Milli(r.ended_at) AS t1
		FROM runs AS r
		INNER JOIN children AS c ON c.uid = r.user_id AND c.child = r.session_id
	)`;
	return [
		`${ctes}
	SELECT groupArray((sid, runs, tokens_sum, cost_sum, unpriced, unknown_tokens, top_turn)) AS per_session FROM (
		SELECT sid, count() AS runs, sum(ifNull(tokens, 0)) AS tokens_sum, round(sum(ifNull(cost_usd, 0)), 2) AS cost_sum,
			countIf(cost_usd IS NULL AND ifNull(tokens, 0) > 0) AS unpriced, countIf(tokens IS NULL) AS unknown_tokens,
			argMax(if(aid = '', toString(turn), ''), ifNull(tokens, 0)) AS top_turn
		FROM streams GROUP BY sid)`,
		`${ctes}
	SELECT groupArray((sid, aid, t0, t1)) AS sub_spans, any(total) AS sub_spans_total FROM (
		SELECT sid, aid, min(t0) AS t0, max(t1) AS t1, count() OVER () AS total FROM streams WHERE aid != '' GROUP BY sid, aid ORDER BY sid, aid LIMIT ${DIGEST_LIMITS.sub_spans})`,
		`${ctes}
	SELECT groupArray((source, main_stream, trigger, n, sessions, ex)) AS compactions, any(total) AS compactions_total FROM (
		SELECT e.source AS source, e.agent_id = '' AS main_stream, ifNull(r.compact_trigger, '') AS trigger, count() AS n,
			uniqExact(e.session_id) AS sessions,
			min(${example("e.session_id", "e.agent_id", "e.turn_idx")}) AS ex, count() OVER () AS total
		FROM events AS e
		LEFT JOIN (SELECT run_id, compact_trigger FROM runs WHERE ${inPickedSet()}) AS r ON r.run_id = e.run_id
		WHERE e.at >= ${windowStart(params)} AND e.event = 'compaction' AND e.subtype != 'compact_summary' AND ${inPickedSet("e")}
		GROUP BY source, main_stream, trigger ORDER BY n DESC, source LIMIT ${DIGEST_LIMITS.compactions})`,
	];
}

export interface CohortScope {
	readonly workspaceId: string;
	readonly users: readonly string[];
	readonly sessions: readonly string[];
}

export interface TrustedStatement {
	readonly query: string;
	readonly query_params: Record<string, unknown>;
}

const OWNED = `organization_id = {ws:String} AND session_id IN {ids:Array(String)}
			AND has(arrayZip({users:Array(String)}, {ids:Array(String)}), (user_id, session_id))`;

const ownedParams = (scope: CohortScope) => ({
	ws: scope.workspaceId,
	ids: [...scope.sessions],
	users: [...scope.users],
});

export function startDirsStatement(scope: CohortScope): TrustedStatement {
	return {
		query: `SELECT session_id, argMax(project_path, ingested_at) AS start_dir
		FROM ${getSafeClickHouseTable("rudel.session_analytics")}
		WHERE ${OWNED}
		GROUP BY user_id, session_id
		ORDER BY session_id`,
		query_params: ownedParams(scope),
	};
}

export function contextSizesStatement(scope: CohortScope): TrustedStatement {
	const usage = getSafeClickHouseTable("rudel.usage_events");
	return {
		query: `WITH ev AS (
			SELECT source, agent_id = 'main' AS main_stream, session_id, context_input_tokens AS size
			FROM ${usage} FINAL
			WHERE ${OWNED} AND record_kind = 'event' AND is_deleted = 0
				AND NOT (identity_kind = 'transition' AND (user_id, session_id) IN (
					SELECT user_id, session_id FROM ${usage} FINAL
					WHERE ${OWNED} AND record_kind = 'event' AND is_deleted = 0 AND identity_kind = 'response_id'))
		),
		q AS (SELECT source, main_stream, quantileExact(0.9)(size) AS p90 FROM ev WHERE size > 0 GROUP BY source, main_stream),
		per AS (
			SELECT e.source AS source, e.main_stream AS main_stream, e.session_id AS session_id, count() AS n,
				countIf(e.size = 0) AS unrecorded_n, groupArrayIf(e.size, e.size > 0) AS sizes, max(e.size) AS top,
				countIf(e.size > 0 AND e.size > q.p90) AS above, any(q.p90) AS p90
			FROM ev AS e
			LEFT JOIN q ON q.source = e.source AND q.main_stream = e.main_stream
			GROUP BY source, main_stream, session_id
		)
		SELECT source, main_stream, sum(n) AS requests, sum(unrecorded_n) AS unrecorded,
			quantilesExactArray(0.5, 0.9, 0.99)(sizes) AS q, max(top) AS largest, any(p90) AS p90,
			sum(above) AS above_p90, countIf(above > 0) AS sessions_above,
			arraySlice(arrayMap(x -> x.3, arrayReverseSort(x -> (x.1, x.2, x.3), groupArrayIf((above, top, session_id), above > 0))), 1, ${DIGEST_IDS}) AS ids
		FROM per
		GROUP BY source, main_stream
		ORDER BY source, main_stream DESC`,
		query_params: ownedParams(scope),
	};
}

export const CATEGORY_FAILURE = `denial_kind != '' OR ifNull(timed_out, 0) = 1 OR background_status IN ('killed', 'stopped')
				OR command_class IN (${[...LOCAL_CHECK_CLASSES, "install"].map(sqlString).join(", ")})`;

export function digestRunsSql(params: MeasureParams): string[] {
	const start = windowStart(params);
	const ctes = `WITH ${pickedSetCte(params)},
	failures AS (
		SELECT run_id, countIf(failed = 1) AS failed_n, countIf(failed = 1 AND (${CATEGORY_FAILURE})) AS sorted_n
		FROM calls
		WHERE started_at >= ${start} AND ${inPickedSet()} AND ${AGENT_LEVEL}
		GROUP BY run_id
	),
	asked AS (
		SELECT run_id, argMin(substring(replaceRegexpAll(text, '\\s+', ' '), 1, 90), record_idx) AS quote,
			argMin(text_chars, record_idx) AS chars, argMin(subtype, record_idx) AS kind_of
		FROM prompts
		WHERE at >= ${start} AND genuine = 1 AND ${inPickedSet()}
		GROUP BY run_id
	)`;
	return [
		`${ctes}
	SELECT groupArray((run_id, session_id, agent_id, turn_idx, round(minutes, 2), round(active_minutes, 2),
		toUInt8(ifNull(frustrated, false)), toUInt8(ifNull(reasked, false)))) AS runs
	FROM (SELECT * FROM runs WHERE ${inPickedSet()} ORDER BY session_id, agent_id, turn_idx)`,
		`${ctes}
	SELECT groupArray((run_id, failed_n, sorted_n)) AS failures FROM failures`,
		`${ctes}
	SELECT groupArray((run_id, quote, chars, kind_of)) AS asked FROM asked`,
	];
}

export interface SeverityRule {
	readonly category: "destructive" | "production" | "secrets" | "lost_work";
	readonly rule: string;
	readonly when: string;
	readonly quote: "command" | "file" | "none";
	readonly focus?: string;
}

export function focusPattern(pattern: string): string {
	const body = pattern.startsWith("(?i)")
		? `(?i:${pattern.slice(4)})`
		: `(?:${pattern})`;
	return `(.{0,12}${body}.{0,45})`;
}

const cmd = "cmd";
const SEARCH_ONLY = String.raw`^\s*(cd\s+[^;&|]+(&&|;)\s*)?(grep|rg|ag|git\s+grep|git\s+log|echo|printf)\b`;
const shellCmd = (pattern: string, extra = "") =>
	`command_from = 'command' AND match(${cmd}, ${sqlString(pattern)}) AND NOT match(${cmd}, ${sqlString(SEARCH_ONLY)})${extra ? ` AND ${extra}` : ""}`;

export const DB_CLIENT_RE = String.raw`(?i)\b(psql|mysql|mariadb|sqlite3|clickhouse(-client)?|duckdb|snowsql|cqlsh|bq\s+query)\b|--query\b|\bquery=|\bcurl\b[^\n]*(--data|-d\s)`;

export const TMP_TARGET_RE = String.raw`^["']?(/tmp|/private/tmp|/private/var/folders|/var/folders|\$\{?TMPDIR|\$\{?TMP\b|\$\{?tmp)`;

export const SECRET_RE = String.raw`(sk-(proj-|ant-)?[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})`;

export const SEVERITY_RULES: readonly SeverityRule[] = [
	{
		category: "destructive",
		rule: "rm -rf outside /tmp",
		when: shellCmd(
			String.raw`(^|[;&|(\s])rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*|-r\s+-f|-f\s+-r)\s`,
			`NOT match(extract(${cmd}, ${sqlString(String.raw`rm\s+-[a-zA-Z]+\s+(?:-[a-zA-Z]+\s+)*([^\s;&|)]+)`)}), ${sqlString(TMP_TARGET_RE)})`,
		),
		quote: "command",
		focus: String.raw`(^|[;&|(\s])rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*|-r\s+-f|-f\s+-r)\s`,
	},
	{
		category: "destructive",
		rule: "git push --force",
		when: shellCmd(
			String.raw`\bgit\s+push\b[^;&|\n]*\s(--force|--force-with-lease|-f)(\s|=|$)`,
		),
		quote: "command",
		focus: String.raw`\bgit\s+push\b[^;&|\n]*\s(--force|--force-with-lease|-f)(\s|=|$)`,
	},
	{
		category: "destructive",
		rule: "git reset --hard",
		when: shellCmd(String.raw`\bgit\s+reset\s[^;&|\n]*--hard\b`),
		quote: "command",
		focus: String.raw`\bgit\s+reset\s[^;&|\n]*--hard\b`,
	},
	{
		category: "destructive",
		rule: "git clean -fd",
		when: shellCmd(
			String.raw`\bgit\s+clean\s+-[a-zA-Z]*(f[a-zA-Z]*d|d[a-zA-Z]*f)`,
		),
		quote: "command",
		focus: String.raw`\bgit\s+clean\s+-[a-zA-Z]*(f[a-zA-Z]*d|d[a-zA-Z]*f)`,
	},
	{
		category: "destructive",
		rule: "SQL DROP/TRUNCATE",
		when: shellCmd(
			String.raw`(?i)\b(DROP\s+(TABLE|DATABASE|SCHEMA|VIEW)|TRUNCATE\s+(TABLE\s+)?[A-Za-z_"\x60])`,
			`match(${cmd}, ${sqlString(DB_CLIENT_RE)})`,
		),
		quote: "command",
		focus: String.raw`(?i)\b(DROP\s+(TABLE|DATABASE|SCHEMA|VIEW)|TRUNCATE\s+(TABLE\s+)?[A-Za-z_"\x60])`,
	},
	{
		category: "destructive",
		rule: "SQL DELETE without WHERE",
		when: shellCmd(
			String.raw`(?i)\bDELETE\s+FROM\s+[A-Za-z_."\x60]+`,
			`match(${cmd}, ${sqlString(DB_CLIENT_RE)}) AND NOT match(${cmd}, ${sqlString(String.raw`(?i)\bDELETE\s+FROM\s+[^;]*\bWHERE\b`)})`,
		),
		quote: "command",
		focus: String.raw`(?i)\bDELETE\s+FROM\s+[A-Za-z_."\x60]+`,
	},
	{
		category: "production",
		rule: "deploy or publish command",
		when: shellCmd(
			String.raw`(?i)\b(vercel\s+(deploy\s+)?--prod|vercel\s+promote|fly(ctl)?\s+deploy|kubectl\s+(apply|delete|rollout)|terraform\s+(apply|destroy)|helm\s+(upgrade|install)|wrangler\s+(deploy|publish)|(npm|pnpm|bun|yarn|cargo)\s+publish|gh\s+release\s+create|firebase\s+deploy|serverless\s+deploy)\b`,
		),
		quote: "command",
		focus: String.raw`(?i)\b(vercel\s+(deploy\s+)?--prod|vercel\s+promote|fly(ctl)?\s+deploy|kubectl\s+(apply|delete|rollout)|terraform\s+(apply|destroy)|helm\s+(upgrade|install)|wrangler\s+(deploy|publish)|(npm|pnpm|bun|yarn|cargo)\s+publish|gh\s+release\s+create|firebase\s+deploy|serverless\s+deploy)\b`,
	},
	{
		category: "production",
		rule: "write naming a prod target",
		when: shellCmd(
			String.raw`(?i)(--prod(uction)?\b|\b(prod|prd|production)[_.-]?(db|env|database|cluster|host|server|url)\b|\b(prod|prd|production)[_-][a-z0-9_]*\.env\b|\b(prod|production)\.[a-z0-9-]+\.[a-z]{2,})`,
			`match(${cmd}, ${sqlString(String.raw`(?i)\b(INSERT\s+INTO|UPDATE\s+[A-Za-z_."]+\s+SET|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+|TRUNCATE|migrate|deploy|apply|publish)\b`)})`,
		),
		quote: "command",
		focus: String.raw`(?i)(--prod(uction)?\b|\b(prod|prd|production)[_.-]?(db|env|database|cluster|host|server|url)\b|\b(prod|prd|production)[_-][a-z0-9_]*\.env\b|\b(prod|production)\.[a-z0-9-]+\.[a-z]{2,})`,
	},
	{
		category: "secrets",
		rule: "secret-looking string in a command",
		when: `${cmd} != '' AND match(${cmd}, ${sqlString(SECRET_RE)})`,
		quote: "none",
	},
	{
		category: "secrets",
		rule: "secret-looking string in output",
		when: `match(output, ${sqlString(SECRET_RE)})`,
		quote: "none",
	},
	{
		category: "secrets",
		rule: ".env file read",
		when: `(file_op = 'read' AND match(file_path, ${sqlString(String.raw`(^|/)[A-Za-z0-9_.-]*\.env(\.[A-Za-z0-9_-]+)?$`)})) OR ${shellCmd(String.raw`(\b(cat|less|more|head|tail|bat|source)\s+|(^|[;&|(\s])\.\s+)[^\s;&|]*\.env(\.[A-Za-z0-9_-]+)?(\s|$|[;&|)])`)}`,
		quote: "file",
	},
	{
		category: "lost_work",
		rule: "git checkout -- / git restore",
		when: `${shellCmd(String.raw`\bgit\s+(checkout\s+([^\s;&|]+\s+)?--\s+[^\s;&|]|restore\s)`)} AND NOT match(${cmd}, ${sqlString(String.raw`\bgit\s+restore\s+--staged\b`)})`,
		quote: "command",
		focus: String.raw`\bgit\s+(checkout\s+([^\s;&|]+\s+)?--\s+[^\s;&|]|restore\s)`,
	},
	{
		category: "lost_work",
		rule: "git revert or stash drop",
		when: shellCmd(String.raw`\bgit\s+(revert\b|stash\s+(drop|clear)\b)`),
		quote: "command",
		focus: String.raw`\bgit\s+(revert\b|stash\s+(drop|clear)\b)`,
	},
];

export const SEVERITY_EXAMPLES = 50;

export const SEVERITY_SHARD_DAYS = 7;

export function digestSeveritySql(params: MeasureParams): string[] {
	const reads = (rule: SeverityRule) => rule.when.includes("output");
	return [
		SEVERITY_RULES.filter((rule) => !reads(rule)),
		SEVERITY_RULES.filter(reads),
	].map((rules) => severitySql(params, rules));
}

function severitySql(
	params: MeasureParams,
	rules: readonly SeverityRule[],
): string {
	const tags = rules
		.map(
			(rule) =>
				`if(${rule.when}, [(${sqlString(rule.category)}, ${sqlString(rule.rule)}, ${rule.focus ? `extract(${cmd}, ${sqlString(focusPattern(rule.focus))})` : sqlString(rule.quote)})], [])`,
		)
		.join(",\n\t\t\t");
	return `WITH ${pickedSetCte(params)},
	c AS (
		SELECT session_id AS sid, ${example("session_id", "agent_id", "turn_idx")} AS ex, command_from,
			ifNull(command, ifNull(command_head, '')) AS ${cmd}, file_path, file_op,
			if(call_level = 'inner', '', output) AS output, tool_name
		FROM calls
		WHERE started_at >= ${windowStart(params)} AND ${inPickedSet()}
	),
	hits AS (
		SELECT t.1 AS category, t.2 AS rule, sid, ex,
			replaceRegexpAll(multiIf(t.3 = 'command', substring(${cmd}, 1, 70), t.3 = 'file', if(file_path != '', file_path, substring(${cmd}, 1, 70)), t.3 = 'none', if(tool_name = '', 'call', tool_name), t.3), '\\s+', ' ') AS quote
		FROM c ARRAY JOIN arrayConcat(${tags}) AS t
	)
	SELECT groupArray((category, rule, n, sessions, examples)) AS severity FROM (
		SELECT category, rule, count() AS n, uniqExact(sid) AS sessions,
			arraySlice(arraySort(groupArray((ex, quote))), 1, ${SEVERITY_EXAMPLES}) AS examples
		FROM hits GROUP BY category, rule ORDER BY category, rule)`;
}
