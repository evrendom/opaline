import { createHmac, timingSafeEqual } from "node:crypto";
import type { DigestKind } from "./schedule.js";

// Unsubscribe links work without a session (one click from the mail client,
// or the client's own List-Unsubscribe POST), so each carries an HMAC over
// the member, workspace and digest it turns off. They do not expire: the most
// an old link can do is turn the same digest off again.

export const UNSUBSCRIBE_PATH = "/api/usage-digest/unsubscribe";

export interface UnsubscribeTarget {
	kind: DigestKind;
	userId: string;
	organizationId: string;
}

function sign(secret: string, payload: string): string {
	return createHmac("sha256", secret)
		.update(`usage-digest-unsubscribe:${payload}`)
		.digest("base64url");
}

export function createUnsubscribeToken(
	secret: string,
	target: UnsubscribeTarget,
): string {
	const payload = Buffer.from(
		JSON.stringify([target.kind, target.userId, target.organizationId]),
	).toString("base64url");
	return `${payload}.${sign(secret, payload)}`;
}

export function readUnsubscribeToken(
	secret: string,
	token: string,
): UnsubscribeTarget | null {
	const [payload, signature, extra] = token.split(".");
	if (!payload || !signature || extra !== undefined) return null;
	const expected = Buffer.from(sign(secret, payload));
	const actual = Buffer.from(signature);
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
		return null;
	let fields: unknown;
	try {
		fields = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	} catch {
		return null;
	}
	if (!Array.isArray(fields)) return null;
	const [kind, userId, organizationId] = fields as unknown[];
	return (kind === "daily" || kind === "weekly") &&
		typeof userId === "string" &&
		typeof organizationId === "string"
		? { kind, userId, organizationId }
		: null;
}
