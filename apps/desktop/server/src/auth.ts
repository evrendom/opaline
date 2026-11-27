import { apiKey } from "@better-auth/api-key";
import { getLogger } from "@logtape/logtape";
import * as schema from "@rudel/sql-schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, deviceAuthorization, emailOTP } from "better-auth/plugins";
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
import {
	type PasswordAuthAllowlist,
	passwordAuthAllowlistPlugin,
} from "./password-auth.js";
import { selfHostedLoginPlugin } from "./selfhost/login-plugin.js";
import { fetchGitHubHandle, notifySignup } from "./slack.js";

const logger = getLogger(["rudel", "api", "auth"]);

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

export interface AuthConfig {
	appURL: string;
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
	selfHostedLogin?: (token: string) => Promise<string | null>;
	beforeUserCreate?: (
		user: { email: string },
		request: Request | undefined,
	) => Promise<void>;
}

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
				void sendPasswordResetEmail(resend, {
					email: user.email,
					resetUrl: url,
				});
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
			...((config.selfHostedLogin
				? [selfHostedLoginPlugin(config.selfHostedLogin)]
				: []) as []),
			createOrganizationPlugin(
				{ frontendURL: config.frontendURL },
				{
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
					...(config.beforeUserCreate
						? {
								before: async (
									user: { email: string },
									ctx: { request?: Request } | null,
								) => {
									await config.beforeUserCreate?.(user, ctx?.request);
								},
							}
						: {}),
					after: async (user, ctx) => {
						const adapter = ctx?.context?.adapter;
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
								}
							}
						} catch (err) {
							logger.error(
								"Failed to create default organization for user {userId}: {error}",
								{ userId: user.id, error: err },
							);
						}

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
		},
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
