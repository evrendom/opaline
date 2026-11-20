import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { Button } from "@/app/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@/app/ui/select";
import { formatNumber } from "@/lib/format";

export const SESSION_PAGE_SIZES = [30, 50, 100] as const;
export const DEFAULT_SESSIONS_PER_PAGE = SESSION_PAGE_SIZES[0];

export function SessionsOverviewPager({
	isFetching,
	known,
	more,
	onPage,
	onPageSize,
	page,
	pageSize,
	shown,
}: {
	isFetching: boolean;
	known: number;
	more: boolean;
	onPage: (page: number) => void;
	onPageSize: (size: number) => void;
	page: number;
	pageSize: number;
	shown: number;
}) {
	const first = page * pageSize;
	const hasNext = first + pageSize < known || more;
	const canPrevious = page > 0 && !isFetching;
	const canNext = hasNext && !(isFetching && first + pageSize >= known);
	return (
		<div className="flex items-center justify-end gap-xs px-xxl py-xl">
			<span className="text-body-m text-ink-3/50 tabular-nums">
				{formatNumber(known)}
				{more ? "+" : ""} {known === 1 && !more ? "session" : "sessions"}
			</span>
			<span className="mx-l text-body-m text-ink-3/20">/</span>
			<Select<string, false>
				value={String(pageSize)}
				onValueChange={(value) => value && onPageSize(Number(value))}
			>
				<SelectTrigger
					title="Sessions per page"
					className="h-auto data-[size=default]:h-auto gap-s corner-s squircle:corner-s edge-none bg-transparent p-zero text-body-m text-ink-3/50 tabular-nums shadow-none transition-[color,box-shadow] hover:text-ink dark:edge-none dark:bg-transparent dark:shadow-none dark:hover:bg-transparent"
				>
					{shown === 0 ? "0" : `${first + 1} to ${first + shown}`}
				</SelectTrigger>
				<SelectContent
					className="w-auto min-w-28"
					align="end"
					alignItemWithTrigger={false}
					sideOffset={6}
				>
					{SESSION_PAGE_SIZES.map((size) => (
						<SelectItem key={size} value={String(size)}>
							{size} per page
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<div className="ml-s flex items-center gap-xs">
				<Button
					aria-label="Previous page"
					disabled={!canPrevious}
					onClick={() => onPage(page - 1)}
					size="icon-sm"
					variant={canPrevious ? "outline" : "ghost"}
				>
					<IconChevronLeft />
				</Button>
				<Button
					aria-label="Next page"
					disabled={!canNext}
					onClick={() => onPage(page + 1)}
					size="icon-sm"
					variant={canNext ? "outline" : "ghost"}
				>
					<IconChevronRight />
				</Button>
			</div>
		</div>
	);
}
