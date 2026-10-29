import { calculateEstimatedCost as calculateEstimatedModelCost } from "@rudel/api-routes";

// The static English demo must format identically at build time and hydration.
// Normal product builds continue to use the visitor's locale.
const displayLocale =
	import.meta.env.MODE === "product-demo" ? "en-US" : undefined;
const numberFormatter = new Intl.NumberFormat(displayLocale);

const compactNumberFormatter = new Intl.NumberFormat(displayLocale, {
	notation: "compact",
	maximumFractionDigits: 1,
});

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

export function formatCompactNumber(value: number) {
	return compactNumberFormatter.format(value);
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

export function formatHalfHours(seconds: number): string {
	return `${Math.round(seconds / 1800) / 2}h`;
}

export function formatRoundedDuration(minutes: number | undefined) {
	if (minutes === undefined) {
		return "—";
	}

	const safeMinutes = Math.max(0, minutes);
	if (safeMinutes < 1) {
		return `${Math.round(safeMinutes * 60)}s`;
	}

	const roundedMinutes = Math.round(safeMinutes);
	if (roundedMinutes < 60) {
		return `${roundedMinutes}m`;
	}

	return formatHalfHours(safeMinutes * 60);
}

export function formatShare(share: number): string {
	const percent = share * 100;
	return percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

export function formatShareOf(part: number, whole: number): string {
	const percent = whole > 0 ? (part / whole) * 100 : 0;
	return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

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
