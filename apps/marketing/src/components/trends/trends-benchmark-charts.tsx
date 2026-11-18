import { motion } from "motion/react";
import {
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	type BenchmarkMetric,
	type BenchmarkObservation,
	type BenchmarkSection,
	benchmarkGroups,
	benchmarkObservations,
	EFFORT_LABELS,
	REASONING_EFFORTS,
	reasoningLineSegments,
} from "../../trends/trends-benchmarks";
import type { QuadrantGuide } from "../../trends/trends-quadrants";
import type {
	TrendsBenchmarkModel,
	TrendsProvider,
	TrendsReasoningEffort,
} from "../../trends/trends-snapshot";
import { ProviderMark, SvgProviderMark } from "./trends-marks";
import { AnimatedValue, TRENDS_SPRING } from "./trends-motion";
import type { InspectedPeriod } from "./trends-plot-charts";
import type { TooltipRow } from "./trends-tooltip";

/*
 * Benchmark charts carry no series hue. Identity is the provider mark and a
 * direct label beside each series; reasoning effort is point size (and a
 * letter once a model is focused); emphasis is hover, focus and the opal
 * signature for the leader. That keeps seven overlapping models legible
 * without a palette that the all-pairs validator could not clear.
 */

export interface TradeoffPoint {
	readonly sourceUrl?: string;
	readonly id: string;
	readonly effort: string;
	/** Position on the none → max effort scale; drives marker size. */
	readonly effortIndex: number;
	readonly horizontal: number;
	readonly vertical: number;
	readonly rows: readonly TooltipRow[];
	/** Shown under the model's name in the comparison panel (its reasoning). */
	readonly subtitle?: string;
	/** The value is Artificial Analysis's estimate, not a measurement. */
	readonly estimated?: boolean;
}

export interface TradeoffSeries {
	readonly id: string;
	readonly name: string;
	readonly provider: TrendsProvider;
	readonly points: readonly TradeoffPoint[];
	/** Series color; colored series carry identity by hue, not direct labels. */
	readonly color?: string;
}

interface FocusProps {
	readonly focusIds: ReadonlySet<string>;
	/** additive: Shift, Cmd or Ctrl held, so the model joins the focus. */
	readonly onFocusModel: (id: string, additive: boolean) => void;
}

interface TradeoffProps extends FocusProps {
	readonly series: readonly TradeoffSeries[];
	/** The model list stands beside the plot, so it keeps its leaders'
	 * corridor; without it (phones) the plot takes the width. */
	readonly listBeside?: boolean;
	/** With the frontier shown, hide every point and line off it. */
	readonly frontierOnly?: boolean;
	readonly horizontalLabel: string;
	/** Shown for the horizontal axis title instead of its label: a control. */
	readonly horizontalControl?: ReactNode;
	readonly verticalLabel: string;
	/** Chart title, set flush with the plot box's top-left corner. */
	readonly title?: ReactNode;
	/** Chart controls, flush with the plot box's top-right corner. */
	readonly toolbar?: ReactNode;
	readonly formatHorizontal: (value: number) => string;
	readonly formatVertical: (value: number) => string;
	readonly log: boolean;
	/** Show the effort letter on every point, not only the focused model. */
	readonly effortLabels: boolean;
	readonly frontier: readonly TradeoffPoint[];
	/** Name each series at its end point. Off when series are colored. */
	readonly directLabels?: boolean;
	/** Name every model on the plot: beside its last point where there is
	 * room, otherwise in a column at the plot's right edge with a leader. */
	readonly modelLabels?: boolean;
	/** Reports the models being compared (a point pinned), or none, so the
	 * model list can step back too. */
	readonly onCompare?: (modelIds: ReadonlySet<string>) => void;
	/** Optional better/worse wash with corner labels. */
	readonly guide?: TradeoffGuide;
	/** How the guide splits the plot: four quadrants, or three bands across
	 * the vertical axis (rows) or the horizontal one (columns); none (the
	 * data view) shows the guide faded out. */
	readonly guideLayout?: GuideLayout;
	/** Hide every number and keep only the quadrant words. */
	readonly insight?: boolean;
	/** What the horizontal axis costs ("cost", "time"), when the vertical is
	 * a score: the comparison panel then spells out each step's trade. */
	readonly trade?: string;
}

export type TradeoffGuide = QuadrantGuide;
export type GuideLayout = "quadrants" | "rows" | "columns";
const GUIDE_LAYOUTS: readonly GuideLayout[] = ["quadrants", "rows", "columns"];

/** Bars show focus; the model list beside them sets it. */
/** What a column chart measures: a benchmark section, or (with `rows`) any
 * figure with a name, a unit and a format. */
type BarsSection = Pick<BenchmarkSection, "id" | "tab" | "unit" | "format"> & {
	readonly metric?: BenchmarkMetric;
};

/** A model's spread past the column's median, for in-the-wild runs. */
export interface ColumnSpread {
	readonly p90: number;
	readonly p99?: number;
}

interface BenchmarkBarsProps extends Pick<FocusProps, "focusIds"> {
	readonly section: BarsSection;
	/** As the scatter's: the list's corridor only where the list is beside. */
	readonly listBeside?: boolean;
	readonly models: readonly TrendsBenchmarkModel[];
	readonly efforts: ReadonlySet<TrendsReasoningEffort>;
	/** The scatter's room for tick labels under its plot (none in the insight
	 * views), so both plot boxes keep one size. */
	readonly tickRoom?: number;
	/** Lowest first either way. Grouped: a model's columns stand together.
	 * Ranked: every model and effort its own column. */
	readonly arrangement?: "grouped" | "ranked";
	/** Each model's chart color, as on the scatter charts. */
	readonly colors?: ReadonlyMap<string, string>;
	/** The models being compared (none when nothing is), for the list. */
	readonly onCompare?: (modelIds: ReadonlySet<string>) => void;
	/** The hovered or pinned column's figure, and with both the hovered
	 * one's difference from the pinned, by model id, for the list; undefined
	 * when nothing is hovered or pinned. */
	readonly onInspect?: (inspected: InspectedPeriod | undefined) => void;
	/** Columns to draw instead of the section's benchmark observations: one
	 * per model, with no reasoning efforts (in-the-wild figures). */
	readonly rows?: readonly BenchmarkObservation[];
	/** p90 and p99 marks over each model's column, by model id. */
	readonly spreads?: ReadonlyMap<string, ColumnSpread>;
	/** The axis title under the plot; by default the efforts' order. */
	readonly axisTitle?: string;
	/** A log axis on these ticks (those spanning the figures), the columns
	 * rising from the lowest; linear from zero without. */
	readonly logTicks?: readonly number[];
}

const MARK_RADII = [2.75, 3, 3.25, 3.75, 4.25, 4.75, 5.25];
/** A crowded column group at its slimmest (its name on two lines), with its
 * gap (see data-dense). */
const DENSE_GROUP_PITCH = 64 + 6;
/** A ranked column at its slimmest, with its gap (see data-ranking). */
const RANKED_COLUMN_PITCH = 4 + 2;
const LABEL_HEIGHT = 16;
/** Space Pareto names keep from every dot and line, relaxed in turn. */
const TAG_CLEARANCES = [16, 10, 6];
/** Entrance: time for a line to travel from one dot to the next. */
const DRAW_STEP_MS = 150;
const CHARACTER_WIDTH = 6.4;

export function shortModelName(name: string) {
	return name
		.replace(/^Claude /, "")
		.replace(/^GPT-6\.1 /, "6.1 ")
		.replace(/^GPT-6 /, "6 ");
}

// On-plot model names, replaced by the legend leaders; kept for reference.
// /** Width of a NameTag: legend dot, lab icon, then the short name. */
// function nameTagWidth(model: TradeoffSeries) {
// 	return shortModelName(model.name).length * CHARACTER_WIDTH + 34;
// }
//
// /**
//  * A model's name on the plot, read like the sidebar legend: its colour dot,
//  * its lab icon, then its short name. Drawn from (0, 0) at its left edge and
//  * vertical centre.
//  */
// function NameTag({ model }: { readonly model: TradeoffSeries }) {
// 	return (
// 		<>
// 			<g
// 				className="trends-tag-dot"
// 				style={
// 					model.color
// 						? ({ "--key-color": model.color } as CSSProperties)
// 						: undefined
// 				}
// 			>
// 				<circle cx={6} cy={0} r={6.25} />
// 				<circle cx={6} cy={0} r={3.25} />
// 			</g>
// 			<SvgProviderMark provider={model.provider} x={16} y={-6} size={12} />
// 			<text className="trends-direct-label" x={32} y={4}>
// 				{shortModelName(model.name)}
// 			</text>
// 		</>
// 	);
// }

export function TradeoffPlot({
	series: incomingSeries,
	horizontalLabel: incomingHorizontalLabel,
	horizontalControl,
	verticalLabel,
	title,
	toolbar,
	formatHorizontal: incomingFormatHorizontal,
	formatVertical,
	log: incomingLog,
	effortLabels,
	frontier: incomingFrontier,
	directLabels = true,
	modelLabels = false,
	onCompare,
	guide,
	guideLayout,
	insight = false,
	trade,
	frontierOnly = false,
	focusIds,
	listBeside = true,
}: TradeoffProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const { width, height, measured } = usePlotSize(containerRef);
	// Too narrow for the title and the controls to share the plot's top
	// edge (tablets, phones): they stack in a header over it, and the plot
	// starts under them.
	const stacked = width < 1000 && Boolean(title || toolbar);
	const [head, setHead] = useState<HTMLDivElement | null>(null);
	const [headHeight, setHeadHeight] = useState(0);
	// Measured whenever the header is on screen (it renders once the plot
	// has its size).
	useLayoutEffect(() => {
		if (!head) return;
		const measure = () => setHeadHeight(head.offsetHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(head);
		return () => observer.disconnect();
	}, [head]);
	const incomingGeneration = `${incomingHorizontalLabel}|${incomingLog}`;
	// Only the parts of lines that change (a reasoning level, a model) retract
	// first and then draw in; a new chart or scale retracts every line, lets
	// the dots glide, then connects them again. Until then the plot keeps the
	// old set.
	const {
		series,
		frontier: paretoPoints,
		generation,
		log,
		axis: { horizontalLabel, formatHorizontal },
		regenerating,
		leavingSteps,
		leavingLeaders,
		leavingPoints,
		exit,
		settledAt,
		leaderEpochs,
	} = useStagedSeries(
		incomingSeries,
		incomingFrontier,
		incomingGeneration,
		incomingLog,
		{
			horizontalLabel: incomingHorizontalLabel,
			formatHorizontal: incomingFormatHorizontal,
		},
		!directLabels && modelLabels,
	);
	// When the shown chart or scale last changed, so new lines wait for the
	// dots to glide there.
	const lastGeneration = useRef({ generation, at: Number.NEGATIVE_INFINITY });
	// With Model labels on, each model's line runs into its colour dot in
	// the model list beside the plot, with the frontier on or off.
	const legendLeaders = !directLabels && modelLabels;
	const legendTargets = useLegendTargets(
		containerRef,
		series.map((model) => model.id),
		legendLeaders,
	);
	// Draw delays, fixed when an element first appears (keyed like it), and
	// measured from when the plot mounted, so a line added later (a Pareto
	// frontier switched on, leaders redrawn for a new chart) starts from now
	// instead of replaying the entrance.
	const mountedAt = useRef(performance.now());
	const drawDelays = useRef(new Map<string, number>());
	// When each element starts drawing, measured from mount.
	const drawStarts = useRef(new Map<string, number>());
	const renderedDelays = useRef<ReadonlySet<string>>(new Set());
	// Elements leaving in the last render: one that stops leaving (the
	// change reversed mid-way) runs back from where it is, at once.
	const wasLeaving = useRef<ReadonlySet<string>>(new Set());
	// Forget delays of elements that are gone, so they draw afresh if they
	// come back.
	useEffect(() => {
		for (const key of drawDelays.current.keys())
			if (!renderedDelays.current.has(key)) {
				drawDelays.current.delete(key);
				drawStarts.current.delete(key);
			}
	});
	// Where each model's colour dot last was, so a leader can retract into
	// it after the model's row has left the list.
	const knownTargets = useRef(
		new Map<string, { readonly x: number; readonly y: number }>(),
	);
	// Where a leaving leader's colour dot was when it started to leave: it
	// retracts in place there, rather than chasing a row the list is already
	// moving (as when the frontier is switched off and the list regroups).
	const frozenTargets = useRef(
		new Map<string, { readonly x: number; readonly y: number }>(),
	);
	// The compared models, set during render and reported after it.
	const comparedModels = useRef<readonly string[]>([]);
	const reportedCompared = useRef("");
	useLayoutEffect(() => {
		const key = comparedModels.current.join(",");
		if (!onCompare || key === reportedCompared.current) return;
		reportedCompared.current = key;
		onCompare(new Set(comparedModels.current));
	});
	const [hoverId, setHoverId] = useState<string | null>(null);
	// Pinned points carry crosshairs and fill the comparison panel; the
	// preview is the point under the pointer or keyboard focus.
	const [pinnedIds, setPinnedIds] = useState<readonly string[]>([]);
	const [previewId, setPreviewId] = useState<string | null>(null);
	// A comparison belongs to one chart: switching charts lets it go (a new
	// scale keeps it, the points are the same).
	const [pinnedChart, setPinnedChart] = useState(incomingHorizontalLabel);
	if (pinnedChart !== incomingHorizontalLabel) {
		setPinnedChart(incomingHorizontalLabel);
		setPinnedIds([]);
		setPreviewId(null);
	}
	const panelId = useId();
	// A click anywhere outside the comparison lets it go, except on the
	// points (they pin and unpin themselves) and the chart's controls (the
	// PNG export takes the comparison along).
	const anyPinned = pinnedIds.length > 0;
	useEffect(() => {
		if (!anyPinned) return;
		const outside = (event: PointerEvent) => {
			const target = event.target;
			if (
				target instanceof Element &&
				target.closest(".trends-compare, .trends-hit, .trends-plot-toolbar")
			)
				return;
			setPinnedIds([]);
			setPreviewId(null);
		};
		document.addEventListener("pointerdown", outside);
		return () => document.removeEventListener("pointerdown", outside);
	}, [anyPinned]);
	if (!measured) return <div ref={containerRef} className="trends-tradeoff" />;
	// Two points at most: a third replaces the second, so the first (what
	// everything is compared against) stays. Pins the plot no longer shows
	// (a model or reasoning level taken off) drop out first.
	const togglePin = (pointId: string) =>
		setPinnedIds((current) => {
			const shown = current.filter((id) => lookup.has(id));
			return shown.includes(pointId)
				? shown.filter((id) => id !== pointId)
				: [...shown.slice(0, MAX_PINNED - 1), pointId];
		});
	const narrow = width < 560;
	// Alone on a phone the plot runs edge to edge; its few figures stand
	// inside it, over their grid lines.
	const left = listBeside ? plotLeft(width) : 0;
	const top = stacked ? headHeight + 16 : title ? 44 : 20;
	// Room under the plot for the tick labels (hidden in insight mode), then
	// the axis title, spaced like the chart title above the plot.
	const tickRoom = insight ? 0 : 20;
	// The band under the plot every chart keeps for its axis labels and
	// title, so all their plot boxes match.
	const bottom = height - 52 - tickRoom;
	const validSeries = series
		.map((model) => ({
			...model,
			points: model.points.filter((point) => !log || point.horizontal > 0),
		}))
		.filter((model) => model.points.length > 0);
	const points = validSeries.flatMap((model) => model.points);
	const verticalValues = points.map((point) => point.vertical);
	// Both axes fit the plotted data with an even number of equal cells, so
	// the middle of each axis is a gridline and quadrants are whole cells that
	// split the models rather than sit beside them.
	const horizontalGridSpec = evenGrid(
		points.map((point) => point.horizontal),
		log,
	);
	const verticalGridSpec = evenGrid(verticalValues, false);
	// Phones keep only the decade labels so the 1-3-10 labels never collide.
	const horizontalTicks =
		log && narrow
			? horizontalGridSpec.labels.filter((value) =>
					Number.isInteger(Math.log10(value)),
				)
			: horizontalGridSpec.labels;
	const horizontalGrid = horizontalGridSpec.grid;
	const horizontalMin = horizontalGridSpec.min;
	const horizontalMax = horizontalGridSpec.max;
	const verticalMin = verticalGridSpec.min;
	const verticalTop = verticalGridSpec.max;
	const verticalPosition = (value: number) =>
		bottom -
		((value - verticalMin) / (verticalTop - verticalMin || 1)) * (bottom - top);
	// Model-list leaders. Their lanes depend only on heights, so the corridor
	// beside the plot is sized before the horizontal scale. With the frontier
	// on, only the frontier's models get lines; the rest stand faded.
	const legendItems = legendLeaders
		? validSeries.flatMap((model) => {
				const end = legendAnchor(model, paretoPoints);
				const leaving = leavingLeaders.has(model.id);
				if (!leaving) frozenTargets.current.delete(model.id);
				else if (!frozenTargets.current.has(model.id)) {
					const was =
						knownTargets.current.get(model.id) ?? legendTargets.get(model.id);
					if (was) frozenTargets.current.set(model.id, was);
				}
				const target = leaving
					? (frozenTargets.current.get(model.id) ?? legendTargets.get(model.id))
					: legendTargets.get(model.id);
				const offFrontier =
					paretoPoints.length > 0 &&
					!model.points.some((point) =>
						paretoPoints.some(({ id }) => id === point.id),
					);
				return end && target && !offFrontier
					? [
							{
								id: model.id,
								end,
								fromY: verticalPosition(end.vertical),
								to: target,
							},
						]
					: [];
			})
		: [];
	for (const [id, target] of legendTargets)
		knownTargets.current.set(id, target);
	const lanes = metroLanes(
		legendItems.map(({ id, fromY, to }) => ({ id, fromY, toY: to.y })),
	);
	// One fixed corridor for the leaders beside every benchmark plot, sized
	// for the widest lanes, so the plot keeps its width whatever is shown.
	// Alone on a phone the plot keeps the width and its names stay inside
	// it; elsewhere names get a margin of their own.
	const right =
		width -
		(!listBeside
			? ALONE_CORRIDOR
			: directLabels
				? narrow
					? 84
					: 112
				: METRO_CORRIDOR);
	const horizontalPosition = (value: number) =>
		left +
		scaleValue(value, horizontalMin, horizontalMax, log) * (right - left);
	const frontier = paretoPoints;
	const frontierIds = new Set(frontier.map((point) => point.id));
	const lookup = new Map(
		validSeries.flatMap((model) =>
			model.points.map((point) => [point.id, { model, point }] as const),
		),
	);
	const pinned = pinnedIds.flatMap((id) => {
		const entry = lookup.get(id);
		return entry ? [entry] : [];
	});
	// With two points pinned the comparison is full; hovering adds nothing.
	const preview =
		previewId && !pinnedIds.includes(previewId) && pinned.length < MAX_PINNED
			? lookup.get(previewId)
			: undefined;
	const compared = [...pinned, ...(preview ? [preview] : [])];
	// Comparing (a point pinned): every dot and line but the compared points
	// steps back, the frontier's too, and every leader goes; letting go of the
	// pins brings it all back.
	const comparing = pinned.length > 0;
	const comparedIds = new Set(compared.map(({ point }) => point.id));
	comparedModels.current = comparing
		? [...new Set(compared.map(({ model }) => model.id))]
		: [];
	const comparedFirst = compared[0];
	const comparedLast = compared.at(-1);
	// The dashed line between them takes the verdict's color, like the
	// compass in the panel.
	// The chart's own spans, which make steepness the line's angle as the
	// chart draws it: doublings across the price axis (always read on the log
	// scale, so Log and Linear agree) and points up the score axis.
	const priceGrid = evenGrid(
		points.map((point) => point.horizontal).filter((value) => value > 0),
		true,
	);
	const tradeScale: TradeScale = {
		doublings: Math.log2(priceGrid.max / priceGrid.min) || 1,
		points: verticalTop - verticalMin || 1,
	};
	// Steepness only means something on the log chart, where equal ratios
	// look equal; on Linear the line stays plain ink.
	const compareTone =
		trade && log && comparedFirst && comparedLast && compared.length > 1
			? verdictFor(comparedFirst.point, comparedLast.point, tradeScale).tone
			: undefined;
	// Comparing fades everything but the compared dots, so the comparison
	// reads clearly, with the frontier on or off.
	const emphasisFor = (model: TradeoffSeries) =>
		comparing
			? "faded"
			: focusIds.size > 0
				? focusIds.has(model.id)
					? "focus"
					: hoverId === model.id
						? "hover"
						: "faded"
				: hoverId !== null
					? hoverId === model.id
						? "hover"
						: "faded"
					: "neutral";
	// Pareto mode: a single frontier line and its points stay lit; every model
	// line and every other point steps back, even within the same model.
	const frontierMode = frontier.length > 0 && focusIds.size === 0;
	const emptyCells = shadedCells(validSeries, frontier, log, generation);
	// Cells the incoming chart, scale or frontier no longer shades fade out
	// while the frontier retracts, instead of vanishing when the new set
	// takes over.
	const keptCells = new Set(
		shadedCells(
			incomingSeries,
			incomingFrontier,
			incomingLog,
			incomingGeneration,
		).map((cell) => cell.key),
	);
	const labelLimit = !directLabels
		? 0
		: validSeries.length > 12
			? narrow
				? 5
				: 8
			: validSeries.length;
	// Direct labels belong to charts without the model list beside them; the
	// benchmark charts name models in the list, so hover and focus add none.
	// Only models still drawn get a name: with the models off the Pareto
	// line hidden, the line's own.
	const labelSeries = directLabels
		? directLabelSeries(
				frontierOnly && frontierMode
					? validSeries.filter((model) =>
							model.points.some((point) => frontierIds.has(point.id)),
						)
					: validSeries,
				labelLimit,
				focusIds,
				hoverId,
			)
		: [];
	const placed = placeDirectLabels(
		labelSeries.flatMap((model) => {
			const end = model.points.at(-1);
			return end
				? [
						{
							id: model.id,
							priority: focusIds.has(model.id)
								? 2
								: model.id === hoverId
									? 1
									: 0,
							x: horizontalPosition(end.horizontal),
							y: verticalPosition(end.vertical),
							width: shortModelName(model.name).length * CHARACTER_WIDTH + 18,
						},
					]
				: [];
		}),
		points.map((point) => ({
			left: horizontalPosition(point.horizontal) - 7,
			right: horizontalPosition(point.horizontal) + 7,
			top: verticalPosition(point.vertical) - 7,
			bottom: verticalPosition(point.vertical) + 7,
		})),
		listBeside
			? { left, top: 4, right: width - 4, bottom }
			: { left: left + 4, top: top + 4, right: right - 4, bottom: bottom - 4 },
	);
	const toPixels = (point: TradeoffPoint) => ({
		x: horizontalPosition(point.horizontal),
		y: verticalPosition(point.vertical),
	});
	// On-plot model names (inline, stacked and Pareto), replaced by the
	// legend leaders; kept for reference.
	// const segmentsOf = (line: readonly TradeoffPoint[]) =>
	// 	line.slice(1).map((point, index) => {
	// 		const from = toPixels(line[index] ?? point);
	// 		const to = toPixels(point);
	// 		return [from.x, from.y, to.x, to.y] as const;
	// 	});
	// const frontierSegments = segmentsOf(frontier);
	// const marks = validSeries.map((model) => ({
	// 	model,
	// 	points: model.points.map(toPixels),
	// 	segments: reasoningLineSegments(model.points).flatMap(segmentsOf),
	// 	// Frontier steps that start or end on this model count as its line.
	// 	frontierSegments: frontierSegments.filter((_, index) =>
	// 		[frontier[index], frontier[index + 1]].some(
	// 			(point) => point && model.points.some(({ id }) => id === point.id),
	// 		),
	// 	),
	// }));
	// // With the Pareto frontier on, each model on it is named once, on the
	// // line of one of its frontier dots just left of it. Models that find no
	// // room there are named like any other model.
	// const tagged =
	// 	!directLabels && frontier.length > 0
	// 		? placeFrontierTags(
	// 				validSeries.flatMap((model) => {
	// 					const run = frontier
	// 						.filter((point) => lookup.get(point.id)?.model.id === model.id)
	// 						.map(toPixels);
	// 					return run.length > 0
	// 						? [
	// 								{
	// 									id: model.id,
	// 									run,
	// 									width: nameTagWidth(model),
	// 								},
	// 							]
	// 						: [];
	// 				}),
	// 				marks.flatMap((mark) => mark.points),
	// 				[...marks.flatMap((mark) => mark.segments), ...frontierSegments],
	// 				{ left, top, right, bottom },
	// 			)
	// 		: new Map<string, ModelLabel>();
	// // Models off the frontier keep their usual names, dimmed in Pareto mode.
	// const named =
	// 	!directLabels && (modelLabels || frontier.length > 0)
	// 		? placeModelLabels(
	// 				marks.flatMap(({ model, points: own, segments, ...rest }) => {
	// 					const end = own.at(-1);
	// 					return end && !tagged.has(model.id)
	// 						? [
	// 								{
	// 									id: model.id,
	// 									...end,
	// 									width: nameTagWidth(model),
	// 									own: {
	// 										points: own,
	// 										segments: [...segments, ...rest.frontierSegments],
	// 									},
	// 								},
	// 							]
	// 						: [];
	// 				}),
	// 				marks.flatMap((mark) => mark.points),
	// 				[...marks.flatMap((mark) => mark.segments), ...frontierSegments],
	// 				{ left, top, right, bottom },
	// 				// Names already given to the frontier's models.
	// 				[...tagged.values()].map((tag) => ({
	// 					left: tag.left - 4,
	// 					right: tag.left + tag.width + 4,
	// 					top: tag.cy - LABEL_HEIGHT / 2 - 4,
	// 					bottom: tag.cy + LABEL_HEIGHT / 2 + 4,
	// 				})),
	// 			)
	// 		: new Map<string, ModelLabel>();
	const legendRoutes = metroRoutes(
		legendItems.map(({ id, end, to }) => ({ id, from: toPixels(end), to })),
		lanes,
		width,
	);
	if (points.length === 0)
		return (
			<div ref={containerRef} className="trends-tradeoff">
				<p className="trends-empty">
					No observations for these models and reasoning efforts.
				</p>
			</div>
		);
	const verticalTicks = verticalGridSpec.grid;
	// Dots pop in one by one (see .trends-mark-group); lines wait for the last.
	const dotsDone =
		150 +
		Math.max(
			0,
			...validSeries.map(
				(model, seriesIndex) => seriesIndex * 2 + model.points.length - 1,
			),
		) *
			22 +
		420;
	const sinceMount = performance.now() - mountedAt.current;
	// Which elements were already drawn before this render.
	const drawnBefore = new Set(drawDelays.current.keys());
	const seenDelays = new Set<string>();
	renderedDelays.current = seenDelays;
	// `at` is measured from mount; the delay returned runs from the element's
	// first appearance and then stays fixed for that element.
	const drawDelay = (key: string, at: number) => {
		seenDelays.add(key);
		const known = drawDelays.current.get(key);
		if (known !== undefined) return known;
		const delay = Math.max(0, at - sinceMount);
		drawDelays.current.set(key, delay);
		drawStarts.current.set(key, sinceMount + delay);
		return delay;
	};
	// The frontier draws step by step after the dots' entrance, or from now
	// when switched on later; each leader draws on once its line (or the
	// frontier) reaches the dot it leaves from.
	if (generation !== lastGeneration.current.generation)
		lastGeneration.current = { generation, at: sinceMount };
	const frontierStart = sinceMount < dotsDone ? dotsDone : sinceMount;
	// Shaded cells fade in at once when the frontier is switched on; after a
	// new chart or scale they wait for the dots to be well on their way.
	const cellDelay = (key: string) =>
		drawDelay(
			key,
			Math.max(sinceMount, lastGeneration.current.at + GLIDE_MS / 2),
		);
	const cellsOutEnd = exit.dotsAt || exit.total;
	const cellsOutStart = Math.max(0, cellsOutEnd - RETRACT_MS);
	const frontierKey = (from: TradeoffPoint, to: TradeoffPoint) =>
		`${panelId}-frontier-${generation}-${from.id}-${to.id}`;
	const stillOnFrontier = new Set(
		regenerating
			? []
			: incomingFrontier
					.slice(1)
					.map((point, index) => `${incomingFrontier[index]?.id}-${point.id}`),
	);
	// Leaders are redrawn after a change that moves where they start.
	const leaderKey = (model: TradeoffSeries) =>
		`legend-${model.id}-${generation}-${leaderEpochs.get(model.id) ?? 0}-${frontier.length > 0}-${legendAnchor(model, frontier)?.id}`;
	// And only once the model list's rows have glided to their new place.
	const rowsSettled =
		settledAt - mountedAt.current + ROW_GLIDE_MS + ROW_ALIGN_MS;
	// Steps (dot to dot) not yet drawn wait for the new steps before them,
	// so a change only draws what is new, in order.
	const stepDelay = (key: string, entrance: number, fresh: number) =>
		drawDelay(
			key,
			sinceMount < dotsDone
				? entrance
				: Math.max(
						sinceMount + DOT_LEAD_MS,
						lastGeneration.current.at + GLIDE_MS,
					) +
						fresh * DRAW_STEP_MS,
		);
	// Dots that appear after the entrance pop in at once; lines wait for them.
	const popOrder = (seriesIndex: number, pointIndex: number) =>
		sinceMount < dotsDone ? seriesIndex * 2 + pointIndex : 0;
	const freshBefore = (keys: readonly string[], upTo: number) =>
		keys.slice(0, upTo).filter((key) => !drawnBefore.has(key)).length;
	const lineSteps = (model: TradeoffSeries) =>
		reasoningLineSegments(model.points).flatMap((segment) =>
			segment
				.slice(1)
				.map((point, index) => ({ from: segment[index] ?? point, to: point })),
		);
	const stepKey = (
		model: TradeoffSeries,
		from: TradeoffPoint,
		to: TradeoffPoint,
	) => `${generation}|${model.id}:${from.id}>${to.id}`;
	const frontierKeys = frontier
		.slice(1)
		.map((point, index) => frontierKey(frontier[index] ?? point, point));
	const goneFrontier = frontierKeys.filter((key, index) => {
		const to = frontier[index + 1];
		return !stillOnFrontier.has(`${frontier[index]?.id}-${to?.id}`);
	});
	// Lines, frontier steps, leaders and cells are transitions, so one that
	// was leaving and no longer is runs back from where it stands; it starts
	// at once rather than after its first-draw delay.
	const nowLeaving = new Set([
		...leavingSteps,
		...goneFrontier,
		...validSeries
			.filter((model) => leavingLeaders.has(model.id))
			.map(leaderKey),
		...emptyCells
			.filter((cell) => !keptCells.has(cell.key))
			.map((cell) => cell.key),
	]);
	for (const key of wasLeaving.current)
		if (!nowLeaving.has(key)) {
			drawDelays.current.set(key, 0);
			drawStarts.current.set(key, sinceMount);
		}
	wasLeaving.current = nowLeaving;
	// Every step's delay, worked out before the leaders that follow them.
	const stepTiming = new Map<string, number>();
	validSeries.forEach((model, seriesIndex) => {
		const keys = lineSteps(model).map(({ from, to }) =>
			stepKey(model, from, to),
		);
		keys.forEach((key, index) => {
			stepTiming.set(
				key,
				stepDelay(
					key,
					dotsDone + seriesIndex * 90 + index * DRAW_STEP_MS,
					freshBefore(keys, index),
				),
			);
		});
	});
	frontierKeys.forEach((key, index) => {
		stepTiming.set(
			key,
			stepDelay(
				key,
				frontierStart + index * DRAW_STEP_MS,
				freshBefore(frontierKeys, index),
			),
		);
	});
	// A leader draws once its line (or the frontier) has actually reached
	// the dot it leaves from: always after its dots and its line.
	const leaderDelay = (model: TradeoffSeries) => {
		const anchor = legendAnchor(model, frontier);
		const finished = (key: string | undefined) =>
			key === undefined
				? undefined
				: (drawStarts.current.get(key) ?? sinceMount) + DRAW_STEP_MS;
		const dotsIn =
			sinceMount < dotsDone
				? dotsDone
				: Math.max(sinceMount + DOT_LEAD_MS, rowsSettled);
		if (frontier.length > 0) {
			const reached = frontier.findIndex((point) => point.id === anchor?.id);
			return drawDelay(
				leaderKey(model),
				Math.max(finished(frontierKeys[reached - 1]) ?? frontierStart, dotsIn),
			);
		}
		const ends = lineSteps(model).flatMap(({ from, to }) => {
			const end = finished(stepKey(model, from, to));
			return end === undefined ? [] : [end];
		});
		return drawDelay(leaderKey(model), Math.max(dotsIn, ...ends));
	};
	return (
		<div
			className="trends-tradeoff"
			ref={containerRef}
			data-insight={insight}
			data-frontier-only={frontierOnly && frontierMode}
			data-comparing={comparing}
			data-focusing={focusIds.size > 0}
			data-guide={guide ? guideLayout : undefined}
		>
			{/* HTML, not SVG text, so a link in the title gets a real underline.
			    A div, not a p: the title can hold a control. */}
			{stacked ? (
				<div className="trends-plot-head" ref={setHead}>
					{title ? <div className="trends-unit">{title}</div> : null}
					{toolbar}
				</div>
			) : (
				<>
					{title ? (
						<div className="trends-plot-title" style={{ left }}>
							{title}
						</div>
					) : null}
					{toolbar ? (
						<div
							className="trends-plot-toolbar"
							style={{ right: width - right }}
						>
							{toolbar}
						</div>
					) : null}
				</>
			)}
			{/* The PNG export draws the label, not the control. */}
			<div
				className="trends-plot-title trends-plot-axis-title"
				style={{ left: (left + right) / 2, top: bottom + 26 + tickRoom }}
				data-label={`${horizontalLabel}${log ? ", log scale" : ""}`}
			>
				{/* A control states its own scale (it holds the log switch). */}
				{horizontalControl ?? horizontalLabel}
				{!horizontalControl && log ? ", log scale" : ""}
			</div>
			<svg
				viewBox={`0 0 ${width} ${height}`}
				width={width}
				height={height}
				aria-label={`${verticalLabel} by ${horizontalLabel}${log ? ", log scale" : ""}`}
			>
				{/* Every layout stays drawn and crossfades: switching views fades
				    the old colours, lines and names out as the new come in. */}
				{guide && points.length > 0
					? GUIDE_LAYOUTS.map((layout) => (
							<GuideQuadrants
								key={layout}
								guide={guide}
								layout={layout}
								active={guideLayout === layout}
								box={{ left, top, right, bottom }}
								splitX={(left + right) / 2}
								splitY={(top + bottom) / 2}
							/>
						))
					: null}
				{verticalTicks.map((value) => (
					<g key={value}>
						<line
							className="trends-grid-line"
							x1={left}
							x2={right}
							y1={verticalPosition(value)}
							y2={verticalPosition(value)}
						/>
						<text
							className="trends-axis-tick"
							x={listBeside ? left - 10 : left + 6}
							y={verticalPosition(value) + (listBeside ? 4 : -5)}
							textAnchor={listBeside ? "end" : "start"}
						>
							{formatVertical(value)}
						</text>
					</g>
				))}
				{horizontalGrid.map((value) => (
					<line
						key={`grid-${value}`}
						className="trends-grid-line"
						x1={horizontalPosition(value)}
						x2={horizontalPosition(value)}
						y1={top}
						y2={bottom}
					/>
				))}
				{horizontalTicks.map((value) => {
					// Edge to edge on a phone, a figure at either end of the
					// plot ends inside it rather than past the screen.
					const at = horizontalPosition(value);
					const anchor =
						listBeside || (at > left + 24 && at < right - 24)
							? "middle"
							: at <= left + 24
								? "start"
								: "end";
					return (
						<text
							key={value}
							className="trends-axis-tick"
							x={at}
							y={bottom + 20}
							textAnchor={anchor}
						>
							{formatHorizontal(value)}
						</text>
					);
				})}
				{emptyCells.map((cell) => (
					<rect
						key={cell.key}
						className="trends-dominated"
						data-leaving={!keptCells.has(cell.key)}
						style={
							{
								"--enter-delay": `${cellDelay(cell.key)}ms`,
								"--leave-delay": `${cellsOutStart}ms`,
								"--leave-duration": `${cellsOutEnd - cellsOutStart}ms`,
							} as CSSProperties
						}
						x={horizontalPosition(cell.x0)}
						y={verticalPosition(cell.y1)}
						width={horizontalPosition(cell.x1) - horizontalPosition(cell.x0)}
						height={verticalPosition(cell.y0) - verticalPosition(cell.y1)}
					/>
				))}
				{/* Legend leaders: one metro line per model into its colour dot in
				    the model list on the right, behind every line and point. */}
				{validSeries.map((model) => {
					const route = legendRoutes.get(model.id);
					return route ? (
						// A new chart, scale or frontier redraws the leaders rather
						// than reshaping them.
						<path
							key={leaderKey(model)}
							className="trends-legend-leader"
							pathLength={1}
							data-leaving={leavingLeaders.has(model.id)}
							data-emphasis={emphasisFor(model)}
							data-dimmed={
								frontierMode &&
								!model.points.some((point) => frontierIds.has(point.id))
							}
							style={
								{
									"--series": model.color,
									"--draw-delay": `${leaderDelay(model)}ms`,
								} as CSSProperties
							}
							d={route}
						/>
					) : null;
				})}
				{/* On-plot model names, replaced by the legend leaders above.
// Model-label leaders sit behind every line and point.
				// A Pareto name gathers one line from each of its frontier dots.
				{validSeries.flatMap((model) => {
					const end = tagged.get(model.id)?.path.at(-1);
					if (!end) return [];
					return frontier
						.filter((point) => lookup.get(point.id)?.model.id === model.id)
						.map((point) => (
							<path
								key={`tag-leader-${point.id}`}
								className="trends-column-leader"
								style={
									model.color
										? ({ "--series": model.color } as CSSProperties)
										: undefined
								}
								d={`M${horizontalPosition(point.horizontal)},${verticalPosition(point.vertical)} L${end[0]},${end[1]}`}
							/>
						));
				})}
				{validSeries.map((model) => {
					const name = named.get(model.id);
					return name?.leader ? (
						<path
							key={`leader-${model.id}`}
							className="trends-column-leader"
							data-emphasis={emphasisFor(model)}
							data-dimmed={
								frontierMode &&
								!model.points.some((point) => frontierIds.has(point.id))
							}
							style={
								model.color
									? ({ "--series": model.color } as CSSProperties)
									: undefined
							}
							d={name.path
								.map(([x, y], index) => `${index ? "L" : "M"}${x},${y}`)
								.join(" ")}
						/>
					) : null;
				})}
*/}
				<g className="trends-lines-reveal">
					{validSeries.flatMap((model, seriesIndex) => {
						// Each line is drawn as steps from dot to dot. At the entrance
						// they draw in order once every dot is in; later only new
						// steps draw, and only gone ones retract.
						const steps = lineSteps(model);
						const keys = steps.map(({ from, to }) => stepKey(model, from, to));
						const gone = keys.filter((key) => leavingSteps.has(key));
						return steps.map(({ from, to }, index) => {
							const key = keys[index] ?? "";
							const delay = stepTiming.get(key) ?? 0;
							return (
								<path
									key={key}
									className="trends-connected-line"
									data-leaving={leavingSteps.has(key)}
									// The frontier is one line of its own; model lines step back.
									data-emphasis={frontierMode ? "faded" : emphasisFor(model)}
									data-colored={model.color !== undefined}
									pathLength={1}
									style={
										{
											"--series": model.color,
											"--draw-delay": `${delay}ms`,
											"--draw-duration": `${DRAW_STEP_MS}ms`,
											...retractTiming(gone, key, exit.linesAt, exit.together),
										} as CSSProperties
									}
									d={pathThrough(
										[from, to],
										horizontalPosition,
										verticalPosition,
									)}
								/>
							);
						});
					})}
					{/* The frontier keeps each model's color; a step between two models
					    blends from one color to the next. */}
					{frontier.slice(1).map((point, index) => {
						const from = frontier[index] ?? point;
						const fromColor =
							lookup.get(from.id)?.model.color ?? "var(--color-ink-strong)";
						const toColor =
							lookup.get(point.id)?.model.color ?? "var(--color-ink-strong)";
						const x1 = horizontalPosition(from.horizontal);
						const y1 = verticalPosition(from.vertical);
						const x2 = horizontalPosition(point.horizontal);
						const y2 = verticalPosition(point.vertical);
						const stepId = frontierKey(from, point);
						// The gradient's id must be a plain reference: no chart name.
						const blendId = `${panelId}-blend-${from.id}-${point.id}`;
						// The frontier runs left to right, so a left-to-right blend
						// across the segment's own box follows the segment and keeps
						// up while it glides. A box with no width or height cannot
						// carry such a gradient, so those fall back to fixed ends.
						const boxed = Math.abs(x2 - x1) >= 1 && Math.abs(y2 - y1) >= 1;
						return (
							<g key={stepId}>
								{fromColor !== toColor ? (
									<defs>
										<linearGradient
											id={blendId}
											{...(boxed
												? { x1: 0, y1: 0, x2: 1, y2: 0 }
												: { gradientUnits: "userSpaceOnUse", x1, y1, x2, y2 })}
										>
											{/* Inline style, not attributes: model colors are
											    light-dark() pairs, which only CSS resolves. */}
											<stop offset="0" style={{ stopColor: fromColor }} />
											<stop offset="1" style={{ stopColor: toColor }} />
										</linearGradient>
									</defs>
								) : null}
								<path
									className="trends-frontier-path"
									pathLength={1}
									// A step between two of the focused models' points stays
									// lit while the rest of the line steps back.
									data-focused={
										focusIds.has(lookup.get(from.id)?.model.id ?? "") &&
										focusIds.has(lookup.get(point.id)?.model.id ?? "")
									}
									data-leaving={!stillOnFrontier.has(`${from.id}-${point.id}`)}
									style={
										{
											...retractTiming(
												goneFrontier,
												stepId,
												exit.linesAt,
												exit.together,
											),
											"--draw-delay": `${stepTiming.get(stepId) ?? 0}ms`,
											"--draw-duration": `${DRAW_STEP_MS}ms`,
											stroke:
												fromColor === toColor ? fromColor : `url(#${blendId})`,
										} as CSSProperties
									}
									d={`M${x1},${y1} L${x2},${y2}`}
								/>
							</g>
						);
					})}
				</g>
				{/* An opaque disc under every dot, above all lines and outside the
				    fading, so a dot always covers its line. It pops in with it. */}
				<g className="trends-point-backings">
					{validSeries.flatMap((model, seriesIndex) =>
						model.points.map((point, pointIndex) => (
							<circle
								key={point.id}
								className="trends-mark-group"
								data-leaving={leavingPoints.has(point.id)}
								// Its own flag: the backing stays opaque under a dimmed dot
								// and only goes with it under "Frontier only".
								data-off-frontier={frontierMode && !frontierIds.has(point.id)}
								style={
									{
										"--i": popOrder(seriesIndex, pointIndex),
										"--leave-delay": `${exit.dotsAt}ms`,
									} as CSSProperties
								}
								cx={horizontalPosition(point.horizontal)}
								cy={verticalPosition(point.vertical)}
								r={(MARK_RADII[point.effortIndex] ?? 4) + 0.75}
							/>
						)),
					)}
				</g>
				{/* Comparing points: a dashed line from the first to the latest. On
				    the log chart its angle is the steepness the panel names. */}
				{trade && comparedFirst && comparedLast && compared.length > 1 ? (
					<line
						className="trends-compare-link"
						data-tone={compareTone}
						x1={horizontalPosition(comparedFirst.point.horizontal)}
						y1={verticalPosition(comparedFirst.point.vertical)}
						x2={horizontalPosition(comparedLast.point.horizontal)}
						y2={verticalPosition(comparedLast.point.vertical)}
					/>
				) : null}
				{compared.map(({ model, point }) => {
					const cx = horizontalPosition(point.horizontal);
					const cy = verticalPosition(point.vertical);
					const isPreview = preview?.point.id === point.id;
					const chipWidth = (text: string) => text.length * 6.4 + 12;
					const horizontalText = formatHorizontal(point.horizontal);
					const verticalText = formatVertical(point.vertical);
					return (
						<g
							key={`crosshair-${point.id}`}
							className="trends-crosshair-pin"
							data-preview={isPreview}
							style={
								{
									"--series": model.color ?? "var(--color-ink-strong)",
								} as CSSProperties
							}
							pointerEvents="none"
						>
							<line x1={cx} x2={cx} y1={top} y2={bottom} />
							<line x1={left} x2={right} y1={cy} y2={cy} />
							<rect
								className="trends-axis-chip"
								x={cx - chipWidth(horizontalText) / 2}
								y={bottom + 6}
								width={chipWidth(horizontalText)}
								height={18}
								rx={5}
							/>
							{/* Centred in its chip both ways, so an off width estimate
							    splits evenly to either side. */}
							<text
								className="trends-axis-chip-text"
								x={cx}
								y={bottom + 15}
								textAnchor="middle"
								dominantBaseline="central"
							>
								{horizontalText}
							</text>
							<rect
								className="trends-axis-chip"
								x={left - chipWidth(verticalText) - 4}
								y={cy - 9}
								width={chipWidth(verticalText)}
								height={18}
								rx={5}
							/>
							<text
								className="trends-axis-chip-text"
								x={left - 4 - chipWidth(verticalText) / 2}
								y={cy}
								textAnchor="middle"
								dominantBaseline="central"
							>
								{verticalText}
							</text>
						</g>
					);
				})}
				{validSeries.map((model, seriesIndex) => {
					const emphasis = emphasisFor(model);
					const label = placed.get(model.id);
					// On-plot model names, replaced by the legend leaders:
					// const name = named.get(model.id);
					// const namedDimmed =
					// 	frontierMode &&
					// 	!model.points.some((point) => frontierIds.has(point.id));
					const showEfforts =
						model.points.length > 1 &&
						// Effort letters show with Effort labels or a focused model,
						// never just on hover.
						((effortLabels && (validSeries.length <= 12 || label)) ||
							focusIds.has(model.id));
					return (
						<g
							key={model.id}
							className="trends-series"
							data-emphasis={emphasis}
							data-colored={model.color !== undefined}
							style={
								model.color
									? ({ "--series": model.color } as CSSProperties)
									: undefined
							}
							onPointerEnter={() => {
								if (frontier.length === 0) setHoverId(model.id);
							}}
							onPointerLeave={() => setHoverId(null)}
						>
							{model.points.map((point, pointIndex) => {
								const cx = horizontalPosition(point.horizontal);
								const cy = verticalPosition(point.vertical);
								const radius = MARK_RADII[point.effortIndex] ?? 4;
								const isPinned = pinnedIds.includes(point.id);
								return (
									<g
										key={point.id}
										className="trends-mark-group"
										data-leaving={leavingPoints.has(point.id)}
										data-dimmed={frontierMode && !frontierIds.has(point.id)}
										data-pinned={isPinned}
										data-compared={comparedIds.has(point.id)}
										style={
											{
												"--i": popOrder(seriesIndex, pointIndex),
												"--leave-delay": `${exit.dotsAt}ms`,
												"--effort-alpha":
													0.62 +
													(0.38 * point.effortIndex) / (MARK_RADII.length - 1),
											} as CSSProperties
										}
									>
										{isPinned ? (
											<circle
												className="trends-pin-ring"
												cx={cx}
												cy={cy}
												r={radius + 4}
											/>
										) : null}
										<circle
											className="trends-point"
											cx={cx}
											cy={cy}
											r={radius}
										/>
										{showEfforts ? (
											<text
												className="trends-effort-label"
												x={cx}
												y={cy - radius - 5}
												textAnchor="middle"
											>
												{EFFORT_LABELS[point.effort as TrendsReasoningEffort] ??
													point.effort}
											</text>
										) : null}
										{/* With the frontier shown, only frontier points can be hovered or pinned. */}
										{frontier.length === 0 || frontierIds.has(point.id) ? (
											<>
												{/* biome-ignore lint/a11y/useSemanticElements: SVG has no button element; a focusable circle keeps the hit target inside the plot. */}
												<circle
													className="trends-hit"
													cx={cx}
													cy={cy}
													r={13}
													role="button"
													tabIndex={0}
													aria-label={`${model.name}, ${point.effort}. ${point.rows.map((row) => `${row.label}: ${row.value}`).join(". ")}`}
													aria-pressed={isPinned}
													aria-controls={panelId}
													onPointerEnter={() => setPreviewId(point.id)}
													onPointerLeave={() => setPreviewId(null)}
													onFocus={() => setPreviewId(point.id)}
													onBlur={() => setPreviewId(null)}
													onClick={() => togglePin(point.id)}
													onKeyDown={(
														event: KeyboardEvent<SVGCircleElement>,
													) => {
														if (event.key === "Enter" || event.key === " ") {
															event.preventDefault();
															togglePin(point.id);
														}
														if (event.key === "Escape") setPinnedIds([]);
													}}
												/>
											</>
										) : null}
									</g>
								);
							})}
							{/* On-plot model name, replaced by the legend leaders.
{name ? (
								<g
									className="trends-column-label"
									data-dimmed={namedDimmed}
									style={{
										transform: `translate(${name.left}px, ${name.cy}px)`,
									}}
								>
									<NameTag model={model} />
								</g>
							) : null}
*/}
							{label ? (
								<g className="trends-direct">
									{label.leader ? (
										<line
											className="trends-label-leader"
											x1={label.fromX}
											y1={label.fromY}
											x2={label.anchor === "end" ? label.x + 4 : label.x - 4}
											y2={label.y - 4}
										/>
									) : null}
									{label.anchor === "end" ? (
										<>
											<text
												className="trends-direct-label"
												x={label.x - 16}
												y={label.y}
												textAnchor="end"
											>
												{shortModelName(model.name)}
											</text>
											<SvgProviderMark
												provider={model.provider}
												x={label.x - 12}
												y={label.y - 10}
												size={12}
											/>
										</>
									) : (
										<>
											<SvgProviderMark
												provider={model.provider}
												x={
													label.anchor === "middle"
														? label.x - label.width / 2
														: label.x
												}
												y={label.y - 10}
												size={12}
											/>
											<text
												className="trends-direct-label"
												x={
													(label.anchor === "middle"
														? label.x - label.width / 2
														: label.x) + 16
												}
												y={label.y}
												textAnchor="start"
											>
												{shortModelName(model.name)}
											</text>
										</>
									)}
								</g>
							) : null}
						</g>
					);
				})}
				{/* Pareto frontier names, replaced by the legend leaders.
{validSeries.map((model) => {
					const tag = tagged.get(model.id);
					return tag ? (
						<g
							key={`tag-${model.id}`}
							className="trends-column-label"
							style={{ transform: `translate(${tag.left}px, ${tag.cy}px)` }}
						>
							<NameTag model={model} />
						</g>
					) : null;
				})}
*/}
			</svg>
			<ComparePanel
				id={panelId}
				entries={[
					...pinned.map((entry) => ({ ...entry, pinned: true })),
					...(preview ? [{ ...preview, pinned: false }] : []),
				]}
				trade={trade}
				formatHorizontal={formatHorizontal}
				scale={tradeScale}
				steepness={log}
				// Tucked inside the plot's bottom-right corner, clear of the
				// leaders beside it and the axis below it.
				corner={{ right: width - right + 8, bottom: height - bottom + 8 }}
			/>
		</div>
	);
}

/** Points compared at once: the first and one set against it. */
const MAX_PINNED = 2;

/**
 * Insight mode. Quadrants: four, split at the visual middle of each axis
 * (the geometric midpoint on a log axis), each named in its outer corner.
 * Rows or columns: three equal bands across one axis, named from its best
 * end ("Smartest", "Cheapest") through "Middle" to its worst, so the top
 * band really holds the smartest.
 */
function GuideQuadrants({
	guide,
	layout,
	active,
	box,
	splitX,
	splitY,
}: {
	readonly guide: TradeoffGuide;
	readonly layout: GuideLayout;
	/** The layout shown now; the others stay drawn, faded out. */
	readonly active: boolean;
	readonly box: { left: number; top: number; right: number; bottom: number };
	readonly splitX: number;
	readonly splitY: number;
}) {
	const inset = 12;
	const washId = useId();
	if (layout !== "quadrants") {
		const rows = layout === "rows";
		const [best, worst] = rows ? guide.ranks.vertical : guide.ranks.horizontal;
		// Bands run top to bottom (rows) or left to right (columns); the best
		// end is on top unless lower is better on the vertical axis, and is
		// always on the left.
		const bestFirst = rows ? guide.better === "top-left" : true;
		const names = bestFirst ? [best, "Middle", worst] : [worst, "Middle", best];
		const tones = bestFirst
			? ["better", "mixed", "worse"]
			: ["worse", "mixed", "better"];
		const span = rows ? box.bottom - box.top : box.right - box.left;
		const start = rows ? box.top : box.left;
		const edges = [1, 2].map((step) => start + (span * step) / 3);
		// A faint mint from the good end and a faint rose from the bad end,
		// each gone before the middle band, running the way the bands do.
		const wash = [
			{ at: 0, color: "var(--trends-wash-good)", alpha: 1 },
			{ at: 0.4, color: "var(--trends-wash-good)", alpha: 0 },
			{ at: 0.6, color: "var(--trends-wash-bad)", alpha: 0 },
			{ at: 1, color: "var(--trends-wash-bad)", alpha: 1 },
		];
		const towards = bestFirst ? 1 : 0;
		return (
			<g className="trends-guide" data-active={active} pointerEvents="none">
				<defs>
					<linearGradient
						id={washId}
						x1={rows ? 0 : 1 - towards}
						y1={rows ? 1 - towards : 0}
						x2={rows ? 0 : towards}
						y2={rows ? towards : 0}
					>
						{wash.map((stop) => (
							<stop
								key={stop.at}
								offset={stop.at}
								style={{
									stopColor: stop.color,
									stopOpacity: stop.alpha,
								}}
							/>
						))}
					</linearGradient>
				</defs>
				<rect
					className="trends-guide-wash"
					x={box.left}
					y={box.top}
					width={box.right - box.left}
					height={box.bottom - box.top}
					fill={`url(#${washId})`}
				/>
				{edges.map((edge) =>
					rows ? (
						<line
							key={edge}
							className="trends-guide-split"
							x1={box.left}
							x2={box.right}
							y1={edge}
							y2={edge}
						/>
					) : (
						<line
							key={edge}
							className="trends-guide-split"
							x1={edge}
							x2={edge}
							y1={box.top}
							y2={box.bottom}
						/>
					),
				)}
				{names.map((name, index) => {
					const bandStart = start + (span * index) / 3;
					return (
						<text
							key={name}
							className="trends-guide-label"
							data-tone={tones[index]}
							x={
								rows
									? box.left + inset
									: index === 0
										? box.left + inset
										: index === 1
											? bandStart + span / 6
											: box.right - inset
							}
							y={rows ? bandStart + inset + 8 : box.top + inset + 8}
							textAnchor={
								rows || index === 0 ? "start" : index === 1 ? "middle" : "end"
							}
						>
							{name}
						</text>
					);
				})}
			</g>
		);
	}
	const x = Math.min(Math.max(splitX, box.left), box.right);
	const y = Math.min(Math.max(splitY, box.top), box.bottom);
	const betterTop = guide.better === "top-left";
	const [verticalBetter, verticalWorse] = guide.vertical;
	const [horizontalBetter, horizontalWorse] = guide.horizontal;
	const quadrants = [
		{ left: true, top: true },
		{ left: false, top: true },
		{ left: true, top: false },
		{ left: false, top: false },
	].map((quadrant) => {
		const verticalGood = quadrant.top === betterTop;
		const horizontalGood = quadrant.left;
		return {
			...quadrant,
			tone:
				verticalGood && horizontalGood
					? "better"
					: !verticalGood && !horizontalGood
						? "worse"
						: "mixed",
			label: `${verticalGood ? verticalBetter : verticalWorse} & ${horizontalGood ? horizontalBetter : horizontalWorse}`,
		};
	});
	return (
		<g className="trends-guide" data-active={active} pointerEvents="none">
			<line
				className="trends-guide-split"
				x1={x}
				x2={x}
				y1={box.top}
				y2={box.bottom}
			/>
			<line
				className="trends-guide-split"
				x1={box.left}
				x2={box.right}
				y1={y}
				y2={y}
			/>
			{quadrants.map((quadrant) => (
				<text
					key={`label-${quadrant.left}-${quadrant.top}`}
					className="trends-guide-label"
					data-tone={quadrant.tone}
					x={quadrant.left ? box.left + inset : box.right - inset}
					y={quadrant.top ? box.top + inset + 8 : box.bottom - inset}
					textAnchor={quadrant.left ? "start" : "end"}
				>
					{quadrant.label}
				</text>
			))}
		</g>
	);
}

interface CompareEntry {
	readonly model: TradeoffSeries;
	readonly point: TradeoffPoint;
	readonly pinned: boolean;
}

/**
 * Pinned points side by side, docked bottom right of the plot so it never
 * covers the point being read. The hovered or focused point joins as a
 * provisional column until it is pinned; clicking a pinned point again (or
 * Escape) lets it go. On a score-against-price chart (`trade`), every later
 * point carries its difference from the first one in its own cells, and one
 * sentence sets the latest point against the first in words. When nothing
 * is compared it keeps its last content while it fades shut, so it closes
 * cleanly instead of emptying first.
 */
function ComparePanel({
	id,
	entries: current,
	trade,
	formatHorizontal,
	scale,
	steepness,
	corner,
	summary,
}: {
	readonly id: string;
	readonly entries: readonly CompareEntry[];
	readonly trade?: string;
	/** A chart's own sentence for the latest point against the first, in
	 * place of the score-against-price one (the bar charts lead with their
	 * measure). */
	readonly summary?: (first: CompareEntry, latest: CompareEntry) => ReactNode;
	readonly formatHorizontal: (value: number) => string;
	readonly scale: TradeScale;
	/** Name the steepness (log chart only) or give just the facts. */
	readonly steepness: boolean;
	/** Insets from the container's edges, in pixels: the corner it docks in
	 * (and grows and shuts toward). */
	readonly corner: {
		readonly right?: number;
		readonly bottom?: number;
		readonly left?: number;
		readonly top?: number;
	};
}) {
	const lastShown = useRef(current);
	const open = current.length > 0;
	if (open) lastShown.current = current;
	const entries = open ? current : lastShown.current;
	const labels = [
		...new Set(
			entries.flatMap((entry) => entry.point.rows.map((row) => row.label)),
		),
	];
	const baseline =
		trade !== undefined && entries.length > 1 ? entries[0]?.point : undefined;
	const difference = (point: TradeoffPoint, axis: TooltipRow["axis"]) => {
		if (!baseline || point.id === baseline.id) return undefined;
		// A score one side lacks has no difference to show.
		if (axis === "vertical") {
			const points = point.vertical - baseline.vertical;
			return Number.isFinite(points) ? formatPoints(points) : undefined;
		}
		if (axis === "horizontal") {
			const ratio = point.horizontal / baseline.horizontal;
			return Number.isFinite(ratio) && ratio > 0
				? formatChange(ratio)
				: undefined;
		}
		return undefined;
	};
	// The latest point against the first, in words.
	const first = baseline ? entries[0] : undefined;
	const latest = baseline ? entries.at(-1) : undefined;
	return (
		<section
			id={id}
			className="trends-compare"
			aria-label="Compared points"
			aria-live="polite"
			aria-hidden={!open}
			data-empty={entries.length === 0}
			data-open={open}
			style={{
				...corner,
				transformOrigin: `${corner.top === undefined ? "bottom" : "top"} ${corner.left === undefined ? "right" : "left"}`,
				// Never past the plot's far edge (the axis labels sit there).
				maxWidth: `min(760px, calc(100% - ${(corner.right ?? corner.left ?? 0) + 56}px))`,
			}}
		>
			{entries.length === 0 ? null : (
				<table>
					<thead>
						<tr>
							<td />
							{entries.map(({ model, point, pinned }) => (
								<th
									key={point.id}
									scope="col"
									data-pinned={pinned}
									style={
										{
											"--series": model.color ?? "var(--color-ink-strong)",
										} as CSSProperties
									}
								>
									<span className="trends-compare-dot" aria-hidden="true" />
									<ProviderMark provider={model.provider} />
									{shortModelName(model.name)}
									{point.subtitle ? (
										<span className="trends-compare-subtitle">
											{point.subtitle}
										</span>
									) : null}
									{point.estimated ? (
										<abbr
											className="trends-compare-estimated"
											title="Estimated by Artificial Analysis"
										>
											est.
										</abbr>
									) : null}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{labels.map((label) => (
							<tr key={label}>
								<th scope="row">{label}</th>
								{entries.map(({ point }) => {
									const row = point.rows.find((entry) => entry.label === label);
									const change = row ? difference(point, row.axis) : undefined;
									return (
										<td key={point.id}>
											{row?.value ?? "–"}
											{change ? (
												<span className="trends-compare-delta">{change}</span>
											) : null}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			)}
			{first && latest && trade ? (
				// The sentence sits on its own raised card, inset evenly from the
				// panel's sides and bottom.
				<div className="trends-compare-card">
					{summary ? (
						<p className="trends-compare-summary">
							<span>{summary(first, latest)}</span>
						</p>
					) : (
						<CompareSummary
							first={first}
							latest={latest}
							noun={trade}
							formatHorizontal={formatHorizontal}
							scale={scale}
							steepness={steepness}
						/>
					)}
				</div>
			) : null}
		</section>
	);
}

/** A change as people read it at once: "+10%", "−46%", "+0.4%", or "7.4×"
 * once it is more than double. */
function formatChange(ratio: number) {
	if (ratio > 2) return `${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}×`;
	return formatPercent(ratio);
}

function formatPercent(ratio: number) {
	const percent = (ratio - 1) * 100;
	const size = Math.abs(percent);
	if (size < 0.05) return "±0%";
	return `${percent >= 0 ? "+" : "−"}${size < 1 ? size.toFixed(1) : Math.round(size)}%`;
}

/** An Intelligence index difference in the chart's own unit: "+3.8". */
function formatPoints(difference: number) {
	if (Math.abs(difference) < 0.05) return "±0";
	return `${difference >= 0 ? "+" : "−"}${Math.abs(difference).toFixed(1)}`;
}

/**
 * The latest point against the first in one line: the line's steepness as
 * a headline, then the facts. "Gentle climb: Raising Opus 5.5 from xhigh to
 * max makes it slightly smarter and almost doubles the cost (+$2.52)." A
 * small compass points the way the move goes on the chart.
 */
function CompareSummary({
	first,
	latest,
	noun,
	formatHorizontal,
	scale,
	steepness,
}: {
	readonly first: CompareEntry;
	readonly latest: CompareEntry;
	readonly noun: string;
	readonly formatHorizontal: (value: number) => string;
	readonly scale: TradeScale;
	readonly steepness: boolean;
}) {
	// On Linear the angle measures points per dollar, which mostly says how
	// expensive the models already are; there the panel gives just the facts.
	if (!steepness)
		return (
			<p className="trends-compare-summary">
				<span>
					{tradeSentence(first, latest, noun, formatHorizontal, undefined)}
				</span>
			</p>
		);
	const verdict = verdictFor(first.point, latest.point, scale);
	// The compass points the way the move goes on the chart, at the chart's
	// own angle: right for a higher price, up for a higher score.
	const across =
		Math.log2(latest.point.horizontal / first.point.horizontal) /
		scale.doublings;
	const up = (latest.point.vertical - first.point.vertical) / scale.points;
	const radians = across === 0 && up === 0 ? 0 : Math.atan2(up, across);
	const tip = { x: 5 * Math.cos(radians), y: -5 * Math.sin(radians) };
	const wing = (turn: number) => ({
		x: tip.x - 3 * Math.cos(radians + turn),
		y: tip.y + 3 * Math.sin(radians + turn),
	});
	const left = wing(0.5);
	const right = wing(-0.5);
	return (
		<p className="trends-compare-summary" data-tone={verdict.tone}>
			<svg
				className="trends-compare-slope"
				viewBox="-9 -9 18 18"
				width={18}
				height={18}
				aria-hidden="true"
			>
				<circle r={8} />
				<line x1={-tip.x} y1={-tip.y} x2={tip.x} y2={tip.y} />
				<path
					className="trends-compare-arrowhead"
					d={`M${left.x},${left.y} L${tip.x},${tip.y} L${right.x},${right.y} Z`}
				/>
			</svg>
			<span>
				<strong className="trends-compare-verdict">{verdict.name}:</strong>{" "}
				{tradeSentence(first, latest, noun, formatHorizontal, verdict.framing)}
			</span>
		</p>
	);
}

/**
 * The facts in plain words, the latest point first. A change of reasoning
 * on one model reads as a dial: "Raising Opus 5.5 from xhigh to max makes
 * it slightly smarter and almost doubles the cost". Two models read as a
 * switch: "6.1 Sol max is noticeably less capable than Opus 5.5 xhigh, for
 * about a fifth of the cost". The linking words follow the verdict, so the
 * facts tell its story: "only … but costs 2.5× as much" when the gain is
 * pricey, "for just 2% more" when it is a bargain. Sizes are words (see
 * `smartWords`) and pictures (see `pricePhrase`); only the absolute price
 * difference stays a number. Color marks facts: a higher score and a lower
 * price green, a lower score red, and a higher price red only when the
 * score is no higher.
 */
function tradeSentence(
	first: CompareEntry,
	latest: CompareEntry,
	noun: string,
	formatHorizontal: (value: number) => string,
	framing: Framing,
) {
	const points = latest.point.vertical - first.point.vertical;
	const extra = latest.point.horizontal - first.point.horizontal;
	const price = latest.point.horizontal / first.point.horizontal;
	const higher = points >= 0.5;
	const lower = points <= -0.5;
	const pricier = price >= 1.02;
	const cheaper = price <= 0.98;
	const sameModel = latest.model.id === first.model.id;
	const pricey = framing === "pricey" && pricier;
	const bargain = framing === "bargain" && pricier;
	const smart = (
		<span
			className="trends-compare-phrase"
			data-tone={higher ? "good" : lower ? "bad" : undefined}
		>
			{pricey && higher && points < 3 ? "only " : ""}
			{smartWords(points, !sameModel)}
		</span>
	);
	const cost = (
		<span
			className="trends-compare-phrase"
			data-tone={cheaper ? "good" : pricier && !higher ? "bad" : undefined}
		>
			{sameModel
				? priceVerb(price, noun)
				: pricey
					? priceAsMuch(price, noun)
					: pricier || cheaper
						? pricePhrase(price, noun)
						: `about the same ${noun}`}
		</span>
	);
	const amount =
		pricier || cheaper ? (
			<>
				{" "}
				<span className="trends-compare-amount">
					({extra >= 0 ? "+" : "−"}
					{formatHorizontal(Math.abs(extra))})
				</span>
			</>
		) : null;
	if (sameModel)
		return (
			<>
				{latest.point.effortIndex >= first.point.effortIndex
					? "Raising"
					: "Lowering"}{" "}
				<ModelName entry={latest} reasoning={false} /> from{" "}
				{first.point.subtitle ?? first.point.effort} to{" "}
				{latest.point.subtitle ?? latest.point.effort} makes it {smart}
				{pricey ? ", but " : bargain ? " and only " : " and "}
				{cost}
				{amount}.
			</>
		);
	return (
		<>
			<ModelName entry={latest} /> is {smart} <ModelName entry={first} />
			{pricey
				? lower
					? ", and still "
					: ", but "
				: bargain
					? ", for just "
					: pricier || cheaper
						? ", for "
						: ", at "}
			{cost}
			{amount}.
		</>
	);
}

/** How far apart two scores are, in words. Index points, the chart's own
 * unit, so a step reads as big as it looks: under 0.5 points is about the
 * same, then slightly (a reasoning level is usually 1 to 3 points),
 * noticeably (about a model generation), much, and far. */
function smartWords(points: number, comparing: boolean) {
	const size = Math.abs(points);
	if (size < 0.5) return comparing ? "about as smart as" : "about as smart";
	const degree =
		size < 3
			? "slightly"
			: size < 7
				? "noticeably"
				: size < 12
					? "much"
					: "far";
	const words = points > 0 ? `${degree} smarter` : `${degree} less capable`;
	return comparing ? `${words} than` : words;
}

/** A price change as what the dial does to it: "almost doubles the cost",
 * "raises the cost 5.5×", "cuts the time to about a third". */
function priceVerb(ratio: number, noun: string) {
	const size = Math.round(Math.abs(ratio - 1) * 100);
	if (Math.abs(ratio - 1) < 0.02) return `keeps the ${noun} about the same`;
	if (ratio > 2.1) return `raises the ${noun} ${formatChange(ratio)}`;
	if (ratio >= 1.9) return `doubles the ${noun}`;
	if (ratio >= 1.7) return `almost doubles the ${noun}`;
	if (ratio > 1) return `raises the ${noun} by ${size}%`;
	const picture = pricePhrase(ratio, noun);
	return picture.endsWith(`less ${noun}`)
		? `cuts the ${noun} by ${size}%`
		: `cuts the ${noun} to ${picture.replace(/ (of )?the \w+$/, "")}`;
}

/** A higher price as a clause after "but": "costs 2.5× as much", "takes
 * almost twice as long", "costs 30% more". */
function priceAsMuch(ratio: number, noun: string) {
	const time = noun === "time";
	const verb = time ? "takes" : "costs";
	const much = time ? "as long" : "as much";
	if (ratio > 2.1) return `${verb} ${formatChange(ratio)} ${much}`;
	if (ratio >= 1.9) return `${verb} twice ${much}`;
	if (ratio >= 1.7) return `${verb} almost twice ${much}`;
	return `${verb} ${Math.round((ratio - 1) * 100)}% ${time ? "longer" : "more"}`;
}

/** A chart's spans: doublings across its price axis (on the log scale)
 * and index points up its score axis. Steepness is measured in these, so
 * it is the angle of the line between two points as the chart draws it. */
interface TradeScale {
	readonly doublings: number;
	readonly points: number;
}

/** Steepness bands, as the line's angle on the chart (axes at equal
 * length). Calibrated on the data: steps along the frontier and one
 * reasoning level up sit around 28° to 50° (median about 40°) on both the
 * cost and the time chart. */
const STEEP_DEGREES = 50;
const STEADY_DEGREES = 32;
const GENTLE_DEGREES = 15;

type VerdictTone = "good" | "bad";

/** How the facts are told: "pricey" (only … but costs), "bargain" (for
 * just), or plainly. */
type Framing = "pricey" | "bargain" | undefined;

interface VerdictText {
	readonly name: string;
	/** Green when clearly good, red when clearly bad, ink otherwise. */
	readonly tone?: VerdictTone;
	readonly framing?: Framing;
}

/**
 * Just the steepness of the line between the two points, as the chart
 * draws it (see `TradeScale`): a climb when the latest point is smarter, a
 * drop when it is less smart, steep, steady, gentle or nearly flat. Color
 * marks only the plain cases: green for a steep climb, a nearly flat drop
 * (much saved, little lost) or smarter and cheaper at once; red for a
 * nearly flat climb, a steep drop or less smart and pricier at once.
 */
function verdictFor(
	from: TradeoffPoint,
	to: TradeoffPoint,
	scale: TradeScale,
): VerdictText {
	const points = to.vertical - from.vertical;
	const ratio = to.horizontal / from.horizontal;
	if (Math.abs(points) < 0.5 && Math.abs(ratio - 1) < 0.02)
		return { name: "No real difference" };
	const up = Math.abs(points) / scale.points;
	const across = Math.abs(Math.log2(ratio)) / scale.doublings;
	const degrees = (Math.atan2(up, across) * 180) / Math.PI;
	const climb = points > 0;
	const band =
		degrees >= STEEP_DEGREES
			? "steep"
			: degrees >= STEADY_DEGREES
				? "steady"
				: degrees >= GENTLE_DEGREES
					? "gentle"
					: "flat";
	const name =
		band === "flat"
			? "Nearly flat"
			: `${band[0]?.toUpperCase()}${band.slice(1)} ${climb ? "climb" : "drop"}`;
	// Smarter and cheaper, or less smart and pricier: plain either way.
	if (climb && ratio < 1) return { name, tone: "good" };
	if (!climb && ratio > 1) return { name, tone: "bad", framing: "pricey" };
	if (climb)
		return band === "steep"
			? { name, tone: "good", framing: "bargain" }
			: band === "flat"
				? { name, tone: "bad", framing: "pricey" }
				: { name };
	return band === "flat"
		? { name, tone: "good" }
		: band === "steep"
			? { name, tone: "bad" }
			: { name };
}

/** A model, with its reasoning unless left out, in the model's color and
 * led by its lab's mark. */
function ModelName({
	entry: { model, point },
	reasoning = true,
}: {
	readonly entry: CompareEntry;
	readonly reasoning?: boolean;
}) {
	return (
		<span
			className="trends-compare-model"
			style={
				{
					"--series": model.color ?? "var(--color-ink-strong)",
				} as CSSProperties
			}
		>
			<ProviderMark provider={model.provider} />
			{shortModelName(model.name)}
			{reasoning && point.subtitle ? ` ${point.subtitle}` : ""}
		</span>
	);
}

/** The price as something people picture: "5.5× the cost", "almost
 * double the cost", "about half the time", "a fifth of the cost". In-between
 * sizes keep a percentage: "30% more cost". */
function pricePhrase(ratio: number, noun: string) {
	const gain = (ratio - 1) * 100;
	const size = Math.round(Math.abs(gain));
	const twice = noun === "time" ? "twice" : "double";
	if (Math.abs(gain) < 0.5) return `the same ${noun}`;
	// Same multiple as the price cell above it.
	if (ratio > 2.1) return `${formatChange(ratio)} the ${noun}`;
	if (ratio >= 1.9) return `${twice} the ${noun}`;
	if (ratio >= 1.7) return `almost ${twice} the ${noun}`;
	if (ratio > 1) return `${size || "<1"}% more ${noun}`;
	// Near a fraction people picture, "about" it; just under one, "less than"
	// it; past the smallest, one over how many times.
	for (const [index, [part, name]] of FRACTIONS.entries()) {
		if (Math.abs(ratio - part) <= part * 0.12)
			return `about ${name} the ${noun}`;
		const next = FRACTIONS[index + 1]?.[0];
		if (next !== undefined && ratio < part && ratio > next * 1.12)
			return `less than ${name} the ${noun}`;
	}
	if (ratio < 0.2) return `1/${Math.round(1 / ratio)} of the ${noun}`;
	return `${size}% less ${noun}`;
}

/** Fractions people picture at once, for a price that falls. */
const FRACTIONS = [
	[0.5, "half"],
	[1 / 3, "a third of"],
	[0.25, "a quarter of"],
	[0.2, "a fifth of"],
] as const;

export function directLabelSeries(
	series: readonly TradeoffSeries[],
	limit: number,
	focusIds: ReadonlySet<string>,
	hoverId: string | null,
): readonly TradeoffSeries[] {
	const ranked = [...series].sort(
		(first, second) =>
			Math.max(...second.points.map((point) => point.vertical)) -
				Math.max(...first.points.map((point) => point.vertical)) ||
			first.id.localeCompare(second.id),
	);
	const ids = new Set([
		...ranked.slice(0, limit).map((model) => model.id),
		...focusIds,
		hoverId,
	]);
	return ranked
		.filter((model) => ids.has(model.id))
		.sort(
			(first, second) =>
				Number(focusIds.has(second.id)) - Number(focusIds.has(first.id)) ||
				Number(second.id === hoverId) - Number(first.id === hoverId),
		);
}

export function BenchmarkBars({
	section,
	models,
	efforts,
	tickRoom = 0,
	arrangement = "grouped",
	focusIds,
	colors,
	onCompare,
	onInspect,
	rows,
	spreads,
	axisTitle,
	logTicks,
	listBeside = true,
}: BenchmarkBarsProps) {
	const corridor = listBeside ? METRO_CORRIDOR : ALONE_CORRIDOR;
	const containerRef = useRef<HTMLDivElement>(null);
	const { width } = usePlotSize(containerRef);
	// Given rows carry one figure a model and no reasoning efforts.
	const perEffort = rows === undefined;
	const observations =
		rows ??
		(section.metric
			? benchmarkObservations(models, section.metric, efforts)
			: []);
	const ranking = arrangement === "ranked";
	const groups = ranking
		? // A ranking: each observation its own one-column group.
			[...observations]
				.sort((first, second) => first.value - second.value)
				.map((row) => ({
					id: `${row.model.id}-${row.point.effort}`,
					rows: [row],
					min: row.value,
					max: row.value,
				}))
		: benchmarkGroups(observations);
	// Up to MAX_SHOWN models. Crowded, the groups close up and long names end
	// in an ellipsis; past the slimmest groups that still read (phones), the
	// columns scroll sideways under a fixed axis.
	const plotWidth = width - (listBeside ? plotLeft(width) : 0) - corridor;
	const dense = !ranking && groups.length > 0 && plotWidth / groups.length < 96;
	const scrolls =
		groups.length * (ranking ? RANKED_COLUMN_PITCH : DENSE_GROUP_PITCH) >
		plotWidth;
	const leaderGroup = [...groups].sort(
		(first, second) => second.max - first.max,
	)[0]?.id;
	const highest = Math.max(
		...observations.map((observation) => observation.value),
		...[...(spreads?.values() ?? [])].map((spread) => spread.p99 ?? spread.p90),
		0,
	);
	const maximum = niceMaximum(highest || 1);
	// On a log axis: from the tick at or below the lowest figure to the one
	// at or above the highest (past either end, the figure itself).
	const lowest = Math.min(
		...observations
			.map((observation) => observation.value)
			.filter((value) => value > 0),
	);
	const logRange = logTicks
		? {
				from: [...logTicks].reverse().find((tick) => tick <= lowest) ?? lowest,
				to: logTicks.find((tick) => tick >= highest) ?? highest,
			}
		: null;
	// Where a figure stands up the axis, as a share of its height.
	const fraction = (value: number) =>
		logRange
			? Math.max(
					0,
					(Math.log(Math.max(value, logRange.from)) - Math.log(logRange.from)) /
						(Math.log(logRange.to) - Math.log(logRange.from) || 1),
				)
			: value / maximum;
	const orderKey = `${section.id}:${groups.map((group) => group.id).join(",")}`;
	// Hovering a column draws a dashed rule across the plot at its top, its
	// figure in the list; a click pins the rule, and hovering another column
	// hatches the difference between them, the difference in the list. A
	// click on the pinned column, Escape or a click outside lets go.
	const rowId = (row: BenchmarkObservation) =>
		`${row.model.id}-${row.point.effort}`;
	const [pinnedId, setPinnedId] = useState<string | null>(null);
	const [previewId, setPreviewId] = useState<string | null>(null);
	const [pinnedSection, setPinnedSection] = useState(section.id);
	if (pinnedSection !== section.id) {
		setPinnedSection(section.id);
		setPinnedId(null);
		setPreviewId(null);
	}
	const rowsById = new Map(observations.map((row) => [rowId(row), row]));
	const pinned = pinnedId === null ? undefined : rowsById.get(pinnedId);
	const preview =
		previewId === null || previewId === pinnedId
			? undefined
			: rowsById.get(previewId);
	const comparing = pinned !== undefined;
	const comparedModels = [
		...new Set(
			[pinned, comparing ? preview : undefined].flatMap((row) =>
				row ? [row.model.id] : [],
			),
		),
	].join(",");
	const reportedCompared = useRef("");
	useEffect(() => {
		if (reportedCompared.current === comparedModels) return;
		reportedCompared.current = comparedModels;
		onCompare?.(new Set(comparedModels ? comparedModels.split(",") : []));
	});
	// The list's figures: the pinned column's, and the hovered one's
	// difference from it (on one row when both are one model's).
	const signed = (difference: number) =>
		`${difference >= 0 ? "+" : "\u2212"}${section.format(Math.abs(difference))}`;
	// With reasoning efforts, each figure is led by its column's effort
	// ("high → max" when both are one model's).
	const inspected = new Map<string, string>();
	const notes = new Map<string, string>();
	if (pinned) {
		inspected.set(pinned.model.id, section.format(pinned.value));
		if (perEffort) notes.set(pinned.model.id, pinned.point.effort);
	}
	if (preview) {
		const id = preview.model.id;
		inspected.set(
			id,
			pinned
				? signed(preview.value - pinned.value)
				: section.format(preview.value),
		);
		if (perEffort)
			notes.set(
				id,
				pinned?.model.id === id
					? `${pinned.point.effort} \u2192 ${preview.point.effort}`
					: preview.point.effort,
			);
	}
	const inspectedKey =
		inspected.size > 0
			? JSON.stringify({
					values: [...inspected],
					notes: [...notes],
					leaderId: (preview ?? pinned)?.model.id,
				})
			: "";
	useEffect(() => {
		if (!inspectedKey) {
			onInspect?.(undefined);
			return;
		}
		const { values, notes, leaderId } = JSON.parse(inspectedKey) as {
			values: [string, string][];
			notes: [string, string][];
			leaderId?: string;
		};
		onInspect?.({
			values: new Map(values),
			notes: new Map(notes),
			leaderId,
		});
	}, [inspectedKey, onInspect]);
	useEffect(() => () => onInspect?.(undefined), [onInspect]);
	useEffect(() => {
		if (!comparing) return;
		const outside = (event: PointerEvent) => {
			const target = event.target;
			if (
				target instanceof Element &&
				target.closest("[data-compare-target], .trends-panel-toolbar")
			)
				return;
			setPinnedId(null);
			setPreviewId(null);
		};
		document.addEventListener("pointerdown", outside);
		return () => document.removeEventListener("pointerdown", outside);
	}, [comparing]);
	if (groups.length === 0)
		return (
			<div ref={containerRef} className="trends-benchmark-bars">
				<p className="trends-empty">
					No observations for these models and reasoning efforts.
				</p>
			</div>
		);
	const gridValues = logRange
		? (logTicks ?? []).filter(
				(tick) => tick >= logRange.from && tick <= logRange.to,
			)
		: [0, 0.25, 0.5, 0.75, 1].map((share) => maximum * share);
	const leave = (id: string) =>
		setPreviewId((current) => (current === id ? null : current));
	const interactive = (row: BenchmarkObservation) => {
		const id = rowId(row);
		return {
			"aria-label": perEffort
				? `${row.model.name}, ${row.point.effort}: ${section.format(row.value)}`
				: `${row.model.name}: ${section.format(row.value)}`,
			"aria-pressed": pinnedId === id,
			"data-compare-target": true,
			onPointerEnter: () => setPreviewId(id),
			onPointerLeave: () => leave(id),
			onFocus: () => setPreviewId(id),
			onBlur: () => leave(id),
			onClick: () => setPinnedId((current) => (current === id ? null : id)),
			onKeyDown: (event: { readonly key: string }) => {
				if (event.key === "Escape") setPinnedId(null);
			},
		};
	};
	// The hatched difference over (or above) the hovered column, from its
	// top to the pinned rule, in shares of the column's own height.
	const delta = (row: BenchmarkObservation) => {
		if (!pinned || !preview || rowId(row) !== rowId(preview)) return null;
		const own = fraction(row.value);
		const reference = fraction(pinned.value);
		if (own <= 0 || Math.abs(own - reference) < 1e-6) return null;
		const low = Math.min(own, reference);
		const high = Math.max(own, reference);
		return (
			<span
				className="trends-column-delta"
				data-over={reference < own}
				aria-hidden="true"
				style={{
					bottom: `${(low / own) * 100}%`,
					height: `${((high - low) / own) * 100}%`,
				}}
			/>
		);
	};
	const rule = (row: BenchmarkObservation | undefined, kind: string) =>
		row ? (
			<div
				className="trends-columns-rule"
				data-kind={kind}
				style={
					{
						"--at": `${fraction(row.value) * 100}%`,
						...seriesStyle(row.model.id),
					} as CSSProperties
				}
			/>
		) : null;
	const colored = colors !== undefined;
	const seriesStyle = (modelId: string): Record<string, string> => {
		const color = colors?.get(modelId);
		return color ? { "--series": color } : {};
	};

	return (
		<div
			ref={containerRef}
			className="trends-benchmark-bars trends-columns"
			data-colored={colored}
			data-dense={dense}
			data-scrolls={scrolls}
			data-ranking={ranking}
			style={
				{
					"--plot-left": `${listBeside ? plotLeft(width) : 0}px`,
					"--plot-corridor": `${corridor}px`,
					"--tick-room": `${tickRoom}px`,
				} as CSSProperties
			}
		>
			<div className="trends-columns-plot">
				<div className="trends-columns-grid" aria-hidden="true">
					{gridValues.map((value) => (
						<div
							key={value}
							style={{ "--at": `${fraction(value) * 100}%` } as CSSProperties}
						>
							<span>{section.format(value)}</span>
						</div>
					))}
				</div>
				<div className="trends-column-groups">
					{groups.map((group, groupIndex) => {
						const model = group.rows[0]?.model;
						if (!model) return null;
						const dimmed = focusIds.size > 0 && !focusIds.has(model.id);
						const focused = focusIds.has(model.id);
						return (
							<motion.div
								key={group.id}
								layout="position"
								layoutDependency={orderKey}
								transition={TRENDS_SPRING}
								className="trends-column-group"
								data-dimmed={dimmed}
								data-focused={focused}
								style={
									{
										"--i": groupIndex,
										...seriesStyle(model.id),
									} as CSSProperties
								}
							>
								<div className="trends-column-bars">
									{group.rows.map((row, index) => {
										const isMax = row.value === group.max;
										return (
											<button
												key={row.point.effort}
												type="button"
												className="trends-column"
												data-leader={group.id === leaderGroup && isMax}
												data-effort={row.point.effort}
												style={
													{
														"--size": `${fraction(row.value) * 100}%`,
														"--j": index,
														// Lighter for less effort; one figure a model
														// takes the strongest shade.
														"--tone": perEffort
															? 0.3 +
																(REASONING_EFFORTS.indexOf(row.point.effort) /
																	(REASONING_EFFORTS.length - 1)) *
																	0.6
															: 0.9,
													} as CSSProperties
												}
												{...interactive(row)}
											>
												{/* Ranked, only the top bar carries its value. */}
												{isMax && (!ranking || group.id === leaderGroup) ? (
													<span className="trends-column-value">
														<AnimatedValue
															value={row.value}
															format={section.format}
														/>
													</span>
												) : null}
												{focused && perEffort ? (
													<span className="trends-column-effort">
														{EFFORT_LABELS[row.point.effort]}
													</span>
												) : null}
												{delta(row)}
											</button>
										);
									})}
									{/* The run's spread past its median: a whisker up to
									    p99 with ticks at p90 and p99. */}
									{(() => {
										const spread = spreads?.get(model.id);
										if (!spread) return null;
										const at = (value: number) => `${fraction(value) * 100}%`;
										return (
											<span
												className="trends-column-spread"
												aria-hidden="true"
												style={
													{
														"--from": at(group.max),
														"--p90": at(spread.p90),
														"--to": at(spread.p99 ?? spread.p90),
													} as CSSProperties
												}
											>
												<span className="trends-column-spread-tick" />
												{spread.p99 === undefined ? null : (
													<span
														className="trends-column-spread-tick"
														data-p99="true"
													/>
												)}
											</span>
										);
									})()}
								</div>
								{/* Ranked, a bar is one model at one effort: its colour
								    and the list name it, not a label under it. */}
								{ranking ? null : (
									<div className="trends-column-name">
										<span className="trends-column-tag" title={model.name}>
											<ProviderMark provider={model.provider} />
											<span>{shortModelName(model.name)}</span>
										</span>
									</div>
								)}
							</motion.div>
						);
					})}
				</div>
				{/* The pinned column's rule, and the hovered one's, across the
				    whole plot. */}
				<div className="trends-columns-rules" aria-hidden="true">
					{rule(pinned, "pinned")}
					{rule(preview, "hover")}
				</div>
				{/* The axis title, where every chart has its own: centred under
				    the plot box, past the names (and the tick labels' room). */}
				<p
					className="trends-plot-title trends-plot-axis-title"
					style={{
						left: "50%",
						top: `calc(100% - var(--name-band) + ${26 + tickRoom}px)`,
					}}
				>
					{/* Grouped, the line stays empty but holds its height, so the
					    plot keeps its place when the arrangement changes. */}
					{axisTitle ??
						(ranking
							? "Every model and reasoning effort, lowest to highest"
							: "\u00a0")}
				</p>
			</div>
		</div>
	);
}

/**
 * Where a model's legend leader leaves the plot: a frontier model's own
 * rightmost frontier dot, any other model's last dot on its line.
 */
export function legendAnchor(
	model: TradeoffSeries,
	frontier: readonly TradeoffPoint[],
): TradeoffPoint | undefined {
	const onFrontier = frontier.filter((point) =>
		model.points.some(({ id }) => id === point.id),
	);
	const line = reasoningLineSegments(model.points)[0] ?? model.points;
	return onFrontier.at(-1) ?? line.at(-1);
}

/**
 * A line retracts from its end back to its start: of its steps that go,
 * the last retracts first, each taking an equal share of RETRACT_MS.
 */
function retractTiming(
	gone: readonly string[],
	key: string,
	start: number,
	together = false,
): Record<string, string> {
	const index = gone.indexOf(key);
	if (index === -1) return {};
	if (together)
		return {
			"--retract-delay": `${start}ms`,
			"--retract-duration": `${RETRACT_MS}ms`,
		};
	const share = RETRACT_MS / gone.length;
	return {
		"--retract-delay": `${start + (gone.length - 1 - index) * share}ms`,
		"--retract-duration": `${share}ms`,
	};
}

/** After the entrance, how long a new dot gets to pop in before the line
 * that connects it draws. */
const DOT_LEAD_MS = 380;
/** How long dots glide to a new chart (the CSS glide) before lines draw. */
const GLIDE_MS = 560;
/** About how long a chart's lines take to draw in after its dots glide. */
const DRAW_IN_MS = 1600;

/** How long the model list's rows take to glide to a new place, and the
 * frame or two the list needs to measure and start that glide. */
const ROW_GLIDE_MS = 560;
const ROW_ALIGN_MS = 80;

/** How long a connecting line takes to retract from the list. */
const LEADER_OUT_MS = 240;
/** How long a changed line takes to retract before the new one draws. */
const RETRACT_MS = 320;
/** Then how long a removed dot takes to shrink away (it starts as its line
 * finishes retracting). */
const DOT_OUT_MS = 240;

/** When, after a change, lines start retracting and dots start shrinking,
 * and when the new set takes over (ms). */
interface ExitPhases {
	readonly linesAt: number;
	readonly dotsAt: number;
	readonly total: number;
	/** Every step retracts at once rather than each line from its end: a
	 * change that interrupts lines still drawing in, whose drawn steps (the
	 * first ones) would otherwise wait behind steps that never showed. */
	readonly together: boolean;
}

/** The horizontal axis's label and number format, held back with the dots. */
interface StagedAxis {
	readonly horizontalLabel: string;
	readonly formatHorizontal: (value: number) => string;
}

/** The steps (dot to dot) of a model's line, as `chart|model:from>to`. */
function stepKeys(model: TradeoffSeries, generation: string) {
	return reasoningLineSegments(model.points).flatMap((segment) =>
		segment
			.slice(1)
			.map(
				(point, index) =>
					`${generation}|${model.id}:${segment[index]?.id}>${point.id}`,
			),
	);
}

/** The steps (dot to dot) of the frontier, as `from-to`. */
function frontierSteps(frontier: readonly TradeoffPoint[]) {
	return frontier
		.slice(1)
		.map((point, index) => `${frontier[index]?.id}-${point.id}`);
}

/**
 * Pareto mode shades every grid cell that holds no frontier point, above
 * and below the frontier alike, so the frontier reads as a clear path. A
 * point on a cell's edge keeps that cell clear. Cells never overlap, so the
 * 5% overlay stays even. Keys carry the chart and scale (`generation`), so a
 * new chart or scale fades its cells in afresh.
 */
function shadedCells(
	series: readonly TradeoffSeries[],
	frontier: readonly TradeoffPoint[],
	log: boolean,
	generation: string,
) {
	if (frontier.length === 0) return [];
	const points = series.flatMap((model) =>
		model.points.filter((point) => !log || point.horizontal > 0),
	);
	const horizontal = evenGrid(
		points.map((point) => point.horizontal),
		log,
	).grid;
	const vertical = evenGrid(
		points.map((point) => point.vertical),
		false,
	).grid;
	return horizontal.slice(1).flatMap((x1, column) => {
		const x0 = horizontal[column] ?? x1;
		return vertical.slice(1).flatMap((y1, row) => {
			const y0 = vertical[row] ?? y1;
			return frontier.some(
				(point) =>
					point.horizontal >= x0 &&
					point.horizontal <= x1 &&
					point.vertical >= y0 &&
					point.vertical <= y1,
			)
				? []
				: [{ key: `${generation}:${x0}-${y0}`, x0, x1, y0, y1 }];
		});
	});
}

/** Whether any of a model's dots is on the line (the frontier). */
function onLine(model: TradeoffSeries, line: readonly TradeoffPoint[]) {
	return model.points.some((point) => line.some(({ id }) => id === point.id));
}

/** Both axes' gridlines, which fix where every dot sits. */
function plotDomain(series: readonly TradeoffSeries[], log: boolean) {
	const points = series.flatMap((model) =>
		model.points.filter((point) => !log || point.horizontal > 0),
	);
	return [
		evenGrid(
			points.map((point) => point.horizontal),
			log,
		).grid,
		evenGrid(
			points.map((point) => point.vertical),
			false,
		).grid,
	].join("|");
}

/**
 * Holds the shown models back while the parts of lines that go away
 * retract and their dots shrink away: for RETRACT_MS + DOT_OUT_MS the plot
 * keeps the previous models and frontier, with the gone steps in
 * `leavingSteps`, gone dots in `leavingPoints` and models whose leader
 * starts elsewhere (or that are removed) in `leavingLeaders`; then it takes
 * the new ones. A change that leaves nothing (a model added off the
 * frontier) takes effect at once. A new chart or scale (`generation`) retracts every
 * line for RETRACT_MS while the dots stay; then the dots glide to the new
 * chart and its lines draw in.
 */
function useStagedSeries(
	series: readonly TradeoffSeries[],
	frontier: readonly TradeoffPoint[],
	generation: string,
	log: boolean,
	axis: StagedAxis,
	/** Whether leaders to the model list are drawn: without them none leave. */
	withLeaders: boolean,
): {
	readonly series: readonly TradeoffSeries[];
	readonly frontier: readonly TradeoffPoint[];
	readonly generation: string;
	readonly log: boolean;
	readonly axis: StagedAxis;
	readonly regenerating: boolean;
	readonly leavingSteps: ReadonlySet<string>;
	readonly leavingLeaders: ReadonlySet<string>;
	readonly leavingPoints: ReadonlySet<string>;
	readonly exit: ExitPhases;
	/** When (performance.now()) the shown set last changed. */
	readonly settledAt: number;
	/** When (performance.now()) each model's leader was last redrawn. */
	readonly leaderEpochs: ReadonlyMap<string, number>;
} {
	const settled = useRef({ series, frontier, generation, log, axis });
	const settledAt = useRef(Number.NEGATIVE_INFINITY);
	// When the shown chart or scale last changed: its dots glide for
	// GLIDE_MS before any of its lines draw.
	const glideStartedAt = useRef(Number.NEGATIVE_INFINITY);
	// When each model's leader was last redrawn, so only leaders that left
	// draw again.
	const leaderEpochs = useRef(new Map<string, number>());
	const latest = useRef({ series, frontier, generation, log, axis });
	latest.current = { series, frontier, generation, log, axis };
	const [, settle] = useState(0);
	const before = settled.current;
	// Another chart or scale while the last one's dots are still gliding in:
	// none of its lines or leaders have drawn yet, so nothing retracts and
	// the dots turn around from where they are.
	const inFlight =
		before.generation !== generation &&
		performance.now() - glideStartedAt.current < GLIDE_MS;
	const regenerating = before.generation !== generation && !inFlight;
	const kept = new Set(
		regenerating ? [] : series.flatMap((model) => stepKeys(model, generation)),
	);
	const leavingSteps = new Set(
		before.series
			.flatMap((model) => stepKeys(model, before.generation))
			.filter((key) => !kept.has(key)),
	);
	// Frontier steps that go retract like line steps, so switching the
	// frontier off waits for them before it takes them away.
	const keptFrontier = new Set(regenerating ? [] : frontierSteps(frontier));
	const frontierLeaving = frontierSteps(before.frontier).some(
		(step) => !keptFrontier.has(step),
	);
	const anchors = new Map(
		series.map((model) => [model.id, legendAnchor(model, frontier)?.id]),
	);
	// A new chart, scale or plot range moves every dot, and switching the
	// frontier regroups the model list, so every leader leaves first and draws
	// again once the rows have settled. Otherwise only the leaders whose start
	// changes leave: their model goes, joins or leaves the frontier, or leaves
	// from another dot. The rest stay and follow their rows.
	const redrawAll =
		regenerating ||
		before.frontier.length > 0 !== frontier.length > 0 ||
		plotDomain(before.series, before.log) !== plotDomain(series, log);
	const leavingLeaders = new Set(
		before.series
			.filter((model) => {
				if (!withLeaders) return false;
				if (redrawAll) return true;
				// With the frontier on, only its models have leaders.
				if (before.frontier.length > 0 && !onLine(model, before.frontier))
					return false;
				const next = series.find(({ id }) => id === model.id);
				return (
					!next ||
					onLine(next, frontier) !== onLine(model, before.frontier) ||
					anchors.get(model.id) !== legendAnchor(model, before.frontier)?.id
				);
			})
			.map((model) => model.id),
	);
	const shownPoints = new Set(
		series.flatMap((model) => model.points.map(({ id }) => id)),
	);
	const leavingPoints = new Set(
		before.series.flatMap((model) =>
			model.points.map(({ id }) => id).filter((id) => !shownPoints.has(id)),
		),
	);
	const staging =
		!inFlight &&
		(leavingSteps.size > 0 ||
			frontierLeaving ||
			leavingLeaders.size > 0 ||
			leavingPoints.size > 0);
	const change = staging
		? [
				generation,
				...kept,
				...anchors,
				...shownPoints,
				...frontier.map(({ id }) => id),
			].join("|")
		: "";
	// Leaving goes in the reverse of arriving: connecting lines first, then
	// the lines, then the dots.
	const linesAt = leavingLeaders.size > 0 ? LEADER_OUT_MS : 0;
	const dotsAt =
		linesAt + (leavingSteps.size > 0 || frontierLeaving ? RETRACT_MS : 0);
	// Lines of the shown chart draw in for a while after their dots glide:
	// a new chart or scale within that window catches some half drawn.
	const together =
		regenerating &&
		performance.now() - glideStartedAt.current < GLIDE_MS + DRAW_IN_MS;
	const exit = {
		linesAt,
		dotsAt,
		total: dotsAt + (leavingPoints.size > 0 ? DOT_OUT_MS : 0),
		together,
	};
	const leaderIds = [...leavingLeaders].join(",");
	useEffect(() => {
		if (!change) return;
		const timer = setTimeout(() => {
			if (latest.current.generation !== settled.current.generation)
				glideStartedAt.current = performance.now();
			settled.current = latest.current;
			settledAt.current = performance.now();
			for (const id of leaderIds.split(",").filter(Boolean))
				leaderEpochs.current.set(id, settledAt.current);
			settle((count) => count + 1);
		}, exit.total);
		return () => clearTimeout(timer);
	}, [change, exit.total, leaderIds]);
	const nothing = new Set<string>();
	const leaving = inFlight
		? {
				leavingSteps: nothing,
				leavingLeaders: nothing,
				leavingPoints: nothing,
				regenerating: false,
				exit: { linesAt: 0, dotsAt: 0, total: 0, together: false },
				settledAt: settledAt.current,
				leaderEpochs: leaderEpochs.current,
			}
		: {
				leavingSteps,
				leavingLeaders,
				leavingPoints,
				regenerating,
				exit,
				settledAt: settledAt.current,
				leaderEpochs: leaderEpochs.current,
			};
	if (!staging) {
		if (before.generation !== generation)
			glideStartedAt.current = performance.now();
		settled.current = { series, frontier, generation, log, axis };
		return { series, frontier, generation, log, axis, ...leaving };
	}
	return { ...before, ...leaving };
}

/** Distance between neighbouring metro lanes: the 1.75px stroke plus a 1px gap. */
const METRO_LANE = 2.75;
/** Least space between the plot's edge and the first metro lane. */
const METRO_GAP = 6;
/** Widest lane spacing the corridor beside the plot leaves room for. */
const METRO_SPREAD = 4;

/** Every metro corner has the radius of a colour dot in the model list. */
const METRO_RADIUS = 7;
/** Where a benchmark plot's box starts, past its vertical tick labels. The
 * bars start there too, so Score and Usage share one plot width. */
function plotLeft(width: number) {
	return width < 560 ? 36 : 48;
}

/** Width kept beside a benchmark plot for its leaders, the same whatever is
 * shown, so selecting models never resizes the plot: eight lanes at their
 * widest spacing, the turn into the list, a 3px run. More lanes than that
 * reach into the plot. */
const METRO_CORRIDOR = METRO_GAP + METRO_SPREAD * 7 + METRO_RADIUS + 3;
/** The plot's right margin with no list beside it (phones): none, the
 * plot runs to the screen's edge. */
const ALONE_CORRIDOR = 0;

/**
 * Lanes beside the plot for the model-list leaders, from heights alone.
 * Lanes are ordered so that no line crosses another there (every order is
 * tried up to eight lines; the fewest crossings win, ties keeping the
 * list's order). All lanes share one spacing, the smallest that keeps a
 * lane gap between every pair of lines (up to METRO_SPREAD, all the room the
 * corridor has), so the equal-radius curves don't touch.
 */
export function metroLanes(
	items: readonly {
		readonly id: string;
		readonly fromY: number;
		readonly toY: number;
	}[],
): { readonly offsets: ReadonlyMap<string, number>; readonly span: number } {
	type Item = (typeof items)[number];
	const byTarget = [...items].sort((one, other) => one.toY - other.toY);
	// Beside the plot a line crosses another when its level run in or out
	// passes the other's lane within that lane's vertical stretch.
	const span = (item: Item) =>
		[Math.min(item.fromY, item.toY), Math.max(item.fromY, item.toY)] as const;
	const within = (y: number, [low, high]: readonly [number, number]) =>
		y > low && y < high;
	const crossings = (order: readonly Item[]) => {
		let count = 0;
		order.forEach((item, lane) => {
			order.forEach((other, otherLane) => {
				if (otherLane < lane && within(item.fromY, span(other))) count++;
				if (otherLane > lane && within(item.toY, span(other))) count++;
			});
		});
		return count;
	};
	let sorted: readonly Item[] = byTarget;
	if (byTarget.length <= 8) {
		let best = crossings(byTarget);
		const permute = (prefix: readonly Item[], rest: readonly Item[]) => {
			if (best === 0) return;
			if (rest.length === 0) {
				const count = crossings(prefix);
				if (count < best) {
					best = count;
					sorted = [...prefix];
				}
				return;
			}
			rest.forEach((item, index) => {
				permute(
					[...prefix, item],
					rest.filter((_, other) => other !== index),
				);
			});
		};
		permute([], byTarget);
	}
	// One spacing for every lane: the smallest (in quarter pixels) at which
	// every pair of lines keeps a lane gap between strokes, curves included.
	const tries = Math.round((METRO_SPREAD - METRO_LANE) / 0.25) + 1;
	const step =
		Array.from({ length: tries }, (_, index) => METRO_LANE + index * 0.25).find(
			(candidate) => metroClear(sorted, candidate),
		) ?? METRO_SPREAD;
	const offsets = new Map(
		sorted.map((item, index) => [item.id, index * step] as const),
	);
	return { offsets, span: Math.max(0, ...offsets.values()) };
}

/**
 * Whether lanes `step` apart keep every pair of metro lines at least one
 * lane gap apart (centre to centre) beside the plot. Corners are sampled;
 * straight runs are measured exactly.
 */
function metroClear(
	order: readonly { readonly fromY: number; readonly toY: number }[],
	step: number,
): boolean {
	type Point = readonly [number, number];
	const shapes = order.map((item, index) => {
		const lane = index * step;
		const rise = item.toY - item.fromY;
		const sign = Math.sign(rise) || 1;
		const radius = Math.min(METRO_RADIUS, Math.abs(rise) / 2);
		const end = (order.length - 1) * step + METRO_RADIUS + 3;
		// A quarter turn sampled from angle `from`, sweeping `turn` (±1).
		const arc = (cx: number, cy: number, from: number, turn: number): Point[] =>
			Array.from({ length: 13 }, (_, k) => {
				const angle = from + (turn * k * Math.PI) / 24;
				return [
					cx + radius * Math.cos(angle),
					cy + radius * Math.sin(angle),
				] as const;
			});
		return {
			corners: [
				...arc(
					lane - radius,
					item.fromY + sign * radius,
					-sign * (Math.PI / 2),
					sign,
				),
				...arc(lane + radius, item.toY - sign * radius, Math.PI, -sign),
			],
			segments: [
				[-40, item.fromY, lane - radius, item.fromY],
				[lane, item.fromY + sign * radius, lane, item.toY - sign * radius],
				[lane + radius, item.toY, end, item.toY],
			] as const,
		};
	});
	const toSegment = (
		[px, py]: Point,
		[x1, y1, x2, y2]: readonly [number, number, number, number],
	) => {
		const dx = x2 - x1;
		const dy = y2 - y1;
		const t = Math.max(
			0,
			Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)),
		);
		return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
	};
	const gap = METRO_LANE - 0.01;
	return shapes.every((one, index) =>
		shapes.slice(index + 1).every((other) =>
			[
				[one, other],
				[other, one],
			].every(([a, b]) =>
				(a?.corners ?? []).every(
					(point) =>
						(b?.segments ?? []).every(
							(segment) => toSegment(point, segment) >= gap,
						) &&
						(b?.corners ?? []).every(
							(corner) =>
								Math.hypot(point[0] - corner[0], point[1] - corner[1]) >= gap,
						),
				),
			),
		),
	);
}

/**
 * Metro lines from each model's leaving dot to its colour dot in the model
 * list: level out of the dot, a rounded turn into the model's own lane
 * beside the plot, a rounded turn out, then level into the list. Every
 * corner has the same radius as the list's colour dots.
 */
export function metroRoutes(
	items: readonly {
		readonly id: string;
		readonly from: { readonly x: number; readonly y: number };
		readonly to: { readonly x: number; readonly y: number };
	}[],
	lanes: {
		readonly offsets: ReadonlyMap<string, number>;
		readonly span: number;
	},
	edge: number,
): Map<string, string> {
	// Lanes stand at the corridor's right, so the run into the list stays
	// short (3px past the last turn) however wide the lanes spread.
	const first = edge - 3 - METRO_RADIUS - lanes.span;
	return new Map(
		items.map((item) => {
			const lane = first + (lanes.offsets.get(item.id) ?? 0);
			const { x, y } = item.from;
			const target = item.to.y;
			const end = Math.min(item.to.x - 2, edge);
			const rise = target - y;
			const sign = Math.sign(rise);
			// A row lined up with its dot takes a straight line.
			if (Math.abs(rise) < 1.5) return [item.id, `M${x},${y} H${end}`];
			const radius = Math.min(METRO_RADIUS, Math.abs(rise) / 2);
			// Heading right then up is a left turn (sweep 0); then down, right.
			const turnIn = sign > 0 ? 1 : 0;
			const turnOut = sign > 0 ? 0 : 1;
			return [
				item.id,
				`M${x},${y} H${lane - radius} A${radius},${radius} 0 0 ${turnIn} ${lane},${y + sign * radius} V${target - sign * radius} A${radius},${radius} 0 0 ${turnOut} ${lane + radius},${target} H${end}`,
			];
		}),
	);
}

/**
 * Where each model's colour dot in the model list sits, in the plot's own
 * coordinates, when the list stands to the plot's right. Re-measured after every render and on resize or scroll; it
 * only updates when a position actually moves.
 */
function useLegendTargets(
	containerRef: { readonly current: HTMLDivElement | null },
	ids: readonly string[],
	enabled: boolean,
): ReadonlyMap<string, { readonly x: number; readonly y: number }> {
	const [targets, setTargets] = useState<
		ReadonlyMap<string, { readonly x: number; readonly y: number }>
	>(new Map());
	const last = useRef("");
	const wanted = ids.join(",");
	useLayoutEffect(() => {
		const measure = () => {
			// The plot itself, not an icon in the toolbar above it.
			const svg = containerRef.current?.querySelector(":scope > svg");
			const next = new Map<string, { x: number; y: number }>();
			if (enabled && svg) {
				const box = svg.getBoundingClientRect();
				for (const id of wanted.split(",")) {
					const dot = document.querySelector(
						`.trends-models-legend [data-legend-id="${CSS.escape(id)}"]`,
					);
					if (!dot) continue;
					const rect = dot.getBoundingClientRect();
					// Only a list standing beside the plot (not above it, as on
					// phones) can take leaders.
					if (rect.left < box.right - 4) continue;
					next.set(id, {
						x: Math.round(rect.left - box.left),
						y: Math.round(rect.top + rect.height / 2 - box.top),
					});
				}
			}
			const key = JSON.stringify([...next]);
			if (key !== last.current) {
				last.current = key;
				setTargets(next);
			}
		};
		measure();
		// Rows glide when the list reorders or lines up; follow them for the
		// length of that glide.
		const until = performance.now() + 800;
		let frame = requestAnimationFrame(function follow(now) {
			measure();
			if (now < until) frame = requestAnimationFrame(follow);
		});
		const list = document.querySelector(".trends-models-legend");
		window.addEventListener("resize", measure);
		list?.addEventListener("scroll", measure, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("resize", measure);
			list?.removeEventListener("scroll", measure);
		};
	});
	return targets;
}

/**
 * The plot fills its container, whose size only exists in the browser. The
 * server and the hydrating render draw nothing; the size is read in a layout
 * effect, so the first painted frame already has the real dimensions and the
 * entrance animation starts at the final size.
 */
export function usePlotSize(containerRef: {
	readonly current: HTMLDivElement | null;
}) {
	const [size, setSize] = useState({
		width: 960,
		height: 520,
		measured: false,
	});
	const last = useRef(size);
	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const apply = (width: number, height: number) => {
			const next = {
				width: Math.max(280, Math.round(width)),
				height: Math.max(300, Math.round(height)),
				measured: true,
			};
			if (
				!last.current.measured ||
				next.width !== last.current.width ||
				next.height !== last.current.height
			) {
				last.current = next;
				setSize(next);
			}
		};
		const rect = container.getBoundingClientRect();
		apply(rect.width, rect.height);
		const observer = new ResizeObserver(([entry]) => {
			if (entry) apply(entry.contentRect.width, entry.contentRect.height);
		});
		observer.observe(container);
		return () => observer.disconnect();
	}, [containerRef]);
	return size;
}

interface Box {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

interface ModelLabel {
	/** Left edge, width and vertical centre of the name. */
	readonly left: number;
	readonly width: number;
	readonly cy: number;
	readonly leader: boolean;
	/** Leader from the point to the left of the icon, as a polyline. */
	readonly path: readonly (readonly [number, number])[];
}

type Segment = readonly [number, number, number, number];

type Pixel = { readonly x: number; readonly y: number };

/**
 * Pareto tags: each model on the frontier is named once, near the middle of
 * its frontier dots (or the nearest one with room). Every one of those dots
 * gets a straight line into the name's colour dot, so a spot only counts
 * when the name keeps clear of every dot and line (16px, else 10 or 6) and none of its
 * lines crosses a name. Spots are tried nearest first: above, up-left,
 * level to the left, up-right; never below, among the dominated models.
 */
export function placeFrontierTags(
	items: readonly {
		readonly id: string;
		readonly run: readonly Pixel[];
		readonly width: number;
	}[],
	points: readonly Pixel[],
	segments: readonly Segment[],
	plot: Box,
): Map<string, ModelLabel> {
	const half = LABEL_HEIGHT / 2;
	const taken: Box[] = [];
	const placed = new Map<string, ModelLabel>();
	const boxOf = (left: number, cy: number, width: number, pad: number) => ({
		left: left - pad,
		right: left + width + pad,
		top: cy - half - pad,
		bottom: cy + half + pad,
	});
	// The name's text, right of its colour dot and lab icon's left edge.
	const textOf = (left: number, cy: number, width: number) => ({
		left: left + 14,
		right: left + width + 2,
		top: cy - half - 1,
		bottom: cy + half + 1,
	});
	const fits = (
		item: (typeof items)[number],
		left: number,
		cy: number,
		clearance: number,
	) => {
		const box = boxOf(left, cy, item.width, clearance);
		if (
			left < plot.left ||
			left + item.width > plot.right ||
			cy - half < plot.top ||
			cy + half > plot.bottom ||
			taken.some((other) =>
				boxesOverlap(boxOf(left, cy, item.width, 8), other),
			) ||
			points.some(
				(point) =>
					point.x > box.left - 6 &&
					point.x < box.right + 6 &&
					point.y > box.top - 6 &&
					point.y < box.bottom + 6,
			) ||
			segments.some((segment) => segmentHitsBox(segment, box))
		)
			return false;
		const texts = [textOf(left, cy, item.width), ...taken];
		return item.run.every((point) =>
			texts.every(
				(text) => !segmentHitsBox([point.x, point.y, left + 6, cy], text),
			),
		);
	};
	for (const item of items) {
		const middle = (item.run.length - 1) / 2;
		const anchors = [...item.run].sort(
			(one, other) =>
				Math.abs(item.run.indexOf(one) - middle) -
				Math.abs(item.run.indexOf(other) - middle),
		);
		// Left edge and centre line of the name for each candidate spot.
		const spots = anchors.flatMap((anchor) =>
			[40, 56, 72, 96, 120, 150, 180].flatMap((reach) => [
				{ left: anchor.x - 6, cy: anchor.y - reach },
				{ left: anchor.x - 6 - reach * 0.6, cy: anchor.y - reach },
				{ left: anchor.x - reach - item.width, cy: anchor.y },
				{ left: anchor.x - 6 + reach * 0.6, cy: anchor.y - reach },
			]),
		);
		// Room is relaxed step by step before a frontier model gives up its
		// place beside its dots.
		const spot = TAG_CLEARANCES.map((clearance) =>
			spots.find(({ left, cy }) => fits(item, left, cy, clearance)),
		).find((candidate) => candidate !== undefined);
		if (!spot) continue;
		taken.push(boxOf(spot.left, spot.cy, item.width, 0));
		placed.set(item.id, {
			left: spot.left,
			width: item.width,
			cy: spot.cy,
			leader: true,
			path: [[spot.left + 6, spot.cy]],
		});
	}
	return placed;
}

/**
 * Model names sit on the plot directly above or below their model's last
 * point wherever that spot has plenty of room: 14px clear of every other
 * model's points and lines and of every name already placed (their own line
 * may come closer). Names without such room form one stack, in the order
 * of their points from the right, every icon on one left edge as far right
 * as the plot allows, below the marks with a wide berth (32px where the plot allows; above only when
 * nothing below fits). Each is tied back by one leader that reaches its icon
 * through a lane beside the stack, clear of every name; a name beside its
 * point that a leader would cross joins the stack. Names never overlap.
 */
export function placeModelLabels(
	items: readonly {
		readonly id: string;
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly own?: {
			readonly points: readonly Pixel[];
			readonly segments: readonly Segment[];
		};
	}[],
	points: readonly Pixel[],
	segments: readonly Segment[],
	plot: Box,
	reserved: readonly Box[] = [],
): Map<string, ModelLabel> {
	const layout = (forced: ReadonlySet<string>) => {
		const half = LABEL_HEIGHT / 2;
		const taken: Box[] = [...reserved];
		const placed = new Map<string, ModelLabel>();
		const inlineBoxes = new Map<string, Box>();
		const boxAt = (left: number, cy: number, width: number, pad: number) => ({
			left: left - pad,
			right: left + width + pad,
			top: cy - half - pad,
			bottom: cy + half + pad,
		});
		const pointBox = (point: Pixel) => ({
			left: point.x - 6,
			right: point.x + 6,
			top: point.y - 6,
			bottom: point.y + 6,
		});
		// A name keeps `gap` pixels clear of other marks and names, and 4px of
		// its own model's marks.
		const clear = (
			left: number,
			cy: number,
			width: number,
			gap: number,
			own?: (typeof items)[number]["own"],
		) => {
			const box = boxAt(left, cy, width, gap);
			const near = boxAt(left, cy, width, 4);
			return (
				left >= plot.left &&
				left + width <= plot.right &&
				cy - half >= plot.top &&
				cy + half <= plot.bottom &&
				!taken.some((other) => boxesOverlap(box, other)) &&
				!points.some((point) =>
					boxesOverlap(
						own?.points.includes(point) ? near : box,
						pointBox(point),
					),
				) &&
				!segments.some((segment) =>
					segmentHitsBox(segment, own?.segments.includes(segment) ? near : box),
				)
			);
		};
		const stacked: (typeof items)[number][] = [];
		for (const item of [...items].sort(
			(first, second) =>
				first.y - second.y || first.id.localeCompare(second.id),
		)) {
			const { x, y, width } = item;
			// 18px from the point's centre clears its mark plus a 4px margin.
			const above = y - 18 - half;
			const below = y + 18 + half;
			const beside: [number, number][] = [
				[x - width / 2, above],
				[x - width / 2, below],
				[x + 6 - width, above],
				[x + 6 - width, below],
				[x - 6, above],
				[x - 6, below],
			];
			const inline = forced.has(item.id)
				? undefined
				: beside.find(([left, cy]) => clear(left, cy, width, 14, item.own));
			if (!inline) {
				stacked.push(item);
				continue;
			}
			placed.set(item.id, {
				left: inline[0],
				width,
				cy: inline[1],
				leader: false,
				path: [],
			});
			taken.push(boxAt(inline[0], inline[1], width, 0));
			inlineBoxes.set(item.id, boxAt(inline[0], inline[1], width, 2));
		}
		const first = stacked[0];
		if (!first) return { placed, inlineBoxes };
		const step = LABEL_HEIGHT + 4;
		const lane = 5;
		const lanesWidth = 8 + lane * (stacked.length - 1);
		// The rightmost point's name on top. Every icon starts at one left
		// edge, as far right as the widest name allows. Each leader runs from
		// its point to its own lane just left of the stack (lower names use
		// lanes further left), down the lane, then right into its icon, so no
		// leader crosses a name or another leader.
		const order = [...stacked].sort(
			(one, other) => other.x - one.x || one.y - other.y,
		);
		const left = Math.max(
			plot.left + lanesWidth,
			plot.right - 8 - Math.max(...order.map((item) => item.width)),
		);
		// Every height below the first point, nearest first, then above.
		const top = Math.min(...order.map((item) => item.y));
		const starts: number[] = [];
		for (let offset = 24; top + offset <= plot.bottom; offset += 4)
			starts.push(top + offset);
		for (let offset = 24; top - offset >= plot.top; offset += 4)
			starts.push(top - offset);
		const fits = (start: number, gap: number) =>
			order.every((item, index) =>
				clear(
					left - lanesWidth,
					start + index * step,
					lanesWidth + item.width,
					gap,
				),
			);
		const start =
			[32, 18, 8]
				.map((gap) => starts.find((candidate) => fits(candidate, gap)))
				.find((candidate) => candidate !== undefined) ?? first.y + 24;
		const above = start - half - 6;
		order.forEach((item, index) => {
			const cy = start + index * step;
			const x = left - 8 - lane * index;
			placed.set(item.id, {
				left,
				width: item.width,
				cy,
				leader: true,
				path: [
					[item.x, item.y],
					[x, above],
					[x, cy],
					[left + 6, cy],
				],
			});
		});
		return { placed, inlineBoxes };
	};
	// A name beside its point joins the stack when a leader would cross it.
	const forced = new Set<string>();
	for (;;) {
		const { placed, inlineBoxes } = layout(forced);
		const crossed = [...inlineBoxes].filter(([, box]) =>
			[...placed.values()].some((name) =>
				name.path.slice(1).some((end, index) => {
					const from = name.path[index] ?? end;
					return segmentHitsBox([from[0], from[1], end[0], end[1]], box);
				}),
			),
		);
		if (crossed.length === 0) return placed;
		for (const [id] of crossed) forced.add(id);
	}
}

function boxesOverlap(first: Box, second: Box) {
	return (
		first.left < second.right &&
		second.left < first.right &&
		first.top < second.bottom &&
		second.top < first.bottom
	);
}

/** Liang-Barsky: does the segment pass through the box? */
function segmentHitsBox([x1, y1, x2, y2]: Segment, box: Box) {
	let enter = 0;
	let exit = 1;
	const dx = x2 - x1;
	const dy = y2 - y1;
	for (const [p, q] of [
		[-dx, x1 - box.left],
		[dx, box.right - x1],
		[-dy, y1 - box.top],
		[dy, box.bottom - y1],
	] as const) {
		if (p === 0) {
			if (q < 0) return false;
			continue;
		}
		const ratio = q / p;
		if (p < 0) {
			if (ratio > exit) return false;
			enter = Math.max(enter, ratio);
		} else {
			if (ratio < enter) return false;
			exit = Math.min(exit, ratio);
		}
	}
	return true;
}

interface PlacedLabel {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly anchor: "start" | "end" | "middle";
	readonly leader: boolean;
	readonly fromX: number;
	readonly fromY: number;
}

function overlaps(a: Box, b: Box) {
	return (
		a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
	);
}

function within(box: Box, bounds: Box) {
	return (
		box.left >= bounds.left &&
		box.right <= bounds.right &&
		box.top >= bounds.top &&
		box.bottom <= bounds.bottom
	);
}

/**
 * Labels sit beside their mark: right, left, above or below, whichever is
 * free. Only when none fits does a label step away vertically, and then a
 * short leader ties it back to the mark.
 */
export function placeDirectLabels(
	items: readonly {
		readonly id: string;
		readonly priority: number;
		readonly x: number;
		readonly y: number;
		readonly width: number;
	}[],
	obstacles: readonly Box[],
	bounds: Box,
) {
	const placed = new Map<string, PlacedLabel>();
	const taken: Box[] = [...obstacles];
	for (const item of [...items].sort(
		(first, second) => second.priority - first.priority || first.y - second.y,
	)) {
		const half = LABEL_HEIGHT / 2;
		const candidates: PlacedLabel[] = [
			{
				...item,
				anchor: "start",
				x: item.x + 11,
				y: item.y + 4,
				leader: false,
				fromX: item.x,
				fromY: item.y,
			},
			{
				...item,
				anchor: "end",
				x: item.x - 11,
				y: item.y + 4,
				leader: false,
				fromX: item.x,
				fromY: item.y,
			},
			{
				...item,
				anchor: "middle",
				x: item.x,
				y: item.y - 11,
				leader: false,
				fromX: item.x,
				fromY: item.y,
			},
			{
				...item,
				anchor: "middle",
				x: item.x,
				y: item.y + 19,
				leader: false,
				fromX: item.x,
				fromY: item.y,
			},
			...[-1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -7, 7, -8, 8].flatMap(
				(step) => [
					{
						...item,
						anchor: "start" as const,
						x: item.x + 14,
						y: item.y + 4 + step * (LABEL_HEIGHT + 2),
						leader: true,
						fromX: item.x,
						fromY: item.y,
					},
					{
						...item,
						anchor: "end" as const,
						x: item.x - 14,
						y: item.y + 4 + step * (LABEL_HEIGHT + 2),
						leader: true,
						fromX: item.x,
						fromY: item.y,
					},
				],
			),
		];
		const boxOf = (label: PlacedLabel): Box => {
			const left =
				label.anchor === "start"
					? label.x
					: label.anchor === "end"
						? label.x - label.width
						: label.x - label.width / 2;
			return {
				left,
				right: left + label.width,
				top: label.y - 4 - half,
				bottom: label.y - 4 + half,
			};
		};
		const choice = candidates.find((label) => {
			const box = boxOf(label);
			return (
				within(box, bounds) && !taken.some((other) => overlaps(box, other))
			);
		});
		if (!choice) continue;
		placed.set(item.id, choice);
		taken.push(boxOf(choice));
	}
	return placed;
}

function pathThrough(
	points: readonly TradeoffPoint[],
	horizontal: (value: number) => number,
	vertical: (value: number) => number,
) {
	return points
		.map(
			(point, index) =>
				`${index === 0 ? "M" : "L"}${horizontal(point.horizontal)},${vertical(point.vertical)}`,
		)
		.join(" ");
}

function scaleValue(value: number, min: number, max: number, log: boolean) {
	return log
		? (Math.log10(value) - Math.log10(min)) /
				(Math.log10(max) - Math.log10(min) || 1)
		: (value - min) / (max - min || 1);
}

/**
 * An axis with an even number of equal cells, so its middle is a gridline.
 * Linear: a 1-2-5 step, 2 to 8 cells, padded by one cell when the count is
 * odd. Log: whole decades, padded to an even count on the side with less
 * room, with a line at 3× each decade when there are few (1-3-10). Every
 * line is labelled; the ×3 and ×3.33 cells differ by about 10% in width.
 */
export function evenGrid(
	values: readonly number[],
	log: boolean,
	floor?: number,
): { min: number; max: number; grid: number[]; labels: number[] } {
	const finite = values.filter((value) => Number.isFinite(value));
	if (log) {
		const positive = finite.filter((value) => value > 0);
		const low = Math.log10(positive.length ? Math.min(...positive) : 1);
		const high = Math.log10(positive.length ? Math.max(...positive) : 10);
		let first = Math.floor(low);
		let last = Math.max(Math.ceil(high), first + 1);
		if ((last - first) % 2 === 1) {
			if (low - first < last - high) first -= 1;
			else last += 1;
		}
		const decades = Array.from(
			{ length: last - first + 1 },
			(_, index) => 10 ** (first + index),
		);
		const grid =
			last - first <= 4
				? decades.flatMap((value, index) =>
						index === 0 ? [value] : [3 * 10 ** (first + index - 1), value],
					)
				: decades;
		return {
			min: decades[0] ?? 1,
			max: decades.at(-1) ?? 10,
			grid,
			labels: grid,
		};
	}
	const low = floor ?? (finite.length ? Math.min(...finite) : 0);
	const high = Math.max(...finite, low + 1e-9);
	for (const exponent of [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6])
		for (const multiplier of [1, 2, 5]) {
			const step = multiplier * 10 ** exponent;
			const min = floor ?? Math.floor(low / step) * step;
			let cells = Math.max(2, Math.ceil((high - min) / step - 1e-9));
			if (cells % 2 === 1) cells += 1;
			if (cells > 8) continue;
			const grid = Array.from(
				{ length: cells + 1 },
				(_, index) => Math.round((min + step * index) * 1e9) / 1e9,
			);
			return { min, max: grid.at(-1) ?? min + step, grid, labels: grid };
		}
	return { min: low, max: high, grid: [low, high], labels: [low, high] };
}

export function axisTicks(
	values: readonly number[],
	log: boolean,
	count: number,
) {
	count = Math.max(2, count);
	const measuredMax = Math.max(...values, 1e-6);
	if (!log) {
		const paddedMax =
			values.length > 0 && values.every((value) => value === values[0])
				? measuredMax * 1.2
				: measuredMax;
		const step = niceMaximum(paddedMax / (count - 1));
		const intervals = Math.ceil(paddedMax / step);
		return Array.from({ length: intervals + 1 }, (_, index) => step * index);
	}
	const measuredMin = Math.min(
		...values.filter((value) => value > 0),
		measuredMax,
	);
	const constant = measuredMin === measuredMax;
	const min = constant ? measuredMin / 2 : measuredMin;
	const max = constant ? measuredMax * 2 : measuredMax;
	const candidates: number[] = [];
	for (
		let exponent = Math.floor(Math.log10(min));
		exponent <= Math.ceil(Math.log10(max));
		exponent++
	)
		for (const multiplier of [1, 2, 5])
			candidates.push(multiplier * 10 ** exponent);
	const lower = [...candidates].reverse().find((value) => value <= min) ?? min;
	const upper = candidates.find((value) => value >= max) ?? max;
	const ticks = candidates.filter((value) => value >= lower && value <= upper);
	const stride = Math.max(1, Math.ceil((ticks.length - 1) / (count - 1)));
	return ticks.filter(
		(_, index) => index % stride === 0 || index === ticks.length - 1,
	);
}

export function niceMaximum(value: number) {
	const power = 10 ** Math.floor(Math.log10(value || 1));
	const step =
		[1, 2, 2.5, 4, 5, 8, 10].find((candidate) => candidate >= value / power) ??
		10;
	return step * power;
}
