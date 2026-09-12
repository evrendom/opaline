import { sqlClient } from "../db.js";

/** Only completed ingests count; a reserved ownership row may be a failed upload. */
export async function findUploadedSessionIds(
	organizationId: string,
	userId: string,
	sessionIds: readonly string[],
): Promise<string[]> {
	if (sessionIds.length === 0) return [];

	const rows = await sqlClient<Array<{ session_id: string }>>`
		SELECT session_id
		FROM session_ownership
		WHERE organization_id = ${organizationId}
			AND user_id = ${userId}
			AND session_id IN ${sqlClient([...sessionIds])}
			AND last_ingested_at IS NOT NULL
		ORDER BY session_id
	`;

	return rows.map((row) => row.session_id);
}
