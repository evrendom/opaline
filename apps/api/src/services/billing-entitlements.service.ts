import type postgres from "postgres";
import { sqlClient } from "../db.js";

export const FREE_WORKSPACE_MEMBER_LIMIT = 3;
export const FREE_WORKSPACE_MONTHLY_AGENT_RUN_LIMIT = 50_000;
const PAID_WORKSPACE_MEMBER_LIMIT = 10_000;

export class FreeWorkspaceMemberLimitExceededError extends Error {
	constructor() {
		super(
			`Free workspaces support up to ${FREE_WORKSPACE_MEMBER_LIMIT} members`,
		);
		this.name = "FreeWorkspaceMemberLimitExceededError";
	}
}

export class FreeWorkspaceMonthlyAgentRunLimitExceededError extends Error {
	constructor() {
		super(
			`Free workspaces support up to ${FREE_WORKSPACE_MONTHLY_AGENT_RUN_LIMIT} agent runs per month`,
		);
		this.name = "FreeWorkspaceMonthlyAgentRunLimitExceededError";
	}
}

export async function getOrganizationMemberLimit(
	organizationId: string,
): Promise<number> {
	return (await organizationHasPaidAccess(organizationId))
		? PAID_WORKSPACE_MEMBER_LIMIT
		: FREE_WORKSPACE_MEMBER_LIMIT;
}

export async function assertCanAddOrganizationMember(
	transaction: postgres.TransactionSql,
	organizationId: string,
	userId: string,
): Promise<boolean> {
	await transaction.unsafe(
		"SELECT pg_advisory_xact_lock(731825, hashtext($1))",
		[organizationId],
	);
	const [state] = await transaction.unsafe<
		Array<{ already_member: boolean; member_count: number; paid: boolean }>
	>(
		`SELECT
			EXISTS (
				SELECT 1 FROM member
				WHERE organization_id = $1 AND user_id = $2
			) AS already_member,
			(SELECT COUNT(*)::int FROM member WHERE organization_id = $1) AS member_count,
			EXISTS (
				SELECT 1 FROM billing_subscription
					WHERE organization_id = $1 AND status IN ('active', 'trialing', 'past_due')
			) AS paid`,
		[organizationId, userId],
	);
	if (!state) throw new Error("Workspace membership state is unavailable");
	if (state.already_member) return false;
	if (!state.paid && state.member_count >= FREE_WORKSPACE_MEMBER_LIMIT) {
		throw new FreeWorkspaceMemberLimitExceededError();
	}
	return true;
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

export async function organizationHasPaidAccess(
	organizationId: string,
): Promise<boolean> {
	const [row] = await sqlClient.unsafe<Array<{ paid: boolean }>>(
		`SELECT EXISTS (
			SELECT 1 FROM billing_subscription
			WHERE organization_id = $1 AND status IN ('active', 'trialing', 'past_due')
		) AS paid`,
		[organizationId],
	);
	return row?.paid ?? false;
}
