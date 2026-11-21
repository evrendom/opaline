import { IconChevronRight } from "@tabler/icons-react";
import { createPortal } from "react-dom";
import { SkillMark } from "@/components/skill-mark";
import { ShellNavIcon } from "@/features/shell/components/shell-nav-icon";
import { useCollapseSidebarBelow } from "@/features/shell/hooks/use-collapse-sidebar-below";
import { useCurrentShellRoute } from "@/features/shell/hooks/useCurrentShellRoute";
import { useShellHeaderPortal } from "@/features/shell/shell-header-portal";
import { type UseSection, WorkspaceUseView } from "./workspace-use-view";

const SIDEBAR_COLLAPSE_BELOW_PX = 1320;

export function WorkspaceSetupPage({
	name,
	onBackToList,
	section,
}: {
	name: string;
	onBackToList: () => void;
	section: UseSection;
}) {
	useCollapseSidebarBelow(SIDEBAR_COLLAPSE_BELOW_PX);
	return (
		<div className="dashboardy-page flex h-full min-h-0 min-w-0 flex-1 flex-col bg-inset text-ink [--reader-page:var(--canvas)]">
			<WorkspaceSetupHeader name={name} onBackToList={onBackToList} />
			<h1 className="sr-only">{name}</h1>
			<div className="relative isolate min-h-0 min-w-0 flex-1 overflow-hidden [--dashboard-01-content-background:var(--dashboard-01-stage-background)] [--stage-top:--spacing(2)]">
				<div
					aria-hidden="true"
					className="pointer-events-none absolute top-(--stage-top) right-0 bottom-0 left-0 -z-10 bg-(--dashboard-01-stage-background)"
				/>
				<div className="absolute inset-x-0 top-(--stage-top) bottom-0 flex min-h-0 min-w-0 flex-col overflow-hidden">
					<WorkspaceUseView name={name} section={section} />
				</div>
			</div>
		</div>
	);
}

function WorkspaceSetupHeader({
	name,
	onBackToList,
}: {
	name: string;
	onBackToList: () => void;
}) {
	const headerPortal = useShellHeaderPortal();
	const shellRoute = useCurrentShellRoute();
	if (!headerPortal) return null;
	return createPortal(
		<nav
			aria-label={`${shellRoute.title} breadcrumb`}
			className="flex min-w-0 flex-1 items-center gap-s text-body-xxl font-medium"
		>
			<button
				type="button"
				onClick={onBackToList}
				data-fluid-menu-root=""
				className="flex shrink-0 items-center gap-m text-ink-3 transition-colors hover:text-ink focus-outline"
			>
				<ShellNavIcon
					icon={shellRoute.icon}
					activeIcon={shellRoute.activeIcon}
					active={false}
					tone={shellRoute.tone}
				/>
				{shellRoute.title}
			</button>
			<IconChevronRight
				aria-hidden="true"
				// design-escape-ok(opacity): no role renders this; ink-3/50
				className="size-4 shrink-0 text-ink-3/50"
				stroke={1.5}
			/>
			<span aria-current="page" className="flex min-w-0 items-center gap-s">
				<SkillMark skill={name} className="size-4.5 text-body-xs" />
				<span className="truncate">{name}</span>
			</span>
		</nav>,
		headerPortal,
	);
}
