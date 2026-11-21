import type {
	MomentKind,
	MomentPattern,
	Moments,
	NoticeableRun,
} from "@rudel/api-routes";
import { IconArrowLeft, IconCompass } from "@tabler/icons-react";
import {
	useInfiniteQuery,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { type KeyboardEvent, type ReactNode, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Reveal } from "@/app/ui/bones";
import { FluidMenuHover } from "@/app/ui/fluid-menu-hover";
import { PageEmptyState } from "@/components/dashboard/page-parts";
import { useDateRange } from "@/features/analytics/date-range/useDateRange";
import { DashboardDateControls } from "@/features/dashboard/components/DashboardDateControls";
import { useShellHeaderPortal } from "@/features/shell/shell-header-portal";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import {
	COMPASS_SAMPLE_RUN,
	KindsMenu,
	RowsSample,
	RunRow,
} from "./compass-moments";
import { PatternPane, PatternRow } from "./compass-patterns";
import { RunPane, RunPaneSample } from "./compass-run-detail";
import { CompassSettingsButton } from "./compass-settings";
import { useCompassAccess, useCompassEnabled } from "./use-compass-access";
import "@/features/costs/cost-dashboard.css";
import "./compass.css";
import { FlowNumber } from "@/app/ui/flow-number";
import { PLAIN_NUMBER } from "@/lib/figure";

const PAGE_SIZE = 100;

type View = "runs" | "patterns";

/**
 * Compass, as an inbox: on the left what was noticed in the range (runs a
 * flag marks, or the patterns their observations form), filtered by flag
 * and by whose runs, with the settings for what to catch beside the
 * filters; on the right everything about the selected one.
 */
export function CompassPage() {
	const access = useCompassAccess();
	if (!access.pending && !access.enabled)
		return (
			<div className="cost-page isolate antialiased">
				<PageEmptyState
					icon={IconCompass}
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
	const allowed = useCompassEnabled();
	const { state: range } = useDateRange();
	const [view, setView] = useState<View>("runs");
	const [kinds, setKinds] = useState<MomentKind[]>([]);
	const [mine, setMine] = useState(false);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [selectedPatternId, setSelectedPatternId] = useState<string | null>(
		null,
	);
	// On a narrow page the list and the detail take turns; this is the detail's turn.
	const [reading, setReading] = useState(false);

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
		enabled: allowed && !!organizationId,
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
		enabled: allowed && !!organizationId,
		staleTime: 60_000,
	});
	const firstPage = list.data?.pages[0];
	const runs = useMemo(
		() => list.data?.pages.flatMap((page) => page.noticeable) ?? [],
		[list.data],
	);
	const patternList = patterns.data?.patterns ?? [];
	// The selection, or the first row while nothing is selected (or it left the list).
	const selectedRun: NoticeableRun | undefined =
		runs.find((run) => run.id === selectedRunId) ?? runs[0];
	const selectedPattern: MomentPattern | undefined =
		patternList.find((pattern) => pattern.id === selectedPatternId) ??
		patternList[0];
	const noticeable = firstPage?.days.reduce(
		(total, day) => total + day.count,
		0,
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

	const selectRun = (run: NoticeableRun) => {
		setSelectedRunId(run.id);
		setReading(true);
	};
	const selectPattern = (pattern: MomentPattern) => {
		setSelectedPatternId(pattern.id);
		setReading(true);
	};
	const onRowKey = arrowKeys((step) => {
		if (view === "runs") {
			const next =
				runs[runs.findIndex((run) => run.id === selectedRun?.id) + step];
			if (next) setSelectedRunId(next.id);
		} else {
			const next =
				patternList[
					patternList.findIndex(
						(pattern) => pattern.id === selectedPattern?.id,
					) + step
				];
			if (next) setSelectedPatternId(next.id);
		}
	});

	return (
		<div className="cost-page compass-page isolate antialiased">
			{headerPortal ? createPortal(rangeControls, headerPortal) : null}
			{headerPortal ? null : (
				<section className="cost-page-toolbar" aria-label="Compass controls">
					{rangeControls}
				</section>
			)}
			<div className="compass-split" data-reading={reading || undefined}>
				<section className="compass-list-pane" aria-label="Noticed">
					<div className="compass-pane-toolbar" data-fluid-menu-root="">
						<FluidMenuHover items="button" />
						<div className="compass-tabs" role="tablist">
							<button
								type="button"
								role="tab"
								aria-selected={view === "runs"}
								className="text-button"
								onClick={() => setView("runs")}
							>
								Runs
								{noticeable === undefined ? null : (
									<span className="compass-tab-count">
										<FlowNumber value={noticeable} format={PLAIN_NUMBER} />
									</span>
								)}
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={view === "patterns"}
								className="text-button"
								onClick={() => setView("patterns")}
							>
								Patterns
								{patterns.data ? (
									<span className="compass-tab-count">
										{patterns.data.patterns.length}
									</span>
								) : null}
							</button>
						</div>
						<div className="compass-toolbar-controls">
							{view === "runs" ? (
								<>
									<button
										type="button"
										className="text-button"
										aria-pressed={mine}
										onClick={() => setMine((value) => !value)}
										title={
											mine ? "Showing your runs" : "Showing everyone’s runs"
										}
									>
										{mine ? "Mine" : "Everyone"}
									</button>
									<KindsMenu
										kinds={kinds}
										counts={firstPage?.counts}
										onChange={setKinds}
									/>
								</>
							) : null}
							<CompassSettingsButton />
						</div>
					</div>
					{view === "runs" && (list.isPending || firstPage) ? (
						<Reveal
							className="shrink-0"
							label="Counting noticed runs"
							loading={list.isPending}
							sample={
								<p className="compass-list-summary">82 of 493 runs noticed</p>
							}
							sampleId="compass-summary"
						>
							{() => (
								<p className="compass-list-summary">
									{noticeable === undefined ? null : (
										<FlowNumber value={noticeable} />
									)}{" "}
									of {firstPage ? <FlowNumber value={firstPage.runs} /> : null}{" "}
									runs noticed
								</p>
							)}
						</Reveal>
					) : null}
					<ListBody>
						{view === "runs" ? (
							!list.isPending && list.isError ? (
								<p className="compass-empty">{list.error.message}</p>
							) : !list.isPending && runs.length === 0 ? (
								<p className="compass-empty">
									{kinds.length > 0 || mine
										? "No matching runs."
										: "Nothing noticed in this range. A run shows up here when one of the flags under the settings button marks it."}
								</p>
							) : (
								<Reveal
									label="Loading runs"
									loading={list.isPending}
									sample={<RowsSample />}
									sampleId="compass-runs"
									key="compass-runs"
								>
									{() => (
										<>
											{runs.map((run) => (
												<RunRow
													key={run.id}
													run={run}
													selected={run.id === selectedRun?.id}
													onSelect={() => selectRun(run)}
													onKeyDown={onRowKey}
												/>
											))}
											{list.hasNextPage ? (
												<div className="compass-more">
													<button
														type="button"
														className="text-button"
														disabled={list.isFetchingNextPage}
														onClick={() => {
															void list.fetchNextPage();
														}}
													>
														{list.isFetchingNextPage
															? "Loading…"
															: "Show more runs"}
													</button>
												</div>
											) : null}
										</>
									)}
								</Reveal>
							)
						) : !patterns.isPending && patterns.isError ? (
							<p className="compass-empty">{patterns.error.message}</p>
						) : !patterns.isPending && patternList.length === 0 ? (
							<p className="compass-empty">
								Patterns form from observed runs. Observe a few noticeable runs,
								then come back.
							</p>
						) : (
							<Reveal
								label="Loading patterns"
								loading={patterns.isPending}
								sample={<RowsSample />}
								sampleId="compass-patterns"
								key="compass-patterns"
							>
								{() =>
									patternList.map((pattern) => (
										<PatternRow
											key={pattern.id}
											pattern={pattern}
											selected={pattern.id === selectedPattern?.id}
											onSelect={() => selectPattern(pattern)}
											onKeyDown={onRowKey}
										/>
									))
								}
							</Reveal>
						)}
					</ListBody>
				</section>
				<section className="compass-detail-pane" aria-label="Detail">
					<button
						type="button"
						className="text-button compass-back"
						onClick={() => setReading(false)}
					>
						<IconArrowLeft aria-hidden="true" className="size-3.5" />
						Back to the list
					</button>
					{view === "runs" ? (
						selectedRun || list.isPending ? (
							<Reveal
								label="Loading the run"
								loading={!selectedRun}
								sample={<RunPaneSample run={COMPASS_SAMPLE_RUN} />}
								sampleId="compass-run"
							>
								{() =>
									selectedRun ? (
										<RunPane
											key={selectedRun.id}
											run={selectedRun}
											range={range}
											observable={observable && (firstPage?.observable ?? true)}
											onObserved={() => {
												void refresh();
											}}
										/>
									) : null
								}
							</Reveal>
						) : (
							<DetailEmpty
								text={list.isPending ? "" : "Pick a run to see what went on."}
							/>
						)
					) : selectedPattern ? (
						<PatternPane
							key={selectedPattern.id}
							pattern={selectedPattern}
							range={range}
							onFixed={() => {
								void refresh();
							}}
						/>
					) : (
						<DetailEmpty
							text={patterns.isPending ? "" : "No pattern to show yet."}
						/>
					)}
				</section>
			</div>
		</div>
	);
}

/** The scrolling list of rows. */
export function ListBody({ children }: { children: ReactNode }) {
	return (
		<div className="compass-list" data-fluid-menu-root="">
			<FluidMenuHover items="[data-compass-item]" />
			{children}
		</div>
	);
}

/** Arrow keys on a row move the selection and the focus to the next or previous row, as in an inbox. */
function arrowKeys(onArrow: (step: 1 | -1) => void) {
	return (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const step = event.key === "ArrowDown" ? 1 : -1;
		onArrow(step);
		const items = [
			...(event.currentTarget
				.closest(".compass-list")
				?.querySelectorAll<HTMLElement>("[data-compass-item]") ?? []),
		];
		items[items.indexOf(event.currentTarget) + step]?.focus();
	};
}

function DetailEmpty({ text }: { text: string }) {
	return (
		<div className="compass-detail-empty">
			<IconCompass aria-hidden="true" className="size-6" />
			<span>{text}</span>
		</div>
	);
}
