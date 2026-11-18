import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import type { SessionThreadOverviewChartRow } from "./session-thread-overview-chart";
import type { SessionThreadOverviewStripConfig } from "./session-thread-overview-config";
import { getChartX, getTurnLabel } from "./session-thread-overview-strip-utils";
import { formatTimelineMoment } from "./session-thread-overview-time-format";
import type { SessionThreadOverviewTick } from "./session-thread-overview-timeline";
import type { SessionTurnTablePaneOption } from "./session-turn-table-pane";

interface SessionOverviewViewportPaneStyle extends CSSProperties {
	"--session-overview-viewport-left": string;
	"--session-overview-viewport-width": string;
}

export function SessionOverviewViewportPane({
	chartWidth,
	onKeyDown,
	onPointerDown,
	onPointerMove,
	rowCount,
	selectedIndex,
	valueText,
	viewportStartX,
	viewportWidth,
}: {
	chartWidth: number;
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
	onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
	onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
	rowCount: number;
	selectedIndex: number;
	valueText: string;
	viewportStartX: number;
	viewportWidth: number;
}) {
	const style: SessionOverviewViewportPaneStyle = {
		"--session-overview-viewport-left": `${(viewportStartX / chartWidth) * 100}%`,
		"--session-overview-viewport-width": `${(viewportWidth / chartWidth) * 100}%`,
	};

	return (
		<div
			role="slider"
			aria-label="Visible transcript range"
			aria-valuemax={Math.max(rowCount - 1, 0)}
			aria-valuemin={0}
			aria-valuenow={selectedIndex}
			aria-valuetext={valueText}
			className="absolute inset-y-0.5 left-(--session-overview-viewport-left) z-20 w-(--session-overview-viewport-width) cursor-crosshair touch-none bg-orange-500/10 outline-none dark:bg-orange-400/10"
			data-session-overview-viewport-band
			data-session-overview-viewport-pane
			style={style}
			tabIndex={0}
			onKeyDown={onKeyDown}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
		/>
	);
}

export function SessionOverviewTimelineFooter({
	onResetZoom,
	ticks,
}: {
	onResetZoom?: () => void;
	ticks: readonly SessionThreadOverviewTick[];
}) {
	const lastTick = ticks.at(-1);
	const firstTick = ticks[0];
	return (
		<div
			className="h-6 shrink-0 border-t-[0.5px] border-(--session-overview-border) px-3 py-1"
			data-session-overview-axis-strip
		>
			<div className="grid h-4 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 font-sans text-[0.625rem] leading-4 font-normal text-(--session-overview-subtle) tabular-nums">
				{firstTick ? (
					<span className="truncate whitespace-nowrap">
						{formatTimelineMoment(firstTick.timestamp)}
					</span>
				) : null}
				{onResetZoom ? (
					<button
						type="button"
						aria-label="Reset timeline zoom"
						className="h-5 rounded px-1.5 text-[0.625rem] font-medium text-(--session-overview-text) outline-none hover:bg-(--session-overview-hover)"
						onClick={onResetZoom}
					>
						Reset zoom
					</button>
				) : (
					<span />
				)}
				{lastTick && lastTick.timestamp !== firstTick?.timestamp ? (
					<span
						className="justify-self-end truncate whitespace-nowrap"
						data-session-overview-axis-end
					>
						{formatTimelineMoment(lastTick.timestamp)}
					</span>
				) : null}
			</div>
		</div>
	);
}

export function SessionOverviewTurnHitTargets({
	config,
	onFocusIndexChange,
	onSelect,
	options,
	readoutId,
	readoutIndex,
	rows,
	selectedIndex,
}: {
	config: SessionThreadOverviewStripConfig;
	onFocusIndexChange: (index: number | undefined) => void;
	onSelect: (index: number) => void;
	options: readonly SessionTurnTablePaneOption[];
	readoutId: string;
	readoutIndex: number | undefined;
	rows: readonly SessionThreadOverviewChartRow[];
	selectedIndex: number;
}) {
	return (
		<div className="absolute inset-0 z-10 cursor-crosshair">
			{rows.map((row) => {
				const option = options[row.index];
				if (!option) {
					return null;
				}
				return (
					<button
						key={option.key}
						type="button"
						aria-describedby={
							readoutIndex === row.index ? readoutId : undefined
						}
						aria-label={`Select ${getTurnLabel(option)}`}
						aria-pressed={row.index === selectedIndex}
						className="absolute inset-y-0 w-5 -translate-x-1/2 cursor-crosshair rounded-sm outline-none"
						data-session-overview-turn-hit-target
						style={{
							left: `${(getChartX(row.xRatio, config) / config.chartWidth) * 100}%`,
						}}
						onBlur={() => onFocusIndexChange(undefined)}
						onClick={() => onSelect(row.index)}
						onFocus={() => onFocusIndexChange(row.index)}
					/>
				);
			})}
		</div>
	);
}
