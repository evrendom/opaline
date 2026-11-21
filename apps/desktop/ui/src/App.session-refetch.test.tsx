import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import {
	SelfHostContext,
	type SelfHostInfo,
} from "@/features/self-hosted/self-host-info";

interface SessionState {
	data: null;
	isPending: boolean;
	isRefetching: boolean;
}

const { sessionStore } = vi.hoisted(() => {
	let state: SessionState = {
		data: null,
		isPending: true,
		isRefetching: false,
	};
	const listeners = new Set<() => void>();
	return {
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
});

vi.mock("@/lib/auth-client", async () => {
	const { useSyncExternalStore } =
		await vi.importActual<typeof import("react")>("react");
	return {
		authClient: {
			emailOtp: { sendVerificationOtp: vi.fn() },
			signIn: { email: vi.fn(), emailOtp: vi.fn(), social: vi.fn() },
			signUp: { email: vi.fn() },
			useSession: () =>
				useSyncExternalStore(sessionStore.subscribe, sessionStore.get),
		},
		refreshAuthClientState: vi.fn(),
	};
});

vi.mock("@/features/auth/AuthenticatedApp", () => ({
	AuthenticatedApp: () => <div>Authenticated App</div>,
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

const info: SelfHostInfo = {
	selfHosted: true,
	version: "dev",
	appUrl: "http://localhost:4011",
	mcpUrl: "http://localhost:4011/api/mcp",
	setupComplete: true,
	auth: { password: true, emailCodes: false, social: [], openSignup: false },
};

function renderApp(path = "/login") {
	return render(
		<SelfHostContext value={info}>
			<MemoryRouter initialEntries={[path]}>
				<App />
			</MemoryRouter>
		</SelfHostContext>,
	);
}

describe("signed-out session re-fetch on window focus", () => {
	beforeEach(() => {
		window.localStorage.clear();
		window.sessionStorage.clear();
		sessionStore.set({ data: null, isPending: false, isRefetching: false });
	});

	it("shows the loading screen only while the first session lookup runs", async () => {
		sessionStore.set({ data: null, isPending: true, isRefetching: true });
		renderApp();

		expect(
			screen.queryByRole("button", { name: "Sign in" }),
		).not.toBeInTheDocument();
		await act(async () => {
			sessionStore.set({ data: null, isPending: false, isRefetching: false });
		});
		expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
	});

	it("keeps the typed email and password", async () => {
		const user = userEvent.setup();
		renderApp();
		const emailField = screen.getByLabelText("Email");
		await user.type(emailField, "ada@example.com");
		const passwordField = screen.getByLabelText("Password");
		await user.type(passwordField, "correct horse");

		await returnToTab();

		expect(screen.getByLabelText("Email")).toBe(emailField);
		expect(emailField).toHaveValue("ada@example.com");
		expect(screen.getByLabelText("Password")).toBe(passwordField);
		expect(passwordField).toHaveValue("correct horse");
	});
});
