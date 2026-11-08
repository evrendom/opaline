import type { RepositorySummary } from "@rudel/api-routes";
import {
	IconBook,
	IconCoin,
	IconMessages,
	IconStack2,
	IconUsers,
	IconZoomCancel,
} from "@tabler/icons-react";
import { memo, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bones } from "@/app/ui/bones";
import { Button } from "@/app/ui/button";
import { SearchInput } from "@/components/dashboard/data-table";
import {
	buildRangeBound,
	compactNumber,
	isRangeFilterActive,
	matchesRangeFilter,
	OVERVIEW_METRIC_CELL_CLASS_NAME,
	OVERVIEW_METRIC_UNIT_CLASS_NAME,
	OVERVIEW_ROW_CLASS_NAME,
	OVERVIEW_ROW_LEAD_CELL_CLASS_NAME,
	OverviewList,
	OverviewMembers,
	OverviewRangeFiltersMenu,
	type RangeBound,
} from "@/components/overview-list";
import { SkillMark } from "@/components/skill-mark";
import { UsageStateMessage } from "@/components/usage-collection-view";
import { formatCost } from "@/features/costs/cost-format";
import { ToolbarSortMenu } from "@/features/sessions/components/sessions-overview-sort-menu";
import {
	SESSION_OVERVIEW_SURFACE_CLASS_NAME,
	type SessionOverviewRangeFilter,
} from "@/features/sessions/components/sessions-overview-table-utils";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import {
	type UseFluidHoverReturn,
	useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { formatExactDateTime } from "@/lib/time-utils";
import { cn } from "@/lib/utils";

type RepoSortKey =
	| "recent"
	| "sessions"
	| "cost"
	| "tokens"
	| "members"
	| "name";
type RepoSort = { key: RepoSortKey; direction: "asc" | "desc" };
type RepoRangeFilterKey = "sessions" | "members" | "cost" | "tokens";
type RepoRangeFilterValues = Record<
	RepoRangeFilterKey,
	SessionOverviewRangeFilter
>;
type RepoRangeBounds = Record<RepoRangeFilterKey, RangeBound>;

const REPO_SORT_OPTIONS = [
	{ key: "sessions", label: "Sessions" },
	{ key: "recent", label: "Last active" },
	{ key: "cost", label: "Cost" },
	{ key: "tokens", label: "Tokens" },
	{ key: "members", label: "Members" },
	{ key: "name", label: "Name" },
] as const satisfies readonly { key: RepoSortKey; label: string }[];
const REPO_FILTERS = [
	{ group: "activity", icon: IconMessages, key: "sessions", label: "Sessions" },
	{ group: "activity", icon: IconUsers, key: "members", label: "Members" },
	{ group: "usage", icon: IconCoin, key: "cost", label: "Cost" },
	{ group: "usage", icon: IconStack2, key: "tokens", label: "Tokens" },
] as const satisfies readonly {
	group: "activity" | "usage";
	icon: unknown;
	key: RepoRangeFilterKey;
	label: string;
}[];
const EMPTY_RANGE_FILTERS: RepoRangeFilterValues = {
	sessions: { minimum: null, maximum: null },
	members: { minimum: null, maximum: null },
	cost: { minimum: null, maximum: null },
	tokens: { minimum: null, maximum: null },
};

// Name and signals over who works in the repo; sessions, tokens, cost and
// last activity trail.
const REPO_ROW_GRID_CLASS_NAME =
	"grid-cols-[minmax(240px,1fr)_112px_88px_88px_128px_12px]";

export function ReposOverview({
	repos,
	isError,
	isPending,
	onRetry,
	getRepoHref,
}: {
	repos: readonly RepositorySummary[] | undefined;
	isError: boolean;
	isPending: boolean;
	onRetry: () => void;
	getRepoHref: (repoKey: string) => string;
}) {
	const { avatarMap, userMap } = useUserMap();
	const [search, setSearch] = useState("");
	const [sort, setSort] = useState<RepoSort>({
		key: "sessions",
		direction: "desc",
	});
	const [rangeFilters, setRangeFilters] =
		useState<RepoRangeFilterValues>(EMPTY_RANGE_FILTERS);
	const rangeBounds = useMemo(() => buildRepoRangeBounds(repos ?? []), [repos]);
	const hasActiveFilters = REPO_FILTERS.some((filter) =>
		isRangeFilterActive(rangeFilters[filter.key]),
	);
	const visibleRepos = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		return (repos ?? [])
			.filter(
				(repo) =>
					(!query ||
						repo.identity.repoLabel.toLocaleLowerCase().includes(query)) &&
					REPO_FILTERS.every((filter) =>
						matchesRangeFilter(
							getRepoRangeValue(repo, filter.key),
							rangeFilters[filter.key],
						),
					),
			)
			.sort((left, right) => {
				const order = compareRepos(left, right, sort.key);
				return sort.direction === "asc" ? order : -order;
			});
	}, [repos, search, rangeFilters, sort]);
	const clearFilters = () => setRangeFilters(EMPTY_RANGE_FILTERS);

	return (
		<div
			className={cn(
				"dashboardy-page isolate antialiased",
				SESSION_OVERVIEW_SURFACE_CLASS_NAME,
			)}
		>
			<section
				aria-label="Repos"
				className="flex min-h-0 min-w-0 flex-1 flex-col"
			>
				{/* The sessions toolbar: search, sort and filter on 24px gutters. */}
				<div
					className="flex h-12 shrink-0 items-center gap-2 px-6"
					data-slot="repos-overview-toolbar"
				>
					<SearchInput
						value={search}
						onChange={setSearch}
						placeholder="Search repos…"
					/>
					<ToolbarSortMenu
						activeSortLabel={
							REPO_SORT_OPTIONS.find((option) => option.key === sort.key)
								?.label ?? "Sessions"
						}
						getInitialDirection={(key) => (key === "name" ? "asc" : "desc")}
						noun="repos"
						onSortChange={setSort}
						options={REPO_SORT_OPTIONS}
						sort={sort}
					/>
					<OverviewRangeFiltersMenu
						bounds={rangeBounds}
						disabled={isPending || isError}
						filters={REPO_FILTERS}
						formatValue={formatRepoRangeValue}
						noun="repos"
						values={rangeFilters}
						onChange={(key, value) =>
							setRangeFilters((previous) => ({ ...previous, [key]: value }))
						}
						onClearAll={clearFilters}
					/>
				</div>
				{isPending ? (
					<Bones fill className="min-h-0 min-w-0 flex-1" label="Loading repos">
						<ReposList
							avatarMap={NO_AVATARS}
							getRepoHref={sampleRepoHref}
							repos={SAMPLE_REPOS}
							userMap={SAMPLE_USERS}
						/>
					</Bones>
				) : isError ? (
					<UsageStateMessage
						icon={<IconBook aria-hidden="true" />}
						title="Repos couldn’t be loaded"
						description="Your historical sessions are still available. Try loading this view again."
						action={
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={onRetry}
							>
								Try again
							</Button>
						}
					/>
				) : (repos?.length ?? 0) === 0 ? (
					<UsageStateMessage
						icon={<IconBook aria-hidden="true" />}
						title="No repos yet"
						description="Repositories will appear here when sessions are uploaded."
					/>
				) : visibleRepos.length === 0 ? (
					<UsageStateMessage
						icon={<IconZoomCancel aria-hidden="true" />}
						title="No matching repos"
						description={
							hasActiveFilters
								? "Try different filters or clear them."
								: "Try a different exact name or clear the search."
						}
						action={
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() => {
									setSearch("");
									clearFilters();
								}}
							>
								{hasActiveFilters ? "Clear filters" : "Clear search"}
							</Button>
						}
					/>
				) : (
					<ReposList
						avatarMap={avatarMap}
						getRepoHref={getRepoHref}
						repos={visibleRepos}
						userMap={userMap}
					/>
				)}
			</section>
		</div>
	);
}

const NO_AVATARS: Record<string, string> = {};
const SAMPLE_USERS: Record<string, string> = { sample: "you" };
const sampleRepoHref = () => "#";
const SAMPLE_REPOS: RepositorySummary[] = [
	["web-app", 377, 16.5e9, 7618, [148, 44, 416]],
	["api-server", 377, 16.4e9, 16219, [396, 151, 192]],
	["mobile", 297, 8.6e9, null, [1351, 116, 54]],
	["design-system", 196, 3.7e9, 2884, [376, 32, 25]],
	["docs", 163, 3.9e9, 2564, [480, 60, 29]],
	["infra", 128, 13.8e9, 4330, [117, 63, 194]],
	["data-pipeline", 128, 6.8e9, 5301, [630, 60, 90]],
	["analytics", 87, 1.3e9, 559, [167, 32, 24]],
	["marketing-site", 50, 3.1e9, 1312, [268, 32, 11]],
	["cli", 44, 262e6, null, [408, 128, 2]],
	["sdk", 41, 829e6, 249, [180, 114, 13]],
	["browser-extension", 41, 700e6, 350, [70, 3, 1]],
	["playground", 30, 359e6, 306, [53, 3, 2]],
	["scripts", 22, 120e6, 98, [12, 1, 0]],
].map(([name, sessionCount, totalTokens, estimatedCost, signals]) => {
	const [userPositive, userNegative, modelApologies] = signals as number[];
	return {
		estimatedCost: estimatedCost as number | null,
		identity: {
			repoKey: `sample/${name}`,
			repoLabel: name as string,
			repoName: name as string,
			source: "remote" as const,
			worktree: null,
		},
		lastActiveAt: "2026-10-01T00:00:00.000Z",
		sessionCount: sessionCount as number,
		signals: { complete: true, modelApologies, userNegative, userPositive },
		topUsers: [{ sessionCount: sessionCount as number, userId: "sample" }],
		totalTokens: totalTokens as number,
		userCount: 1,
	};
});

function ReposList({
	avatarMap,
	getRepoHref,
	repos,
	userMap,
}: {
	avatarMap: Record<string, string>;
	getRepoHref: (repoKey: string) => string;
	repos: readonly RepositorySummary[];
	userMap: Record<string, string>;
}) {
	return (
		<OverviewList label="Repositories" minWidthClassName="min-w-[688px]">
			{(hover) =>
				repos.map((repo, index) => (
					<RepoRow
						key={repo.identity.repoKey}
						avatarMap={avatarMap}
						href={getRepoHref(repo.identity.repoKey)}
						index={index}
						registerItem={hover.registerItem}
						repo={repo}
						setActiveIndex={hover.setActiveIndex}
						userMap={userMap}
					/>
				))
			}
		</OverviewList>
	);
}

const RepoRow = memo(function RepoRow({
	avatarMap,
	href,
	index,
	registerItem,
	repo,
	setActiveIndex,
	userMap,
}: {
	avatarMap: Record<string, string>;
	href: string;
	index: number;
	registerItem: UseFluidHoverReturn["registerItem"];
	repo: RepositorySummary;
	setActiveIndex: UseFluidHoverReturn["setActiveIndex"];
	userMap: Record<string, string>;
}) {
	const itemRef = useRef<HTMLLIElement>(null);
	useRegisterFluidHoverItem(registerItem, index, itemRef);
	const { identity } = repo;

	return (
		<li ref={itemRef} className="relative z-10" data-repo-row>
			<Link
				to={href}
				aria-label={`Open ${identity.repoLabel}`}
				onFocus={() => setActiveIndex(index)}
				className={cn(OVERVIEW_ROW_CLASS_NAME, REPO_ROW_GRID_CLASS_NAME)}
			>
				<div className={OVERVIEW_ROW_LEAD_CELL_CLASS_NAME}>
					<SkillMark skill={identity.repoLabel} emoji="📂" />
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<div className="flex min-w-0 items-center gap-2">
							<p
								className="min-w-0 truncate text-base/5 font-medium text-(--session-overview-text) sm:text-sm/5"
								title={identity.repoLabel}
							>
								{identity.repoLabel}
							</p>
							<RepoSignals repo={repo} />
						</div>
						<div className="flex min-w-0 items-center gap-1.5 text-xs/4 text-(--session-overview-muted)">
							<OverviewMembers
								avatarMap={avatarMap}
								topUserIds={repo.topUsers.map((user) => user.userId)}
								userCount={repo.userCount}
								userMap={userMap}
							/>
						</div>
					</div>
				</div>
				<div className={OVERVIEW_METRIC_CELL_CLASS_NAME}>
					<span>
						{repo.sessionCount.toLocaleString()}
						<span className={OVERVIEW_METRIC_UNIT_CLASS_NAME}>
							{repo.sessionCount === 1 ? " session" : " sessions"}
						</span>
					</span>
				</div>
				<div
					className={OVERVIEW_METRIC_CELL_CLASS_NAME}
					title={`${repo.totalTokens.toLocaleString()} tokens`}
				>
					<span>
						{compactNumber.format(repo.totalTokens)}
						<span className={OVERVIEW_METRIC_UNIT_CLASS_NAME}> tok</span>
					</span>
				</div>
				<div
					className={cn(
						OVERVIEW_METRIC_CELL_CLASS_NAME,
						"font-medium text-(--session-overview-text)",
					)}
					title={
						repo.estimatedCost === null
							? "Some sessions have unpriced usage"
							: "Estimated token cost (USD)"
					}
				>
					{repo.estimatedCost === null ? "—" : formatCost(repo.estimatedCost)}
				</div>
				<div className={OVERVIEW_METRIC_CELL_CLASS_NAME}>
					{repo.lastActiveAt ? (
						<RepoLastActive lastActiveAt={repo.lastActiveAt} />
					) : (
						<span
							className={OVERVIEW_METRIC_UNIT_CLASS_NAME}
							title={
								repo.lastActiveAt === undefined
									? "This API doesn’t report when a repo was last active yet"
									: "No recorded activity"
							}
						>
							—
						</span>
					)}
				</div>
				<div aria-hidden="true" />
			</Link>
		</li>
	);
});

// Only the signals a repo actually has; an all-quiet repo shows none.
export function RepoSignals({ repo }: { repo: RepositorySummary }) {
	const signals = [
		{
			count: repo.signals.userNegative,
			label: "negative",
			title: "Negative user signals",
			color:
				"bg-[#ffe4e6] text-[#be123c] dark:bg-[#411b25] dark:text-[#fda4af]",
		},
		{
			count: repo.signals.modelApologies,
			label: "apologies",
			title: "Model apologies",
			color:
				"bg-[#fef3c7] text-[#b45309] dark:bg-[#40321b] dark:text-[#fcd34d]",
		},
	].filter((signal) => signal.count > 0);
	if (signals.length === 0) return null;
	return (
		<ul
			aria-label="Frustrations"
			className="flex min-w-0 shrink list-none items-center gap-1 overflow-hidden"
		>
			{signals.map((signal) => (
				<li
					key={signal.label}
					title={signal.title}
					className={cn(
						"shrink-0 rounded-sm px-1.5 py-0.5 text-[0.625rem]/3 whitespace-nowrap",
						signal.color,
					)}
				>
					<span className="tabular-nums">{signal.count.toLocaleString()}</span>{" "}
					{signal.label}
				</li>
			))}
		</ul>
	);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// When the repo last saw a session: a pulsing dot while that's single-digit
// minutes ago, a steady one through the week, then grey.
function RepoLastActive({ lastActiveAt }: { lastActiveAt: string }) {
	const elapsedMs = Math.max(0, Date.now() - Date.parse(lastActiveAt));
	const recency =
		elapsedMs < 10 * MINUTE_MS
			? "now"
			: elapsedMs < 7 * DAY_MS
				? "week"
				: "older";
	return (
		<span
			className="inline-flex min-w-0 items-center gap-2"
			title={`Last active ${formatExactDateTime(lastActiveAt)}`}
			data-repo-last-active={recency}
		>
			<span aria-hidden="true" className="relative flex size-1.5 shrink-0">
				{recency === "now" ? (
					<span className="absolute inset-0 animate-ping rounded-full bg-[#22c55e] opacity-60 motion-reduce:animate-none" />
				) : null}
				<span
					className={cn(
						"relative size-1.5 rounded-full",
						recency === "older"
							? "bg-black/20 dark:bg-white/25"
							: "bg-[#22c55e]",
					)}
				/>
			</span>
			<time dateTime={lastActiveAt} className="truncate">
				{formatTimeAgo(elapsedMs)}
			</time>
		</span>
	);
}

/** Elapsed time in short units: "4m ago", "3h ago", "2d ago", then months
 * and years as "2mo ago" and "1y ago". */
export function formatTimeAgo(elapsedMs: number) {
	const ago = (value: number, unit: string) =>
		`${Math.floor(value).toLocaleString()}${unit} ago`;
	if (elapsedMs < MINUTE_MS) return "just now";
	if (elapsedMs < HOUR_MS) return ago(elapsedMs / MINUTE_MS, "m");
	if (elapsedMs < DAY_MS) return ago(elapsedMs / HOUR_MS, "h");
	if (elapsedMs < 30 * DAY_MS) return ago(elapsedMs / DAY_MS, "d");
	if (elapsedMs < 365 * DAY_MS) return ago(elapsedMs / (30 * DAY_MS), "mo");
	return ago(elapsedMs / (365 * DAY_MS), "y");
}

function getRepoRangeValue(repo: RepositorySummary, key: RepoRangeFilterKey) {
	switch (key) {
		case "sessions":
			return repo.sessionCount;
		case "members":
			return repo.userCount;
		case "cost":
			return repo.estimatedCost;
		case "tokens":
			return repo.totalTokens;
	}
}

function compareRepos(
	left: RepositorySummary,
	right: RepositorySummary,
	key: RepoSortKey,
) {
	if (key === "recent") {
		// Repos with no recorded interaction sort as oldest.
		return (
			(Date.parse(left.lastActiveAt ?? "") || 0) -
			(Date.parse(right.lastActiveAt ?? "") || 0)
		);
	}
	if (key === "name") {
		return left.identity.repoLabel.localeCompare(
			right.identity.repoLabel,
			undefined,
			{ numeric: true, sensitivity: "base" },
		);
	}
	const leftValue = getRepoRangeValue(left, key);
	const rightValue = getRepoRangeValue(right, key);
	// Unpriced repos sort below every priced one.
	if (leftValue === null) return rightValue === null ? 0 : -1;
	if (rightValue === null) return 1;
	return leftValue - rightValue;
}

function buildRepoRangeBounds(
	repos: readonly RepositorySummary[],
): RepoRangeBounds {
	const bound = (key: RepoRangeFilterKey) =>
		buildRangeBound(
			repos.map((repo) => getRepoRangeValue(repo, key)),
			key === "cost" ? 0.01 : 1,
		);
	return {
		sessions: bound("sessions"),
		members: bound("members"),
		cost: bound("cost"),
		tokens: bound("tokens"),
	};
}

function formatRepoRangeValue(key: RepoRangeFilterKey, value: number) {
	switch (key) {
		case "cost":
			return formatCost(value);
		case "tokens":
			return compactNumber.format(value);
		default:
			return value.toLocaleString();
	}
}
