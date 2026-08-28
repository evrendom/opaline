import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AcceptInvitationPage } from "@/features/invitations/AcceptInvitationPage";

const { mockAcceptInvitation, mockInvalidateQueries, mockSwitchOrganization } =
	vi.hoisted(() => ({
		mockAcceptInvitation: vi.fn(),
		mockInvalidateQueries: vi.fn(),
		mockSwitchOrganization: vi.fn(),
	}));

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock("@/features/analytics/tracking/useAnalyticsTracking", () => ({
	useAnalyticsTracking: () => ({ trackAuthenticationAction: vi.fn() }),
}));

vi.mock("@/features/workspace/organization/useOrganization", () => ({
	useOrganization: () => ({
		actions: { switchOrganization: mockSwitchOrganization },
		meta: { isOrgAdmin: true },
		state: {
			activeOrg: { id: "org-1", name: "Farmerville", slug: "farmerville" },
			isLoading: false,
			organizations: [],
		},
	}),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		organization: {
			acceptInvitation: mockAcceptInvitation,
			rejectInvitation: vi.fn(),
		},
		useSession: () => ({
			data: { user: { id: "user-1" } },
			isPending: false,
		}),
	},
}));

describe("AcceptInvitationPage", () => {
	beforeEach(() => {
		mockAcceptInvitation.mockReset();
		mockInvalidateQueries.mockReset();
		mockSwitchOrganization.mockReset();
	});

	it("does not report success when the accepted workspace cannot become active", async () => {
		mockAcceptInvitation.mockResolvedValue({
			data: { member: { organizationId: "org-2" } },
			error: null,
		});
		mockSwitchOrganization.mockResolvedValue(false);

		render(
			<MemoryRouter initialEntries={["/invitation/invite-1"]}>
				<Routes>
					<Route
						path="/invitation/:invitationId"
						element={<AcceptInvitationPage />}
					/>
				</Routes>
			</MemoryRouter>,
		);

		await userEvent.click(screen.getByRole("button", { name: "Accept" }));

		expect(
			await screen.findByText(
				"Invitation accepted, but the workspace could not be opened. Refresh and try again.",
			),
		).toBeInTheDocument();
		expect(screen.queryByText("Welcome to the team!")).toBeNull();
	});
});
