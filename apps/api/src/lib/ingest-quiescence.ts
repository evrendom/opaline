import { createHash, timingSafeEqual } from "node:crypto";

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
	const configuredDigest = createHash("sha256")
		.update(configuredToken, "utf8")
		.digest();
	const presentedDigest = createHash("sha256")
		.update(presentedToken, "utf8")
		.digest();
	return timingSafeEqual(configuredDigest, presentedDigest);
}
