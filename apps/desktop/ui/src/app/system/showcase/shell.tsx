import type { ReactNode } from "react";
import { SidebarInset, SidebarMenu, SidebarProvider } from "@/app/ui/sidebar";
import { ShellDashboardRangeControls } from "@/features/costs/dashboard-range-controls";
import {
	AppSidebar,
	SidebarNavItem,
	SidebarNavTile,
} from "@/features/shell/components/AppSidebar";
import { LastSessionUploadBar } from "@/features/shell/components/last-session-upload-bar";
import {
	SidebarAllReposRow,
	SidebarRepositories,
	SidebarRepositoryRow,
} from "@/features/shell/components/SidebarRepositories";
import { SidebarUserMenu } from "@/features/shell/components/SidebarUserMenu";
import { SidebarWorkspaceSwitcher } from "@/features/shell/components/SidebarWorkspaceSwitcher";
import { SiteHeader } from "@/features/shell/components/SiteHeader";
import { ShellWindowColumn } from "@/features/shell/components/shell-window-column";
import { REPOSITORY_HUES } from "@/features/shell/components/sidebar-repositories-model";
import {
	shellNavigationRoutes,
	shellRouteMap,
} from "@/features/shell/config/shell-routes";
import { shellChromeStyle } from "@/features/shell/shell-chrome-style";
import { cn } from "@/lib/utils";
import { Group, Specimen, State } from "./kit";

// The sidebar's four tiles: every navigation route but Settings (the
// footer row), Repos (the Repositories group) and Compass.
const TILE_ROUTES = shellNavigationRoutes.filter(
	(route) =>
		route.id !== "settings" && route.id !== "repos" && route.id !== "compass",
);

const noop = () => {};

/**
 * The window chrome the sidebar sits on, as AppShellLayout sets it up: the
 * dashboard-01 chrome variables, the translucent chrome frame and a sidebar
 * provider, at the sidebar's width.
 */
function Chrome({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className="dashboard-01-theme product-app-shell corner-s shadow-inset">
			<SidebarProvider
				className={cn(
					"dashboard-01-chrome-frame min-h-0 w-(--sidebar-width) flex-col p-m text-sidebar-foreground",
					className,
				)}
				style={shellChromeStyle}
			>
				{children}
			</SidebarProvider>
		</div>
	);
}

function ShellFrame() {
	return (
		<div className="dashboard-01-theme product-app-shell h-[36rem] w-full overflow-hidden corner-s shadow-inset">
			<SidebarProvider
				className="group/shell dashboard-01-chrome-frame relative h-full min-h-0 overflow-clip overscroll-none"
				style={shellChromeStyle}
			>
				<AppSidebar fillHeight />
				<ShellWindowColumn footer={<LastSessionUploadBar />}>
					<SidebarInset>
						<SiteHeader
							actions={<ShellDashboardRangeControls />}
							setNewseshListPortalHost={noop}
							setPortalHost={noop}
							showWorkspaceMenu={false}
						/>
					</SidebarInset>
				</ShellWindowColumn>
			</SidebarProvider>
		</div>
	);
}

/** The sidebar's workspace switcher on the chrome, closed. */
export function WorkspaceSwitcherControl() {
	return (
		<Chrome>
			<SidebarWorkspaceSwitcher />
		</Chrome>
	);
}

const SAMPLE_REPO = {
	key: "remote:github.com/acme/loomrail",
	label: "loomrail",
	title: "acme/loomrail · 77 sessions",
};

export function ShellGroup() {
	return (
		<Group title="Shell">
			<Specimen
				name="App shell"
				source="features/shell/AppShellLayout.tsx"
				where="Every signed-in screen: the sidebar on the window chrome, the window with its header, the last-upload strip under it (this one, on the dashboard)."
			>
				<ShellFrame />
			</Specimen>

			<Specimen
				name="SidebarNavTile"
				source="features/shell/components/AppSidebar.tsx"
				where="The sidebar's top row: Dashboard, Sessions, Skills, MCP. The open section's tile wears its colour."
			>
				{(["active", "resting"] as const).map((state) => (
					<State key={state} label={state}>
						<Chrome>
							<ul className="grid grid-cols-4 gap-s px-xs pt-xxs">
								{TILE_ROUTES.map((route) => (
									<SidebarNavTile
										key={route.id}
										route={route}
										active={state === "active"}
									/>
								))}
							</ul>
						</Chrome>
					</State>
				))}
			</Specimen>

			<Specimen
				name="SidebarWorkspaceSwitcher"
				source="features/shell/components/SidebarWorkspaceSwitcher.tsx"
				where="The sidebar's header: the workspace's mark and name; it opens the workspace menu (Overlays)."
			>
				<State label="at rest">
					<WorkspaceSwitcherControl />
				</State>
			</Specimen>

			<Specimen
				name="SidebarRepositories"
				source="features/shell/components/SidebarRepositories.tsx"
				where="The sidebar under the tiles: the workspace's most used repositories, each with its own hue."
			>
				<State label="the workspace's repositories">
					<Chrome className="p-zero">
						<SidebarRepositories reposActive={false} />
					</Chrome>
				</State>
				<State label="row: open repo, uploading, live, All repos">
					<Chrome>
						<SidebarMenu>
							<SidebarRepositoryRow
								repo={SAMPLE_REPO}
								hue={REPOSITORY_HUES[0]}
								active
								status={null}
							/>
							<SidebarRepositoryRow
								repo={{ ...SAMPLE_REPO, label: "loomrail-ui" }}
								hue={REPOSITORY_HUES[1]}
								active={false}
								status="uploading"
							/>
							<SidebarRepositoryRow
								repo={{ ...SAMPLE_REPO, label: "loomrail-workers" }}
								hue={REPOSITORY_HUES[2]}
								active={false}
								status="live"
							/>
							<SidebarAllReposRow active={false} />
							<SidebarAllReposRow active />
						</SidebarMenu>
					</Chrome>
				</State>
			</Specimen>

			<Specimen
				name="Sidebar footer"
				source="features/shell/components/AppSidebar.tsx (SidebarNavItem) · SidebarUserMenu.tsx"
				where="The sidebar's foot: Settings (open on any settings page) and the account row."
			>
				{(["Settings at rest", "Settings open"] as const).map((label) => (
					<State key={label} label={label}>
						<Chrome>
							<SidebarMenu>
								<SidebarNavItem
									route={shellRouteMap.settings}
									active={label === "Settings open"}
								/>
								<SidebarUserMenu />
							</SidebarMenu>
						</Chrome>
					</State>
				))}
			</Specimen>

			<Specimen
				name="LastSessionUploadBar"
				source="features/shell/components/last-session-upload-bar.tsx"
				where="Under the window on every screen: when the last session arrived, a link to it, and the support button."
			>
				<div className="dashboard-01-theme product-app-shell w-full corner-s shadow-inset">
					<div
						className="dashboard-01-chrome-frame px-m"
						style={shellChromeStyle}
					>
						<LastSessionUploadBar />
					</div>
				</div>
			</Specimen>
		</Group>
	);
}
