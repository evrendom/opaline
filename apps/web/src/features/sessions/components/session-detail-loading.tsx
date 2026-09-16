import { type CSSProperties, useId, useRef } from "react";
import { Skeleton } from "@/app/ui/skeleton";
import {
	useElementWidth,
	useStoredPaneSize,
} from "@/components/ui/horizontal-resize-handle";
import { clampPaneSize } from "@/components/ui/horizontal-resize-utils";
import { cn } from "@/lib/utils";
import {
	DEFAULT_SESSION_TRANSCRIPT_PANE_WIDTH_PX,
	DEFAULT_SESSION_TURN_TABLE_PANE_WIDTH_PX,
	getSessionTurnTablePaneMaximum,
	MINIMUM_SESSION_TURN_TABLE_PANE_WIDTH_PX,
	SESSION_TURN_TABLE_PANE_STORAGE_KEY,
} from "./session-detail-pane-sizing";
import { SessionContextUtilizationGradients } from "./session-thread-overview-token-layer";
import { SESSION_OVERVIEW_SURFACE_CLASS_NAME } from "./sessions-overview-table-utils";
import "./session-detail-loading.css";

const TABLE_COLUMNS = ["Time", "Length", "Input", "Output", "Cost"];
const LOADING_ROWS = Array.from({ length: 16 }, (_, index) => index);
// A fixed illustrative wave, independent of session data. One moving mask
// reveals the line and fill together, keeping their fading edges aligned.
const CHART_LOADING_LINE =
	"M 10 47 C 80 47 80 28 150 28 C 220 28 220 10 290 10 C 360 10 360 39 430 39 C 500 39 500 5 570 5 C 640 5 640 32 710 32 C 780 32 780 16 850 16 C 920 16 920 44 990 44";

function Placeholder({ className }: { className?: string }) {
	return (
		<Skeleton
			className={cn(
				"h-3 animate-none rounded-sm bg-[color-mix(in_srgb,var(--session-overview-text)_6%,transparent)] dark:bg-white/10",
				className,
			)}
		/>
	);
}

function SessionChartLoading() {
	const fillId = useId();
	return (
		<div
			aria-hidden="true"
			className="h-[4.07rem] shrink-0 overflow-hidden border-b border-(--session-overview-border) bg-[#fcfcfc] dark:bg-(--session-overview-surface)"
			data-session-chart-loading
		>
			<svg
				aria-hidden="true"
				className="h-[2.57rem] w-full"
				preserveAspectRatio="none"
				viewBox="0 0 1000 76"
			>
				<defs>
					<SessionContextUtilizationGradients
						gradientId={fillId}
						baselineY={50}
						topY={5}
					/>
					<linearGradient id={`${fillId}-fade`} x1="0%" x2="100%">
						<stop offset="0%" stopColor="white" stopOpacity="0" />
						<stop offset="35%" stopColor="white" />
						<stop offset="65%" stopColor="white" />
						<stop offset="100%" stopColor="white" stopOpacity="0" />
					</linearGradient>
					<mask
						id={`${fillId}-flow`}
						maskUnits="userSpaceOnUse"
						x="0"
						y="0"
						width="1000"
						height="76"
					>
						<rect
							className="session-detail-loading-mask"
							width="300"
							height="76"
							fill={`url(#${fillId}-fade)`}
							data-session-chart-loading-mask
						/>
					</mask>
				</defs>
				{[16, 27, 39].map((y) => (
					<path
						key={y}
						className="stroke-[color-mix(in_srgb,var(--session-overview-text)_6%,transparent)]"
						d={`M 10 ${y} H 990`}
						vectorEffect="non-scaling-stroke"
					/>
				))}
				<g mask={`url(#${fillId}-flow)`} data-session-chart-loading-flow>
					<path
						d={`${CHART_LOADING_LINE} L 990 50 L 10 50 Z`}
						fill={`url(#${fillId})`}
					/>
					<path
						className="fill-none"
						d={CHART_LOADING_LINE}
						stroke={`url(#${fillId}-stroke)`}
						strokeLinecap="round"
						strokeWidth="2.5"
						vectorEffect="non-scaling-stroke"
					/>
				</g>
			</svg>
			<div className="flex h-6 items-center justify-between border-t-[0.5px] border-(--session-overview-border) px-3">
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
			<div className="grid h-11 min-w-[366px] grid-cols-[46px_repeat(4,64px)_minmax(64px,1fr)] items-center border-b-[0.5px] border-(--session-overview-border) text-[0.75rem] font-medium text-(--session-overview-subtle)">
				<Placeholder className="size-5 justify-self-center rounded-full" />
				{TABLE_COLUMNS.map((label) => (
					<div key={label} className="truncate px-1.5 first:pl-0">
						{label}
					</div>
				))}
			</div>
			{LOADING_ROWS.map((index) => (
				<div
					key={index}
					className="grid h-9 min-w-[366px] grid-cols-[46px_repeat(4,64px)_minmax(64px,1fr)] items-center"
				>
					<Placeholder className="size-5 justify-self-center rounded-full" />
					<Placeholder className="h-2.5 w-12" />
					{index % 2 === 0 ? (
						<div className="col-span-4 px-1.5">
							<Placeholder className={index % 4 === 0 ? "w-4/5" : "w-3/5"} />
						</div>
					) : (
						TABLE_COLUMNS.slice(1).map((label) => (
							<div
								key={label}
								className="flex min-w-0 items-center gap-1.5 px-1.5"
							>
								<div className="size-3.5 shrink-0 rounded-full border-2 border-[color-mix(in_srgb,var(--session-overview-text)_8%,transparent)]" />
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
			className="min-w-0 overflow-hidden px-4 py-3"
			data-session-transcript-loading
		>
			<output className="sr-only">Loading conversation</output>
			<div aria-hidden="true" className="flex flex-col gap-8">
				{[0, 1, 2].map((turn) => (
					<div
						key={turn}
						className="flex flex-col gap-6 border-l border-(--session-overview-border) pl-3"
					>
						<div className="flex flex-col gap-3">
							<div className="flex items-center gap-2">
								<Placeholder className="size-5 shrink-0 rounded-full" />
								<Placeholder className="w-16" />
							</div>
							<Placeholder className="w-11/12" />
							<Placeholder className="w-3/5" />
						</div>
						<div className="flex flex-col gap-3">
							<div className="flex items-center gap-2">
								<Placeholder className="size-4 shrink-0 rounded-full" />
								<Placeholder className="w-28" />
							</div>
							<div className="flex items-center gap-2">
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

export function SessionDetailContentLoadingView() {
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
			<SessionChartLoading />
			<div
				ref={layoutRef}
				className="grid min-h-0 min-w-0 flex-1 grid-cols-[var(--session-turn-table-pane-width)_2px_minmax(0,1fr)]"
				style={style}
			>
				<TurnTableLoading />
				<div
					aria-hidden="true"
					className="border-l border-(--session-overview-border)"
				/>
				<div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
					<div
						aria-hidden="true"
						className="flex h-11 shrink-0 items-center gap-2 overflow-hidden border-y-[0.5px] border-(--session-overview-border) p-2"
					>
						{[0, 1, 2, 3, 4].map((key) => (
							<Placeholder key={key} className="h-7 w-16 shrink-0 rounded-md" />
						))}
					</div>
					<SessionTranscriptLoading />
				</div>
			</div>
		</div>
	);
}
