import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./AppSidebar";

vi.mock("@/app/ui/sidebar", () => ({
	Sidebar: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
}));

vi.mock("@/features/shell/components/shell-rail", () => ({
	RailLink: ({ label, to }: { label: string; to: string }) => (
		<li>
			<a href={to}>{label}</a>
		</li>
	),
}));

vi.mock("@/features/shell/components/UserRailButton", () => ({
	UserRailButton: () => <button type="button">User menu</button>,
}));

vi.mock("@/features/shell/components/WorkspaceMenuButton", () => ({
	WorkspaceMenuButton: () => <button type="button">Workspace menu</button>,
}));

vi.mock("@/features/shell/hooks/use-shell-route-path", () => ({
	useShellRoutePath: () => (path: string) => path,
}));

vi.mock("@/features/shell/hooks/useCurrentShellRoute", () => ({
	useCurrentShellRoute: () => ({ id: "dashboard" }),
}));

describe("AppSidebar", () => {
	it("centers only the navigation icons with 20px of additional spacing", () => {
		const { container } = render(
			<MemoryRouter>
				<AppSidebar layout="centered" />
			</MemoryRouter>,
		);

		expect(screen.queryByRole("button", { name: "Workspace menu" })).toBeNull();
		expect(screen.queryByRole("button", { name: "User menu" })).toBeNull();

		const navigation = screen.getByRole("navigation", { name: "Primary" });
		expect(
			within(navigation)
				.getAllByRole("link")
				.map((link) => link.getAttribute("href")),
		).toEqual(["/session", "/team", "/settings"]);
		expect(navigation.querySelector("ul")).toHaveClass("gap-5.5");
		expect(
			container.querySelector("[data-sidebar-navigation-stage]"),
		).toHaveClass("flex", "items-center");
	});

	it("keeps the workspace and user controls in the standard sidebar", () => {
		render(
			<MemoryRouter>
				<AppSidebar />
			</MemoryRouter>,
		);

		expect(
			screen.getByRole("button", { name: "Workspace menu" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "User menu" }),
		).toBeInTheDocument();
	});
});
