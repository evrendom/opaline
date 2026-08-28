import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MemoryRouter,
	Outlet,
	Route,
	Routes,
	useLocation,
	useNavigate,
} from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContextValue } from "@/features/workspace/organization/types";
import {
	LegacyWorkspaceRedirect,
	WorkspaceRouteBoundary,
} from "@/features/workspace/routing/workspace-routes";

const { mockSwitchOrganization, mockUseOrganization } = vi.hoisted(() => ({
	mockSwitchOrganization: vi.fn(),
	mockUseOrganization: vi.fn(),
}));

vi.mock("@/features/workspace/organization/useOrganization", () => ({
	useOrganization: mockUseOrganization,
}));

const farmerville = {
	id: "org-1",
	name: "Farmerville",
	slug: "farmerville",
};
const opaline = { id: "org-2", name: "Opaline", slug: "opaline" };

let workspaceState: WorkspaceContextValue["state"];

function LocationProbe() {
	const location = useLocation();
	return (
		<output>{`${location.pathname}${location.search}${location.hash}`}</output>
	);
}

function BoundaryTestRoutes() {
	return (
		<Routes>
			<Route path="/:orgSlug" element={<WorkspaceRouteBoundary />}>
				<Route index element={<LocationProbe />} />
			</Route>
		</Routes>
	);
}

describe("workspace route boundaries", () => {
	beforeEach(() => {
		mockSwitchOrganization.mockReset();
		mockUseOrganization.mockReset();
		workspaceState = {
			activeOrg: farmerville,
			organizations: [farmerville, opaline],
			isLoading: false,
		};
		mockUseOrganization.mockImplementation(() => ({
			actions: { switchOrganization: mockSwitchOrganization },
			meta: { isOrgAdmin: true },
			state: workspaceState,
		}));
	});

	it("selects the organization named by the URL without rewriting it back", async () => {
		mockSwitchOrganization.mockImplementation(async () => {
			workspaceState = { ...workspaceState, activeOrg: opaline };
			return true;
		});

		const view = render(
			<MemoryRouter initialEntries={["/opaline"]}>
				<BoundaryTestRoutes />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(mockSwitchOrganization).toHaveBeenCalledWith("org-2");
		});
		view.rerender(
			<MemoryRouter initialEntries={["/opaline"]}>
				<BoundaryTestRoutes />
			</MemoryRouter>,
		);

		expect(screen.getByText("/opaline")).toBeInTheDocument();
	});

	it.each([
		"/wrapped",
		"/device",
		"/%66armerville",
	])("does not accept reserved or non-canonical workspace path %s", (pathname) => {
		render(
			<MemoryRouter initialEntries={[pathname]}>
				<BoundaryTestRoutes />
			</MemoryRouter>,
		);

		expect(screen.getByText("Page not found")).toBeInTheDocument();
		expect(mockSwitchOrganization).not.toHaveBeenCalled();
	});

	it("preserves query and hash while canonicalizing legacy routes", () => {
		render(
			<MemoryRouter initialEntries={["/dashboard?range=30d#chart"]}>
				<Routes>
					<Route
						path="/dashboard"
						element={<LegacyWorkspaceRedirect route="dashboard" />}
					/>
					<Route path="/:orgSlug" element={<LocationProbe />} />
				</Routes>
			</MemoryRouter>,
		);

		expect(
			screen.getByText("/farmerville?range=30d#chart"),
		).toBeInTheDocument();
	});

	it("allows a failed organization selection to retry after visiting another slug", async () => {
		mockSwitchOrganization
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);

		function NavigationHarness() {
			const navigate = useNavigate();
			return (
				<>
					<button
						type="button"
						onClick={() => {
							workspaceState = { ...workspaceState, activeOrg: farmerville };
							navigate("/farmerville");
						}}
					>
						Visit Farmerville
					</button>
					<button type="button" onClick={() => navigate("/opaline")}>
						Retry Opaline
					</button>
					<Outlet />
				</>
			);
		}

		render(
			<MemoryRouter initialEntries={["/opaline"]}>
				<Routes>
					<Route element={<NavigationHarness />}>
						<Route path="/:orgSlug" element={<WorkspaceRouteBoundary />}>
							<Route index element={<LocationProbe />} />
						</Route>
					</Route>
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText("Page not found")).toBeInTheDocument();
		});
		await userEvent.click(
			screen.getByRole("button", { name: "Visit Farmerville" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Retry Opaline" }),
		);

		await waitFor(() => {
			expect(mockSwitchOrganization).toHaveBeenCalledTimes(2);
		});
	});
});
