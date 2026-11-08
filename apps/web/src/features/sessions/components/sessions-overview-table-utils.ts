import {
	type RepoIdentity,
	resolveRepoIdentity,
	type SessionAnalytics,
} from "@rudel/api-routes";
import {
	resolveSessionErrorCount,
	resolveSessionSubagentCount,
} from "@/features/sessions/components/session-overview-metrics";
import { isLiveOnlySessionRow } from "@/features/sessions/live-session-rows";
import { getSessionTimestamp } from "@/features/sessions/session-ordering";
import { calculateCost, formatUsername } from "@/lib/format";

// One-line table rows: 48px (8px of air around a 32px line).
export const SESSION_OVERVIEW_ROW_HEIGHT = 48;
// The sticky header (and toolbar) above the rows; the virtual list offsets
// its rows by it. Keep in step with the header's h-12.
export const SESSION_OVERVIEW_HEADER_HEIGHT = 48;

// Toolbar button (see .toolbar-button in preset-extensions.css).
export const SESSION_OVERVIEW_MENU_TRIGGER_CLASS_NAME = "toolbar-button";

export const SESSION_OVERVIEW_SURFACE_CLASS_NAME =
	"flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--session-overview-surface) font-sans [--session-overview-accent:#266df0] [--session-overview-border:#eeeff1] [--session-overview-hover:#f6f7f7] [--session-overview-muted:rgba(0,0,0,0.63)] [--session-overview-subtle:rgba(0,0,0,0.5)] [--session-overview-surface:#fcfcfc] [--session-overview-text:#101112] dark:[--session-overview-border:rgba(255,255,255,0.08)] dark:[--session-overview-hover:rgba(255,255,255,0.05)] dark:[--session-overview-muted:rgba(255,255,255,0.65)] dark:[--session-overview-subtle:rgba(255,255,255,0.5)] dark:[--session-overview-surface:var(--background)] dark:[--session-overview-text:#e6e6e9]";

// Reuse the former branch track's minimum width for the inline model/repo/branch.
// Give the inline names 55% of spare width (up to 960px); Skills gets the rest.
// Keep skills before the trailing 240px member track for language signals and avatar.
// Split the former 112px metadata track into cost at the start and date at the end.
// The empty trailing track provides breathing room without raising the table minimum width.
export const SESSION_OVERVIEW_GRID_CLASS_NAME =
	"grid-cols-[56px_clamp(460px,calc(460px_+_(100cqw_-_1112px)_*_0.55),960px)_minmax(284px,1fr)_240px_56px_minmax(0,16px)]";
export const SESSION_OVERVIEW_GRID_WITHOUT_SKILLS_CLASS_NAME =
	"grid-cols-[56px_minmax(460px,1fr)_240px_56px_minmax(0,16px)]";
export const SESSION_OVERVIEW_MIN_WIDTH_CLASS_NAME = "min-w-[1096px]";
export const SESSION_OVERVIEW_COLUMNS = [
	{ align: "left", key: "cost", label: "API Cost" },
	{ align: "left", key: "model", label: "Model" },
	{ align: "left", key: "tokens", label: "Input / Output" },
	{ align: "left", key: "skills", label: "Skills" },
	{ align: "right", key: "user", label: "Member" },
	{ align: "right", key: "time", label: "Date" },
	{ align: "left", key: "repository", label: "Repository" },
	{ align: "left", key: "signals", label: "Signals" },
	{ align: "left", key: "input", label: "Input" },
	{ align: "left", key: "output", label: "Output" },
	{ align: "left", key: "errors", label: "Errors" },
	{ align: "left", key: "subagents", label: "Subagents" },
] as const;

export const SESSION_OVERVIEW_VISIBLE_COLUMNS = SESSION_OVERVIEW_COLUMNS.filter(
	(column) =>
		column.key !== "input" &&
		column.key !== "output" &&
		column.key !== "tokens" &&
		column.key !== "repository" &&
		column.key !== "signals" &&
		column.key !== "subagents" &&
		column.key !== "errors",
);

export type SessionOverviewColumnKey =
	(typeof SESSION_OVERVIEW_COLUMNS)[number]["key"];
export type SessionOverviewSortKey =
	| SessionOverviewColumnKey
	| "duration"
	| "messages";
export const SESSION_OVERVIEW_SORT_OPTIONS = [
	{ key: "time", label: "Date" },
	{ key: "cost", label: "Cost" },
	{ key: "tokens", label: "Tokens" },
	{ key: "skills", label: "Skills" },
	{ key: "errors", label: "Errors" },
	{ key: "duration", label: "Length" },
	{ key: "messages", label: "Messages" },
	{ key: "signals", label: "Frustrations" },
] as const satisfies readonly { key: SessionOverviewSortKey; label: string }[];
export const SESSION_OVERVIEW_FILTER_KEYS = [
	"repository",
	"user",
	"model",
	"skills",
] as const;
export type SessionOverviewFilterKey =
	(typeof SESSION_OVERVIEW_FILTER_KEYS)[number];
export const SESSION_OVERVIEW_RANGE_FILTER_KEYS = [
	"input",
	"output",
	"cost",
	"subagents",
	"errors",
	"duration",
] as const;
export type SessionOverviewRangeFilterKey =
	(typeof SESSION_OVERVIEW_RANGE_FILTER_KEYS)[number];
export type SessionOverviewRangeFilter = {
	minimum: number | null;
	maximum: number | null;
};
export type SessionOverviewRangeFilterValues = Record<
	SessionOverviewRangeFilterKey,
	SessionOverviewRangeFilter
>;
export type SessionOverviewRangeBounds = Record<
	SessionOverviewRangeFilterKey,
	{
		minimum: number;
		maximum: number;
		step: number;
	}
>;
export type SessionOverviewFilterOption = {
	label: string;
	value: string;
};
export type SessionOverviewExcludedFilterValues = Record<
	SessionOverviewFilterKey,
	ReadonlySet<string>
>;
export const SESSION_OVERVIEW_NO_SKILLS_FILTER_VALUE = "__no_skills_used__";
type SortDirection = "asc" | "desc";
export type SessionSortState = {
	key: SessionOverviewSortKey;
	direction: SortDirection;
};

export function getSessionOverviewCost(
	session: SessionAnalytics,
): number | null {
	if (session.upload_failure || isLiveOnlySessionRow(session)) return null;
	if (session.estimated_cost !== undefined) {
		return session.estimated_cost;
	}

	return calculateCost(session.input_tokens, session.output_tokens, {
		at: session.session_date,
		model: session.model_used,
	});
}

export function buildSessionOverviewFilterOptions(
	sessions: readonly SessionAnalytics[],
	filterKey: SessionOverviewFilterKey,
	userMap: Record<string, string>,
) {
	const labelsByValue = new Map<string, string>();
	const repositoryLabelsByValue = new Map<string, string>();

	for (const session of sessions) {
		const values = getSessionOverviewFilterValues(session, filterKey);
		for (const value of values) {
			labelsByValue.set(
				value,
				getSessionOverviewFilterLabel(session, filterKey, value, userMap),
			);
			if (filterKey === "repository") {
				repositoryLabelsByValue.set(
					value,
					getSessionRepositoryIdentity(session).repoLabel,
				);
			}
		}
	}

	const options = [...labelsByValue.entries()].map(
		([value, label]): SessionOverviewFilterOption => ({ label, value }),
	);
	const labelCounts = new Map<string, number>();
	for (const option of options) {
		labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1);
	}

	return options
		.map((option) =>
			filterKey === "repository" && (labelCounts.get(option.label) ?? 0) > 1
				? {
						...option,
						label: `${option.label} (${repositoryLabelsByValue.get(option.value)})`,
					}
				: option,
		)
		.sort(
			(leftOption, rightOption) =>
				compareSessionLabels(leftOption.label, rightOption.label) ||
				compareSessionLabels(leftOption.value, rightOption.value),
		);
}

export function matchesSessionOverviewFilters(
	session: SessionAnalytics,
	excludedFilterValues: SessionOverviewExcludedFilterValues,
) {
	return SESSION_OVERVIEW_FILTER_KEYS.every((filterKey) =>
		getSessionOverviewFilterValues(session, filterKey).every(
			(value) => !excludedFilterValues[filterKey].has(value),
		),
	);
}

export function buildSessionOverviewRangeBounds(
	sessions: readonly SessionAnalytics[],
): SessionOverviewRangeBounds {
	return {
		cost: buildSessionOverviewRangeBound(sessions, "cost"),
		duration: buildSessionOverviewRangeBound(sessions, "duration"),
		errors: buildSessionOverviewRangeBound(sessions, "errors"),
		input: buildSessionOverviewRangeBound(sessions, "input"),
		output: buildSessionOverviewRangeBound(sessions, "output"),
		subagents: buildSessionOverviewRangeBound(sessions, "subagents"),
	};
}

export function matchesSessionOverviewRangeFilters(
	session: SessionAnalytics,
	rangeFilterValues: SessionOverviewRangeFilterValues,
) {
	return SESSION_OVERVIEW_RANGE_FILTER_KEYS.every((filterKey) => {
		const range = rangeFilterValues[filterKey];
		const value = getSessionOverviewRangeValue(session, filterKey);
		if (value === null) {
			return range.minimum === null && range.maximum === null;
		}

		return (
			(range.minimum === null || value >= range.minimum) &&
			(range.maximum === null || value <= range.maximum)
		);
	});
}

export function compareSessions(
	leftSession: SessionAnalytics,
	rightSession: SessionAnalytics,
	sortKey: SessionOverviewSortKey,
	userMap: Record<string, string>,
) {
	switch (sortKey) {
		case "user":
			return compareSessionLabels(
				formatUsername(leftSession.user_id, userMap),
				formatUsername(rightSession.user_id, userMap),
			);
		case "repository":
			return compareSessionLabels(
				getRepositoryLabel(leftSession),
				getRepositoryLabel(rightSession),
			);
		case "model":
			return compareSessionLabels(
				leftSession.model_used,
				rightSession.model_used,
			);
		case "signals":
			return (
				getSessionLanguageSignalCount(leftSession) -
				getSessionLanguageSignalCount(rightSession)
			);
		case "skills":
			return leftSession.skills.length - rightSession.skills.length;
		case "subagents":
			return (
				resolveSessionSubagentCount(
					leftSession.subagent_count,
					leftSession.subagent_types,
					leftSession.linked_subagent_count,
					leftSession.linked_subagents,
				) -
				resolveSessionSubagentCount(
					rightSession.subagent_count,
					rightSession.subagent_types,
					rightSession.linked_subagent_count,
					rightSession.linked_subagents,
				)
			);
		case "tokens":
			return (
				leftSession.input_tokens +
				leftSession.output_tokens -
				(rightSession.input_tokens + rightSession.output_tokens)
			);
		case "input":
			return leftSession.input_tokens - rightSession.input_tokens;
		case "output":
			return leftSession.output_tokens - rightSession.output_tokens;
		case "duration":
			return leftSession.duration_min - rightSession.duration_min;
		case "messages":
			return leftSession.total_interactions - rightSession.total_interactions;
		case "cost":
			return compareNullableNumbers(
				getSessionOverviewCost(leftSession),
				getSessionOverviewCost(rightSession),
			);
		case "errors":
			return compareNullableNumbers(
				resolveSessionErrorCount(leftSession.error_count),
				resolveSessionErrorCount(rightSession.error_count),
			);
		case "time":
			return (
				getSessionTimestamp(leftSession.session_date).getTime() -
				getSessionTimestamp(rightSession.session_date).getTime()
			);
	}
}

export function getInitialSortDirection(
	sortKey: SessionOverviewSortKey,
): SortDirection {
	switch (sortKey) {
		case "skills":
		case "signals":
		case "subagents":
		case "input":
		case "tokens":
		case "output":
		case "cost":
		case "errors":
		case "time":
		case "duration":
		case "messages":
			return "desc";
		default:
			return "asc";
	}
}

function getSessionLanguageSignalCount(session: SessionAnalytics) {
	return (
		session.member_swears +
		session.member_apologies +
		session.model_swears +
		session.model_apologies
	);
}

export function getRepositoryLabel(session: SessionAnalytics) {
	return getSessionRepositoryIdentity(session).repoName ?? "No repository";
}

export function getSessionBranchLabel(session: SessionAnalytics) {
	const branch = session.git_branch?.trim().replace(/^refs\/heads\//, "");
	if (!branch) {
		return null;
	}

	const repositoryName = getSessionRepositoryIdentity(session).repoName;
	if (!repositoryName) {
		return branch;
	}

	const repositoryNames = [
		repositoryName,
		repositoryName.replace(/[-_.]?v\d+$/i, ""),
	].filter((name, index, names) => name && names.indexOf(name) === index);
	const matchingRepositoryName = repositoryNames.find((name) =>
		branch.toLowerCase().startsWith(`${name.toLowerCase()}/`),
	);

	return matchingRepositoryName
		? branch.slice(matchingRepositoryName.length + 1)
		: branch;
}

function getSessionOverviewFilterValues(
	session: SessionAnalytics,
	filterKey: SessionOverviewFilterKey,
) {
	switch (filterKey) {
		case "repository":
			return [getSessionRepositoryIdentity(session).repoKey];
		case "user":
			return [session.user_id];
		case "model":
			return [session.model_used];
		case "skills":
			return session.skills.length > 0
				? session.skills
				: [SESSION_OVERVIEW_NO_SKILLS_FILTER_VALUE];
	}
}

function getSessionRepositoryIdentity(session: SessionAnalytics): RepoIdentity {
	const legacySession = session as SessionAnalytics & {
		repository_identity?: RepoIdentity;
	};
	return (
		legacySession.repository_identity ??
		resolveRepoIdentity({
			gitRemote: session.git_remote ?? null,
			packageName: session.repository,
			projectPath: session.project_path,
		})
	);
}

function getSessionOverviewFilterLabel(
	session: SessionAnalytics,
	filterKey: SessionOverviewFilterKey,
	value: string,
	userMap: Record<string, string>,
) {
	switch (filterKey) {
		case "repository":
			return getRepositoryLabel(session);
		case "user":
			return formatUsername(session.user_id, userMap);
		case "model":
			return session.model_used || "Model unavailable";
		case "skills":
			return value === SESSION_OVERVIEW_NO_SKILLS_FILTER_VALUE
				? "No skills used"
				: value;
	}
}

function buildSessionOverviewRangeBound(
	sessions: readonly SessionAnalytics[],
	filterKey: SessionOverviewRangeFilterKey,
) {
	if (sessions.length === 0) {
		return {
			minimum: 0,
			maximum: 0,
			step: getSessionOverviewRangeStep(filterKey),
		};
	}

	let minimum = Number.POSITIVE_INFINITY;
	let maximum = Number.NEGATIVE_INFINITY;
	let hasKnownValue = false;

	for (const session of sessions) {
		const value = getSessionOverviewRangeValue(session, filterKey);
		if (value === null) {
			continue;
		}
		hasKnownValue = true;
		minimum = Math.min(minimum, value);
		maximum = Math.max(maximum, value);
	}
	const step = getSessionOverviewRangeStep(filterKey);
	if (!hasKnownValue) {
		return { maximum: 0, minimum: 0, step };
	}

	return {
		minimum: normalizeRangeBoundary(minimum, step, "minimum"),
		maximum: normalizeRangeBoundary(maximum, step, "maximum"),
		step,
	};
}

function getSessionOverviewRangeValue(
	session: SessionAnalytics,
	filterKey: SessionOverviewRangeFilterKey,
) {
	if (session.upload_failure || isLiveOnlySessionRow(session)) return null;
	switch (filterKey) {
		case "input":
			return session.input_tokens;
		case "output":
			return session.output_tokens;
		case "cost":
			return getSessionOverviewCost(session);
		case "subagents":
			return resolveSessionSubagentCount(
				session.subagent_count,
				session.subagent_types,
				session.linked_subagent_count,
				session.linked_subagents,
			);
		case "errors":
			return resolveSessionErrorCount(session.error_count);
		case "duration":
			return session.duration_min;
	}
}

function getSessionOverviewRangeStep(filterKey: SessionOverviewRangeFilterKey) {
	switch (filterKey) {
		case "cost":
			return 0.0001;
		case "duration":
			return 0.1;
		default:
			return 1;
	}
}

function normalizeRangeBoundary(
	value: number,
	step: number,
	direction: "minimum" | "maximum",
) {
	const scaledValue = value / step;
	const normalizedValue =
		direction === "minimum"
			? Math.floor(scaledValue) * step
			: Math.ceil(scaledValue) * step;
	const precision = Math.max(0, Math.ceil(-Math.log10(step)));

	return Number(normalizedValue.toFixed(precision));
}

function compareNullableNumbers(
	leftValue: number | null,
	rightValue: number | null,
) {
	if (leftValue === null) {
		return rightValue === null ? 0 : -1;
	}
	if (rightValue === null) {
		return 1;
	}

	return leftValue - rightValue;
}

export function compareSessionLabels(leftValue: string, rightValue: string) {
	return leftValue.localeCompare(rightValue, undefined, {
		numeric: true,
		sensitivity: "base",
	});
}
