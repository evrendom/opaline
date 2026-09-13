import type { HistoricalSkillSummary } from "@rudel/api-routes";
import {
	BookOpenIcon,
	ChevronRightIcon,
	LayoutGridIcon,
	ListIcon,
	SearchIcon,
	SearchXIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/app/ui/button";
import { Skeleton } from "@/app/ui/skeleton";
import { useShellHeaderPortal } from "@/features/shell/shell-header-portal";
import { RichSkillDocument } from "@/features/skills/components/rich-skill-document";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";

interface SkillsPageViewProps {
	skills: readonly HistoricalSkillSummary[] | undefined;
	isError: boolean;
	isPending: boolean;
	onRetry: () => void;
	onSelectSkill: (name: string) => void;
}

type SkillsLayout = "grid" | "list";
type SkillAttribution = NonNullable<HistoricalSkillSummary["attribution"]>;

export function SkillsPageView({
	skills,
	isError,
	isPending,
	onRetry,
	onSelectSkill,
}: SkillsPageViewProps) {
	const { userMap } = useUserMap();
	const [layout, setLayout] = useState<SkillsLayout>("grid");
	const [search, setSearch] = useState("");
	const filteredSkills = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		if (!query) {
			return skills ?? [];
		}

		return (skills ?? []).filter((skill) =>
			skill.name.toLocaleLowerCase().includes(query),
		);
	}, [search, skills]);

	return (
		<div className="dashboardy-page flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[color:var(--dashboardy-surface-opaque)]">
			<section
				aria-label="Skills"
				className="flex min-h-0 min-w-0 flex-1 flex-col"
			>
				<SkillsHeader
					layout={layout}
					search={search}
					onLayoutChange={setLayout}
					onSearchChange={setSearch}
				/>

				<SkillsCollectionState
					filteredSkills={filteredSkills}
					hasSearch={search.trim().length > 0}
					isError={isError}
					isPending={isPending}
					layout={layout}
					skillCount={skills?.length ?? 0}
					userMap={userMap}
					onClearSearch={() => setSearch("")}
					onRetry={onRetry}
					onSelectSkill={onSelectSkill}
				/>
			</section>
		</div>
	);
}

function SkillsHeader({
	layout,
	search,
	onLayoutChange,
	onSearchChange,
}: {
	layout: SkillsLayout;
	search: string;
	onLayoutChange: (layout: SkillsLayout) => void;
	onSearchChange: (search: string) => void;
}) {
	const shellHeaderPortal = useShellHeaderPortal();
	if (!shellHeaderPortal) {
		return null;
	}

	return createPortal(
		<div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
			<div className="relative min-w-0 max-w-56 flex-1 sm:flex-none">
				<label className="sr-only" htmlFor="skill-search">
					Search skills
				</label>
				<SearchIcon
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 stroke-[color:var(--dashboardy-muted)]"
				/>
				<input
					id="skill-search"
					name="skill-search"
					type="search"
					value={search}
					onChange={(event) => onSearchChange(event.currentTarget.value)}
					placeholder="Search skills"
					className="h-8 w-full rounded-lg border border-black/8 bg-black/[0.025] py-1 pr-2.5 pl-8 text-sm text-[color:var(--dashboardy-heading)] outline-none transition-colors placeholder:text-[color:var(--dashboardy-subtle)] hover:bg-black/[0.04] focus-visible:border-transparent focus-visible:bg-[color:var(--dashboardy-surface-opaque)] focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[color:var(--dashboard-01-metric-button-focus-ring)] dark:border-white/10 dark:bg-white/[0.045] dark:hover:bg-white/[0.07]"
				/>
			</div>

			<fieldset className="flex shrink-0 items-center rounded-lg border border-black/8 bg-black/[0.025] p-0.5 dark:border-white/10 dark:bg-white/[0.045]">
				<legend className="sr-only">Skills layout</legend>
				<LayoutButton
					isActive={layout === "grid"}
					label="Grid view"
					onClick={() => onLayoutChange("grid")}
				>
					<LayoutGridIcon aria-hidden="true" />
				</LayoutButton>
				<LayoutButton
					isActive={layout === "list"}
					label="List view"
					onClick={() => onLayoutChange("list")}
				>
					<ListIcon aria-hidden="true" />
				</LayoutButton>
			</fieldset>
		</div>,
		shellHeaderPortal,
	);
}

function LayoutButton({
	children,
	isActive,
	label,
	onClick,
}: {
	children: ReactNode;
	isActive: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={isActive}
			onClick={onClick}
			className={`flex size-7 items-center justify-center rounded-md outline-none transition-[background-color,color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--dashboard-01-metric-button-focus-ring)] [&_svg]:size-3.5 ${
				isActive
					? "bg-[color:var(--dashboardy-surface-opaque)] text-[color:var(--dashboardy-heading)] shadow-[0_1px_3px_rgb(0_0_0/0.12)] dark:bg-white/10"
					: "text-[color:var(--dashboardy-muted)] hover:bg-black/4 hover:text-[color:var(--dashboardy-heading)] dark:hover:bg-white/8"
			}`}
		>
			{children}
		</button>
	);
}

function SkillsCollectionState({
	filteredSkills,
	hasSearch,
	isError,
	isPending,
	layout,
	skillCount,
	userMap,
	onClearSearch,
	onRetry,
	onSelectSkill,
}: {
	filteredSkills: readonly HistoricalSkillSummary[];
	hasSearch: boolean;
	isError: boolean;
	isPending: boolean;
	layout: SkillsLayout;
	skillCount: number;
	userMap: Record<string, string>;
	onClearSearch: () => void;
	onRetry: () => void;
	onSelectSkill: (name: string) => void;
}) {
	if (isPending) {
		return <SkillsCollectionSkeleton />;
	}

	if (isError) {
		return (
			<SkillsStateMessage
				icon={<BookOpenIcon aria-hidden="true" />}
				title="Skills couldn’t be loaded"
				description="Your historical sessions are still available. Try loading this view again."
				action={
					<Button type="button" size="sm" variant="outline" onClick={onRetry}>
						Try again
					</Button>
				}
			/>
		);
	}

	if (skillCount === 0) {
		return (
			<SkillsStateMessage
				icon={<BookOpenIcon aria-hidden="true" />}
				title="No skills yet"
				description="Skills will appear here when Claude or Codex sessions include a recorded skill use."
			/>
		);
	}

	if (filteredSkills.length === 0 && hasSearch) {
		return (
			<SkillsStateMessage
				icon={<SearchXIcon aria-hidden="true" />}
				title="No matching skills"
				description="Try a different exact name or clear the search."
				action={
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={onClearSearch}
					>
						Clear search
					</Button>
				}
			/>
		);
	}

	return layout === "grid" ? (
		<SkillsGrid
			skills={filteredSkills}
			userMap={userMap}
			onSelectSkill={onSelectSkill}
		/>
	) : (
		<SkillsList
			skills={filteredSkills}
			userMap={userMap}
			onSelectSkill={onSelectSkill}
		/>
	);
}

function SkillsGrid({
	skills,
	userMap,
	onSelectSkill,
}: {
	skills: readonly HistoricalSkillSummary[];
	userMap: Record<string, string>;
	onSelectSkill: (name: string) => void;
}) {
	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
			<ul
				aria-label="Historical skills"
				className="grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,13.5rem),1fr))] gap-5 p-4 sm:p-5 lg:p-6"
			>
				{skills.map((skill) => (
					<li key={skill.name} className="min-w-0">
						<SkillCard
							skill={skill}
							userMap={userMap}
							onSelectSkill={onSelectSkill}
						/>
					</li>
				))}
			</ul>
		</div>
	);
}

const SkillCard = memo(function SkillCard({
	skill,
	userMap,
	onSelectSkill,
}: {
	skill: HistoricalSkillSummary;
	userMap: Record<string, string>;
	onSelectSkill: (name: string) => void;
}) {
	return (
		<article className="group relative flex aspect-[4/5] w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-black/8 bg-[color:var(--dashboardy-surface-opaque)] text-left shadow-[0_1px_2px_rgb(0_0_0/0.05),0_8px_24px_-18px_rgb(0_0_0/0.35)] transition-[box-shadow,border-color] hover:border-black/12 hover:shadow-[0_2px_5px_rgb(0_0_0/0.08),0_18px_34px_-22px_rgb(0_0_0/0.45)] dark:border-white/10 dark:hover:border-white/16">
			<button
				type="button"
				aria-label={`Open ${skill.name}`}
				onClick={() => onSelectSkill(skill.name)}
				className="absolute inset-0 z-20 rounded-2xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--dashboard-01-metric-button-focus-ring)]"
			/>
			<div className="pointer-events-none flex min-h-0 flex-1 flex-col">
				<div className="flex min-w-0 shrink-0 flex-col px-4 pt-4 pb-3.5">
					<div className="flex min-w-0 items-start gap-2">
						<h2
							className="min-w-0 flex-1 truncate text-[17px] leading-6 font-semibold tracking-[-0.015em] text-[color:var(--dashboardy-heading)]"
							title={skill.name}
						>
							{skill.name}
						</h2>
						<ChevronRightIcon
							aria-hidden="true"
							className="mt-1 size-4 shrink-0 translate-x-1 stroke-[color:var(--dashboardy-subtle)] opacity-0 transition-[opacity,transform] group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100"
						/>
					</div>
					<p className="mt-1 truncate text-xs text-[color:var(--dashboardy-muted)]">
						{formatSessionCount(skill.sessionCount)}
					</p>
					<SkillAttributionSummary
						attribution={skill.attribution}
						userMap={userMap}
					/>
				</div>

				<div className="mx-4 h-px shrink-0 bg-black/6 dark:bg-white/8" />

				<div className="relative mx-4 mb-4 flex min-h-0 flex-1 overflow-hidden">
					<SkillMarkdownPreview content={skill.contentPreview} />
					<div className="absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-[color:var(--dashboardy-surface-opaque)] via-[color:var(--dashboardy-surface-opaque)]/85 to-transparent" />
				</div>
			</div>
		</article>
	);
});

function SkillMarkdownPreview({ content }: { content: string | null }) {
	if (!content) {
		return (
			<p className="pt-3 text-xs leading-5 text-[color:var(--dashboardy-subtle)]">
				No complete content was recovered for this skill.
			</p>
		);
	}

	return (
		<div className="min-h-0 flex-1 overflow-hidden pt-3">
			<RichSkillDocument content={content} variant="preview" />
		</div>
	);
}

function SkillsList({
	skills,
	userMap,
	onSelectSkill,
}: {
	skills: readonly HistoricalSkillSummary[];
	userMap: Record<string, string>;
	onSelectSkill: (name: string) => void;
}) {
	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-6">
			<ul
				aria-label="Historical skills"
				className="mx-auto max-w-5xl list-none divide-y divide-black/6 dark:divide-white/8"
			>
				{skills.map((skill) => (
					<li key={skill.name}>
						<button
							type="button"
							onClick={() => onSelectSkill(skill.name)}
							className="group grid min-h-16 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-2 py-3 text-left outline-none transition-colors hover:bg-black/[0.025] focus-visible:bg-black/[0.025] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--dashboard-01-metric-button-focus-ring)] dark:hover:bg-white/[0.035] dark:focus-visible:bg-white/[0.035] sm:grid-cols-[minmax(0,1fr)_minmax(12rem,auto)_1rem] sm:px-3"
						>
							<div className="min-w-0">
								<h2
									className="truncate text-sm font-medium text-[color:var(--dashboardy-heading)]"
									title={skill.name}
								>
									{skill.name}
								</h2>
								<p className="mt-0.5 truncate text-xs text-[color:var(--dashboardy-muted)] sm:hidden">
									{formatSessionCount(skill.sessionCount)}
								</p>
								<SkillAttributionSummary
									attribution={skill.attribution}
									userMap={userMap}
								/>
							</div>
							<div className="hidden min-w-0 items-center justify-end gap-2 sm:flex">
								<span className="mr-1 font-mono text-xs tabular-nums text-[color:var(--dashboardy-muted)]">
									{formatSessionCount(skill.sessionCount)}
								</span>
								{skill.claudeSessionCount > 0 ? (
									<AgentCountBadge
										agent="Claude"
										count={skill.claudeSessionCount}
									/>
								) : null}
								{skill.codexSessionCount > 0 ? (
									<AgentCountBadge
										agent="Codex"
										count={skill.codexSessionCount}
									/>
								) : null}
							</div>
							<ChevronRightIcon
								aria-hidden="true"
								className="size-4 shrink-0 stroke-[color:var(--dashboardy-subtle)] transition-transform group-hover:translate-x-0.5"
							/>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

function SkillAttributionSummary({
	attribution,
	userMap,
}: {
	attribution: SkillAttribution | undefined;
	userMap: Record<string, string>;
}) {
	if (!attribution) {
		return null;
	}

	const topUserLabels = attribution.topUsers.map(
		(user) => userMap[user.userId],
	);
	const canShowUserNames = topUserLabels.every(
		(userLabel): userLabel is string => userLabel !== undefined,
	);
	const hiddenUserCount = Math.max(
		0,
		attribution.userCount - attribution.topUsers.length,
	);
	const hiddenRepoCount = Math.max(
		0,
		attribution.repoCount - attribution.topRepos.length,
	);

	return (
		<dl className="mt-2 grid min-w-0 gap-1 text-[11px] leading-4 text-[color:var(--dashboardy-muted)]">
			<div className="flex min-w-0 items-center gap-1">
				<dt className="w-5 shrink-0 text-[color:var(--dashboardy-subtle)]">
					By
				</dt>
				<dd className="flex min-w-0 items-center gap-1 overflow-hidden">
					{canShowUserNames && attribution.topUsers.length > 0 ? (
						<>
							{attribution.topUsers.map((user, index) => (
								<AttributionChip
									key={user.userId}
									label={topUserLabels[index] ?? ""}
									sessionCount={user.sessionCount}
									type="user"
								/>
							))}
							{hiddenUserCount > 0 ? (
								<span className="shrink-0 tabular-nums">
									+{hiddenUserCount.toLocaleString()}
								</span>
							) : null}
						</>
					) : (
						<span className="truncate tabular-nums">
							{formatUserCount(attribution.userCount)}
						</span>
					)}
				</dd>
			</div>

			<div className="flex min-w-0 items-center gap-1">
				<dt className="w-5 shrink-0 text-[color:var(--dashboardy-subtle)]">
					In
				</dt>
				<dd className="flex min-w-0 items-center gap-1 overflow-hidden">
					{attribution.topRepos.map((repo) => (
						<AttributionChip
							key={`${repo.repoKey}:${repo.repoLabel}:${repo.sessionCount}`}
							label={repo.repoLabel}
							sessionCount={repo.sessionCount}
							type="repo"
						/>
					))}
					{hiddenRepoCount > 0 ? (
						<span className="shrink-0 tabular-nums">
							+{hiddenRepoCount.toLocaleString()}
						</span>
					) : null}
				</dd>
			</div>
		</dl>
	);
}

function AttributionChip({
	label,
	sessionCount,
	type,
}: {
	label: string;
	sessionCount: number;
	type: "repo" | "user";
}) {
	const accessibleLabel =
		type === "user"
			? `Used by ${label} in ${formatCompactSessionCount(sessionCount)}`
			: `Repository ${label}, ${formatCompactSessionCount(sessionCount)}`;

	return (
		<span
			className="flex min-w-0 items-center gap-1 rounded-sm bg-black/[0.035] px-1.5 py-0.5 dark:bg-white/[0.06]"
			title={accessibleLabel}
		>
			<span className="min-w-0 truncate">{label}</span>
			<span className="shrink-0 font-mono text-[10px] tabular-nums">
				{sessionCount.toLocaleString()}
			</span>
		</span>
	);
}

function SkillsCollectionSkeleton() {
	return (
		<div aria-busy="true" className="min-h-0 min-w-0 flex-1 overflow-hidden">
			<output className="sr-only">Loading skills</output>
			<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13.5rem),1fr))] gap-5 p-4 sm:p-5 lg:p-6">
				{["first", "second", "third", "fourth", "fifth", "sixth"].map((key) => (
					<div
						key={key}
						className="flex aspect-[4/5] min-w-0 flex-col overflow-hidden rounded-2xl border border-black/6 p-4 dark:border-white/8"
					>
						<Skeleton className="h-5 w-3/4" />
						<Skeleton className="mt-2 h-3 w-1/2" />
						<div className="my-4 h-px bg-black/6 dark:bg-white/8" />
						<Skeleton className="min-h-0 flex-1 rounded-xl" />
					</div>
				))}
			</div>
		</div>
	);
}

function SkillsStateMessage({
	action,
	description,
	icon,
	title,
}: {
	action?: ReactNode;
	description: string;
	icon: ReactNode;
	title: string;
}) {
	return (
		<div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
			<div className="flex size-10 items-center justify-center rounded-xl border border-black/6 bg-black/[0.025] [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[color:var(--dashboardy-muted)] dark:border-white/8 dark:bg-white/[0.035]">
				{icon}
			</div>
			<div className="flex max-w-md flex-col gap-1">
				<h2 className="text-base font-medium text-balance text-[color:var(--dashboardy-heading)]">
					{title}
				</h2>
				<p className="text-pretty text-base text-[color:var(--dashboardy-muted)] sm:text-sm">
					{description}
				</p>
			</div>
			{action}
		</div>
	);
}

function formatSessionCount(sessionCount: number): string {
	return `Used in ${sessionCount.toLocaleString()} ${
		sessionCount === 1 ? "session" : "sessions"
	}`;
}

function formatCompactSessionCount(sessionCount: number): string {
	return `${sessionCount.toLocaleString()} ${
		sessionCount === 1 ? "session" : "sessions"
	}`;
}

function formatUserCount(userCount: number): string {
	return `${userCount.toLocaleString()} ${userCount === 1 ? "user" : "users"}`;
}

function AgentCountBadge({
	agent,
	count,
}: {
	agent: "Claude" | "Codex";
	count: number;
}) {
	return (
		<span className="rounded-full border border-[color:var(--dashboardy-border)] px-1.5 py-0.5 font-mono text-[11px] leading-none text-[color:var(--dashboardy-muted)]">
			{agent} {count.toLocaleString()}
		</span>
	);
}
