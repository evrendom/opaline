import { createHash, randomBytes, randomUUID } from "node:crypto";
import type postgres from "postgres";

export const LOGIN_TOKEN_TTL_SECONDS = 600;
const IDENTIFIER_PREFIX = "selfhost-login:";

function identifierFor(token: string): string {
	return `${IDENTIFIER_PREFIX}${createHash("sha256").update(token).digest("hex")}`;
}

export async function issueLoginToken(
	sql: postgres.Sql,
	userId: string,
): Promise<string> {
	const token = randomBytes(32).toString("base64url");
	await sql`
		INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
		VALUES (
			${randomUUID()}, ${identifierFor(token)}, ${userId},
			now() + make_interval(secs => ${LOGIN_TOKEN_TTL_SECONDS}), now(), now()
		)
	`;
	return token;
}

export async function consumeLoginToken(
	sql: postgres.Sql,
	token: string,
): Promise<string | null> {
	if (!/^[A-Za-z0-9_-]{16,128}$/u.test(token)) return null;
	const [row] = await sql<{ value: string; live: boolean }[]>`
		DELETE FROM verification
		WHERE identifier = ${identifierFor(token)}
		RETURNING value, expires_at > now() AS live
	`;
	return row?.live ? row.value : null;
}

export function loginUrl(appUrl: string, token: string): string {
	return `${appUrl.replace(/\/+$/u, "")}/api/selfhost/login?token=${token}`;
}
