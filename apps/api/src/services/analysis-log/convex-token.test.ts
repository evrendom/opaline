import { expect, test } from "bun:test";
import { z } from "zod";
import {
	createSigningKeys,
	createTokenSource,
	parseSigningKey,
} from "./convex-token.js";

const JwksSchema = z.object({
	keys: z.array(
		z.object({
			kty: z.literal("EC"),
			crv: z.literal("P-256"),
			kid: z.string(),
			x: z.string(),
			y: z.string(),
			alg: z.literal("ES256"),
			use: z.literal("sig"),
		}),
	),
});
const JWKS_PREFIX = "data:text/plain;charset=utf-8;base64,";

test("tokens verify against the published key set and carry the claims Convex checks", async () => {
	const { signingKey, jwks } = await createSigningKeys();
	expect(jwks.startsWith(JWKS_PREFIX)).toBe(true);
	const [publicKey, ...others] = JwksSchema.parse(
		JSON.parse(
			Buffer.from(jwks.slice(JWKS_PREFIX.length), "base64").toString(),
		),
	).keys;
	expect(others).toEqual([]);
	expect(publicKey?.kid).toBe(signingKey.kid);
	expect(JSON.stringify(publicKey)).not.toContain(signingKey.d);

	const now = Date.parse("2026-10-03T10:00:00Z");
	const token = await createTokenSource(signingKey, () => now)();
	const [header = "", payload = "", signature = ""] = token.split(".");
	expect(decode(header)).toEqual({
		alg: "ES256",
		typ: "JWT",
		kid: signingKey.kid,
	});
	expect(decode(payload)).toEqual({
		iss: "https://opaline.so/analysis-log",
		sub: "opaline-api",
		aud: "opaline-analysis-log",
		iat: now / 1000,
		exp: now / 1000 + 3600,
	});
	const verifier = await crypto.subtle.importKey(
		"jwk",
		{ kty: "EC", crv: "P-256", x: publicKey?.x, y: publicKey?.y },
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["verify"],
	);
	expect(
		await crypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			verifier,
			Buffer.from(signature, "base64url"),
			new TextEncoder().encode(`${header}.${payload}`),
		),
	).toBe(true);
});

test("a token is reused until five minutes before it expires", async () => {
	const { signingKey } = await createSigningKeys();
	const clock = { now: Date.parse("2026-10-03T10:00:00Z") };
	const token = createTokenSource(signingKey, () => clock.now);
	const first = await token();
	clock.now += 55 * 60_000;
	expect(await token()).toBe(first);
	clock.now += 1_000;
	expect(await token()).not.toBe(first);
});

test("only a P-256 private JWK is accepted as the signing key", async () => {
	const { signingKey } = await createSigningKeys();
	expect(parseSigningKey(JSON.stringify(signingKey))).toEqual(signingKey);
	expect(parseSigningKey("")).toBeNull();
	expect(parseSigningKey("{")).toBeNull();
	expect(
		parseSigningKey(JSON.stringify({ ...signingKey, crv: "P-384" })),
	).toBeNull();
});

function decode(part: string): unknown {
	return JSON.parse(Buffer.from(part, "base64url").toString());
}
