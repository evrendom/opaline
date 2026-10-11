import type { HistoricalSkillSummary } from "@rudel/api-routes";
import {
	IconBook,
	IconFolder,
	IconGitBranch,
	IconMessages,
	IconUsers,
	IconZoomCancel,
} from "@tabler/icons-react";
import { memo, useMemo, useRef, useState } from "react";
import { Button } from "@/app/ui/button";
import { SearchInput } from "@/components/dashboard/data-table";
import {
	buildRangeBound,
	formatCount,
	isRangeFilterActive,
	matchesRangeFilter,
	OVERVIEW_METRIC_CELL_CLASS_NAME,
	OVERVIEW_METRIC_UNIT_CLASS_NAME,
	OVERVIEW_ROW_CLASS_NAME,
	OVERVIEW_ROW_LEAD_CELL_CLASS_NAME,
	OverviewList,
	OverviewMembers,
	OverviewRangeFiltersMenu,
	OverviewSkeleton,
	type RangeBound,
} from "@/components/overview-list";
import { SkillMark } from "@/components/skill-mark";
import { UsageStateMessage } from "@/components/usage-collection-view";
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
import { cn } from "@/lib/utils";

type SkillSortKey = "sessions" | "members" | "repos" | "versions" | "name";
type SkillSort = { key: SkillSortKey; direction: "asc" | "desc" };
type SkillRangeFilterKey = "sessions" | "members" | "repos";
type SkillRangeFilterValues = Record<
	SkillRangeFilterKey,
	SessionOverviewRangeFilter
>;

const SKILL_SORT_OPTIONS = [
	{ key: "sessions", label: "Sessions" },
	{ key: "members", label: "Members" },
	{ key: "repos", label: "Repos" },
	{ key: "versions", label: "Versions" },
	{ key: "name", label: "Name" },
] as const satisfies readonly { key: SkillSortKey; label: string }[];
const SKILL_FILTERS = [
	{ group: "activity", icon: IconMessages, key: "sessions", label: "Sessions" },
	{ group: "activity", icon: IconUsers, key: "members", label: "Members" },
	{ group: "usage", icon: IconFolder, key: "repos", label: "Repos" },
] as const satisfies readonly {
	group: "activity" | "usage";
	icon: unknown;
	key: SkillRangeFilterKey;
	label: string;
}[];
const EMPTY_RANGE_FILTERS: SkillRangeFilterValues = {
	sessions: { minimum: null, maximum: null },
	members: { minimum: null, maximum: null },
	repos: { minimum: null, maximum: null },
};
// Name over who uses the skill; sessions, repos and versions trail.
const SKILL_ROW_GRID_CLASS_NAME =
	"grid-cols-[minmax(240px,1fr)_112px_80px_96px_12px]";

/** The Skills page: every skill used in the workspace as a two-line row,
 * with the sessions page's search, sort and filter controls. */
export function SkillsPageView({
	skills,
	isError,
	isPending,
	onRetry,
	onSelectSkill,
}: {
	skills: readonly HistoricalSkillSummary[] | undefined;
	isError: boolean;
	isPending: boolean;
	onRetry: () => void;
	onSelectSkill: (name: string) => void;
}) {
	const { avatarMap, userMap } = useUserMap();
	const [search, setSearch] = useState("");
	const [sort, setSort] = useState<SkillSort>({
		key: "sessions",
		direction: "desc",
	});
	const [rangeFilters, setRangeFilters] =
		useState<SkillRangeFilterValues>(EMPTY_RANGE_FILTERS);
	const rangeBounds = useMemo(() => {
		const bound = (key: SkillRangeFilterKey) =>
			buildRangeBound(
				(skills ?? []).map((skill) => getSkillValue(skill, key)),
				1,
			);
		return {
			sessions: bound("sessions"),
			members: bound("members"),
			repos: bound("repos"),
		} satisfies Record<SkillRangeFilterKey, RangeBound>;
	}, [skills]);
	const hasActiveFilters = SKILL_FILTERS.some((filter) =>
		isRangeFilterActive(rangeFilters[filter.key]),
	);
	const visibleSkills = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		return (skills ?? [])
			.filter(
				(skill) =>
					(!query || skill.name.toLocaleLowerCase().includes(query)) &&
					SKILL_FILTERS.every((filter) =>
						matchesRangeFilter(
							getSkillValue(skill, filter.key),
							rangeFilters[filter.key],
						),
					),
			)
			.sort((left, right) => {
				const order = compareSkills(left, right, sort.key);
				return sort.direction === "asc" ? order : -order;
			});
	}, [skills, search, rangeFilters, sort]);
	const clearFilters = () => setRangeFilters(EMPTY_RANGE_FILTERS);

	return (
		<div
			className={cn(
				"dashboardy-page isolate antialiased",
				SESSION_OVERVIEW_SURFACE_CLASS_NAME,
			)}
		>
			<section
				aria-label="Skills"
				className="flex min-h-0 min-w-0 flex-1 flex-col"
			>
				{/* The sessions toolbar: search, sort and filter on 24px gutters. */}
				<div
					className="flex h-12 shrink-0 items-center gap-2 px-6"
					data-slot="skills-overview-toolbar"
				>
					<SearchInput
						value={search}
						onChange={setSearch}
						placeholder="Search skills…"
						label="Search skills"
					/>
					<ToolbarSortMenu
						activeSortLabel={
							SKILL_SORT_OPTIONS.find((option) => option.key === sort.key)
								?.label ?? "Sessions"
						}
						getInitialDirection={(key) => (key === "name" ? "asc" : "desc")}
						noun="skills"
						onSortChange={setSort}
						options={SKILL_SORT_OPTIONS}
						sort={sort}
					/>
					<OverviewRangeFiltersMenu
						bounds={rangeBounds}
						disabled={isPending || isError}
						filters={SKILL_FILTERS}
						formatValue={(_key, value) => value.toLocaleString()}
						noun="skills"
						values={rangeFilters}
						onChange={(key, value) =>
							setRangeFilters((previous) => ({ ...previous, [key]: value }))
						}
						onClearAll={clearFilters}
					/>
				</div>
				{isPending ? (
					<OverviewSkeleton
						gridClassName={SKILL_ROW_GRID_CLASS_NAME}
						label="Loading skills"
						metricWidths={["w-16", "w-10", "w-14"]}
					/>
				) : isError ? (
					<UsageStateMessage
						icon={<IconBook aria-hidden="true" />}
						title="Skills couldn’t be loaded"
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
				) : (skills?.length ?? 0) === 0 ? (
					<UsageStateMessage
						icon={<IconBook aria-hidden="true" />}
						title="No skills yet"
						description="Skills will appear here when Claude or Codex sessions include a recorded skill use."
					/>
				) : visibleSkills.length === 0 ? (
					<UsageStateMessage
						icon={<IconZoomCancel aria-hidden="true" />}
						title="No matching skills"
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
					<OverviewList label="Skills" minWidthClassName="min-w-[560px]">
						{(hover) =>
							visibleSkills.map((skill, index) => (
								<SkillRow
									key={skill.name}
									avatarMap={avatarMap}
									index={index}
									onSelect={onSelectSkill}
									registerItem={hover.registerItem}
									setActiveIndex={hover.setActiveIndex}
									skill={skill}
									userMap={userMap}
								/>
							))
						}
					</OverviewList>
				)}
			</section>
		</div>
	);
}

const SkillRow = memo(function SkillRow({
	avatarMap,
	index,
	onSelect,
	registerItem,
	setActiveIndex,
	skill,
	userMap,
}: {
	avatarMap: Record<string, string>;
	index: number;
	onSelect: (name: string) => void;
	registerItem: UseFluidHoverReturn["registerItem"];
	setActiveIndex: UseFluidHoverReturn["setActiveIndex"];
	skill: HistoricalSkillSummary;
	userMap: Record<string, string>;
}) {
	const itemRef = useRef<HTMLLIElement>(null);
	useRegisterFluidHoverItem(registerItem, index, itemRef);
	const attribution = skill.attribution;
	const topRepos = attribution?.topRepos ?? [];
	const repoCount = attribution?.repoCount ?? 0;

	return (
		<li ref={itemRef} className="relative z-10" data-skill-row>
			<button
				type="button"
				aria-label={`Open ${skill.name}`}
				onClick={() => onSelect(skill.name)}
				onFocus={() => setActiveIndex(index)}
				className={cn(
					OVERVIEW_ROW_CLASS_NAME,
					"cursor-pointer",
					SKILL_ROW_GRID_CLASS_NAME,
				)}
			>
				<div className={OVERVIEW_ROW_LEAD_CELL_CLASS_NAME}>
					<SkillMark skill={skill.name} />
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<p
							className="min-w-0 truncate text-base/5 font-medium text-(--session-overview-text) sm:text-sm/5"
							title={skill.name}
						>
							{skill.name}
						</p>
						<div className="flex min-w-0 items-center gap-1.5 text-xs/4 text-(--session-overview-muted)">
							<OverviewMembers
								avatarMap={avatarMap}
								topUserIds={(attribution?.topUsers ?? []).map(
									(user) => user.userId,
								)}
								userCount={attribution?.userCount ?? 0}
								userMap={userMap}
							/>
						</div>
					</div>
				</div>
				<div className={OVERVIEW_METRIC_CELL_CLASS_NAME}>
					<span>
						{skill.sessionCount.toLocaleString()}
						<span className={OVERVIEW_METRIC_UNIT_CLASS_NAME}>
							{skill.sessionCount === 1 ? " session" : " sessions"}
						</span>
					</span>
				</div>
				<div
					className={OVERVIEW_METRIC_CELL_CLASS_NAME}
					title={
						topRepos.length > 0
							? topRepos
									.map((repo) => `${repo.repoLabel} (${repo.sessionCount})`)
									.join(", ")
							: undefined
					}
				>
					<span>
						{repoCount.toLocaleString()}
						<span className={OVERVIEW_METRIC_UNIT_CLASS_NAME}>
							{repoCount === 1 ? " repo" : " repos"}
						</span>
					</span>
				</div>
				<div className={OVERVIEW_METRIC_CELL_CLASS_NAME}>
					{skill.versionCount === undefined ? (
						<span
							className={OVERVIEW_METRIC_UNIT_CLASS_NAME}
							title="This API doesn’t report skill versions yet"
						>
							—
						</span>
					) : (
						<span className="inline-flex items-center gap-1">
							<IconGitBranch
								aria-hidden="true"
								className="size-3 text-(--session-overview-subtle)"
							/>
							{formatCount(skill.versionCount, "version", "versions")}
						</span>
					)}
				</div>
				<div aria-hidden="true" />
			</button>
		</li>
	);
});

function getSkillValue(
	skill: HistoricalSkillSummary,
	key: SkillRangeFilterKey | "versions",
) {
	switch (key) {
		case "sessions":
			return skill.sessionCount;
		case "members":
			return skill.attribution?.userCount ?? 0;
		case "repos":
			return skill.attribution?.repoCount ?? 0;
		case "versions":
			return skill.versionCount ?? null;
	}
}

function compareSkills(
	left: HistoricalSkillSummary,
	right: HistoricalSkillSummary,
	key: SkillSortKey,
) {
	if (key === "name") {
		return left.name.localeCompare(right.name, undefined, {
			numeric: true,
			sensitivity: "base",
		});
	}
	const leftValue = getSkillValue(left, key);
	const rightValue = getSkillValue(right, key);
	// Skills without a version count sort below every counted one.
	if (leftValue === null) return rightValue === null ? 0 : -1;
	if (rightValue === null) return 1;
	return leftValue - rightValue;
}
