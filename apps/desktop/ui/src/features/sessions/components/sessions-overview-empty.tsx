import { IconCalendarOff, IconFilterOff } from "@tabler/icons-react";
import { EmptyState } from "@/components/dashboard/page-parts";
import { useDotPick } from "@/features/costs/cost-hover-date";
import { dayLabel } from "./sessions-focused-day-tag";

const LINK_BUTTON_CLASS_NAME =
	"mx-auto corner-s px-m py-xs text-body-xl font-medium text-accent outline-none hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent";

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
					<button
						type="button"
						className={LINK_BUTTON_CLASS_NAME}
						onClick={onClearFilters}
					>
						Clear filters
					</button>
				</EmptyState>
			) : picked && dotPick ? (
				<EmptyState
					icon={IconCalendarOff}
					title={`No sessions on ${dayLabel(picked)}`}
					description="Pick another day, or show every day in the range."
				>
					<button
						type="button"
						className={LINK_BUTTON_CLASS_NAME}
						onClick={() => dotPick.pick(null)}
					>
						Show every day
					</button>
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
