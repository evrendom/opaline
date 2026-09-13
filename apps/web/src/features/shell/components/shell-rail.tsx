import type { ComponentPropsWithRef, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/app/ui/badge";
import { Kbd } from "@/app/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/ui/tooltip";
import { cn } from "@/lib/utils";
import {
	getRailLabelClassName,
	getUtilityRailItemClassName,
} from "./shell-rail-utils";

export function RailLink({
	to,
	label,
	shortcut,
	comingSoon = false,
	active,
	badgeLabel,
	children,
	placement = "sidebar",
}: {
	to: string;
	label: string;
	shortcut?: string;
	comingSoon?: boolean;
	active?: boolean;
	badgeLabel?: string;
	children: ReactNode;
	placement?: "bottom-rail" | "floating-row" | "olivetti-rail" | "sidebar";
}) {
	const isOlivettiRailPlacement = placement === "olivetti-rail";
	const isFloatingRowPlacement = placement === "floating-row";
	const isBottomRailPlacement =
		placement === "bottom-rail" ||
		isOlivettiRailPlacement ||
		isFloatingRowPlacement;
	const isCollapsedSidebarPlacement = placement === "sidebar";
	const link = (
		<ShellNavigationLink
			comingSoon={comingSoon}
			to={to}
			aria-label={label}
			aria-current={active ? "page" : undefined}
			data-active={active ? "true" : undefined}
			data-sidebar-interactive
			data-sidebar-nav-row
			data-sidebar-row-mode="collapsed"
			className={cn(
				getUtilityRailItemClassName(),
				isBottomRailPlacement &&
					"!size-9 !w-9 self-auto overflow-visible rounded-lg",
				isCollapsedSidebarPlacement &&
					"overflow-visible rounded-none !bg-transparent hover:!bg-transparent active:!bg-transparent data-[active=true]:!bg-transparent",
				isOlivettiRailPlacement &&
					"rounded-none !bg-transparent hover:!bg-transparent active:!bg-transparent data-[active=true]:!bg-transparent",
				isFloatingRowPlacement &&
					"rounded-full !bg-transparent hover:!bg-transparent active:!bg-transparent data-[active=true]:!bg-transparent",
			)}
		>
			<span
				aria-hidden="true"
				data-sidebar-nav-icon-lane
				className="relative flex h-[var(--sidebar-icon-lane-size)] w-[var(--sidebar-icon-lane-size)] shrink-0 items-center justify-center [&_svg]:h-[var(--sidebar-icon-size)] [&_svg]:w-[var(--sidebar-icon-size)] [&_svg]:shrink-0"
			>
				{children}
			</span>
			<span
				aria-hidden="true"
				data-sidebar-nav-label
				className={getRailLabelClassName()}
			>
				{label}
			</span>
			{badgeLabel ? (
				<Badge
					className={cn(
						"pointer-events-none absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 text-[10px]",
						active ? "bg-primary text-primary-foreground" : undefined,
					)}
				>
					{badgeLabel}
				</Badge>
			) : null}
			{isBottomRailPlacement ? (
				<span
					aria-hidden="true"
					className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
				/>
			) : null}
		</ShellNavigationLink>
	);

	return (
		<li
			className={
				isBottomRailPlacement
					? "flex size-12 items-center justify-center"
					: undefined
			}
		>
			<Tooltip>
				<TooltipTrigger asChild>{link}</TooltipTrigger>
				<TooltipContent
					side={isBottomRailPlacement ? "top" : "right"}
					sideOffset={isBottomRailPlacement ? 8 : 0}
					className="[&>[aria-hidden='true']]:hidden"
				>
					{comingSoon ? (
						<>
							<span>{label}</span>
							<span className="text-background/60">Coming soon</span>
						</>
					) : shortcut ? (
						<div className="flex items-center gap-2">
							<span>{label}</span>
							<Kbd className="size-5 min-w-0 rounded-full border-0 p-0 text-[10px]">
								{shortcut}
							</Kbd>
						</div>
					) : (
						label
					)}
				</TooltipContent>
			</Tooltip>
		</li>
	);
}

// No href or keyboard focus target for unreleased destinations.
// Keep a hover target so the tooltip can explain why navigation is unavailable.
export function ShellNavigationLink({
	comingSoon,
	to,
	...props
}: ComponentPropsWithRef<typeof Link> & { comingSoon: boolean }) {
	if (comingSoon) {
		return <a {...props} aria-disabled="true" tabIndex={-1} />;
	}
	return <Link {...props} to={to} />;
}
