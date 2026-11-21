import { getLogger } from "@logtape/logtape";
import { APIError } from "better-auth/api";
import type postgres from "postgres";

export const INVITE_HEADER = "x-opaline-invite";
export const INVITE_COOKIE = "opaline_invite";
export const INVITE_REQUIRED = "INVITE_REQUIRED";
export const INVITE_REQUIRED_MESSAGE =
	"This Opaline server is invite-only. Ask a workspace owner or admin to invite you, then create your account from the invitation.";

const INVITE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const logger = getLogger(["rudel", "api", "selfhost"]);

type Environment = Readonly<Record<string, string | undefined>>;

export function isOpenSignup(env: Environment = process.env): boolean {
	return env.OPALINE_OPEN_SIGNUP?.trim() === "1";
}

export function inviteFromRequest(request: Request | undefined): string | null {
	if (!request) return null;
	const header = request.headers.get(INVITE_HEADER)?.trim();
	if (header) return header;
	for (const part of (request.headers.get("cookie") ?? "").split(";")) {
		const separator = part.indexOf("=");
		if (separator < 0 || part.slice(0, separator).trim() !== INVITE_COOKIE)
			continue;
		const value = part.slice(separator + 1).trim();
		if (value) return value;
	}
	return null;
}

export async function hasValidInvite(
	sql: postgres.Sql,
	invite: string,
	email: string,
): Promise<boolean> {
	if (!INVITE_PATTERN.test(invite)) return false;
	const [row] = await sql<{ valid: boolean }[]>`
		SELECT EXISTS (
			SELECT 1 FROM invitation
			WHERE id = ${invite}
				AND status = 'pending'
				AND expires_at > now()
				AND lower(email) = ${email.trim().toLowerCase()}
		) AS valid
	`;
	return row?.valid === true;
}

export function createSignUpGate(
	sql: postgres.Sql,
	env: Environment = process.env,
): (user: { email: string }, request: Request | undefined) => Promise<void> {
	return async (user, request) => {
		if (!request || isOpenSignup(env)) return;
		const invite = inviteFromRequest(request);
		if (invite && (await hasValidInvite(sql, invite, user.email))) return;
		logger.info("Refused a sign-up without a valid invite ({reason})", {
			reason: invite ? "invite not valid for this email" : "no invite",
		});
		throw new APIError("FORBIDDEN", {
			code: INVITE_REQUIRED,
			message: INVITE_REQUIRED_MESSAGE,
		});
	};
}
