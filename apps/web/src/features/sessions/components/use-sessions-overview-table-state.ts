import type {
	SessionAnalytics,
	SessionFilterCatalog,
	SessionListFilters,
} from "@rudel/api-routes";
import { useCallback, useMemo, useState } from "react";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { formatUsername } from "@/lib/format";
import { useSessionListFilters } from "../use-session-list-filters";
import {
	buildSessionOverviewFilterOptions,
	buildSessionOverviewRangeBounds,
	compareSessionLabels,
	compareSessions,
	getInitialSortDirection,
	getSessionOverviewCost,
	matchesSessionOverviewFilters,
	matchesSessionOverviewRangeFilters,
	SESSION_OVERVIEW_COLUMNS,
	SESSION_OVERVIEW_FILTER_KEYS,
	SESSION_OVERVIEW_RANGE_FILTER_KEYS,
	SESSION_OVERVIEW_SORT_OPTIONS,
	type SessionOverviewColumnKey,
	type SessionOverviewExcludedFilterValues,
	type SessionOverviewFilterKey,
	type SessionOverviewRangeFilter,
	type SessionOverviewRangeFilterKey,
	type SessionOverviewRangeFilterValues,
	type SessionSortState,
} from "./sessions-overview-table-utils";

const SESSION_ROW_BATCH_SIZE = 50;
const EMPTY_SESSIONS: readonly SessionAnalytics[] = [];
const createEmptyFilters = (): SessionOverviewExcludedFilterValues => ({
	model: new Set<string>(),
	repository: new Set<string>(),
	skills: new Set<string>(),
	user: new Set<string>(),
});
const createEmptyRangeFilters = (): SessionOverviewRangeFilterValues => ({
	cost: { maximum: null, minimum: null },
	duration: { maximum: null, minimum: null },
	errors: { maximum: null, minimum: null },
	input: { maximum: null, minimum: null },
	output: { maximum: null, minimum: null },
	subagents: { maximum: null, minimum: null },
});

export function useSessionsOverviewTableState({
	sessionCountLabel,
	sessions,
	totalSessionCount,
	userMap,
	onQueryChange,
	filterCatalog,
	filterCatalogPending,
	filterCatalogError,
	onRetryFilterCatalog,
	onFiltersChange,
}: {
	filterCatalog?: SessionFilterCatalog;
	filterCatalogPending?: boolean;
	filterCatalogError?: boolean;
	onRetryFilterCatalog?: () => void;
	onFiltersChange?: (filters: SessionListFilters) => void;
	onQueryChange?: () => void;
	sessionCountLabel: number;
	sessions: readonly SessionAnalytics[] | undefined;
	totalSessionCount: number;
	userMap: Record<string, string>;
}) {
	const demo = useDemoRuntime();
	const [sort, setSort] = useState<SessionSortState>({
		direction: "desc",
		key: "time",
	});
	const [excludedFilterValues, setExcludedFilterValues] =
		useState<SessionOverviewExcludedFilterValues>(createEmptyFilters);
	const [rangeFilterValues, setRangeFilterValues] =
		useState<SessionOverviewRangeFilterValues>(createEmptyRangeFilters);
	const [visibleRowCount, setVisibleRowCount] = useState(
		SESSION_ROW_BATCH_SIZE,
	);
	const recentSessions = sessions ?? EMPTY_SESSIONS;
	const loadedFilterOptions = useMemo(
		() => ({
			model: buildSessionOverviewFilterOptions(
				recentSessions,
				"model",
				userMap,
			),
			repository: buildSessionOverviewFilterOptions(
				recentSessions,
				"repository",
				userMap,
			),
			skills: buildSessionOverviewFilterOptions(
				recentSessions,
				"skills",
				userMap,
			),
			user: buildSessionOverviewFilterOptions(recentSessions, "user", userMap),
		}),
		[recentSessions, userMap],
	);
	const filterOptions = useMemo(() => {
		if (!filterCatalog) return loadedFilterOptions;
		const catalogOptions = buildCatalogOptions(filterCatalog, userMap);
		// Upload diagnostics can contain repositories/members absent from analytics.
		for (const key of SESSION_OVERVIEW_FILTER_KEYS) {
			const options = new Map(
				catalogOptions[key].map((option) => [option.value, option]),
			);
			for (const option of loadedFilterOptions[key]) {
				if (!options.has(option.value)) options.set(option.value, option);
			}
			catalogOptions[key] = [...options.values()].sort((a, b) =>
				compareSessionLabels(a.label, b.label),
			);
		}
		return catalogOptions;
	}, [filterCatalog, userMap, loadedFilterOptions]);
	const rangeFilterBounds = useMemo(
		() =>
			filterCatalog?.ranges ?? buildSessionOverviewRangeBounds(recentSessions),
		[filterCatalog, recentSessions],
	);
	useSessionListFilters(
		excludedFilterValues,
		rangeFilterValues,
		onFiltersChange,
	);
	const hasActiveFilters =
		SESSION_OVERVIEW_FILTER_KEYS.some(
			(filterKey) => excludedFilterValues[filterKey].size > 0,
		) ||
		SESSION_OVERVIEW_RANGE_FILTER_KEYS.some((filterKey) => {
			const range = rangeFilterValues[filterKey];
			return range.minimum !== null || range.maximum !== null;
		});
	const filteredSessions = useMemo(
		() =>
			recentSessions.filter(
				(session) =>
					matchesSessionOverviewFilters(session, excludedFilterValues) &&
					matchesSessionOverviewRangeFilters(session, rangeFilterValues),
			),
		[excludedFilterValues, rangeFilterValues, recentSessions],
	);
	const sortedSessions = useMemo(
		() =>
			[...filteredSessions].sort((leftSession, rightSession) => {
				const comparison = compareSessions(
					leftSession,
					rightSession,
					sort.key,
					userMap,
				);
				const directedComparison =
					sort.direction === "asc" ? comparison : -comparison;
				return (
					directedComparison ||
					compareSessionLabels(leftSession.session_id, rightSession.session_id)
				);
			}),
		[filteredSessions, sort.direction, sort.key, userMap],
	);
	const visibleSessions = sortedSessions.slice(0, visibleRowCount);
	const previewMaxima =
		demo &&
		!hasActiveFilters &&
		recentSessions.length === demo.seed.sessions.length &&
		recentSessions.every((session) =>
			demo.seed.sessions.some((seedSession) => seedSession === session),
		)
			? demo.seed.maxima
			: undefined;
	const maximumSessionTokens = useMemo(
		() =>
			previewMaxima?.tokens ??
			filteredSessions.reduce(
				(maximum, session) =>
					Math.max(maximum, session.input_tokens + session.output_tokens),
				0,
			),
		[filteredSessions, previewMaxima],
	);
	const maximumSessionCost = useMemo(
		() =>
			previewMaxima
				? previewMaxima.cost
				: filteredSessions.reduce((maximum, session) => {
						const sessionCost = getSessionOverviewCost(session);
						return sessionCost === null
							? maximum
							: Math.max(maximum, sessionCost);
					}, 0),
		[filteredSessions, previewMaxima],
	);
	const remainingLoadedSessionCount = Math.max(
		sortedSessions.length - visibleSessions.length,
		0,
	);
	const loadNextSessionBatch = useCallback(() => {
		setVisibleRowCount((count) =>
			Math.min(count + SESSION_ROW_BATCH_SIZE, sortedSessions.length),
		);
	}, [sortedSessions.length]);
	const resetVisibleRows = () => {
		setVisibleRowCount(SESSION_ROW_BATCH_SIZE);
		onQueryChange?.();
	};

	function handleSort(sortKey: SessionOverviewColumnKey) {
		resetVisibleRows();
		setSort((current) => ({
			direction:
				current.key === sortKey
					? current.direction === "asc"
						? "desc"
						: "asc"
					: getInitialSortDirection(sortKey),
			key: sortKey,
		}));
	}

	function setFilterOptionChecked(
		filterKey: SessionOverviewFilterKey,
		value: string,
		checked: boolean,
	) {
		setExcludedFilterValues((current) => {
			const next = new Set(current[filterKey]);
			if (checked) next.delete(value);
			else next.add(value);
			return { ...current, [filterKey]: next };
		});
		resetVisibleRows();
	}

	return {
		filterCatalogPending,
		filterCatalogError,
		onRetryFilterCatalog,
		activeSortLabel:
			SESSION_OVERVIEW_SORT_OPTIONS.find((option) => option.key === sort.key)
				?.label ??
			SESSION_OVERVIEW_COLUMNS.find((column) => column.key === sort.key)
				?.label ??
			"Date",
		clearAllFilters: () => {
			setExcludedFilterValues(createEmptyFilters());
			setRangeFilterValues(createEmptyRangeFilters());
			resetVisibleRows();
		},
		clearFilter: (filterKey: SessionOverviewFilterKey) => {
			setExcludedFilterValues((current) => ({
				...current,
				[filterKey]: new Set<string>(),
			}));
			resetVisibleRows();
		},
		clearRangeFilter: (filterKey: SessionOverviewRangeFilterKey) => {
			setRangeFilterValues((current) => ({
				...current,
				[filterKey]: { maximum: null, minimum: null },
			}));
			resetVisibleRows();
		},
		excludedFilterValues,
		filterOptions,
		filteredSessions,
		handleSort,
		hasActiveFilters,
		loadNextSessionBatch,
		maximumSessionCost,
		maximumSessionTokens,
		rangeFilterBounds,
		rangeFilterValues,
		recentSessions,
		remainingLoadedSessionCount,
		setFilterOptionChecked,
		setRangeFilter: (
			filterKey: SessionOverviewRangeFilterKey,
			value: SessionOverviewRangeFilter,
		) => {
			setRangeFilterValues((current) => ({
				...current,
				[filterKey]: value,
			}));
			resetVisibleRows();
		},
		sort,
		sortedSessions,
		changeSort: (nextSort: SessionSortState) => {
			resetVisibleRows();
			setSort(nextSort);
		},
		unloadedSessionCount: Math.max(
			totalSessionCount - recentSessions.length,
			0,
		),
		visibleSessionCountLabel: hasActiveFilters
			? filteredSessions.length
			: sessionCountLabel,
		visibleSessions,
	};
}

function buildCatalogOptions(
	catalog: SessionFilterCatalog,
	userMap: Record<string, string>,
) {
	const sort = (options: { value: string; label: string }[]) =>
		options.sort(
			(a, b) =>
				compareSessionLabels(a.label, b.label) ||
				compareSessionLabels(a.value, b.value),
		);
	const nameCounts = new Map<string, number>();
	for (const repo of catalog.repositories) {
		const name = repo.repoName ?? "No repository";
		nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
	}
	return {
		repository: sort(
			catalog.repositories.map((repo) => {
				const name = repo.repoName ?? "No repository";
				return {
					value: repo.repoKey,
					label:
						(nameCounts.get(name) ?? 0) > 1
							? `${name} (${repo.repoLabel})`
							: name,
				};
			}),
		),
		model: sort(catalog.models.map((value) => ({ value, label: value }))),
		user: sort(
			catalog.users.map((value) => ({
				value,
				label: formatUsername(value, userMap),
			})),
		),
		skills: sort(
			catalog.skills.map((value) => ({
				value,
				label: value === "__no_skills_used__" ? "No skills used" : value,
			})),
		),
	};
}
