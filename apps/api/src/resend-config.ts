import type { ResendConfig } from "./email.js";

/**
 * Every automated email (sign-up codes, password resets, invites, billing,
 * usage digests) comes from the notifications subdomain, apart from product
 * updates and from people's own mail at opaline.so; replies reach a person.
 */
export const OPALINE_AUTOMATED_EMAIL_SENDER =
	"Opaline <notifications@mail.opaline.so>";
export const OPALINE_REPLY_TO = "Opaline <evren@opaline.so>";

export function readResendConfig(): ResendConfig {
	return {
		apiKey: process.env.RESEND_API_KEY,
		audienceId: process.env.RESEND_AUDIENCE_ID,
		clickHousePurgeAlertRecipient:
			process.env.CLICKHOUSE_PURGE_ALERT_RECIPIENT?.trim() || undefined,
		fromEmail: OPALINE_AUTOMATED_EMAIL_SENDER,
		replyTo: OPALINE_REPLY_TO,
	};
}
