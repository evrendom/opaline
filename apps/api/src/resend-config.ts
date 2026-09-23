import type { ResendConfig } from "./email.js";

export const OPALINE_AUTOMATED_EMAIL_SENDER = "Opaline <evren@opaline.so>";

export function readResendConfig(): ResendConfig {
	return {
		apiKey: process.env.RESEND_API_KEY,
		audienceId: process.env.RESEND_AUDIENCE_ID,
		clickHousePurgeAlertRecipient:
			process.env.CLICKHOUSE_PURGE_ALERT_RECIPIENT?.trim() || undefined,
		fromEmail: OPALINE_AUTOMATED_EMAIL_SENDER,
	};
}
