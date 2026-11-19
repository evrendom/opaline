import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRoutes } from "@/app/routes";
import {
	clearPendingSignupRedirect,
	getEmailLoginSuccessDestination,
	getEmailSignupSuccessDestination,
	getEmailSignupVerificationCallbackURL,
	getPendingSignupRedirect,
	getSocialSignupRedirectOptions,
	getValidRedirect,
	isGetStartedPath,
	primePendingSignupRedirect,
} from "./auth-route-utils";
import {
	readPendingEmailLoginCodeDraft,
	readPendingEmailSignupCodeDraft,
} from "./email-code-auth";
import { LoginForm } from "./LoginForm";
import { SignupForm } from "./SignupForm";

const {
	mockAuthFetch,
	mockNavigateToDestination,
	mockRefreshAuthClientState,
	mockSendVerificationOtp,
	mockSignInEmail,
	mockSignInEmailOtp,
	mockSignInSocial,
	mockTrackAuthenticationAction,
} = vi.hoisted(() => ({
	mockAuthFetch: vi.fn(),
	mockNavigateToDestination: vi.fn(),
	mockRefreshAuthClientState: vi.fn(),
	mockSendVerificationOtp: vi.fn(),
	mockSignInEmail: vi.fn(),
	mockSignInEmailOtp: vi.fn(),
	mockSignInSocial: vi.fn(),
	mockTrackAuthenticationAction: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		$fetch: mockAuthFetch,
		emailOtp: {
			sendVerificationOtp: mockSendVerificationOtp,
		},
		signIn: {
			email: mockSignInEmail,
			emailOtp: mockSignInEmailOtp,
			social: mockSignInSocial,
		},
	},
	refreshAuthClientState: mockRefreshAuthClientState,
}));

vi.mock("./auth-navigation", () => ({
	navigateToDestination: mockNavigateToDestination,
}));

vi.mock("@/features/analytics/tracking/useAnalyticsTracking", () => ({
	useAnalyticsTracking: () => ({
		trackAuthenticationAction: mockTrackAuthenticationAction,
	}),
}));

vi.mock("@/lib/product-analytics", () => ({
	captureSignUpFailed: vi.fn(),
	normalizeWebErrorCode: vi.fn(() => "unknown_error"),
}));

describe("auth state refresh", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	beforeEach(() => {
		window.history.replaceState({}, "", "/");
		mockAuthFetch.mockReset();
		mockAuthFetch.mockResolvedValue({ data: { available: false } });
		mockSendVerificationOtp.mockReset();
		mockSignInEmail.mockReset();
		mockSignInEmailOtp.mockReset();
		mockSignInSocial.mockReset();
		mockNavigateToDestination.mockReset();
		mockRefreshAuthClientState.mockReset();
		mockTrackAuthenticationAction.mockReset();
		window.localStorage.clear();
		window.sessionStorage.clear();
	});

	it("routes homepage email signups to setup", () => {
		expect(getEmailSignupSuccessDestination("/", "")).toBe("/welcome");
	});

	it("uses the direct redirect destination for homepage email verification callbacks", () => {
		expect(getEmailSignupVerificationCallbackURL("/", "")).toBe("/welcome");
	});

	it("matches both canonical and legacy get-started paths", () => {
		expect(isGetStartedPath(appRoutes.getStarted())).toBe(true);
		expect(isGetStartedPath(appRoutes.dashboardGetStartedLegacy())).toBe(true);
		expect(isGetStartedPath(appRoutes.dashboard())).toBe(false);
	});

	it("stores a pending homepage signup redirect in the URL", () => {
		primePendingSignupRedirect("/welcome", "/", "");

		expect(getPendingSignupRedirect(window.location.search)).toBe("/welcome");
		expect(window.location.search).toBe(
			`?signup_redirect=${encodeURIComponent("/welcome")}`,
		);
	});

	it("does not add a pending signup redirect for explicit redirect flows", () => {
		primePendingSignupRedirect(
			"/welcome",
			"/",
			"?redirect=%2Fdashboard%2Fsessions",
		);

		expect(getPendingSignupRedirect(window.location.search)).toBeNull();
	});

	it("clears a pending signup redirect from the URL", () => {
		window.history.replaceState(
			{},
			"",
			`/?signup_redirect=${encodeURIComponent("/welcome")}`,
		);

		clearPendingSignupRedirect();

		expect(window.location.search).toBe("");
		expect(getPendingSignupRedirect(window.location.search)).toBeNull();
	});

	it("preserves an explicit redirect for email signup success", () => {
		expect(
			getEmailSignupSuccessDestination(
				"/",
				"?redirect=%2Fdashboard%2Fsessions",
			),
		).toBe("/dashboard/sessions");
	});

	it("preserves device flow destinations for email signup", () => {
		expect(getEmailSignupSuccessDestination("/", "?user_code=ABCD")).toBe(
			"/welcome?user_code=ABCD",
		);
	});

	it("preserves direct non-root destinations for email signup", () => {
		expect(getEmailSignupSuccessDestination("/invitation/123", "")).toBe(
			"/invitation/123",
		);
	});

	it("routes homepage email logins back to the app root", () => {
		expect(getEmailLoginSuccessDestination("/", "")).toBe("/");
	});

	it("preserves explicit redirect destinations for email login", () => {
		expect(
			getEmailLoginSuccessDestination("/", "?redirect=%2Fdashboard%2Fsessions"),
		).toBe("/dashboard/sessions");
	});

	it.each([
		["a scheme-relative URL", "?redirect=%2F%2Fattacker.example"],
		["a raw backslash", "?redirect=%2F%5Cattacker.example"],
		["an encoded backslash", "?redirect=%2F%255Cattacker.example"],
		["an encoded slash", "?redirect=%2F%252Fattacker.example"],
		["a raw control character", "?redirect=%2F%00attacker.example"],
		["an encoded control character", "?redirect=%2F%250Aattacker.example"],
	])("rejects %s as a post-auth redirect", (_label, search) => {
		expect(getValidRedirect(search)).toBeNull();
		expect(getEmailLoginSuccessDestination("/", search)).toBe("/");
	});

	it("uses a separate new-user social signup destination on the homepage", () => {
		expect(getSocialSignupRedirectOptions("/", "")).toEqual({
			callbackURL: "/",
			newUserCallbackURL: "/welcome",
		});
	});

	it("preserves redirect destinations for social signup flows", () => {
		expect(
			getSocialSignupRedirectOptions("/", "?redirect=%2Finvitation%2F123"),
		).toEqual({
			callbackURL: "/invitation/123",
			newUserCallbackURL: "/invitation/123",
		});
	});

	it("preserves device destinations for social signup flows", () => {
		expect(getSocialSignupRedirectOptions("/", "?user_code=ABCD")).toEqual({
			callbackURL: "/welcome?user_code=ABCD",
			newUserCallbackURL: "/welcome?user_code=ABCD",
		});
	});

	it("hard-navigates after a successful homepage email sign up", async () => {
		mockSendVerificationOtp.mockResolvedValue({ error: null });
		mockSignInEmailOtp.mockResolvedValue({ error: null });

		const user = userEvent.setup();
		render(<SignupForm onSwitchToLogin={vi.fn()} />);

		await user.click(
			screen.getByRole("button", { name: "Create account with Email" }),
		);
		expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
		await user.type(screen.getByLabelText("Email"), "ada.lovelace@example.com");
		await user.click(screen.getByRole("button", { name: "Send code" }));

		await waitFor(() => {
			expect(mockSendVerificationOtp).toHaveBeenCalledWith({
				email: "ada.lovelace@example.com",
				type: "sign-in",
			});
		});

		await user.type(await screen.findByLabelText("Email code"), "123456");
		await user.click(screen.getByRole("button", { name: "Verify code" }));

		await waitFor(() => {
			expect(mockSignInEmailOtp).toHaveBeenCalledWith({
				name: "Ada Lovelace",
				email: "ada.lovelace@example.com",
				otp: "123456",
			});
		});

		await waitFor(() => {
			expect(mockNavigateToDestination).toHaveBeenCalledWith("/welcome");
		});

		expect(window.location.search).toBe(
			`?signup_redirect=${encodeURIComponent("/welcome")}`,
		);
	});

	it("hard-navigates to explicit redirect destinations after email sign up", async () => {
		window.history.replaceState({}, "", "/?redirect=%2Fdashboard%2Fsessions");
		mockSendVerificationOtp.mockResolvedValue({ error: null });
		mockSignInEmailOtp.mockResolvedValue({ error: null });

		const user = userEvent.setup();
		render(<SignupForm onSwitchToLogin={vi.fn()} />);

		await user.click(
			screen.getByRole("button", { name: "Create account with Email" }),
		);
		await user.type(screen.getByLabelText("Email"), "ada@example.com");
		await user.click(screen.getByRole("button", { name: "Send code" }));
		await user.type(await screen.findByLabelText("Email code"), "123456");
		await user.click(screen.getByRole("button", { name: "Verify code" }));

		await waitFor(() => {
			expect(mockNavigateToDestination).toHaveBeenCalledWith(
				"/dashboard/sessions",
			);
		});
	});

	it("hard-navigates back into device flow after email sign up", async () => {
		window.history.replaceState({}, "", "/?user_code=ABCD");
		mockSendVerificationOtp.mockResolvedValue({ error: null });
		mockSignInEmailOtp.mockResolvedValue({ error: null });

		const user = userEvent.setup();
		render(<SignupForm onSwitchToLogin={vi.fn()} />);

		await user.click(
			screen.getByRole("button", { name: "Create account with Email" }),
		);
		await user.type(screen.getByLabelText("Email"), "ada@example.com");
		await user.click(screen.getByRole("button", { name: "Send code" }));
		await user.type(await screen.findByLabelText("Email code"), "123456");
		await user.click(screen.getByRole("button", { name: "Verify code" }));

		await waitFor(() => {
			expect(mockNavigateToDestination).toHaveBeenCalledWith(
				"/welcome?user_code=ABCD",
			);
		});
	});

	it("does not navigate when email sign up fails", async () => {
		mockSendVerificationOtp.mockResolvedValue({ error: null });
		mockSignInEmailOtp.mockResolvedValue({
			error: { message: "Sign up failed" },
		});

		const user = userEvent.setup();
		render(<SignupForm onSwitchToLogin={vi.fn()} />);

		await user.click(
			screen.getByRole("button", { name: "Create account with Email" }),
		);
		await user.type(screen.getByLabelText("Email"), "ada@example.com");
		await user.click(screen.getByRole("button", { name: "Send code" }));
		await user.type(await screen.findByLabelText("Email code"), "123456");
		await user.click(screen.getByRole("button", { name: "Verify code" }));

		await waitFor(() => {
			expect(screen.getByText("Sign up failed")).toBeInTheDocument();
		});

		expect(mockNavigateToDestination).not.toHaveBeenCalled();
	});

	it("restores a pending default email sign up code after remounting", async () => {
		mockSendVerificationOtp.mockResolvedValue({ error: null });
		mockSignInEmailOtp.mockResolvedValue({ error: null });

		const user = userEvent.setup();
		const view = render(<SignupForm onSwitchToLogin={vi.fn()} />);

		await user.click(
			screen.getByRole("button", { name: "Create account with Email" }),
		);
		await user.type(screen.getByLabelText("Email"), "ada.lovelace@example.com");
		await user.click(screen.getByRole("button", { name: "Send code" }));

		await waitFor(() => {
			expect(mockSendVerificationOtp).toHaveBeenCalledWith({
				email: "ada.lovelace@example.com",
				type: "sign-in",
			});
		});

		expect(readPendingEmailSignupCodeDraft()).toEqual({
			email: "ada.lovelace@example.com",
			mode: "signup",
		});

		window.sessionStorage.clear();
		view.unmount();
		render(<SignupForm onSwitchToLogin={vi.fn()} />);

		expect(
			screen.getByText("Sent email to ada.lovelace@example.com."),
		).toBeInTheDocument();
		const signupCodeInput = screen.getByLabelText("Email code");
		expect(signupCodeInput).toHaveValue("");
		expect(signupCodeInput).toHaveFocus();
		expect(
			screen.getByRole("button", { name: "Verify code" }),
		).toBeInTheDocument();

		await user.type(screen.getByLabelText("Email code"), "123456");
		await user.click(screen.getByRole("button", { name: "Verify code" }));

		await waitFor(() => {
			expect(mockSignInEmailOtp).toHaveBeenCalledWith({
				name: "Ada Lovelace",
				email: "ada.lovelace@example.com",
				otp: "123456",
			});
		});
		expect(readPendingEmailSignupCodeDraft()).toBeNull();
	});

	it("uses separate existing-user and new-user destinations for homepage social sign up", async () => {
		mockSignInSocial.mockResolvedValue({ error: null });

		const user = userEvent.setup();
		render(<SignupForm onSwitchToLogin={vi.fn()} />);

		await user.click(
			screen.getByRole("button", { name: "Create account with Google" }),
		);

		await waitFor(() => {
			expect(mockSignInSocial).toHaveBeenCalledWith({
				provider: "google",
				callbackURL: "/",
				newUserCallbackURL: "/welcome",
			});
		});
	});

	it("hard-navigates after a successful email sign in", async () => {
		window.history.replaceState(
			{},
			"",
			`/?signup_redirect=${encodeURIComponent("/welcome")}`,
		);
		mockSendVerificationOtp.mockResolvedValue({ error: null });
		mockSignInEmailOtp.mockResolvedValue({ error: null });

		const user = userEvent.setup();
		render(<LoginForm />);

		await user.click(screen.getByRole("button", { name: "Log in with Email" }));
		await user.type(screen.getByLabelText("Email"), "ada@example.com");
		await user.click(screen.getByRole("button", { name: "Send code" }));

		await waitFor(() => {
			expect(mockSendVerificationOtp).toHaveBeenCalledWith({
				email: "ada@example.com",
				type: "sign-in",
			});
		});

		await user.type(await screen.findByLabelText("Email code"), "123456");
		await user.click(screen.getByRole("button", { name: "Verify code" }));

		await waitFor(() => {
			expect(mockSignInEmailOtp).toHaveBeenCalledWith({
				email: "ada@example.com",
				otp: "123456",
			});
		});

		await waitFor(() => {
			expect(mockNavigateToDestination).toHaveBeenCalledWith("/");
		});

		expect(mockRefreshAuthClientState).toHaveBeenCalledTimes(1);
		expect(window.location.search).toBe("");
	});

	it.each([
		"/",
		"/acme/sessions",
		"/api/mcp/consent?client_id=chatgpt&state=review",
	])("hard-navigates to %s after password sign in", async (destination) => {
		window.history.replaceState(
			{},
			"",
			`/login?redirect=${encodeURIComponent(destination)}&signup_redirect=%2Fwelcome`,
		);
		mockSignInEmail.mockResolvedValue({ error: null });
		mockAuthFetch.mockResolvedValue({ data: { available: true } });
		const user = userEvent.setup();
		render(<LoginForm />);

		await user.click(screen.getByRole("button", { name: "Log in with Email" }));
		expect(
			screen.getByRole("button", { name: "Send code" }),
		).toBeInTheDocument();
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
		await user.type(screen.getByLabelText("Email"), "Ada@Example.com");
		await user.type(
			await screen.findByLabelText("Password"),
			"reviewer-password",
		);
		await user.click(screen.getByRole("button", { name: "Sign in" }));

		await waitFor(() => {
			expect(mockNavigateToDestination).toHaveBeenCalledWith(destination);
		});
		expect(mockSignInEmail).toHaveBeenCalledWith({
			email: "Ada@Example.com",
			password: "reviewer-password",
		});
		expect(mockAuthFetch).toHaveBeenCalledWith(
			"/password-sign-in/available",
			expect.objectContaining({
				method: "POST",
				body: { email: "Ada@Example.com" },
			}),
		);
		expect(mockRefreshAuthClientState).toHaveBeenCalledTimes(1);
		expect(mockSendVerificationOtp).not.toHaveBeenCalled();
		expect(mockSignInEmailOtp).not.toHaveBeenCalled();
		expect(
			new URLSearchParams(window.location.search).has("signup_redirect"),
		).toBe(false);
	});

	it("keeps the email code flow for emails off the password list", async () => {
		mockSendVerificationOtp.mockResolvedValue({ error: null });
		const user = userEvent.setup();
		render(<LoginForm />);

		await user.click(screen.getByRole("button", { name: "Log in with Email" }));
		await user.type(screen.getByLabelText("Email"), "ada@example.com");
		await waitFor(() => {
			expect(mockAuthFetch).toHaveBeenCalledTimes(1);
		});

		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /password/i }),
		).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Send code" }));
		expect(await screen.findByLabelText("Email code")).toBeInTheDocument();
		expect(mockSendVerificationOtp).toHaveBeenCalledWith({
			email: "ada@example.com",
			type: "sign-in",
		});
		expect(mockSignInEmail).not.toHaveBeenCalled();
	});

	it("lets an allowed email choose an email code instead of a password", async () => {
		mockAuthFetch.mockResolvedValue({ data: { available: true } });
		mockSendVerificationOtp.mockResolvedValue({ error: null });
		const user = userEvent.setup();
		render(<LoginForm />);

		await user.click(screen.getByRole("button", { name: "Log in with Email" }));
		await user.type(screen.getByLabelText("Email"), "reviewer@example.com");
		expect(await screen.findByLabelText("Password")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
		await user.click(
			screen.getByRole("button", { name: "Use an email code instead" }),
		);

		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Send code" }));
		expect(await screen.findByLabelText("Email code")).toBeInTheDocument();
		expect(mockSendVerificationOtp).toHaveBeenCalledWith({
			email: "reviewer@example.com",
			type: "sign-in",
		});
		expect(mockSignInEmail).not.toHaveBeenCalled();
	});

	it("shows the password field once a failed lookup succeeds on window focus", async () => {
		mockAuthFetch
			.mockResolvedValueOnce({
				data: null,
				error: { status: 429, message: "Too many requests" },
			})
			.mockResolvedValue({ data: { available: true } });
		const user = userEvent.setup();
		render(<LoginForm />);

		await user.click(screen.getByRole("button", { name: "Log in with Email" }));
		await user.type(screen.getByLabelText("Email"), "reviewer@example.com");
		await waitFor(() => {
			expect(mockAuthFetch).toHaveBeenCalledTimes(1);
		});
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

		await act(async () => {
			window.dispatchEvent(new Event("focus"));
		});

		expect(await screen.findByLabelText("Password")).toBeInTheDocument();
		expect(mockAuthFetch).toHaveBeenCalledTimes(2);
	});

	it("shows password sign in errors and returns to email codes for another email", async () => {
		mockAuthFetch.mockImplementation(
			async (_path: string, options: { body: { email: string } }) => ({
				data: { available: options.body.email === "reviewer@example.com" },
			}),
		);
		mockSignInEmail.mockResolvedValue({
			error: { message: "Invalid email or password" },
		});
		mockSendVerificationOtp.mockResolvedValue({ error: null });
		const user = userEvent.setup();
		render(<LoginForm />);

		await user.click(screen.getByRole("button", { name: "Log in with Email" }));
		await user.type(screen.getByLabelText("Email"), "reviewer@example.com");
		await user.type(await screen.findByLabelText("Password"), "wrong-password");
		await user.click(screen.getByRole("button", { name: "Sign in" }));

		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("Invalid email or password");
		expect(alert).toHaveTextContent("Operation: password sign in");
		expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
		expect(mockNavigateToDestination).not.toHaveBeenCalled();
		expect(mockRefreshAuthClientState).not.toHaveBeenCalled();

		await user.clear(screen.getByLabelText("Email"));
		await user.type(screen.getByLabelText("Email"), "ada@example.com");
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Send code" }));
		expect(await screen.findByLabelText("Email code")).toBeInTheDocument();
		expect(mockSendVerificationOtp).toHaveBeenCalledWith({
			email: "ada@example.com",
			type: "sign-in",
		});
	});

	it("restores a pending email sign in code after remounting", async () => {
		mockSendVerificationOtp.mockResolvedValue({ error: null });
		mockSignInEmailOtp.mockResolvedValue({ error: null });

		const user = userEvent.setup();
		const view = render(<LoginForm />);

		await user.click(screen.getByRole("button", { name: "Log in with Email" }));
		await user.type(screen.getByLabelText("Email"), "ada@example.com");
		await user.click(screen.getByRole("button", { name: "Send code" }));

		await waitFor(() => {
			expect(mockSendVerificationOtp).toHaveBeenCalledWith({
				email: "ada@example.com",
				type: "sign-in",
			});
		});

		window.sessionStorage.clear();
		view.unmount();
		render(<LoginForm />);

		expect(
			screen.getByText("Sent email to ada@example.com."),
		).toBeInTheDocument();
		const loginCodeInput = screen.getByLabelText("Email code");
		expect(loginCodeInput).toHaveValue("");
		expect(loginCodeInput).toHaveFocus();
		expect(
			screen.getByRole("button", { name: "Verify code" }),
		).toBeInTheDocument();

		await user.type(screen.getByLabelText("Email code"), "123456");
		await user.click(screen.getByRole("button", { name: "Verify code" }));

		await waitFor(() => {
			expect(mockSignInEmailOtp).toHaveBeenCalledWith({
				email: "ada@example.com",
				otp: "123456",
			});
		});
		expect(readPendingEmailLoginCodeDraft()).toBeNull();
	});

	it("shows verbose dev details for email sign in failures", async () => {
		mockSendVerificationOtp.mockResolvedValue({ error: null });
		mockSignInEmailOtp.mockResolvedValue({
			error: {
				code: "INVALID_ORIGIN",
				message: "Invalid origin",
				status: 403,
				statusText: "Forbidden",
			},
		});

		const user = userEvent.setup();
		render(<LoginForm />);

		await user.click(screen.getByRole("button", { name: "Log in with Email" }));
		await user.type(screen.getByLabelText("Email"), "ada@example.com");
		await user.click(screen.getByRole("button", { name: "Send code" }));
		await user.type(await screen.findByLabelText("Email code"), "123456");
		await user.click(screen.getByRole("button", { name: "Verify code" }));

		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("Invalid origin");
		expect(alert).toHaveTextContent("Dev auth details:");
		expect(alert).toHaveTextContent("Operation: email code sign in");
		expect(alert).toHaveTextContent("Request origin: http://localhost:4011");
		expect(alert).toHaveTextContent("error.code: INVALID_ORIGIN");
		expect(alert).toHaveTextContent(
			"Likely fix: add the request origin to the API trusted origins",
		);
		expect(mockNavigateToDestination).not.toHaveBeenCalled();
	});
});
