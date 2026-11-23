import type { HistoricalSkillSummary } from "@rudel/api-routes";
import {
	IconBook,
	IconFolder,
	IconMessages,
	IconUsers,
	IconZoomCancel,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Reveal } from "@/app/ui/bones";
import { Button } from "@/app/ui/button";
import { SearchInput } from "@/components/dashboard/data-table";
import { PageEmptyState } from "@/components/dashboard/page-parts";
import {
	buildRangeBound,
	isRangeFilterActive,
	matchesRangeFilter,
	OverviewRangeFiltersMenu,
	type RangeBound,
} from "@/components/overview-list";
import { RetryButton } from "@/components/retry-button";
import { ToolbarSortMenu } from "@/features/sessions/components/sessions-overview-sort-menu";
import {
	SESSION_OVERVIEW_SURFACE_CLASS_NAME,
	type SessionOverviewRangeFilter,
} from "@/features/sessions/components/sessions-overview-table-utils";
import { cn } from "@/lib/utils";
import { SkillCardsGrid } from "./skill-cards";

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
/** The Skills page: every skill used in the workspace as a card,
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
					className="flex h-12 shrink-0 items-center gap-m px-xxl"
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
				{!isPending && isError ? (
					<PageEmptyState
						icon={IconBook}
						title="Skills couldn’t be loaded"
						description="Your historical sessions are still available. Try loading this view again."
						action={<RetryButton className="h-8 gap-xs" onRetry={onRetry} />}
					/>
				) : !isPending && (skills?.length ?? 0) === 0 ? (
					<PageEmptyState
						icon={IconBook}
						title="No skills yet"
						description="Skills will appear here when Claude or Codex sessions include a recorded skill use."
					/>
				) : !isPending && visibleSkills.length === 0 ? (
					<PageEmptyState
						icon={IconZoomCancel}
						title="No matching skills"
						description={
							hasActiveFilters
								? "Try different filters or clear them."
								: "Try a different exact name or clear the search."
						}
						action={
							<Button
								type="button"
								size="md"
								variant="primary"
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
					<Reveal
						fill
						className="min-h-0 min-w-0 flex-1"
						label="Loading skills"
						loading={isPending}
						sample={<SkillCardsGrid skills={SAMPLE_SKILLS} onSelect={NOOP} />}
						sampleId="skills"
					>
						{() => (
							<SkillCardsGrid skills={visibleSkills} onSelect={onSelectSkill} />
						)}
					</Reveal>
				)}
			</section>
		</div>
	);
}

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

const NOOP = () => {};
const SAMPLE_SKILLS: HistoricalSkillSummary[] = [
	["dataviz", 3, 2, 2],
	["design", 34, 8, 9],
	["claude-api", 6, 3, 6],
	["release-notes", 5, 2, 5],
	["library-docs", 212, 51, 1],
	["typescript-standards", 365, 87, 2],
	["testing", 239, 68, 7],
	["database-best-practices", 87, 15, 5],
	["database-query", 76, 18, 4],
	["code-review", 6, 3, 1],
	["tdd", 3, 2, 2],
	["to-issues", 5, 4, 2],
	["to-prd", 3, 2, 2],
	["changelog", 2, 1, 1],
].map(([name, sessionCount, repoCount, versionCount]) => ({
	attribution: {
		repoCount: repoCount as number,
		topRepos: [],
		topUsers: [{ sessionCount: sessionCount as number, userId: "sample" }],
		userCount: 1,
	},
	claudeSessionCount: sessionCount as number,
	codexSessionCount: 0,
	contentPreview:
		"---\ndescription: What this skill teaches the agent and when it reaches for it.\n---",
	name: name as string,
	sessionCount: sessionCount as number,
	versionCount: versionCount as number,
}));
