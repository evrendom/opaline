import { type CSSProperties, useRef } from "react";
import { ChartLoadingWave } from "@/app/ui/chart-loading-wave";
import {
	useElementWidth,
	useStoredPaneSize,
} from "@/app/ui/horizontal-resize-handle";
import { clampPaneSize } from "@/app/ui/horizontal-resize-utils";
import { Skeleton } from "@/app/ui/skeleton";
import { cn } from "@/lib/utils";
import {
	DEFAULT_SESSION_TRANSCRIPT_PANE_WIDTH_PX,
	DEFAULT_SESSION_TURN_TABLE_PANE_WIDTH_PX,
	getSessionTurnTablePaneMaximum,
	MINIMUM_SESSION_TURN_TABLE_PANE_WIDTH_PX,
	SESSION_TURN_TABLE_PANE_STORAGE_KEY,
} from "./session-detail-pane-sizing";
import { SESSION_OVERVIEW_SURFACE_CLASS_NAME } from "./sessions-overview-table-utils";

const TABLE_COLUMNS = ["Time", "Length", "Input", "Output", "Cost"];
const LOADING_ROWS = Array.from({ length: 16 }, (_, index) => index);

function Placeholder({ className }: { className?: string }) {
	return (
		<Skeleton
			className={cn(
				"h-3 animate-none corner-xs bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] dark:bg-hover-strong",
				className,
			)}
		/>
	);
}

export function SessionChartLoading() {
	return (
		<div
			aria-hidden="true"
			className="h-[4.07rem] shrink-0 overflow-hidden edge-b-m border-line bg-inset dark:bg-canvas"
			data-session-chart-loading
		>
			{/* The wave draws its baseline at 50 and its guides a quarter, half
			    and three quarters of the way up to 5 — the strip's own
			    gridlines. Sized so that baseline lands where the strip's does,
			    74/80 of the way down, the guides line up with the real ones. */}
			<ChartLoadingWave
				className="h-[2.57rem] w-full"
				viewBoxHeight={(50 * 80) / 74}
			/>
			<div className="flex h-6 items-center justify-between edge-t-s border-line px-l">
				<Placeholder className="h-2 w-16" />
				<Placeholder className="h-2 w-16" />
			</div>
		</div>
	);
}

function TurnTableLoading() {
	return (
		<div
			aria-hidden="true"
			className="min-h-0 min-w-0 overflow-hidden"
			data-session-detail-loading-table
		>
			<div
				className={cn(
					"grid h-11 min-w-[366px] grid-cols-[46px_repeat(4,64px)_minmax(64px,1fr)] items-center",
					"edge-b-s",
					"text-body-m font-medium",
					"border-line text-ink-3",
				)}
			>
				<Placeholder className="size-5 justify-self-center corner-full" />
				{TABLE_COLUMNS.map((label) => (
					<div key={label} className="truncate px-s first:pl-zero">
						{label}
					</div>
				))}
			</div>
			{LOADING_ROWS.map((index) => (
				<div
					key={index}
					className="grid h-9 min-w-[366px] grid-cols-[46px_repeat(4,64px)_minmax(64px,1fr)] items-center"
				>
					<Placeholder className="size-5 justify-self-center corner-full" />
					<Placeholder className="h-2.5 w-12" />
					{index % 2 === 0 ? (
						<div className="col-span-4 px-s">
							<Placeholder className={index % 4 === 0 ? "w-4/5" : "w-3/5"} />
						</div>
					) : (
						TABLE_COLUMNS.slice(1).map((label) => (
							<div key={label} className="flex min-w-0 items-center gap-s px-s">
								<div className="size-3.5 shrink-0 corner-full edge-l border-[color-mix(in_srgb,var(--ink)_8%,transparent)]" />
								<Placeholder className="h-2.5 w-6" />
							</div>
						))
					)}
				</div>
			))}
		</div>
	);
}

export function SessionTranscriptLoading() {
	return (
		<div
			aria-busy="true"
			className="min-w-0 overflow-hidden px-xl py-l"
			data-session-transcript-loading
		>
			<output className="sr-only">Loading conversation</output>
			<div
				aria-hidden="true"
				className="flex flex-col gap-[calc(var(--space-xxl)*4/3)]"
			>
				{[0, 1, 2].map((turn) => (
					<div
						key={turn}
						className="flex flex-col gap-xxl edge-l-m border-line pl-l"
					>
						<div className="flex flex-col gap-l">
							<div className="flex items-center gap-m">
								<Placeholder className="size-5 shrink-0 corner-full" />
								<Placeholder className="w-16" />
							</div>
							<Placeholder className="w-11/12" />
							<Placeholder className="w-3/5" />
						</div>
						<div className="flex flex-col gap-l">
							<div className="flex items-center gap-m">
								<Placeholder className="size-4 shrink-0 corner-full" />
								<Placeholder className="w-28" />
							</div>
							<div className="flex items-center gap-m">
								<Placeholder className="h-4 w-20" />
								<Placeholder className="h-4 w-9" />
							</div>
							<Placeholder className="w-full" />
							<Placeholder className="w-5/6" />
							<Placeholder className="w-2/3" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

interface LoadingPaneStyle extends CSSProperties {
	"--session-turn-table-pane-width": string;
}

export function SessionDetailContentLoadingView({
	showOverviewStrip = true,
}: {
	showOverviewStrip?: boolean;
}) {
	const layoutRef = useRef<HTMLDivElement>(null);
	const layoutWidth = useElementWidth(layoutRef);
	const [storedWidth] = useStoredPaneSize(
		SESSION_TURN_TABLE_PANE_STORAGE_KEY,
		DEFAULT_SESSION_TURN_TABLE_PANE_WIDTH_PX,
	);
	const paneWidth = clampPaneSize(
		storedWidth,
		MINIMUM_SESSION_TURN_TABLE_PANE_WIDTH_PX,
		getSessionTurnTablePaneMaximum(
			layoutWidth,
			DEFAULT_SESSION_TRANSCRIPT_PANE_WIDTH_PX,
		),
	);
	const style: LoadingPaneStyle = {
		"--session-turn-table-pane-width": `${paneWidth}px`,
	};
	return (
		<div
			aria-busy="true"
			className={cn(SESSION_OVERVIEW_SURFACE_CLASS_NAME, "h-full")}
			data-session-detail-loading
		>
			<output className="sr-only">Loading session details</output>
			{showOverviewStrip ? <SessionChartLoading /> : null}
			<div
				ref={layoutRef}
				className="grid min-h-0 min-w-0 flex-1 grid-cols-[var(--session-turn-table-pane-width)_2px_minmax(0,1fr)]"
				style={style}
			>
				<TurnTableLoading />
				<div aria-hidden="true" className="edge-l-m border-line" />
				<div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
					<div
						aria-hidden="true"
						className={cn(
							"flex h-11 shrink-0 items-center gap-m overflow-hidden",
							"edge-y-s p-m",
							"border-line",
						)}
					>
						{[0, 1, 2, 3, 4].map((key) => (
							<Placeholder key={key} className="h-7 w-16 shrink-0 corner-s" />
						))}
					</div>
					<SessionTranscriptLoading />
				</div>
			</div>
		</div>
	);
}
