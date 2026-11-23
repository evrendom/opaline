import { useSyncExternalStore } from "react";
import type { SessionThreadOverviewChartRow } from "./session-thread-overview-chart";
import type { SessionThreadOverviewStripConfig } from "./session-thread-overview-config";
import { getChartX } from "./session-thread-overview-strip-utils";

/** Where the reader is: the turn being read, and how far through it. */
export type SessionOverviewReadingPosition = {
	index: number;
	/** 0 at the turn's top, 1 at its end. */
	progress: number;
};

export type SessionOverviewReadingSource = {
	get: () => SessionOverviewReadingPosition | null;
	subscribe: (listener: () => void) => () => void;
};

/**
 * A line across the strip at the reading position: the turn being read, laid
 * in that turn's span on the time axis as far as the reader is through it, so
 * it glides along the session as you scroll. Subscribes on its own, so
 * scrolling re-renders the line and not the chart.
 */
export function SessionOverviewReadingLine({
	config,
	rows,
	source,
}: {
	config: SessionThreadOverviewStripConfig;
	rows: readonly SessionThreadOverviewChartRow[];
	source: SessionOverviewReadingSource;
}) {
	const position = useSyncExternalStore(
		source.subscribe,
		source.get,
		() => null,
	);
	const row = position
		? rows.find((candidate) => candidate.index === position.index)
		: undefined;
	if (!position || !row) return null;
	const ratio =
		row.xStartRatio + position.progress * (row.xEndRatio - row.xStartRatio);
	if (ratio < config.xDomainStartRatio || ratio > config.xDomainEndRatio) {
		return null;
	}
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-accent"
			data-session-overview-reading-line
			style={{
				left: `${(getChartX(ratio, config) / config.chartWidth) * 100}%`,
			}}
		/>
	);
}
