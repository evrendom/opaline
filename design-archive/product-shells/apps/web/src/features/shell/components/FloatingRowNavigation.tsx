import { RailLink } from "@/features/shell/components/shell-rail";
import { UserRailButton } from "@/features/shell/components/UserRailButton";
import { shellNavigationRoutes } from "@/features/shell/config/shell-routes";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useCurrentShellRoute } from "@/features/shell/hooks/useCurrentShellRoute";

export function FloatingRowNavigation() {
	const currentShellRoute = useCurrentShellRoute();
	const getShellRoutePath = useShellRoutePath();

	return (
		<footer className="dashboard-01-floating-row pointer-events-none absolute inset-x-0 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 flex items-center justify-center gap-2">
			<nav
				aria-label="Primary"
				className="dashboard-01-floating-row-surface pointer-events-auto flex h-11 items-center rounded-(--floating-row-radius) px-1"
			>
				<ul className="flex list-none items-center gap-1 [&>li]:!size-9">
					{shellNavigationRoutes.map((route) => (
						<RailLink
							key={route.id}
							to={getShellRoutePath(route.path)}
							label={route.navLabel}
							shortcut={route.shortcut}
							comingSoon={route.comingSoon}
							placement="floating-row"
							active={currentShellRoute.id === route.id}
						>
							{route.icon}
						</RailLink>
					))}
				</ul>
			</nav>
			<div className="dashboard-01-floating-row-surface pointer-events-auto flex size-11 items-center justify-center rounded-(--floating-row-radius)">
				<UserRailButton variant="bottom-rail" />
			</div>
		</footer>
	);
}
