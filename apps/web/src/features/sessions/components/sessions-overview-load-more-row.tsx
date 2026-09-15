import type { Ref } from "react";
import { cn } from "@/lib/utils";
import {
	SESSION_OVERVIEW_CELL_CLASS_NAME,
	SESSION_OVERVIEW_MODEL_LABEL_CLASS_NAME,
	SESSION_OVERVIEW_ROW_CLASS_NAME,
} from "./session-overview-row-elements";
import { SESSION_OVERVIEW_GRID_CLASS_NAME } from "./sessions-overview-table-utils";

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
				<output className={labelClassName}>Loading more sessions</output>
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
