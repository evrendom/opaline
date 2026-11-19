import type { HistoricalSkillSummary } from "@rudel/api-routes";
import {
	IconArrowUpRight,
	IconRefresh,
	IconSparkles,
	IconUser,
	IconZoomCancel,
} from "@tabler/icons-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
	Avatar,
	AvatarFallback,
	AvatarGroup,
	AvatarGroupCount,
	AvatarImage,
} from "@/app/ui/avatar";
import { Button } from "@/components/dashboard/button";
import {
	ClearFiltersButton,
	PaginationFooter,
	parseSortParam,
	SearchInput,
	sortRows,
	Toolbar,
	useUrlFilters,
} from "@/components/dashboard/data-table";
import {
	DRAWER_BUTTON_CLASS,
	DrawerColumns,
	DrawerRow,
	Meta,
	MetaEmpty,
	OPEN_ROW_CLASS,
} from "@/components/dashboard/drawer";
import { formatCount } from "@/components/dashboard/format";
import {
	useDebouncedValue,
	useDelayedLoading,
} from "@/components/dashboard/hooks";
import {
	EmptyState,
	TableRowsSkeleton,
} from "@/components/dashboard/page-parts";
import {
	Table,
	TableBody,
	TableCell,
	TableRow,
} from "@/components/dashboard/table";
import { TooltipProvider } from "@/components/dashboard/tooltip";
import { SkillMark } from "@/components/skill-mark";
import { ToolbarSortMenu } from "@/features/sessions/components/sessions-overview-sort-menu";
import { RichSkillDocument } from "@/features/skills/components/rich-skill-document";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { cn } from "@/lib/utils";
import {
	RepoSkillsFilterMenu,
	SKILL_AGENTS,
	type SkillAgent,
} from "./repo-skills-filter-menu";

const PAGE_SIZES = [25, 50, 100];
const SORT_OPTIONS = [
	{ key: "sessions", label: "Sessions" },
	{ key: "members", label: "Members" },
	{ key: "versions", label: "Versions" },
	{ key: "name", label: "Name" },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]["key"];
const SORT_KEYS = SORT_OPTIONS.map(({ key }) => key);
const COLUMN_COUNT = 2;
const SKELETON_COLS = [
	{ icon: true, w: "w-64" },
	{ align: "right", w: "w-24" },
] as const;

/** The `agents` param ("claude,codex") as the agents it names. */
function parseAgentsParam(value: string): SkillAgent[] {
	const named = value.split(",");
	return SKILL_AGENTS.map(({ key }) => key).filter((key) =>
		named.includes(key),
	);
}

/** The `description:` line of a SKILL.md's front matter, when the preview
 * carries one. */
export function skillDescription(content: string | null) {
	const frontMatter = content?.match(/^---\n([\s\S]*?)\n---/u)?.[1];
	const description = frontMatter
		?.match(/^description:\s*(.+)$/mu)?.[1]
		?.trim()
		.replace(/^(["'])(.*)\1$/u, "$2");
	return description || null;
}

/** A repo's skills as a list of rows under a search, filter and sort
 * toolbar. A row's skill mark is its disclosure: rows expand into a drawer
 * with the skill's facts, whose "Open skill" button leads to its own page. */
export function RepoSkillsTable({
	skills,
	isPending,
	isError,
	onRetry,
	onOpenSkill,
}: {
	skills: readonly HistoricalSkillSummary[] | undefined;
	isPending: boolean;
	isError: boolean;
	onRetry: () => void;
	onOpenSkill: (name: string) => void;
}) {
	const [params, patchParams] = useUrlFilters({
		q: "",
		agents: "",
		sort: "",
		page: "1",
		size: "25",
	});
	const [search, setSearch] = useState(params.q);
	const debouncedSearch = useDebouncedValue(search);
	useEffect(() => {
		patchParams({ q: debouncedSearch.trim() });
	}, [debouncedSearch, patchParams]);
	useEffect(() => {
		setSearch((prev) => (prev.trim() === params.q ? prev : params.q));
	}, [params.q]);
	const sort = useMemo(
		() => parseSortParam(params.sort, SORT_KEYS) ?? defaultSort,
		[params.sort],
	);
	const agents = useMemo(
		() => parseAgentsParam(params.agents),
		[params.agents],
	);
	const [expanded, setExpanded] = useState<string | null>(null);
	const rows = useMemo(() => {
		const query = params.q.toLocaleLowerCase();
		return sortRows(
			(skills ?? []).filter(
				(skill) =>
					skill.name.toLocaleLowerCase().includes(query) &&
					(agents.length === 0 ||
						agents.some((agent) => agentSessionCount(skill, agent) > 0)),
			),
			sort,
			{
				name: (skill) => skill.name,
				sessions: (skill) => skill.sessionCount,
				members: (skill) => skill.attribution?.userCount ?? null,
				versions: (skill) => skill.versionCount ?? null,
			},
		);
	}, [skills, params.q, agents, sort]);
	const pageSize = PAGE_SIZES.includes(Number(params.size))
		? Number(params.size)
		: 25;
	const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
	const page = Math.min(
		Math.max(0, (Number.parseInt(params.page, 10) || 1) - 1),
		pageCount - 1,
	);
	const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
	const showSkeleton = useDelayedLoading(isPending);

	return (
		<div className="flex flex-col pb-8">
			{/* The 48px header row the Sessions tab's table has, controls
			    centred in it and the table's rule right under it. */}
			{/* Pinned to the tab's scroll area, on the page surface so rows pass
			    under it. */}
			<Toolbar className="sticky top-0 z-20 min-h-12 shrink-0 bg-(--session-overview-surface)">
				<SearchInput
					value={search}
					onChange={setSearch}
					placeholder="Search skills…"
				/>
				<RepoSkillsFilterMenu
					agents={agents}
					onAgentsChange={(next) => patchParams({ agents: next.join(",") })}
				/>
				<ToolbarSortMenu
					noun="skills"
					options={SORT_OPTIONS}
					activeSortLabel={
						SORT_OPTIONS.find(({ key }) => key === sort.key)?.label ?? ""
					}
					getInitialDirection={(key) => (key === "name" ? "asc" : "desc")}
					onSortChange={({ key, direction }) =>
						patchParams({ sort: `${key}:${direction}` })
					}
					sort={{ key: sort.key, direction: sort.dir }}
				/>
				<ClearFiltersButton
					show={!!search || agents.length > 0}
					onClick={() => {
						setSearch("");
						patchParams({ q: "", agents: "" });
					}}
				/>
			</Toolbar>

			{isError ? (
				<div className="mt-4 px-8">
					<EmptyState
						icon={IconSparkles}
						title="Skills couldn’t be loaded"
						description="Try loading this view again."
					>
						<Button
							variant="outline"
							className="mx-auto mt-2"
							onClick={onRetry}
						>
							<IconRefresh />
							Try again
						</Button>
					</EmptyState>
				</div>
			) : !isPending && rows.length === 0 ? (
				<div className="mt-4 px-8">
					{params.q || agents.length > 0 ? (
						<EmptyState
							icon={IconZoomCancel}
							title="No matching skills"
							description="Try a different search or filter."
						/>
					) : (
						<EmptyState
							icon={IconSparkles}
							title="No skills used in this repo yet"
						/>
					)}
				</div>
			) : (
				<div className="flex flex-col">
					<TooltipProvider delay={150}>
						{/* No row rules, as in the sessions list: rows read by their
						    spacing and hover alone. */}
						<Table className="table-fixed min-w-2xl [&_tr]:border-0">
							<TableBody>
								{isPending
									? showSkeleton && <TableRowsSkeleton cols={SKELETON_COLS} />
									: pageRows.map((skill) => {
											const isOpen = expanded === skill.name;
											return (
												<Fragment key={skill.name}>
													<SkillRow
														skill={skill}
														isOpen={isOpen}
														onToggle={() =>
															setExpanded(isOpen ? null : skill.name)
														}
													/>
													{isOpen ? (
														<SkillDrawer
															skill={skill}
															onOpen={() => onOpenSkill(skill.name)}
														/>
													) : null}
												</Fragment>
											);
										})}
							</TableBody>
						</Table>
					</TooltipProvider>
					{!isPending && rows.length > 0 ? (
						<PaginationFooter
							page={page}
							pageSize={pageSize}
							total={rows.length}
							shown={pageRows.length}
							noun={["skill", "skills"]}
							onPageChange={(next) => {
								patchParams({ page: String(next + 1) });
								setExpanded(null);
							}}
							onPageSizeChange={(size) => patchParams({ size: String(size) })}
							pageSizes={PAGE_SIZES}
						/>
					) : null}
				</div>
			)}
		</div>
	);
}

const defaultSort: { key: SortKey; dir: "asc" | "desc" } = {
	key: "sessions",
	dir: "desc",
};

function agentSessionCount(skill: HistoricalSkillSummary, agent: SkillAgent) {
	return agent === "claude"
		? skill.claudeSessionCount
		: skill.codexSessionCount;
}

function plural(count: number, noun: string) {
	return `${formatCount(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function SkillRow({
	skill,
	isOpen,
	onToggle,
}: {
	skill: HistoricalSkillSummary;
	isOpen: boolean;
	onToggle: () => void;
}) {
	const description = skillDescription(skill.contentPreview);
	return (
		<TableRow
			interactive
			aria-expanded={isOpen}
			onClick={onToggle}
			className={cn("group/toggle", isOpen && OPEN_ROW_CLASS)}
		>
			<TableCell className="h-14 font-normal">
				<div className="flex min-w-0 items-center gap-3">
					<SkillMark
						skill={skill.name}
						className="size-7 text-sm"
						expandable
						expanded={isOpen}
					/>
					<div className="flex min-w-0 flex-col">
						<span className="truncate font-medium">{skill.name}</span>
						{description ? (
							<span
								className="truncate text-[13px] text-muted-foreground"
								title={description}
							>
								{description}
							</span>
						) : null}
					</div>
				</div>
			</TableCell>
			<TableCell className="w-64 text-right">
				<div className="flex flex-col items-end">
					<span className="tabular-nums">
						{plural(skill.sessionCount, "session")}
					</span>
					{skill.attribution ? (
						<MemberStack
							attribution={skill.attribution}
							className="mt-0.5 *:data-[slot=avatar]:ring-(--dashboard-01-content-background) dark:*:data-[slot=avatar]:ring-(--dashboard-01-content-background)"
						/>
					) : null}
				</div>
			</TableCell>
		</TableRow>
	);
}

/** Expanded row: the skill's numbers on the left, the start of its file on
 * the right, and the way into its own page. */
function SkillDrawer({
	skill,
	onOpen,
}: {
	skill: HistoricalSkillSummary;
	onOpen: () => void;
}) {
	return (
		// pb-6 matches pt-6, so the file preview, which runs the drawer's full
		// height, sits as far from its bottom edge as from its top.
		<DrawerRow colSpan={COLUMN_COUNT} className="pt-6 pb-6">
			<DrawerColumns
				stretch
				overview={
					<>
						<div className="grid grid-cols-2 gap-4">
							<Meta label="Sessions" value={formatCount(skill.sessionCount)} />
							<Meta
								label="Members"
								value={
									skill.attribution ? (
										<MemberStack attribution={skill.attribution} />
									) : (
										<MetaEmpty />
									)
								}
							/>
							<Meta
								label="Claude sessions"
								value={formatCount(skill.claudeSessionCount)}
							/>
							<Meta
								label="Codex sessions"
								value={formatCount(skill.codexSessionCount)}
							/>
						</div>
						<Button
							variant="secondary"
							size="sm"
							className={cn("self-start", DRAWER_BUTTON_CLASS)}
							onClick={(event) => {
								event.stopPropagation();
								onOpen();
							}}
						>
							Open skill
							<IconArrowUpRight />
						</Button>
					</>
				}
			>
				<SkillFilePreview
					content={skill.contentPreview}
					versionCount={skill.versionCount}
				/>
			</DrawerColumns>
		</DrawerRow>
	);
}

const MEMBER_STACK_LIMIT = 6;

/** Up to six of the skill's top members as overlapping avatars, the rest as a
 * "+N" chip. Rings in the surface's colour cut each avatar from the next: the
 * drawer's tint by default; `className` can recolour them. */
function MemberStack({
	attribution,
	className,
}: {
	attribution: NonNullable<HistoricalSkillSummary["attribution"]>;
	className?: string;
}) {
	const { userMap, avatarMap } = useUserMap();
	const shown = attribution.topUsers.slice(0, MEMBER_STACK_LIMIT);
	const hidden = Math.max(0, attribution.userCount - shown.length);
	return (
		<AvatarGroup
			role="group"
			aria-label={plural(attribution.userCount, "member")}
			className={cn(
				"-space-x-1.5 *:data-[slot=avatar]:ring-neutral-100 dark:*:data-[slot=avatar]:ring-card",
				className,
			)}
		>
			{shown.map((user) => (
				<Avatar
					key={user.userId}
					size="sm"
					title={userMap[user.userId]}
					// Translucent rings need no blending; blend layers in every row
					// make the browser repaint the page as a row's hover tint changes.
					className="bg-background after:border-black/5 after:mix-blend-normal dark:after:border-white/10 dark:after:mix-blend-normal"
				>
					{avatarMap[user.userId] ? (
						<AvatarImage
							alt=""
							src={avatarMap[user.userId]}
							decoding="async"
							loading="lazy"
						/>
					) : null}
					<AvatarFallback className="bg-muted">
						<IconUser
							aria-hidden="true"
							className="size-3 text-muted-foreground"
						/>
					</AvatarFallback>
				</Avatar>
			))}
			{hidden > 0 ? (
				<AvatarGroupCount className="bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums ring-neutral-100 w-auto min-w-6 dark:ring-card">
					+{formatCount(hidden)}
					<span className="sr-only"> more members</span>
				</AvatarGroupCount>
			) : null}
		</AvatarGroup>
	);
}

/** The start of the skill's SKILL.md, rendered as on its own page but in
 * smaller type, with its version count in the top right corner. It takes the
 * drawer's height rather than adding to it: the text sits out of flow and
 * fades out at the bottom edge. */
function SkillFilePreview({
	content,
	versionCount,
}: {
	content: string | null;
	versionCount: number | undefined;
}) {
	return (
		// The session reader's text column width (its 75ch at text-sm), against
		// the drawer's right edge.
		<div className="relative ml-auto h-full min-h-40 w-full max-w-[calc(75ch-5rem)] overflow-hidden rounded-[12px] bg-card text-sm shadow-(--custom-outline-shadow)">
			<div className="absolute inset-0 px-4 py-3">
				{versionCount === undefined ? null : (
					// Floated so the text wraps around it; pulled 6px from the
					// card's corner, its 6px radius is concentric with the card's 12px.
					<span className="float-right -mt-1.5 -mr-2.5 ml-3 flex h-6 items-center rounded-[6px] bg-muted px-2 text-[11px] tabular-nums text-muted-foreground">
						{versionCount === 1
							? "1 version"
							: `${formatCount(versionCount)} versions`}
					</span>
				)}
				{content ? (
					<RichSkillDocument
						content={content}
						variant="preview"
						className="text-xs/[18px]! [&_p]:mb-1.5!"
					/>
				) : (
					<p className="text-xs text-muted-foreground">
						No copy of this skill’s file yet.
					</p>
				)}
			</div>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-card to-transparent"
			/>
		</div>
	);
}
