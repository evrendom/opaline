import type {
	OpalineBillingPeriod,
	OpalineBillingPlan,
} from "@rudel/api-routes";
import { sqlClient } from "../db.js";
import { type ResendConfig, sendBillingUpgradeRequestEmail } from "../email.js";

interface BillingUpgradeRequestRecipient {
	organization_name: string;
	owner_email: string;
	requester_name: string;
	requester_role: string;
	workspace_slug: string;
}

export interface BillingUpgradeRequestEnvironment {
	readonly frontendOrigin: string;
	readonly resend: ResendConfig;
}

export class BillingUpgradeRequestForbiddenError extends Error {}
export class BillingUpgradeRequestOwnerError extends Error {}

export async function requestOrganizationBillingUpgrade(
	input: {
		readonly billingPeriod: OpalineBillingPeriod;
		readonly organizationId: string;
		readonly plan: OpalineBillingPlan;
		readonly requesterUserId: string;
	},
	env: BillingUpgradeRequestEnvironment,
): Promise<void> {
	const [recipient] = await sqlClient.unsafe<BillingUpgradeRequestRecipient[]>(
		`SELECT
			organization.name AS organization_name,
			owner_user.email AS owner_email,
			requester_user.name AS requester_name,
			requester.role AS requester_role,
			organization.slug AS workspace_slug
		FROM member requester
		INNER JOIN "user" requester_user ON requester_user.id = requester.user_id
		INNER JOIN organization ON organization.id = requester.organization_id
		INNER JOIN member owner_member
			ON owner_member.organization_id = organization.id
			AND owner_member.role = 'owner'
		INNER JOIN "user" owner_user ON owner_user.id = owner_member.user_id
		WHERE requester.organization_id = $1
			AND requester.user_id = $2
		ORDER BY owner_member.created_at, owner_member.id
		LIMIT 1`,
		[input.organizationId, input.requesterUserId],
	);
	if (!recipient) {
		throw new BillingUpgradeRequestForbiddenError(
			"The requested workspace is not available to this user",
		);
	}
	if (recipient.requester_role === "owner") {
		throw new BillingUpgradeRequestOwnerError(
			"Workspace owners can upgrade directly",
		);
	}

	const upgradeUrl = buildBillingUpgradeUrl({
		billingPeriod: input.billingPeriod,
		frontendOrigin: env.frontendOrigin,
		plan: input.plan,
		workspaceSlug: recipient.workspace_slug,
	});
	const sent = await sendBillingUpgradeRequestEmail(env.resend, {
		billingPeriod: input.billingPeriod,
		organizationName: recipient.organization_name,
		ownerEmail: recipient.owner_email,
		plan: input.plan,
		requesterName: recipient.requester_name,
		upgradeUrl,
	});
	if (!sent) {
		throw new Error("Billing upgrade request email delivery is unavailable");
	}
}

function buildBillingUpgradeUrl(input: {
	billingPeriod: OpalineBillingPeriod;
	frontendOrigin: string;
	plan: OpalineBillingPlan;
	workspaceSlug: string;
}): string {
	const url = new URL("/pricing/", input.frontendOrigin);
	url.searchParams.set("workspace", input.workspaceSlug);
	url.searchParams.set("billing", input.billingPeriod);
	url.hash = input.plan;
	return url.toString();
}
