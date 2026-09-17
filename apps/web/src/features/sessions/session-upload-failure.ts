import type { SessionAnalytics, StoredUploadFailure } from "@rudel/api-routes";

/** Adapt diagnostics to the existing row/navigation model, never to analytics totals.
 * Numeric placeholders are hidden and excluded from metric filters for these rows.
 * A missing session date sorts by failure time; the row still labels it unavailable.
 */
export function uploadFailureSession(
	failure: StoredUploadFailure,
): SessionAnalytics {
	return {
		upload_failure: failure,
		session_id: failure.sessionId,
		user_id: failure.userId,
		source: failure.source,
		session_date: failure.sessionDate ?? failure.failedAt,
		project_path: failure.projectPath,
		repository: failure.repository || null,
		git_remote: failure.gitRemote,
		git_branch: failure.gitBranch,
		model_used: "",
		estimated_cost: null,
		duration_min: 0,
		total_tokens: 0,
		input_tokens: 0,
		output_tokens: 0,
		success_score: 0,
		total_interactions: 0,
		avg_period_sec: 0,
		subagent_types: [],
		skills: [],
		slash_commands: [],
		has_commit: Boolean(failure.gitSha),
		used_plan_mode: false,
	};
}

export function mergeSessionUploadFailures(
	sessions: SessionAnalytics[],
	failures: StoredUploadFailure[],
): SessionAnalytics[] {
	const rows = new Map(
		sessions.map((session) => [
			`${session.user_id}:${session.source}:${session.session_id}`,
			session,
		]),
	);
	for (const failure of failures) {
		rows.set(
			`${failure.userId}:${failure.source}:${failure.sessionId}`,
			uploadFailureSession(failure),
		);
	}
	return [...rows.values()];
}

export function getSessionUploadFailure(
	sessionId: string,
	initialSession: SessionAnalytics | undefined,
	failures: StoredUploadFailure[] | undefined,
) {
	// A refreshed list row supersedes cached diagnostics after a successful retry.
	if (initialSession?.session_id === sessionId)
		return initialSession.upload_failure;
	return failures?.find((failure) => failure.sessionId === sessionId);
}
