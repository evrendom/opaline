import type postgres from "postgres";
import { sqlClient } from "../db.js";
import type { SessionReader } from "./session-visibility.js";

/**
 * The member as a reader of the workspace's sessions (their role and the
 * workspace's own-sessions-only option), or null when they are not a member.
 * A membership whose organization row is missing reads with the option off.
 */
export async function readSessionReader(
	organizationId: string,
	userId: string,
	sql: postgres.Sql = sqlClient,
): Promise<SessionReader | null> {
	const [row] = await sql<Array<{ role: string; ownSessionsOnly: boolean }>>`
		SELECT m.role, COALESCE(o.own_sessions_only, false) AS "ownSessionsOnly"
		FROM member m
		LEFT JOIN organization o ON o.id = m.organization_id
		WHERE m.organization_id = ${organizationId}
			AND m.user_id = ${userId}
		LIMIT 1
	`;
	return row
		? { userId, role: row.role, ownSessionsOnly: row.ownSessionsOnly }
		: null;
}
