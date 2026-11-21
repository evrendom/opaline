import type { HistoricalSkillSummary } from "@rudel/api-routes";
import {
	IconBook,
	IconFolder,
	IconSearch,
	IconUser,
	IconZoomCancel,
} from "@tabler/icons-react";
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
import { FluidHoverHighlight } from "@/app/ui/fluid-hover-highlight";
import { Skeleton } from "@/app/ui/skeleton";
import { CONVERSATION_TRACE_TAG_CLASS_NAME } from "@/components/conversation/conversation-trace-tag";
import { PageEmptyState } from "@/components/dashboard/page-parts";
import { RetryButton } from "@/components/retry-button";
import { SkillMark } from "@/components/skill-mark";
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

// Card grid: 16px gaps, its edges on the page title's 32px gutter.
const USAGE_GRID_CLASS_NAME =
	"grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,13.5rem),1fr))] gap-xl px-xl pt-xs pb-xxl sm:px-[calc(var(--space-xxl)*4/3)]";
// Card: a squircle on its soft hairline shadow, no border.
const USAGE_CARD_CLASS_NAME =
	"relative flex h-full w-full min-w-0 flex-col overflow-hidden corner-m bg-card text-left text-session-overview-text shadow-card squircle:corner-xl corner-squircle";
const USAGE_METADATA_ICON_CLASS_NAME =
	// design-escape-ok(colour): shipped value; #8d8d8d, #8c8c8c in dark
	"size-3.5 shrink-0 text-[#8d8d8d] dark:text-[#8c8c8c]";

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

export function UsageCollectionHeader({
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
				"ml-auto flex min-w-0 flex-1 items-center justify-end gap-m",
				inline &&
					// The detail page's side pane: a 48px strip on 24px gutters, level
					// with the sessions toolbar beside it.
					"h-12 w-full flex-none edge-b-m border-line-strong px-xxl",
			)}
		>
			{inline ? (
				<h2 className="mr-auto text-body-xl font-medium">Skills</h2>
			) : null}
			<div className="relative min-w-0 max-w-56 flex-1 sm:flex-none">
				<label className="sr-only" htmlFor={`${kind}-search`}>
					Search {kind}
				</label>
				<IconSearch
					aria-hidden="true"
					className={cn(
						"absolute top-1/2 left-2.5 z-10 size-3.5",
						// design-escape-ok(colour): shipped value; #b8b8b8, #5b5b5b in dark
						"pointer-events-none -translate-y-1/2 text-[#b8b8b8] dark:text-[#5b5b5b]",
					)}
				/>
				<input
					id={`${kind}-search`}
					name={`${kind}-search`}
					type="search"
					value={search}
					onChange={(event) => onSearchChange(event.currentTarget.value)}
					placeholder={`Search ${kind}`}
					className="toolbar-search"
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
			<PageEmptyState
				icon={IconBook}
				title={`${kind === "skills" ? "Skills" : "Repos"} couldn’t be loaded`}
				description="Your historical sessions are still available. Try loading this view again."
				action={<RetryButton className="h-8 gap-xs" onRetry={onRetry} />}
			/>
		);
	}

	if (itemCount === 0) {
		return (
			<PageEmptyState
				icon={IconBook}
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
			<PageEmptyState
				icon={IconZoomCancel}
				title={`No matching ${kind}`}
				description="Try a different exact name or clear the search."
				action={
					<Button
						type="button"
						size="sm"
						className="h-8 gap-xs"
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
				<FluidHoverHighlight hover={hover} className="z-10 corner-m bg-wash" />
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
				className="absolute inset-0 z-20 corner-m corner-squircle squircle:corner-xl focus-outline focus-visible:-outline-offset-2"
			/>
			<div className="pointer-events-none flex min-h-0 flex-1 flex-col">
				<header className="flex min-h-16 flex-1 items-center gap-[calc(var(--space-m)+var(--space-xxs))] px-[calc(var(--space-xl)+var(--space-xs))] py-xl">
					<SkillMark skill={skill.name} emoji={skill.emoji} />
					<h2
						className={cn(
							"line-clamp-2 min-w-0 flex-1 wrap-anywhere",
							"font-body text-body-xxl font-medium text-balance",
							"sm:text-body-xl",
						)}
						title={skill.name}
					>
						{skill.name}
					</h2>
				</header>
				<footer className="shrink-0 edge-t-m border-line px-[calc(var(--space-xl)+var(--space-xs))] py-xl">
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
		<dl className="grid min-w-0 gap-s text-body-m text-session-overview-muted">
			<div className="flex min-w-0 items-center">
				<dt className="sr-only">Sessions</dt>
				<dd className="flex min-w-0 items-center gap-m">
					<AvatarGroup
						role="group"
						aria-label={
							attribution
								? formatUserCount(attribution.userCount)
								: "Skill users"
						}
						className="shrink-0 *:data-[slot=avatar]:ring-canvas"
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
							<AvatarGroupCount className="bg-hover font-body text-body-m text-session-overview-muted ring-canvas tabular-nums">
								+{hiddenUserCount.toLocaleString()}
								<span className="sr-only"> more users</span>
							</AvatarGroupCount>
						) : null}
					</AvatarGroup>
					<span
						className="font-body font-regular text-session-overview-text tabular-nums"
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
					<dd className="flex min-w-0 items-center gap-s">
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
									"shrink-0 px-s",
								)}
							>
								<span className="font-body font-regular text-session-overview-muted tabular-nums">
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
		<Avatar title={title} size="sm" className="bg-canvas after:border-line">
			{avatarUrl ? (
				<AvatarImage alt="" src={avatarUrl} decoding="async" loading="lazy" />
			) : null}
			<AvatarFallback className="bg-hover">
				<IconUser
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
				"min-w-0 gap-s overflow-visible font-regular",
			)}
			title={`Repository ${label}, ${formatCompactSessionCount(sessionCount)}`}
		>
			<IconFolder
				aria-hidden="true"
				className={USAGE_METADATA_ICON_CLASS_NAME}
			/>
			<span className="min-w-0 truncate font-body">{label}</span>
			<span
				className={cn(
					"shrink-0",
					"edge-l-m pl-s",
					"font-body tabular-nums",
					"border-line text-session-overview-subtle",
				)}
			>
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
						<div className="flex min-h-16 flex-1 items-center gap-[calc(var(--space-m)+var(--space-xxs))] px-[calc(var(--space-xl)+var(--space-xs))] py-xl">
							<Skeleton className="size-9 shrink-0 [-webkit-mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat] [mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat]" />
							<Skeleton className="h-5 min-w-0 flex-1" />
						</div>
						<div className="grid gap-s edge-t-m border-line px-xl py-l">
							<div className="flex items-center gap-m">
								<Skeleton className="size-6 corner-full" />
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

function formatCompactSessionCount(sessionCount: number): string {
	return `${sessionCount.toLocaleString()} ${
		sessionCount === 1 ? "session" : "sessions"
	}`;
}

function formatUserCount(userCount: number): string {
	return `${userCount.toLocaleString()} ${userCount === 1 ? "user" : "users"}`;
}
