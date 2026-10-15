import type {
	MomentKind,
	MomentPattern,
	Moments,
	NoticeableRun,
} from "@rudel/api-routes";
import {
	IconBoltFilled,
	IconCircleCheckFilled,
	IconCompass,
	IconSparklesFilled,
	IconStack2Filled,
	type Icon as TablerIcon,
} from "@tabler/icons-react";
import {
	useInfiniteQuery,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { type CSSProperties, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { UsageStateMessage } from "@/components/usage-collection-view";
import { useDateRange } from "@/features/analytics/date-range/useDateRange";
import { SERIES_COLORS } from "@/features/costs/chart-colors";
import { MetricSparkline } from "@/features/costs/cost-chart";
import { DashboardDateControls } from "@/features/dashboard/components/DashboardDateControls";
import { formatReaderCost } from "@/features/sessions/components/session-reader-model";
import { useShellHeaderPortal } from "@/features/shell/shell-header-portal";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import {
	FlagGlyphs,
	flagLabels,
	MomentDialog,
	MomentsCard,
	momentHeadline,
} from "./compass-moments";
import { PatternDialog, PatternsCard } from "./compass-patterns";
import { useCompassAccess } from "./use-compass-access";
import "@/features/costs/cost-dashboard.css";
import "./compass.css";

const PAGE_SIZE = 100;
const DAY_MS = 86_400_000;

/**
 * Compass: where agent work went sideways and what keeps happening, as a
 * home page in the dashboard's design. Stat cards sum up the range; "Your
 * week" puts the reader's own three most telling moments first; the Moments
 * card lists every moment the rules found, and the Patterns card groups
 * their observations. A row opens its moment or pattern in a dialog.
 */
export function CompassPage() {
	const access = useCompassAccess();
	if (!access.pending && !access.enabled)
		return (
			<div className="cost-page isolate antialiased">
				<UsageStateMessage
					icon={<IconCompass aria-hidden="true" />}
					title="Compass isn’t enabled for this workspace"
					description="Compass is in early access for a few workspaces."
				/>
			</div>
		);
	return <CompassView observable={access.observations} />;
}

function CompassView({ observable }: { observable: boolean }) {
	const queryClient = useQueryClient();
	const { state: organization } = useOrganization();
	const organizationId = organization.activeOrg?.id;
	const { state: range } = useDateRange();
	const [kinds, setKinds] = useState<MomentKind[]>([]);
	const [mine, setMine] = useState(false);
	const [openMoment, setOpenMoment] = useState<NoticeableRun | null>(null);
	const [openPattern, setOpenPattern] = useState<MomentPattern | null>(null);

	const listOptions = orpc.analytics.moments.list.infiniteOptions({
		input: (offset: number) => ({
			startDate: range.startDate,
			endDate: range.endDate,
			kinds,
			mine,
			limit: PAGE_SIZE,
			offset,
		}),
		initialPageParam: 0,
		getNextPageParam: (last: Moments) => last.nextOffset ?? undefined,
	});
	const list = useInfiniteQuery({
		...listOptions,
		queryKey: ["org", organizationId, ...listOptions.queryKey],
		enabled: !!organizationId,
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[1] === organizationId ? previous : undefined,
		staleTime: 60_000,
	});
	const patternOptions = orpc.analytics.moments.patterns.queryOptions({
		input: { startDate: range.startDate, endDate: range.endDate },
	});
	const patterns = useQuery({
		...patternOptions,
		queryKey: ["org", organizationId, ...patternOptions.queryKey],
		enabled: !!organizationId,
		staleTime: 60_000,
	});
	const firstPage = list.data?.pages[0];
	const runs = useMemo(
		() => list.data?.pages.flatMap((page) => page.noticeable) ?? [],
		[list.data],
	);
	const refresh = () =>
		queryClient.invalidateQueries({
			predicate: (query) =>
				JSON.stringify(query.queryKey).includes('"moments"'),
		});

	const headerPortal = useShellHeaderPortal();
	const rangeControls = (
		<div
			className="cost-range-controls"
			data-fluid-menu-root=""
			data-in-header={headerPortal ? "" : undefined}
		>
			<FluidMenuHover items="button" />
			<DashboardDateControls sourceComponent="compass_date_picker" />
		</div>
	);

	return (
		<div className="cost-page compass-page isolate antialiased">
			{headerPortal ? createPortal(rangeControls, headerPortal) : null}
			{headerPortal ? null : (
				<section className="cost-page-toolbar" aria-label="Compass controls">
					{rangeControls}
				</section>
			)}
			<div className="cost-page-scroll">
				<div className="cost-page-content">
					<div className="cost-chart-panel">
						<StatCards
							range={range}
							runs={firstPage?.runs}
							days={firstPage?.days}
							patterns={patterns.data}
						/>
					</div>
					<YourWeek onOpen={setOpenMoment} />
					<div className="cost-breakdowns-container">
						<div className="compass-grid">
							<MomentsCard
								runs={runs}
								counts={firstPage?.counts}
								pending={list.isPending}
								error={list.isError ? list.error.message : null}
								kinds={kinds}
								onKindsChange={setKinds}
								mine={mine}
								onMineChange={setMine}
								hasMore={list.hasNextPage}
								loadingMore={list.isFetchingNextPage}
								onLoadMore={() => {
									void list.fetchNextPage();
								}}
								onOpen={setOpenMoment}
							/>
							<PatternsCard
								patterns={patterns.data?.patterns ?? []}
								pending={patterns.isPending}
								error={patterns.isError ? patterns.error.message : null}
								onOpen={setOpenPattern}
							/>
						</div>
					</div>
				</div>
			</div>
			<MomentDialog
				run={openMoment}
				range={range}
				observable={observable && (firstPage?.observable ?? true)}
				onClose={() => setOpenMoment(null)}
				onObserved={() => {
					void refresh();
				}}
			/>
			<PatternDialog
				pattern={openPattern}
				range={range}
				onClose={() => setOpenPattern(null)}
				onFixed={() => {
					setOpenPattern(null);
					void refresh();
				}}
			/>
		</div>
	);
}

/** The dashboard's stat cards, summing up the range. */
function StatCards({
	range,
	runs,
	days,
	patterns,
}: {
	range: { startDate: string; endDate: string };
	/** Runs in the range, flagged or not. */
	runs: number | undefined;
	days: Moments["days"] | undefined;
	patterns: { observed: number; patterns: MomentPattern[] } | undefined;
}) {
	const momentTotal = days?.reduce((total, day) => total + day.count, 0);
	const momentTrend = days ? dailySeries(range, days) : undefined;
	const observedTrend = patterns ? weeklyTotals(patterns.patterns) : undefined;
	const fixed = patterns?.patterns.filter((pattern) => pattern.fix).length;
	return (
		<fieldset className="cost-metrics" aria-label="Compass summary">
			<StatCard
				label="Noticeable runs"
				icon={IconBoltFilled}
				color={SERIES_COLORS[3] ?? ""}
				value={momentTotal}
				qualifier={
					runs === undefined ? undefined : `of ${runs.toLocaleString("en-US")}`
				}
				trend={momentTrend}
			/>
			<StatCard
				label="Observed"
				icon={IconSparklesFilled}
				color={SERIES_COLORS[4] ?? ""}
				value={patterns?.observed}
				trend={observedTrend}
			/>
			<StatCard
				label="Patterns"
				icon={IconStack2Filled}
				color={SERIES_COLORS[0] ?? ""}
				value={patterns?.patterns.length}
				trend={patterns ? [] : undefined}
			/>
			<StatCard
				label="Fixes"
				icon={IconCircleCheckFilled}
				color={SERIES_COLORS[2] ?? ""}
				value={fixed}
				trend={patterns ? [] : undefined}
			/>
		</fieldset>
	);
}

function StatCard({
	label,
	icon: Glyph,
	color,
	value,
	qualifier,
	trend,
}: {
	label: string;
	icon: TablerIcon;
	color: string;
	value: number | undefined;
	qualifier?: string;
	trend: number[] | undefined;
}) {
	return (
		<div
			className="cost-metric"
			style={{ "--metric-color": color } as CSSProperties}
		>
			<div className="cost-metric-header">
				<div className="cost-metric-label">
					<Glyph className="cost-metric-icon" aria-hidden="true" />
					<span>{label}</span>
				</div>
				{value === undefined ? (
					<div className="cost-skeleton cost-metric-skeleton" />
				) : (
					<span className="cost-metric-value">
						{qualifier ? (
							<small className="cost-metric-qualifier">{qualifier}</small>
						) : null}
						{value.toLocaleString("en-US")}
					</span>
				)}
			</div>
			<MetricSparkline values={trend} />
		</div>
	);
}

/**
 * The reader's own three most telling moments of the last seven days:
 * observed ones first, then the costliest. Hidden when there are none.
 */
function YourWeek({ onOpen }: { onOpen: (run: NoticeableRun) => void }) {
	const { state: organization } = useOrganization();
	const organizationId = organization.activeOrg?.id;
	const today = new Date();
	const input = {
		startDate: new Date(today.getTime() - 6 * DAY_MS)
			.toISOString()
			.slice(0, 10),
		endDate: today.toISOString().slice(0, 10),
		mine: true,
		limit: 200,
		offset: 0,
	};
	const options = orpc.analytics.moments.list.queryOptions({ input });
	const week = useQuery({
		...options,
		queryKey: ["org", organizationId, ...options.queryKey],
		enabled: !!organizationId,
		staleTime: 60_000,
	});
	// Observed runs first, then the runs most flags mark, then the costliest.
	const top = [...(week.data?.noticeable ?? [])]
		.filter((run) => !run.observation?.falsePositive)
		.sort(
			(a, b) =>
				Number(Boolean(b.observation)) - Number(Boolean(a.observation)) ||
				b.flags.length - a.flags.length ||
				(b.costUsd ?? 0) - (a.costUsd ?? 0),
		)
		.slice(0, 3);
	if (top.length === 0) return null;
	return (
		<section className="cost-breakdown" aria-label="Your week">
			<div className="cost-breakdown-heading">
				<h2>Your week</h2>
				<div>
					{top.length === 1
						? "One run worth a look"
						: `${top.length} runs worth a look`}
				</div>
			</div>
			<div className="compass-week" data-fluid-menu-root="">
				<FluidMenuHover items=".compass-week-item" />
				{top.map((run) => (
					<button
						key={run.id}
						type="button"
						className="compass-week-item"
						onClick={() => onOpen(run)}
					>
						<span className="compass-week-kind">
							<FlagGlyphs flags={run.flags} />
							<span className="truncate">{flagLabels(run)}</span>
						</span>
						<span className="compass-week-text">{momentHeadline(run)}</span>
						<span className="compass-row-when">
							{new Date(run.startedAt).toLocaleDateString(undefined, {
								weekday: "short",
								month: "short",
								day: "numeric",
							})}{" "}
							· {formatReaderCost(run.costUsd)}
							{run.observation ? " · Observed" : ""}
						</span>
					</button>
				))}
			</div>
		</section>
	);
}

/** Moments per day across the range, quiet days as zero. */
function dailySeries(
	range: { startDate: string; endDate: string },
	days: Moments["days"],
): number[] {
	const counts = new Map(days.map((day) => [day.date, day.count]));
	const series: number[] = [];
	const end = Date.parse(`${range.endDate}T00:00:00Z`);
	for (
		let day = Date.parse(`${range.startDate}T00:00:00Z`);
		day <= end && series.length < 400;
		day += DAY_MS
	)
		series.push(counts.get(new Date(day).toISOString().slice(0, 10)) ?? 0);
	return series;
}

/** Observations per week, summed over the patterns (every observation is in one). */
function weeklyTotals(patterns: MomentPattern[]): number[] {
	const totals = new Map<string, number>();
	for (const pattern of patterns)
		for (const week of pattern.weekly)
			totals.set(week.week, (totals.get(week.week) ?? 0) + week.count);
	return [...totals]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, count]) => count);
}
