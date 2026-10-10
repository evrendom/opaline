import { Skeleton } from "@/app/ui/skeleton";
import { ContextChipSkeleton } from "@/features/shell/components/context-chip";

// The chart strip is parked while it is unfinished, so its placeholder is too.
// import { SessionChartLoading } from "./session-detail-loading";
// import { READER_STRIP_CLASS_NAME } from "./session-reader-overview-strip";

// The reader while its session loads, painted as the loaded page is laid out
// — the chart strip (the timeline's loading wave), the rail's stats, chips
// and turns, each turn's message, run and answer, and the right pane's card —
// in the same boxes, so nothing moves when the session lands.

const STAT_LABELS = ["Started", "Tokens", "Cost"];
const RAIL_ROWS = Array.from({ length: 8 }, (_, index) => index);

/** A turn: the member's line and bubble, the run's facts and root row, and
 * the answer beside the model's avatar — the loaded turn's measure and gaps. */
function TurnSkeleton() {
	return (
		<div className="flex w-full max-w-[calc(75ch-5rem)] flex-col gap-8 text-sm">
			<div className="flex flex-col gap-2">
				<div className="flex h-5 items-center gap-2 pl-9">
					<Skeleton className="h-3 w-20 rounded-sm" />
					<Skeleton className="h-3 w-24 rounded-sm" />
				</div>
				<div className="flex gap-3">
					<Skeleton className="mt-1.5 size-6 shrink-0 rounded-full" />
					<div className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg bg-card px-3 py-3.5 shadow-(--custom-shadow) corner-squircle squircle:rounded-2xl dark:bg-muted-foreground/10">
						<Skeleton className="h-3 w-11/12 rounded-sm" />
						<Skeleton className="h-3 w-2/3 rounded-sm" />
					</div>
				</div>
			</div>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-1.5 pl-9">
					<div className="flex h-5 items-center gap-1.5">
						<Skeleton className="h-3 w-24 rounded-sm" />
						<Skeleton className="h-5 w-16 rounded-full" />
						<Skeleton className="ml-auto h-3 w-12 rounded-sm" />
					</div>
					<div className="flex min-h-10 items-center gap-2 pl-1">
						<Skeleton className="size-4.5 shrink-0 rounded-full" />
						<Skeleton className="h-3 w-28 rounded-sm" />
						<Skeleton className="ml-4 h-2 flex-1 rounded-xs" />
						<Skeleton className="h-3 w-10 rounded-sm" />
					</div>
				</div>
				<div className="flex gap-3">
					<Skeleton className="size-6 shrink-0 rounded-full" />
					<div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-1.5">
						<Skeleton className="h-3 w-full rounded-sm" />
						<Skeleton className="h-3 w-5/6 rounded-sm" />
						<Skeleton className="h-3 w-3/5 rounded-sm" />
					</div>
				</div>
			</div>
		</div>
	);
}

/** The right pane's card, stuck as the loaded one is: a header, the fields
 * grid and a section below. */
function PaneSkeleton() {
	return (
		<div className="sticky top-4 flex h-[calc(100cqh-2rem)] flex-col overflow-hidden rounded-lg bg-card shadow-(--custom-shadow) corner-squircle squircle:rounded-3xl dark:bg-muted-foreground/10">
			<div className="flex items-center gap-2 px-5 pt-5 pb-1">
				<Skeleton className="size-4.5 shrink-0 rounded-full" />
				<Skeleton className="h-3.5 w-28 rounded-sm" />
				<Skeleton className="ml-auto h-6 w-10 rounded-md" />
			</div>
			<div className="flex flex-col gap-4 py-5">
				<div className="flex flex-col gap-2 border-b border-border/40 px-5 pb-5">
					<Skeleton className="h-3 w-20 rounded-sm" />
					<div className="flex flex-wrap gap-1.5">
						<Skeleton className="h-6 w-24 rounded-full" />
						<Skeleton className="h-6 w-32 rounded-full" />
						<Skeleton className="h-6 w-20 rounded-full" />
					</div>
				</div>
				<div className="grid grid-cols-2 gap-4 px-5">
					{["a", "b", "c", "d"].map((key) => (
						<div key={key} className="flex flex-col gap-1.5">
							<Skeleton className="h-2.5 w-12 rounded-sm" />
							<Skeleton className="h-3 w-20 rounded-sm" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

export function SessionReaderSkeleton() {
	return (
		<div aria-busy="true" className="flex h-full min-h-0 flex-col">
			<output className="sr-only">Loading session</output>
			{/* <div aria-hidden="true" className={READER_STRIP_CLASS_NAME}>
				<SessionChartLoading />
			</div> */}
			<div
				aria-hidden="true"
				className="min-h-0 flex-1 overflow-hidden [container-type:size]"
			>
				<div className="grid gap-8 px-8 pt-2 lg:grid-cols-[240px_minmax(0,1fr)]">
					<div className="hidden lg:block">
						<div className="sticky top-4 flex max-h-[calc(100cqh-2rem)] flex-col gap-0.5">
							<div className="mb-3 flex flex-col gap-3 border-b border-border/40 px-2 pb-4">
								{STAT_LABELS.map((label) => (
									<div key={label} className="flex min-w-0 flex-col gap-1">
										<span className="text-xs text-muted-foreground">
											{label}
										</span>
										<span className="flex h-5 items-center">
											<Skeleton className="h-3 w-24 rounded-sm" />
										</span>
									</div>
								))}
								<div className="flex flex-wrap gap-2">
									<ContextChipSkeleton className="w-28" />
									<ContextChipSkeleton className="w-36" />
									<ContextChipSkeleton className="w-24" />
								</div>
							</div>
							{RAIL_ROWS.map((row) => (
								<div key={row} className="flex items-center gap-2 px-2 py-1.5">
									<Skeleton className="h-3 w-16 rounded-sm" />
									<Skeleton className="ml-auto h-3 w-8 rounded-sm" />
									<Skeleton className="h-3 w-10 rounded-sm" />
								</div>
							))}
						</div>
					</div>
					<div className="flex min-w-0 items-start gap-8">
						<div className="flex min-w-0 flex-1 flex-col gap-8">
							<TurnSkeleton />
							<TurnSkeleton />
						</div>
						<div className="hidden w-[380px] shrink-0 self-stretch xl:block">
							<PaneSkeleton />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
