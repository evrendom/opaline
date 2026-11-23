import { IconCalendarOff, IconFilterOff } from "@tabler/icons-react";
import { Button } from "@/app/ui/button";
import { EmptyState } from "@/components/dashboard/page-parts";
import { useDotPick } from "@/features/costs/cost-hover-date";
import { dayLabel } from "./sessions-focused-day-tag";

export function SessionsOverviewEmpty({
	noneInRange,
	searching,
	onClearFilters,
}: {
	noneInRange: boolean;
	searching: boolean;
	onClearFilters: () => void;
}) {
	const dotPick = useDotPick();
	const picked = dotPick?.picked ?? null;
	return (
		<div className="flex min-h-64 flex-1 flex-col p-xxl">
			{!noneInRange ? (
				<EmptyState
					icon={IconFilterOff}
					title={
						searching
							? "Looking for matching sessions…"
							: "No sessions match the selected filters"
					}
				>
					<Button type="button" className="mx-auto" onClick={onClearFilters}>
						Clear filters
					</Button>
				</EmptyState>
			) : picked && dotPick ? (
				<EmptyState
					icon={IconCalendarOff}
					title={`No sessions on ${dayLabel(picked)}`}
					description="Pick another day, or show every day in the range."
				>
					<Button
						type="button"
						className="mx-auto"
						onClick={() => dotPick.pick(null)}
					>
						Show every day
					</Button>
				</EmptyState>
			) : (
				<EmptyState
					icon={IconCalendarOff}
					title="No sessions in this range"
					description="Pick a wider date range to see more sessions."
				/>
			)}
		</div>
	);
}
