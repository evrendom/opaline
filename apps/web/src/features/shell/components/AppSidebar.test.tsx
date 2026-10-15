import { render, screen, within } from "@testing-library/react";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./AppSidebar";

function Passthrough({ children }: { children?: ReactNode }) {
	return <div>{children}</div>;
}

vi.mock("@/app/ui/sidebar", () => ({
	Sidebar: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
	SidebarContent: Passthrough,
	SidebarFooter: ({ children }: { children: ReactNode }) => (
		<footer>{children}</footer>
	),
	SidebarGroup: Passthrough,
	SidebarGroupContent: Passthrough,
	SidebarHeader: Passthrough,
	SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
	SidebarMenuItem: ({ children }: { children: ReactNode }) => (
		<li>{children}</li>
	),
	SidebarMenuButton: ({
		render = <button type="button" />,
		isActive,
		children,
		...props
	}: {
		render?: ReactElement<Record<string, unknown>>;
		isActive?: boolean;
		children: ReactNode;
	}) =>
		cloneElement(
			render,
			{ ...props, "data-active": isActive ? "" : undefined },
			children,
		),
}));

vi.mock("@/features/shell/components/SidebarUserMenu", () => ({
	SidebarUserMenu: () => (
		<li>
			<button type="button">User menu</button>
		</li>
	),
}));

vi.mock("@/features/shell/components/SidebarWorkspaceSwitcher", () => ({
	SidebarWorkspaceSwitcher: () => <button type="button">Workspace menu</button>,
}));

vi.mock("@/features/shell/hooks/use-shell-route-path", () => ({
	useShellRoutePath: () => (path: string) => path,
}));

vi.mock("@/features/shell/hooks/useCurrentShellRoute", () => ({
	useCurrentShellRoute: () => ({ id: "sessions" }),
}));

const agentTraces = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/features/agent-traces/use-agent-traces-access", () => ({
	useAgentTracesEnabled: () => agentTraces.enabled,
}));

const compass = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/features/compass/use-compass-access", () => ({
	useCompassEnabled: () => compass.enabled,
}));

function renderSidebar() {
	return render(
		<MemoryRouter>
			<AppSidebar />
		</MemoryRouter>,
	);
}

describe("AppSidebar", () => {
	it("lists the sections as labelled links, with settings in the footer", () => {
		agentTraces.enabled = false;
		renderSidebar();

		const navigation = screen.getByRole("navigation", { name: "Primary" });
		expect(
			within(navigation)
				.getAllByRole("link")
				.map((link) => link.textContent),
		).toEqual(["Dashboard", "Sessions", "Skills", "Repos", "Team"]);

		const footer = screen.getByRole("contentinfo");
		expect(
			within(footer).getByRole("link", { name: "Settings" }),
		).toHaveAttribute("href", "/settings");
	});

	it("shows Agent traces after Skills only where the workspace may open it", () => {
		agentTraces.enabled = true;
		renderSidebar();

		const navigation = screen.getByRole("navigation", { name: "Primary" });
		expect(
			within(navigation)
				.getAllByRole("link")
				.map((link) => link.textContent),
		).toEqual([
			"Dashboard",
			"Sessions",
			"Skills",
			"Agent traces",
			"Repos",
			"Team",
		]);
		agentTraces.enabled = false;
	});

	it("shows Compass first only where the workspace has it", () => {
		compass.enabled = true;
		renderSidebar();

		const navigation = screen.getByRole("navigation", { name: "Primary" });
		expect(
			within(navigation)
				.getAllByRole("link")
				.map((link) => link.textContent),
		).toEqual(["Compass", "Dashboard", "Sessions", "Skills", "Repos", "Team"]);
		expect(
			within(navigation).getByRole("link", { name: "Compass" }),
		).toHaveAttribute("href", "/compass");
		compass.enabled = false;
	});

	it("offers the install command above settings", () => {
		renderSidebar();

		const footer = screen.getByRole("contentinfo");
		const items = within(footer).getAllByRole("listitem");
		expect(
			within(items[0]).getByRole("button", {
				name: "Copy install command: npx opaline@latest",
			}),
		).toHaveTextContent("npx opaline@latest");
		expect(
			within(items[1]).getByRole("link", { name: "Settings" }),
		).toBeInTheDocument();
	});

	it("marks only the current section as active", () => {
		renderSidebar();

		const current = screen.getByRole("link", { current: "page" });
		expect(current).toHaveTextContent("Sessions");
		expect(current).toHaveAttribute("data-active");
		expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
			"data-active",
		);
	});

	it("keeps the workspace switcher and user menu", () => {
		renderSidebar();

		expect(
			screen.getByRole("button", { name: "Workspace menu" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "User menu" }),
		).toBeInTheDocument();
	});
});
