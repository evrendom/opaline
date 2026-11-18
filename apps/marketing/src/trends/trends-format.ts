const integerFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});
// Dollars keep three significant digits when shortened, so close audited
// figures stay apart ($1.32K, $1.25K).
const usdCompactFormat = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumSignificantDigits: 3,
});
const percentFormat = new Intl.NumberFormat("en-US", {
	style: "percent",
	maximumFractionDigits: 1,
});
const dayFormat = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});
const monthFormat = new Intl.DateTimeFormat("en-US", {
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});
const shortMonthFormat = new Intl.DateTimeFormat("en-US", {
	month: "short",
	year: "numeric",
	timeZone: "UTC",
});
const fullDayFormat = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
	timeZone: "UTC",
});

export function formatInteger(value: number) {
	return integerFormat.format(value);
}

export function formatCompact(value: number) {
	return compactFormat.format(value);
}

export function formatPercent(value: number) {
	return percentFormat.format(value);
}

export function formatDecimal(value: number, digits = 1) {
	return value.toFixed(digits);
}

export function formatDuration(seconds: number) {
	if (seconds < 60) return `${Math.round(seconds)}s`;
	const minutes = seconds / 60;
	if (minutes < 60) return `${trimDecimal(minutes, minutes < 10 ? 1 : 0)}m`;
	return `${trimDecimal(minutes / 60, 1)}h`;
}

function trimDecimal(value: number, digits: number) {
	return String(Number(value.toFixed(digits)));
}

export function formatUsd(value: number) {
	if (value === 0) return "$0";
	const absolute = Math.abs(value);
	// Thousands and up shorten like token counts: $13.1K, $100K.
	if (absolute >= 1000) return `$${usdCompactFormat.format(value)}`;
	if (absolute >= 100) return `$${integerFormat.format(Math.round(value))}`;
	if (Number.isInteger(value)) return `$${value}`;
	if (absolute >= 1) return `$${value.toFixed(2)}`;
	// Three significant digits keep sub-dollar values distinct without noise.
	return `$${Number(value.toPrecision(3))}`;
}

export function formatDay(isoDate: string) {
	return dayFormat.format(new Date(isoDate));
}

export function formatPeriod(startIso: string, endExclusiveIso: string) {
	const start = new Date(startIso);
	const endExclusive = new Date(endExclusiveIso);
	const isCalendarMonth =
		start.getUTCDate() === 1 &&
		endExclusive.getUTCDate() === 1 &&
		(endExclusive.getUTCMonth() - start.getUTCMonth() + 12) % 12 === 1;
	if (isCalendarMonth) return monthFormat.format(start);
	const end = new Date(endExclusive);
	end.setUTCDate(end.getUTCDate() - 1);
	return `${dayFormat.format(start)} – ${fullDayFormat.format(end)}`;
}

/** Short enough for a hero-scale stat: "Sep 2026", "Sep 1 – 30" or "Sep 1 – Oct 3". */
export function formatPeriodCompact(startIso: string, endExclusiveIso: string) {
	const start = new Date(startIso);
	const endExclusive = new Date(endExclusiveIso);
	const isCalendarMonth =
		start.getUTCDate() === 1 &&
		endExclusive.getUTCDate() === 1 &&
		(endExclusive.getUTCMonth() - start.getUTCMonth() + 12) % 12 === 1;
	if (isCalendarMonth) return shortMonthFormat.format(start);
	const end = new Date(endExclusive);
	end.setUTCDate(end.getUTCDate() - 1);
	const sameMonth =
		start.getUTCMonth() === end.getUTCMonth() &&
		start.getUTCFullYear() === end.getUTCFullYear();
	return sameMonth
		? `${dayFormat.format(start)} – ${end.getUTCDate()}`
		: `${dayFormat.format(start)} – ${dayFormat.format(end)}`;
}

/** "Sep 2026". */
export function formatMonth(isoDate: string) {
	return shortMonthFormat.format(new Date(isoDate));
}

export function formatFullDay(isoDate: string) {
	return fullDayFormat.format(new Date(isoDate));
}
