import { createContext, type ReactNode, useContext, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import type {
	DateRangeContextValue,
	DateRangeSource,
} from "@/features/analytics/date-range/types";
import {
	getInclusiveDateRangeDays,
	normalizeAnalyticsDateRange,
} from "@/lib/analytics-date-range";
import { formatIsoDate } from "@/lib/format";

type StoredDateRange = {
	start: string;
	end: string;
};

const DateRangeContext = createContext<DateRangeContextValue | undefined>(
	undefined,
);

const STORAGE_KEY = "dateRange";

function getDefaultDateRange(): StoredDateRange {
	const end = new Date();
	const start = new Date();
	start.setDate(start.getDate() - 7);
	return {
		start: formatIsoDate(start),
		end: formatIsoDate(end),
	};
}

function readDateRangeFromSearchParams(
	searchParams: URLSearchParams,
): StoredDateRange | null {
	const fromParam = searchParams.get("from");
	const toParam = searchParams.get("to");

	if (fromParam && toParam) {
		return normalizeAnalyticsDateRange(fromParam, toParam);
	}

	return null;
}

function readStoredDateRange(storageKey: string): StoredDateRange | null {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		const stored = window.localStorage.getItem(storageKey);
		if (stored) {
			const parsed: unknown = JSON.parse(stored);
			if (isStoredDateRange(parsed)) {
				return normalizeAnalyticsDateRange(parsed.start, parsed.end);
			}
		}
	} catch {
		// Ignore localStorage errors
	}

	return null;
}

function isStoredDateRange(value: unknown): value is StoredDateRange {
	return (
		typeof value === "object" &&
		value !== null &&
		"start" in value &&
		typeof value.start === "string" &&
		"end" in value &&
		typeof value.end === "string"
	);
}

function resolveDateRange(
	searchParams: URLSearchParams,
	storageKey: string,
): {
	dateRange: StoredDateRange;
	source: DateRangeSource;
} {
	const searchDateRange = readDateRangeFromSearchParams(searchParams);
	if (searchDateRange) {
		return { dateRange: searchDateRange, source: "url" };
	}

	const storedDateRange = readStoredDateRange(storageKey);
	if (storedDateRange) {
		return { dateRange: storedDateRange, source: "storage" };
	}

	return { dateRange: getDefaultDateRange(), source: "default" };
}

function writeStoredDateRange(dateRange: StoredDateRange, storageKey: string) {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(storageKey, JSON.stringify(dateRange));
	} catch {
		// Ignore localStorage errors
	}
}

export function DateRangeProvider({
	children,
	storageKey = STORAGE_KEY,
}: {
	children: ReactNode;
	storageKey?: string;
}) {
	const [searchParams, setSearchParams] = useSearchParams();
	const { dateRange, source } = resolveDateRange(searchParams, storageKey);

	// Remember URL ranges before a session link navigates without query parameters.
	useEffect(() => {
		const urlRange = readDateRangeFromSearchParams(searchParams);
		if (urlRange) writeStoredDateRange(urlRange, storageKey);
	}, [searchParams, storageKey]);

	const updateDateRange = (
		updater: (currentDateRange: StoredDateRange) => StoredDateRange,
	) => {
		setSearchParams(
			(prev) => {
				const { dateRange: currentDateRange } = resolveDateRange(
					prev,
					storageKey,
				);
				const nextDateRange = updater(currentDateRange);
				const normalizedDateRange =
					normalizeAnalyticsDateRange(nextDateRange.start, nextDateRange.end) ??
					currentDateRange;
				const nextSearchParams = new URLSearchParams(prev);

				nextSearchParams.set("from", normalizedDateRange.start);
				nextSearchParams.set("to", normalizedDateRange.end);
				writeStoredDateRange(normalizedDateRange, storageKey);

				return nextSearchParams;
			},
			{ replace: true },
		);
	};

	const contextValue: DateRangeContextValue = {
		state: {
			startDate: dateRange.start,
			endDate: dateRange.end,
		},
		actions: {
			setStartDate: (date: string) => {
				updateDateRange((currentDateRange) => ({
					...currentDateRange,
					start: date,
				}));
			},
			setEndDate: (date: string) => {
				updateDateRange((currentDateRange) => ({
					...currentDateRange,
					end: date,
				}));
			},
			setDateRange: (startDate: string, endDate: string) => {
				updateDateRange(() => ({
					start: startDate,
					end: endDate,
				}));
			},
		},
		meta: {
			dayCount: getInclusiveDateRangeDays(dateRange.start, dateRange.end),
			source,
		},
	};

	return (
		<DateRangeContext.Provider value={contextValue}>
			{children}
		</DateRangeContext.Provider>
	);
}

export function useDateRange() {
	const context = useOptionalDateRange();
	if (context === undefined) {
		throw new Error("useDateRange must be used within a DateRangeProvider");
	}
	return context;
}

export function useOptionalDateRange() {
	return useContext(DateRangeContext);
}
