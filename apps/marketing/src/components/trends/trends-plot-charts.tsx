import { animate } from "motion/react";
import {
	type CSSProperties,
	type KeyboardEvent,
	type PointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	formatCompact,
	formatDay,
	formatPercent,
} from "../../trends/trends-format";
import type {
	TrendsProvider,
	TrendsSnapshot,
} from "../../trends/trends-snapshot";
import { TRENDS_OTHER_COLOR, TRENDS_SERIES_COLORS } from "./trends-colors";
import { prefersReducedMotion, useGlide, useLiveMotion } from "./trends-motion";
import { shareOfRuns, sharePeriods } from "./trends-sections";

interface PlotChartProps {
	readonly snapshot: TrendsSnapshot;
	readonly models: readonly ShareModel[];
	readonly focusIds: ReadonlySet<string>;
	/** Each model's colour, as in the model list. */
	readonly colors?: ReadonlyMap<string, string>;
	/** The axis title under the plot, where every chart has its own. */
	readonly axisTitle?: string;
	/** The scatter's room for tick labels (none in its insight views). */
	readonly tickRoom?: number;
}

export interface ShareSeries {
	readonly id: string;
	readonly name: string;
	readonly provider?: TrendsProvider;
	readonly color: string;
	readonly values: readonly number[];
}

/** A hovered period's figures, as the model list shows them. */
export interface InspectedPeriod {
	readonly values: ReadonlyMap<string, string>;
	readonly leaderId?: string;
	/** A word before a model's figure: on the columns, the reasoning effort
	 * of the column it is. */
	readonly notes?: ReadonlyMap<string, string>;
}

/** A model the share draws: any pickable model, with usage data or not. */
export interface ShareModel {
	readonly id: string;
	readonly name: string;
	readonly provider?: TrendsProvider;
}

/** Each model's share of the shown models' runs (or turns) per period, or
 * with volume its runs as they are. */
export function buildShareSeries(
	snapshot: TrendsSnapshot,
	models: readonly ShareModel[],
	colors?: ReadonlyMap<string, string>,
	volume = false,
): readonly ShareSeries[] {
	const visible = new Set(models.map((model) => model.id));
	const periods = volume
		? sharePeriods(snapshot).periods.map((period) => ({
				shares: period.runsByModel,
			}))
		: shareOfRuns(snapshot, visible);
	return models.map((model, index) => {
		// A fallback colour follows the model, not the selection.
		const slot = snapshot.models.findIndex(({ id }) => id === model.id);
		return {
			id: model.id,
			name: model.name,
			provider: model.provider,
			color:
				colors?.get(model.id) ??
				TRENDS_SERIES_COLORS[
					(slot === -1 ? snapshot.models.length + index : slot) %
						TRENDS_SERIES_COLORS.length
				] ??
				TRENDS_OTHER_COLOR,
			values: periods.map((period) => period.shares[model.id] ?? 0),
		};
	});
}

type Stack = ReadonlyMap<string, readonly number[]>;

/** Each week with runs split evenly among the models; volume grows from
 * nothing instead. */
function evenStack(series: readonly ShareSeries[], volume: boolean): Stack {
	if (volume)
		return new Map(
			series.map((entry) => [entry.id, entry.values.map(() => 0)]),
		);
	return new Map(
		series.map((entry) => [
			entry.id,
			entry.values.map((_, week) =>
				series.some((other) => (other.values[week] ?? 0) > 0)
					? 1 / series.length
					: 0,
			),
		]),
	);
}

/**
 * The shares the bands draw, eased toward the data like the harness split:
 * a chart switched to swells from an even split, and a change of models
 * morphs from the bands on screen (a model new to the chart grows from
 * nothing). The first page load paints the data as it is.
 */
function useMorphedStack(
	series: readonly ShareSeries[],
	volume: boolean,
): Stack {
	const live = useLiveMotion();
	const [shown, setShown] = useState<Stack>(() =>
		live.current
			? evenStack(series, volume)
			: new Map(series.map((entry) => [entry.id, entry.values])),
	);
	const current = useRef(shown);
	const entered = useRef(false);
	const key = JSON.stringify(series.map((entry) => [entry.id, entry.values]));
	useEffect(() => {
		const goal = JSON.parse(key) as [string, number[]][];
		const from = current.current;
		const show = (t: number) => {
			const next = new Map(
				goal.map(([id, values]) => [
					id,
					values.map((value, week) => {
						const start = from.get(id)?.[week] ?? 0;
						return start + (value - start) * t;
					}),
				]),
			);
			current.current = next;
			setShown(next);
		};
		const entering = !entered.current;
		entered.current = true;
		if (!live.current || prefersReducedMotion()) {
			show(1);
			return;
		}
		// The entrance eases in and out, so the swell still plays once the
		// chart has faded in; later changes start at once.
		const controls = animate(0, 1, {
			duration: 0.9,
			ease: entering ? [0.65, 0, 0.35, 1] : [0.22, 1, 0.36, 1],
			onUpdate: show,
		});
		return () => controls.stop();
	}, [key, live]);
	return shown;
}

/**
 * The weekly split among the shown models, one band each, stacked from the
 * top in the legend's order (as the harness split stacks Claude Code over
 * Codex), a hairline in the page's colour where two bands meet. A week
 * without runs from any shown model breaks the bands instead of drawing an
 * empty split.
 */
export function ShareChart({
	snapshot,
	models,
	focusIds,
	colors,
	order,
	axisTitle,
	tickRoom = 0,
	volume = false,
	onInspect,
}: PlotChartProps & {
	/** Model ids in the legend's order: the bands stack in it. */
	readonly order?: readonly string[];
	/** Stack each model's runs (or turns) as they are, on a count axis,
	 * instead of its share. */
	readonly volume?: boolean;
	/** The hovered period's figure per model, formatted, and the model
	 * with the largest; undefined when nothing is hovered. */
	readonly onInspect?: (inspected: InspectedPeriod | undefined) => void;
}) {
	const rank = (id: string) => {
		const index = order?.indexOf(id) ?? -1;
		return index === -1 ? Number.MAX_SAFE_INTEGER : index;
	};
	const series = [...buildShareSeries(snapshot, models, colors, volume)].sort(
		(first, second) => rank(first.id) - rank(second.id),
	);
	const { kind, periods } = sharePeriods(snapshot);
	const weekCount = periods.length;
	// Volume: from zero to the first round step over the busiest period, in
	// at most five steps; share: the whole, in quarters.
	const busiest = Math.max(
		0,
		...periods.map((_, index) =>
			series.reduce((sum, entry) => sum + (entry.values[index] ?? 0), 0),
		),
	);
	const step = volume ? roundStep(busiest / 5) : 0.25;
	const steps = volume ? Math.max(1, Math.ceil(busiest / step)) : 4;
	const ceiling = step * steps;
	const yTicks = Array.from({ length: steps + 1 }, (_, index) => index * step);
	const format = volume ? formatCompact : formatPercent;
	const x = (index: number) =>
		weekCount > 1 ? (index / (weekCount - 1)) * 100 : 50;
	const y = (value: number) => 100 - (value / ceiling) * 100;
	const [activeIndex, setActiveIndex] = useState<number | null>(null);
	const focusInSeries = series.some((entry) => focusIds.has(entry.id));
	const stack = useMorphedStack(series, volume);
	// The line, its date and the tooltip's week glide together.
	const at = useGlide(
		weekCount > 1 ? (activeIndex ?? weekCount - 1) / (weekCount - 1) : 0.5,
	);
	const hovering = activeIndex !== null;
	const inspectedWeek = periods[activeIndex ?? weekCount - 1];

	// Each week's band edges from the top: a model's band runs from the
	// shares stacked above it to those plus its own.
	const reported = (index: number) =>
		series.some((entry) => (entry.values[index] ?? 0) > 0);
	const stretches: number[][] = [];
	periods.forEach((_, index) => {
		if (!reported(index)) {
			if (stretches.at(-1)?.length) stretches.push([]);
			return;
		}
		if (stretches.length === 0) stretches.push([]);
		stretches.at(-1)?.push(index);
	});
	const above = (seriesIndex: number, week: number) =>
		series
			.slice(0, seriesIndex)
			.reduce((sum, entry) => sum + (stack.get(entry.id)?.[week] ?? 0), 0);
	// A band edge's height from the plot's top: the stack stands on the
	// baseline (a share's always reaches the top; a volume's stops at its
	// period's total), the legend's first model uppermost.
	const edge = (seriesIndex: number, week: number) =>
		((ceiling - above(series.length, week) + above(seriesIndex, week)) /
			ceiling) *
		100;
	const band = (seriesIndex: number) =>
		stretches
			.filter((stretch) => stretch.length > 0)
			.map((stretch) => {
				const top = stretch.map(
					(week) => `${x(week)},${edge(seriesIndex, week)}`,
				);
				const bottom = stretch
					.slice()
					.reverse()
					.map((week) => `${x(week)},${edge(seriesIndex + 1, week)}`);
				return `M${top.join(" L")} L${bottom.join(" L")} Z`;
			})
			.join(" ");
	// The hairlines between bands: every band's lower edge but the last's.
	const seams = series.slice(0, -1).flatMap((entry, seriesIndex) =>
		stretches
			.filter((stretch) => stretch.length > 1)
			.map((stretch) => ({
				key: `${entry.id}-${stretch[0]}`,
				points: stretch
					.map((week) => `${x(week)},${edge(seriesIndex + 1, week)}`)
					.join(" "),
			})),
	);

	// The hovered period's figures go to the model list beside the chart,
	// each beside its model (a dash where it had none), the largest marked,
	// instead of a card over the bands.
	const leader =
		activeIndex === null
			? undefined
			: series.reduce<ShareSeries | undefined>(
					(best, entry) =>
						(entry.values[activeIndex] ?? 0) > (best?.values[activeIndex] ?? 0)
							? entry
							: best,
					undefined,
				);
	const inspected =
		activeIndex === null
			? undefined
			: {
					values: series.map(
						(entry) =>
							[
								entry.id,
								(entry.values[activeIndex] ?? 0) > 0
									? format(entry.values[activeIndex] ?? 0)
									: "–",
							] as const,
					),
					leaderId: leader?.id,
				};
	const inspectedKey = inspected ? JSON.stringify(inspected) : "";
	useEffect(() => {
		if (!inspectedKey) {
			onInspect?.(undefined);
			return;
		}
		const { values, leaderId } = JSON.parse(inspectedKey) as {
			values: [string, string][];
			leaderId?: string;
		};
		onInspect?.({ values: new Map(values), leaderId });
	}, [inspectedKey, onInspect]);
	useEffect(() => () => onInspect?.(undefined), [onInspect]);

	const activate = (index: number) => setActiveIndex(index);

	const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		const ratio = (event.clientX - rect.left) / (rect.width || 1);
		const index = Math.min(
			weekCount - 1,
			Math.max(0, Math.round(ratio * (weekCount - 1))),
		);
		activate(index);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		const delta = event.key === "ArrowLeft" ? -1 : 1;
		const index = Math.min(
			weekCount - 1,
			Math.max(0, (activeIndex ?? weekCount - 1) + delta),
		);
		activate(index);
	};

	const clear = () => setActiveIndex(null);

	return (
		<div
			className="trends-plot-frame"
			data-plot-box="true"
			style={{ "--tick-room": `${tickRoom}px` } as CSSProperties}
		>
			<div className="trends-plot-y" aria-hidden="true">
				{yTicks.map((tick) => (
					<span key={tick} style={{ "--at": `${y(tick)}%` } as CSSProperties}>
						{format(tick)}
					</span>
				))}
			</div>
			<div className="trends-plot trends-share-plot" onPointerLeave={clear}>
				{yTicks.map((tick) => (
					<span
						key={tick}
						className="trends-plot-gridline"
						style={{ "--at": `${y(tick)}%` } as CSSProperties}
						aria-hidden="true"
					/>
				))}
				<svg
					className="trends-share-svg"
					viewBox="0 0 100 100"
					preserveAspectRatio="none"
					aria-hidden="true"
				>
					{series.map((entry, seriesIndex) => (
						<path
							key={entry.id}
							className="trends-share-band"
							data-dimmed={focusInSeries && !focusIds.has(entry.id)}
							d={band(seriesIndex)}
							style={{ "--fill": entry.color } as CSSProperties}
						/>
					))}
					{seams.map((seam) => (
						<polyline
							key={seam.key}
							className="trends-share-line trends-share-seam"
							points={seam.points}
						/>
					))}
				</svg>
				<span
					className="trends-crosshair trends-hover-line"
					data-shown={hovering}
					style={{ "--at": `${at * 100}%` } as CSSProperties}
					aria-hidden="true"
				/>
				<button
					type="button"
					className="trends-plot-hit"
					aria-label={`${kind === "week" ? `Weekly ${volume ? "agent runs" : "share of agent runs"}` : `Daily ${volume ? "turns" : "share of turns"}`} by model. Use the left and right arrow keys to step through ${kind}s.`}
					onPointerMove={onPointerMove}
					onKeyDown={onKeyDown}
					onBlur={clear}
				/>
			</div>
			<div className="trends-plot-x" aria-hidden="true">
				{[0, Math.floor((weekCount - 1) / 2), weekCount - 1].map((index) => (
					<span
						key={index}
						data-faded={hovering}
						style={{ "--at": `${x(index)}%` } as CSSProperties}
					>
						{formatDay(periods[index]?.start ?? "")}
					</span>
				))}
				{/* The hovered week's date under its line; the others fade. */}
				<span
					className="trends-plot-x-hover"
					data-shown={hovering}
					style={{ "--at": `${at * 100}%` } as CSSProperties}
				>
					{formatDay(inspectedWeek?.start ?? "")}
				</span>
				{axisTitle ? (
					<p className="trends-plot-title trends-plot-axis-title">
						{axisTitle}
					</p>
				) : null}
			</div>
		</div>
	);
}

/** The smallest 1, 2 or 5 times a power of ten at or above a value. */
function roundStep(value: number) {
	if (value <= 0) return 1;
	const power = 10 ** Math.floor(Math.log10(value));
	return (
		([1, 2, 5, 10].find((factor) => factor * power >= value) ?? 10) * power
	);
}
