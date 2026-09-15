import { LoaderCircleIcon } from "lucide-react";
import type { Ref } from "react";
import { Skeleton } from "@/app/ui/skeleton";
import { cn } from "@/lib/utils";
import {
	SESSION_OVERVIEW_CELL_CLASS_NAME,
	SESSION_OVERVIEW_MODEL_LABEL_CLASS_NAME,
	SESSION_OVERVIEW_ROW_CLASS_NAME,
} from "./session-overview-row-elements";
import { SESSION_OVERVIEW_GRID_CLASS_NAME } from "./sessions-overview-table-utils";

function LoadingPlaceholder({ className }: { className: string }) {
	return (
		<Skeleton
			aria-hidden="true"
			className={cn("rounded-sm motion-reduce:animate-none", className)}
		/>
	);
}

export function SessionsOverviewLoadMoreRow({
	isFetching,
	isError,
	loadMore,
	rowRef,
}: {
	isFetching: boolean;
	isError: boolean;
	loadMore: () => void;
	rowRef: Ref<HTMLDivElement>;
}) {
	const labelClassName = cn(
		SESSION_OVERVIEW_CELL_CLASS_NAME,
		SESSION_OVERVIEW_MODEL_LABEL_CLASS_NAME,
		// Match the model label after its empty 28px mark, 8px gap and 8px inset.
		"col-start-2 col-span-4 gap-2 pl-11",
	);
	return (
		<div
			ref={rowRef}
			data-slot="sessions-overview-load-more-row"
			className={cn(
				SESSION_OVERVIEW_ROW_CLASS_NAME,
				SESSION_OVERVIEW_GRID_CLASS_NAME,
				"shrink-0",
			)}
		>
			{isFetching ? (
				<>
					<div className={SESSION_OVERVIEW_CELL_CLASS_NAME}>
						<LoadingPlaceholder className="h-3 w-7" />
					</div>
					<div className={cn(SESSION_OVERVIEW_CELL_CLASS_NAME, "gap-2 px-2")}>
						<span
							aria-hidden="true"
							className="flex size-7 shrink-0 items-center justify-center text-(--session-overview-muted)"
						>
							<LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
						</span>
						<div className="flex min-w-0 items-center gap-1.5">
							<output
								className={cn(
									SESSION_OVERVIEW_MODEL_LABEL_CLASS_NAME,
									"shrink-0 whitespace-nowrap",
								)}
							>
								Loading more sessions
							</output>
							<LoadingPlaceholder className="h-3 w-14" />
							<LoadingPlaceholder className="h-3 w-18" />
						</div>
						<LoadingPlaceholder className="h-5 w-10" />
						<LoadingPlaceholder className="h-5 w-6" />
					</div>
					<div className={cn(SESSION_OVERVIEW_CELL_CLASS_NAME, "gap-1")}>
						<LoadingPlaceholder className="h-5 w-20" />
						<LoadingPlaceholder className="h-5 w-16" />
						<LoadingPlaceholder className="h-5 w-12" />
					</div>
					<div
						className={cn(
							SESSION_OVERVIEW_CELL_CLASS_NAME,
							"justify-end gap-2",
						)}
					>
						<LoadingPlaceholder className="h-5 w-12" />
						<LoadingPlaceholder className="h-5 w-10" />
						<LoadingPlaceholder className="size-4.5 shrink-0 rounded-full" />
					</div>
					<div
						className={cn(SESSION_OVERVIEW_CELL_CLASS_NAME, "justify-end px-2")}
					>
						<LoadingPlaceholder className="h-3 w-9" />
					</div>
				</>
			) : (
				<button
					type="button"
					onClick={loadMore}
					className={cn(
						labelClassName,
						"text-left outline-none hover:bg-(--session-overview-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--session-overview-accent)",
					)}
				>
					{isError ? (
						<>
							<span role="alert">Could not load more sessions.</span>
							<span className="underline underline-offset-2">Retry</span>
						</>
					) : (
						"Load more sessions"
					)}
				</button>
			)}
		</div>
	);
}
