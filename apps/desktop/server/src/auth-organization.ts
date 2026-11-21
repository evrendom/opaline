import { validateOrgSlug } from "@rudel/api-routes/reserved-slugs";
import { APIError } from "better-auth";
import { organization } from "better-auth/plugins";
import type { InvitationEmailData } from "./email.js";

const WORKSPACE_MEMBER_LIMIT = 10_000;

const INVALID_ORGANIZATION_SLUG_MESSAGE =
	"Organization slug is invalid or reserved";

export interface OrganizationPluginConfig {
	readonly frontendURL: string;
}

export interface OrganizationPluginEnvironment {
	readonly sendOrganizationInvitationEmail: (
		data: InvitationEmailData,
	) => Promise<void>;
}

export interface DefaultOrganizationData {
	readonly createdAt: Date;
	readonly id: string;
	readonly name: string;
	readonly slug: string;
}

export function createOrganizationPlugin(
	config: OrganizationPluginConfig,
	env: OrganizationPluginEnvironment,
) {
	return organization({
		allowUserToCreateOrganization: true,
		creatorRole: "owner",
		disableOrganizationDeletion: true,
		membershipLimit: WORKSPACE_MEMBER_LIMIT,
		organizationHooks: {
			async beforeCreateOrganization({ organization: organizationData }) {
				assertValidOrganizationSlug(organizationData.slug ?? "");
			},
			async beforeUpdateOrganization({ organization: organizationData }) {
				if (organizationData.slug !== undefined) {
					assertValidOrganizationSlug(organizationData.slug);
				}
			},
		},
		async sendInvitationEmail(data) {
			await env.sendOrganizationInvitationEmail({
				frontendURL: config.frontendURL,
				invitationId: data.id,
				inviteeEmail: data.email,
				inviterName: data.inviter.user.name,
				organizationName: data.organization.name,
			});
		},
	});
}

export function buildDefaultOrganizationSlug(
	email: string,
	userId: string,
): string {
	// Default-organization creation writes through the raw adapter, so the
	// organization plugin hooks never see this slug. Sanitize to the same
	// DNS-label shape validateOrgSlug enforces and fall back to a random
	// slug when the email local part cannot be salvaged.
	const candidate = `${email.split("@")[0] ?? ""}-${userId.slice(0, 8)}`
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (validateOrgSlug(candidate)) {
		return candidate;
	}
	return buildFallbackOrganizationSlug();
}

export async function createDefaultOrganizationWithRetry<TOrganization>(input: {
	readonly create: (data: DefaultOrganizationData) => Promise<TOrganization>;
	readonly email: string;
	readonly name: string;
	readonly userId: string;
}): Promise<TOrganization> {
	const data = {
		createdAt: new Date(),
		id: input.userId,
		name: input.name,
		slug: buildDefaultOrganizationSlug(input.email, input.userId),
	};
	try {
		return await input.create(data);
	} catch (error) {
		// Distinct users can normalize to the same default slug and hit the
		// unique constraint; retry once with the random fallback instead of
		// leaving the signup without a workspace. Only a slug collision is
		// corrected by changing the slug — every other failure propagates.
		if (!describesSlugUniqueViolation(error)) {
			throw error;
		}
		return await input.create({
			...data,
			slug: buildFallbackOrganizationSlug(),
		});
	}
}

function assertValidOrganizationSlug(slug: string) {
	if (!validateOrgSlug(slug)) {
		throw new APIError("BAD_REQUEST", {
			message: INVALID_ORGANIZATION_SLUG_MESSAGE,
		});
	}
}

function buildFallbackOrganizationSlug(): string {
	return `workspace-${crypto.randomUUID().slice(0, 8)}`;
}

function describesSlugUniqueViolation(error: unknown): boolean {
	let current: unknown = error;
	for (let depth = 0; depth < 5 && current !== undefined; depth++) {
		const message =
			current instanceof Error
				? current.message
				: typeof current === "string"
					? current
					: "";
		if (
			/duplicate key|unique constraint/i.test(message) &&
			/slug/i.test(message)
		) {
			return true;
		}
		current = current instanceof Error ? current.cause : undefined;
	}
	return false;
}
