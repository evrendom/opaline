import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/ui/select";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import {
	getActiveSettingsRouteId,
	primarySettingsRoutes,
	settingsRouteMap,
} from "@/features/settings/config/settings-routes";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { cn } from "@/lib/utils";
import "./components/settings-section.css";

export function SettingsLayout() {
	const getShellRoutePath = useShellRoutePath();
	const location = useLocation();
	const navigate = useNavigate();
	const activeRouteId = getActiveSettingsRouteId(location.pathname);

	return (
		<div
			className="@container/settings flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
			data-slot="settings-layout"
		>
			<div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden px-6 py-4 sm:px-8 md:py-6 lg:px-10 @min-[640px]/settings:grid-cols-[168px_minmax(0,1fr)] @min-[640px]/settings:grid-rows-[minmax(0,1fr)] @min-[640px]/settings:gap-8">
				<aside
					className="hidden min-h-0 min-w-0 overflow-y-auto overscroll-none pt-6 @min-[640px]/settings:block"
					data-slot="settings-sidebar"
				>
					<nav aria-label="Settings sections" data-fluid-menu-root="">
						<FluidMenuHover items="a[href]" />
						<ul className="flex flex-col gap-1">
							{primarySettingsRoutes.map((route) => (
								<li key={route.id}>
									<Link
										to={getShellRoutePath(route.path)}
										aria-current={
											route.id === activeRouteId ? "page" : undefined
										}
										className={cn(
											"flex min-h-9 items-center rounded-md px-3 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--dashboard-01-metric-button-focus-ring)] pointer-coarse:min-h-12",
											route.id === activeRouteId &&
												"bg-[var(--session-overview-hover,var(--accent))] font-medium text-foreground",
										)}
									>
										{route.label}
									</Link>
								</li>
							))}
						</ul>
					</nav>
				</aside>
				<div
					className="min-w-0 @min-[640px]/settings:hidden"
					data-slot="settings-mobile-navigation"
				>
					<Select
						value={activeRouteId}
						onValueChange={(value) => {
							const route = primarySettingsRoutes.find(
								(item) => item.id === value,
							);
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
							{primarySettingsRoutes.map((route) => (
								<SelectItem key={route.id} value={route.id}>
									{route.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div
					className="min-h-0 min-w-0 overflow-y-auto overscroll-none"
					data-slot="settings-content"
				>
					<div className="settings-page-content">
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
