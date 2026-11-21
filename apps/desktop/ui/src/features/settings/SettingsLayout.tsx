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
import { IconPlugFilled } from "@/app/ui/icon-plug-filled";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/ui/select";
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

/** One section in the settings sidebar: its outline icon at rest, the
 *  filled one and the sliding card under it when it is the open section. */
export function SettingsSectionTab({
	routeId,
	to,
	active,
}: {
	routeId: SettingsRouteId;
	to: string;
	active: boolean;
}) {
	const [OutlineIcon, FilledIcon] = settingsTabIcons[routeId];
	const TabIcon = active ? FilledIcon : OutlineIcon;
	return (
		<li>
			<Link
				to={to}
				aria-current={active ? "page" : undefined}
				className={cn(
					"relative flex h-8 items-center",
					"corner-s px-[calc(var(--space-m)+var(--space-xxs))] corner-squircle",
					"text-body-xl font-medium",
					"focus-outline",
					"squircle:corner-l pointer-coarse:h-12",
					active
						? "text-ink"
						: "text-ink-3 hover:text-ink hover:transition-colors",
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
						className="absolute inset-0 z-0 corner-s bg-card-soft shadow-card corner-squircle squircle:corner-l"
					/>
				) : null}
				<span className="relative z-10 flex items-center gap-s">
					<TabIcon aria-hidden="true" className="size-3.5" />
					{settingsRouteMap[routeId].label}
				</span>
			</Link>
		</li>
	);
}

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
			<div
				className={cn(
					"grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-xl overflow-hidden",
					"px-xxl",
					"@min-[640px]/settings:grid-cols-[168px_minmax(0,1fr)] @min-[640px]/settings:grid-rows-[minmax(0,1fr)] @min-[640px]/settings:gap-[calc(var(--space-xxl)*4/3)]",
				)}
			>
				<aside
					className={cn(
						"hidden min-h-0 min-w-0 overflow-y-auto overscroll-none",
						"px-xs pt-m pb-xl",
						"md:pb-xxl @min-[640px]/settings:block",
					)}
					data-slot="settings-sidebar"
				>
					<nav aria-label="Settings sections">
						<ul className="flex flex-col gap-xs">
							{routes.map((route) => (
								<SettingsSectionTab
									key={route.id}
									routeId={route.id}
									to={getShellRoutePath(route.path)}
									active={route.id === activeRouteId}
								/>
							))}
						</ul>
					</nav>
				</aside>
				<div
					className="min-w-0 pt-xl @min-[640px]/settings:hidden"
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
							className="w-full corner-s bg-transparent text-body-xxl data-[size=default]:h-12"
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
					className="scroll-fade -mx-m min-h-0 min-w-0 overflow-y-auto overscroll-none px-m"
					data-slot="settings-content"
				>
					<div className="settings-page-content pt-m">
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
