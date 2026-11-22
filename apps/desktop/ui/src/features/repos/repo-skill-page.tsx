import type { CostDashboardInput, SessionAnalytics } from "@rudel/api-routes";
import {
	IconChartAreaLineFilled,
	IconChevronRight,
	IconRoute,
} from "@tabler/icons-react";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { SkillMark } from "@/components/skill-mark";
import { useDateRange } from "@/features/analytics/date-range/useDateRange";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { CostDashboardView } from "@/features/costs/cost-dashboard-page";
import { useSessionRowsCostDashboard } from "@/features/costs/use-cost-dashboard";
import { SESSION_OVERVIEW_SURFACE_CLASS_NAME } from "@/features/sessions/components/sessions-overview-table-utils";
import { SessionReaderStepDetail } from "@/features/sessions/reader/detail/step/session-reader-step-detail";
import { ShellNavIcon } from "@/features/shell/components/shell-nav-icon";
import { shellRouteMap } from "@/features/shell/config/shell-routes";
import { useCurrentShellRoute } from "@/features/shell/hooks/useCurrentShellRoute";
import { useShellHeaderPortal } from "@/features/shell/shell-header-portal";
import { HistoricalSkillDetailContent } from "@/features/skills/components/historical-skill-detail-content";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { PillTabs } from "./pill-tabs";
import type { SkillTracePick } from "./repo-skill-run-waterfall";
import { RepoSkillSessions } from "./repo-skill-sessions";
import { buildSessionsDashboard } from "./skill-dashboard";
import { fetchSessionRows, sessionRowsKey } from "./use-sessions-overview";

const PANE_TABS = [
	{ id: "data", label: "Data", icon: IconChartAreaLineFilled },
	{ id: "traces", label: "Agent traces", icon: IconRoute },
] as const;
type PaneTab = (typeof PANE_TABS)[number]["id"];

/**
 * One skill, full page: its numbers and trends over the range and the agent
 * runs that used it, one tab each on the left (`?view=`), beside the skill
 * file on the right. Scoped to one repo when `repo` is given (Repos › repo ›
 * skill), across the workspace otherwise (Skills › skill).
 */
export function SkillPage({
	repo,
	skillName,
	onBackToList,
}: {
	repo?: { key: string; name: string; onBack: () => void };
	skillName: string;
	/** The breadcrumb's section crumb: back to the Repos or Skills list. */
	onBackToList: () => void;
}) {
	const repoKey = repo?.key;
	const { state: range } = useDateRange();
	const [searchParams, setSearchParams] = useSearchParams();
	const view: PaneTab =
		PANE_TABS.find(({ id }) => id === searchParams.get("view"))?.id ?? "data";
	// A step picked in an agent trace, apart from the skill's own, shares the
	// right side with the skill file; it belongs to the range it was read in.
	const stepScope = `${range.startDate}|${range.endDate}`;
	const [picked, setPicked] = useState<{
		scope: string;
		pick: SkillTracePick;
	} | null>(null);
	const pick =
		view === "traces" && picked?.scope === stepScope ? picked.pick : null;
	function selectView(next: PaneTab) {
		setPicked(null);
		setSearchParams((current) => {
			const params = new URLSearchParams(current);
			if (next === "data") params.delete("view");
			else params.set("view", next);
			params.delete("session");
			params.delete("turn");
			return params;
		});
	}
	const filter = useMemo(
		() => (repoKey ? { repoKey, skillName } : { skillName }),
		[repoKey, skillName],
	);
	const { userMap, avatarMap } = useUserMap();
	const build = useCallback(
		(rows: readonly SessionAnalytics[], input: CostDashboardInput) =>
			buildSessionsDashboard(rows, input, {
				names: userMap,
				avatars: avatarMap,
			}),
		[userMap, avatarMap],
	);
	const dashboard = useSessionRowsCostDashboard({
		key: sessionRowsKey(filter),
		fetchRows: (rowsRange, signal) =>
			fetchSessionRows(filter, rowsRange, signal),
		build,
	});
	// The rows hold every metric, so each card reads the same answer.
	const previews = dashboard.query.data
		? Object.fromEntries(
				dashboard.metrics.map((metric) => [metric, dashboard.query.data]),
			)
		: undefined;
	const skill = useAnalyticsQuery(
		orpc.analytics.skills.detail.queryOptions({ input: { name: skillName } }),
	);

	return (
		// Data and agent traces tabbed on the left, the skill file down the whole
		// right side (100px under half the page); each pane scrolls on its own.
		<div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-y-auto overscroll-none md:grid-cols-[minmax(0,1fr)_minmax(0,calc(50%-100px))] md:overflow-hidden">
			<SkillHeader
				repo={repo}
				skillName={skillName}
				onBackToList={onBackToList}
			/>
			<div className="flex h-[calc(100dvh-3.5rem)] min-h-0 min-w-0 flex-col md:h-auto">
				<h1 className="sr-only">{skillName}</h1>
				<PillTabs
					tabs={PANE_TABS}
					value={view}
					onChange={selectView}
					label="Skill views"
					className="pr-[calc(var(--space-xxl)*4/3)] pl-xxl"
				/>
				{/* The workspace dashboard over this skill's sessions (in the repo):
				    the same cards, chart and breakdowns, computed from the rows.
				    Kept mounted on the Agent traces tab, so its range controls stay in
				    the header. */}
				<section
					aria-label="Skill usage"
					className={cn(
						"flex min-h-0 flex-1 flex-col",
						view !== "data" && "hidden",
					)}
				>
					<CostDashboardView
						dashboard={dashboard}
						previews={previews}
						scope="repository"
						breakdownLayout="row"
					/>
				</section>
				{view === "traces" ? (
					<section
						aria-label="Agent runs that used this skill"
						className={cn(
							SESSION_OVERVIEW_SURFACE_CLASS_NAME,
							"[&_[data-conversation-trace-scroll-container]]:overscroll-none",
						)}
					>
						<RepoSkillSessions
							repoKey={repoKey}
							skillName={skillName}
							range={range}
							onStepSelect={(next) =>
								setPicked(next ? { scope: stepScope, pick: next } : null)
							}
						/>
					</section>
				) : null}
			</div>
			{/* The skill file floats in a card, inset 16px, as the session
			    reader's inspector does: full height, scrolling inside. A step
			    picked in an agent trace takes the top half above it, in the
			    reader's own step panel, until the pick goes back to the skill. */}
			<section
				aria-label="Skill file"
				className={cn(
					SESSION_OVERVIEW_SURFACE_CLASS_NAME,
					"h-[calc(100dvh-3.5rem)] gap-xl p-xl md:h-auto",
				)}
			>
				{pick?.kind === "step" ? (
					<SessionReaderStepDetail fit {...pick.selection} />
				) : pick?.kind === "skill" ? (
					<SkillFileCard key={pick.name} name={pick.name} />
				) : null}
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden corner-m bg-surface shadow-card corner-squircle squircle:corner-xl">
					<HistoricalSkillDetailContent
						key={skillName}
						detail={skill.data}
						isError={skill.isError}
						isPending={skill.isPending}
						previewContent={null}
						variant="card"
						onRetry={() => {
							void skill.refetch();
						}}
					/>
				</div>
			</section>
		</div>
	);
}

/** `[icon] Repos › [repo] name › [skill] name` (or `[icon] Skills › [skill]
 * name`) in the shell header, each earlier crumb leading back. */
function SkillHeader({
	repo,
	skillName,
	onBackToList,
}: {
	repo: { name: string; onBack: () => void } | undefined;
	skillName: string;
	onBackToList: () => void;
}) {
	const headerPortal = useShellHeaderPortal();
	const shellRoute = useCurrentShellRoute();
	if (!headerPortal) return null;
	const crumbClassName =
		"flex shrink-0 items-center gap-m text-ink-3 transition-colors hover:text-ink focus-outline";
	const separator = (
		<IconChevronRight
			aria-hidden="true"
			className="size-4 shrink-0 text-ink-disabled"
			stroke={1.5}
		/>
	);
	return createPortal(
		<nav
			aria-label="Skill breadcrumb"
			// design-escape-ok(type): shipped value; -0.025em title tracking
			className="flex min-w-0 flex-1 items-center gap-s text-body-xxl font-medium tracking-[-0.025em]"
		>
			<button
				type="button"
				onClick={onBackToList}
				data-fluid-menu-root=""
				className={crumbClassName}
			>
				<ShellNavIcon
					icon={shellRoute.icon}
					activeIcon={shellRoute.activeIcon}
					active={false}
					tone={shellRoute.tone}
				/>
				{shellRoute.title}
			</button>
			{separator}
			{repo ? (
				<>
					<button
						type="button"
						onClick={repo.onBack}
						data-fluid-menu-root=""
						className={cn(crumbClassName, "min-w-0 shrink gap-s")}
					>
						<ShellNavIcon
							icon={shellRouteMap.repos.icon}
							activeIcon={shellRouteMap.repos.activeIcon}
							active={false}
							tone={shellRoute.tone}
						/>
						<span className="truncate">{repo.name}</span>
					</button>
					{separator}
				</>
			) : null}
			<span aria-current="page" className="flex min-w-0 items-center gap-s">
				{/* The skill's own mark, as on its row in the skills table. */}
				<SkillMark
					skill={skillName}
					// design-escape-ok(type): shipped value; 10px on the title's 1.5 line
					className="size-4.5 text-body-xs leading-[1.5]"
				/>
				<span className="truncate">{skillName}</span>
			</span>
		</nav>,
		headerPortal,
	);
}

/** Another skill's file, picked from a trace: the card the skill's own file
 * sits in, above it. */
function SkillFileCard({ name }: { name: string }) {
	const skill = useAnalyticsQuery(
		orpc.analytics.skills.detail.queryOptions({ input: { name } }),
	);
	return (
		<section
			aria-label={`${name} skill file`}
			className="flex min-h-0 flex-1 flex-col overflow-hidden corner-m bg-surface shadow-card corner-squircle squircle:corner-xl"
		>
			<HistoricalSkillDetailContent
				detail={skill.data}
				isError={skill.isError}
				isPending={skill.isPending}
				previewContent={null}
				variant="card"
				onRetry={() => {
					void skill.refetch();
				}}
			/>
		</section>
	);
}
