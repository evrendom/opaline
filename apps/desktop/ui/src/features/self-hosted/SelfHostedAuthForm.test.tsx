import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuestApp } from "@/features/auth/GuestApp";
import { SelfHostContext, type SelfHostInfo } from "./self-host-info";
import { forgetInvite } from "./self-hosted-auth";

const auth = vi.hoisted(() => ({
	signInEmail: vi.fn(),
	signUpEmail: vi.fn(),
	social: vi.fn(),
	sendOtp: vi.fn(),
	navigate: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		signIn: {
			email: auth.signInEmail,
			social: auth.social,
			emailOtp: vi.fn(),
		},
		signUp: { email: auth.signUpEmail },
		emailOtp: { sendVerificationOtp: auth.sendOtp },
	},
	refreshAuthClientState: vi.fn(),
}));

vi.mock("@/features/auth/auth-navigation", () => ({
	navigateToDestination: auth.navigate,
}));

const info: SelfHostInfo = {
	selfHosted: true,
	version: "dev",
	appUrl: "http://localhost:4011",
	mcpUrl: "http://localhost:4011/api/mcp",
	setupComplete: true,
	auth: { password: true, emailCodes: false, social: [], openSignup: false },
};

function renderGuest(selfHost: SelfHostInfo = info) {
	return render(
		<SelfHostContext value={selfHost}>
			<GuestApp />
		</SelfHostContext>,
	);
}

function fill(label: string, value: string) {
	fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
	window.history.replaceState(null, "", "/");
	auth.signInEmail.mockResolvedValue({ data: {}, error: null });
	auth.signUpEmail.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
	vi.clearAllMocks();
	window.history.replaceState(null, "", "/");
});

describe("GuestApp on a self-hosted server", () => {
	it("signs in with email and password only, without cloud buttons or legal links", () => {
		renderGuest();

		expect(screen.getByRole("heading", { name: "Welcome back" })).toBeVisible();
		expect(screen.getByLabelText("Email")).toBeVisible();
		expect(screen.getByLabelText("Password")).toBeVisible();
		expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
		expect(screen.queryByText(/GitHub/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Google/)).not.toBeInTheDocument();
		expect(screen.queryByText(/email code/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/Terms of Service/)).not.toBeInTheDocument();
		expect(screen.getByText("opaline server open")).toBeVisible();
	});

	it("leaves the terminal sign-in hint out of the desktop app, which signs in by itself", () => {
		const userAgent = vi
			.spyOn(navigator, "userAgent", "get")
			.mockReturnValue("Mozilla/5.0 Chrome/140 OpalineDesktop/0.1.0");
		try {
			renderGuest();
			expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
			expect(screen.queryByText("opaline server open")).not.toBeInTheDocument();
		} finally {
			userAgent.mockRestore();
		}
	});

	it("signs in and opens the app", async () => {
		renderGuest();
		fill("Email", " Ada@Example.com ");
		fill("Password", "correct horse");
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

		await waitFor(() => expect(auth.navigate).toHaveBeenCalledWith("/"));
		expect(auth.signInEmail).toHaveBeenCalledWith({
			email: "Ada@Example.com",
			password: "correct horse",
		});
	});

	it("shows a wrong password and stays on the form", async () => {
		auth.signInEmail.mockResolvedValue({
			data: null,
			error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 },
		});
		renderGuest();
		fill("Email", "ada@example.com");
		fill("Password", "wrong password");
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"That email and password do not match an account on this server.",
		);
		expect(auth.navigate).not.toHaveBeenCalled();
	});

	it("creates an account with a name and a password on an open server, then opens setup", async () => {
		renderGuest({ ...info, auth: { ...info.auth, openSignup: true } });
		fireEvent.click(screen.getByRole("button", { name: "Create one" }));
		expect(
			screen.getByRole("heading", { name: "Create your account" }),
		).toBeVisible();
		fill("Name", "Ada Lovelace");
		fill("Email", "ada@example.com");
		fill("Password", "short");
		fireEvent.click(screen.getByRole("button", { name: "Create account" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Use a password of at least 8 characters.",
		);
		expect(auth.signUpEmail).not.toHaveBeenCalled();

		fill("Password", "long enough");
		fireEvent.click(screen.getByRole("button", { name: "Create account" }));
		await waitFor(() => expect(auth.navigate).toHaveBeenCalledWith("/welcome"));
		expect(auth.signUpEmail).toHaveBeenCalledWith({
			email: "ada@example.com",
			password: "long enough",
			name: "Ada Lovelace",
		});
	});

	it("says how to get an invite instead of offering sign-up without one", () => {
		renderGuest();
		fireEvent.click(screen.getByRole("button", { name: "Create one" }));

		expect(
			screen.getByRole("heading", { name: "Ask for an invite" }),
		).toBeVisible();
		expect(screen.getByText(/Ask a workspace owner or admin/)).toBeVisible();
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Create account" }),
		).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(screen.getByRole("heading", { name: "Welcome back" })).toBeVisible();
	});

	it("points a server without an owner at its setup", () => {
		renderGuest({ ...info, setupComplete: false });

		expect(
			screen.getByRole("heading", { name: "Finish setting up this server" }),
		).toBeVisible();
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
	});

	it("opens sign-up on a team invite link, sends the invite with it and returns to it", async () => {
		forgetInvite();
		window.history.replaceState(null, "", "/acme/join/tok_123");
		let cookieAtSignUp = "";
		auth.signUpEmail.mockImplementation(async () => {
			cookieAtSignUp = document.cookie;
			return { data: {}, error: null };
		});
		renderGuest();

		expect(
			screen.getByRole("heading", { name: "Join your team" }),
		).toBeVisible();
		fill("Email", "grace@example.com");
		fill("Password", "long enough");
		fireEvent.click(screen.getByRole("button", { name: "Create account" }));

		await waitFor(() =>
			expect(auth.navigate).toHaveBeenCalledWith("/acme/join/tok_123"),
		);
		expect(auth.signUpEmail).toHaveBeenCalledWith({
			email: "grace@example.com",
			password: "long enough",
			name: "Grace",
		});
		expect(cookieAtSignUp).toContain("opaline_invite=tok_123");
		expect(document.cookie).not.toContain("opaline_invite=tok_123");
	});

	it("explains a sign-up the server refused for want of an invite", async () => {
		window.history.replaceState(null, "", "/invitation/inv_1");
		auth.signUpEmail.mockResolvedValue({
			data: null,
			error: { code: "INVITE_REQUIRED", status: 403 },
		});
		renderGuest();
		fill("Email", "grace@example.com");
		fill("Password", "long enough");
		fireEvent.click(screen.getByRole("button", { name: "Create account" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"This server is invite-only.",
		);
		expect(auth.navigate).not.toHaveBeenCalled();
		forgetInvite();
	});

	it("explains an expired one-time login link", () => {
		window.history.replaceState(null, "", "/login?error=LOGIN_LINK_INVALID");
		renderGuest();

		expect(screen.getByRole("alert")).toHaveTextContent(
			"This sign-in link expired or was already used.",
		);
	});

	it("offers social sign-in and email codes only when the server configured them", () => {
		renderGuest({
			...info,
			auth: {
				password: true,
				emailCodes: true,
				social: ["github"],
				openSignup: false,
			},
		});

		expect(
			screen.getByRole("button", { name: "Log in with GitHub" }),
		).toBeVisible();
		expect(screen.queryByText(/Google/)).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Email me a sign-in code instead" }),
		).toBeVisible();
	});
});
