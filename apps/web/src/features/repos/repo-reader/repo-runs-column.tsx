import type { RepositoryRun, RepositoryRunsOf } from "@rudel/api-routes";
import { useQuery } from "@tanstack/react-query";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useLatestValueRef } from "@/app/hooks/useLatestValueRef";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/ui/tooltip";
import { Skeleton } from "@/components/dashboard/skeleton";
import { FluidList, useFluidListItem } from "@/components/fluid-list";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { sessionDetailInitialQueryOptions } from "@/features/sessions/components/session-detail-fast-query";
import type { NormalizedSessionDetailOverview } from "@/features/sessions/components/session-detail-fast-response";
import { useSessionDetailOverviewPages } from "@/features/sessions/components/use-session-detail-overview-pages";
import { ScrollColumn } from "@/features/sessions/reader/files/session-reader-files-parts";
import { SubagentChip } from "@/features/sessions/reader/subagents/session-reader-subagent-chip";
import { useSessionSubagents } from "@/features/sessions/reader/subagents/session-reader-subagent-marks";
import { SubagentTints } from "@/features/sessions/reader/subagents/session-reader-subagent-tints";
import { shortRunId } from "@/features/sessions/run-id";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { keepWhileRangeChanges, useRepoRangeInput } from "./repo-page-data";
import {
	type RailFigures,
	type RailFilter,
	useRailFilter,
} from "./repo-rail-highlight";

const STALE_TIME_MS = 5 * 60_000;
const PICKED_RUN_PARAM = "pickedRun";

export function runKeyOf(run: RepositoryRun) {
	return `${run.sessionId}:${run.agentId}:${run.turn}`;
}

function runFigures(run: RepositoryRun): RailFigures {
	return {
		sessions: 1,
		agentRuns: 1,
		cost: run.costUsd === undefined ? null : (run.costUsd ?? 0),
		unpricedRuns:
			run.costUsd === undefined ? null : run.costUsd === null ? 1 : 0,
		signals: null,
		mergedPullRequests: run.mergedPullRequests ?? null,
		ciRuns: run.ciRuns ?? null,
	};
}

const NO_FIGURES: RailFigures = {
	sessions: null,
	agentRuns: null,
	cost: null,
	unpricedRuns: null,
	signals: null,
	mergedPullRequests: null,
	ciRuns: null,
};

function sumFigures(runs: readonly RepositoryRun[]): RailFigures {
	const each = runs.map(runFigures);
	const total = (pick: (figures: RailFigures) => number | null) =>
		each.reduce<number | null>((sum, figures) => {
			const value = pick(figures);
			return sum === null || value === null ? null : sum + value;
		}, 0);
	return {
		sessions: new Set(runs.map((run) => run.sessionId)).size,
		agentRuns: runs.length,
		cost: total((figures) => figures.cost),
		unpricedRuns: total((figures) => figures.unpricedRuns),
		signals: null,
		mergedPullRequests: total((figures) => figures.mergedPullRequests),
		ciRuns: total((figures) => figures.ciRuns),
	};
}

export function usePickedRun() {
	const [searchParams, setSearchParams] = useSearchParams();
	const picked = searchParams.get(PICKED_RUN_PARAM);
	const pick = (key: string | null) =>
		setSearchParams(
			(params) => {
				if (key) params.set(PICKED_RUN_PARAM, key);
				else params.delete(PICKED_RUN_PARAM);
				params.delete("pickedCall");
				return params;
			},
			{ replace: true },
		);
	return [picked, pick] as const;
}

export const RAIL_SHELF =
	"-mr-5 flex min-h-0 shrink-0 flex-col gap-1 rounded-lg bg-muted/60 pr-5 shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.06)] corner-squircle squircle:rounded-3xl dark:bg-muted/15 dark:shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.06)]";

export const PICKED_ROW =
	"bg-card shadow-[0_0_0_0.5px_rgb(0_0_0/0.08),0_1px_2px_-0.5px_rgb(0_0_0/0.1),0_2px_6px_-2px_rgb(0_0_0/0.12)] dark:bg-muted-foreground/10 dark:shadow-(--custom-shadow)";

const COLUMN = cn(RAIL_SHELF, "w-[120px]");

function ShelfOutline() {
	return (
		<span
			aria-hidden="true"
			className="pointer-events-none absolute inset-y-4 right-0 left-4 rounded-xl border border-r-0 border-dashed corner-squircle squircle:rounded-4xl dark:border-border/50"
		/>
	);
}

export const RUNS_SHELF = "flex min-h-0 min-w-0 flex-1";

export function RepoRunsColumn({
	className,
	empty,
	label,
	of,
	repoKey,
	scope,
	sessions,
}: {
	className?: string;
	empty: string;
	label: string;
	of: RepositoryRunsOf | null;
	repoKey: string | undefined;
	scope?: { name: string; onClear?: () => void };
	sessions?: ReadonlySet<string> | null;
}) {
	return of ? (
		<RunsList
			scope={scope}
			sessions={sessions ?? null}
			className={className}
			empty={empty}
			label={label}
			of={of}
			repoKey={repoKey}
		/>
	) : (
		<section aria-label={label} className={cn(COLUMN, "relative", className)}>
			<ShelfOutline />
		</section>
	);
}

function RunsList({
	className,
	empty,
	label,
	of,
	repoKey,
	scope,
	sessions,
}: {
	className?: string;
	empty: string;
	label: string;
	of: RepositoryRunsOf;
	repoKey: string | undefined;
	scope?: { name: string; onClear?: () => void };
	sessions: ReadonlySet<string> | null;
}) {
	const range = useRepoRangeInput();
	const query = useAnalyticsQuery({
		...orpc.analytics.repositories.runs.queryOptions({
			input: { repoKey, of, range },
		}),
		staleTime: STALE_TIME_MS,
		placeholderData: keepWhileRangeChanges({ repoKey, of }),
	});
	const allRuns = query.data?.runs;
	const runs = useMemo(
		() =>
			sessions
				? allRuns?.filter((run) => sessions.has(run.sessionId))
				: allRuns,
		[allRuns, sessions],
	);
	const [visibleDays, setVisibleDays] = useState<ReadonlySet<string> | null>(
		null,
	);
	const listRef = useCallback(
		(list: HTMLUListElement | null) => {
			if (!list || !runs) return;
			const root = list.closest<HTMLElement>("[data-lazy-root]");
			const shown = new Set<Element>();
			const observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						if (entry.isIntersecting) shown.add(entry.target);
						else shown.delete(entry.target);
					}
					const next = new Set(
						[...shown].flatMap((item) => {
							const day = item.getAttribute("data-day");
							return day ? [day] : [];
						}),
					);
					setVisibleDays((current) =>
						current &&
						current.size === next.size &&
						[...next].every((day) => current.has(day))
							? current
							: next,
					);
				},
				{ root },
			);
			for (const item of list.children) observer.observe(item);
			return () => observer.disconnect();
		},
		[runs],
	);
	const runDays = useMemo(
		() =>
			runs ? new Set(runs.map((run) => run.startedAt.slice(0, 10))) : null,
		[runs],
	);
	const days = visibleDays ?? runDays;
	const [picked, pick] = usePickedRun();
	const pickedRun = runs?.find((run) => runKeyOf(run) === picked) ?? null;
	const pickedDay = pickedRun?.startedAt.slice(0, 10) ?? null;
	const pickedFigures = useMemo(
		() => (pickedRun ? runFigures(pickedRun) : null),
		[pickedRun],
	);
	const clearRef = useLatestValueRef(scope?.onClear);
	const scopeName = scope?.name ?? null;
	const canClear = Boolean(scope?.onClear);
	const loadedFigures = useMemo(
		() =>
			sessions && runs
				? sumFigures(runs)
				: (query.data?.figures ??
					(query.data && scopeName !== null ? NO_FIGURES : null)),
		[query.data, runs, scopeName, sessions],
	);
	const settled = useRef<{
		figures: RailFigures | null;
		runDays: ReadonlySet<string> | null;
	} | null>(null);
	useEffect(() => {
		if (!query.isPending) settled.current = { figures: loadedFigures, runDays };
	}, [loadedFigures, query.isPending, runDays]);
	const [slow, setSlow] = useState(false);
	useEffect(() => {
		if (!query.isPending) return;
		const timer = setTimeout(() => setSlow(true), 250);
		return () => {
			clearTimeout(timer);
			setSlow(false);
		};
	}, [query.isPending]);
	const figures = query.isPending
		? (settled.current?.figures ?? null)
		: loadedFigures;
	const focusRunDays = query.isPending
		? (settled.current?.runDays ?? null)
		: runDays;
	const filter = useMemo<RailFilter | null>(
		() =>
			scopeName === null
				? days && days.size > 0
					? {
							days,
							figures: pickedFigures,
							focus: pickedDay ?? undefined,
						}
					: null
				: {
						days: null,
						figures: pickedFigures ?? figures,
						focus: pickedDay ?? undefined,
						focusDays:
							pickedDay === null && focusRunDays ? focusRunDays : undefined,
						loading: query.isPending && slow,
						name: scopeName,
						onClear: canClear ? () => clearRef.current?.() : undefined,
					},
		[
			canClear,
			clearRef,
			days,
			figures,
			focusRunDays,
			pickedDay,
			pickedFigures,
			query.isPending,
			scopeName,
			slow,
		],
	);
	useRailFilter(filter);
	return (
		<section aria-label={label} className={cn(COLUMN, className)}>
			<ScrollColumn className="px-1.5 pt-2 pb-4">
				{query.isPending ? (
					<RunsSkeleton />
				) : query.isError ? (
					<p className="px-2 py-2 text-xs text-muted-foreground">
						Runs could not be read.
					</p>
				) : runs && runs.length > 0 ? (
					<FluidList>
						<ul ref={listRef} className="flex flex-col gap-0.5">
							{runs.map((run, index) => (
								<li key={runKeyOf(run)} data-day={run.startedAt.slice(0, 10)}>
									<RunRow
										index={index}
										isPicked={picked === runKeyOf(run)}
										onPick={() =>
											pick(picked === runKeyOf(run) ? null : runKeyOf(run))
										}
										run={run}
									/>
								</li>
							))}
						</ul>
					</FluidList>
				) : (
					<p className="px-2 py-2 text-xs text-muted-foreground">{empty}</p>
				)}
			</ScrollColumn>
		</section>
	);
}

function RunRow({
	index,
	isPicked,
	onPick,
	run,
}: {
	index: number;
	isPicked: boolean;
	onPick: () => void;
	run: RepositoryRun;
}) {
	const id = run.turnId ? shortRunId(run.turnId) : `Run ${run.turn}`;
	const item = useFluidListItem<HTMLButtonElement>(index);
	return (
		<button
			type="button"
			aria-current={isPicked || undefined}
			aria-label={run.agentId ? `Run ${id}, subagent` : `Run ${id}`}
			onClick={onPick}
			onFocus={item.onFocus}
			ref={item.ref}
			className={cn(
				"relative flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium tabular-nums outline-none transition-colors corner-squircle squircle:rounded-xl focus-visible:ring-2 focus-visible:ring-ring/50",
				isPicked ? PICKED_ROW : undefined,
			)}
		>
			<span className="truncate">{id}</span>
			{run.agentId ? (
				<RunSubagentChip
					selected={isPicked}
					sessionId={run.sessionId}
					subagentId={run.agentId}
				/>
			) : null}
		</button>
	);
}

const NO_SUBAGENTS: readonly string[] = [];

function RunSubagentChip({
	selected,
	sessionId,
	subagentId,
}: {
	selected: boolean;
	sessionId: string;
	subagentId: string;
}) {
	const [seen, setSeen] = useState(false);
	const ref = useCallback((element: HTMLSpanElement | null) => {
		if (!element) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				setSeen(true);
				observer.disconnect();
			}
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const initial = useQuery({
		...sessionDetailInitialQueryOptions(sessionId),
		enabled: seen,
	});
	const overview = initial.data?.overview;
	const chip = <SubagentChip selected={selected} subagentId={subagentId} />;
	return (
		<Tooltip>
			<TooltipTrigger render={<span ref={ref} className="flex shrink-0" />}>
				{overview ? (
					<SessionSubagentTints overview={overview}>
						{chip}
					</SessionSubagentTints>
				) : (
					<SubagentTints ids={NO_SUBAGENTS}>{chip}</SubagentTints>
				)}
			</TooltipTrigger>
			<TooltipContent>Subagent</TooltipContent>
		</Tooltip>
	);
}

function SessionSubagentTints({
	children,
	overview,
}: {
	children: ReactNode;
	overview: NormalizedSessionDetailOverview;
}) {
	const pages = useSessionDetailOverviewPages(overview);
	const turns = useMemo(
		() => pages.data.pages.flatMap((page) => page.turnPage.items),
		[pages.data.pages],
	);
	const { ids } = useSessionSubagents(turns, overview.subagents);
	return <SubagentTints ids={ids}>{children}</SubagentTints>;
}

const SKELETON_RUNS = Array.from({ length: 24 }, (_, index) => ({
	id: `run-${index}`,
	subagent: [0, 3, 4, 8, 11, 15, 19].includes(index),
}));

function RunsSkeleton() {
	return (
		<ul className="flex flex-col gap-0.5" aria-hidden="true">
			{SKELETON_RUNS.map((row) => (
				<li key={row.id} className="flex h-7 items-center gap-1.5 px-2">
					<Skeleton className="h-3 w-11 rounded-sm" />
					{row.subagent ? (
						<Skeleton className="size-4 shrink-0 rounded-full" />
					) : null}
				</li>
			))}
		</ul>
	);
}
