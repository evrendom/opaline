import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react";
import { useSearchParams } from "react-router-dom";
import type {
	DateRangeContextValue,
	DateRangeSource,
} from "@/features/analytics/date-range/types";
import {
	getAnalyticsMaxDays,
	getInclusiveDateRangeDays,
	normalizeAnalyticsDateRange,
} from "@/lib/analytics-date-range";
import { formatIsoDate } from "@/lib/format";
import { getWidgetState, setWidgetState } from "@/widget/host-bridge";

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
		return normalizeAnalyticsDateRange(
			fromParam,
			toParam,
			getAnalyticsMaxDays(searchParams.get("metric")),
		);
	}

	return null;
}

function readStoredDateRange(
	storageKey: string,
	maxDays: number,
): StoredDateRange | null {
	if (import.meta.env.MODE === "plugin") {
		const range = getWidgetState().dateRange;
		return range
			? normalizeAnalyticsDateRange(range.start, range.end, maxDays)
			: null;
	}
	if (typeof window === "undefined") {
		return null;
	}

	try {
		const stored = window.localStorage.getItem(storageKey);
		if (stored) {
			const parsed: unknown = JSON.parse(stored);
			if (isStoredDateRange(parsed)) {
				return normalizeAnalyticsDateRange(parsed.start, parsed.end, maxDays);
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

	const storedDateRange = readStoredDateRange(
		storageKey,
		getAnalyticsMaxDays(searchParams.get("metric")),
	);
	if (storedDateRange) {
		return { dateRange: storedDateRange, source: "storage" };
	}

	return { dateRange: getDefaultDateRange(), source: "default" };
}

function writeStoredDateRange(dateRange: StoredDateRange, storageKey: string) {
	if (import.meta.env.MODE === "plugin") {
		setWidgetState({ dateRange });
		return;
	}
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
	const metric = searchParams.get("metric");
	const urlStart = searchParams.get("from");
	const urlEnd = searchParams.get("to");
	const setSearchParamsRef = useRef(setSearchParams);
	useEffect(() => {
		setSearchParamsRef.current = setSearchParams;
	}, [setSearchParams]);

	// Remember URL ranges before a session link navigates without query parameters.
	useEffect(() => {
		const urlRange =
			urlStart && urlEnd
				? normalizeAnalyticsDateRange(
						urlStart,
						urlEnd,
						getAnalyticsMaxDays(metric),
					)
				: null;
		if (urlRange) writeStoredDateRange(urlRange, storageKey);
	}, [metric, storageKey, urlEnd, urlStart]);

	const actions = useMemo<DateRangeContextValue["actions"]>(() => {
		const updateDateRange = (
			updater: (currentDateRange: StoredDateRange) => StoredDateRange,
		) => {
			setSearchParamsRef.current(
				(prev) => {
					const { dateRange: currentDateRange } = resolveDateRange(
						prev,
						storageKey,
					);
					const nextDateRange = updater(currentDateRange);
					const normalizedDateRange =
						normalizeAnalyticsDateRange(
							nextDateRange.start,
							nextDateRange.end,
							getAnalyticsMaxDays(prev.get("metric")),
						) ?? currentDateRange;
					const nextSearchParams = new URLSearchParams(prev);

					nextSearchParams.set("from", normalizedDateRange.start);
					nextSearchParams.set("to", normalizedDateRange.end);
					writeStoredDateRange(normalizedDateRange, storageKey);

					return nextSearchParams;
				},
				{ replace: true },
			);
		};
		return {
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
		};
	}, [storageKey]);

	const startDate = dateRange.start;
	const endDate = dateRange.end;
	const contextValue = useMemo<DateRangeContextValue>(
		() => ({
			state: { startDate, endDate },
			actions,
			meta: {
				maxDays: getAnalyticsMaxDays(metric),
				dayCount: getInclusiveDateRangeDays(startDate, endDate),
				source,
			},
		}),
		[actions, endDate, metric, source, startDate],
	);

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

export function DateRangeOverride({
	range,
	children,
}: {
	range: { start: string; end: string } | null;
	children: ReactNode;
}) {
	const parent = useDateRange();
	const value = useMemo<DateRangeContextValue>(
		() =>
			range
				? {
						...parent,
						state: { startDate: range.start, endDate: range.end },
						meta: {
							...parent.meta,
							dayCount: getInclusiveDateRangeDays(range.start, range.end),
						},
					}
				: parent,
		[parent, range],
	);
	return (
		<DateRangeContext.Provider value={value}>
			{children}
		</DateRangeContext.Provider>
	);
}
