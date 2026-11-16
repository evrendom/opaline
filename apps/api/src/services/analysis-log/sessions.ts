import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "../analysis/sql.js";
import { readCommittedGenerations } from "../transcript-generations/generations.js";
import type { QuerySession } from "./types.js";

const OwnerRowSchema = z.object({
	session_id: z.string(),
	user_id: z.string(),
});

/** Every `sessionId` a find/read result refers to. */
export function referencedSessionIds(output: unknown): string[] {
	const found = new Set<string>();
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) for (const item of value) visit(item);
		else if (value && typeof value === "object")
			for (const [key, item] of Object.entries(value)) {
				if (key === "sessionId" && typeof item === "string") found.add(item);
				else visit(item);
			}
	};
	visit(output);
	return [...found];
}

/** Owner and committed transcript generation of each session, as they are now. */
export async function describeSessions(
	executor: ClickHouseExecutor,
	organizationId: string,
	sessionIds: readonly string[],
): Promise<QuerySession[]> {
	if (!sessionIds.length) return [];
	const owners = await query(executor, OwnerRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT session_id, any(user_id) AS user_id
			FROM ${getSafeClickHouseTable("rudel.session_analytics")}
			WHERE organization_id = {organizationId:String} AND session_id IN {sessionIds:Array(String)}
			GROUP BY session_id`,
		query_params: { organizationId, sessionIds: [...sessionIds] },
	});
	const sessions: QuerySession[] = [];
	for (const userId of new Set(owners.map((owner) => owner.user_id))) {
		const owned = owners.filter((owner) => owner.user_id === userId);
		const generations = await readCommittedGenerations(
			executor,
			{ organizationId, userId },
			owned.map((owner) => owner.session_id),
		);
		for (const generation of generations)
			sessions.push({
				sessionId: generation.sessionId,
				ownerId: userId,
				revision: generation.revision,
				parserVersion: generation.parserVersion,
			});
	}
	return sessions;
}
