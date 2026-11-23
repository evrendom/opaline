import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { Pressable } from "@/app/ui/pressable";
import { TouchTarget } from "@/app/ui/touch-target";
import { cn } from "@/lib/utils";
import type {
	SessionTurnTableSortKey,
	SessionTurnTableSortState,
} from "./session-turn-table-filters";

export function SessionTurnTableSortableHeader({
	className,
	columnIndex,
	label,
	onSort,
	sort,
	sortKey,
}: {
	className: string | undefined;
	columnIndex: number;
	label: string;
	onSort: (sortKey: SessionTurnTableSortKey) => void;
	sort: SessionTurnTableSortState;
	sortKey: SessionTurnTableSortKey;
}) {
	const isActive = sort.key === sortKey;

	return (
		<Pressable
			type="button"
			aria-label={`Sort by ${label}, ${
				isActive && sort.direction === "asc" ? "descending" : "ascending"
			}`}
			className={cn(
				"relative flex h-full w-full min-w-0 items-center gap-xs",
				"text-left text-body-m font-medium whitespace-nowrap",
				"text-ink-3",
				"focus-visible:z-10",
				columnIndex === 0 ? "pr-s pl-l" : "px-s",
				className,
			)}
			onClick={() => onSort(sortKey)}
		>
			<span className="flex min-w-0 items-center">
				<span
					className="flex max-w-full min-w-0 items-center gap-xs"
					data-sort-label-row
				>
					<span className="min-w-0 truncate">{label}</span>
					{isActive ? (
						sort.direction === "asc" ? (
							<IconChevronUp aria-hidden="true" className="size-3.5 shrink-0" />
						) : (
							<IconChevronDown
								aria-hidden="true"
								className="size-3.5 shrink-0"
							/>
						)
					) : null}
				</span>
			</span>
			<TouchTarget />
		</Pressable>
	);
}
