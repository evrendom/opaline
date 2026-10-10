import type { ComponentProps, CSSProperties, ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/ui/tooltip";
import { formatCompactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatReaderCost } from "./session-reader-model";
import {
	formatDuration,
	formatSpanDuration,
} from "./session-reader-waterfall-chips";

// The waterfall's time track pieces: the ruler above the bars, a bar's
// tooltip, a bar that fills as what it sums is read, and a row's totals in
// the right-hand column.

// Vertical gridline fractions across the track — quarter marks, doubling as the
// ruler's tick positions so the gridlines and time labels all align.
export const GRID_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;

export function BarTooltip({
	children,
	durationMs,
	offsetMs,
}: {
	children: ReactElement;
	durationMs: number | null;
	offsetMs: number;
}) {
	return (
		<Tooltip>
			<TooltipTrigger render={children} />
			<TooltipContent>
				{durationMs === null
					? `at +${formatDuration(offsetMs)}`
					: `${formatSpanDuration(durationMs)} · starts +${formatDuration(offsetMs)}`}
			</TooltipContent>
		</Tooltip>
	);
}

export function RowTotals({
	cost,
	durationMs,
	tokens,
}: {
	cost: number | null;
	durationMs: number | null;
	tokens: number;
}) {
	return (
		<div className="flex flex-col items-end pr-1 text-right">
			{durationMs !== null ? (
				<span className="text-[11px] font-medium text-foreground/80 tabular-nums">
					{formatSpanDuration(durationMs)}
				</span>
			) : null}
			{cost !== null || tokens > 0 ? (
				<span className="hidden text-[10px] whitespace-nowrap text-muted-foreground tabular-nums @lg:inline">
					{cost !== null ? formatReaderCost(cost) : null}
					{cost !== null && tokens > 0 ? " · " : null}
					{tokens > 0 ? formatCompactNumber(tokens) : null}
				</span>
			) : null}
		</div>
	);
}

/**
 * A thin time ruler above the bars, spanning the track column. Quarter-point
 * labels mark elapsed time across the turn; the last one right-aligns so it
 * doesn't overflow the track.
 */
export function TimeRuler({ total }: { total: number }) {
	return (
		<div className="relative h-5 select-none">
			{GRID_FRACTIONS.map((fraction) => (
				<span
					key={fraction}
					className={cn(
						// One line: a label at the track's end has no width left to
						// lay out in, so "4m 10s" would otherwise stack its words.
						"absolute top-0 text-[10px] whitespace-nowrap text-muted-foreground/50 tabular-nums",
						fraction === 1 && "-translate-x-full",
						// The inner labels collide on a short track, so only the two
						// ends show there.
						fraction !== 0 && fraction !== 1 && "hidden @lg:inline",
					)}
					style={{ left: `${fraction * 100}%` }}
				>
					{formatDuration(total * fraction)}
				</span>
			))}
		</div>
	);
}

/**
 * The bar of a row that sums others — the whole run, an open subagent's call,
 * a fold. Frozen at the top while what it sums scrolls up under it, it fills
 * as that's read (useWaterfallScrollProgress writes the layers): its own
 * color fades, filled back in up to the last step out of sight, which is laid
 * in at its own place and color. One rounded clip holds the layers, so they
 * meet square and only the bar's two ends are rounded. As a step of the row
 * above it, it reads as one bar at `left`/`width` (track percentages).
 */
export function ProgressBar({
	baseClassName,
	baseStyle,
	children,
	color,
	fillClassName,
	fillStyle,
	left,
	width,
	...props
}: Omit<ComponentProps<"div">, "color"> & {
	baseClassName?: string;
	baseStyle?: CSSProperties;
	/** How it reads as a step above, when its own fill isn't solid. */
	color?: string;
	fillClassName?: string;
	fillStyle?: CSSProperties;
	left: number;
	width: number;
}) {
	return (
		<div
			{...props}
			data-color={color}
			data-left={left}
			data-mark=""
			data-progress-host=""
			data-width={width}
			className="group/host absolute top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-xs *:absolute *:inset-y-0 *:duration-300 *:ease-out"
			style={{ left: `${left}%`, width: `${width}%` }}
		>
			<div
				data-progress-base=""
				className={cn(
					"inset-x-0 transition-opacity group-data-progress/host:opacity-35",
					baseClassName,
				)}
				style={baseStyle}
			>
				{children}
			</div>
			<div
				data-progress-fill=""
				className={cn(
					"left-0 opacity-0 transition-[width,opacity] group-data-progress/host:opacity-100",
					fillClassName,
				)}
				style={fillStyle}
			/>
			<div
				data-progress-step=""
				className="opacity-0 transition-[left,width,background-color,opacity] group-data-progress/host:opacity-100"
			/>
		</div>
	);
}
