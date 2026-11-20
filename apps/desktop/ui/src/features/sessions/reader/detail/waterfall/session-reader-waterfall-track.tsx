import type { ComponentProps, CSSProperties } from "react";
import { formatCompactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatReaderCost } from "../../model/session-reader-model";
import {
	formatDuration,
	formatRanOn,
	formatSpanDuration,
} from "./session-reader-waterfall-chips";

// Vertical gridline fractions across the track — quarter marks, doubling as the
// ruler's tick positions so the gridlines and time labels all align.
export const GRID_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;

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
		<div className="flex flex-col items-end pr-xs text-right">
			{durationMs !== null ? (
				<span className="text-[11px] font-medium text-ink/80 tabular-nums">
					{formatSpanDuration(durationMs)}
				</span>
			) : null}
			{cost !== null || tokens > 0 ? (
				<span className="hidden text-[10px] whitespace-nowrap text-ink-3 tabular-nums @lg:inline">
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
						"absolute top-0 text-[10px] whitespace-nowrap text-ink-3/50 tabular-nums",
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
			className="group/host absolute top-1/2 h-2 min-w-0.5 -translate-y-1/2 overflow-hidden corner-xs *:absolute *:inset-y-0 *:duration-(--motion-large-duration) *:ease-out"
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

export function RanOnChip({ ms }: { ms: number }) {
	return (
		<span className="absolute top-1/2 right-0 -translate-y-1/2 corner-xs bg-canvas px-xs text-[10px] leading-4 text-ink-3 tabular-nums">
			+{formatRanOn(ms)}
		</span>
	);
}

export function RunningBar({
	bar,
	span,
}: {
	bar: { className?: string; style?: CSSProperties };
	span: { offset: number; width: number };
}) {
	return (
		<div
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute top-1/2 h-2 min-w-0.5 -translate-y-1/2 corner-xs",
				bar.className,
			)}
			style={{ ...bar.style, left: `${span.offset}%`, width: `${span.width}%` }}
		/>
	);
}

export function TrackLabel({
	className,
	offset,
	text,
	width,
}: {
	className?: string;
	offset: number;
	text: string;
	width: number;
}) {
	const end = offset + width;
	const place: CSSProperties =
		end <= 70
			? { left: `calc(${end}% + 6px)`, maxWidth: `calc(${100 - end}% - 6px)` }
			: offset >= 30
				? {
						maxWidth: `calc(${offset}% - 6px)`,
						right: `calc(${100 - offset}% + 6px)`,
					}
				: {
						left: `calc(${offset}% + 6px)`,
						maxWidth: `calc(${100 - offset}% - 6px)`,
					};
	return (
		<span
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute top-1/2 -translate-y-1/2 truncate text-body-s text-ink-3",
				end > 70 &&
					offset < 30 &&
					"corner-xs bg-(--dashboard-01-content-background,var(--canvas)) px-xs",
				className,
			)}
			style={place}
		>
			{text}
		</span>
	);
}
