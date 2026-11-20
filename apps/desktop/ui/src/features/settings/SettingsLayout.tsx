import {
	type Icon,
	IconBrandGithub,
	IconBrandGithubFilled,
	IconChartArea,
	IconChartAreaFilled,
	IconFileAnalytics,
	IconFileAnalyticsFilled,
	IconId,
	IconIdFilled,
	IconMessage2,
	IconMessage2Filled,
	IconPlug,
	IconSettings,
	IconSettingsFilled,
	IconSquareRoundedPlus,
	IconSquareRoundedPlusFilled,
	IconUser,
	IconUserFilled,
} from "@tabler/icons-react";
import { motion } from "motion/react";
import {
	Link,
	Navigate,
	Outlet,
	useLocation,
	useNavigate,
} from "react-router-dom";
import { appRoutes } from "@/app/routes";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/ui/select";
import { IconPlugFilled } from "@/components/ui/icon-plug-filled";
import {
	LOCAL_APP_HIDDEN_SETTINGS,
	useLocalDesktopApp,
} from "@/features/desktop/local-app";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import { showsGitHubSettings } from "@/features/self-hosted/surfaces";
import {
	getActiveSettingsRouteId,
	primarySettingsRoutes,
	type SettingsRouteId,
	settingsRouteMap,
} from "@/features/settings/config/settings-routes";
import { useGitHubConnection } from "@/features/settings/github/use-github-connection";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { useScrollFade } from "@/hooks/use-scroll-fade";
import { cn } from "@/lib/utils";
import "./components/settings-section.css";

const settingsTabIcons: Record<SettingsRouteId, [Icon, Icon]> = {
	workspace: [IconSettings, IconSettingsFilled],
	github: [IconBrandGithub, IconBrandGithubFilled],
	sessions: [IconMessage2, IconMessage2Filled],
	reports: [IconFileAnalytics, IconFileAnalyticsFilled],
	members: [IconUser, IconUserFilled],
	team: [IconChartArea, IconChartAreaFilled],
	account: [IconId, IconIdFilled],
	mcp: [IconPlug, IconPlugFilled],
	"create-workspace": [IconSquareRoundedPlus, IconSquareRoundedPlusFilled],
};

export function SettingsLayout() {
	const { state } = useOrganization();
	const { query } = useGitHubConnection(state.activeOrg?.id ?? null);
	const selfHost = useSelfHost();
	const localApp = useLocalDesktopApp();
	const routes = primarySettingsRoutes.filter((route) =>
		localApp && LOCAL_APP_HIDDEN_SETTINGS.has(route.id)
			? false
			: route.id === "github"
				? showsGitHubSettings(query.data)
				: route.id !== "mcp" || selfHost !== null,
	);
	const getShellRoutePath = useShellRoutePath();
	const location = useLocation();
	const navigate = useNavigate();
	const activeRouteId = getActiveSettingsRouteId(location.pathname);
	const { fade, ref: fadeRef } = useScrollFade<HTMLDivElement>();

	if (localApp && LOCAL_APP_HIDDEN_SETTINGS.has(activeRouteId))
		return (
			<Navigate replace to={getShellRoutePath(appRoutes.settingsWorkspace())} />
		);

	return (
		<div
			className="@container/settings flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
			data-slot="settings-layout"
		>
			<div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden px-6 @min-[640px]/settings:grid-cols-[168px_minmax(0,1fr)] @min-[640px]/settings:grid-rows-[minmax(0,1fr)] @min-[640px]/settings:gap-8">
				<aside
					className="hidden min-h-0 min-w-0 overflow-y-auto overscroll-none px-1 pt-2 pb-4 md:pb-6 @min-[640px]/settings:block"
					data-slot="settings-sidebar"
				>
					<nav aria-label="Settings sections">
						<ul className="flex flex-col gap-1">
							{routes.map((route) => {
								const active = route.id === activeRouteId;
								const [OutlineIcon, FilledIcon] = settingsTabIcons[route.id];
								const TabIcon = active ? FilledIcon : OutlineIcon;
								return (
									<li key={route.id}>
										<Link
											to={getShellRoutePath(route.path)}
											aria-current={active ? "page" : undefined}
											className={cn(
												"relative flex h-8 items-center rounded-md px-2.5 text-sm font-medium outline-none corner-squircle squircle:rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--dashboard-01-metric-button-focus-ring)] pointer-coarse:h-12",
												active
													? "text-foreground"
													: "text-muted-foreground hover:text-foreground hover:transition-colors",
											)}
										>
											{active ? (
												<motion.span
													layoutId="settings-tab-bg"
													initial={false}
													transition={{
														duration: 0.2,
														ease: [0.32, 0.72, 0, 1],
													}}
													className="absolute inset-0 z-0 rounded-md bg-card shadow-(--custom-shadow) corner-squircle squircle:rounded-xl dark:bg-muted-foreground/10"
												/>
											) : null}
											<span className="relative z-10 flex items-center gap-1.5">
												<TabIcon aria-hidden="true" className="size-3.5" />
												{route.label}
											</span>
										</Link>
									</li>
								);
							})}
						</ul>
					</nav>
				</aside>
				<div
					className="min-w-0 pt-4 @min-[640px]/settings:hidden"
					data-slot="settings-mobile-navigation"
				>
					<Select
						value={activeRouteId}
						onValueChange={(value) => {
							const route = routes.find((item) => item.id === value);
							if (route) navigate(getShellRoutePath(route.path));
						}}
					>
						<SelectTrigger
							aria-label="Settings section"
							className="w-full rounded-md bg-transparent text-base data-[size=default]:h-12"
						>
							<SelectValue>{settingsRouteMap[activeRouteId].label}</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{routes.map((route) => (
								<SelectItem key={route.id} value={route.id}>
									{route.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				{/* A scroller clips sideways too, so it reaches 8px past the column
				    on each side and pads back in: cards stay aligned and keep room
				    for their shadows and focus rings. */}
				<div
					ref={fadeRef}
					{...fade}
					className="scroll-fade -mx-2 min-h-0 min-w-0 overflow-y-auto overscroll-none px-2"
					data-slot="settings-content"
				>
					<div className="settings-page-content pt-2">
						<h1 className="settings-page-title">
							{settingsRouteMap[activeRouteId].label}
						</h1>
						<Outlet />
					</div>
				</div>
			</div>
		</div>
	);
}
