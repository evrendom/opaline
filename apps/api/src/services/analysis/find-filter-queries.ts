import type { AnalysisFindInput } from "@rudel/api-routes";
import { z } from "zod";
import type { ClickHouseStatement } from "../../clickhouse.js";
import {
	type CompiledFilters,
	compileFilters,
	type FilterView,
} from "./find-filters.js";
import type { AnalysisScope, ScopeBatch } from "./scope.js";
import { ANALYSIS_QUERY_SETTINGS } from "./sql.js";
import { CALL_COLUMNS } from "./sql-measures.js";
import { findSqlView, SQL_SCOPE_PARAMS } from "./sql-views.js";

export const CALL_FILTER_UNSUPPORTED = [
	"run_id",
	"interrupted",
	"timed_out",
	"timed_out_after_ms",
	"task_id",
	"background_status",
	"background_exit_code",
	"coverage_gaps",
] as const;

function viewColumns(name: string) {
	const view = findSqlView(name);
	if (!view) throw new Error(`no ${name} view`);
	return view.columns.map(({ name, type }) => ({ name, type }));
}

export function filterView(source: AnalysisFindInput["source"]): FilterView {
	if (source === "calls")
		return {
			name: "calls",
			columns: CALL_COLUMNS.filter(
				(column) =>
					!(CALL_FILTER_UNSUPPORTED as readonly string[]).includes(column.name),
			).map(({ name, type }) => ({ name, type })),
			unsupported: CALL_FILTER_UNSUPPORTED,
		};
	return { name: "runs", columns: viewColumns("runs"), unsupported: [] };
}

export function compileFindFilters(
	input: AnalysisFindInput,
): CompiledFilters | undefined {
	if (!input.filters?.length) return undefined;
	return compileFilters(input.filters, filterView(input.source), input.source);
}

export const RunKeyRowSchema = z.object({
	session_id: z.string(),
	agent_id: z.string(),
	turn_idx: z.number(),
});

export function buildRunFilterStatement(
	organizationId: string,
	batch: ScopeBatch,
	filters: CompiledFilters,
): ClickHouseStatement {
	const runs = findSqlView("runs");
	if (!runs) throw new Error("no runs view");
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT session_id, agent_id, turn_idx
			FROM (${runs.sql(true)})
			WHERE session_id IN {filterSessions:Array(String)} AND ${filters.sql}`,
		query_params: {
			[SQL_SCOPE_PARAMS.workspace]: organizationId,
			[SQL_SCOPE_PARAMS.member]: batch.scope.userId,
			filterSessions: batch.generations.map(
				(generation) => generation.sessionId,
			),
			...filters.params,
		},
	};
}

export const SessionLinkRowSchema = z.object({
	user_id: z.string(),
	from_session_id: z.string(),
	to_session_id: z.string(),
	kind: z.string(),
	at_ms: z.coerce.number(),
});
export type SessionLinkRow = z.infer<typeof SessionLinkRowSchema>;

export function buildSessionLinksStatement(
	scope: AnalysisScope,
): ClickHouseStatement {
	const links = findSqlView("session_links");
	if (!links) throw new Error("no session_links view");
	const memberOnly = scope.userId !== null;
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT user_id, from_session_id, to_session_id, toString(kind) AS kind,
				toUnixTimestamp64Milli(at) AS at_ms
			FROM (${links.sql(memberOnly)})`,
		query_params: {
			[SQL_SCOPE_PARAMS.workspace]: scope.organizationId,
			...(memberOnly ? { [SQL_SCOPE_PARAMS.member]: scope.userId } : {}),
		},
	};
}

export interface TreeSession {
	readonly userId: string;
	readonly sessionId: string;
	readonly parentSessionId: string | null;
	readonly depth: number;
	readonly atMs: number | null;
}

export function sessionTree(
	links: readonly SessionLinkRow[],
	root: string,
): TreeSession[] {
	const children = new Map<string, SessionLinkRow[]>();
	for (const link of links)
		children.set(link.from_session_id, [
			...(children.get(link.from_session_id) ?? []),
			link,
		]);
	const owner = links.find(
		(link) => link.from_session_id === root || link.to_session_id === root,
	)?.user_id;
	if (owner === undefined) return [];
	const tree: TreeSession[] = [
		{
			userId: owner,
			sessionId: root,
			parentSessionId: null,
			depth: 0,
			atMs: null,
		},
	];
	const seen = new Set([root]);
	for (let index = 0; index < tree.length; index++) {
		const parent = tree[index];
		if (!parent) break;
		const below = [...(children.get(parent.sessionId) ?? [])].sort(
			(left, right) =>
				left.at_ms - right.at_ms ||
				(left.to_session_id < right.to_session_id ? -1 : 1),
		);
		for (const link of below) {
			if (seen.has(link.to_session_id)) continue;
			seen.add(link.to_session_id);
			tree.push({
				userId: link.user_id,
				sessionId: link.to_session_id,
				parentSessionId: parent.sessionId,
				depth: parent.depth + 1,
				atMs: link.at_ms,
			});
		}
	}
	return tree;
}
