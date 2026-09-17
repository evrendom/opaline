import {
	BookOpen01Icon,
	Folder01Icon,
	Search01Icon,
	SearchRemoveIcon,
	User02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { HistoricalSkillSummary } from "@rudel/api-routes";
import type { ReactNode } from "react";
import { memo, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	Avatar,
	AvatarFallback,
	AvatarGroup,
	AvatarGroupCount,
	AvatarImage,
} from "@/app/ui/avatar";
import { Button } from "@/app/ui/button";
import { Skeleton } from "@/app/ui/skeleton";
import { getSkillIcon } from "@/components/conversation/conversation-skill-icon";
import { CONVERSATION_TRACE_TAG_CLASS_NAME } from "@/components/conversation/conversation-trace-tag";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { SESSION_OVERVIEW_SURFACE_CLASS_NAME } from "@/features/sessions/components/sessions-overview-table-utils";
import { useShellHeaderPortal } from "@/features/shell/shell-header-portal";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import {
	type UseFluidHoverReturn,
	useFluidHover,
	useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { cn } from "@/lib/utils";

interface UsageCardSummary {
	name: string;
	id: string;
	sessionCount: number;
	attribution: HistoricalSkillSummary["attribution"];
	emoji?: string;
	extra?: ReactNode;
}

interface UsageCollectionViewProps {
	items: readonly UsageCardSummary[] | undefined;
	isError: boolean;
	isPending: boolean;
	onRetry: () => void;
	onSelectItem: (name: string) => void;
	kind?: "skills" | "repos";
	inline?: boolean;
}

const USAGE_GRID_CLASS_NAME =
	"grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,13.5rem),1fr))] gap-3 p-4 sm:p-[18px]";
const USAGE_CARD_CLASS_NAME =
	"relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-lg bg-white text-left text-(--session-overview-text) shadow-[0_0_0_0.5px_#0000000f,0_1px_1px_-1px_#0000001a,0_1px_2px_0_#0000000d] dark:border dark:border-white/10 dark:bg-(--dashboardy-surface-opaque) dark:shadow-none";
const USAGE_METADATA_ICON_CLASS_NAME =
	"size-3.5 shrink-0 text-[#8d8d8d] dark:text-[#8c8c8c]";
const SKILL_CARD_MARKS: Record<string, { emoji: string; color: string }> = {
	wrench: { emoji: "🔧", color: "bg-[#f5dfcd]" },
	drill: { emoji: "🛠️", color: "bg-[#dce7f5]" },
	paintbrush: { emoji: "🎨", color: "bg-[#ede0f2]" },
	compass: { emoji: "🧭", color: "bg-[#f4e9c9]" },
	ruler: { emoji: "📏", color: "bg-[#dceade]" },
	scissors: { emoji: "✂️", color: "bg-[#f4dddd]" },
	"tape-measure": { emoji: "📐", color: "bg-[#f4e9c9]" },
	flashlight: { emoji: "🔦", color: "bg-[#f5dfcd]" },
	magnet: { emoji: "🧲", color: "bg-[#f4dddd]" },
	microscope: { emoji: "🔬", color: "bg-[#dce7f5]" },
	telescope: { emoji: "🔭", color: "bg-[#ede0f2]" },
	"drafting-tools": { emoji: "✏️", color: "bg-[#f4e9c9]" },
	toolbox: { emoji: "🧰", color: "bg-[#f5dfcd]" },
	tools: { emoji: "⚙️", color: "bg-[#dceade]" },
	experiment: { emoji: "🧪", color: "bg-[#dceade]" },
};

type SkillAttribution = NonNullable<HistoricalSkillSummary["attribution"]>;

export function UsageCollectionView({
	items,
	isError,
	isPending,
	onRetry,
	onSelectItem,
	kind = "skills",
	inline = false,
}: UsageCollectionViewProps) {
	const { avatarMap, userMap } = useUserMap();
	const [search, setSearch] = useState("");
	const filteredItems = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		if (!query) {
			return items ?? [];
		}

		return (items ?? []).filter((skill) =>
			skill.name.toLocaleLowerCase().includes(query),
		);
	}, [search, items]);

	return (
		<div
			className={cn(
				inline
					? "flex min-h-0 min-w-0 flex-1 flex-col isolate antialiased"
					: "dashboardy-page isolate antialiased",
				SESSION_OVERVIEW_SURFACE_CLASS_NAME,
			)}
		>
			<section
				aria-label={kind === "skills" ? "Skills" : "Repos"}
				className="flex min-h-0 min-w-0 flex-1 flex-col"
			>
				<UsageCollectionHeader
					search={search}
					onSearchChange={setSearch}
					kind={kind}
					inline={inline}
				/>

				<UsageCollectionState
					kind={kind}
					avatarMap={avatarMap}
					filteredItems={filteredItems}
					hasSearch={search.trim().length > 0}
					isError={isError}
					isPending={isPending}
					itemCount={items?.length ?? 0}
					userMap={userMap}
					onClearSearch={() => setSearch("")}
					onRetry={onRetry}
					onSelectItem={onSelectItem}
				/>
			</section>
		</div>
	);
}

function UsageCollectionHeader({
	search,
	onSearchChange,
	kind,
	inline,
}: {
	search: string;
	onSearchChange: (search: string) => void;
	kind: "skills" | "repos";
	inline: boolean;
}) {
	const shellHeaderPortal = useShellHeaderPortal();
	if (!inline && !shellHeaderPortal) {
		return null;
	}

	const content = (
		<div
			className={cn(
				"ml-auto flex min-w-0 flex-1 items-center justify-end gap-2",
				inline &&
					"w-full max-h-10 shrink-0 border-b border-(--session-overview-border) px-4 py-1.5",
			)}
		>
			{inline ? <h2 className="mr-auto text-sm font-medium">Skills</h2> : null}
			<div className="relative min-w-0 max-w-56 flex-1 sm:flex-none">
				<label className="sr-only" htmlFor={`${kind}-search`}>
					Search {kind}
				</label>
				<HugeiconsIcon
					icon={Search01Icon}
					strokeWidth={1.5}
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[#8d8d8d] dark:text-[#8c8c8c]"
				/>
				<input
					id={`${kind}-search`}
					name={`${kind}-search`}
					type="search"
					value={search}
					onChange={(event) => onSearchChange(event.currentTarget.value)}
					placeholder={`Search ${kind}`}
					className="h-7 w-full rounded-md bg-transparent py-1 pr-2.5 pl-8 text-base text-(--dashboardy-heading) shadow-[0_0_0_0.5px_#0000000f,0_1px_2px_#0000000d] outline-none placeholder:text-(--dashboardy-subtle) focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-(--dashboard-01-metric-button-focus-ring) sm:text-sm dark:ring-1 dark:ring-white/10 dark:shadow-none"
				/>
			</div>
		</div>
	);
	return inline
		? content
		: shellHeaderPortal
			? createPortal(content, shellHeaderPortal)
			: null;
}

function UsageCollectionState({
	kind,
	avatarMap,
	filteredItems,
	hasSearch,
	isError,
	isPending,
	itemCount,
	userMap,
	onClearSearch,
	onRetry,
	onSelectItem,
}: {
	kind: "skills" | "repos";
	avatarMap: Record<string, string>;
	filteredItems: readonly UsageCardSummary[];
	hasSearch: boolean;
	isError: boolean;
	isPending: boolean;
	itemCount: number;
	userMap: Record<string, string>;
	onClearSearch: () => void;
	onRetry: () => void;
	onSelectItem: (name: string) => void;
}) {
	if (isPending) {
		return <UsageCollectionSkeleton kind={kind} />;
	}

	if (isError) {
		return (
			<UsageStateMessage
				icon={
					<HugeiconsIcon
						icon={BookOpen01Icon}
						strokeWidth={1.5}
						aria-hidden="true"
					/>
				}
				title={`${kind === "skills" ? "Skills" : "Repos"} couldn’t be loaded`}
				description="Your historical sessions are still available. Try loading this view again."
				action={
					<Button type="button" size="sm" variant="outline" onClick={onRetry}>
						Try again
					</Button>
				}
			/>
		);
	}

	if (itemCount === 0) {
		return (
			<UsageStateMessage
				icon={
					<HugeiconsIcon
						icon={BookOpen01Icon}
						strokeWidth={1.5}
						aria-hidden="true"
					/>
				}
				title={`No ${kind} yet`}
				description={
					kind === "skills"
						? "Skills will appear here when Claude or Codex sessions include a recorded skill use."
						: "Repositories will appear here when sessions are uploaded."
				}
			/>
		);
	}

	if (filteredItems.length === 0 && hasSearch) {
		return (
			<UsageStateMessage
				icon={
					<HugeiconsIcon
						icon={SearchRemoveIcon}
						strokeWidth={1.5}
						aria-hidden="true"
					/>
				}
				title={`No matching ${kind}`}
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

	return (
		<UsageCardGrid
			kind={kind}
			avatarMap={avatarMap}
			items={filteredItems}
			userMap={userMap}
			onSelectItem={onSelectItem}
		/>
	);
}

function UsageCardGrid({
	kind,
	avatarMap,
	items,
	userMap,
	onSelectItem,
}: {
	kind: "skills" | "repos";
	avatarMap: Record<string, string>;
	items: readonly UsageCardSummary[];
	userMap: Record<string, string>;
	onSelectItem: (name: string) => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const hover = useFluidHover(containerRef, {
		axis: "xy",
		gapClick: false,
		reflectActiveState: false,
	});
	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none">
			{/* biome-ignore lint/a11y/noStaticElementInteractions: Delegates hover and focus from the native card buttons. */}
			<div
				ref={containerRef}
				className="relative isolate"
				{...hover.handlers}
				onBlur={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget))
						hover.setActiveIndex(null);
				}}
			>
				<FluidHoverHighlight
					hover={hover}
					className="z-10 rounded-lg bg-black/2 dark:bg-white/3"
				/>
				{/* biome-ignore lint/a11y/useSemanticElements: An explicit role preserves this list in Safari with list-style none. */}
				<ul
					// biome-ignore lint/a11y/noRedundantRoles: Preserve list semantics in Safari with list-style none.
					role="list"
					aria-label={kind === "skills" ? "Historical skills" : "Repositories"}
					className={USAGE_GRID_CLASS_NAME}
				>
					{items.map((skill, index) => (
						<li key={skill.id} className="min-w-0">
							<UsageCard
								avatarMap={avatarMap}
								skill={skill}
								userMap={userMap}
								onSelectItem={onSelectItem}
								index={index}
								registerItem={hover.registerItem}
								setActiveIndex={hover.setActiveIndex}
							/>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}

const UsageCard = memo(function UsageCard({
	avatarMap,
	skill,
	userMap,
	onSelectItem,
	index,
	registerItem,
	setActiveIndex,
}: {
	avatarMap: Record<string, string>;
	skill: UsageCardSummary;
	userMap: Record<string, string>;
	onSelectItem: (name: string) => void;
	index: number;
	registerItem: UseFluidHoverReturn["registerItem"];
	setActiveIndex: UseFluidHoverReturn["setActiveIndex"];
}) {
	const cardRef = useRef<HTMLElement>(null);
	useRegisterFluidHoverItem(registerItem, index, cardRef);
	return (
		<article
			ref={cardRef}
			className={USAGE_CARD_CLASS_NAME}
			data-usage-card
			data-skill-card
		>
			<button
				type="button"
				aria-label={`Open ${skill.name}`}
				onClick={() => onSelectItem(skill.id)}
				onFocus={() => setActiveIndex(index)}
				className="absolute inset-0 z-20 cursor-pointer rounded-lg outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--session-overview-accent)"
			/>
			<div className="pointer-events-none flex min-h-0 flex-1 flex-col">
				<header className="flex min-h-16 flex-1 items-center gap-2.5 px-4 py-3">
					<UsageCardMark skill={skill.name} emoji={skill.emoji} />
					<h2
						className="line-clamp-2 min-w-0 flex-1 font-sans text-base font-medium text-balance wrap-anywhere sm:text-sm"
						title={skill.name}
					>
						{skill.name}
					</h2>
				</header>
				<footer className="shrink-0 border-t border-black/5 px-4 py-3 dark:border-white/6">
					<UsageSummary
						avatarMap={avatarMap}
						attribution={skill.attribution}
						sessionCount={skill.sessionCount}
						userMap={userMap}
					/>
					{skill.extra}
				</footer>
			</div>
		</article>
	);
});

function UsageCardMark({
	skill,
	emoji,
}: {
	skill: string;
	emoji: string | undefined;
}) {
	const mark = SKILL_CARD_MARKS[getSkillIcon(skill).name] ?? {
		emoji: "✨",
		color: "bg-[#ede0f2]",
	};
	return (
		<div
			aria-hidden="true"
			className="relative flex size-9 shrink-0 items-center justify-center text-xl"
			data-skill-card-mark
		>
			<span className="absolute inset-0 filter-[drop-shadow(0_0_0.5px_#00000024)_drop-shadow(0_2px_3px_#00000014)] dark:filter-none">
				<span
					className={cn(
						"absolute inset-0 [-webkit-mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat] [mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat]",
						mark.color,
					)}
				/>
			</span>
			<span className="relative">{emoji ?? mark.emoji}</span>
		</div>
	);
}

function UsageSummary({
	avatarMap,
	attribution,
	sessionCount,
	userMap,
}: {
	avatarMap: Record<string, string>;
	attribution: SkillAttribution | undefined;
	sessionCount: number;
	userMap: Record<string, string>;
}) {
	const visibleUsers = attribution?.topUsers.slice(0, 3) ?? [];
	const visibleRepos = attribution?.topRepos.slice(0, 1) ?? [];
	const hiddenUserCount = Math.max(
		0,
		(attribution?.userCount ?? 0) - visibleUsers.length,
	);
	const hiddenRepoCount = Math.max(
		0,
		(attribution?.repoCount ?? 0) - visibleRepos.length,
	);

	return (
		<dl className="grid min-w-0 gap-1.5 text-xs text-(--session-overview-muted)">
			<div className="flex min-w-0 items-center">
				<dt className="sr-only">Sessions</dt>
				<dd className="flex min-w-0 items-center gap-2">
					<AvatarGroup
						role="group"
						aria-label={
							attribution
								? formatUserCount(attribution.userCount)
								: "Skill users"
						}
						className="shrink-0 *:data-[slot=avatar]:ring-white dark:*:data-[slot=avatar]:ring-(--dashboardy-surface-opaque)"
					>
						{visibleUsers.length > 0 ? (
							visibleUsers.map((user) => (
								<UsageUserAvatar
									key={user.userId}
									avatarUrl={avatarMap[user.userId]}
									title={
										userMap[user.userId]
											? `Used by ${userMap[user.userId]} in ${formatCompactSessionCount(user.sessionCount)}`
											: undefined
									}
								/>
							))
						) : (
							<UsageUserAvatar avatarUrl={undefined} title={undefined} />
						)}
						{hiddenUserCount > 0 ? (
							<AvatarGroupCount className="bg-(--session-overview-hover) font-sans text-xs text-(--session-overview-muted) ring-white tabular-nums dark:ring-(--dashboardy-surface-opaque)">
								+{hiddenUserCount.toLocaleString()}
								<span className="sr-only"> more users</span>
							</AvatarGroupCount>
						) : null}
					</AvatarGroup>
					<span
						className="font-sans font-normal text-(--session-overview-text) tabular-nums"
						title={formatCompactSessionCount(sessionCount)}
					>
						{sessionCount.toLocaleString()}
						<span className="sr-only">
							{" "}
							{sessionCount === 1 ? "session" : "sessions"}
						</span>
					</span>
				</dd>
			</div>
			{visibleRepos.length > 0 ? (
				<div className="flex min-w-0 items-center">
					<dt className="sr-only">Repositories</dt>
					<dd className="flex min-w-0 items-center gap-1.5">
						{visibleRepos.map((repo) => (
							<RepositoryChip
								key={repo.repoKey}
								label={repo.repoLabel}
								sessionCount={repo.sessionCount}
							/>
						))}
						{hiddenRepoCount > 0 ? (
							<span
								className={cn(
									CONVERSATION_TRACE_TAG_CLASS_NAME,
									"shrink-0 px-1.5",
								)}
							>
								<span className="font-sans font-normal text-(--session-overview-muted) tabular-nums">
									+{hiddenRepoCount.toLocaleString()}
									<span className="sr-only"> more repositories</span>
								</span>
							</span>
						) : null}
					</dd>
				</div>
			) : null}
		</dl>
	);
}

function UsageUserAvatar({
	avatarUrl,
	title,
}: {
	avatarUrl: string | undefined;
	title: string | undefined;
}) {
	return (
		<Avatar
			title={title}
			size="sm"
			className="bg-white after:border-black/5 dark:bg-(--dashboardy-surface-opaque) dark:after:border-white/10"
		>
			{avatarUrl ? (
				<AvatarImage alt="" src={avatarUrl} decoding="async" loading="lazy" />
			) : null}
			<AvatarFallback className="bg-(--session-overview-hover)">
				<HugeiconsIcon
					icon={User02Icon}
					strokeWidth={1.5}
					aria-hidden="true"
					className={USAGE_METADATA_ICON_CLASS_NAME}
				/>
			</AvatarFallback>
		</Avatar>
	);
}

function RepositoryChip({
	label,
	sessionCount,
}: {
	label: string;
	sessionCount: number;
}) {
	return (
		<span
			className={cn(
				CONVERSATION_TRACE_TAG_CLASS_NAME,
				"min-w-0 gap-1.5 overflow-visible font-normal",
			)}
			title={`Repository ${label}, ${formatCompactSessionCount(sessionCount)}`}
		>
			<HugeiconsIcon
				icon={Folder01Icon}
				strokeWidth={1.5}
				aria-hidden="true"
				className={USAGE_METADATA_ICON_CLASS_NAME}
			/>
			<span className="min-w-0 truncate font-sans">{label}</span>
			<span className="shrink-0 border-l border-black/6 pl-1.5 font-sans text-(--session-overview-subtle) tabular-nums dark:border-white/10">
				{sessionCount.toLocaleString()}
			</span>
		</span>
	);
}

function UsageCollectionSkeleton({ kind }: { kind: "skills" | "repos" }) {
	return (
		<div aria-busy="true" className="min-h-0 min-w-0 flex-1 overflow-hidden">
			<output className="sr-only">Loading {kind}</output>
			<div className={USAGE_GRID_CLASS_NAME}>
				{["first", "second", "third", "fourth", "fifth", "sixth"].map((key) => (
					<div key={key} className={USAGE_CARD_CLASS_NAME}>
						<div className="flex min-h-16 flex-1 items-center gap-2.5 px-4 py-3">
							<Skeleton className="size-9 shrink-0 [-webkit-mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat] [mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat]" />
							<Skeleton className="h-5 min-w-0 flex-1" />
						</div>
						<div className="grid gap-1.5 border-t border-black/5 px-4 py-3 dark:border-white/6">
							<div className="flex items-center gap-2">
								<Skeleton className="size-6 rounded-full" />
								<Skeleton className="h-4 w-8" />
							</div>
							<Skeleton className="h-5 w-1/2" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function UsageStateMessage({
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
			<div className="text-[#8d8d8d] [&_svg]:size-5 [&_svg]:shrink-0 dark:text-[#8c8c8c]">
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

function formatCompactSessionCount(sessionCount: number): string {
	return `${sessionCount.toLocaleString()} ${
		sessionCount === 1 ? "session" : "sessions"
	}`;
}

function formatUserCount(userCount: number): string {
	return `${userCount.toLocaleString()} ${userCount === 1 ? "user" : "users"}`;
}
