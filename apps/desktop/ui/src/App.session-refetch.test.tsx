import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { writePendingEmailSignupCodeDraft } from "@/features/auth/email-code-auth";

interface SessionState {
	data: null;
	isPending: boolean;
	isRefetching: boolean;
}

const { mockAuthFetch, mockSendVerificationOtp, sessionStore } = vi.hoisted(
	() => {
		let state: SessionState = {
			data: null,
			isPending: true,
			isRefetching: false,
		};
		const listeners = new Set<() => void>();
		return {
			mockAuthFetch: vi.fn(),
			mockSendVerificationOtp: vi.fn(),
			sessionStore: {
				get: () => state,
				set(next: SessionState) {
					state = next;
					for (const listener of listeners) listener();
				},
				subscribe(listener: () => void) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
			},
		};
	},
);

vi.mock("@/lib/auth-client", async () => {
	const { useSyncExternalStore } =
		await vi.importActual<typeof import("react")>("react");
	return {
		authClient: {
			$fetch: mockAuthFetch,
			emailOtp: { sendVerificationOtp: mockSendVerificationOtp },
			signIn: { email: vi.fn(), emailOtp: vi.fn(), social: vi.fn() },
			useSession: () =>
				useSyncExternalStore(sessionStore.subscribe, sessionStore.get),
		},
		refreshAuthClientState: vi.fn(),
	};
});

vi.mock("@/features/analytics/tracking/ProductAnalyticsSessionSync", () => ({
	ProductAnalyticsSessionSync: () => null,
}));

vi.mock("@/features/analytics/tracking/useAnalyticsTracking", () => ({
	useAnalyticsTracking: () => ({ trackAuthenticationAction: vi.fn() }),
}));

vi.mock("@/features/auth/AuthenticatedApp", () => ({
	AuthenticatedApp: () => <div>Authenticated App</div>,
}));

vi.mock("@/features/support/SupportEmailButton", () => ({
	SupportEmailButton: () => null,
}));

/**
 * What Better Auth does when a signed-out tab becomes visible again: the
 * session query reports `isPending` while it re-fetches, then resolves to the
 * same signed-out session.
 */
async function returnToTab() {
	await act(async () => {
		sessionStore.set({ data: null, isPending: true, isRefetching: true });
	});
	await act(async () => {
		sessionStore.set({ data: null, isPending: false, isRefetching: false });
	});
}

function renderApp(path = "/login") {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<App />
		</MemoryRouter>,
	);
}

describe("signed-out session re-fetch on window focus", () => {
	beforeEach(() => {
		window.localStorage.clear();
		window.sessionStorage.clear();
		mockAuthFetch.mockReset();
		mockAuthFetch.mockResolvedValue({ data: { available: true } });
		mockSendVerificationOtp.mockReset();
		mockSendVerificationOtp.mockResolvedValue({ error: null });
		sessionStore.set({ data: null, isPending: false, isRefetching: false });
	});

	it("shows the loading screen only while the first session lookup runs", async () => {
		sessionStore.set({ data: null, isPending: true, isRefetching: true });
		renderApp();

		expect(
			screen.queryByRole("button", { name: "Log in with Email" }),
		).not.toBeInTheDocument();
		await act(async () => {
			sessionStore.set({ data: null, isPending: false, isRefetching: false });
		});
		expect(
			screen.getByRole("button", { name: "Log in with Email" }),
		).toBeInTheDocument();
	});

	it("keeps the typed login email and password", async () => {
		const user = userEvent.setup();
		renderApp();
		await user.click(screen.getByRole("button", { name: "Log in with Email" }));
		const emailField = screen.getByLabelText("Email");
		await user.type(emailField, "openai-review@opaline.so");
		const passwordField = await screen.findByLabelText("Password");
		await user.type(passwordField, "reviewer-password");

		await returnToTab();

		expect(screen.getByLabelText("Email")).toBe(emailField);
		expect(emailField).toHaveValue("openai-review@opaline.so");
		expect(screen.getByLabelText("Password")).toBe(passwordField);
		expect(passwordField).toHaveValue("reviewer-password");
	});

	it("keeps a partly typed login email code", async () => {
		mockAuthFetch.mockResolvedValue({ data: { available: false } });
		const user = userEvent.setup();
		renderApp();
		await user.click(screen.getByRole("button", { name: "Log in with Email" }));
		await user.type(screen.getByLabelText("Email"), "ada@example.com");
		await user.click(screen.getByRole("button", { name: "Send code" }));
		const codeField = await screen.findByLabelText("Email code");
		await user.type(codeField, "123");

		await returnToTab();

		expect(screen.getByLabelText("Email code")).toBe(codeField);
		expect(codeField).toHaveValue("123");
	});

	it("keeps a partly typed sign-up email code", async () => {
		writePendingEmailSignupCodeDraft("ada@example.com");
		const user = userEvent.setup();
		renderApp("/");
		const codeField = screen.getByLabelText("Email code");
		await user.type(codeField, "123");

		await returnToTab();

		expect(screen.getByLabelText("Email code")).toBe(codeField);
		expect(codeField).toHaveValue("123");
	});
});
