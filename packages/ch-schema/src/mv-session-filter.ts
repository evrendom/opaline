const MARKER = "WHERE _is_capped OR length(_timestamps) > 0";
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export interface SessionScope {
	organizationId: string;
	sessionId: string;
}

/** Injects an additional source predicate into an analytics MV SELECT body. */
export function withMvSourcePredicate(
	mvSql: string,
	predicate: string,
): string {
	if (predicate.trim() === "" || predicate.includes(";")) {
		throw new Error("withMvSourcePredicate: predicate must be non-empty SQL");
	}

	const parts = mvSql.split(MARKER);
	if (parts.length !== 2) {
		throw new Error(
			`withMvSourcePredicate: expected exactly 1 occurrence of "${MARKER}", found ${parts.length - 1}`,
		);
	}

	return parts.join(
		`WHERE (${predicate}) AND (_is_capped OR length(_timestamps) > 0)`,
	);
}

/**
 * Scopes a materialized-view SELECT body to a single session.
 *
 * The allowlist makes interpolation safe for the test executor, whose query API
 * accepts only a bare SQL string.
 */
export function withSessionFilter(mvSql: string, scope: SessionScope): string {
	for (const [label, value] of Object.entries(scope)) {
		if (!SAFE_ID.test(value)) {
			throw new Error(
				`withSessionFilter: unsafe ${label} ${JSON.stringify(value)}`,
			);
		}
	}

	return withMvSourcePredicate(
		mvSql,
		`cs.organization_id = '${scope.organizationId}'` +
			` AND cs.session_id = '${scope.sessionId}'`,
	);
}
