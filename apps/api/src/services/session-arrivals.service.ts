import type { SessionArrivalsInputSchema } from "@rudel/api-routes";
import type { z } from "zod";
import { sqlClient } from "../db.js";

const PAGE_SIZE = 100;

export async function listSessionArrivals(
	organizationId: string,
	userId: string | null,
	input: z.infer<typeof SessionArrivalsInputSchema>,
) {
	if (!input.since) {
		const [clock] = await sqlClient<{ since: string }[]>`
			SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC',
				'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS since
		`;
		if (!clock) throw new Error("Could not establish session arrival baseline");
		return { since: clock.since, sessions: [], nextCursor: null };
	}

	// Scan from the subscription baseline on every poll. A reserved session can
	// finish later than newer sessions, so advancing a completion watermark would
	// lose delayed uploads. The primary key provides stable, bounded pagination.
	const rows = await sqlClient<{ sessionId: string; userName: string }[]>`
		SELECT s.session_id AS "sessionId", u.name AS "userName"
		FROM session_ownership s
		JOIN "user" u ON u.id = s.user_id
		WHERE s.organization_id = ${organizationId}
			AND (${userId}::text IS NULL OR s.user_id = ${userId})
			AND s.created_at >= ${input.since}::timestamptz
			AND s.last_ingested_at IS NOT NULL
			AND (${input.after ?? null}::text IS NULL OR s.session_id > ${input.after ?? null})
		ORDER BY s.session_id
		LIMIT ${PAGE_SIZE + 1}
	`;
	const sessions = rows.slice(0, PAGE_SIZE);
	return {
		since: input.since,
		sessions,
		nextCursor:
			rows.length > PAGE_SIZE ? (sessions.at(-1)?.sessionId ?? null) : null,
	};
}
