import assert from "node:assert/strict";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import {
	OrganizationProvider,
	useOrganization,
} from "@/features/workspace/organization/OrganizationProvider";

const {
	mockSetActive,
	mockGetFullOrganization,
	mockUseActiveMember,
	mockUseActiveOrganization,
	mockUseListOrganizations,
} = vi.hoisted(() => ({
	mockSetActive: vi.fn(),
	mockGetFullOrganization: vi.fn(),
	mockUseActiveMember: vi.fn(),
	mockUseActiveOrganization: vi.fn(),
	mockUseListOrganizations: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		organization: {
			getFullOrganization: mockGetFullOrganization,
			setActive: mockSetActive,
		},
		useActiveMember: mockUseActiveMember,
		useActiveOrganization: mockUseActiveOrganization,
		useListOrganizations: mockUseListOrganizations,
	},
}));

const organization = {
	id: "org-1",
	logo: null,
	name: "Rudel",
	slug: "rudel",
};

beforeEach(() => {
	vi.clearAllMocks();
});

function OrganizationStateProbe() {
	const { state } = useOrganization();

	return (
		<output>
			{state.activeOrg?.id ?? "no-organization"}:
			{state.isLoading ? "pending" : "ready"}
		</output>
	);
}

function OrganizationSwitchProbe({
	destination,
	organizationId,
}: {
	destination?: "preserve" | "team";
	organizationId: string;
}) {
	const { actions } = useOrganization();
	const location = useLocation();

	return (
		<>
			<button
				type="button"
				onClick={() =>
					void actions.switchOrganization(organizationId, { destination })
				}
			>
				Switch
			</button>
			<output>{`${location.pathname}${location.search}${location.hash}`}</output>
		</>
	);
}

it("recovers after full-organization is rate limited and auto-select succeeds", async () => {
	let resolveSetActive:
		| ((result: { data: typeof organization; error: null }) => void)
		| undefined;
	const setActivePromise = new Promise<{
		data: typeof organization;
		error: null;
	}>((resolve) => {
		resolveSetActive = resolve;
	});

	mockUseActiveOrganization.mockReturnValue({
		data: null,
		error: { status: 429 },
		isPending: false,
	});
	mockUseListOrganizations.mockReturnValue({
		data: [organization],
		error: null,
		isPending: false,
	});
	mockUseActiveMember.mockReturnValue({ data: null });
	mockSetActive.mockReturnValue(setActivePromise);

	render(
		<MemoryRouter>
			<OrganizationProvider>
				<OrganizationStateProbe />
			</OrganizationProvider>
		</MemoryRouter>,
	);

	await waitFor(() => {
		expect(mockSetActive).toHaveBeenCalledWith({ organizationId: "org-1" });
		expect(screen.getByText("no-organization:pending")).toBeInTheDocument();
	});

	assert(resolveSetActive);
	const completeSetActive = resolveSetActive;
	await act(async () => {
		completeSetActive({ data: organization, error: null });
		await setActivePromise;
	});

	await waitFor(() => {
		expect(screen.getByText("org-1:ready")).toBeInTheDocument();
	});
});

it("rewrites the workspace prefix and preserves route state when switching", async () => {
	const secondOrganization = {
		id: "org-2",
		logo: null,
		name: "Opaline",
		slug: "opaline",
	};
	mockUseActiveOrganization.mockReturnValue({
		data: organization,
		isPending: false,
	});
	mockUseListOrganizations.mockReturnValue({
		data: [organization, secondOrganization],
		isPending: false,
	});
	mockUseActiveMember.mockReturnValue({ data: { role: "owner" } });
	mockSetActive.mockResolvedValue({ data: secondOrganization, error: null });

	render(
		<MemoryRouter initialEntries={["/rudel/settings/members?tab=all#people"]}>
			<OrganizationProvider>
				<OrganizationSwitchProbe organizationId="org-2" />
			</OrganizationProvider>
		</MemoryRouter>,
	);

	await userEvent.click(screen.getByRole("button", { name: "Switch" }));

	await waitFor(() => {
		expect(
			screen.getByText("/opaline/settings/members?tab=all#people"),
		).toBeInTheDocument();
	});
});

it("resolves a newly joined organization before canonical navigation", async () => {
	const invitedOrganization = {
		id: "org-2",
		logo: null,
		name: "Opaline",
		slug: "opaline",
	};
	mockUseActiveOrganization.mockReturnValue({
		data: organization,
		isPending: false,
	});
	mockUseListOrganizations.mockReturnValue({
		data: [organization],
		isPending: false,
	});
	mockUseActiveMember.mockReturnValue({ data: { role: "owner" } });
	mockSetActive.mockResolvedValue({ data: invitedOrganization, error: null });
	mockGetFullOrganization.mockResolvedValue({
		data: invitedOrganization,
		error: null,
	});

	render(
		<MemoryRouter initialEntries={["/invitation/invite-1"]}>
			<OrganizationProvider>
				<OrganizationSwitchProbe organizationId="org-2" />
			</OrganizationProvider>
		</MemoryRouter>,
	);

	await userEvent.click(screen.getByRole("button", { name: "Switch" }));

	await waitFor(() => {
		expect(screen.getByText("/opaline")).toBeInTheDocument();
	});
});

it("supports an explicit canonical team destination", async () => {
	const secondOrganization = {
		id: "org-2",
		logo: null,
		name: "Opaline",
		slug: "opaline",
	};
	mockUseActiveOrganization.mockReturnValue({
		data: organization,
		isPending: false,
	});
	mockUseListOrganizations.mockReturnValue({
		data: [organization, secondOrganization],
		isPending: false,
	});
	mockUseActiveMember.mockReturnValue({ data: { role: "owner" } });
	mockSetActive.mockResolvedValue({ data: secondOrganization, error: null });

	render(
		<MemoryRouter initialEntries={["/team/invite/token-1"]}>
			<OrganizationProvider>
				<OrganizationSwitchProbe destination="team" organizationId="org-2" />
			</OrganizationProvider>
		</MemoryRouter>,
	);

	await userEvent.click(screen.getByRole("button", { name: "Switch" }));

	await waitFor(() => {
		expect(screen.getByText("/opaline/team")).toBeInTheDocument();
	});
});
