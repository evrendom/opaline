import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet } from "react-router-dom";
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
	useOptionalOrganization: mockUseOrganization,
}));

vi.mock("@/features/invitations/AcceptInvitationPage", () => ({
	AcceptInvitationPage: () => <div>Invitation Page</div>,
}));

vi.mock("@/features/shell/AppShellLayout", () => ({
	LeftSidebarAppShellLayout: () => (
		<div>
			Left sidebar shell
			<Outlet />
		</div>
	),
}));

vi.mock("@/features/dashboard/DashboardPage", () => ({
	DashboardPage: () => <div>Dashboard page</div>,
}));

vi.mock("@/features/sessions/sessions-page", () => ({
	SessionsPage: () => <div>Sessions page</div>,
}));

vi.mock("@/features/sessions/new-session-page", () => ({
	NewSessionPage: () => <div>New session page</div>,
}));

vi.mock("@/features/skills/SkillsPage", () => ({
	SkillsPage: () => <div>Historical skills page</div>,
}));

vi.mock("@/features/team/TeamPage", () => ({
	TeamPage: () => <div>Team page</div>,
}));

vi.mock("@/features/settings/SettingsLayout", () => ({
	SettingsLayout: () => (
		<div>
			Settings layout
			<Outlet />
		</div>
	),
}));

vi.mock("@/features/settings/workspace/WorkspaceSettingsPage", () => ({
	WorkspaceSettingsPage: () => <div>Workspace settings page</div>,
}));

vi.mock("@/features/settings/members/MembersSettingsPage", () => ({
	MembersSettingsPage: () => <div>Members settings page</div>,
}));

vi.mock("@/features/settings/account/AccountSettingsPage", () => ({
	AccountSettingsPage: () => <div>Account settings page</div>,
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

	it.each([
		["/home", "Dashboard page"],
		["/session", "Sessions page"],
		["/session/session-123", "Sessions page"],
		["/session/session-123/v2", "Sessions page"],
		["/newsesh", "New session page"],
		["/newsesh/session-123", "New session page"],
		["/skills", "Historical skills page"],
		["/team", "Team page"],
		["/settings", "Workspace settings page"],
		["/settings/members", "Members settings page"],
		["/settings/account", "Account settings page"],
	])("routes canonical %s through the left sidebar shell", async (path, pageContent) => {
		render(
			<MemoryRouter initialEntries={[path]}>
				<AppRouter rootRedirectTarget={null} />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText("Left sidebar shell")).toBeInTheDocument();
			expect(screen.getByText(pageContent)).toBeInTheDocument();
		});
	});

	it("keeps /dashboard as a compatibility redirect to /home", async () => {
		render(
			<MemoryRouter initialEntries={["/dashboard"]}>
				<AppRouter rootRedirectTarget={null} />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText("Left sidebar shell")).toBeInTheDocument();
			expect(screen.getByText("Dashboard page")).toBeInTheDocument();
		});
	});

	it.each([
		"/__preset-baseline",
		"/dev/bottom-rail",
		"/dev/bottom-rail/session",
		"/centered-sidebar",
		"/centered-sidebar/session",
		"/olivetti-rail",
		"/olivetti-rail/team",
		"/floating-row",
		"/floating-row/settings",
		"/dev/left-sidebar",
		"/dev/left-sidebar/session",
		"/dev/left-sidebar-thread",
		"/dev/left-sidebar-thread/session",
	])("does not expose archived shell %s", async (path) => {
		render(
			<MemoryRouter initialEntries={[path]}>
				<AppRouter rootRedirectTarget={null} />
			</MemoryRouter>,
		);
		expect(
			await screen.findByRole("heading", { name: "Page not found" }),
		).toBeInTheDocument();
		expect(screen.queryByText("Left sidebar shell")).not.toBeInTheDocument();
	});
});
