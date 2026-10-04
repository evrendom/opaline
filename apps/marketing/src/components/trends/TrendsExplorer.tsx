import { MotionConfig, motion } from "motion/react";
import {
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { TrendsLiveSources } from "../../trends/assemble-trends-snapshot";
import {
	BENCHMARK_SECTIONS,
	type BenchmarkObservation,
	type BenchmarkSection,
	benchmarkObservations,
	paretoObservations,
	REASONING_EFFORTS,
	usageBenchmark,
} from "../../trends/trends-benchmarks";
import {
	formatCompact,
	formatDecimal,
	formatDuration,
	formatFullDay,
	formatInteger,
	formatPercent,
} from "../../trends/trends-format";
import { QUADRANT_GUIDES } from "../../trends/trends-quadrants";
import type {
	TrendsBenchmarkModel,
	TrendsModel,
	TrendsProvider,
	TrendsReasoningEffort,
	TrendsSnapshot,
} from "../../trends/trends-snapshot";
import { useLatestTrendsSnapshot } from "../../trends/use-latest-trends-snapshot";
import {
	BenchmarkBars,
	type ColumnSpread,
	type TradeoffGuide,
	TradeoffPlot,
	type TradeoffSeries,
} from "./trends-benchmark-charts";
import { modelColors, modelSize } from "./trends-colors";
import { exportChartPng } from "./trends-export";
import {
	HARNESS_MEASURES,
	HarnessBalance,
	type HarnessMeasure,
	HarnessTable,
	type HarnessView,
	harnessBalance,
	harnessMeasures,
} from "./trends-harness-chart";
import { ProviderMark } from "./trends-marks";
import {
	legendOrder,
	MAX_SHOWN,
	type ParetoEnds,
	type PickerModel,
	type PickerPreset,
	TrendsModelPicker,
} from "./trends-model-picker";
import {
	ChartCrossfade,
	TRENDS_SPRING,
	TrendsMotionProvider,
} from "./trends-motion";
import { type InspectedPeriod, ShareChart } from "./trends-plot-charts";
import { QuestionPicker } from "./trends-question-picker";
import { RankRows, type RankRowsGeometry } from "./trends-rank-rows";
import {
	harnessAddsOpaline,
	hasMeasurement,
	pushbackRate,
	type RankedSection,
	shareAddsOpaline,
	sharePeriods,
	TRENDS_SECTIONS,
	type TrendsSection,
} from "./trends-sections";
import { BenchmarkTable, FrictionTable, TrendsTable } from "./trends-table";
import { MonthlyLines } from "./trends-timeline-chart";
import "./trends-explorer.css";

interface ExplorerState {
	readonly mode: "benchmarks" | "wild";
	readonly benchmarkId: string;
	readonly wildId: string;
	readonly view: "chart" | "table";
	readonly log: boolean;
	/** "Pareto line": the frontier through the models on the chart. */
	readonly frontier: boolean;
	/** With the frontier on, hide every model and point off it. */
	readonly frontierOnly: boolean;
	/** Insight views name parts of the plot instead of showing its values:
	 * quadrants (the default), rows or columns; data shows every value. */
	readonly lens: Lens;
	readonly effortLabels: boolean;
	readonly modelLabels: boolean;
	/** Bars grouped per model or ranked one by one, lowest first either way. */
	readonly arrangement: "grouped" | "ranked";
	readonly efforts: ReadonlySet<TrendsReasoningEffort>;
	readonly modelIds: ReadonlySet<string>;
	/** Models kept in the list beside the chart, shown on it or not: the
	 * recommended ones to start with, plus any added from "Other models". */
	readonly listedIds: ReadonlySet<string>;
	readonly harnessMeasure: HarnessMeasure;
	readonly harnessView: HarnessView;
	/** Friction by model, every developer's: what counts (any of the
	 * three, summed) and what it is divided by. */
	readonly frictionCounts: ReadonlySet<FrictionKind>;
	readonly frictionPer: FrictionPer;
	/** Friction by model as columns, or as rows laid on their side. */
	readonly frictionLayout: FrictionLayout;
}

type FrictionKind = "swears" | "apologies" | "toolErrors";
type FrictionPer = "tokens" | "prompts";
type FrictionLayout = "columns" | "rows";
/** What friction can count, in the order its switch lists them. */
const FRICTION_KINDS = [
	{ id: "swears", tab: "User swearing" },
	{ id: "apologies", tab: "Model apology" },
	{ id: "toolErrors", tab: "Tool errors" },
] as const satisfies readonly {
	id: FrictionKind;
	tab: string;
}[];
// Below these, a model's rate rests on too little to rank.
const FRICTION_MIN_OUTPUT_TOKENS = 5_000_000;
const FRICTION_MIN_PROMPTS = 500;

const AA_URL =
	"https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index";
const SLOPALYTICS_URL = "https://slopalytics.com/usage";
const INDEX_NAME = "Intelligence index";
const INDEX_METHODOLOGY_URL =
	"https://artificialanalysis.ai/methodology/intelligence-benchmarking#artificial-analysis-intelligence-index";
// Icons for the chart titles' switches.
const COST_ICON = (
	<svg viewBox="0 0 16 16" aria-hidden="true">
		<path d="M8 2.25v11.5M10.75 5.1C10.4 4.2 9.35 3.6 8 3.6c-1.6 0-2.75.8-2.75 1.95 0 2.85 5.75 1.6 5.75 4.6 0 1.2-1.2 2.1-3 2.1-1.45 0-2.6-.65-3-1.6" />
	</svg>
);
const AXIS_ICONS: Record<string, ReactNode> = {
	"cost-intelligence": COST_ICON,
	"time-intelligence": (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<circle cx="8" cy="8" r="5.75" />
			<path d="M8 5v3.25l2.1 1.3" />
		</svg>
	),
};
const MEASURES = [
	{
		id: "tokens",
		tab: "Output tokens",
		icon: (
			<svg viewBox="0 0 16 16" aria-hidden="true">
				<path d="M8 2.25l5 2.88v5.74l-5 2.88-5-2.88V5.13z" />
				<path d="M8 5.75l2 1.15v2.2L8 10.25 6 9.1V6.9z" />
			</svg>
		),
	},
	{ id: "cost", tab: "Dollars", icon: COST_ICON },
] as const;
const SCOPES = [
	{ id: "task", tab: "per task" },
	{ id: "total", tab: "in total" },
] as const;
/** The benchmarks' two questions, each with its chart; the index links to
 * its methodology. */
const BENCHMARK_QUESTIONS = [
	{
		id: "scatter",
		lead: (
			<>
				<a
					className="trends-index-link"
					href={INDEX_METHODOLOGY_URL}
					target="_blank"
					rel="noreferrer"
				>
					{INDEX_NAME}
				</a>{" "}
				by
			</>
		),
		question: "How each model scored on the Intelligence Index",
	},
	{
		id: "bars",
		lead: "How many",
		question:
			"How many tokens/dollars each model used on the Intelligence Index",
	},
] as const;
/** In-the-wild choices in the chart titles, by section id. */
const SPLITS = [
	{ id: "runs", tab: "model" },
	{ id: "harnesses", tab: "harness" },
] as const;
/** Agent runs: how they go, drawn from every Opaline session. */
const BEHAVIOR_CHARTS = [
	{ id: "run-time-months", tab: "Wall-clock time" },
	{
		id: "tool-calls-months",
		tab: "Tool calls",
		info: "Every tool call between a prompt and the agent's answer: file reads and edits, shell commands, MCP tools, skills and subagent launches, plus the calls subagents make themselves. Runs without a call count as zero.",
	},
] as const;
/** Dev usage's usage question: who runs what (share) and how much
 * (volume). */
const USAGE_KINDS = [
	{ id: "share", tab: "Share" },
	{ id: "volume", tab: "Volume" },
] as const;
/** Dev usage's two questions, each with its chart: usage, and how it goes
 * (friction). */
const USAGE_QUESTIONS = [
	{
		id: "usage",
		lead: "",
		question: "Share and volume of coding agent usage, by model or harness",
	},
	{
		id: "friction",
		lead: "",
		question: "Friction by model, per 10M output tokens or 1k prompts",
	},
] as const;
const TRADEOFF_SECTIONS = BENCHMARK_SECTIONS.filter(
	(section) => section.kind === "connected",
);
/** A chart: a benchmark section or an in-the-wild one. */
interface ChartRef {
	readonly mode: ExplorerState["mode"];
	readonly id: string;
}
const benchmarkChart = (id: string): ChartRef => ({ mode: "benchmarks", id });
const wildChart = (id: string): ChartRef => ({ mode: "wild", id });
/**
 * The one menu: a tab per question, whatever its data source; each chart's
 * title picks the chart within its tab.
 */
const CHART_TABS: readonly {
	readonly id: string;
	/** The link's first segment: `#agent-runs/run-time-months`. */
	readonly route: string;
	readonly tab: string;
	readonly charts: readonly ChartRef[];
	/** The chart the tab opens on, when not its first. */
	readonly home?: string;
}[] = [
	{
		// One benchmark, laid out two ways (the toolbar flips them): the
		// scatter against the intelligence index, or the bars ranking tokens
		// and dollars.
		id: "benchmarks",
		route: "benchmarks",
		tab: "Benchmarks",
		charts: [
			...TRADEOFF_SECTIONS.map((section) => benchmarkChart(section.id)),
			...BENCHMARK_SECTIONS.filter((section) => section.kind === "bars").map(
				(section) => benchmarkChart(section.id),
			),
		],
	},

	{
		id: "behavior",
		route: "agent-runs",
		tab: "Agent runs",
		charts: BEHAVIOR_CHARTS.map((chart) => wildChart(chart.id)),
	},
	{
		id: "usage",
		route: "dev-usage",
		tab: "Dev usage",
		charts: ["runs", "harnesses", "volume", "friction-model"].map(wildChart),
		// Friction, OpenAI's and Anthropic's models side by side.
		home: "friction-model",
	},
];
/** The tabs as the navigation's breadcrumb names them, for the static copy
 * trends.astro paints before the explorer hydrates. */
export const TRENDS_NAV_TABS = CHART_TABS.map(({ route, tab }) => ({
	route,
	tab,
}));
/** The chart a tab opens on. */
function tabHome(tab: (typeof CHART_TABS)[number]) {
	return tab.charts.find((chart) => chart.id === tab.home) ?? tab.charts[0];
}
function chartTab(chart: ChartRef) {
	return (
		CHART_TABS.find((tab) =>
			tab.charts.some(
				(option) => option.mode === chart.mode && option.id === chart.id,
			),
		) ?? CHART_TABS[0]
	);
}

export function TrendsExplorer({
	snapshot,
	live,
}: {
	snapshot: TrendsSnapshot;
	/** The sources the build's kill switches leave real, for the refresh. */
	live: TrendsLiveSources;
}) {
	// The built snapshot first, then Opaline's latest stored sources.
	const latest = useLatestTrendsSnapshot(snapshot, live);
	return (
		<MotionConfig reducedMotion="user">
			<TrendsMotionProvider>
				<Explorer snapshot={latest} />
			</TrendsMotionProvider>
		</MotionConfig>
	);
}

function Explorer({ snapshot }: { snapshot: TrendsSnapshot }) {
	const initial = useMemo(() => defaultState(snapshot), [snapshot]);
	const [state, setState] = useState(initial);
	const [hashReady, setHashReady] = useState(false);
	// The charts' tabs' place in the site's navigation (trends.astro),
	// found once hydrated: the server renders it empty.
	const [navTrail, setNavTrail] = useState<HTMLElement | null>(null);
	useEffect(() => {
		setNavTrail(document.querySelector<HTMLElement>("[data-trends-nav-trail]"));
	}, []);
	const [pinnedFocusIds, setPinnedFocusIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	// A model whose row in the list is hovered: it takes the focus while the
	// pointer stays, over any picked on the chart.
	const [hoverFocusId, setHoverFocusId] = useState<string>();
	// A phone's layout: the chart first, the model list in a sheet.
	const narrow = useNarrowShell();
	// Which sheet a phone has open: its models, or the chart's settings.
	const [sheet, setSheet] = useState<"models" | "chart" | "data">();
	// The share or volume chart's hovered period, figure per model, shown in
	// the model list.
	const [inspected, setInspected] = useState<InspectedPeriod>();
	// Where friction's rows stand, for the model list to line up with.
	const [rankGeometry, setRankGeometry] = useState<RankRowsGeometry>();
	// The models being compared on the plot, if any: the list fades the rest.
	const [comparingIds, setComparingIds] = useState<ReadonlySet<string>>();
	// While the "All models" menu is open, hiding non-Pareto models pauses,
	// so models being added show on the chart even off the frontier.
	const [picking, setPicking] = useState(false);
	const [exporting, setExporting] = useState(false);
	const ranking = state.lens === "rows" || state.lens === "columns";
	const id = useId();
	const benchmarks = snapshot.benchmarks ?? [];
	// Recommended models anchor the lightness steps, so the plotted set is
	// spread evenly from darkest to lightest within each lab.
	const benchmarkColors = useMemo(() => {
		const anchors = recommendedIds(snapshot);
		return modelColors(
			(snapshot.benchmarks ?? []).map((model) => ({
				...model,
				group: anchors.has(model.id) ? "in_use" : "other",
				size: modelSize(model),
			})),
		);
	}, [snapshot]);
	const lab = state.mode === "benchmarks";
	const benchmarkSection =
		BENCHMARK_SECTIONS.find((section) => section.id === state.benchmarkId) ??
		BENCHMARK_SECTIONS[0];
	const pickedWildSection =
		TRENDS_SECTIONS.find((section) => section.id === state.wildId) ??
		TRENDS_SECTIONS[0];
	// Swearing by model reads the population and denominator picked in its
	// controls; every chart, table and ranking downstream sees the result.
	const wildSection =
		pickedWildSection?.id === "friction-model" &&
		pickedWildSection.kind === "ranked"
			? frictionSection(
					pickedWildSection,
					snapshot,
					state.frictionCounts,
					state.frictionPer,
				)
			: pickedWildSection;
	// The chart each tab last showed, so a tab returns to it.
	const currentChart: ChartRef = {
		mode: state.mode,
		id: lab ? benchmarkSection.id : wildSection.id,
	};
	const currentTab = chartTab(currentChart);
	const [tabCharts, setTabCharts] = useState<
		Readonly<Record<string, ChartRef>>
	>({});
	if (tabCharts[currentTab.id]?.id !== currentChart.id)
		setTabCharts({ ...tabCharts, [currentTab.id]: currentChart });
	// Usage's share split last shown, for its Share switch to return to, and
	// its usage chart last shown, for the question picker to return to.
	const [shareChart, setShareChart] = useState<string>(SPLITS[0].id);
	if (
		SPLITS.some((split) => split.id === wildSection.id) &&
		shareChart !== wildSection.id
	)
		setShareChart(wildSection.id);
	const [usageChart, setUsageChart] = useState<string>(SPLITS[0].id);
	if (
		(SPLITS.some((split) => split.id === wildSection.id) ||
			wildSection.id === "volume") &&
		usageChart !== wildSection.id
	)
		setUsageChart(wildSection.id);
	// The benchmarks' two layouts each remember their last chart, so flipping
	// back returns to it.
	const benchmarkBars = lab && benchmarkSection.kind === "bars";
	const layoutKey =
		currentTab.id === "benchmarks"
			? benchmarkBars
				? "bars"
				: "scatter"
			: undefined;
	const [layoutCharts, setLayoutCharts] = useState<
		Readonly<Partial<Record<"scatter" | "bars", ChartRef>>>
	>({});
	if (layoutKey && layoutCharts[layoutKey]?.id !== currentChart.id)
		setLayoutCharts({ ...layoutCharts, [layoutKey]: currentChart });
	const recommended = recommendedIds(snapshot);
	// Only the benchmark scatter charts draw a Pareto line. The By
	// intelligence and By cost views rank one axis at a time, and the bar
	// charts have no frontier, so neither draws it (nor offers it); the
	// setting itself is kept for when a chart that draws it comes back.
	const pareto =
		state.frontier && !ranking && lab && benchmarkSection.kind === "connected";
	// "Hide others" only applies with the Pareto line drawn: switching the
	// line off lets the hidden models fade back in while it retracts, as
	// they would with the option off.
	const frontierOnly = pareto && state.frontierOnly && !picking;
	// "Pareto line": the frontier through the models on the chart. The
	// frontier of every model is one quick pick away ("Pareto"), which puts
	// exactly its models on the chart and switches the line on.
	const frontierRows = pareto
		? paretoObservations(
				benchmarkObservations(
					benchmarks.filter((model) => state.modelIds.has(model.id)),
					benchmarkSection.metric,
					state.efforts,
					true,
				).filter((row) => !state.log || row.value > 0),
			)
		: [];
	const frontierModelIds = new Set(frontierRows.map((row) => row.model.id));
	// "Frontier" in All models: the newest model of each line from the
	// labs people code with most; their older models stay under the lab's
	// own name below.
	const newestOfLine = newestOfLines(benchmarks);
	const frontierLabIds = new Set(newestOfLine.map((model) => model.id));
	// The models on the Pareto frontier of every model available (for this
	// chart, its reasoning levels and scale), tagged in "All models" whether
	// the frontier is shown or not. Usage has no frontier of its own: it
	// offers Score's (the axis Score last showed) to pick models by, and
	// draws nothing from it.
	const paretoSection =
		lab && benchmarkSection.kind === "connected"
			? benchmarkSection
			: (TRADEOFF_SECTIONS.find(
					(option) => option.id === layoutCharts.scatter?.id,
				) ?? TRADEOFF_SECTIONS[0]);
	const availableParetoRows =
		lab && paretoSection
			? paretoObservations(
					benchmarkObservations(
						benchmarks,
						paretoSection.metric,
						state.efforts,
						true,
					).filter((row) => !state.log || row.value > 0),
				)
			: [];
	const availableParetoIds = new Set(
		availableParetoRows.map((row) => row.model.id),
	);
	// Quick picks above "All models", each capped like any selection.
	const capped = (ids: Iterable<string>) =>
		new Set([...ids].slice(0, MAX_SHOWN));
	const presets: readonly PickerPreset[] = [
		{
			id: "openai-anthropic",
			name: "OpenAI vs Anthropic",
			label: (
				<>
					<ProviderMark provider="openai" />
					<span className="trends-picker-preset-vs">vs</span>
					<ProviderMark provider="anthropic" />
				</>
			),
			// Benchmarks: each line's newest model. Usage charts: every
			// OpenAI and Anthropic model with data on the chart, the most used
			// first so the cap keeps them.
			ids: capped(
				(
					(lab
						? newestOfLine
						: wildSection?.kind === "share"
							? shareRanked(snapshot, benchmarks)
							: wildSection?.id === "friction-model"
								? frictionRanked(snapshot)
								: snapshot.models.filter(
										(model) =>
											(!wildSection || hasMeasurement(wildSection, model)) &&
											benchmarks.some((benchmark) => benchmark.id === model.id),
									)) as readonly { id: string; provider: TrendsProvider }[]
				)
					.filter(
						(model) =>
							model.provider === "openai" || model.provider === "anthropic",
					)
					.map((model) => model.id),
			),
		},
		{
			id: "pareto",
			name: "Pareto frontier of all models",
			label: "Pareto",
			ids: capped(availableParetoIds),
			frontier: true,
		},
		{
			id: "frontier-labs",
			name: "Frontier",
			label: "Frontier",
			ids: capped(frontierLabIds),
		},
	];
	const shownIds = new Set([...state.modelIds, ...frontierModelIds]);
	const visibleBenchmarks = benchmarks.filter((model) =>
		shownIds.has(model.id),
	);
	// The frontier's two ends, tagged in "All models": a brain for the model
	// holding its smartest point, a dollar (or clock) for the one holding its
	// cheapest (or fastest). Models in between are plain "Pareto".
	const smartestRow = availableParetoRows.reduce<
		(typeof availableParetoRows)[number] | undefined
	>(
		(best, row) =>
			!best ||
			(row.point.intelligenceIndex ?? 0) > (best.point.intelligenceIndex ?? 0)
				? row
				: best,
		undefined,
	);
	const cheapestRow = availableParetoRows.reduce<
		(typeof availableParetoRows)[number] | undefined
	>((best, row) => (!best || row.value < best.value ? row : best), undefined);
	const paretoEnds = new Map<string, ParetoEnds>(
		[...availableParetoIds].map((modelId) => [
			modelId,
			{
				smart: smartestRow?.model.id === modelId,
				cheap: cheapestRow?.model.id === modelId,
			},
		]),
	);
	const visibleModels = snapshot.models.filter((model) =>
		state.modelIds.has(model.id),
	);
	// Recommended models lead the list; every other model can be added.
	const usagePickerModels: readonly PickerModel[] = snapshot.models.map(
		(model) => ({
			id: model.id,
			name: model.name,
			provider: model.provider,
			recommended: recommended.has(model.id),
			color: benchmarkColors.get(model.id),
			size: modelSize(
				benchmarks.find((benchmark) => benchmark.id === model.id) ?? {},
			),
			releasedAt:
				benchmarks.find((benchmark) => benchmark.id === model.id)?.releasedAt ??
				null,
		}),
	);
	// One list for every tab, so switching charts never changes it: every
	// benchmarked model (the in-the-wild ones are among them). A chart leaves
	// out the models it has no figures for.
	const pickerModels: readonly PickerModel[] = [
		...usagePickerModels.filter((model) =>
			benchmarks.some((benchmark) => benchmark.id === model.id),
		),
		...benchmarks
			.filter((model) => !snapshot.models.some(({ id }) => id === model.id))
			.map((model) => ({
				id: model.id,
				name: model.name,
				provider: model.provider,
				recommended: recommended.has(model.id),
				color: benchmarkColors.get(model.id),
				size: modelSize(model),
				releasedAt: model.releasedAt,
			})),
	];
	const selected = new Set(
		pickerModels
			.filter((model) => shownIds.has(model.id))
			.map((model) => model.id),
	);
	// Agent runs draws every model together: its list is the models the
	// chart reads (every published one), fixed, whatever is picked elsewhere.
	const runsFixed = currentTab.id === "behavior";
	const runsModels = usagePickerModels;
	const runsModelIds = new Set(runsModels.map((model) => model.id));
	// Friction has figures only for the models Claude Code and Codex run.
	// Its list keeps to them (lined up with the rows, the rest would hang
	// below the chart), and its only quick pick is OpenAI vs Anthropic: the
	// benchmarks' Pareto and Frontier picks would add models it cannot draw.
	const frictionShown = !lab && wildSection?.id === "friction-model";
	const frictionIds = new Set(
		frictionShown
			? [
					...frictionFigures(
						snapshot,
						state.frictionCounts,
						state.frictionPer,
					).keys(),
				].filter((modelId) => benchmarks.some(({ id }) => id === modelId))
			: [],
	);
	// Only while its model is on the chart: a row unticked or removed under
	// the pointer lets go.
	const focusIds: ReadonlySet<string> =
		hoverFocusId && selected.has(hoverFocusId)
			? new Set([hoverFocusId])
			: pinnedFocusIds;
	const settings = (patch: Partial<ExplorerState>) =>
		setState((current) => ({ ...current, ...patch }));
	// Another chart has another frontier: start fresh. A selection nobody
	// changed follows the chart: friction opens on OpenAI vs Anthropic, the
	// rest on the default models.
	const showChart = (chart: ChartRef) => {
		const from = chartDefaultIds(currentChart, snapshot, initial);
		const to = chartDefaultIds(chart, snapshot, initial);
		const untouched =
			sameIds(state.modelIds, from) && sameIds(state.listedIds, from);
		settings({
			...(chart.mode === "benchmarks"
				? { mode: chart.mode, benchmarkId: chart.id }
				: { mode: chart.mode, wildId: chart.id }),
			...(untouched ? { modelIds: to, listedIds: to } : {}),
		});
		setPinnedFocusIds(new Set());
	};
	// The benchmarks' other layout, carrying the measure over: the cost
	// scatter and the dollar bars are one figure; time and pushback (scatter
	// only) and tokens (bars only) fall back to cost, or to the layout's last
	// chart.
	const flipBenchmarkLayout = (): ChartRef => {
		if (!benchmarkBars) {
			const lastBars = BENCHMARK_SECTIONS.find(
				(option) => option.id === layoutCharts.bars?.id,
			);
			const dollars =
				BENCHMARK_SECTIONS.find(
					(option) =>
						option.kind === "bars" &&
						option.measure === "cost" &&
						option.scope === (lastBars?.scope ?? "task"),
				)?.id ?? "cost-task";
			return benchmarkChart(
				currentChart.id === "cost-intelligence" || !lastBars
					? dollars
					: lastBars.id,
			);
		}
		if (benchmarkSection.measure === "cost")
			return benchmarkChart("cost-intelligence");
		return layoutCharts.scatter ?? benchmarkChart("cost-intelligence");
	};
	// A click focuses one model (again to clear); Shift, Cmd or Ctrl adds or
	// removes it from the focused set.
	const focusModel = (modelId: string, additive: boolean) => {
		// A hidden model can't come onto a full chart.
		if (!selected.has(modelId) && selected.size >= MAX_SHOWN) return;
		if (!selected.has(modelId))
			settings({
				modelIds: new Set([...state.modelIds, modelId]),
				listedIds: new Set([...state.listedIds, modelId]),
			});
		setPinnedFocusIds((current) => {
			if (additive) {
				const next = new Set(current);
				if (next.has(modelId)) next.delete(modelId);
				else next.add(modelId);
				return next;
			}
			return current.size === 1 && current.has(modelId)
				? new Set()
				: new Set([modelId]);
		});
	};

	// Hash and media only exist in the browser; apply them after hydration.
	useEffect(() => {
		const apply = () => {
			setState(stateFromHash(window.location.hash, initial, snapshot));
			setPinnedFocusIds(new Set());
			setHashReady(true);
		};
		apply();
		window.addEventListener("hashchange", apply);
		return () => window.removeEventListener("hashchange", apply);
	}, [initial, snapshot]);
	useEffect(() => {
		if (hashReady) window.history.replaceState(null, "", hashFromState(state));
	}, [state, hashReady]);

	if (!benchmarkSection || !wildSection) return null;
	// A model without this chart's figure is left out of it, never drawn at zero.
	const wildModels = visibleModels.filter((model) =>
		hasMeasurement(wildSection, model),
	);
	// The share by model draws every selected model: T3 Code's days, when
	// captured, cover models Opaline has no runs for.
	const shareFromT3 = (snapshot.modelDays?.length ?? 0) > 0;
	// Opaline's daily runs, where captured, add to T3 Code's turns.
	const shareWithOpaline =
		!lab && wildSection.kind === "share" && shareAddsOpaline(snapshot);
	const shareModels = pickerModels.filter((model) => selected.has(model.id));
	// Friction draws every selected model it has figures for.
	const frictionBarRows =
		wildSection.id === "friction-model"
			? frictionColumns(
					shareModels,
					benchmarks,
					frictionFigures(snapshot, state.frictionCounts, state.frictionPer),
				)
			: [];
	const wildUnit =
		wildSection.kind === "share" && shareFromT3
			? wildSection.measure === "volume"
				? "Daily turns among selected models"
				: "Daily share of turns among selected models"
			: wildSection.unit;
	const section: { id: string; unit: string } = lab
		? benchmarkSection
		: { ...wildSection, unit: wildUnit };
	const connected = lab
		? benchmarkSection.kind === "connected"
		: wildSection.kind === "scatter";
	const chartTabId = currentTab.id;
	const hasModels =
		(lab
			? visibleBenchmarks.length
			: wildSection.kind === "share"
				? shareModels.length
				: wildSection.id === "friction-model"
					? frictionBarRows.length
					: wildModels.length) > 0;
	const plotSeries = connected
		? lab
			? benchmarkSeries(visibleBenchmarks, benchmarkSection, state.efforts).map(
					(model) => ({ ...model, color: benchmarkColors.get(model.id) }),
				)
			: wildSeries(wildModels, snapshot, benchmarkColors)
		: [];
	const frontier = frontierRows.flatMap((row) =>
		plotSeries.flatMap((model) =>
			model.points.filter(
				(point) => point.id === `${row.model.id}-${row.point.effort}`,
			),
		),
	);
	const harnessDays = harnessBalance(
		snapshot.harnessDays ?? [],
		state.harnessMeasure,
	);
	const harnessSource = snapshot.sources.harnesses;
	const measures = harnessMeasures(harnessSource.kind);
	// The harness balance adds Opaline's own days to T3 Code's, measure by
	// measure.
	const withOpaline =
		shareWithOpaline ||
		(!lab &&
			wildSection.kind === "harness" &&
			harnessAddsOpaline(snapshot, state.harnessMeasure));
	// The harness balance has its own source and refresh date, and so has the
	// share by model when it draws T3 Code's days.
	const harnessShown = !lab && wildSection.kind === "harness";
	const t3Shown =
		harnessShown || (!lab && wildSection.kind === "share" && shareFromT3);
	const wildSourceName = t3Shown
		? harnessSourceName(harnessSource.kind)
		: snapshot.sources.usage.kind === "preview"
			? "Synthetic usage"
			: "Opaline sessions";
	const wildUpdated = t3Shown ? harnessSource.fetchedAt : snapshot.publishedAt;
	// An in-the-wild chart drawn from Opaline's sessions (not T3 Code's
	// days, not the synthetic preview).
	const opalineSourced =
		!lab && !t3Shown && snapshot.sources.usage.kind === "opaline";
	// One drawn from T3 Code's days, published by Slopalytics.
	const slopalyticsSourced = t3Shown && harnessSource.kind === "t3_code";
	const unit = connected
		? lab
			? `Intelligence index by ${benchmarkSection.unit.charAt(0).toLowerCase()}${benchmarkSection.unit.slice(1)}`
			: wildSection.unit
		: section.unit;
	const logApplies = connected && lab;

	// The scatter as a PNG card, named after the chart.
	const downloadChart = async () => {
		const container = document
			.getElementById(`${id}-chart-panel`)
			?.querySelector<HTMLElement>(
				".trends-tradeoff, .trends-benchmark-bars, .trends-balance, .trends-plot-frame",
			);
		if (!container) return;
		setExporting(true);
		try {
			await exportChartPng({
				container,
				title: unit,
				subtitle: [
					logApplies ? (state.log ? "Log scale" : "Linear scale") : null,
					pareto ? "Pareto frontier" : null,
					!connected || state.lens === "quadrants"
						? null
						: lensName(state.lens, tradeoffGuide(section.id), "caption"),
					lab && !connected
						? state.arrangement === "ranked"
							? "Ranked"
							: "Grouped"
						: null,
				]
					.filter(Boolean)
					.join(" · "),
				source: lab ? "Artificial Analysis" : wildSourceName,
				updated: formatFullDay(
					lab ? snapshot.sources.benchmarks.fetchedAt : wildUpdated,
				),
				fileName: `opaline-trends-${section.id}.png`,
			});
		} finally {
			setExporting(false);
		}
	};

	// What the chart shows, on its top right: insight quadrants, scale, the
	// chart's own options, the table and a PNG download.
	// Cost or time against intelligence, picked from the chart title or its
	// horizontal axis.
	const scoreAxes = [
		...TRADEOFF_SECTIONS.map((option) => ({
			chart: benchmarkChart(option.id),
			tab: option.axis ?? option.tab,
			icon: AXIS_ICONS[option.id],
			per: "per task",
		})),
	];
	const scoreAxis =
		scoreAxes.find((axis) => axis.chart.id === currentChart.id) ?? scoreAxes[0];
	const axisSwitch = (label: string) => (
		<Segmented
			label={label}
			variant="tag"
			options={scoreAxes.map((axis) => ({
				id: axis.chart.id,
				tab: axis.tab,
				icon: axis.icon,
			}))}
			selected={currentChart.id}
			onSelect={(chartId) => {
				const axis = scoreAxes.find((option) => option.chart.id === chartId);
				if (axis) showChart(axis.chart);
			}}
		/>
	);
	// An in-the-wild switch in a chart title: picks the tab's section.
	const wildSwitch = (label: string, options: readonly SegmentedOption[]) => (
		<Segmented
			label={label}
			variant="tag"
			options={options}
			selected={wildSection.id}
			onSelect={(sectionId) => showChart(wildChart(sectionId))}
		/>
	);
	// Usage's first word picks its chart: share (back to the split last
	// shown) or volume.
	const usageSwitch = (
		<Segmented
			label="Usage"
			variant="tag"
			options={USAGE_KINDS}
			selected={wildSection.id === "volume" ? "volume" : "share"}
			onSelect={(kind) =>
				showChart(wildChart(kind === "volume" ? "volume" : shareChart))
			}
		/>
	);
	// Dev usage's question, the whole title a picker: usage (back to the
	// chart last shown) or friction.
	const usageQuestion = (rest: ReactNode) => (
		<QuestionPicker
			questions={USAGE_QUESTIONS}
			selected={wildSection.id === "friction-model" ? "friction" : "usage"}
			onSelect={(question) =>
				showChart(
					wildChart(question === "friction" ? "friction-model" : usageChart),
				)
			}
		>
			{rest}
		</QuestionPicker>
	);
	// Tokens or cost, per task or over the full index run, picked in the bar
	// charts' title, which reads as a sentence: "How many Output tokens each model
	// used per task on the Intelligence Index".
	const barSection = (patch: {
		readonly measure?: string;
		readonly scope?: string;
	}) =>
		BENCHMARK_SECTIONS.find(
			(option) =>
				option.measure === (patch.measure ?? benchmarkSection.measure) &&
				option.scope === (patch.scope ?? benchmarkSection.scope),
		)?.id ?? benchmarkSection.id;
	// The benchmarks' question, its leading words a picker: what a model
	// scores for its cost (the scatter) or what it uses (the bars). Picking
	// one picks the chart; the measure carries over (cost to dollars and
	// back).
	const benchmarkQuestion = (rest: ReactNode) => (
		<QuestionPicker
			questions={BENCHMARK_QUESTIONS}
			selected={benchmarkBars ? "bars" : "scatter"}
			onSelect={(question) => {
				if ((question === "bars") !== benchmarkBars)
					showChart(flipBenchmarkLayout());
			}}
		>
			{rest}
		</QuestionPicker>
	);
	const usageSwitches = benchmarkQuestion(
		<>
			<Segmented
				label="Measure"
				variant="tag"
				options={MEASURES}
				selected={benchmarkSection.measure ?? ""}
				onSelect={(measure) =>
					showChart(benchmarkChart(barSection({ measure })))
				}
			/>{" "}
			each model used{" "}
			<Segmented
				label="Scope"
				variant="tag"
				options={SCOPES}
				selected={benchmarkSection.scope ?? ""}
				onSelect={(scope) => showChart(benchmarkChart(barSection({ scope })))}
			/>{" "}
			on the{" "}
			<a
				className="trends-index-link"
				href={INDEX_METHODOLOGY_URL}
				target="_blank"
				rel="noreferrer"
			>
				Intelligence Index
			</a>
		</>,
	);
	// Whose usage the share, volume and harness charts read: coding agents'
	// (T3 Code's, with Opaline's where captured; the footer names both), or
	// Opaline's agent runs alone.
	const usageSourceWords =
		withOpaline || harnessSource.kind === "t3_code"
			? "coding agent usage"
			: "agent runs";
	// The scatter's title: the question, what the index is set against, and
	// the scale.
	const scatterTitle = benchmarkQuestion(
		<>
			{axisSwitch("Compare with")} {scoreAxis.per},{" "}
			<Segmented
				label="Horizontal scale"
				variant="tag"
				options={[
					{ id: "log", tab: "log" },
					{ id: "linear", tab: "linear" },
				]}
				selected={state.log ? "log" : "linear"}
				onSelect={(scale) => settings({ log: scale === "log" })}
			/>{" "}
			scale
		</>,
	);
	// The chart's title as plain words, for a phone, where every switch is in
	// the sheet.
	const frictionWhat = FRICTION_KINDS.filter((kind) =>
		state.frictionCounts.has(kind.id),
	).map((kind) => kind.tab.toLowerCase());
	const plainTitle = connected
		? `Intelligence index by ${scoreAxis.tab.toLowerCase()} ${scoreAxis.per}, ${state.log ? "log" : "linear"} scale`
		: currentTab.id === "benchmarks" && benchmarkBars
			? `How many ${(MEASURES.find((entry) => entry.id === benchmarkSection.measure)?.tab ?? "").toLowerCase()} each model used ${SCOPES.find((entry) => entry.id === benchmarkSection.scope)?.tab ?? ""} on the Intelligence Index`
			: currentTab.id === "behavior"
				? `${BEHAVIOR_CHARTS.find((chart) => chart.id === wildSection.id)?.tab ?? ""} per agent run, by month, ${state.log ? "log" : "linear"} scale`
				: wildSection.id === "friction-model"
					? `${frictionWhat.length > 1 ? `${frictionWhat.slice(0, -1).join(", ")} and ${frictionWhat.at(-1)}` : (frictionWhat[0] ?? "")} by model per ${state.frictionPer === "tokens" ? "10M tokens" : "1k prompts"}`.replace(
							/^./,
							(first) => first.toUpperCase(),
						)
					: wildSection.id === "volume"
						? `Volume of ${usageSourceWords} by model`
						: currentTab.id === "usage"
							? `Share of ${usageSourceWords} by ${wildSection.kind === "harness" ? "harness" : "model"}`
							: unit;
	// Each tab's title: a sentence whose switches pick its chart.
	const titleSentence =
		currentTab.id === "benchmarks" && benchmarkBars ? (
			usageSwitches
		) : currentTab.id === "behavior" ? (
			// The definition, the measure and scale its switches; the axis
			// only marks months.
			<>
				{wildSwitch("Chart", BEHAVIOR_CHARTS)} per agent run, by month,{" "}
				<Segmented
					label="Scale"
					variant="tag"
					options={[
						{ id: "log", tab: "log" },
						{ id: "linear", tab: "linear" },
					]}
					selected={state.log ? "log" : "linear"}
					onSelect={(scale) => settings({ log: scale === "log" })}
				/>{" "}
				scale
			</>
		) : currentTab.id === "usage" ? (
			wildSection.id === "friction-model" ? (
				// What counts and what it is divided by stand in the title; the
				// footer names the source.
				usageQuestion(
					<>
						{/* Any of the three, summed; one stays on. */}
						<MultiSelect
							label="Counting"
							variant="tag"
							options={FRICTION_KINDS}
							selected={state.frictionCounts}
							onChange={(frictionCounts) => settings({ frictionCounts })}
						/>{" "}
						by model per{" "}
						<Segmented
							label="Per"
							variant="tag"
							options={[
								{ id: "tokens", tab: "10M tokens" },
								{ id: "prompts", tab: "1k prompts" },
							]}
							selected={state.frictionPer}
							onSelect={(per) => settings({ frictionPer: per as FrictionPer })}
						/>
					</>,
				)
			) : wildSection.id === "volume" ? (
				usageQuestion(
					<>
						{usageSwitch} of {usageSourceWords} by model
					</>,
				)
			) : (
				usageQuestion(
					<>
						{usageSwitch} of {usageSourceWords} by {wildSwitch("Split", SPLITS)}
					</>,
				)
			)
		) : (
			linkIndex(unit)
		);
	const wildBars =
		wildSection.id === "friction-model"
			? { rows: frictionBarRows, spreads: new Map<string, ColumnSpread>() }
			: wildColumns(wildSection, wildModels, benchmarks, snapshot);
	// Every chart's controls share one track, split by hairlines.
	const divider = (
		<span className="trends-controls-divider" aria-hidden="true" />
	);
	const viewControls = (
		<div
			className="trends-controls"
			role="toolbar"
			aria-label="Chart controls"
			data-joined="true"
		>
			{connected ? (
				<Segmented
					label="Insight view"
					options={LENSES.map((lens) => ({
						id: lens,
						tab: lensName(lens, tradeoffGuide(section.id)),
					}))}
					selected={state.lens}
					onSelect={(lens) => settings({ lens: lens as Lens })}
				/>
			) : null}
			{lab && !connected ? (
				<Segmented
					label="Arrangement"
					options={[
						{ id: "grouped", tab: "Grouped" },
						{ id: "ranked", tab: "Ranked" },
					]}
					selected={state.arrangement}
					onSelect={(arrangement) =>
						settings({
							arrangement: arrangement as ExplorerState["arrangement"],
						})
					}
				/>
			) : null}
			{!lab && wildSection.kind === "harness" ? (
				<>
					<Segmented
						label="View"
						options={[
							{ id: "split", tab: "Split" },
							{ id: "difference", tab: "Difference" },
						]}
						selected={state.harnessView}
						onSelect={(harnessView) =>
							settings({ harnessView: harnessView as HarnessView })
						}
					/>
					{divider}
					<Segmented
						label="Measure"
						options={measures}
						selected={state.harnessMeasure}
						onSelect={(measure) =>
							settings({ harnessMeasure: measure as HarnessMeasure })
						}
					/>
				</>
			) : null}
			{divider}
			<button
				type="button"
				className="trends-tool"
				data-icon-only="true"
				aria-label="Show as table"
				title="Show as table"
				aria-haspopup="dialog"
				onClick={() => settings({ view: "table" })}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<rect x="2" y="3" width="12" height="10" rx="2" />
					<path d="M2 6.5h12M2 9.75h12M6.25 6.5V13" />
				</svg>
			</button>
			{hasModels ? (
				<button
					type="button"
					className="trends-tool"
					data-icon-only="true"
					// A desktop tool: phones save the chart as a screenshot.
					data-export="png"
					aria-label="Download chart as PNG"
					title="Download as PNG"
					aria-busy={exporting}
					disabled={exporting}
					onClick={downloadChart}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M2.5 5.75c0-.69.56-1.25 1.25-1.25h1.5l1-1.5h3.5l1 1.5h1.5c.69 0 1.25.56 1.25 1.25v6c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25z" />
						<circle cx="8" cy="8.5" r="2.25" />
					</svg>
				</button>
			) : null}
		</div>
	);

	// The table lists the models the legend does (listed or on the chart),
	// faded where the legend fades them: off the chart, or off the frontier
	// while the Pareto line is drawn.
	const legendIds = new Set([...state.listedIds, ...selected]);
	const tableDimmedIds = new Set(
		[...legendIds].filter(
			(modelId) =>
				!selected.has(modelId) || (pareto && !frontierModelIds.has(modelId)),
		),
	);
	const table = lab ? (
		<BenchmarkTable
			section={benchmarkSection}
			models={benchmarks.filter((model) => legendIds.has(model.id))}
			efforts={state.efforts}
			dimmedIds={tableDimmedIds}
		/>
	) : wildSection.kind === "harness" ? (
		<HarnessTable
			days={harnessDays}
			measure={state.harnessMeasure}
			measures={measures}
		/>
	) : wildSection.id === "friction-model" && wildSection.kind === "ranked" ? (
		<FrictionTable
			unit={wildUnit}
			format={wildSection.format}
			rows={frictionBarRows.map((row) => ({
				id: row.model.id,
				// The bars name a thin model with an asterisk already.
				name: row.model.name.replace(/\*$/, ""),
				provider: row.model.provider,
				value: row.value,
				thin: row.model.name.endsWith("*"),
			}))}
			models={snapshot.models}
			thinNote={`* Fewer than ${state.frictionPer === "tokens" ? "5M output tokens" : `${FRICTION_MIN_PROMPTS} prompts`} so far.`}
		/>
	) : (
		<TrendsTable
			section={{ ...wildSection, unit: wildUnit }}
			snapshot={snapshot}
			models={wildModels}
			shareModels={shareModels}
		/>
	);

	// The model list and its settings: beside the chart, or on a phone in a
	// sheet of its own.
	// A phone's settings sheets as lists: every option of a choice in a row,
	// a filled circle marking the picked one (several, where several count).
	const scaleChoice = (
		<SheetChoice
			label="Scale"
			options={[
				{ id: "log", label: "Log" },
				{ id: "linear", label: "Linear" },
			]}
			selected={state.log ? "log" : "linear"}
			onSelect={(scale) => settings({ log: scale === "log" })}
		/>
	);
	const chartChoices =
		currentTab.id === "benchmarks" ? (
			<>
				<SheetChoice
					label="Question"
					options={BENCHMARK_QUESTIONS.map((question) => ({
						id: question.id,
						label: question.question,
					}))}
					selected={benchmarkBars ? "bars" : "scatter"}
					onSelect={(question) => {
						if ((question === "bars") !== benchmarkBars)
							showChart(flipBenchmarkLayout());
					}}
				/>
				{benchmarkBars ? (
					<>
						<SheetChoice
							label="Measure"
							options={MEASURES.map((measure) => ({
								id: measure.id,
								label: measure.tab,
							}))}
							selected={benchmarkSection.measure ?? ""}
							onSelect={(measure) =>
								showChart(benchmarkChart(barSection({ measure })))
							}
						/>
						<SheetChoice
							label="Scope"
							options={SCOPES.map((scope) => ({
								id: scope.id,
								label: scope.tab.replace(/^./, (first) => first.toUpperCase()),
							}))}
							selected={benchmarkSection.scope ?? ""}
							onSelect={(scope) =>
								showChart(benchmarkChart(barSection({ scope })))
							}
						/>
					</>
				) : (
					<>
						<SheetChoice
							label="Compare with"
							options={scoreAxes.map((axis) => ({
								id: axis.chart.id,
								label: axis.tab,
							}))}
							selected={currentChart.id}
							onSelect={(chartId) => {
								const axis = scoreAxes.find(
									(option) => option.chart.id === chartId,
								);
								if (axis) showChart(axis.chart);
							}}
						/>
						{scaleChoice}
					</>
				)}
			</>
		) : currentTab.id === "behavior" ? (
			<>
				<SheetChoice
					label="Measure"
					options={BEHAVIOR_CHARTS.map((chart) => ({
						id: chart.id,
						label: chart.tab,
					}))}
					selected={wildSection.id}
					onSelect={(chartId) => showChart(wildChart(chartId))}
				/>
				{scaleChoice}
			</>
		) : currentTab.id === "usage" ? (
			<>
				<SheetChoice
					label="Question"
					options={USAGE_QUESTIONS.map((question) => ({
						id: question.id,
						label: question.question,
					}))}
					selected={wildSection.id === "friction-model" ? "friction" : "usage"}
					onSelect={(question) =>
						showChart(
							wildChart(
								question === "friction" ? "friction-model" : usageChart,
							),
						)
					}
				/>
				{wildSection.id === "friction-model" ? (
					<>
						<SheetChoice
							label="Counting"
							multiple
							options={FRICTION_KINDS.map((kind) => ({
								id: kind.id,
								label: kind.tab,
							}))}
							selected={state.frictionCounts}
							onToggle={(kind) => {
								const next = new Set(state.frictionCounts);
								if (next.has(kind as FrictionKind)) {
									if (next.size > 1) next.delete(kind as FrictionKind);
								} else next.add(kind as FrictionKind);
								settings({ frictionCounts: next });
							}}
						/>
						<SheetChoice
							label="Per"
							options={[
								{ id: "tokens", label: "10M output tokens" },
								{ id: "prompts", label: "1k prompts" },
							]}
							selected={state.frictionPer}
							onSelect={(per) => settings({ frictionPer: per as FrictionPer })}
						/>
					</>
				) : (
					<>
						<SheetChoice
							label="Show"
							options={USAGE_KINDS.map((kind) => ({
								id: kind.id,
								label: kind.tab,
							}))}
							selected={wildSection.id === "volume" ? "volume" : "share"}
							onSelect={(kind) =>
								showChart(wildChart(kind === "volume" ? "volume" : shareChart))
							}
						/>
						{wildSection.id === "volume" ? null : (
							<SheetChoice
								label="By"
								options={SPLITS.map((split) => ({
									id: split.id,
									label: split.tab.replace(/^./, (first) =>
										first.toUpperCase(),
									),
								}))}
								selected={wildSection.id}
								onSelect={(chartId) => showChart(wildChart(chartId))}
							/>
						)}
					</>
				)}
			</>
		) : null;
	const dataChoices = (
		<>
			{connected ? (
				<SheetChoice
					label="View"
					options={LENSES.map((lens) => ({
						id: lens,
						label: lensName(lens, tradeoffGuide(section.id)),
					}))}
					selected={state.lens}
					onSelect={(lens) => settings({ lens: lens as Lens })}
				/>
			) : null}
			{lab && !connected ? (
				<SheetChoice
					label="Arrangement"
					options={[
						{ id: "grouped", label: "Grouped by model" },
						{ id: "ranked", label: "Ranked, every effort" },
					]}
					selected={state.arrangement}
					onSelect={(arrangement) =>
						settings({
							arrangement: arrangement as ExplorerState["arrangement"],
						})
					}
				/>
			) : null}
			{!lab && wildSection.kind === "harness" ? (
				<>
					<SheetChoice
						label="View"
						options={[
							{ id: "split", label: "Split" },
							{ id: "difference", label: "Difference" },
						]}
						selected={state.harnessView}
						onSelect={(harnessView) =>
							settings({ harnessView: harnessView as HarnessView })
						}
					/>
					<SheetChoice
						label="Measure"
						options={measures.map((measure) => ({
							id: measure.id,
							label: measure.tab,
						}))}
						selected={state.harnessMeasure}
						onSelect={(measure) =>
							settings({ harnessMeasure: measure as HarnessMeasure })
						}
					/>
				</>
			) : null}
			{!lab && wildSection.id === "friction-model" ? (
				<SheetChoice
					label="Layout"
					options={[
						{ id: "rows", label: "Rows" },
						{ id: "columns", label: "Columns" },
					]}
					selected={state.frictionLayout}
					onSelect={(layout) =>
						settings({ frictionLayout: layout as FrictionLayout })
					}
				/>
			) : null}
			{connected && lab ? (
				<SheetChoice
					label="On the chart"
					multiple
					options={[
						{ id: "modelLabels", label: "Model labels" },
						{ id: "effortLabels", label: "Effort labels" },
						...(ranking ? [] : [{ id: "frontier", label: "Pareto line" }]),
						...(ranking || !state.frontier
							? []
							: [{ id: "frontierOnly", label: "Hide models off the line" }]),
					]}
					selected={
						new Set(
							[
								state.modelLabels && "modelLabels",
								state.effortLabels && "effortLabels",
								state.frontier && "frontier",
								state.frontierOnly && "frontierOnly",
							].filter((entry): entry is string => Boolean(entry)),
						)
					}
					onToggle={(id) => {
						if (id === "modelLabels")
							settings({ modelLabels: !state.modelLabels });
						if (id === "effortLabels")
							settings({ effortLabels: !state.effortLabels });
						if (id === "frontier")
							settings(
								state.frontier
									? { frontier: false, frontierOnly: false }
									: { frontier: true },
							);
						if (id === "frontierOnly")
							settings({ frontierOnly: !state.frontierOnly });
					}}
				/>
			) : null}
			{hasModels ? (
				<div className="trends-choice">
					<button
						type="button"
						className="trends-choice-action"
						onClick={() => {
							setSheet(undefined);
							settings({ view: "table" });
						}}
					>
						Show as a table
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M6 3.5 10.5 8 6 12.5" />
						</svg>
					</button>
				</div>
			) : null}
		</>
	);
	// The scatter's display tiles: above the model list beside the chart,
	// or on a phone in the chart settings sheet.
	const scatterTiles = lab ? (
		<ScatterTilesSlot shown={connected}>
			<ToggleTile
				label="Model labels"
				pressed={state.modelLabels}
				onChange={(modelLabels) => settings({ modelLabels })}
			/>
			<ToggleTile
				label="Effort labels"
				pressed={state.effortLabels}
				onChange={(effortLabels) => settings({ effortLabels })}
			/>
			{ranking ? null : (
				<ParetoTile
					on={state.frontier}
					only={state.frontierOnly}
					trade={
						benchmarkSection?.metric === "timePerTaskSeconds"
							? "faster"
							: "cheaper"
					}
					onChange={(frontier) => {
						// Off, the line takes "Hide others" with it, as the
						// tile shows.
						settings(
							frontier ? { frontier } : { frontier, frontierOnly: false },
						);
						// The frontier takes over the emphasis.
						if (frontier) setPinnedFocusIds(new Set());
					}}
					onOnly={(only) => settings({ frontierOnly: only })}
				/>
			)}
		</ScatterTilesSlot>
	) : undefined;
	const modelPicker = (
		<TrendsModelPicker
			// With the frontier on, the plot only reports its models.
			// With the frontier on, the list marks its models; the rest
			// stand faded.
			frontierIds={pareto ? frontierModelIds : undefined}
			hideOffFrontier={frontierOnly}
			onPickingChange={setPicking}
			byHarness={harnessShown}
			fixed={runsFixed}
			inspected={inspected}
			alignTo={
				!lab &&
				wildSection.id === "friction-model" &&
				state.frictionLayout === "rows"
					? rankGeometry
					: undefined
			}
			// Above the legend, under the menu's bar: it changes what
			// the legend and chart show, so it stays in view.
			listControls={narrow ? undefined : scatterTiles}
			listedIds={runsFixed ? runsModelIds : state.listedIds}
			drawableIds={frictionShown ? frictionIds : undefined}
			paretoEnds={paretoEnds}
			paretoCheap={
				paretoSection?.metric === "timePerTaskSeconds" ? "fast" : "cheap"
			}
			featuredIds={frontierLabIds}
			comparingIds={comparingIds}
			presets={
				frictionShown
					? presets.filter((preset) => preset.id === "openai-anthropic")
					: presets
			}
			// A quick pick puts exactly its models on the chart and in
			// the list; "Pareto" also draws their frontier.
			onPreset={(preset) => {
				settings({
					modelIds: preset.ids,
					listedIds: preset.ids,
					...(preset.frontier ? { frontier: true } : {}),
				});
				setPinnedFocusIds(new Set());
			}}
			// The × takes a model out of the list and off the chart.
			onRemove={(modelId) => {
				const without = (ids: ReadonlySet<string>) =>
					new Set([...ids].filter((id) => id !== modelId));
				settings({
					listedIds: without(state.listedIds),
					modelIds: without(state.modelIds),
				});
				setPinnedFocusIds(without);
			}}
			models={runsFixed ? runsModels : pickerModels}
			selected={runsFixed ? runsModelIds : selected}
			onSelection={(ids) => {
				const chosen = ids;
				// A model added from "Other models" joins the list and stays
				// there, shown or not, until its × takes it out. The chart
				// shows at most MAX_SHOWN models; models past that are
				// neither shown nor added.
				const newcomers = [...ids].filter((modelId) => !selected.has(modelId));
				const room = Math.max(0, MAX_SHOWN - selected.size);
				const admitted = newcomers.slice(0, room);
				const turnedAway = new Set(newcomers.slice(room));
				settings({
					modelIds: new Set(
						[...chosen].filter((modelId) => !turnedAway.has(modelId)),
					),
					// Unchecking a model keeps it in the list (faded); only its
					// × takes it out of the list.
					listedIds: new Set([
						...state.listedIds,
						...admitted,
						...[...selected].filter((modelId) => !ids.has(modelId)),
					]),
				});
				setPinnedFocusIds(
					(current) =>
						new Set([...current].filter((modelId) => ids.has(modelId))),
				);
			}}
			onReset={() => {
				const ids = chartDefaultIds(currentChart, snapshot, initial);
				settings({
					modelIds: ids,
					listedIds: ids,
					...(lab ? { efforts: initial.efforts } : {}),
				});
				setPinnedFocusIds(new Set());
			}}
			efforts={lab ? state.efforts : undefined}
			onEfforts={lab ? (efforts) => settings({ efforts }) : undefined}
			focusIds={focusIds}
			onHoverModel={setHoverFocusId}
		/>
	);

	const selectChartTab = (tabId: string) => {
		const tab = CHART_TABS.find((option) => option.id === tabId);
		const chart = tabCharts[tabId] ?? (tab ? tabHome(tab) : undefined);
		if (chart) showChart(chart);
	};
	const previewTag =
		(lab
			? snapshot.sources.benchmarks.kind
			: t3Shown
				? harnessSource.kind
				: snapshot.sources.usage.kind) === "preview" ? (
			<span className="trends-preview">
				{!lab && snapshot.sources.usage.kind !== "preview"
					? "Preview benchmarks"
					: "Preview data"}
			</span>
		) : null;

	return (
		<div className="trends-app" data-mode={state.mode}>
			{/* Wide, the charts' tabs stand in the site's navigation as a
			    breadcrumb after "Trends" (trends.astro); narrow, in a row under
			    it. */}
			{navTrail
				? createPortal(
						<>
							{/* On a phone, the shown chart as the breadcrumb's last
							    crumb, a tap listing the others. */}
							{narrow ? (
								<CrumbMenu
									options={CHART_TABS}
									selected={chartTabId}
									onSelect={selectChartTab}
								/>
							) : (
								<Tabs
									options={CHART_TABS}
									selected={chartTabId}
									label="Charts"
									id={`${id}-nav-chart`}
									panelId={`${id}-chart-panel`}
									onSelect={selectChartTab}
								/>
							)}
							{previewTag}
						</>,
						navTrail,
					)
				: null}
			<header className="trends-topbar">
				<div className="trends-tabs-row">
					<Tabs
						options={CHART_TABS}
						selected={chartTabId}
						label="Charts"
						id={`${id}-chart`}
						panelId={`${id}-chart-panel`}
						onSelect={selectChartTab}
					/>
				</div>
				{previewTag}
			</header>

			<div id={`${id}-dataset-panel`} className="trends-dataset-panel">
				<div className="trends-body">
					{/* Beside the chart; on a phone, in its own sheet. */}
					{narrow ? null : modelPicker}

					<div
						className="trends-panel"
						id={`${id}-chart-panel`}
						role="tabpanel"
						aria-labelledby={`${id}-chart-${chartTabId}`}
					>
						{/* Another tab cross-fades its chart and title in, the
						    chart's own entrance playing as it appears; the tab, the
						    list and the page switch at once. */}
						<ChartCrossfade id={chartTabId}>
							{/* Scatter charts draw their title and controls on the plot's
							    top corners. */}
							{connected && hasModels ? null : (
								<div
									className="trends-panel-toolbar"
									// Every chart's title row stands where Score's does.
									data-plot-aligned="true"
								>
									{/* A div, not a p: the charts' titles hold switches. On a
									    phone, plain words; the switches are in the sheet. */}
									<div className="trends-unit">
										{narrow ? plainTitle : titleSentence}
									</div>
									{narrow ? null : viewControls}
								</div>
							)}

							{!hasModels &&
							wildSection.kind !== "harness" &&
							wildSection.kind !== "timeline" ? (
								<p className="trends-empty">
									{lab ||
									snapshot.models.some((model) =>
										hasMeasurement(wildSection, model),
									)
										? "Select at least one model to compare."
										: "No data for this chart in the current capture yet."}
								</p>
							) : (
								<div className="trends-panel-body">
									{connected ? (
										<TradeoffPlot
											series={plotSeries}
											// Every control in the title: the question, what the
											// index is set against, and the scale; the axis under
											// the plot only names what it shows.
											// On a phone the title is plain text; its switches are in
											// the sheet, and the plot takes the width.
											title={narrow ? plainTitle : scatterTitle}
											toolbar={narrow ? undefined : viewControls}
											listBeside={!narrow}
											horizontalLabel={
												lab
													? benchmarkSection.unit
													: "Pushback among replied-to runs"
											}
											verticalLabel="Intelligence index"
											formatHorizontal={
												lab ? benchmarkSection.format : formatPercent
											}
											formatVertical={(value) => formatDecimal(value, 0)}
											// Names run into the list beside the plot, as on every
											// Score chart, so the plot keeps one width.
											// On a phone, with no list beside the plot, Model labels
											// names each line on the plot itself.
											directLabels={narrow && state.modelLabels}
											modelLabels={state.modelLabels}
											onCompare={(modelIds) =>
												setComparingIds(
													modelIds.size > 0 ? modelIds : undefined,
												)
											}
											guide={tradeoffGuide(section.id)}
											guideLayout={
												state.lens === "data" ? undefined : state.lens
											}
											insight={state.lens !== "data"}
											trade={
												lab
													? benchmarkSection.metric === "timePerTaskSeconds"
														? "time"
														: "cost"
													: undefined
											}
											log={logApplies && state.log}
											effortLabels={state.effortLabels}
											frontier={frontier}
											frontierOnly={frontierOnly}
											focusIds={focusIds}
											onFocusModel={focusModel}
										/>
									) : lab ? (
										<BenchmarkBars
											listBeside={!narrow}
											section={benchmarkSection}
											models={visibleBenchmarks}
											efforts={state.efforts}
											arrangement={state.arrangement}
											tickRoom={state.lens === "data" ? 20 : 0}
											focusIds={focusIds}
											colors={benchmarkColors}
											onCompare={(modelIds) =>
												setComparingIds(
													modelIds.size > 0 ? modelIds : undefined,
												)
											}
											onInspect={setInspected}
										/>
									) : wildSection.kind === "harness" ||
										wildSection.kind === "share" ? (
										// Share and volume are two charts: they cross-fade too.
										<ChartCrossfade
											id={
												wildSection.kind === "share"
													? wildSection.id
													: wildSection.kind
											}
										>
											{wildSection.kind === "harness" ? (
												<HarnessBalance
													days={harnessDays}
													view={state.harnessView}
													measure={measures.find(
														(entry) => entry.id === state.harnessMeasure,
													)}
													tickRoom={state.lens === "data" ? 20 : 0}
												/>
											) : (
												<ShareChart
													snapshot={snapshot}
													models={shareModels}
													order={legendOrder(pickerModels)}
													focusIds={focusIds}
													colors={benchmarkColors}
													axisTitle={wildUnit}
													tickRoom={state.lens === "data" ? 20 : 0}
													volume={wildSection.measure === "volume"}
													onInspect={setInspected}
												/>
											)}
										</ChartCrossfade>
									) : wildSection.kind === "timeline" ? (
										// A new measure cross-fades; a new scale glides.
										<ChartCrossfade id={wildSection.id}>
											<MonthlyLines
												{...monthlySeries(snapshot, wildSection.metric)}
												// The title holds the definition; the empty line keeps
												// the plot's height.
												axisTitle={"\u00a0"}
												log={state.log}
												tickRoom={state.lens === "data" ? 20 : 0}
											/>
										</ChartCrossfade>
									) : wildSection.id === "friction-model" &&
										wildSection.kind === "ranked" &&
										state.frictionLayout === "rows" ? (
										<RankRows
											rows={wildBars.rows.map((row) => ({
												id: row.model.id,
												name: row.model.name,
												provider: row.model.provider,
												color: benchmarkColors.get(row.model.id),
												value: row.value,
											}))}
											format={wildSection.format}
											axisTitle={wildUnit}
											focusIds={focusIds}
											onGeometry={setRankGeometry}
										/>
									) : wildSection.kind === "ranked" ||
										wildSection.kind === "range" ? (
										<BenchmarkBars
											listBeside={!narrow}
											section={wildSection}
											models={[]}
											efforts={state.efforts}
											rows={wildBars.rows}
											spreads={wildBars.spreads}
											axisTitle={
												wildSection.kind === "range"
													? `Median ${lowerFirst(wildSection.unit)} · ticks at p90 and p99`
													: wildSection.unit
											}
											// Runs span orders of magnitude: a log axis, on the
											// section's own ticks.
											logTicks={
												wildSection.kind === "range"
													? wildSection.ticks
													: undefined
											}
											tickRoom={state.lens === "data" ? 20 : 0}
											focusIds={focusIds}
											colors={benchmarkColors}
											onCompare={(modelIds) =>
												setComparingIds(
													modelIds.size > 0 ? modelIds : undefined,
												)
											}
											onInspect={setInspected}
										/>
									) : (
										<ShareChart
											snapshot={snapshot}
											models={shareModels}
											order={legendOrder(pickerModels)}
											focusIds={focusIds}
											colors={benchmarkColors}
											axisTitle={wildUnit}
											tickRoom={state.lens === "data" ? 20 : 0}
										/>
									)}
								</div>
							)}
						</ChartCrossfade>
						<TableDialog
							open={state.view === "table"}
							title={linkIndex(unit)}
							onClose={() => settings({ view: "chart" })}
						>
							{table}
						</TableDialog>
						{narrow ? (
							<div className="trends-sheet-buttons">
								<button
									type="button"
									className="trends-legend-strip"
									aria-haspopup="dialog"
									onClick={() => setSheet("models")}
								>
									Models
									<svg viewBox="0 0 16 16" aria-hidden="true">
										<path d="M6 3.5 10.5 8 6 12.5" />
									</svg>
								</button>
								<button
									type="button"
									className="trends-legend-strip"
									aria-haspopup="dialog"
									onClick={() => setSheet("chart")}
								>
									Chart settings
									<svg viewBox="0 0 16 16" aria-hidden="true">
										<path d="M6 3.5 10.5 8 6 12.5" />
									</svg>
								</button>
								<button
									type="button"
									className="trends-legend-strip"
									aria-haspopup="dialog"
									onClick={() => setSheet("data")}
								>
									Data
									<svg viewBox="0 0 16 16" aria-hidden="true">
										<path d="M6 3.5 10.5 8 6 12.5" />
									</svg>
								</button>
							</div>
						) : null}
					</div>
					<ModelSheet
						open={narrow && sheet !== undefined}
						title={
							sheet === "chart"
								? "Chart settings"
								: sheet === "data"
									? "Data"
									: "Models"
						}
						onClose={() => setSheet(undefined)}
						content={sheet}
					>
						{(shown) =>
							!narrow ? null : shown === "chart" ? (
								<div className="trends-choices">{chartChoices}</div>
							) : shown === "data" ? (
								<div className="trends-choices">{dataChoices}</div>
							) : (
								modelPicker
							)
						}
					</ModelSheet>
					<footer className="trends-foot">
						<p className="trends-attribution">
							{lab || opalineSourced || slopalyticsSourced ? null : (
								<>
									<span>{wildSourceName}</span>
									<span className="trends-foot-dot" aria-hidden="true" />
								</>
							)}
							<span>
								<time
									dateTime={
										lab ? snapshot.sources.benchmarks.fetchedAt : wildUpdated
									}
								>
									{formatFullDay(
										lab ? snapshot.sources.benchmarks.fetchedAt : wildUpdated,
									)}
								</time>
							</span>
							{lab || opalineSourced || slopalyticsSourced ? (
								<span className="trends-foot-dot" aria-hidden="true" />
							) : null}
							{/* T3 Code's days, credited to Slopalytics as the
							    benchmarks are: after the date. */}
							{slopalyticsSourced ? (
								<span>
									<a href={SLOPALYTICS_URL} target="_blank" rel="noreferrer">
										Slopalytics
									</a>
								</span>
							) : null}
							{/* With Opaline's runs added in, Opaline too. */}
							{slopalyticsSourced && withOpaline ? (
								<>
									<span className="trends-foot-dot" aria-hidden="true" />
									<OpalineSource snapshot={snapshot} />
								</>
							) : null}
							{/* Opaline's own sessions, credited as the benchmarks are:
							    after the date. */}
							{opalineSourced ? <OpalineSource snapshot={snapshot} /> : null}
							{/* Benchmarks are credited only where a chart draws them: every
							    Score chart, and in the wild the pushback scatter's
							    intelligence axis, on its own line, so no dot starts it. */}
							{lab || wildSection.kind === "scatter" ? (
								<span className={lab ? undefined : "trends-foot-line"}>
									{snapshot.sources.benchmarks.kind === "preview" ? (
										"Preview benchmarks"
									) : (
										<>
											{!lab ? "Benchmarks: " : null}
											<a href={AA_URL} target="_blank" rel="noreferrer">
												Artificial Analysis
											</a>
										</>
									)}
								</span>
							) : null}
						</p>
					</footer>
				</div>
			</div>
		</div>
	);
}

/**
 * The scatter's settings above the model list. Usage keeps their space,
 * unseen and inert, so the list's rows stand exactly where they do on Score
 * and only the chart changes between them.
 */
function ScatterTilesSlot({
	shown,
	children,
}: {
	readonly shown: boolean;
	readonly children: ReactNode;
}) {
	return shown ? (
		children
	) : (
		<div className="trends-legend-placeholder" inert aria-hidden="true">
			{children}
		</div>
	);
}

// Log-axis ticks: run time in seconds (seconds to a day), tool calls in
// calls (half a call to thousands).
const RUN_TIME_TICKS = [
	1, 3, 10, 30, 60, 180, 600, 1_800, 3_600, 10_800, 36_000, 86_400,
];
const TOOL_CALL_TICKS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000];

/** A monthly series' points, format and axis, by its metric. */
function monthlySeries(
	snapshot: TrendsSnapshot,
	metric: "runTime" | "toolCalls",
) {
	return metric === "runTime"
		? {
				months: (snapshot.runTimeMonths ?? []).map((month) => ({
					monthStart: month.monthStart,
					runs: month.runs,
					mean: month.meanSeconds,
					p95: month.p95Seconds,
					p99: month.p99Seconds,
				})),
				format: formatDuration,
				ticks: RUN_TIME_TICKS,
				description: "Time per agent run",
			}
		: {
				months: (snapshot.toolCallMonths ?? []).map((month) => ({
					monthStart: month.monthStart,
					runs: month.runs,
					mean: month.meanCalls,
					p95: month.p95Calls,
					p99: month.p99Calls,
				})),
				// Whole calls as they are; a fraction only below ten (7.5).
				format: (value: number) =>
					value < 10 && !Number.isInteger(value)
						? formatDecimal(value)
						: String(Math.round(value)),
				ticks: TOOL_CALL_TICKS,
				description: "Tool calls per agent run",
			};
}

/**
 * Friction by model for what the reader counts (developers' swear words,
 * the model's apologies, its failed tool calls, or all three summed), whose
 * (every developer, those who swear, or the cohort model's users) and per
 * what (10M output tokens or 1,000 prompts). Every model with a friction
 * row has a figure; one resting on less than the minimum denominator is
 * thin and marked as such where it is drawn.
 */
function frictionFigures(
	snapshot: TrendsSnapshot,
	counts: ReadonlySet<FrictionKind>,
	per: FrictionPer,
) {
	const figures = new Map<string, { value: number; thin: boolean }>();
	for (const row of snapshot.friction?.all.models ?? []) {
		const events = [...counts].reduce((sum, kind) => sum + row[kind], 0);
		const denominator = per === "tokens" ? row.outputTokens : row.prompts;
		if (denominator <= 0) continue;
		figures.set(row.familyId, {
			value: (per === "tokens" ? 10_000_000 : 1_000) * (events / denominator),
			thin:
				denominator <
				(per === "tokens" ? FRICTION_MIN_OUTPUT_TOKENS : FRICTION_MIN_PROMPTS),
		});
	}
	return figures;
}

function frictionSection(
	section: RankedSection,
	snapshot: TrendsSnapshot,
	counts: ReadonlySet<FrictionKind>,
	per: FrictionPer,
): RankedSection {
	const figures = frictionFigures(snapshot, counts, per);
	// The switches beside the title say what counts: "Friction" for more
	// than one, else the one ("Tool errors").
	const kinds = FRICTION_KINDS.filter((kind) => counts.has(kind.id));
	const what = kinds.length === 1 ? kinds[0].tab : "Friction";
	return {
		...section,
		unit: `${what} per ${per === "tokens" ? "10M output tokens" : "1,000 prompts"}`,
		value: (metrics) => {
			const id = "id" in metrics ? (metrics as TrendsModel).id : undefined;
			return (id ? figures.get(id)?.value : undefined) ?? null;
		},
	};
}

/**
 * Friction's bars: every selected model with a friction row, published or
 * not (so new and lightly used models stay on the chart), a thin one named
 * with an asterisk.
 */
function frictionColumns(
	models: readonly PickerModel[],
	benchmarks: readonly TrendsBenchmarkModel[],
	figures: ReadonlyMap<string, { value: number; thin: boolean }>,
): BenchmarkObservation[] {
	return models.flatMap((model) => {
		const figure = figures.get(model.id);
		const benchmark = benchmarks.find((candidate) => candidate.id === model.id);
		if (!figure || !benchmark) return [];
		return [
			{
				model: figure.thin
					? { ...benchmark, name: `${benchmark.name}*` }
					: benchmark,
				value: figure.value,
				point: {
					sourceId: null,
					sourceSlug: null,
					sourceUrl: benchmark.url,
					estimated: false,
					effortLabel: "default",
					effort: "default",
					effortOrder: 0,
					intelligenceIndex: null,
					costPerTaskUsd: null,
					timePerTaskSeconds: null,
					outputTokensPerTask: null,
					totalOutputTokens: null,
					totalCostUsd: null,
				},
			},
		];
	});
}

/** The pickable models with friction figures, the most output first. */
function frictionRanked(snapshot: TrendsSnapshot) {
	const benchmarks = snapshot.benchmarks ?? [];
	const tokens = new Map(
		(snapshot.friction?.all.models ?? []).map((row) => [
			row.familyId,
			row.outputTokens,
		]),
	);
	return benchmarks
		.filter((model) => tokens.has(model.id))
		.sort(
			(first, second) =>
				(tokens.get(second.id) ?? 0) - (tokens.get(first.id) ?? 0),
		);
}

/** The pickable models with share data, the most runs (or turns) first. */
function shareRanked(
	snapshot: TrendsSnapshot,
	benchmarks: readonly TrendsBenchmarkModel[],
) {
	const totals = new Map<string, number>();
	for (const period of sharePeriods(snapshot).periods)
		for (const [id, runs] of Object.entries(period.runsByModel))
			totals.set(id, (totals.get(id) ?? 0) + runs);
	return benchmarks
		.filter((model) => (totals.get(model.id) ?? 0) > 0)
		.sort(
			(first, second) =>
				(totals.get(second.id) ?? 0) - (totals.get(first.id) ?? 0),
		);
}

function harnessSourceName(
	kind: TrendsSnapshot["sources"]["harnesses"]["kind"],
) {
	return kind === "t3_code"
		? "T3 Code"
		: kind === "preview"
			? "Synthetic usage"
			: "Opaline sessions";
}

/** Links a chart title built on the Intelligence index to its methodology. */
function linkIndex(unit: string): ReactNode {
	if (!unit.startsWith(INDEX_NAME)) return unit;
	return (
		<a
			className="trends-index-link"
			href={INDEX_METHODOLOGY_URL}
			target="_blank"
			rel="noreferrer"
		>
			{unit}
		</a>
	);
}

function Tabs({
	options,
	selected,
	label,
	id,
	panelId,
	onSelect,
}: {
	readonly options: readonly { id: string; tab: string }[];
	readonly selected: string;
	readonly label: string;
	readonly id: string;
	readonly panelId: string;
	readonly onSelect: (id: string) => void;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	const refs = useRef(new Map<string, HTMLButtonElement>());
	// Keep the active tab in view by scrolling the strip itself, never the page.
	useEffect(() => {
		const list = listRef.current;
		const tab = refs.current.get(selected);
		if (!list || !tab) return;
		// Measure against the strip, not offsetParent: the strip sits inside the
		// top bar beside the brand, so offsetLeft would include the brand width.
		const listBox = list.getBoundingClientRect();
		const tabBox = tab.getBoundingClientRect();
		const target =
			list.scrollLeft +
			(tabBox.left - listBox.left) -
			(list.clientWidth - tabBox.width) / 2;
		list.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
	}, [selected]);
	const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
		const current = options.findIndex((option) => option.id === selected);
		const offset =
			event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
		const index =
			event.key === "Home"
				? 0
				: event.key === "End"
					? options.length - 1
					: offset
						? (current + offset + options.length) % options.length
						: -1;
		const option = options[index];
		if (!option) return;
		event.preventDefault();
		onSelect(option.id);
		refs.current.get(option.id)?.focus({ preventScroll: true });
	};
	return (
		<div
			ref={listRef}
			role="tablist"
			aria-label={label}
			className="trends-tabs"
		>
			{options.map((option) => (
				<button
					ref={(element) => {
						if (element) refs.current.set(option.id, element);
						else refs.current.delete(option.id);
					}}
					type="button"
					key={option.id}
					role="tab"
					id={`${id}-${option.id}`}
					aria-controls={panelId}
					aria-selected={selected === option.id}
					tabIndex={selected === option.id ? 0 : -1}
					className="trends-tab"
					onClick={() => onSelect(option.id)}
					onKeyDown={onKey}
				>
					{option.tab}
					{selected === option.id ? (
						<motion.span
							layoutId={`${id}-indicator`}
							className="trends-tab-indicator"
							transition={TRENDS_SPRING}
							aria-hidden="true"
						/>
					) : null}
				</button>
			))}
		</div>
	);
}

/**
 * The chart's numbers as a table, over the chart. A native modal: Escape
 * and a click outside close it, and focus returns to the table button.
 */
/** How long the table dialog takes to fade shut (its CSS close transition). */
const DIALOG_CLOSE_MS = 180;

/**
 * One choice in a phone's settings sheet: its name over every option as a
 * full-width row (44pt and up), a circle on the right marking the picked
 * one, filled; with `multiple`, each row's circle turns on and off.
 */
function SheetChoice({
	label,
	options,
	selected,
	onSelect,
	onToggle,
	multiple = false,
}: {
	readonly label: string;
	readonly options: readonly { readonly id: string; readonly label: string }[];
	readonly selected: string | ReadonlySet<string>;
	readonly onSelect?: (id: string) => void;
	readonly onToggle?: (id: string) => void;
	readonly multiple?: boolean;
}) {
	const name = useId();
	const isOn = (id: string) =>
		typeof selected === "string" ? selected === id : selected.has(id);
	return (
		<fieldset className="trends-choice">
			<legend className="trends-choice-label">{label}</legend>
			{options.map((option) => (
				<label key={option.id} className="trends-choice-row">
					<span>{option.label}</span>
					<input
						type={multiple ? "checkbox" : "radio"}
						name={name}
						className="trends-choice-mark"
						checked={isOn(option.id)}
						onChange={() =>
							multiple ? onToggle?.(option.id) : onSelect?.(option.id)
						}
					/>
				</label>
			))}
		</fieldset>
	);
}

/**
 * The breadcrumb's last crumb on a phone: the shown chart's tab and a
 * chevron; a tap opens a menu of every tab, 44pt rows, a check by the
 * shown one.
 */
function CrumbMenu({
	options,
	selected,
	onSelect,
}: {
	readonly options: readonly { readonly id: string; readonly tab: string }[];
	readonly selected: string;
	readonly onSelect: (id: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLSpanElement>(null);
	const menuId = useId();
	useEffect(() => {
		if (!open) return;
		const close = (event: PointerEvent) => {
			if (!ref.current?.contains(event.target as Node)) setOpen(false);
		};
		const onEscape = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", close);
		document.addEventListener("keydown", onEscape);
		return () => {
			document.removeEventListener("pointerdown", close);
			document.removeEventListener("keydown", onEscape);
		};
	}, [open]);
	const current = options.find((option) => option.id === selected);
	return (
		<span className="trends-crumb" ref={ref}>
			<button
				type="button"
				className="trends-crumb-button"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={menuId}
				onClick={() => setOpen(!open)}
			>
				{current?.tab}
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="M4.5 6.5 8 10l3.5-3.5" />
				</svg>
			</button>
			<span
				id={menuId}
				className="trends-crumb-menu"
				role="menu"
				data-open={open}
				inert={!open}
			>
				{options.map((option) => (
					<button
						key={option.id}
						type="button"
						role="menuitemradio"
						aria-checked={option.id === selected}
						className="trends-crumb-item"
						onClick={() => {
							setOpen(false);
							onSelect(option.id);
						}}
					>
						{option.tab}
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
						</svg>
					</button>
				))}
			</span>
		</span>
	);
}

/** Below the wide shell (880px), the phone and tablet layout. */
const NARROW_QUERY = "(max-width: 879px)";

/** Whether the page is in its narrow layout; the server renders the wide
 * one, and the browser switches once hydrated. */
function useNarrowShell() {
	return useSyncExternalStore(
		(onChange) => {
			const query = window.matchMedia(NARROW_QUERY);
			query.addEventListener("change", onChange);
			return () => query.removeEventListener("change", onChange);
		},
		() => window.matchMedia(NARROW_QUERY).matches,
		() => false,
	);
}

/**
 * On a phone, the model list, or the chart's settings, as a full-screen
 * sheet over the chart, with a large Done button; it slides up and fades
 * shut.
 */
function ModelSheet({
	open,
	title,
	onClose,
	content,
	children,
}: {
	readonly open: boolean;
	readonly title: string;
	readonly onClose: () => void;
	/** Which sheet is asked for; the last one stays while it fades shut. */
	readonly content: "models" | "chart" | "data" | undefined;
	readonly children: (shown: "models" | "chart" | "data") => ReactNode;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	const [shown, setShown] = useState(content ?? "models");
	if (content && content !== shown) setShown(content);
	const [shownTitle, setShownTitle] = useState(title);
	if (open && title !== shownTitle) setShownTitle(title);
	const doneRef = useRef<HTMLButtonElement>(null);
	const [wasOpen, setWasOpen] = useState(open);
	const [closing, setClosing] = useState(false);
	if (wasOpen !== open) {
		setWasOpen(open);
		setClosing(!open);
	}
	useEffect(() => {
		if (!closing) return;
		const timer = setTimeout(() => setClosing(false), DIALOG_CLOSE_MS);
		return () => clearTimeout(timer);
	}, [closing]);
	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			doneRef.current?.focus({ preventScroll: true });
		}
		if (!open && dialog.open) dialog.close();
	}, [open]);
	return (
		<dialog
			ref={ref}
			className="trends-sheet"
			aria-labelledby="trends-sheet-title"
			onClose={onClose}
		>
			<div className="trends-sheet-head">
				<h2 id="trends-sheet-title">{shownTitle}</h2>
				<button
					ref={doneRef}
					type="button"
					className="trends-sheet-done"
					onClick={onClose}
				>
					Done
				</button>
			</div>
			<div className="trends-sheet-body">
				{open || closing ? children(shown) : null}
			</div>
		</dialog>
	);
}

function TableDialog({
	open,
	title,
	onClose,
	children,
}: {
	readonly open: boolean;
	readonly title: ReactNode;
	readonly onClose: () => void;
	readonly children: ReactNode;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	// The table stays while the dialog fades shut, so it closes as it looks
	// rather than collapsing to its header first. Worked out from `open`
	// itself, in the render it changes, as Escape shuts the dialog natively
	// before React hears of it.
	const [wasOpen, setWasOpen] = useState(open);
	const [closing, setClosing] = useState(false);
	if (wasOpen !== open) {
		setWasOpen(open);
		setClosing(!open);
	}
	useEffect(() => {
		if (!closing) return;
		const timer = setTimeout(() => setClosing(false), DIALOG_CLOSE_MS);
		return () => clearTimeout(timer);
	}, [closing]);
	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			// Focus the close button, not the link in the title.
			closeRef.current?.focus({ preventScroll: true });
		}
		if (!open && dialog.open) dialog.close();
	}, [open]);
	return (
		<dialog
			ref={ref}
			className="trends-table-dialog"
			aria-label="Chart as a table"
			onClose={onClose}
			// The dialog box itself is only reachable on the backdrop. Pointer
			// down, so a drag that starts in the table and ends outside stays.
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div className="trends-table-dialog-inner">
				<div className="trends-table-dialog-head">
					<p className="trends-unit">{title}</p>
					<button
						ref={closeRef}
						type="button"
						className="trends-tool"
						data-icon-only="true"
						aria-label="Close table"
						onClick={onClose}
					>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
						</svg>
					</button>
				</div>
				<div className="trends-table-dialog-body">
					{open || closing ? children : null}
				</div>
			</div>
		</dialog>
	);
}

interface SegmentedOption {
	readonly id: string;
	readonly tab: string;
	readonly icon?: ReactNode;
	/** An "i" after the label, explaining the option. */
	readonly info?: ReactNode;
}

function Segmented({
	label,
	options,
	selected,
	onSelect,
	variant,
}: {
	readonly label: string;
	readonly options: readonly SegmentedOption[];
	readonly selected: string;
	readonly onSelect: (id: string) => void;
	/** "tag": inline in a title, the pick raised as an Opaline tag. */
	readonly variant?: "tag";
}) {
	const infoId = useId();
	// A raised thumb slides under the picked option. The options differ in
	// width, so the picked one is measured (CSS alone can't slide between
	// them): when the pick changes, and when any option resizes (fonts
	// loading, labels changing). Measured in the browser, so the server
	// render keeps the pressed button's own fill.
	const trackRef = useRef<HTMLFieldSetElement>(null);
	const [thumb, setThumb] = useState<{ x: number; width: number } | null>(null);
	useLayoutEffect(() => {
		const track = trackRef.current;
		if (!track) return;
		const measure = () => {
			const picked = track.querySelector<HTMLButtonElement>(
				`button[data-option="${CSS.escape(selected)}"]`,
			);
			const next = picked
				? { x: picked.offsetLeft, width: picked.offsetWidth }
				: null;
			setThumb((current) =>
				current && next && current.x === next.x && current.width === next.width
					? current
					: next,
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		for (const button of track.querySelectorAll("button"))
			observer.observe(button);
		return () => observer.disconnect();
	}, [selected]);
	return (
		<fieldset
			ref={trackRef}
			className="trends-segmented"
			data-variant={variant}
			data-sliding={thumb !== null}
		>
			<legend className="visually-hidden">{label}</legend>
			{thumb ? (
				<span
					className="trends-segmented-thumb"
					aria-hidden="true"
					style={
						{
							"--thumb-x": `${thumb.x}px`,
							"--thumb-width": `${thumb.width}px`,
						} as CSSProperties
					}
				/>
			) : null}
			{options.map((option) => (
				<button
					key={option.id}
					type="button"
					data-option={option.id}
					aria-pressed={selected === option.id}
					aria-describedby={option.info ? `${infoId}-${option.id}` : undefined}
					onClick={() => onSelect(option.id)}
				>
					{option.icon}
					{option.tab}
					{option.info ? (
						<OptionInfo id={`${infoId}-${option.id}`} info={option.info} />
					) : null}
				</button>
			))}
		</fieldset>
	);
}

/**
 * Opaline credited as a source: its link, and on hover or keyboard focus
 * how much it rests on, every developer and agent run in its sessions.
 */
function OpalineSource({ snapshot }: { readonly snapshot: TrendsSnapshot }) {
	const tipId = useId();
	return (
		<span className="trends-info trends-source">
			<a href="/" aria-describedby={tipId}>
				Opaline
			</a>
			<span id={tipId} role="tooltip" className="trends-info-tip">
				{formatInteger(snapshot.totals.developers)} developers ·{" "}
				{formatInteger(snapshot.totals.runs)} agent runs
			</span>
		</span>
	);
}

/** Friction's counted kinds from the address; all three by default. */
function frictionCountsFrom(param: string | null): ReadonlySet<FrictionKind> {
	const picked = new Set(
		FRICTION_KINDS.map((kind) => kind.id).filter((id) =>
			(param ?? "").split(",").includes(id),
		),
	);
	return picked.size > 0
		? picked
		: new Set(FRICTION_KINDS.map((kind) => kind.id));
}

/**
 * The switch's track with any number of options on, each raised while on;
 * the last one on stays on.
 */
function MultiSelect<Id extends string>({
	label,
	options,
	selected,
	onChange,
	variant,
}: {
	readonly label: string;
	readonly options: readonly { readonly id: Id; readonly tab: string }[];
	readonly selected: ReadonlySet<Id>;
	readonly onChange: (selected: ReadonlySet<Id>) => void;
	/** "tag": inline in a title, each pick raised as an Opaline tag. */
	readonly variant?: "tag";
}) {
	return (
		<fieldset
			className="trends-segmented"
			data-multiple="true"
			data-variant={variant}
		>
			<legend className="visually-hidden">{label}</legend>
			{options.map((option) => {
				const on = selected.has(option.id);
				return (
					<button
						key={option.id}
						type="button"
						aria-pressed={on}
						disabled={on && selected.size === 1}
						onClick={() => {
							const next = new Set(selected);
							if (on) next.delete(option.id);
							else next.add(option.id);
							onChange(next);
						}}
					>
						{option.tab}
					</button>
				);
			})}
		</fieldset>
	);
}

/** A tile's selector: a ring while off, filled while on, like the legend's
 * own model dots. */
function TileDot() {
	return <span className="trends-tile-dot" aria-hidden="true" />;
}

/** One tile of the settings grid beside the legend, Opaline's raised tag
 * with a dot that shows whether it is on. */
function ToggleTile({
	label,
	pressed,
	onChange,
}: {
	readonly label: string;
	readonly pressed: boolean;
	readonly onChange: (pressed: boolean) => void;
}) {
	return (
		<button
			type="button"
			className="trends-tile"
			aria-pressed={pressed}
			onClick={() => onChange(!pressed)}
		>
			<TileDot />
			{label}
		</button>
	);
}

const INFO_ICON = (
	<svg className="trends-info-icon" viewBox="0 0 16 16" aria-hidden="true">
		<circle cx="8" cy="8" r="6.25" />
		<path d="M8 7.25v3.5" />
		<circle className="trends-info-dot" cx="8" cy="5.1" r="0.6" />
	</svg>
);

/** The tip an "i" opens: one raised card of text. */
function InfoTipCard({
	id,
	info,
}: {
	readonly id: string;
	readonly info: ReactNode;
}) {
	return (
		<span id={id} role="tooltip" className="trends-info-tip">
			{info}
		</span>
	);
}

/** A quiet "i" whose tip, on hover or keyboard focus, explains. */
function InfoTip({
	label,
	info,
}: {
	/** The question the tip answers, as the button's name. */
	readonly label: string;
	readonly info: ReactNode;
}) {
	const tipId = useId();
	return (
		<span className="trends-info">
			<button
				type="button"
				className="trends-info-button"
				aria-label={label}
				aria-describedby={tipId}
			>
				{INFO_ICON}
			</button>
			<InfoTipCard id={tipId} info={info} />
		</span>
	);
}

/** An "i" inside a switch's own button (a button can't hold another): it
 * opens its tip on hover, and the button names it for keyboard and screen
 * readers. */
function OptionInfo({
	id,
	info,
}: {
	readonly id: string;
	readonly info: ReactNode;
}) {
	return (
		<span className="trends-info" data-in-option="true">
			{INFO_ICON}
			<InfoTipCard id={id} info={info} />
		</span>
	);
}

/**
 * The Pareto line's tile, across the grid: its own toggle, an info tooltip
 * on what the line means, and, set into it with concentric corners, the
 * option to hide the models off the line (only while it is drawn).
 */
function ParetoTile({
	on,
	only,
	trade,
	onChange,
	onOnly,
}: {
	readonly on: boolean;
	readonly only: boolean;
	/** What the cheap end means on this chart. */
	readonly trade: "cheaper" | "faster";
	readonly onChange: (on: boolean) => void;
	readonly onOnly: (only: boolean) => void;
}) {
	return (
		<fieldset className="trends-tile trends-tile-group">
			<legend className="visually-hidden">Pareto line</legend>
			{/* The grid's own columns: the line and its info in the first,
			    "Hide others" in the second, under the tile above it. */}
			<span className="trends-tile-lead">
				<button
					type="button"
					className="trends-tile-main"
					aria-pressed={on}
					onClick={() => onChange(!on)}
				>
					<TileDot />
					Pareto line
				</button>
				<InfoTip
					label="What is the Pareto line?"
					info={`The best trade-offs on the chart. A point is on the line when no other point is both ${trade} and at least as smart. Points off it are beaten on both counts.`}
				/>
			</span>
			<button
				type="button"
				className="trends-tile-inner"
				aria-pressed={on && only}
				aria-label="Hide non-Pareto models"
				title={
					on
						? "Hide non-Pareto models"
						: "Turn on the Pareto line to hide the models off it"
				}
				disabled={!on}
				onClick={() => onOnly(!only)}
			>
				<TileDot />
				Hide others
			</button>
		</fieldset>
	);
}

function benchmarkSeries(
	models: readonly TrendsBenchmarkModel[],
	section: BenchmarkSection,
	efforts: ReadonlySet<TrendsReasoningEffort>,
): TradeoffSeries[] {
	const rows = benchmarkObservations(models, section.metric, efforts, true);
	return models.map((model) => ({
		id: model.id,
		name: model.name,
		provider: model.provider,
		points: rows.flatMap((row) =>
			row.model.id !== model.id || row.point.intelligenceIndex === null
				? []
				: [
						{
							id: `${model.id}-${row.point.effort}`,
							sourceUrl: row.point.sourceUrl,
							effort: row.point.effort,
							effortIndex: REASONING_EFFORTS.indexOf(row.point.effort),
							horizontal: row.value,
							vertical: row.point.intelligenceIndex,
							// The short effort ("default", "max"), not the data's longer label.
							subtitle: row.point.effort,
							estimated: row.point.estimated,
							rows: [
								{
									label: "Intelligence",
									value: formatDecimal(row.point.intelligenceIndex),
									axis: "vertical",
								},
								{
									// The value carries the unit ($, s).
									label: section.unit.replace(/ \(.*\)$/, ""),
									value: section.format(row.value),
									axis: "horizontal",
								},
							],
						},
					],
		),
	}));
}

function wildSeries(
	models: readonly TrendsModel[],
	snapshot: TrendsSnapshot,
	colors: ReadonlyMap<string, string>,
): TradeoffSeries[] {
	return models.flatMap((model) => {
		const benchmark = usageBenchmark(model, snapshot);
		const vertical = benchmark?.intelligenceIndex;
		const horizontal = pushbackRate(model);
		if (horizontal == null || vertical == null) return [];
		return [
			{
				id: model.id,
				name: model.name,
				provider: model.provider,
				color: colors.get(model.id),
				points: [
					{
						id: model.id,
						sourceUrl: benchmark?.sourceUrl,
						effort: model.benchmarkEffort,
						effortIndex: REASONING_EFFORTS.indexOf("high"),
						horizontal,
						vertical,
						rows: [
							{
								label: "Reasoning",
								value: `${model.benchmarkEffort} (${model.effortPolicy === "predominant" ? (snapshot.sources.usage.kind === "preview" ? "declared preview usage" : "predominant usage") : "vendor default"})`,
							},
							{
								label: "Pushback among replied-to runs",
								value: formatPercent(horizontal),
							},
							{ label: "Intelligence index", value: formatDecimal(vertical) },
							{ label: "Agent runs", value: formatCompact(model.runs) },
							{ label: "Developers", value: formatInteger(model.developers) },
						],
					},
				],
			},
		];
	});
}

/**
 * In-the-wild figures as columns: each model's benchmark identity (name,
 * lab, colour) with its one figure, a run's median with its p90 and p99.
 */
function wildColumns(
	section: TrendsSection,
	models: readonly TrendsModel[],
	benchmarks: readonly TrendsBenchmarkModel[],
	snapshot: TrendsSnapshot,
) {
	const rows: BenchmarkObservation[] = [];
	const spreads = new Map<string, ColumnSpread>();
	for (const model of models) {
		const benchmark = benchmarks.find((candidate) => candidate.id === model.id);
		const quantiles =
			section.kind === "range" ? section.quantiles(model) : null;
		const value =
			section.kind === "ranked" ? section.value(model) : quantiles?.p50;
		if (!benchmark || value == null) continue;
		if (quantiles)
			spreads.set(model.id, { p90: quantiles.p90, p99: quantiles.p99 });
		rows.push({
			model: benchmark,
			value,
			point: {
				sourceId: null,
				sourceSlug: null,
				sourceUrl: benchmark.url,
				estimated: false,
				effortLabel: model.benchmarkEffort,
				effort: model.benchmarkEffort,
				effortOrder: 0,
				intelligenceIndex:
					usageBenchmark(model, snapshot)?.intelligenceIndex ?? null,
				costPerTaskUsd: null,
				timePerTaskSeconds: null,
				outputTokensPerTask: null,
				totalOutputTokens: null,
				totalCostUsd: null,
			},
		});
	}
	return { rows, spreads };
}

function lowerFirst(text: string) {
	return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/** The scatter's views: three insight layouts and the plain data. */
const LENSES = ["quadrants", "rows", "columns", "data"] as const;
type Lens = (typeof LENSES)[number];
/**
 * A view's name: rows and columns go by what their axis measures, as a tab
 * ("Intelligence", "Cost") or as the PNG's caption ("Ranked by cost").
 */
function lensName(
	lens: Lens,
	guide: TradeoffGuide | undefined,
	form: "tab" | "caption" = "tab",
) {
	const axis =
		lens === "rows"
			? (guide?.axes.vertical ?? "rows")
			: lens === "columns"
				? (guide?.axes.horizontal ?? "columns")
				: undefined;
	if (axis === undefined) return lens === "data" ? "Data" : "Quadrants";
	return form === "caption"
		? `Ranked by ${axis}`
		: `${axis.charAt(0).toUpperCase()}${axis.slice(1)}`;
}

function tradeoffGuide(sectionId: string): TradeoffGuide | undefined {
	return QUADRANT_GUIDES[sectionId];
}

/** Labs whose newest models lead "All models" under "Frontier". */
const FRONTIER_LABS: readonly TrendsProvider[] = [
	"openai",
	"anthropic",
	"google",
	"meta",
	"xai",
];

/**
 * Opaline's recommended frontier: the models the page lists and plots.
 * Falls back to every model in use if none of them is in the snapshot.
 */
const RECOMMENDED_FRONTIER = [
	"claude-fable-5-1",
	"claude-opus-5-5",
	"claude-sonnet-5-5",
	"gpt-6-astra",
	"gpt-6.1-sol",
	"gpt-6-luna",
] as const;

function recommendedIds(snapshot: TrendsSnapshot): ReadonlySet<string> {
	const available = new Set([
		...snapshot.models.map((model) => model.id),
		...(snapshot.benchmarks ?? []).map((model) => model.id),
	]);
	const ids = RECOMMENDED_FRONTIER.filter((id) => available.has(id));
	return new Set(
		ids.length > 0 ? ids : snapshot.models.map((model) => model.id),
	);
}

/** The newest model of each line from the frontier labs. */
function newestOfLines(
	benchmarks: readonly TrendsBenchmarkModel[],
): readonly TrendsBenchmarkModel[] {
	const newestOfLine = new Map<string, TrendsBenchmarkModel>();
	for (const model of benchmarks) {
		if (!model.line || !FRONTIER_LABS.includes(model.provider)) continue;
		const key = `${model.provider}:${model.line}`;
		const newest = newestOfLine.get(key);
		if (!newest || (model.releasedAt ?? "") > (newest.releasedAt ?? ""))
			newestOfLine.set(key, model);
	}
	return [...newestOfLine.values()];
}

/**
 * The page opens on "Frontier": the newest model of each line, so it
 * follows releases, with the Pareto line drawn through them and the models
 * off it hidden. Falls back to the recommended frontier without benchmarks.
 */
function defaultShownIds(snapshot: TrendsSnapshot): ReadonlySet<string> {
	const ids = newestOfLines(snapshot.benchmarks ?? []).map((model) => model.id);
	return ids.length > 0
		? new Set(ids.slice(0, MAX_SHOWN))
		: recommendedIds(snapshot);
}

function defaultState(snapshot: TrendsSnapshot): ExplorerState {
	const benchmarks = snapshot.benchmarks ?? [];
	const shown = defaultShownIds(snapshot);
	return {
		mode: benchmarks.length > 0 ? "benchmarks" : "wild",
		benchmarkId: "cost-intelligence",
		wildId: "run-time-months",
		view: "chart",
		log: true,
		frontier: true,
		frontierOnly: true,
		lens: "quadrants",
		effortLabels: false,
		modelLabels: true,
		arrangement: "grouped",
		efforts: new Set(REASONING_EFFORTS),
		modelIds: shown,
		listedIds: shown,
		harnessMeasure: "runs",
		harnessView: "split",
		frictionCounts: new Set(FRICTION_KINDS.map((kind) => kind.id)),
		frictionPer: "tokens",
		// Friction reads as a ranked list, a model's name under the last.
		frictionLayout: "rows",
	};
}

/** OpenAI's and Anthropic's models with friction figures, the most output
 * tokens first, as many as a chart shows. */
function frictionLabIds(snapshot: TrendsSnapshot): ReadonlySet<string> {
	return new Set(
		frictionRanked(snapshot)
			.filter(
				(model) =>
					model.provider === "openai" || model.provider === "anthropic",
			)
			.map((model) => model.id)
			.slice(0, MAX_SHOWN),
	);
}

/** The models a chart opens on: friction's OpenAI vs Anthropic (when it
 * has figures for them), every other chart the page's default. */
function chartDefaultIds(
	chart: ChartRef,
	snapshot: TrendsSnapshot,
	initial: ExplorerState,
): ReadonlySet<string> {
	if (chart.mode === "wild" && chart.id === "friction-model") {
		const ids = frictionLabIds(snapshot);
		if (ids.size > 0) return ids;
	}
	return initial.modelIds;
}

function sameIds(first: ReadonlySet<string>, second: ReadonlySet<string>) {
	return first.size === second.size && [...first].every((id) => second.has(id));
}

function stateFromHash(
	hash: string,
	initial: ExplorerState,
	snapshot: TrendsSnapshot,
): ExplorerState {
	const [route, query] = hash.replace(/^#/, "").split("?");
	const [dataset, chart] = route?.split("/") ?? [];
	const legacy = TRENDS_SECTIONS.find((section) => section.id === dataset);
	const routeTab = CHART_TABS.find((tab) => tab.route === dataset);
	// The retired pushback scatter's links open the cost scatter.
	const retiredPushback =
		chart === "pushback-intelligence" || dataset === "pushback-intelligence";
	// Older links named both usage tabs "wild".
	const mode = retiredPushback
		? "benchmarks"
		: legacy || dataset === "wild"
			? "wild"
			: (routeTab?.charts[0]?.mode ?? initial.mode);
	const params = new URLSearchParams(query);
	const benchmarkId =
		BENCHMARK_SECTIONS.find((section) => section.id === chart)?.id ??
		initial.benchmarkId;
	const wildId =
		legacy?.id ??
		TRENDS_SECTIONS.find(
			(section) =>
				section.id === chart &&
				CHART_TABS.some((tab) =>
					tab.charts.some(
						(option) => option.mode === "wild" && option.id === section.id,
					),
				),
		)?.id ??
		// A tab's link without a chart opens its home.
		(routeTab && routeTab.id !== "benchmarks"
			? tabHome(routeTab)?.id
			: undefined) ??
		initial.wildId;
	// A link without models opens on its chart's default ones.
	const chartDefault = chartDefaultIds(
		{ mode, id: mode === "benchmarks" ? benchmarkId : wildId },
		snapshot,
		initial,
	);
	const modelIds = params.get("models");
	const listedIds = params.get("list");
	const effortIds = params.get("efforts");
	const measure = params.get("measure");
	const selected =
		modelIds === null
			? undefined
			: new Set(
					modelIds
						.split(",")
						.filter((modelId) =>
							[...(snapshot.benchmarks ?? []), ...snapshot.models].some(
								(model) => model.id === modelId,
							),
						)
						// A shared link keeps to the chart's limit.
						.slice(0, MAX_SHOWN),
				);
	return {
		...initial,
		mode,
		benchmarkId,
		// Only charts a tab still offers; retired ones open the default.
		wildId,
		view: params.get("view") === "table" ? "table" : "chart",
		log: params.get("scale") !== "linear",
		// A link without settings (no query) opens with the defaults; the
		// page's own links always carry a query, where a missing flag is off.
		frontier:
			query === undefined
				? initial.frontier
				: params.get("pareto") === "1" || params.get("pareto") === "only",
		frontierOnly:
			query === undefined
				? initial.frontierOnly
				: params.get("pareto") === "only",
		// Quadrants by default (older links carried insight=1 for them).
		lens:
			params.get("data") === "1"
				? "data"
				: (LENSES.find((lens) => lens === params.get("lens")) ?? "quadrants"),
		effortLabels: params.get("labels") === "1",
		modelLabels:
			query === undefined ? initial.modelLabels : params.get("names") === "1",
		arrangement: params.get("bars") === "ranked" ? "ranked" : "grouped",
		efforts:
			effortIds === null
				? initial.efforts
				: new Set(
						REASONING_EFFORTS.filter((effort) =>
							effortIds.split(",").includes(effort),
						),
					),
		modelIds: selected ?? chartDefault,
		// Older links carry no list: the chart's default models plus the shown.
		listedIds:
			listedIds === null
				? new Set([...chartDefault, ...(selected ?? [])])
				: new Set(listedIds.split(",").filter(Boolean)),
		harnessMeasure: HARNESS_MEASURES.some((entry) => entry.id === measure)
			? (measure as HarnessMeasure)
			: initial.harnessMeasure,
		harnessView:
			params.get("harness") === "difference" ? "difference" : "split",
		// A comma list of what counts ("swears,apologies"); missing, "all" or
		// nothing valid counts all three.
		frictionCounts: frictionCountsFrom(params.get("count")),
		frictionPer: params.get("per") === "prompts" ? "prompts" : "tokens",
		frictionLayout: params.get("layout") === "columns" ? "columns" : "rows",
	};
}

function hashFromState(state: ExplorerState) {
	const params = new URLSearchParams();
	if (state.view === "table") params.set("view", "table");
	if (!state.log) params.set("scale", "linear");
	if (state.frontier) params.set("pareto", state.frontierOnly ? "only" : "1");
	if (state.lens === "data") params.set("data", "1");
	else if (state.lens !== "quadrants") params.set("lens", state.lens);
	if (state.effortLabels) params.set("labels", "1");
	if (state.modelLabels) params.set("names", "1");
	if (state.arrangement === "ranked") params.set("bars", "ranked");
	if (state.harnessMeasure !== "runs")
		params.set("measure", state.harnessMeasure);

	if (state.harnessView === "difference") params.set("harness", "difference");
	if (state.frictionCounts.size < FRICTION_KINDS.length)
		params.set(
			"count",
			FRICTION_KINDS.filter((kind) => state.frictionCounts.has(kind.id))
				.map((kind) => kind.id)
				.join(","),
		);
	if (state.frictionPer !== "tokens") params.set("per", state.frictionPer);
	if (state.frictionLayout !== "rows")
		params.set("layout", state.frictionLayout);
	params.set(
		"efforts",
		REASONING_EFFORTS.filter((effort) => state.efforts.has(effort)).join(","),
	);
	params.set("models", [...state.modelIds].join(","));
	params.set("list", [...state.listedIds].join(","));
	const chart = state.mode === "benchmarks" ? state.benchmarkId : state.wildId;
	return `#${chartTab({ mode: state.mode, id: chart }).route}/${chart}?${params}`;
}
