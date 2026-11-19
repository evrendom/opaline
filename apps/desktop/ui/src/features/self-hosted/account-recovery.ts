import { z } from "zod";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { authClient } from "@/lib/auth-client";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./self-hosted-auth";

export const SIGN_IN_LINK_PATH = "/api/selfhost/login-link";

const SignInLinkSchema = z.object({
	loginUrl: z.string().url(),
	expiresAt: z.string(),
});
const PasswordStatusSchema = z.object({
	currentPasswordRequired: z.boolean(),
});

export type SignInLink = z.infer<typeof SignInLinkSchema>;

function messageOf(body: unknown): string | null {
	if (typeof body !== "object" || body === null) return null;
	const message = Reflect.get(body, "message");
	return typeof message === "string" && message.trim() ? message.trim() : null;
}

type Fetch = (url: URL, init: RequestInit) => Promise<Response>;

export async function requestSignInLink(
	email: string,
	fetchImpl: Fetch = (url, init) => fetch(url, init),
	apiBaseUrl: string = getApiBaseUrl(),
): Promise<SignInLink> {
	const response = await fetchImpl(new URL(SIGN_IN_LINK_PATH, apiBaseUrl), {
		method: "POST",
		credentials: "include",
		headers: { accept: "application/json", "content-type": "application/json" },
		body: JSON.stringify({ email }),
	});
	const body: unknown = await response.json().catch(() => null);
	const link = SignInLinkSchema.safeParse(body);
	if (response.ok && link.success) return link.data;
	throw new Error(messageOf(body) ?? "Could not make a sign-in link.");
}

export function canCopySignInLink(
	viewer: { id: string; role: string | null },
	member: { role: string; user: { id: string } },
): boolean {
	if (member.user.id === viewer.id) return false;
	if (viewer.role === "owner") return true;
	return viewer.role === "admin" && member.role !== "owner";
}

export function describeLinkLifetime(expiresAt: string, now: number): string {
	const minutes = Math.round((Date.parse(expiresAt) - now) / 60_000);
	if (!Number.isFinite(minutes) || minutes <= 0) return "It works once.";
	return minutes === 1
		? "It works once, within the next minute."
		: `It works once, within the next ${minutes} minutes.`;
}

export async function readPasswordStatus(): Promise<{
	currentPasswordRequired: boolean;
} | null> {
	try {
		const { data } = await authClient.$fetch("/selfhost/password-status", {
			method: "GET",
		});
		return PasswordStatusSchema.safeParse(data).data ?? null;
	} catch {
		return null;
	}
}

export function validateNewPassword(input: {
	currentPasswordRequired: boolean;
	currentPassword: string;
	newPassword: string;
	repeated: string;
}): string | null {
	if (input.currentPasswordRequired && input.currentPassword.length === 0)
		return "Enter your current password.";
	if (input.newPassword.length < MIN_PASSWORD_LENGTH)
		return `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
	if (input.newPassword.length > MAX_PASSWORD_LENGTH)
		return `Use a password of at most ${MAX_PASSWORD_LENGTH} characters.`;
	if (input.newPassword !== input.repeated)
		return "The two new passwords are not the same.";
	return null;
}

function describePasswordError(error: unknown): string {
	const code =
		typeof error === "object" && error !== null
			? Reflect.get(error, "code")
			: undefined;
	if (code === "INVALID_PASSWORD") return "Your current password is wrong.";
	if (code === "PASSWORD_TOO_SHORT")
		return `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
	if (code === "PASSWORD_TOO_LONG")
		return `Use a password of at most ${MAX_PASSWORD_LENGTH} characters.`;
	return messageOf(error) ?? "Could not change your password.";
}

export async function changePassword(input: {
	newPassword: string;
	currentPassword: string;
}): Promise<string | null> {
	try {
		const { error } = await authClient.$fetch("/selfhost/password", {
			method: "POST",
			body: input.currentPassword
				? {
						newPassword: input.newPassword,
						currentPassword: input.currentPassword,
					}
				: { newPassword: input.newPassword },
		});
		return error ? describePasswordError(error) : null;
	} catch {
		return "Could not reach the Opaline server. Try again.";
	}
}
