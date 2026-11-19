import { CALL_FACTS_TABLE } from "@rudel/ch-schema/call-facts";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";
import { CALL_FACTS_SINCE_INDEX_VERSION } from "./run-index-sql.js";
import { ANALYSIS_QUERY_SETTINGS } from "./sql.js";
import { callOutputsSql } from "./sql-call-rows.js";
import type { SqlWindow } from "./sql-guard.js";
import { CALL_COLUMNS, type CommittedRuns, callsSql } from "./sql-measures.js";

export interface CallsViewSources {
	readonly owner: string;
	readonly runs: (owner: string) => CommittedRuns;
	readonly measuredRuns: (runs: CommittedRuns) => string;
	readonly parentOwner: string;
}

function committedSessionsSql(
	table: string,
	owner: string,
	condition: string,
): string {
	return `SELECT user_id, session_id, committed.1 AS revision, committed.2 AS parser_version,
					committed.3 AS index_version, committed.4 AS build_revision
				FROM (
					SELECT user_id, session_id, max((revision, parser_version, index_version, build_revision)) AS committed
					FROM ${table}
					WHERE ${owner} AND row_kind = 'receipt'
					GROUP BY user_id, session_id
				)
				WHERE ${condition}`;
}

export function callsViewSql(
	sources: CallsViewSources,
	window: SqlWindow = {},
): string {
	const runIndex = sources.runs(sources.owner).table;
	const facts = getSafeClickHouseTable(CALL_FACTS_TABLE);
	const reads = (...names: string[]) =>
		window.words === undefined ||
		["*", ...names].some((word) => window.words?.has(word));
	const built = `(user_id, session_id, revision, parser_version, index_version, build_revision) IN (
				SELECT user_id, session_id, revision, parser_version, index_version, build_revision FROM (
				${committedSessionsSql(runIndex, sources.owner, `committed.3 >= ${CALL_FACTS_SINCE_INDEX_VERSION}`)}))`;
	const range = [
		...(window.from === undefined ? [] : [`started_at >= (${window.from})`]),
		...(window.to === undefined ? [] : [`started_at <= (${window.to})`]),
	];
	const selected = [`${sources.owner}`, built, ...range].join("\n\t\t\t\tAND ");
	const output = reads("output");
	const coverage = reads("coverage_gaps");
	const columns: Readonly<Record<string, string>> = {
		output: output ? "o.output" : "''",
		coverage_gaps: coverage ? "r.coverage_gaps" : "CAST([], 'Array(String)')",
	};
	const outputs = output
		? `
			LEFT ANY JOIN (${callOutputsSql(`${sources.owner}
					AND (user_id, session_id, revision, parser_version) IN (
						SELECT DISTINCT user_id, session_id, revision, parser_version FROM ${facts}
						WHERE ${selected})`)}) AS o
				ON o.user_id = f.user_id AND o.session_id = f.session_id AND o.revision = f.revision
				AND o.parser_version = f.parser_version AND o.agent_id = f.agent_id AND o.call_id = f.call_id`
		: "";
	const gaps = coverage
		? `
			LEFT ANY JOIN (
				SELECT run_id, coverage_gaps FROM (${sources.measuredRuns(sources.runs(sources.owner))})
			) AS r ON r.run_id = f.run_id`
		: "";
	const legacyOwner = `${sources.owner}
				AND (user_id, session_id) IN (
					SELECT user_id, session_id FROM (
					${committedSessionsSql(runIndex, sources.owner, `committed.3 < ${CALL_FACTS_SINCE_INDEX_VERSION}`)}))`;
	const legacy = sources.runs(legacyOwner);
	const legacyBranch =
		window.legacyCalls === false
			? ""
			: `
		UNION ALL
		SELECT * FROM (${callsSql(legacy, sources.measuredRuns, window, sources.parentOwner)})`;
	return `SELECT ${CALL_COLUMNS.map((column) => `${columns[column.name] ?? `f.${column.name}`} AS ${column.name}`).join(",\n\t\t\t")}
			FROM (
				SELECT * FROM ${facts} FINAL
				WHERE ${selected}
			) AS f${outputs}${gaps}${legacyBranch}`;
}

export async function workspaceHasLegacyCalls(
	executor: ClickHouseExecutor,
	workspaceId: string,
): Promise<boolean> {
	try {
		const [row] = await executor.query<{ legacy: number | string }>({
			query: `SELECT count() > 0 AS legacy FROM (
				${committedSessionsSql(getSafeClickHouseTable(RUN_INDEX_TABLE), "organization_id = {workspace:String}", `committed.3 < ${CALL_FACTS_SINCE_INDEX_VERSION}`)})`,
			query_params: { workspace: workspaceId },
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		});
		return Number(row?.legacy ?? 1) > 0;
	} catch {
		return true;
	}
}
