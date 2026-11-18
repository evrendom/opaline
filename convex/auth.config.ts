import type { AuthConfig } from "convex/server";
import { API_AUDIENCE, API_ISSUER } from "./identity";

const jwks = process.env.ANALYSIS_LOG_JWKS;
if (!jwks)
	throw new Error(
		"Set ANALYSIS_LOG_JWKS in this Convex deployment before pushing (see convex/README.md)",
	);

export default {
	providers: [
		{
			type: "customJwt",
			issuer: API_ISSUER,
			applicationID: API_AUDIENCE,
			jwks,
			algorithm: "ES256",
		},
	],
} satisfies AuthConfig;
