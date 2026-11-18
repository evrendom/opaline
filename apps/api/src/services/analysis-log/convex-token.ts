import { z } from "zod";

/** The claims convex/identity.ts and convex/auth.config.ts accept. */
const ISSUER = "https://opaline.so/analysis-log";
const AUDIENCE = "opaline-analysis-log";
const SUBJECT = "opaline-api";
const TOKEN_LIFETIME_SECONDS = 60 * 60;
const RENEW_BEFORE_SECONDS = 5 * 60;
const KEY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN_ALGORITHM = { name: "ECDSA", hash: "SHA-256" } as const;

const SigningKeySchema = z.object({
	kty: z.literal("EC"),
	crv: z.literal("P-256"),
	kid: z.string().min(1),
	x: z.string().min(1),
	y: z.string().min(1),
	d: z.string().min(1),
});

/** The API's private ES256 key as a JWK (`ANALYSIS_LOG_SIGNING_KEY`). */
export type SigningKey = z.infer<typeof SigningKeySchema>;

/** The signing key in `value`, or null when it is not a P-256 private JWK. */
export function parseSigningKey(value: string): SigningKey | null {
	try {
		return SigningKeySchema.parse(JSON.parse(value));
	} catch {
		return null;
	}
}

/**
 * Tokens that authenticate the API to Convex. One token is reused until five
 * minutes before it expires.
 */
export function createTokenSource(
	key: SigningKey,
	now: () => number = Date.now,
): () => Promise<string> {
	let current: { token: string; expiresAt: number } | undefined;
	return async () => {
		const issuedAt = Math.floor(now() / 1000);
		if (!current || current.expiresAt - issuedAt < RENEW_BEFORE_SECONDS)
			current = {
				token: await signToken(key, apiClaims(issuedAt)),
				expiresAt: issuedAt + TOKEN_LIFETIME_SECONDS,
			};
		return current.token;
	};
}

/**
 * A new key pair: the private JWK for the API and the public key set as the
 * data URI Convex reads from `ANALYSIS_LOG_JWKS`.
 */
export async function createSigningKeys(): Promise<{
	signingKey: SigningKey;
	jwks: string;
}> {
	const pair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, [
		"sign",
		"verify",
	]);
	const { kty, crv, x, y, d } = await crypto.subtle.exportKey(
		"jwk",
		pair.privateKey,
	);
	const signingKey = SigningKeySchema.parse({
		kty,
		crv,
		kid: crypto.randomUUID(),
		x,
		y,
		d,
	});
	const publicKey = {
		kty,
		crv,
		x,
		y,
		kid: signingKey.kid,
		alg: "ES256",
		use: "sig",
	};
	const jwks = Buffer.from(JSON.stringify({ keys: [publicKey] })).toString(
		"base64",
	);
	return { signingKey, jwks: `data:text/plain;charset=utf-8;base64,${jwks}` };
}

/** The claims of an API token issued at `issuedAt` (seconds). */
export function apiClaims(issuedAt: number) {
	return {
		iss: ISSUER,
		sub: SUBJECT,
		aud: AUDIENCE,
		iat: issuedAt,
		exp: issuedAt + TOKEN_LIFETIME_SECONDS,
	};
}

/** An ES256 JWT of `claims`; the integration test also signs claims Convex must reject. */
export async function signToken(
	key: SigningKey,
	claims: object,
): Promise<string> {
	const header = base64UrlJson({ alg: "ES256", typ: "JWT", kid: key.kid });
	const payload = base64UrlJson(claims);
	const { kty, crv, x, y, d } = key;
	const privateKey = await crypto.subtle.importKey(
		"jwk",
		{ kty, crv, x, y, d },
		KEY_ALGORITHM,
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		SIGN_ALGORITHM,
		privateKey,
		new TextEncoder().encode(`${header}.${payload}`),
	);
	return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}

function base64UrlJson(value: object): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}
