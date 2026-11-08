import { describe, expect, it } from "vitest";
import {
	canCopySignInLink,
	describeLinkLifetime,
	requestSignInLink,
	SIGN_IN_LINK_PATH,
	validateNewPassword,
} from "./account-recovery";

const member = (id: string, role: string) => ({ role, user: { id } });

describe("sign-in links for teammates", () => {
	it("owners copy anyone's link, admins everyone's but an owner's, nobody their own", () => {
		const owner = { id: "u1", role: "owner" };
		const admin = { id: "u2", role: "admin" };
		expect(canCopySignInLink(owner, member("u3", "member"))).toBe(true);
		expect(canCopySignInLink(owner, member("u2", "admin"))).toBe(true);
		expect(canCopySignInLink(owner, member("u4", "owner"))).toBe(true);
		expect(canCopySignInLink(owner, member("u1", "owner"))).toBe(false);
		expect(canCopySignInLink(admin, member("u3", "member"))).toBe(true);
		expect(canCopySignInLink(admin, member("u1", "owner"))).toBe(false);
		expect(
			canCopySignInLink({ id: "u3", role: "member" }, member("u2", "admin")),
		).toBe(false);
	});

	it("asks the server for the member's link with the browser session", async () => {
		const seen: { url: string; init: RequestInit }[] = [];
		const link = await requestSignInLink(
			"bob@example.com",
			async (url, init) => {
				seen.push({ url: url.toString(), init });
				return Response.json({
					loginUrl: "http://localhost:4100/api/selfhost/login?token=t",
					expiresAt: "2026-11-08T12:00:00.000Z",
					user: { id: "u3", email: "bob@example.com", name: "Bob" },
				});
			},
			"http://localhost:4100",
		);
		expect(link).toEqual({
			loginUrl: "http://localhost:4100/api/selfhost/login?token=t",
			expiresAt: "2026-11-08T12:00:00.000Z",
		});
		expect(seen[0]?.url).toBe(`http://localhost:4100${SIGN_IN_LINK_PATH}`);
		expect(seen[0]?.init).toMatchObject({
			method: "POST",
			credentials: "include",
			body: JSON.stringify({ email: "bob@example.com" }),
		});
	});

	it("passes the server's reason on when it refuses", async () => {
		await expect(
			requestSignInLink(
				"owner@example.com",
				async () =>
					Response.json(
						{
							error: "forbidden",
							message: "admins cannot make one for an owner",
						},
						{ status: 403 },
					),
				"http://localhost:4100",
			),
		).rejects.toThrow("admins cannot make one for an owner");
		await expect(
			requestSignInLink(
				"bob@example.com",
				async () => new Response("<html>", { status: 502 }),
				"http://localhost:4100",
			),
		).rejects.toThrow("Could not make a sign-in link.");
	});

	it("says how long the link lasts", () => {
		const now = Date.parse("2026-11-08T11:00:00.000Z");
		expect(describeLinkLifetime("2026-11-08T12:00:00.000Z", now)).toBe(
			"It works once, within the next 60 minutes.",
		);
		expect(describeLinkLifetime("2026-11-08T11:01:00.000Z", now)).toBe(
			"It works once, within the next minute.",
		);
		expect(describeLinkLifetime("nonsense", now)).toBe("It works once.");
	});
});

describe("validateNewPassword", () => {
	const valid = {
		currentPasswordRequired: true,
		currentPassword: "old password",
		newPassword: "new password",
		repeated: "new password",
	};

	it("needs the current password unless a sign-in link just opened the session", () => {
		expect(validateNewPassword(valid)).toBeNull();
		expect(validateNewPassword({ ...valid, currentPassword: "" })).toBe(
			"Enter your current password.",
		);
		expect(
			validateNewPassword({
				...valid,
				currentPasswordRequired: false,
				currentPassword: "",
			}),
		).toBeNull();
	});

	it("checks the length and that both new passwords match", () => {
		expect(
			validateNewPassword({
				...valid,
				newPassword: "short",
				repeated: "short",
			}),
		).toBe("Use a password of at least 8 characters.");
		expect(validateNewPassword({ ...valid, repeated: "other password" })).toBe(
			"The two new passwords are not the same.",
		);
	});
});
