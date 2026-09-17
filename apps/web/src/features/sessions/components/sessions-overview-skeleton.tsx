import { Skeleton } from "@/app/ui/skeleton";
import {
	SESSION_OVERVIEW_GRID_CLASS_NAME,
	SESSION_OVERVIEW_GRID_WITHOUT_SKILLS_CLASS_NAME,
	SESSION_OVERVIEW_VISIBLE_COLUMNS,
} from "@/features/sessions/components/sessions-overview-table-utils";
import { cn } from "@/lib/utils";

const SESSION_OVERVIEW_SKELETON_ROWS = [
	"overview-session-skeleton-1",
	"overview-session-skeleton-2",
	"overview-session-skeleton-3",
	"overview-session-skeleton-4",
	"overview-session-skeleton-5",
	"overview-session-skeleton-6",
	"overview-session-skeleton-7",
	"overview-session-skeleton-8",
	"overview-session-skeleton-9",
	"overview-session-skeleton-10",
] as const;

export function SessionsOverviewSkeleton({
	showSkillsColumn = true,
}: {
	showSkillsColumn?: boolean;
}) {
	return (
		<div aria-busy="true" className="flex-1">
			<output className="sr-only">Loading sessions</output>
			{SESSION_OVERVIEW_SKELETON_ROWS.map((rowId) => (
				<div
					key={rowId}
					className={cn(
						"grid h-9",
						showSkillsColumn
							? SESSION_OVERVIEW_GRID_CLASS_NAME
							: SESSION_OVERVIEW_GRID_WITHOUT_SKILLS_CLASS_NAME,
					)}
				>
					{SESSION_OVERVIEW_VISIBLE_COLUMNS.filter(
						(column) => showSkillsColumn || column.key !== "skills",
					).map((column) => (
						<div
							key={column.key}
							className={cn(
								"flex min-w-0 items-center bg-(--session-overview-surface) px-3",
								column.key === "user" || column.key === "time"
									? "justify-end"
									: "justify-start",
								column.key === "time" && "px-2",
							)}
						>
							{column.key === "model" || column.key === "user" ? (
								<div
									className={cn(
										"flex items-center gap-1.5",
										column.key === "user" && "flex-row-reverse",
									)}
								>
									<Skeleton className="size-4 rounded-full" />
									<Skeleton className="h-3 w-20 rounded-sm" />
								</div>
							) : (
								<Skeleton className="h-3 w-12 max-w-full rounded-sm" />
							)}
						</div>
					))}
				</div>
			))}
		</div>
	);
}
