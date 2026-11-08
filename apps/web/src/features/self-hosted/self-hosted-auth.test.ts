import { describe, expect, it } from "vitest";
import type { SelfHostInfo } from "./self-host-info";
import {
	describeAuthError,
	forgetInvite,
	initialSelfHostedAuthMode,
	inviteFromLocation,
	isInvitePath,
	readLoginLinkError,
	rememberInvite,
	runAuthRequest,
	selfHostedAuthCopy,
	selfHostedSignUp,
	selfHostedSocialProviders,
	validateCredentials,
} from "./self-hosted-auth";

const info: SelfHostInfo = {
	selfHosted: true,
	version: "dev",
	appUrl: "http://localhost:4790",
	mcpUrl: "http://localhost:4790/api/mcp",
	setupComplete: true,
	auth: { password: true, emailCodes: false, social: [], openSignup: false },
};

describe("initialSelfHostedAuthMode", () => {
	it("opens sign-in for a returning visit", () => {
		expect(initialSelfHostedAuthMode(info, "/")).toBe("sign-in");
		expect(initialSelfHostedAuthMode(info, "/acme/sessions")).toBe("sign-in");
	});

	it("opens sign-up on an invite link", () => {
		expect(initialSelfHostedAuthMode(info, "/acme/join/tok_123")).toBe(
			"sign-up",
		);
		expect(initialSelfHostedAuthMode(info, "/team/invite/tok_123")).toBe(
			"sign-up",
		);
		expect(initialSelfHostedAuthMode(info, "/invitation/inv_1")).toBe(
			"sign-up",
		);
		expect(isInvitePath("/acme/sessions/abc")).toBe(false);
	});

	it("opens sign-up on a server with no account yet", () => {
		expect(
			initialSelfHostedAuthMode({ ...info, setupComplete: false }, "/"),
		).toBe("sign-up");
	});
});

describe("selfHostedSocialProviders", () => {
	it("offers only the providers the server configured", () => {
		expect(selfHostedSocialProviders(info)).toEqual([]);
		expect(
			selfHostedSocialProviders({
				...info,
				auth: { ...info.auth, social: ["google", "gitlab"] },
			}),
		).toEqual(["google"]);
	});
});

describe("validateCredentials", () => {
	it("checks the email and, on sign-up, the password length", () => {
		expect(
			validateCredentials({ mode: "sign-in", email: "ada", password: "x" }),
		).toBe("Enter a valid email address.");
		expect(
			validateCredentials({
				mode: "sign-in",
				email: "ada@example.com",
				password: "",
			}),
		).toBe("Enter your password.");
		expect(
			validateCredentials({
				mode: "sign-in",
				email: "ada@example.com",
				password: "short",
			}),
		).toBeNull();
		expect(
			validateCredentials({
				mode: "sign-up",
				email: "ada@example.com",
				password: "short",
			}),
		).toBe("Use a password of at least 8 characters.");
		expect(
			validateCredentials({
				mode: "sign-up",
				email: "ada@example.com",
				password: "long enough",
			}),
		).toBeNull();
	});
});

describe("describeAuthError", () => {
	it("explains the errors Better Auth returns in words a user can act on", () => {
		expect(
			describeAuthError(
				{ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 },
				"sign-in",
			),
		).toBe("That email and password do not match an account on this server.");
		expect(
			describeAuthError(
				{ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", status: 422 },
				"sign-up",
			),
		).toBe("An account with this email already exists. Sign in instead.");
		expect(
			describeAuthError({ code: "PASSWORD_TOO_SHORT", status: 400 }, "sign-up"),
		).toBe("Use a password of at least 8 characters.");
		expect(describeAuthError({ status: 429 }, "sign-in")).toBe(
			"Too many attempts. Wait a minute, then try again.",
		);
		expect(describeAuthError({ status: 500, message: "Boom" }, "sign-up")).toBe(
			"Boom",
		);
		expect(describeAuthError({ status: 500 }, "sign-up")).toBe(
			"Could not create your account.",
		);
	});

	it("says the server cannot be reached when the request throws", async () => {
		await expect(
			runAuthRequest(async () => {
				throw new TypeError("fetch failed");
			}, "sign-in"),
		).resolves.toBe(
			"Could not reach the Opaline server. Check that it is running, then try again.",
		);
		await expect(
			runAuthRequest(async () => ({ error: null }), "sign-in"),
		).resolves.toBeNull();
	});
});

describe("readLoginLinkError", () => {
	it("explains an expired or used one-time link from the CLI", () => {
		expect(readLoginLinkError("?error=LOGIN_LINK_INVALID")).toContain(
			"opaline server open",
		);
		expect(readLoginLinkError("?error=other")).toBeNull();
		expect(readLoginLinkError("")).toBeNull();
	});
});

describe("invites", () => {
	it("reads the invite from an invite path or from a redirect to one", () => {
		expect(inviteFromLocation("/acme/join/tok_123", "")).toBe("tok_123");
		expect(inviteFromLocation("/team/invite/tok_123/", "")).toBe("tok_123");
		expect(inviteFromLocation("/invitation/inv_1", "")).toBe("inv_1");
		expect(
			inviteFromLocation("/login", "?redirect=%2Finvitation%2Finv_2%3Fx%3D1"),
		).toBe("inv_2");
		expect(inviteFromLocation("/", "?redirect=//evil/invitation/x")).toBeNull();
		expect(inviteFromLocation("/acme/sessions", "")).toBeNull();
		expect(inviteFromLocation("/invitation/a%20b", "")).toBeNull();
		expect(inviteFromLocation("/invitation/%E0%A4%A", "")).toBeNull();
	});

	it("keeps the invite in a cookie the server reads on sign-up", () => {
		forgetInvite();
		rememberInvite(null);
		rememberInvite("bad value;");
		expect(document.cookie).not.toContain("opaline_invite=");
		rememberInvite("tok_123");
		expect(document.cookie).toContain("opaline_invite=tok_123");
		forgetInvite();
	});

	it("sign-up needs an invite unless the server is open, and setup comes first", () => {
		expect(selfHostedSignUp(info, null)).toBe("needs-invite");
		expect(selfHostedSignUp(info, "tok")).toBe("invite");
		expect(selfHostedSignUp({ ...info, setupComplete: false }, null)).toBe(
			"needs-setup",
		);
		expect(
			selfHostedSignUp(
				{ ...info, auth: { ...info.auth, openSignup: true } },
				null,
			),
		).toBe("open");
		expect(
			selfHostedAuthCopy("sign-up", { info, pathname: "/", search: "" }).title,
		).toBe("Ask for an invite");
		expect(
			selfHostedAuthCopy("sign-up", {
				info,
				pathname: "/",
				search: "?user_code=ABCD",
			}).title,
		).toBe("Ask for an invite");
		expect(
			selfHostedAuthCopy("sign-up", {
				info,
				pathname: "/acme/join/tok",
				search: "",
			}).title,
		).toBe("Join your team");
		expect(
			describeAuthError({ code: "INVITE_REQUIRED", status: 403 }, "sign-up"),
		).toContain("invite-only");
	});
});
