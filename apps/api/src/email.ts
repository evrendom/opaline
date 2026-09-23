import { createHash } from "node:crypto";
import { getLogger } from "@logtape/logtape";
import type {
	OpalineBillingPeriod,
	OpalineBillingPlan,
} from "@rudel/api-routes";
import { Resend } from "resend";

const logger = getLogger(["rudel", "api", "email"]);

export interface ResendConfig {
	apiKey?: string;
	audienceId?: string;
	clickHousePurgeAlertRecipient?: string;
	fromEmail?: string;
}

export interface InvitationEmailData {
	frontendURL: string;
	invitationId: string;
	inviteeEmail: string;
	inviterName: string;
	organizationName: string;
}

export interface InvitationEmailContent {
	inviteLink: string;
	subject: string;
	html: string;
	text: string;
}

export interface BillingUpgradeRequestEmailData {
	billingPeriod: OpalineBillingPeriod;
	organizationName: string;
	ownerEmail: string;
	plan: OpalineBillingPlan;
	requesterName: string;
	upgradeUrl: string;
}

export interface BillingUpgradeRequestEmailContent {
	html: string;
	subject: string;
	text: string;
}

export interface PasswordResetEmailContent {
	subject: string;
	html: string;
	text: string;
}

export type EmailVerificationOtpType =
	| "change-email"
	| "email-verification"
	| "forget-password"
	| "sign-in";

export interface EmailVerificationOtpEmailContent {
	subject: string;
	html: string;
	text: string;
}

export interface ClickHousePurgeFailureAlertData {
	attemptCount: number;
	createdAt: Date;
	failedAt: Date;
	id: string;
	lastAttemptAt: Date;
	lastError: string;
	targetId: string;
	targetType: "account" | "organization";
}

export interface ClickHousePurgeFailureAlertContent {
	html: string;
	subject: string;
	text: string;
}

export function getResendConfigWarnings(config: ResendConfig): string[] {
	if (!config.apiKey) {
		return [];
	}

	if (!config.fromEmail) {
		return ["Resend emails are disabled because no sender is configured."];
	}

	if (!config.clickHousePurgeAlertRecipient) {
		return [
			"ClickHouse purge failure alerts are disabled because CLICKHOUSE_PURGE_ALERT_RECIPIENT is not set.",
		];
	}

	return [];
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function normalizeText(value: string): string {
	return value.replace(/[\r\n]+/g, " ").trim();
}

function splitName(name: string) {
	const [firstName = "", ...rest] = normalizeText(name)
		.split(/\s+/)
		.filter(Boolean);

	return {
		firstName: firstName || undefined,
		lastName: rest.join(" ") || undefined,
	};
}

export function buildInvitationLink(
	frontendURL: string,
	invitationId: string,
): string {
	const trimmedFrontendURL = frontendURL.replace(/\/+$/, "");
	return `${trimmedFrontendURL}/invitation/${invitationId}`;
}

export function buildInvitationEmailContent(
	data: InvitationEmailData,
): InvitationEmailContent {
	const inviterName = normalizeText(data.inviterName);
	const organizationName = normalizeText(data.organizationName);
	const inviteLink = buildInvitationLink(data.frontendURL, data.invitationId);

	return {
		inviteLink,
		subject: `${inviterName} invited you to ${organizationName} on Opaline`,
		html: `
<p>Hi,</p>
<p><strong>${escapeHtml(inviterName)}</strong> has invited you to join <strong>${escapeHtml(organizationName)}</strong> on Opaline.</p>
<p>
  <a href="${escapeHtml(inviteLink)}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
    Accept Invitation
  </a>
</p>
<p>Or copy this link into your browser:</p>
<p>${escapeHtml(inviteLink)}</p>
`,
		text: `${inviterName} invited you to join ${organizationName} on Opaline.\n\nAccept the invitation here: ${inviteLink}`,
	};
}

export function buildBillingUpgradeRequestEmailContent(
	data: BillingUpgradeRequestEmailData,
): BillingUpgradeRequestEmailContent {
	const requesterName = normalizeText(data.requesterName);
	const organizationName = normalizeText(data.organizationName);
	const planName = data.plan === "business" ? "Business" : "Basic";
	const billingPeriod = data.billingPeriod === "yearly" ? "yearly" : "monthly";
	const upgradeUrl = normalizeText(data.upgradeUrl);

	return {
		subject: `${requesterName} requested an Opaline upgrade for ${organizationName}`,
		html: `
<p>Hi,</p>
<p><strong>${escapeHtml(requesterName)}</strong> would like to upgrade <strong>${escapeHtml(organizationName)}</strong> to the ${planName} ${billingPeriod} plan.</p>
<p>Only a workspace owner can approve billing changes.</p>
<p>
  <a href="${escapeHtml(upgradeUrl)}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
    Review upgrade
  </a>
</p>
<p>Or copy this link into your browser:</p>
<p>${escapeHtml(upgradeUrl)}</p>
`,
		text: `${requesterName} would like to upgrade ${organizationName} to the ${planName} ${billingPeriod} plan.\n\nOnly a workspace owner can approve billing changes.\n\nReview the upgrade: ${upgradeUrl}`,
	};
}

export function getBillingUpgradeRequestEmailIdempotencyKey(
	data: BillingUpgradeRequestEmailData,
): string {
	const digest = createHash("sha256")
		.update(
			JSON.stringify([
				data.billingPeriod,
				data.organizationName,
				data.ownerEmail,
				data.plan,
				data.requesterName,
				data.upgradeUrl,
			]),
		)
		.digest("hex");
	return `billing-upgrade-request/${digest}`;
}

export function buildPasswordResetEmailContent(
	resetUrl: string,
): PasswordResetEmailContent {
	const safeUrl = normalizeText(resetUrl);

	return {
		subject: "Reset your Opaline password",
		html: `
<p>We received a request to reset your Opaline password.</p>
<p>
  <a href="${escapeHtml(safeUrl)}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
    Reset Password
  </a>
</p>
<p>Or copy this link into your browser:</p>
<p>${escapeHtml(safeUrl)}</p>
`,
		text: `We received a request to reset your Opaline password.\n\nReset your password here: ${safeUrl}`,
	};
}

function getEmailVerificationOtpSubject(type: EmailVerificationOtpType) {
	if (type === "change-email") {
		return "Verify your new Opaline email";
	}

	if (type === "forget-password") {
		return "Reset your Opaline password";
	}

	if (type === "email-verification") {
		return "Verify your Opaline email";
	}

	return "Your Opaline sign-in code";
}

export function buildEmailVerificationOtpEmailContent(data: {
	otp: string;
	type: EmailVerificationOtpType;
}): EmailVerificationOtpEmailContent {
	const safeOtp = normalizeText(data.otp);
	const subject = getEmailVerificationOtpSubject(data.type);
	const action =
		data.type === "forget-password"
			? "reset your Opaline password"
			: data.type === "change-email" || data.type === "email-verification"
				? "verify your Opaline email"
				: "sign in to Opaline";

	return {
		subject,
		html: `
<div style="max-width:480px;margin:0 auto;padding:32px 24px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#171717;">
  <p style="margin:0 0 32px;font-size:16px;font-weight:650;letter-spacing:-0.02em;">Opaline</p>
  <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;letter-spacing:-0.025em;">Your verification code</h1>
  <p style="margin:0 0 24px;color:#737373;font-size:14px;line-height:1.6;">Use this code to ${action}.</p>
  <p style="margin:0 0 24px;padding:16px 18px;border:1px solid #e5e5e5;border-radius:8px;background:#fafafa;font-size:28px;font-weight:650;letter-spacing:6px;line-height:1;text-align:center;">${escapeHtml(safeOtp)}</p>
  <p style="margin:0;color:#737373;font-size:12px;line-height:1.6;">This code expires in 5 minutes. If you did not request it, you can ignore this email.</p>
  <p style="margin:32px 0 0;padding-top:20px;border-top:1px solid #e5e5e5;color:#a3a3a3;font-size:11px;line-height:1.6;">Opaline Labs, Inc.<br>2261 Market Street<br>San Francisco, CA 94114</p>
</div>
`,
		text: `Opaline\n\nYour verification code is: ${safeOtp}\n\nUse this code to ${action}. It expires in 5 minutes. If you did not request it, you can ignore this email.\n\nOpaline Labs, Inc.\n2261 Market Street\nSan Francisco, CA 94114`,
	};
}

export function buildClickHousePurgeFailureAlertContent(
	data: ClickHousePurgeFailureAlertData,
): ClickHousePurgeFailureAlertContent {
	const targetLabel =
		data.targetType === "organization" ? "workspace" : "account";
	const targetId = normalizeText(data.targetId);
	const lastError = normalizeText(data.lastError);
	const createdAt = data.createdAt.toISOString();
	const lastAttemptAt = data.lastAttemptAt.toISOString();
	const failedAt = data.failedAt.toISOString();

	return {
		subject: `Opaline ClickHouse purge failed: ${targetLabel}`,
		html: `
<p>An Opaline ClickHouse ${escapeHtml(targetLabel)} purge exhausted all retry attempts.</p>
<dl>
  <dt>Job ID</dt><dd>${escapeHtml(data.id)}</dd>
  <dt>Target</dt><dd>${escapeHtml(targetLabel)} ${escapeHtml(targetId)}</dd>
  <dt>Attempts</dt><dd>${data.attemptCount}</dd>
  <dt>Created</dt><dd>${createdAt}</dd>
  <dt>Last attempt</dt><dd>${lastAttemptAt}</dd>
  <dt>Failed</dt><dd>${failedAt}</dd>
  <dt>Sanitized error</dt><dd>${escapeHtml(lastError)}</dd>
</dl>
`,
		text: [
			`An Opaline ClickHouse ${targetLabel} purge exhausted all retry attempts.`,
			`Job ID: ${data.id}`,
			`Target: ${targetLabel} ${targetId}`,
			`Attempts: ${data.attemptCount}`,
			`Created: ${createdAt}`,
			`Last attempt: ${lastAttemptAt}`,
			`Failed: ${failedAt}`,
			`Sanitized error: ${lastError}`,
		].join("\n"),
	};
}

export function getClickHousePurgeFailureAlertIdempotencyKey(
	jobId: string,
): string {
	return `clickhouse-purge-failed/${jobId}`;
}

export async function syncSignupContact(
	config: ResendConfig,
	user: { email: string; name: string },
): Promise<void> {
	if (!config.apiKey || !config.audienceId) {
		return;
	}

	const name = splitName(user.name);

	try {
		const resend = new Resend(config.apiKey);
		await resend.contacts.create({
			audienceId: config.audienceId,
			email: user.email,
			firstName: name.firstName,
			lastName: name.lastName,
		});
	} catch (err) {
		logger.error("Failed to add Resend contact for {email}: {error}", {
			email: user.email,
			error: err,
		});
	}
}

export async function sendOrganizationInvitationEmail(
	config: ResendConfig,
	data: InvitationEmailData,
): Promise<void> {
	if (!config.apiKey || !config.fromEmail) {
		return;
	}

	const message = buildInvitationEmailContent(data);

	try {
		const resend = new Resend(config.apiKey);
		await resend.emails.send({
			from: config.fromEmail,
			to: data.inviteeEmail,
			subject: message.subject,
			html: message.html,
			text: message.text,
		});
		logger.info("Invitation email sent to {email}", {
			email: data.inviteeEmail,
		});
	} catch (err) {
		logger.error("Failed to send invitation email to {email}: {error}", {
			email: data.inviteeEmail,
			error: err,
		});
	}
}

export async function sendBillingUpgradeRequestEmail(
	config: ResendConfig,
	data: BillingUpgradeRequestEmailData,
): Promise<boolean> {
	if (!config.apiKey || !config.fromEmail) {
		return false;
	}

	const message = buildBillingUpgradeRequestEmailContent(data);
	try {
		const resend = new Resend(config.apiKey);
		const response = await resend.emails.send(
			{
				from: config.fromEmail,
				to: data.ownerEmail,
				subject: message.subject,
				html: message.html,
				text: message.text,
			},
			{
				idempotencyKey: getBillingUpgradeRequestEmailIdempotencyKey(data),
			},
		);
		if (response.error) {
			logger.error(
				"Resend rejected a billing upgrade request email for {email}: {error}",
				{ email: data.ownerEmail, error: response.error },
			);
			return false;
		}
		logger.info("Billing upgrade request email sent to {email}", {
			email: data.ownerEmail,
		});
		return true;
	} catch (err) {
		logger.error(
			"Failed to send billing upgrade request email to {email}: {error}",
			{ email: data.ownerEmail, error: err },
		);
		return false;
	}
}

export async function sendPasswordResetEmail(
	config: ResendConfig,
	data: { email: string; resetUrl: string },
): Promise<void> {
	if (!config.apiKey || !config.fromEmail) {
		return;
	}

	const message = buildPasswordResetEmailContent(data.resetUrl);

	try {
		const resend = new Resend(config.apiKey);
		await resend.emails.send({
			from: config.fromEmail,
			to: data.email,
			subject: message.subject,
			html: message.html,
			text: message.text,
		});
		logger.info("Password reset email sent to {email}", {
			email: data.email,
		});
	} catch (err) {
		logger.error("Failed to send password reset email to {email}: {error}", {
			email: data.email,
			error: err,
		});
	}
}

export async function sendEmailVerificationOtpEmail(
	config: ResendConfig,
	data: {
		email: string;
		otp: string;
		type: EmailVerificationOtpType;
	},
): Promise<boolean> {
	if (!config.apiKey || !config.fromEmail) {
		return false;
	}

	const message = buildEmailVerificationOtpEmailContent({
		otp: data.otp,
		type: data.type,
	});

	try {
		const resend = new Resend(config.apiKey);
		await resend.emails.send({
			from: config.fromEmail,
			to: data.email,
			subject: message.subject,
			html: message.html,
			text: message.text,
		});
		logger.info("Email verification code sent to {email}", {
			email: data.email,
		});
		return true;
	} catch (err) {
		logger.error("Failed to send email verification code to {email}: {error}", {
			email: data.email,
			error: err,
		});
		return false;
	}
}

export async function sendClickHousePurgeFailureAlert(
	config: ResendConfig,
	data: ClickHousePurgeFailureAlertData,
): Promise<void> {
	if (
		!config.apiKey ||
		!config.fromEmail ||
		!config.clickHousePurgeAlertRecipient
	) {
		throw new Error(
			"Resend is not configured for ClickHouse purge failure alerts",
		);
	}

	const message = buildClickHousePurgeFailureAlertContent(data);
	const resend = new Resend(config.apiKey);
	const response = await resend.emails.send(
		{
			from: config.fromEmail,
			to: config.clickHousePurgeAlertRecipient,
			subject: message.subject,
			html: message.html,
			text: message.text,
		},
		{
			idempotencyKey: getClickHousePurgeFailureAlertIdempotencyKey(data.id),
		},
	);

	if (response.error) {
		throw new Error(
			`Resend rejected ClickHouse purge alert (${response.error.name}): ${response.error.message}`,
		);
	}
}
