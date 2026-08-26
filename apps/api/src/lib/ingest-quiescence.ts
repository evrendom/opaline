import { timingSafeEqual } from "node:crypto";

export const INGEST_OPERATOR_TOKEN_HEADER =
	"x-rudel-session-ingest-operator-token";

export function isAuthorizedIngestOperatorRequest(
	headers: Headers,
	configuredToken: string | undefined = process.env
		.SESSION_INGEST_OPERATOR_TOKEN,
): boolean {
	if (!configuredToken) return false;
	const presentedToken = headers.get(INGEST_OPERATOR_TOKEN_HEADER);
	if (!presentedToken) return false;
	const configuredBytes = Buffer.from(configuredToken, "utf8");
	const presentedBytes = Buffer.from(presentedToken, "utf8");
	return (
		configuredBytes.length === presentedBytes.length &&
		timingSafeEqual(configuredBytes, presentedBytes)
	);
}
