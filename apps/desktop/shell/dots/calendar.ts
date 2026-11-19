import type { ChartInterval } from "@/features/costs/chart-interval";
import {
	type CalendarFit,
	columnLabel as baseColumnLabel,
	fitCalendar as baseFitCalendar,
	rowLabel as baseRowLabel,
	slotLabel as baseSlotLabel,
	SPACING,
	slotRowLabel as baseSlotRowLabel,
} from "@/features/costs/cost-dot-calendar";

export * from "@/features/costs/cost-dot-calendar";

const GAP_RATIO = 0.22;
const HOVER_GROWTH = 0.12;
const MAX_DOT_PX = 64;
const MAX_ROWS = 6;
const GUTTER_PX = 0;

const isBand = (fit: CalendarFit, interval: ChartInterval) =>
	interval === "daily" && fit.flow === "row";

export function fitCalendar(
	interval: ChartInterval,
	firstDate: string,
	lastDate: string,
	box: { width: number; height: number },
): CalendarFit | null {
	if (interval !== "daily") return baseFitCalendar(interval, firstDate, lastDate, box);
	const width = box.width + SPACING.left + SPACING.right - GUTTER_PX;
	const height = box.height;
	if (width <= 0 || height <= 0) return null;
	const days =
		Math.round(
			(new Date(`${lastDate}T00:00:00Z`).getTime() -
				new Date(`${firstDate}T00:00:00Z`).getTime()) /
				86_400_000,
		) + 1;
	let best: (CalendarFit & { spare: number }) | null = null;
	for (let rows = 1; rows <= MAX_ROWS; rows += 1) {
		const columns = Math.ceil(days / rows);
		const rough = Math.min(
			width / (columns + (columns - 1) * GAP_RATIO),
			height / (rows + (rows - 1) * GAP_RATIO),
		);
		const gap = Math.max(1, Math.round(rough * GAP_RATIO));
		const inset = Math.ceil((rough * HOVER_GROWTH) / 2) + 1;
		const size = Math.min(
			MAX_DOT_PX,
			Math.floor((width - (columns - 1) * gap) / columns),
			Math.floor((height - 2 * inset - (rows - 1) * gap) / rows),
		);
		if (size <= 0) continue;
		const spare = rows * columns - days;
		if (!best || size > best.size || (size === best.size && spare < best.spare))
			best = { flow: "row", rows, columns, size, gap, inset, origin: firstDate, gutter: GUTTER_PX, strip: 0, spare };
	}
	if (!best) return null;
	const { spare: _, ...fit } = best;
	return fit;
}

export function columnLabel(fit: CalendarFit, interval: ChartInterval, column: number) {
	return isBand(fit, interval) ? "" : baseColumnLabel(fit, interval, column);
}

export function slotLabel(fit: CalendarFit, interval: ChartInterval, slot: number) {
	return isBand(fit, interval) ? "" : baseSlotLabel(fit, interval, slot);
}

export function rowLabel(fit: CalendarFit, interval: ChartInterval, row: number) {
	return isBand(fit, interval) ? "" : baseRowLabel(fit, interval, row);
}

export function slotRowLabel(fit: CalendarFit, interval: ChartInterval, slot: number) {
	return isBand(fit, interval) ? "" : baseSlotRowLabel(fit, interval, slot);
}
