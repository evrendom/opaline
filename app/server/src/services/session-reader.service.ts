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
	return (
		(await readWorkspaceMember(organizationId, userId, sql))?.reader ?? null
	);
}

export async function readWorkspaceMember(
	organizationId: string,
	userId: string,
	sql: postgres.Sql = sqlClient,
): Promise<{
	reader: SessionReader;
	workspaceCreatedAt: Date | string | null;
} | null> {
	const [row] = await sql<
		Array<{
			role: string;
			ownSessionsOnly: boolean;
			workspaceCreatedAt: Date | string | null;
		}>
	>`
		SELECT m.role, COALESCE(o.own_sessions_only, false) AS "ownSessionsOnly",
			o.created_at AS "workspaceCreatedAt"
		FROM member m
		LEFT JOIN organization o ON o.id = m.organization_id
		WHERE m.organization_id = ${organizationId}
			AND m.user_id = ${userId}
		LIMIT 1
	`;
	return row
		? {
				reader: {
					userId,
					role: row.role,
					ownSessionsOnly: row.ownSessionsOnly,
				},
				workspaceCreatedAt: row.workspaceCreatedAt,
			}
		: null;
}

export async function readWorkspaceMemberBySlug(
	slug: string,
	userId: string,
	sql: postgres.Sql = sqlClient,
): Promise<{
	organizationId: string;
	member: {
		reader: SessionReader;
		workspaceCreatedAt: Date | string | null;
	};
} | null> {
	const [row] = await sql<
		Array<{
			organizationId: string;
			role: string;
			ownSessionsOnly: boolean;
			workspaceCreatedAt: Date | string | null;
		}>
	>`
		SELECT o.id AS "organizationId", m.role,
			COALESCE(o.own_sessions_only, false) AS "ownSessionsOnly",
			o.created_at AS "workspaceCreatedAt"
		FROM organization o
		INNER JOIN member m ON m.organization_id = o.id
		WHERE o.slug = ${slug}
			AND m.user_id = ${userId}
		LIMIT 1
	`;
	return row
		? {
				organizationId: row.organizationId,
				member: {
					reader: {
						userId,
						role: row.role,
						ownSessionsOnly: row.ownSessionsOnly,
					},
					workspaceCreatedAt: row.workspaceCreatedAt,
				},
			}
		: null;
}
