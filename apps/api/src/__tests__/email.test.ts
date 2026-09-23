import { describe, expect, test } from "bun:test";
import {
	buildBillingUpgradeRequestEmailContent,
	buildClickHousePurgeFailureAlertContent,
	buildEmailVerificationOtpEmailContent,
	buildInvitationEmailContent,
	buildInvitationLink,
	getBillingUpgradeRequestEmailIdempotencyKey,
	getClickHousePurgeFailureAlertIdempotencyKey,
	getResendConfigWarnings,
	sendBillingUpgradeRequestEmail,
	sendEmailVerificationOtpEmail,
	sendOrganizationInvitationEmail,
	syncSignupContact,
} from "../email.js";
import {
	OPALINE_AUTOMATED_EMAIL_SENDER,
	readResendConfig,
} from "../resend-config.js";

const invitation = {
	frontendURL: "https://opaline.so/",
	invitationId: "invite_123",
	inviteeEmail: "person@example.com",
	inviterName: 'Alice <script>alert("x")</script>\nDoe',
	organizationName: 'Team & "Co"',
};

describe("email helpers", () => {
	test("buildInvitationLink trims trailing slashes", () => {
		expect(buildInvitationLink("https://opaline.so/", "invite_123")).toBe(
			"https://opaline.so/invitation/invite_123",
		);
	});

	test("buildInvitationEmailContent escapes user-controlled HTML", () => {
		const message = buildInvitationEmailContent(invitation);

		expect(message.inviteLink).toBe("https://opaline.so/invitation/invite_123");
		expect(message.subject).toBe(
			'Alice <script>alert("x")</script> Doe invited you to Team & "Co" on Opaline',
		);
		expect(message.html).toContain(
			"Alice &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; Doe",
		);
		expect(message.html).toContain("Team &amp; &quot;Co&quot;");
		expect(message.html).not.toContain("<script>");
	});

	test("buildBillingUpgradeRequestEmailContent escapes names and links to the selected plan", () => {
		const data = {
			billingPeriod: "yearly" as const,
			organizationName: 'Team & "Co"',
			ownerEmail: "owner@example.com",
			plan: "business" as const,
			requesterName: "Alice <script>",
			upgradeUrl:
				"https://opaline.so/pricing/?workspace=team&billing=yearly#business",
		};
		const message = buildBillingUpgradeRequestEmailContent(data);

		expect(message.subject).toBe(
			'Alice <script> requested an Opaline upgrade for Team & "Co"',
		);
		expect(message.html).toContain("Alice &lt;script&gt;");
		expect(message.html).toContain("Team &amp; &quot;Co&quot;");
		expect(message.text).toContain("Business yearly plan");
		expect(message.text).toContain(data.upgradeUrl);
		expect(getBillingUpgradeRequestEmailIdempotencyKey(data)).toBe(
			getBillingUpgradeRequestEmailIdempotencyKey(data),
		);
		expect(
			getBillingUpgradeRequestEmailIdempotencyKey(data).length,
		).toBeLessThan(257);
	});

	test("buildEmailVerificationOtpEmailContent escapes the verification code", () => {
		const message = buildEmailVerificationOtpEmailContent({
			otp: '123<45"',
			type: "sign-in",
		});

		expect(message.subject).toBe("Your Opaline sign-in code");
		expect(message.html).toContain(">Opaline</p>");
		expect(message.html).toContain("sign in to Opaline");
		expect(message.html).toContain("123&lt;45&quot;");
		expect(message.html).not.toContain('123<45"');
		expect(message.text).toContain('123<45"');
		expect(message.html).toContain("Opaline Labs, Inc.<br>2261 Market Street");
		expect(message.html).toContain("San Francisco, CA 94114");
		expect(message.text).toContain(
			"Opaline Labs, Inc.\n2261 Market Street\nSan Francisco, CA 94114",
		);
	});

	test("uses the Opaline sender for automated emails", () => {
		expect(OPALINE_AUTOMATED_EMAIL_SENDER).toBe("Opaline <evren@opaline.so>");
		expect(readResendConfig().fromEmail).toBe(OPALINE_AUTOMATED_EMAIL_SENDER);
	});

	test("buildClickHousePurgeFailureAlertContent includes actionable sanitized fields", () => {
		const message = buildClickHousePurgeFailureAlertContent({
			attemptCount: 5,
			createdAt: new Date("2026-07-28T08:00:00.000Z"),
			failedAt: new Date("2026-07-28T08:15:00.000Z"),
			id: "purge-job-123",
			lastAttemptAt: new Date("2026-07-28T08:14:59.000Z"),
			lastError: "ClickHouseError: request <timed out>",
			targetId: "workspace-456",
			targetType: "organization",
		});

		expect(message.subject).toBe("Opaline ClickHouse purge failed: workspace");
		expect(message.text).toContain("Attempts: 5");
		expect(message.text).toContain("2026-07-28T08:15:00.000Z");
		expect(message.html).toContain(
			"ClickHouseError: request &lt;timed out&gt;",
		);
		expect(message.html).not.toContain("request <timed out>");
	});

	test("ClickHouse purge alerts use one stable provider idempotency key", () => {
		expect(getClickHousePurgeFailureAlertIdempotencyKey("purge-job-123")).toBe(
			"clickhouse-purge-failed/purge-job-123",
		);
	});

	test("getResendConfigWarnings reports disabled email integrations", () => {
		expect(getResendConfigWarnings({ apiKey: "test-key" })).toEqual([
			"Resend emails are disabled because no sender is configured.",
		]);
		expect(
			getResendConfigWarnings({
				apiKey: "test-key",
				fromEmail: "Opaline <noreply@example.com>",
			}),
		).toEqual([
			"ClickHouse purge failure alerts are disabled because CLICKHOUSE_PURGE_ALERT_RECIPIENT is not set.",
		]);
		expect(
			getResendConfigWarnings({
				apiKey: "test-key",
				clickHousePurgeAlertRecipient: "operator@example.com",
				fromEmail: "Opaline <noreply@example.com>",
			}),
		).toEqual([]);
	});

	test("sendOrganizationInvitationEmail returns early when config is incomplete", async () => {
		await expect(
			sendOrganizationInvitationEmail({}, invitation),
		).resolves.toBeUndefined();
		await expect(
			sendOrganizationInvitationEmail({ apiKey: "test-key" }, invitation),
		).resolves.toBeUndefined();
	});

	test("sendEmailVerificationOtpEmail reports failure when config is incomplete", async () => {
		await expect(
			sendEmailVerificationOtpEmail(
				{},
				{ email: "person@example.com", otp: "123456", type: "sign-in" },
			),
		).resolves.toBe(false);
		await expect(
			sendEmailVerificationOtpEmail(
				{ apiKey: "test-key" },
				{ email: "person@example.com", otp: "123456", type: "sign-in" },
			),
		).resolves.toBe(false);
	});

	test("sendBillingUpgradeRequestEmail reports failure when config is incomplete", async () => {
		await expect(
			sendBillingUpgradeRequestEmail(
				{},
				{
					billingPeriod: "monthly",
					organizationName: "Team",
					ownerEmail: "owner@example.com",
					plan: "basic",
					requesterName: "Alice",
					upgradeUrl: "https://opaline.so/pricing/#basic",
				},
			),
		).resolves.toBe(false);
	});

	test("syncSignupContact returns early when config is incomplete", async () => {
		await expect(
			syncSignupContact({}, { email: "person@example.com", name: "Alice Doe" }),
		).resolves.toBeUndefined();
		await expect(
			syncSignupContact(
				{ apiKey: "test-key" },
				{ email: "person@example.com", name: "Alice Doe" },
			),
		).resolves.toBeUndefined();
	});
});
