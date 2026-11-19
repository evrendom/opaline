import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import type { ReactNode } from "react";
import {
	SESSION_OVERVIEW_GRID_CLASS_NAME,
	SESSION_OVERVIEW_GRID_WITHOUT_SKILLS_CLASS_NAME,
	SESSION_OVERVIEW_VISIBLE_COLUMNS,
	type SessionOverviewColumnKey,
	type SessionSortState,
} from "@/features/sessions/components/sessions-overview-table-utils";
import { cn } from "@/lib/utils";

const INERT_SESSION_OVERVIEW_HEADER_KEYS = new Set<SessionOverviewColumnKey>([
	"time",
	"repository",
	"user",
	"model",
	"signals",
	"skills",
	"tokens",
	"cost",
]);

export function SessionsOverviewHeader({
	showSkillsColumn = true,
	controls,
	onSort,
	sort,
}: {
	showSkillsColumn?: boolean;
	controls: ReactNode;
	onSort: (sortKey: SessionOverviewColumnKey) => void;
	sort: SessionSortState;
}) {
	return (
		<div
			className={cn(
				"sticky top-0 left-0 z-30 grid h-12 min-w-0 shrink-0 overflow-hidden bg-(--session-overview-surface) in-data-rail-beside:h-15",
				showSkillsColumn
					? SESSION_OVERVIEW_GRID_CLASS_NAME
					: SESSION_OVERVIEW_GRID_WITHOUT_SKILLS_CLASS_NAME,
			)}
			data-slot="sessions-overview-header"
		>
			{/* Toolbar: across the visible width (100cqw is the scroll
			    viewport here, so it holds while the table scrolls sideways), with
			    8px of air around its buttons. Its 24px gutters put the first
			    button's icon on the page title icon's centre line,
			    rather than lining up the button's edge. */}
			<div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-[100cqw] items-center px-6 in-data-rail-beside:top-3">
				{controls}
			</div>
			{SESSION_OVERVIEW_VISIBLE_COLUMNS.filter(
				(column) => showSkillsColumn || column.key !== "skills",
			).map((column) => {
				const isInert = INERT_SESSION_OVERVIEW_HEADER_KEYS.has(column.key);

				return (
					<div
						key={column.key}
						aria-hidden={isInert ? true : undefined}
						className={cn(
							"flex min-w-0 bg-(--session-overview-surface)",
							isInert && "pointer-events-none select-none",
						)}
						data-slot={
							isInert ? "sessions-overview-inert-header-cell" : undefined
						}
					>
						{isInert ? null : (
							<SessionOverviewSortableHeader
								align={column.align}
								label={column.label}
								onSort={onSort}
								sort={sort}
								sortKey={column.key}
							/>
						)}
					</div>
				);
			})}
		</div>
	);
}

function SessionOverviewSortableHeader({
	align,
	label,
	onSort,
	sort,
	sortKey,
}: {
	align: "left" | "right";
	label: string;
	onSort: (sortKey: SessionOverviewColumnKey) => void;
	sort: SessionSortState;
	sortKey: SessionOverviewColumnKey;
}) {
	const isActive = sort.key === sortKey;

	return (
		<button
			type="button"
			aria-label={`Sort by ${label}, ${
				isActive && sort.direction === "asc" ? "descending" : "ascending"
			}`}
			className={cn(
				"relative flex h-full min-w-0 flex-1 items-center gap-1 px-3 text-left text-base font-medium tracking-[-0.01em] whitespace-nowrap text-black outline-none hover:bg-(--session-overview-hover) focus-visible:z-10 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-(--session-overview-accent) sm:text-sm dark:text-(--session-overview-text)",
				align === "right" ? "justify-end text-right" : "justify-start",
			)}
			onClick={() => onSort(sortKey)}
		>
			<span className="min-w-0 truncate">{label}</span>
			{isActive ? (
				sort.direction === "asc" ? (
					<IconChevronUp aria-hidden="true" className="size-3.5 shrink-0" />
				) : (
					<IconChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
				)
			) : null}
			<span
				aria-hidden="true"
				className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
			/>
		</button>
	);
}
