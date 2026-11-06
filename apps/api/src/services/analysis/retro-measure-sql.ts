import { LANGUAGE_SIGNAL_RULES } from "@rudel/language-signals";
import { commandFamiliesSql } from "./command-identity.js";
import { nativeEditToolSql } from "./tool-groups.js";

export interface MeasureParams {
	readonly from: string;
	readonly to: string;
	readonly repository?: string;
	readonly latest?: number;
	readonly sessions?: readonly string[];
	readonly limit: number;
}

export function sqlString(value: string): string {
	return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function day(value: string): string {
	return `toDateTime64(${sqlString(`${value} 00:00:00`)}, 3, 'UTC')`;
}

function nextDay(value: string): string {
	return new Date(Date.parse(`${value}T00:00:00Z`) + 86_400_000)
		.toISOString()
		.slice(0, 10);
}

export function windowStart(params: MeasureParams): string {
	return day(params.from);
}

export function windowEnd(params: MeasureParams): string {
	return day(nextDay(params.to));
}

export function pickedCte(params: MeasureParams): string {
	const repository = params.repository
		? `\n\t\t\tAND (repository = ${sqlString(params.repository)} OR endsWith(repository, ${sqlString(`/${params.repository}`)}))`
		: "";
	const listed = params.sessions?.length
		? `\n\t\t\tAND session_id IN (${params.sessions.map(sqlString).join(", ")})`
		: "";
	return `picked AS (
		SELECT user_id, session_id, min(started_at) AS session_start,
			argMin(ifNull(cwd, ''), started_at) AS session_cwd, any(repository) AS session_repository
		FROM runs
		WHERE agent_id = '' AND ifNull(thread_source, '') != 'subagent'${repository}${listed}
		GROUP BY user_id, session_id
		HAVING session_start >= ${windowStart(params)} AND session_start < ${windowEnd(params)}
		ORDER BY session_start DESC, session_id${params.latest ? `\n\t\tLIMIT ${params.latest}` : ""})`;
}

export function inPicked(alias = ""): string {
	const prefix = alias ? `${alias}.` : "";
	return `(${prefix}user_id, ${prefix}session_id) IN (SELECT user_id, session_id FROM picked)`;
}

const PICKED_SET = "picked_set";

export function pickedSetCte(params: MeasureParams): string {
	return `${pickedCte(params)},
	(SELECT groupUniqArray((user_id, session_id)) FROM picked) AS ${PICKED_SET}`;
}

export function inPickedSet(alias = "", session = "session_id"): string {
	const prefix = alias ? `${alias}.` : "";
	return `(${prefix}user_id, ${prefix}${session}) IN (SELECT arrayJoin(${PICKED_SET}))`;
}

export function callsIn(params: MeasureParams, where: string): string {
	return `FROM calls
		WHERE started_at >= ${windowStart(params)} AND ${where}
			AND ${inPicked()}`;
}

export function cohortSql(params: MeasureParams): string {
	return `WITH ${pickedCte(params)},
	totals AS (
		SELECT user_id AS uid, session_id AS sid, count() AS runs_n,
			countIf(agent_id = '') AS main_runs, sum(active_minutes) AS active, sum(cost_usd) AS spent,
			countIf(cost_usd IS NULL) AS unpriced, countIf(reasked) AS reasks, countIf(frustrated) AS unhappy
		FROM runs WHERE ${inPicked()}
		GROUP BY user_id, session_id
	)
	SELECT p.session_id AS session_id, '' AS agent_id, toUInt32(1) AS turn_idx,
		p.session_start AS session_start, p.session_repository AS repository,
		t.runs_n AS runs, t.main_runs AS main_runs, round(t.active, 1) AS active_time,
		round(t.spent, 2) AS cost, t.unpriced AS unpriced_runs, t.reasks AS re_asks, t.unhappy AS frustration
	FROM picked AS p
	LEFT JOIN totals AS t ON t.uid = p.user_id AND t.sid = p.session_id
	ORDER BY p.session_start DESC, p.session_id
	LIMIT ${params.limit}`;
}

export const FAILURE_KIND = `multiIf(
			denial_kind != '', 'refused',
			ifNull(interrupted, 0) = 1, 'interrupted',
			ifNull(timed_out, 0) = 1, 'timed_out',
			command_argv0 IN ('grep', 'rg', 'find', 'fd', 'ls', 'test', 'which', 'pgrep', 'diff', 'cmp') AND exit_code = 1, 'probe',
			command_class IN ('test', 'typecheck', 'lint', 'build'), 'validation',
			command_class IN ('install', 'migrate'), 'environment',
			command_class = 'git', 'git',
			command_from != '', 'command',
			'tool')`;
export const FAILURE_CAUSE = `multiIf(
			denial_kind != '', concat(tool_name, ': ', denial_kind),
			command_class NOT IN ('', 'other'), concat(command_class, ': ', ifNull(command_argv0, '?')),
			command_argv0 IS NOT NULL, command_argv0,
			command_from = 'script', 'code-mode script',
			tool_name)`;

export const FAILURE_KINDS = [
	"refused: a hook, rule or person refused the call before it ran",
	"interrupted: the person stopped it",
	"timed_out: the call's own timeout stopped it",
	"probe: grep, rg, find, ls, test, which, pgrep, diff or cmp exiting 1 (usually no match, the expected answer)",
	"validation: a test, typecheck, lint or build command failed",
	"environment: an install or migrate command failed",
	"git: a git command failed",
	"command: any other shell command or code-mode script",
	"tool: any other tool",
] as const;

export function timeLostByCauseSql(params: MeasureParams): string {
	return `WITH ${pickedCte(params)},
	failed_calls AS (
		SELECT run_id, user_id AS uid, session_id AS sid, agent_id AS aid, turn_idx AS turn, call_minutes AS minutes,
			${FAILURE_KIND} AS failure_kind,
			${FAILURE_CAUSE} AS failure_cause
		${callsIn(params, "failed = 1")}
	),
	per_run AS (
		SELECT failure_kind, failure_cause, run_id, any(uid) AS member, any(sid) AS run_sid, any(aid) AS run_aid,
			any(turn) AS run_turn, count() AS calls_n, sum(minutes) AS call_min
		FROM failed_calls
		GROUP BY failure_kind, failure_cause, run_id
	),
	run_time AS (SELECT run_id, active_minutes FROM runs WHERE ${inPicked()})
	SELECT failure_kind AS kind, failure_cause AS cause, failed_calls, runs, sessions, members,
		group_run_time, group_call_time, ex_sid AS session_id, ex_aid AS agent_id, ex_turn AS turn_idx
	FROM (
		SELECT g.failure_kind AS failure_kind, g.failure_cause AS failure_cause, sum(g.calls_n) AS failed_calls,
			count() AS runs, uniqExact(g.run_sid) AS sessions, uniqExact(g.member) AS members,
			round(sum(r.active_minutes), 1) AS group_run_time, round(sum(g.call_min), 1) AS group_call_time,
			argMax(g.run_sid, (g.calls_n, g.run_id)) AS ex_sid, argMax(g.run_aid, (g.calls_n, g.run_id)) AS ex_aid,
			argMax(g.run_turn, (g.calls_n, g.run_id)) AS ex_turn
		FROM per_run AS g
		LEFT JOIN run_time AS r ON r.run_id = g.run_id
		GROUP BY g.failure_kind, g.failure_cause
	)
	ORDER BY group_run_time DESC, failed_calls DESC, kind, cause
	LIMIT ${params.limit}`;
}

export const COMMAND_VARIANTS = 5;

export function repeatedCommandsSql(params: MeasureParams): string {
	return `WITH ${pickedCte(params)},
	family_calls AS (
		SELECT arrayJoin(${commandFamiliesSql("command_head")}) AS family, call_id, user_id, session_id, agent_id, turn_idx,
			failed, ifNull(call_minutes, 0) AS minutes, ifNull(command_fingerprint, cityHash64(command_head)) AS fingerprint,
			substring(replaceRegexpAll(command_head, '\\s+', ' '), 1, 120) AS text
		${callsIn(params, "command_from = 'command' AND command_head IS NOT NULL")}
	),
	variants AS (
		SELECT family, fingerprint, count() AS calls_n, countIf(failed = 1) AS failed_n, sum(minutes) AS minutes_n,
			groupUniqArray(session_id) AS variant_sessions, groupUniqArray(user_id) AS variant_members,
			argMax(text, (minutes, call_id)) AS variant_text,
			argMax((minutes, text, session_id, agent_id, turn_idx), (minutes, call_id)) AS slowest
		FROM family_calls
		GROUP BY family, fingerprint
	)
	SELECT family, family_calls_n AS calls, family_failed_n AS failed, group_call_time, sessions, members, variants,
		tupleElement(ex, 2) AS example, tupleElement(ex, 3) AS session_id,
		tupleElement(ex, 4) AS agent_id, tupleElement(ex, 5) AS turn_idx
	FROM (
		SELECT family, sum(calls_n) AS family_calls_n, sum(failed_n) AS family_failed_n, round(sum(minutes_n), 1) AS group_call_time,
			length(arrayDistinct(arrayFlatten(groupArray(variant_sessions)))) AS sessions,
			length(arrayDistinct(arrayFlatten(groupArray(variant_members)))) AS members,
			arrayMap(v -> concat(toString(tupleElement(v, 1)), '× ', tupleElement(v, 2)),
				arraySlice(arrayReverseSort(v -> tupleElement(v, 1), groupArray((calls_n, variant_text))), 1, ${COMMAND_VARIANTS})) AS variants,
			argMax(slowest, tupleElement(slowest, 1)) AS ex
		FROM variants
		GROUP BY family
		HAVING family_calls_n >= 2
	)
	ORDER BY calls DESC, group_call_time DESC, family
	LIMIT ${params.limit}`;
}

export const LOCAL_CHECK_CLASSES = ["test", "typecheck", "lint", "build"];

export function localPassCtes(params: MeasureParams): string {
	const classes = LOCAL_CHECK_CLASSES.map(sqlString).join(", ");
	return `${pickedCte(params)},
	local_passes AS (
		SELECT user_id AS uid, session_id AS sid, started_at AS passed_at, command_class AS check_class
		${callsIn(params, `command_class IN (${classes}) AND has_result = 1 AND failed = 0 AND denial_kind = ''`)}
	),
	pushes AS (
		SELECT user_id AS uid, session_id AS sid, agent_id AS aid, turn_idx AS turn, run_id AS rid,
			at AS pushed_at, evidence_id AS evidence, push_to_sha AS sha, branch AS pushed_branch
		FROM git_events
		WHERE kind = 'push_range' AND at >= ${windowStart(params)} AND ${inPicked()}
	),
	pushed AS (
		SELECT DISTINCT user_id AS uid, session_id AS sid, evidence_id AS evidence, to_id AS commit_id
		FROM edges
		WHERE relation = 'commit_pushed' AND from_kind = 'run' AND ${inPicked()}
	),
	ci AS (
		SELECT DISTINCT from_id AS commit_id, to_id AS ci_run
		FROM edges
		WHERE relation = 'ci_on_sha' AND from_kind = 'commit' AND to_kind = 'ci_run'
			AND from_id IN (SELECT commit_id FROM pushed)
	),
	jobs AS (
		SELECT ci_run_id AS ci_run, countIf(conclusion = 'failure' OR conclusion = 'timed_out') AS failed_jobs,
			countIf(conclusion IS NULL) AS pending_jobs, count() AS jobs_n,
			groupUniqArrayIf(name, conclusion = 'failure' OR conclusion = 'timed_out') AS failed_names
		FROM ci_jobs
		WHERE ci_run_id IN (SELECT ci_run FROM ci)
		GROUP BY ci_run_id
	),
	push_ci AS (
		SELECT pd.uid AS uid, pd.sid AS sid, pd.evidence AS evidence, uniqExact(c.ci_run) AS ci_runs,
			sum(j.failed_jobs) AS failed_jobs, sum(j.pending_jobs) AS pending_jobs, sum(j.jobs_n) AS jobs,
			arrayDistinct(arrayFlatten(groupArray(j.failed_names))) AS failed_job_names
		FROM pushed AS pd
		INNER JOIN ci AS c ON c.commit_id = pd.commit_id
		INNER JOIN jobs AS j ON j.ci_run = c.ci_run
		GROUP BY pd.uid, pd.sid, pd.evidence
	),
	before_push AS (
		SELECT p.uid AS uid, p.sid AS sid, p.evidence AS evidence, count() AS passes,
			argMax(l.check_class, l.passed_at) AS last_check
		FROM pushes AS p
		INNER JOIN local_passes AS l ON l.uid = p.uid AND l.sid = p.sid
		WHERE l.passed_at < p.pushed_at
		GROUP BY p.uid, p.sid, p.evidence
	),
	unlinked AS (
		SELECT run_id FROM runs WHERE ${inPicked()} AND has(coverage_gaps, 'github_link')
	)`;
}

export const LOCAL_PASS_ROWS = `multiIf(
			p.rid IN (SELECT run_id FROM unlinked), 'unknown: no GitHub link',
			ifNull(pc.jobs, 0) = 0, 'unknown: no CI jobs collected',
			pc.failed_jobs > 0, 'ci_failed',
			pc.pending_jobs > 0, 'ci_pending',
			'ci_passed') AS outcome,
		p.sid AS session_id, p.aid AS agent_id, p.turn AS turn_idx, p.pushed_at AS pushed_at,
		p.pushed_branch AS branch, p.sha AS pushed_sha, b.passes AS local_passes_before,
		b.last_check AS last_local_check, pc.ci_runs AS ci_runs, pc.failed_jobs AS failed_jobs,
		pc.failed_job_names AS failed_job_names
	FROM pushes AS p
	INNER JOIN before_push AS b ON b.uid = p.uid AND b.sid = p.sid AND b.evidence = p.evidence
	LEFT JOIN push_ci AS pc ON pc.uid = p.uid AND pc.sid = p.sid AND pc.evidence = p.evidence`;

export function localPassThenCiFailSql(params: MeasureParams): string {
	return `WITH ${localPassCtes(params)}
	SELECT ${LOCAL_PASS_ROWS}
	ORDER BY outcome = 'ci_failed' DESC, startsWith(outcome, 'unknown') DESC, p.pushed_at DESC
	LIMIT ${params.limit}`;
}

const FILE_ACT = `multiIf(
			${nativeEditToolSql("tool_name")}, 'edit',
			file_op = 'read' OR lower(tool_name) = 'read', 'read',
			lower(tool_name) IN ('grep', 'glob', 'ls'), 'search',
			'other')`;

const at = (item: string) => `tupleElement(${item}, 1)`;
const path = (item: string) => `tupleElement(${item}, 2)`;
const act = (item: string) => `tupleElement(${item}, 3)`;
const edit = (item: string) =>
	`${act(item)} = 'edit' AND tupleElement(${item}, 5) = 0`;

export const HUNT_FILE = `if(ifNull(r.cwd, '') != '' AND startsWith(h.edited, concat(r.cwd, '/')),
				substring(h.edited, length(r.cwd) + 2), h.edited)`;

export const HUNT_RUNS = `LEFT JOIN (SELECT run_id, cwd FROM runs WHERE ${inPicked()}) AS r ON r.run_id = tupleElement(h.first_edit, 6)`;

export function huntCtes(params: MeasureParams): string {
	return `${pickedCte(params)},
	touched AS (
		SELECT user_id AS uid, session_id AS sid, arrayElement(splitByChar('/', file_path), -1) AS base,
			(started_at, file_path, ${FILE_ACT}, ifNull(call_minutes, 0), failed, run_id, agent_id, turn_idx) AS touch
		${callsIn(params, "file_path != ''")}
	),
	grouped AS (
		SELECT uid, sid, groupArray(touch) AS touches
		FROM touched
		WHERE ${act("touch")} != 'other'
		GROUP BY uid, sid, base
		HAVING countIf(${edit("touch")}) > 0
	),
	hunts AS (
		SELECT uid, sid, edited,
			arraySort(x -> ${at("x")}, arrayFilter(x -> ${edit("x")} AND ${path("x")} = edited, touches))[1] AS first_edit,
			arrayFilter(x -> ${act("x")} IN ('read', 'search') AND ${at("x")} < ${at("first_edit")}
				AND (${path("x")} = edited OR endsWith(edited, concat('/', ${path("x")}))), touches) AS hunted
		FROM (
			SELECT uid, sid, touches,
				arrayJoin(arrayDistinct(arrayMap(x -> ${path("x")}, arrayFilter(x -> ${edit("x")}, touches)))) AS edited
			FROM grouped
		)
	)`;
}

export function filesHuntedBeforeEditSql(params: MeasureParams): string {
	return `WITH ${huntCtes(params)},
	per_session AS (
		SELECT h.uid AS uid, h.sid AS sid,
			${HUNT_FILE} AS file,
			length(h.hunted) AS calls_n,
			arrayCount(x -> ${act("x")} = 'read', h.hunted) AS reads_n,
			arrayCount(x -> ${act("x")} = 'search', h.hunted) AS searches_n,
			arraySum(arrayMap(x -> tupleElement(x, 4), h.hunted)) AS call_min,
			dateDiff('second', arrayMin(arrayMap(x -> ${at("x")}, h.hunted)), ${at("h.first_edit")}) / 60 AS lead_min,
			tupleElement(h.first_edit, 7) AS aid, tupleElement(h.first_edit, 8) AS turn
		FROM hunts AS h
		${HUNT_RUNS}
		WHERE notEmpty(h.hunted)
	)
	SELECT file, sessions, hunting_calls, reads, searches, hunt_call_minutes, minutes_to_first_edit,
		ex_sid AS session_id, ex_aid AS agent_id, ex_turn AS turn_idx
	FROM (
		SELECT file, uniqExact(sid) AS sessions, sum(calls_n) AS hunting_calls, sum(reads_n) AS reads,
			sum(searches_n) AS searches, round(sum(call_min), 1) AS hunt_call_minutes,
			round(sum(lead_min), 1) AS minutes_to_first_edit,
			argMax(sid, (calls_n, sid)) AS ex_sid, argMax(aid, (calls_n, sid)) AS ex_aid,
			argMax(turn, (calls_n, sid)) AS ex_turn
		FROM per_session
		GROUP BY file
	)
	ORDER BY hunting_calls DESC, sessions DESC, file
	LIMIT ${params.limit}`;
}

export function instructionCostSql(params: MeasureParams): string {
	return `WITH ${pickedCte(params)}
	SELECT file AS setup_file, setup_kind AS kind, version_label AS version_name, size_chars AS chars,
		tokens_est AS est_tokens, runs_n AS runs, received_n AS received, sessions_n AS sessions,
		members_n AS members, tokens_est * runs_n AS est_token_runs,
		ex_sid AS session_id, ex_aid AS agent_id, ex_turn AS turn_idx
	FROM (
		SELECT setup_file AS file, any(kind) AS setup_kind, any(version_name) AS version_label,
			max(chars) AS size_chars, intDiv(max(chars) + 3, 4) AS tokens_est, uniqExact(run_id) AS runs_n,
			countIf(NOT carried) AS received_n, uniqExact(session_id) AS sessions_n, uniqExact(user_id) AS members_n,
			argMin(session_id, (received_at, run_id)) AS ex_sid, argMin(agent_id, (received_at, run_id)) AS ex_aid,
			argMin(turn_idx, (received_at, run_id)) AS ex_turn
		FROM setup_files
		WHERE started_at >= ${windowStart(params)} AND ${inPicked()}
		GROUP BY setup_file, version
	)
	ORDER BY est_token_runs DESC, setup_file, version_name
	LIMIT ${params.limit}`;
}

export function unhappyWordsPattern(): string {
	const surfaces = LANGUAGE_SIGNAL_RULES.filter(
		(rule) => rule.category === "negative" || rule.category === "swear",
	).flatMap((rule) => rule.surfaces);
	const source = (surface: string) =>
		[...surface.replace(/\s+/gu, " ")]
			.map((character) =>
				character === " "
					? "\\s+"
					: character === "'" || character === "’"
						? "['’]"
						: character.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
			)
			.join("");
	const sorted = [...new Set(surfaces)].sort(
		(left, right) => right.length - left.length || left.localeCompare(right),
	);
	return `(?i)(?:^|[^\\p{L}\\p{N}])(${sorted.map(source).join("|")})(?:[^\\p{L}\\p{N}]|$)`;
}

export function repeatedCorrectionsSql(params: MeasureParams): string {
	return `WITH ${pickedCte(params)},
	flagged AS (
		SELECT run_id, user_id AS uid, session_id AS sid, turn_idx AS turn
		FROM runs
		WHERE agent_id = '' AND hasAny(prompt_reactions, ['negative', 'swear']) AND ${inPicked()}
	),
	per_session AS (
		SELECT uid, sid, count() AS corrections, min(turn) AS first_turn
		FROM flagged GROUP BY uid, sid
		HAVING corrections >= 2
	),
	asks AS (
		SELECT user_id AS uid, session_id AS sid, countIf(reasked) AS reasks, countIf(frustrated) AS unhappy,
			countIf(reasked IS NULL) AS unknown_reasks, count() AS runs_n
		FROM runs
		WHERE agent_id = '' AND (user_id, session_id) IN (SELECT uid, sid FROM per_session)
		GROUP BY user_id, session_id
	),
	words AS (
		SELECT uid, sid, topK(5)(word) AS top_words
		FROM (
			SELECT user_id AS uid, session_id AS sid,
				arrayJoin(arrayDistinct(arrayMap(x -> lowerUTF8(x), extractAll(text, ${sqlString(unhappyWordsPattern())})))) AS word
			FROM prompts
			WHERE at >= ${windowStart(params)} AND genuine = 1 AND run_id IN (SELECT run_id FROM flagged)
		)
		GROUP BY uid, sid
	)
	SELECT s.sid AS session_id, '' AS agent_id, s.first_turn AS turn_idx, s.corrections AS corrections,
		w.top_words AS top_words, a.reasks AS re_asks, a.unknown_reasks AS unknown_re_asks,
		a.unhappy AS frustration, a.runs_n AS main_runs
	FROM per_session AS s
	LEFT JOIN asks AS a ON a.uid = s.uid AND a.sid = s.sid
	LEFT JOIN words AS w ON w.uid = s.uid AND w.sid = s.sid
	ORDER BY s.corrections DESC, a.reasks DESC, s.sid
	LIMIT ${params.limit}`;
}
