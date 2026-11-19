import { SESSION_LINEAGE_DERIVATION_VERSION } from "@rudel/api-routes";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { NATIVE_PARENT_EDGE_SQL } from "../session-lineage-analytics.service.js";
import type { AnalysisScope } from "./scope.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./sql.js";

/**
 * Codex subagent threads are uploaded as sessions of their own and linked to
 * the thread that spawned them in `rudel.session_lineage`. Analysis keeps each
 * thread's own session id in its refs (its records, generation and cost stay
 * its own) and adds the family around it: the parent session, the top session
 * and the depth below it. Only current native rows connect (explicit Codex
 * parent metadata, countable because the parent was uploaded); inferred or
 * uncountable links leave both sessions separate. Every edge belongs to one
 * owner, so families never cross members or workspaces.
 */

/** One owner's link from a subagent thread to the thread that spawned it. */
export interface NativeEdge {
	readonly userId: string;
	readonly childSessionId: string;
	readonly parentSessionId: string;
}

/** Where a session sits in its family. */
export interface FamilyPosition {
	readonly parentSessionId: string | null;
	readonly rootSessionId: string;
	/** 0 for a top-level session, 1 for a direct child, and so on. */
	readonly depth: number;
}

/** Parent and child links of one or more owners, keyed by owner and session. */
export interface SessionFamilies {
	readonly parents: ReadonlyMap<string, string>;
	readonly children: ReadonlyMap<string, readonly string[]>;
}

/** Edges either of a time window (find) or touching given sessions (read). */
export type NativeEdgeFilter =
	| { readonly childSince: string }
	| { readonly sessionIds: readonly string[] };

/** Deeper chains (or a corrupt cycle) stop here instead of looping. */
const MAX_FAMILY_DEPTH = 16;

const EdgeRowSchema = z
	.object({
		user_id: z.string(),
		child_session_id: z.string(),
		parent_session_id: z.string(),
	})
	.transform(
		(row): NativeEdge => ({
			userId: row.user_id,
			childSessionId: row.child_session_id,
			parentSessionId: row.parent_session_id,
		}),
	);

export async function loadSessionFamilies(
	executor: ClickHouseExecutor,
	scope: AnalysisScope,
	filter: NativeEdgeFilter,
): Promise<SessionFamilies> {
	return createSessionFamilies(
		await query(
			executor,
			EdgeRowSchema,
			buildNativeEdgesStatement(scope, filter),
		),
	);
}

/**
 * Families of `sessionIds` for one owner: their parents up to the top session
 * and their direct children, a few small keyed lookups.
 */
export async function loadFamiliesAround(
	executor: ClickHouseExecutor,
	scope: { organizationId: string; userId: string },
	sessionIds: readonly string[],
): Promise<SessionFamilies> {
	const edges: NativeEdge[] = [];
	const asked = new Set<string>();
	let next = [...new Set(sessionIds)];
	for (let level = 0; next.length && level < MAX_FAMILY_DEPTH; level++) {
		const ids = new Set(next);
		for (const id of ids) asked.add(id);
		const found = await query(
			executor,
			EdgeRowSchema,
			buildNativeEdgesStatement(scope, { sessionIds: next }),
		);
		edges.push(...found);
		// Only ancestors need another level; children are listed one level deep.
		next = [
			...new Set(
				found
					.filter((edge) => ids.has(edge.childSessionId))
					.map((edge) => edge.parentSessionId)
					.filter((id) => !asked.has(id)),
			),
		];
	}
	return createSessionFamilies(edges);
}

export function createSessionFamilies(
	edges: readonly NativeEdge[],
): SessionFamilies {
	const parents = new Map<string, string>();
	const children = new Map<string, string[]>();
	for (const edge of edges) {
		const childKey = ownerKey(edge.userId, edge.childSessionId);
		if (parents.has(childKey) || edge.childSessionId === edge.parentSessionId)
			continue;
		parents.set(childKey, edge.parentSessionId);
		const parentKey = ownerKey(edge.userId, edge.parentSessionId);
		children.set(parentKey, [
			...(children.get(parentKey) ?? []),
			edge.childSessionId,
		]);
	}
	for (const list of children.values()) list.sort();
	return { parents, children };
}

export function familyPosition(
	families: SessionFamilies,
	userId: string,
	sessionId: string,
): FamilyPosition {
	const parentSessionId =
		families.parents.get(ownerKey(userId, sessionId)) ?? null;
	let rootSessionId = sessionId;
	let depth = 0;
	const seen = new Set([sessionId]);
	for (
		let parent = parentSessionId;
		parent !== null && !seen.has(parent) && depth < MAX_FAMILY_DEPTH;
		parent = families.parents.get(ownerKey(userId, parent)) ?? null
	) {
		seen.add(parent);
		rootSessionId = parent;
		depth++;
	}
	return { parentSessionId, rootSessionId, depth };
}

export function childSessions(
	families: SessionFamilies,
	userId: string,
	sessionId: string,
): readonly string[] {
	return families.children.get(ownerKey(userId, sessionId)) ?? [];
}

/** Every descendant of `sessionIds` (one owner), breadth first, without them. */
export function descendantSessions(
	families: SessionFamilies,
	userId: string,
	sessionIds: readonly string[],
): string[] {
	const seen = new Set(sessionIds);
	const found: string[] = [];
	let level = [...seen];
	for (let depth = 0; level.length && depth < MAX_FAMILY_DEPTH; depth++) {
		const next: string[] = [];
		for (const id of level)
			for (const child of childSessions(families, userId, id)) {
				if (seen.has(child)) continue;
				seen.add(child);
				found.push(child);
				next.push(child);
			}
		level = next;
	}
	return found;
}

/**
 * Current native edges: the newest row of each child (by
 * `replacement_version`, as every lineage reader resolves it) must still be a
 * native, countable link. A session filter selects children by id and by any
 * row naming a parent, then re-checks the current parent after resolution.
 */
export function buildNativeEdgesStatement(
	scope: AnalysisScope,
	filter: NativeEdgeFilter,
): ClickHouseStatement {
	const lineage = getSafeClickHouseTable("rudel.session_lineage");
	const tenant = `organization_id = {organizationId:String}${scope.userId === null ? "" : " AND user_id = {userId:String}"}`;
	const bySession = "sessionIds" in filter;
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT user_id, child_session_id, parent_session_id FROM (
				SELECT user_id, child_source, child_session_id,
					argMax(parent_source, replacement_version) AS parent_source,
					argMax(parent_session_id, replacement_version) AS parent_session_id,
					argMax(confidence, replacement_version) AS confidence,
					argMax(countable, replacement_version) AS countable,
					argMax(carrier, replacement_version) AS carrier,
					argMax(child_session_date, replacement_version) AS child_session_date
				FROM ${lineage}
				WHERE ${tenant} AND derivation_version = {derivationVersion:UInt16} AND child_source = 'codex'
					${
						bySession
							? `AND (child_session_id IN {sessionIds:Array(String)} OR child_session_id IN (
								SELECT child_session_id FROM ${lineage}
								WHERE ${tenant} AND parent_session_id IN {sessionIds:Array(String)}))`
							: ""
					}
				GROUP BY user_id, child_source, child_session_id
			)
			WHERE ${NATIVE_PARENT_EDGE_SQL} AND carrier = 'codex_native_subagent'
				AND child_session_id != parent_session_id
				${
					bySession
						? "AND (child_session_id IN {sessionIds:Array(String)} OR parent_session_id IN {sessionIds:Array(String)})"
						: "AND child_session_date >= {childSince:Date}"
				}
			ORDER BY user_id, child_session_id`,
		query_params: {
			organizationId: scope.organizationId,
			...(scope.userId === null ? {} : { userId: scope.userId }),
			derivationVersion: SESSION_LINEAGE_DERIVATION_VERSION,
			...("sessionIds" in filter
				? { sessionIds: [...filter.sessionIds] }
				: { childSince: filter.childSince }),
		},
	};
}

function ownerKey(userId: string, sessionId: string): string {
	return `${userId}\u0000${sessionId}`;
}
