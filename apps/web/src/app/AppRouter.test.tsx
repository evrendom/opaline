import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppRouter } from "./AppRouter";

const { mockUseOrganization } = vi.hoisted(() => ({
	mockUseOrganization: vi.fn(() => ({
		actions: { switchOrganization: vi.fn() },
		meta: { isOrgAdmin: true },
		state: { activeOrg: null, isLoading: false, organizations: [] },
	})),
}));

vi.mock("@/features/workspace/organization/useOrganization", () => ({
	useOrganization: mockUseOrganization,
}));

vi.mock("@/features/invitations/AcceptInvitationPage", () => ({
	AcceptInvitationPage: () => <div>Invitation Page</div>,
}));

vi.mock("@/features/shell/AppShellLayout", () => ({
	AppShellLayout: () => <div>App shell</div>,
}));

describe("AppRouter", () => {
	it("preserves explicit authenticated root redirects", async () => {
		render(
			<MemoryRouter initialEntries={["/"]}>
				<AppRouter rootRedirectTarget="/invitation/123" />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText("Invitation Page")).toBeInTheDocument();
		});
	});
});
