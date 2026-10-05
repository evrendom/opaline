import { z } from "zod";
import { getInitialSignupName } from "../../lib/auth-signup-name";
import type { CliAuthorization } from "./cli-authorization";

const SessionSchema = z
	.object({
		user: z.object({
			id: z.string(),
			email: z.string(),
			name: z.string(),
			image: z.string().nullable().optional(),
			jobTitle: z.string().nullable().optional(),
		}),
	})
	.nullable();
export type CliSession = z.infer<typeof SessionSchema>;
const AuthErrorSchema = z.object({ message: z.string().optional() });

export async function readCliSession(
	signal?: AbortSignal,
): Promise<CliSession> {
	const response = await fetch("/api/auth/get-session", {
		credentials: "include",
		signal,
		cache: "no-store",
	});
	if (!response.ok)
		throw new Error("Could not check your sign-in. Please try again.");
	return SessionSchema.parse(await response.json());
}

export async function signInCliWithProvider(
	provider: "google" | "github",
	callbackURL: string,
) {
	const result = await postCliAuth("/api/auth/sign-in/social", {
		provider,
		callbackURL,
		newUserCallbackURL: callbackURL,
		errorCallbackURL: callbackURL,
		disableRedirect: true,
	});
	const { url } = z.object({ url: z.string().url() }).parse(result);
	if (new URL(url).protocol !== "https:")
		throw new Error("The sign-in link is invalid. Please try again.");
	window.location.assign(url);
}

export async function sendCliEmailCode(email: string) {
	await postCliAuth("/api/auth/email-otp/send-verification-otp", {
		email,
		type: "sign-in",
	});
}

export async function signInCliWithEmail(email: string, otp: string) {
	await postCliAuth("/api/auth/sign-in/email-otp", {
		email,
		otp,
		name: getInitialSignupName(email),
	});
	return readCliSession();
}

export async function signInCliWithPassword(email: string, password: string) {
	await postCliAuth("/api/auth/sign-in/email", { email, password });
	return readCliSession();
}

export async function approveCliAuthorization(
	authorization: CliAuthorization,
	organizationId: string,
) {
	// Verify the pairing browser and account before granting the CLI its token.
	await postCliAuth(`/api/cli/connections/${authorization.id}/authorize`, {
		userCode: authorization.userCode,
		organizationId,
	});
	await postCliAuth("/api/auth/device/approve", {
		userCode: authorization.userCode,
	});
}

export async function submitCliDeviceDecision(
	userCode: string,
	action: "approve" | "deny",
) {
	await postCliAuth(`/api/auth/device/${action}`, { userCode });
}

export async function signOutCliSession() {
	await postCliAuth("/api/auth/sign-out", {});
}

async function postCliAuth(path: string, body: unknown): Promise<unknown> {
	const response = await fetch(path, {
		method: "POST",
		credentials: "include",
		redirect: "error",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(15_000),
	});
	const result: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		if (
			path.includes("/connections/") &&
			[403, 404, 409, 410].includes(response.status)
		)
			throw new Error(
				"This connection is no longer available. Use the browser where you copied the command, or copy a new command.",
			);
		throw new Error(
			AuthErrorSchema.safeParse(result).data?.message ??
				"Could not complete sign-in. Please try again.",
		);
	}
	return result;
}
