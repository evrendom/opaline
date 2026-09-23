import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { GetStartedRouteGate } from "@/features/get-started/GetStartedRouteGate";

const { mockUseSession } = vi.hoisted(() => ({
	mockUseSession: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession: mockUseSession,
	},
}));

vi.mock("@/features/analytics/tracking/ProductAnalyticsSessionSync", () => ({
	ProductAnalyticsSessionSync: () => null,
}));

vi.mock("@/features/auth/GuestApp", () => ({
	GuestApp: () => <div>Guest App</div>,
}));

vi.mock("@/features/auth/AuthenticatedApp", () => ({
	AuthenticatedApp: ({
		rootRedirectTarget,
	}: {
		rootRedirectTarget: string | null;
	}) => (
		<div>
			<div>Authenticated App</div>
			<div>Root redirect: {rootRedirectTarget ?? "none"}</div>
		</div>
	),
}));

vi.mock("@/features/auth/ResetPasswordApp", () => ({
	ResetPasswordApp: () => <div>Reset Password App</div>,
}));

describe("App routing", () => {
	beforeEach(() => {
		mockUseSession.mockReset();
		mockUseSession.mockReturnValue({ data: null, isPending: false });
	});

	it("renders the desktop-only overlay on the guest homepage", () => {
		render(
			<MemoryRouter initialEntries={["/"]}>
				<App />
			</MemoryRouter>,
		);

		expect(screen.getByText("Guest App")).toBeInTheDocument();
		expect(screen.getByTestId("desktop-only-overlay")).toHaveClass(
			"hidden",
			"max-[499px]:flex",
		);
	});

	it.each([
		"/?user_code=ABCD-1234",
		"/device?user_code=ABCD-1234",
	])("redirects the legacy device entry %s into welcome", async (entry) => {
		render(
			<MemoryRouter initialEntries={[entry]}>
				<App />
				<CurrentLocation />
			</MemoryRouter>,
		);

		expect(
			await screen.findByText("/welcome?user_code=ABCD-1234"),
		).toBeInTheDocument();
	});
});

function CurrentLocation() {
	const { pathname, search } = useLocation();
	return (
		<div>
			{pathname}
			{search}
		</div>
	);
}

it.each([
	"/get-started",
	"/dashboard/get-started",
])("preserves CLI pairing parameters when redirecting %s to welcome", async (pathname) => {
	render(
		<MemoryRouter
			initialEntries={[`${pathname}?connect=pairing-id&user_code=ABCD-1234`]}
		>
			<GetStartedRouteGate />
			<CurrentLocation />
		</MemoryRouter>,
	);
	expect(
		await screen.findByText("/welcome?connect=pairing-id&user_code=ABCD-1234"),
	).toBeInTheDocument();
});

it.each([
	"/wrapped",
	"/wrapped/share-id",
	"/dev/wrapped",
	"/resume/old-token",
])("shows a missing page for retired %s links without redirecting", (pathname) => {
	mockUseSession.mockReturnValue({ data: null, isPending: false });
	render(
		<MemoryRouter initialEntries={[pathname]}>
			<App />
			<CurrentLocation />
		</MemoryRouter>,
	);
	expect(
		screen.getByRole("heading", { name: "Page not found" }),
	).toBeInTheDocument();
	expect(screen.getByText(pathname)).toBeInTheDocument();
	expect(screen.queryByText("Guest App")).toBeNull();
});
