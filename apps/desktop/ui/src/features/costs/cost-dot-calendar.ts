import type { ChartInterval } from "./chart-interval";

const GAP_RATIO = 0.22;
const LABEL_EDGE_PX = 6;
export const AXIS_PX = 14 + LABEL_EDGE_PX;
const AXIS_GAP_PX = 3;
export const SPACING = { top: 0, right: 0, bottom: 4, left: -10 };
export const ROW_LABEL_LEFT_PX = 2 - SPACING.left;
export const LABEL_PX = 12;
const MAX_DOT_PX = 40;
const MIN_DOT_PX = 5;
const SIZE_WEIGHT = 2;
const HEIGHT_SPARE_WEIGHT = 3;
const HOVER_GROWTH = 0.12;

const quarter = (value: number) => Math.floor(value * 4) / 4;

const dayOf = (date: string) => new Date(`${date}T00:00:00Z`);

const iso = (day: Date) => day.toISOString().slice(0, 10);

export const weekday = (date: string) => (dayOf(date).getUTCDay() + 6) % 7;

const monthIndex = (date: string) =>
	Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

const monthStart = (index: number) =>
	`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;

const addDays = (date: string, days: number) => {
	const day = dayOf(date);
	day.setUTCDate(day.getUTCDate() + days);
	return iso(day);
};

export const labelWidth = (text: string) => text.length * 7.5 + 2;

const shortYear = (year: number) => `’${String(year).slice(-2)}`;

const monthName = (month: number) =>
	new Date(Date.UTC(2024, month, 1)).toLocaleDateString(undefined, {
		month: "short",
		timeZone: "UTC",
	});

const weekdayName = (day: number) =>
	new Date(Date.UTC(2024, 0, 1 + day)).toLocaleDateString(undefined, {
		weekday: "narrow",
		timeZone: "UTC",
	});

const dayName = (date: string) =>
	dayOf(date).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	});

export type CalendarFit = {
	flow: "column" | "row";
	rows: number;
	columns: number;
	size: number;
	gap: number;
	inset: number;
	origin: string;
	gutter: number;
	strip: number;
};

type Shape = Pick<
	CalendarFit,
	"flow" | "rows" | "columns" | "size" | "gap" | "inset"
>;

function rowTexts(interval: ChartInterval, firstDate: string) {
	if (interval === "daily") return [0, 1, 2, 3, 4, 5, 6].map(weekdayName);
	if (interval === "weekly") return ["Sep 30", "Current"];
	if (interval === "yearly") return ["2020s"];
	return [shortYear(Number(firstDate.slice(0, 4)))];
}

function yAxisWidth(interval: ChartInterval, firstDate: string) {
	return (
		Math.max(...rowTexts(interval, firstDate).map(labelWidth)) +
		AXIS_GAP_PX +
		ROW_LABEL_LEFT_PX
	);
}

const gapFor = (size: number) => Math.max(1, quarter(size * GAP_RATIO));

const spanOf = (count: number, size: number, gap: number, inset: number) =>
	count * (size + gap) - gap + 2 * inset;

function across(room: number, count: number) {
	const rough = room / (count + (count - 1) * GAP_RATIO);
	const inset = Math.ceil((rough * HOVER_GROWTH) / 2) + 1;
	const size = quarter((room - 2 * inset) / (count + (count - 1) * GAP_RATIO));
	return { size, gap: gapFor(size), inset };
}

const range = (from: number, to: number, step = 1) =>
	Array.from(
		{ length: Math.max(0, Math.floor((to - from) / step) + 1) },
		(_, at) => from + at * step,
	);

function bestShape(
	flow: Shape["flow"],
	rowsOptions: readonly number[],
	columnsOptions: readonly number[],
	slots: number,
	width: number,
	height: number,
): Shape | null {
	const options: (Shape & { leftover: number })[] = [];
	for (const rows of rowsOptions)
		for (const columns of columnsOptions) {
			if (rows * columns < slots) continue;
			const wide = across(width, columns);
			const tall = across(height, rows);
			const { size, gap, inset } = wide.size <= tall.size ? wide : tall;
			if (size <= 0 || size > MAX_DOT_PX) continue;
			options.push({
				flow,
				rows,
				columns,
				size,
				gap,
				inset,
				leftover:
					width -
					spanOf(columns, size, gap, inset) +
					HEIGHT_SPARE_WEIGHT * (height - spanOf(rows, size, gap, inset)),
			});
		}
	const largest = Math.max(0, ...options.map((option) => option.size));
	const floor = Math.min(largest, Math.max(MIN_DOT_PX, largest / 2));
	const best = options
		.filter((option) => option.size >= floor)
		.sort(
			(a, b) =>
				a.leftover - SIZE_WEIGHT * a.size - (b.leftover - SIZE_WEIGHT * b.size),
		)[0];
	if (!best) return null;
	const { leftover: _, ...shape } = best;
	return shape;
}

type Calendar = {
	flow: Shape["flow"];
	lead: number;
	slots: number;
	rows: number[] | null;
	columns: number[] | null;
	origin: (before: number) => string;
};

function calendarOf(
	interval: ChartInterval,
	firstDate: string,
	lastDate: string,
	height: number,
): Calendar {
	const most = (room: number) => Math.max(1, Math.floor(room / 3));
	const firstMonth = monthIndex(firstDate);
	const months = monthIndex(lastDate) - firstMonth + 1;
	const firstYear = Number(firstDate.slice(0, 4));
	const years = Number(lastDate.slice(0, 4)) - firstYear + 1;
	if (interval === "daily") {
		const lead = weekday(firstDate);
		const days = Math.round(
			(dayOf(lastDate).getTime() - dayOf(firstDate).getTime()) / 86_400_000,
		);
		const slots = days + 1 + lead;
		return {
			flow: "column",
			lead,
			slots,
			rows: range(
				7,
				Math.max(7, Math.min(most(height), Math.ceil(slots / 7) * 7)),
				7,
			),
			columns: null,
			origin: (before) => addDays(firstDate, -lead - before),
		};
	}
	if (interval === "weekly") {
		const weeks =
			Math.round(
				(dayOf(lastDate).getTime() - dayOf(firstDate).getTime()) / 604_800_000,
			) + 1;
		return {
			flow: "row",
			lead: 0,
			slots: weeks,
			rows: null,
			columns: null,
			origin: (before) => addDays(firstDate, -7 * before),
		};
	}
	if (interval === "monthly" || interval === "quarterly") {
		const per = interval === "monthly" ? 12 : 4;
		const lead =
			interval === "monthly"
				? firstMonth % 12
				: Math.floor((firstMonth % 12) / 3);
		const periods =
			interval === "monthly"
				? months
				: Math.floor(monthIndex(lastDate) / 3) - Math.floor(firstMonth / 3) + 1;
		return {
			flow: "row",
			lead,
			slots: periods + lead,
			rows: null,
			columns: [per],
			origin: (before) => `${firstYear - before / per}-01-01`,
		};
	}
	const lead = firstYear % 10;
	return {
		flow: "row",
		lead,
		slots: years + lead,
		rows: null,
		columns: [10],
		origin: (before) => `${firstYear - lead - before}-01-01`,
	};
}

export function fitCalendar(
	interval: ChartInterval,
	firstDate: string,
	lastDate: string,
	box: { width: number; height: number },
): CalendarFit | null {
	const gutter = yAxisWidth(interval, firstDate);
	const width = box.width - gutter;
	const strip = AXIS_PX;
	const height = box.height - strip;
	if (width <= 0 || height <= 0) return null;
	const calendar = calendarOf(interval, firstDate, lastDate, height);
	const most = (room: number) => range(1, Math.max(1, Math.floor(room / 3)));
	const shape = bestShape(
		calendar.flow,
		calendar.rows ?? most(height),
		calendar.columns ?? most(width),
		calendar.slots,
		width,
		height,
	);
	if (!shape || shape.columns === 0 || shape.rows === 0) return null;
	const line = shape.flow === "column" ? shape.rows : shape.columns;
	const lines = shape.flow === "column" ? shape.columns : shape.rows;
	const before = Math.floor(
		Math.max(0, lines - Math.ceil(calendar.slots / line)) / 2,
	);
	return {
		...shape,
		origin: calendar.origin(before * line),
		gutter,
		strip,
	};
}

export function slotPlace(fit: CalendarFit, slot: number) {
	return fit.flow === "column"
		? { column: Math.floor(slot / fit.rows), row: slot % fit.rows }
		: { column: slot % fit.columns, row: Math.floor(slot / fit.columns) };
}

export function slotKey(
	fit: CalendarFit,
	interval: ChartInterval,
	slot: number,
): string | null {
	if (interval === "daily") return addDays(fit.origin, slot);
	if (interval === "weekly") return addDays(fit.origin, slot * 7);
	if (interval === "monthly") return monthStart(monthIndex(fit.origin) + slot);
	if (interval === "quarterly")
		return monthStart(monthIndex(fit.origin) + slot * 3);
	return `${Number(fit.origin.slice(0, 4)) + slot}-01-01`;
}

export function nearestSlot(fit: CalendarFit, x: number, y: number) {
	const pitch = fit.size + fit.gap;
	const line = (offset: number, count: number) =>
		Math.min(
			count - 1,
			Math.max(0, Math.floor((offset - fit.inset + fit.gap / 2) / pitch)),
		);
	const column = line(x, fit.columns);
	const row = line(y, fit.rows);
	return fit.flow === "column"
		? column * fit.rows + row
		: row * fit.columns + column;
}

export function columnLabel(
	fit: CalendarFit,
	interval: ChartInterval,
	column: number,
) {
	if (interval === "monthly") return monthName(column);
	if (interval === "quarterly") return `Q${column + 1}`;
	if (interval === "yearly") return String(column);
	if (interval === "weekly") return dayName(addDays(fit.origin, column * 7));
	return dayName(addDays(fit.origin, column * fit.rows));
}

export function rowLabel(
	fit: CalendarFit,
	interval: ChartInterval,
	row: number,
) {
	if (interval === "daily") return weekdayName(row % 7);
	if (interval === "weekly")
		return dayName(addDays(fit.origin, row * fit.columns * 7));
	const year = Number(fit.origin.slice(0, 4));
	if (interval === "yearly") return `${year + row * 10}s`;
	return shortYear(year + row);
}

export function slotRowLabel(
	fit: CalendarFit,
	interval: ChartInterval,
	slot: number,
) {
	const key = slotKey(fit, interval, slot);
	if (interval === "weekly" && key) return dayName(key);
	return rowLabel(fit, interval, slotPlace(fit, slot).row);
}

export function slotLabel(
	fit: CalendarFit,
	interval: ChartInterval,
	slot: number,
) {
	const key = slotKey(fit, interval, slot);
	const { column } = slotPlace(fit, slot);
	if (!key) return columnLabel(fit, interval, column);
	if (interval === "daily") return dayName(key);
	if (interval === "weekly") return dayName(addDays(key, 6));
	if (interval === "yearly") return shortYear(Number(key.slice(0, 4)));
	return columnLabel(fit, interval, column);
}
