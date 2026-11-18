import type { Format } from "@number-flow/react";
import { calculateEstimatedCost as calculateEstimatedModelCost } from "@rudel/api-routes";
import { setCompactNumberLocale } from "@rudel/api-routes/session-context/format";
import {
	DISPLAY_LOCALE,
	type Figure,
	type FigureNumber,
	figureText,
	PLAIN_NUMBER,
} from "./figure";

export { formatCompactNumber } from "@rudel/api-routes/session-context/format";

const displayLocale = DISPLAY_LOCALE;
const numberFormatter = new Intl.NumberFormat(displayLocale);
setCompactNumberLocale(displayLocale);

const compactWholeNumberFormatter = new Intl.NumberFormat(displayLocale, {
	notation: "compact",
	maximumFractionDigits: 0,
});

const decimalFormatter = new Intl.NumberFormat(displayLocale, {
	maximumFractionDigits: 2,
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

const centFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 0,
});

const wholeCurrencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 0,
	maximumFractionDigits: 0,
});

const fineCurrencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 4,
	maximumFractionDigits: 4,
});

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	notation: "compact",
	minimumFractionDigits: 0,
	maximumFractionDigits: 1,
});

const compactWholeCurrencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	notation: "compact",
	minimumFractionDigits: 0,
	maximumFractionDigits: 0,
});

const minuteFormatter = new Intl.NumberFormat(displayLocale, {
	maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat(displayLocale, {
	maximumFractionDigits: 1,
});

const shortDateFormatter = new Intl.DateTimeFormat(displayLocale, {
	month: "short",
	day: "numeric",
});

const fullDateFormatter = new Intl.DateTimeFormat(displayLocale, {
	month: "short",
	day: "numeric",
	year: "numeric",
});

function parseDateValue(value: string) {
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		const [year, month, day] = value.split("-").map(Number);
		return new Date(year, (month ?? 1) - 1, day ?? 1);
	}

	return new Date(value);
}

export function formatNumber(value: number) {
	return numberFormatter.format(value);
}

export function formatCompactWholeNumber(value: number) {
	return compactWholeNumberFormatter.format(value);
}

export function formatDecimal(value: number) {
	return decimalFormatter.format(value);
}

export function formatCurrency(value: number | null | undefined) {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return currencyFormatter.format(0);
	}

	if (value !== 0 && Math.abs(value) < 1) {
		return fineCurrencyFormatter.format(value);
	}

	return currencyFormatter.format(value);
}

export function formatApiCost(value: number | null | undefined) {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return "0¢";
	}

	return Math.abs(value) >= 1
		? wholeCurrencyFormatter.format(value)
		: `${centFormatter.format(value * 100)}¢`;
}

export function formatCompactCurrency(value: number | null | undefined) {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return currencyFormatter.format(0);
	}

	if (Math.abs(value) < 1_000) {
		return formatCurrency(value);
	}

	return compactCurrencyFormatter.format(value);
}

export function formatWholeCurrency(value: number | null | undefined) {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return wholeCurrencyFormatter.format(0);
	}

	return wholeCurrencyFormatter.format(value);
}

export function formatCompactWholeCurrency(value: number | null | undefined) {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return wholeCurrencyFormatter.format(0);
	}

	if (Math.abs(value) < 1_000) {
		return formatWholeCurrency(value);
	}

	return compactWholeCurrencyFormatter.format(value);
}

export function formatMinutes(value: number) {
	return `${minuteFormatter.format(value)} min`;
}

const HALVES: Format = { useGrouping: false, maximumFractionDigits: 1 };

export const unitFigure = (value: number, suffix: string): FigureNumber => ({
	value,
	format: PLAIN_NUMBER,
	suffix,
});

export function halfHoursFigure(seconds: number): Figure {
	return [
		{ value: Math.round(seconds / 1800) / 2, format: HALVES, suffix: "h" },
	];
}

export function formatHalfHours(seconds: number): string {
	return figureText(halfHoursFigure(seconds));
}

export function roundedDurationFigure(minutes: number | undefined): Figure {
	if (minutes === undefined) return ["—"];
	const safeMinutes = Math.max(0, minutes);
	if (safeMinutes < 1) return [unitFigure(Math.round(safeMinutes * 60), "s")];
	const roundedMinutes = Math.round(safeMinutes);
	if (roundedMinutes < 60) return [unitFigure(roundedMinutes, "m")];
	return halfHoursFigure(safeMinutes * 60);
}

export function formatRoundedDuration(minutes: number | undefined) {
	return figureText(roundedDurationFigure(minutes));
}

export function formatShare(share: number): string {
	const percent = share * 100;
	return percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

export function shareOfFigure(part: number, whole: number): Figure {
	const percent = whole > 0 ? (part / whole) * 100 : 0;
	return percent > 0 && percent < 1
		? [{ ...unitFigure(1, "%"), prefix: "<" }]
		: [unitFigure(Math.round(percent), "%")];
}

export function formatShareOf(part: number, whole: number): string {
	return figureText(shareOfFigure(part, whole));
}

export const compactNumberFigure = (value: number): Figure => [
	{
		value,
		format: { notation: "compact", maximumFractionDigits: 1 },
		visitorLocale: true,
	},
];

export const countFigure = (value: number): Figure => [
	{ value, format: {}, visitorLocale: true },
];

export function formatPercent(value: number) {
	return `${percentFormatter.format(value)}%`;
}

export function formatSignedPercent(value: number) {
	const sign = value > 0 ? "+" : "";
	return `${sign}${percentFormatter.format(value)}%`;
}

const timeOfDayFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
	second: "2-digit",
});
const paddedTimeOfDayFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
});

export function formatTimeOfDay(at: number | string): string {
	const ms = new Date(at).getTime();
	return Number.isFinite(ms) ? timeOfDayFormatter.format(ms) : "Invalid Date";
}

export function formatPaddedTimeOfDay(at: number | string): string {
	const ms = new Date(at).getTime();
	return Number.isFinite(ms)
		? paddedTimeOfDayFormatter.format(ms)
		: "Invalid Date";
}

export function basename(path: string): string {
	return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function formatDateLabel(value: string) {
	return shortDateFormatter.format(parseDateValue(value));
}

export function formatFullDateLabel(value: string) {
	return fullDateFormatter.format(parseDateValue(value));
}

export function formatDateRangeLabel(startDate: string, endDate: string) {
	return `${formatDateLabel(startDate)} - ${formatFullDateLabel(endDate)}`;
}

export function formatIsoDate(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function clampToPositiveZero(value: number) {
	return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function formatUsername(
	userId: string,
	userMap?: Map<string, string> | Record<string, string | undefined>,
) {
	if (userMap instanceof Map) {
		return userMap.get(userId) ?? userId;
	}

	if (userMap && typeof userMap === "object") {
		return userMap[userId] ?? userId;
	}

	return userId;
}

export function calculateCost(
	inputTokens: number,
	outputTokens: number,
	options: {
		at: Date | string;
		model?: string | null;
		cacheReadInputTokens?: number;
		cacheCreationInputTokens?: number;
	},
) {
	return (
		calculateEstimatedModelCost({
			at: options.at,
			model: options.model ?? null,
			inputTokens,
			outputTokens,
			cacheReadInputTokens: options.cacheReadInputTokens ?? 0,
			cacheCreationInputTokens: options.cacheCreationInputTokens ?? 0,
		}) ?? 0
	);
}

export function encodeProjectPath(projectPath: string) {
	return encodeURIComponent(projectPath);
}

export function decodeProjectPath(projectPath: string) {
	try {
		return decodeURIComponent(projectPath);
	} catch {
		return projectPath;
	}
}
