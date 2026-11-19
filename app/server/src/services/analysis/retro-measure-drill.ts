import { commandFamiliesSql } from "./command-identity.js";
import {
	callsIn,
	FAILURE_CAUSE,
	FAILURE_KIND,
	HUNT_FILE,
	HUNT_RUNS,
	huntCtes,
	inPicked,
	LOCAL_PASS_ROWS,
	localPassCtes,
	type MeasureParams,
	pickedCte,
	sqlString,
} from "./retro-measure-sql.js";

export type Drill = Readonly<Record<string, string>>;

export const DRILL_KEYS: Readonly<Record<string, readonly string[]>> = {
	time_lost_by_cause: ["kind", "cause"],
	repeated_commands: ["family"],
	files_hunted_before_edit: ["file"],
	local_pass_then_ci_fail: ["outcome"],
};

export const NOT_DRILLABLE: Readonly<Record<string, string>> = {
	cohort: "its rows are sessions already",
	repeated_corrections: "its rows are sessions already",
	instruction_cost:
		"a setup file version reaches most sessions; list them with sql over setup_files",
};

export function drillOf(
	name: string,
	given: Readonly<Record<string, string | number>>,
): Drill | { error: string } {
	const keys = DRILL_KEYS[name];
	if (!keys)
		return {
			error: `${name} takes no drill: ${NOT_DRILLABLE[name] ?? "it is not a query measure"}. Drillable: ${Object.entries(
				DRILL_KEYS,
			)
				.map(([measure, names]) => `${measure} (${names.join(", ")})`)
				.join(", ")}`,
		};
	const missing = keys.filter((key) => given[key] === undefined);
	const unknown = Object.keys(given).filter((key) => !keys.includes(key));
	if (missing.length || unknown.length)
		return {
			error: `drill for ${name} names one row of its result by ${keys.join(" and ")}, copied from that row${missing.length ? `; missing: ${missing.join(", ")}` : ""}${unknown.length ? `; not a key: ${unknown.join(", ")}` : ""}`,
		};
	return Object.fromEntries(keys.map((key) => [key, String(given[key])]));
}

function hitsSql(name: string, params: MeasureParams, drill: Drill): string {
	const value = (key: string) => sqlString(drill[key] ?? "");
	if (name === "time_lost_by_cause")
		return `WITH ${pickedCte(params)},
	hits AS (
		SELECT user_id AS uid, session_id AS sid, run_id, started_at AS at, failed, call_minutes AS minutes,
			agent_id AS aid, turn_idx AS turn
		${callsIn(params, `failed = 1 AND ${FAILURE_KIND} = ${value("kind")} AND ${FAILURE_CAUSE} = ${value("cause")}`)}
	)`;
	if (name === "repeated_commands")
		return `WITH ${pickedCte(params)},
	hits AS (
		SELECT user_id AS uid, session_id AS sid, run_id, started_at AS at, failed, call_minutes AS minutes,
			agent_id AS aid, turn_idx AS turn
		${callsIn(params, `command_from = 'command' AND command_head IS NOT NULL AND has(${commandFamiliesSql("command_head")}, ${value("family")})`)}
	)`;
	if (name === "files_hunted_before_edit")
		return `WITH ${huntCtes(params)},
	hits AS (
		SELECT uid, sid, tupleElement(x, 6) AS run_id, tupleElement(x, 1) AS at, tupleElement(x, 5) AS failed,
			tupleElement(x, 4) AS minutes, tupleElement(x, 7) AS aid, tupleElement(x, 8) AS turn
		FROM (
			SELECT h.uid AS uid, h.sid AS sid, arrayJoin(h.hunted) AS x
			FROM hunts AS h
			${HUNT_RUNS}
			WHERE ${HUNT_FILE} = ${value("file")}
		)
	)`;
	return `WITH ${localPassCtes(params)},
	push_rows AS (SELECT ${LOCAL_PASS_ROWS}),
	hits AS (
		SELECT r.user_id AS uid, d.session_id AS sid, r.run_id AS run_id, d.pushed_at AS at,
			nullIf(toUInt8(0), 0) AS failed, nullIf(toFloat64(0), 0) AS minutes,
			d.agent_id AS aid, d.turn_idx AS turn
		FROM push_rows AS d
		INNER JOIN (SELECT user_id, run_id, session_id, agent_id, turn_idx FROM runs WHERE ${inPicked()}) AS r
			ON r.session_id = d.session_id AND r.agent_id = d.agent_id AND r.turn_idx = d.turn_idx
		WHERE d.outcome = ${value("outcome")}
	)`;
}

export function drillSql(
	name: string,
	params: MeasureParams,
	drill: Drill,
): string {
	return `${hitsSql(name, params, drill)},
	per_run AS (
		SELECT uid, sid, run_id, count() AS n, countIf(isNotNull(failed)) AS known_n, countIf(failed = 1) AS failed_n,
			sum(minutes) AS call_min, min(at) AS first_at, max(at) AS last_at, argMin((aid, turn), at) AS ex
		FROM hits
		GROUP BY uid, sid, run_id
	),
	run_time AS (SELECT run_id, active_minutes FROM runs WHERE ${inPicked()})
	SELECT s.sid AS session_id, p.session_repository AS repository, p.session_start AS started_at,
		s.rows_n AS rows_matched, s.first_at AS first_seen, s.last_at AS last_seen,
		s.run_min AS group_run_time, s.call_min AS group_call_time,
		if(s.known_n = 0, NULL, s.failed_n) AS failed_calls,
		tupleElement(s.ex, 1) AS agent_id, tupleElement(s.ex, 2) AS turn_idx
	FROM (
		SELECT g.uid AS uid, g.sid AS sid, sum(g.n) AS rows_n, sum(g.known_n) AS known_n, sum(g.failed_n) AS failed_n,
			min(g.first_at) AS first_at, max(g.last_at) AS last_at, round(sum(r.active_minutes), 1) AS run_min,
			round(sum(g.call_min), 1) AS call_min, argMin(g.ex, g.first_at) AS ex
		FROM per_run AS g
		LEFT JOIN run_time AS r ON r.run_id = g.run_id
		GROUP BY g.uid, g.sid
	) AS s
	INNER JOIN picked AS p ON p.user_id = s.uid AND p.session_id = s.sid
	ORDER BY rows_matched DESC, first_seen, session_id
	LIMIT ${params.limit}`;
}

export function drillLabel(drill: Drill): string {
	return Object.entries(drill)
		.map(([key, value]) => `${key}=${value}`)
		.join(", ");
}
