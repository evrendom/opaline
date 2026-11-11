import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

export const SESSIONS_PER_PAGE = 30;

export function SessionsOverviewPager({
	isFetching,
	known,
	more,
	onPage,
	page,
	shown,
}: {
	isFetching: boolean;
	known: number;
	more: boolean;
	onPage: (page: number) => void;
	page: number;
	shown: number;
}) {
	const first = page * SESSIONS_PER_PAGE;
	const hasNext = first + SESSIONS_PER_PAGE < known || more;
	return (
		<div className="flex items-center justify-end gap-1 border-t border-(--session-overview-border) px-6 py-3">
			<span className="text-xs text-(--session-overview-muted) tabular-nums">
				{formatNumber(known)}
				{more ? "+" : ""} {known === 1 && !more ? "session" : "sessions"}
			</span>
			<span className="mx-3 text-xs text-(--session-overview-muted) opacity-40">
				/
			</span>
			<span className="text-xs text-(--session-overview-muted) tabular-nums">
				{shown === 0 ? "0" : `${first + 1} to ${first + shown}`}
			</span>
			<div className="ml-1.5 flex items-center gap-1">
				<Button
					aria-label="Previous page"
					disabled={page === 0}
					onClick={() => onPage(page - 1)}
					size="icon-sm"
					variant={page === 0 ? "ghost" : "outline"}
				>
					<IconChevronLeft />
				</Button>
				<Button
					aria-label="Next page"
					disabled={
						!hasNext || (isFetching && first + SESSIONS_PER_PAGE >= known)
					}
					onClick={() => onPage(page + 1)}
					size="icon-sm"
					variant={hasNext ? "outline" : "ghost"}
				>
					<IconChevronRight />
				</Button>
			</div>
		</div>
	);
}
