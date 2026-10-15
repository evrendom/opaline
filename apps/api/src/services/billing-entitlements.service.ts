import { sqlClient } from "../db.js";

export const FREE_WORKSPACE_MONTHLY_AGENT_RUN_LIMIT = 50_000;

export class FreeWorkspaceMonthlyAgentRunLimitExceededError extends Error {
	constructor() {
		super(
			`Free workspaces support up to ${FREE_WORKSPACE_MONTHLY_AGENT_RUN_LIMIT} agent runs per month`,
		);
		this.name = "FreeWorkspaceMonthlyAgentRunLimitExceededError";
	}
}

export async function assertCanStartOrganizationAgentRun(
	organizationId: string,
	sessionId: string,
): Promise<void> {
	const [state] = await sqlClient.unsafe<
		Array<{ already_recorded: boolean; paid: boolean; run_count: number }>
	>(
		`SELECT
			EXISTS (
				SELECT 1 FROM session_ownership
				WHERE organization_id = $1 AND session_id = $2
			) AS already_recorded,
			EXISTS (
				SELECT 1 FROM billing_subscription
					WHERE organization_id = $1 AND status IN ('active', 'trialing', 'past_due')
			) AS paid,
			COALESCE((
				SELECT agent_runs FROM organization_monthly_usage
				WHERE organization_id = $1
					AND month_start = date_trunc(
						'month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
					)::date
			), 0)::int AS run_count`,
		[organizationId, sessionId],
	);
	if (
		state &&
		!state.already_recorded &&
		!state.paid &&
		state.run_count >= FREE_WORKSPACE_MONTHLY_AGENT_RUN_LIMIT
	) {
		throw new FreeWorkspaceMonthlyAgentRunLimitExceededError();
	}
}
