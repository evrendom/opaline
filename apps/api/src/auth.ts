import { apiKey } from "@better-auth/api-key";
import { getLogger } from "@logtape/logtape";
import { PRODUCT_ANALYTICS_EVENTS } from "@rudel/api-routes";
import * as schema from "@rudel/sql-schema";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import {
	bearer,
	deviceAuthorization,
	emailOTP,
	mcp,
} from "better-auth/plugins";
import { type CRMConfig, syncSignupToCRM } from "./crm.js";
import {
	createDefaultOrganizationWithRetry,
	createOrganizationPlugin,
} from "./auth-organization.js";
import { AUTH_BASE_PATH, normalizeAuthBaseURL } from "./auth-url.js";
import type { ResendConfig } from "./email.js";
import {
	sendEmailVerificationOtpEmail,
	sendOrganizationInvitationEmail,
	sendPasswordResetEmail,
	syncSignupContact,
} from "./email.js";
import { isVercelRuntime } from "./lib/api-runtime.js";
import { captureApiProductAnalyticsEvent } from "./lib/product-analytics.js";
import {
	type PasswordAuthAllowlist,
	passwordAuthAllowlistPlugin,
} from "./password-auth.js";
import {
	enqueueBillingTraitsForUser,
	reconcileOrganizationBillingSeats,
} from "./services/billing.service.js";
import { refreshCustomerAccountSnapshot } from "./services/customer-account-snapshot.service.js";
import { fetchGitHubHandle, notifySignup } from "./slack.js";

const logger = getLogger(["rudel", "api", "auth"]);

function inferSignupMethod(
	accounts: Array<{ providerId?: string | null }>,
	context?: { path?: string },
): "email_otp" | "email_password" | "google" | "github" {
	if (accounts.some((account) => account.providerId === "github")) {
		return "github";
	}
	if (accounts.some((account) => account.providerId === "google")) {
		return "google";
	}
	if (context?.path === "/sign-in/email-otp") {
		return "email_otp";
	}
	return "email_password";
}

function getEmailDomain(email: string) {
	const domain = email.split("@")[1]?.trim().toLowerCase();
	return domain && domain.length > 0 ? domain : "unknown";
}

function formatFallbackName(email: string) {
	const localPart = email.split("@")[0]?.trim();
	if (!localPart) {
		return "Opaline User";
	}

	const words = localPart
		.split(/[._-]+/)
		.map((word) => word.trim())
		.filter(Boolean);
	if (words.length === 0) {
		return localPart;
	}

	return words
		.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
		.join(" ");
}

function getUserDisplayName(user: { email: string; name?: string | null }) {
	const trimmedName = user.name?.trim();
	return trimmedName && trimmedName.length > 0
		? trimmedName
		: formatFallbackName(user.email);
}

function toTrackedOrganizationRole(
	role: string | null | undefined,
): "admin" | "member" {
	return role === "admin" ? "admin" : "member";
}

export interface AuthConfig {
	appURL: string;
	crm: CRMConfig | undefined;
	cookiePrefix?: string;
	frontendURL: string;
	/** Emails allowed to use email+password; defaults to nobody. */
	passwordAuthEmails?: PasswordAuthAllowlist;
	secret: string;
	resend?: ResendConfig;
	socialProviders?: Record<string, { clientId: string; clientSecret: string }>;
	trustedOrigins?: string[];
	cliDeviceVerificationUrl?: string;
	slackWebhookUrl?: string;
}

/**
 * MCP authorization codes are only issued for requests the consent page in
 * handlers/mcp-http.ts forwards with this per-process secret. Any other
 * authorize request, however its path is spelled, is sent to that page.
 */
export const MCP_CONSENT_HEADER = "x-opaline-mcp-consent";
export const MCP_CONSENT_SECRET = crypto.randomUUID();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzleAdapter accepts { [key: string]: any }
export function createAuth(db: object, config: AuthConfig) {
	const authBaseURL = normalizeAuthBaseURL(config.appURL);
	const trustedOrigins = config.trustedOrigins ?? [];
	const resend = config.resend ?? {};
	if (!trustedOrigins.includes(authBaseURL)) {
		trustedOrigins.push(authBaseURL);
	}

	return betterAuth({
		advanced: config.cookiePrefix
			? { cookiePrefix: config.cookiePrefix }
			: undefined,
		basePath: AUTH_BASE_PATH,
		baseURL: authBaseURL,
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (
					ctx.path === "/mcp/authorize" &&
					ctx.request?.headers.get(MCP_CONSENT_HEADER) !== MCP_CONSENT_SECRET
				) {
					const search = ctx.request ? new URL(ctx.request.url).search : "";
					throw ctx.redirect(`/api/mcp/consent${search}`);
				}
				// Refresh grants are answered in handlers/mcp-http.ts, which rotates
				// them; the plugin's session lookup is for server-side calls only.
				if (
					ctx.request &&
					(ctx.path === "/mcp/get-session" ||
						(ctx.path === "/mcp/token" &&
							ctx.body?.grant_type === "refresh_token"))
				) {
					throw new APIError("NOT_FOUND");
				}
			}),
		},
		secret: config.secret,
		database: drizzleAdapter(db as Parameters<typeof drizzleAdapter>[0], {
			provider: "pg",
			schema,
		}),
		rateLimit: {
			customRules: {
				"/organization/set-active": {
					window: 10,
					max: 10,
				},
			},
		},
		emailAndPassword: {
			enabled: true,
			sendResetPassword: async ({ user, url }) => {
				// Vercel functions may freeze after the response, so delivery
				// must complete first. Fly keeps the reset request fast and
				// lets the email send in the background.
				if (isVercelRuntime()) {
					await sendPasswordResetEmail(resend, {
						email: user.email,
						resetUrl: url,
					});
				} else {
					void sendPasswordResetEmail(resend, {
						email: user.email,
						resetUrl: url,
					});
				}
			},
		},
		socialProviders: config.socialProviders,
		plugins: [
			passwordAuthAllowlistPlugin(
				config.passwordAuthEmails ?? { kind: "emails", emails: new Set() },
			),
			emailOTP({
				allowedAttempts: 5,
				expiresIn: 5 * 60,
				otpLength: 6,
				rateLimit: {
					window: 60,
					max: 5,
				},
				storeOTP: "hashed",
				sendVerificationOTP: async ({ email, otp, type }) => {
					const isSent = await sendEmailVerificationOtpEmail(resend, {
						email,
						otp,
						type,
					});
					if (!isSent) {
						throw new Error("Email verification code delivery is unavailable");
					}
				},
			}),
			bearer(),
			apiKey({
				keyExpiration: {
					defaultExpiresIn: null,
				},
				rateLimit: {
					enabled: false,
				},
				permissions: {
					defaultPermissions: {
						ingest: ["write"],
					},
				},
			}),
			deviceAuthorization({
				validateClient: async (clientId) => clientId === "rudel-cli",
				verificationUri: config.cliDeviceVerificationUrl,
			}),
			// OAuth server for MCP clients (Codex, ChatGPT). Every authorization
			// passes the consent page (see MCP_CONSENT_SECRET). The plugin's options
			// type is not exported, so `Auth` could not be named with it; the
			// endpoints are typed in mcp-http.ts instead.
			mcp({
				loginPage: `${config.frontendURL}/login`,
				resource: `${authBaseURL}/api/mcp`,
				oidcConfig: {
					loginPage: `${config.frontendURL}/login`,
					requirePKCE: true,
					allowPlainCodeChallengeMethod: false,
				},
			}) as BetterAuthPlugin,
			createOrganizationPlugin(
				{ frontendURL: config.frontendURL },
				{
					enqueueBillingTraitsForUser,
					logBillingTraitsError: ({ error, userId }) => {
						logger.error(
							"Failed to queue billing traits for removed user {userId}: {error}",
							{ userId, error },
						);
					},
					logSeatReconciliationError: ({ error, organizationId }) => {
						logger.error(
							"Failed to reconcile billing seats for organization {organizationId}: {error}",
							{ organizationId, error },
						);
					},
					reconcileOrganizationBillingSeats,
					sendOrganizationInvitationEmail: (data) =>
						sendOrganizationInvitationEmail(resend, data),
				},
			),
		],
		user: {
			additionalFields: {
				jobTitle: { type: "string", required: false, input: false },
			},
		},
		session: {
			expiresIn: 60 * 60 * 24 * 365,
		},
		trustedOrigins,
		databaseHooks: {
			user: {
				create: {
					after: async (user, ctx) => {
						const adapter = ctx?.context?.adapter;
						let organizationId: string | undefined;
						let isDefaultOrganizationReady = false;
						let accounts: Array<{
							providerId: string;
							accountId: string;
						}> = [];

						try {
							const displayName = getUserDisplayName(user);
							if (adapter) {
								accounts = (await adapter.findMany({
									model: "account",
									where: [{ field: "userId", value: user.id }],
								})) as Array<{ providerId: string; accountId: string }>;

								const org = await createDefaultOrganizationWithRetry({
									create: (data) =>
										adapter.create({
											model: "organization",
											data,
											forceAllowId: true,
										}),
									email: user.email,
									name: `${displayName}'s Workspace`,
									userId: user.id,
								});

								if (org) {
									await adapter.create({
										model: "member",
										data: {
											organizationId: org.id,
											userId: user.id,
											role: "owner",
											createdAt: new Date(),
										},
									});
									organizationId = org.id;
									isDefaultOrganizationReady = true;
								}
							}
						} catch (err) {
							logger.error(
								"Failed to create default organization for user {userId}: {error}",
								{ userId: user.id, error: err },
							);
						}

						if (organizationId) {
							try {
								await refreshCustomerAccountSnapshot(organizationId);
							} catch (err) {
								logger.error(
									"Failed to refresh customer account for new user {userId}: {error}",
									{ error: err, userId: user.id },
								);
							}
						}

						try {
							await enqueueBillingTraitsForUser(user.id);
						} catch (err) {
							logger.error(
								"Failed to queue billing traits for new user {userId}: {error}",
								{ userId: user.id, error: err },
							);
						}

						await captureApiProductAnalyticsEvent({
							distinctId: user.id,
							event: PRODUCT_ANALYTICS_EVENTS.ACCOUNT_SIGNED_UP,
							payload: {
								user_id: user.id,
								signup_method: inferSignupMethod(accounts, ctx ?? undefined),
								is_default_organization_ready: isDefaultOrganizationReady,
								organization_id: organizationId,
							},
						});

						await syncSignupToCRM(config.crm, {
							createdAt: user.createdAt,
							email: user.email,
							id: user.id,
							name: getUserDisplayName(user),
						});

						await syncSignupContact(resend, {
							email: user.email,
							name: getUserDisplayName(user),
						});

						if (!config.slackWebhookUrl || !adapter) {
							return;
						}

						try {
							let githubHandle: string | null = null;
							const githubAccount = accounts.find(
								(account) => account.providerId === "github",
							);
							if (githubAccount) {
								githubHandle = await fetchGitHubHandle(githubAccount.accountId);
							}
							await notifySignup(
								config.slackWebhookUrl,
								{
									email: user.email,
									name: getUserDisplayName(user),
								},
								githubHandle,
							);
						} catch (err) {
							logger.error(
								"Failed to notify signup for user {userId}: {error}",
								{
									userId: user.id,
									error: err,
								},
							);
						}
					},
				},
			},
			invitation: {
				create: {
					after: async (invitation: {
						organizationId: string;
						inviterId: string;
						role: string;
						email: string;
					}) => {
						await captureApiProductAnalyticsEvent({
							distinctId: invitation.inviterId,
							event: PRODUCT_ANALYTICS_EVENTS.INVITE_SENT,
							payload: {
								organization_id: invitation.organizationId,
								inviter_user_id: invitation.inviterId,
								invite_channel: "email",
								invite_role: toTrackedOrganizationRole(invitation.role),
								invitee_email_domain: getEmailDomain(invitation.email),
								source: "settings_members",
							},
						});
					},
				},
			},
			member: {
				create: {
					after: async (
						createdMember: {
							organizationId: string;
							userId: string;
							role: string;
						},
						ctx: {
							context?: {
								adapter?: {
									findMany: (args: {
										model: string;
										where: Array<{ field: string; value: string }>;
									}) => Promise<unknown>;
								};
							};
						},
					) => {
						if (
							createdMember.role === "owner" ||
							createdMember.organizationId === createdMember.userId
						) {
							return;
						}

						const adapter = ctx?.context?.adapter;
						const members = adapter
							? ((await adapter.findMany({
									model: "member",
									where: [
										{
											field: "organizationId",
											value: createdMember.organizationId,
										},
									],
								})) as Array<{ id: string }>)
							: [];

						await captureApiProductAnalyticsEvent({
							distinctId: createdMember.userId,
							event: PRODUCT_ANALYTICS_EVENTS.ORGANIZATION_MEMBER_JOINED,
							payload: {
								organization_id: createdMember.organizationId,
								member_user_id: createdMember.userId,
								join_method: "invite_accept",
								role: toTrackedOrganizationRole(createdMember.role),
								organization_member_count: members.length,
							},
						});
						try {
							await reconcileOrganizationBillingSeats(
								createdMember.organizationId,
							);
						} catch (err) {
							logger.error(
								"Failed to reconcile billing seats for organization {organizationId}: {error}",
								{ organizationId: createdMember.organizationId, error: err },
							);
						}
						try {
							await enqueueBillingTraitsForUser(createdMember.userId);
						} catch (err) {
							logger.error(
								"Failed to queue billing traits for member {userId}: {error}",
								{ userId: createdMember.userId, error: err },
							);
						}
					},
				},
			},
		},
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
