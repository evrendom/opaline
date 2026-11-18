import { motion } from "motion/react";
import {
	type CSSProperties,
	type KeyboardEvent,
	type PointerEvent,
	useRef,
	useState,
} from "react";
import { formatCompact, formatMonth } from "../../trends/trends-format";
import { TRENDS_SERIES_COLORS } from "./trends-colors";
import { useGlide } from "./trends-motion";

const LINE_COLOR = TRENDS_SERIES_COLORS[0] ?? "#3978f6";
/** A change of scale: one calm ease-out glide, no overshoot, for the lines,
 * their dots and labels alike (the grid's CSS matches it). */
const RESCALE = { duration: 0.5, ease: [0.22, 1, 0.36, 1] } as const;

/** One complete month of a measure per agent run: average and tail. */
export interface MonthlyPoint {
	readonly monthStart: string;
	readonly runs: number;
	readonly mean: number;
	readonly p95: number;
	readonly p99: number;
}

/** The three lines: one measure's average and its tail, in one hue. */
const SERIES = [
	{ id: "p99", label: "p99", value: (month: MonthlyPoint) => month.p99 },
	{ id: "p95", label: "p95", value: (month: MonthlyPoint) => month.p95 },
	{ id: "mean", label: "Average", value: (month: MonthlyPoint) => month.mean },
] as const;

/**
 * One of Opaline's monthly series, every model together: a line for the
 * average per agent run, and lighter ones for its p95 and p99, each
 * labelled at its end. The tail runs far above the average, so the axis is
 * logarithmic by default, on the given ticks; linear, it starts at zero and
 * steps by the smallest given tick that needs at most six steps.
 */
export function MonthlyLines({
	months,
	format,
	ticks: candidateTicks,
	description,
	axisTitle,
	tickRoom = 0,
	log = true,
}: {
	readonly months: readonly MonthlyPoint[];
	readonly format: (value: number) => string;
	/** Tick candidates, ascending; the axis spans the data. */
	readonly ticks: readonly number[];
	/** What the lines measure, for the plot's accessible name. */
	readonly description: string;
	readonly axisTitle?: string;
	/** The scatter's room for tick labels (none in its insight views). */
	readonly tickRoom?: number;
	readonly log?: boolean;
}) {
	const count = months.length;
	const [activeIndex, setActiveIndex] = useState<number | null>(null);
	const x = (index: number) => (count > 1 ? (index / (count - 1)) * 100 : 50);
	const at = useGlide(x(activeIndex ?? count - 1) / 100);
	const lastReadout = useRef<MonthlyPoint | null>(null);
	if (activeIndex !== null) lastReadout.current = months[activeIndex] ?? null;
	const readout = lastReadout.current;
	if (count === 0)
		return <p className="trends-empty">No complete months yet.</p>;

	const low = Math.min(...months.map((month) => month.mean));
	const high = Math.max(...months.map((month) => month.p99));
	const { ticks, y } = log
		? logAxis(candidateTicks, low, high)
		: linearAxis(candidateTicks, high);
	const hovering = activeIndex !== null;
	const inspected = months[activeIndex ?? count - 1];

	const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		const ratio = (event.clientX - rect.left) / (rect.width || 1);
		setActiveIndex(
			Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1)))),
		);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		const delta = event.key === "ArrowLeft" ? -1 : 1;
		setActiveIndex(
			Math.min(count - 1, Math.max(0, (activeIndex ?? count - 1) + delta)),
		);
	};
	const clear = () => setActiveIndex(null);

	return (
		<div
			className="trends-plot-frame trends-timeline-frame"
			data-plot-box="true"
			style={{ "--tick-room": `${tickRoom}px` } as CSSProperties}
		>
			<div className="trends-plot-y" aria-hidden="true">
				{ticks.map((tick) => (
					<span key={tick} style={{ "--at": `${y(tick)}%` } as CSSProperties}>
						{format(tick)}
					</span>
				))}
			</div>
			<div
				className="trends-plot trends-timeline-plot"
				onPointerLeave={clear}
				style={{ "--line": LINE_COLOR } as CSSProperties}
			>
				{ticks.map((tick) => (
					<span
						key={tick}
						className="trends-plot-gridline"
						style={{ "--at": `${y(tick)}%` } as CSSProperties}
						aria-hidden="true"
					/>
				))}
				<svg
					className="trends-share-svg trends-timeline-svg"
					viewBox="0 0 100 100"
					preserveAspectRatio="none"
					aria-hidden="true"
				>
					{/* Paths of one shape, so a change of scale glides them. */}
					{SERIES.map((series) => {
						const d = `M${months
							.map((month, index) => `${x(index)},${y(series.value(month))}`)
							.join("L")}`;
						return (
							<motion.path
								key={series.id}
								className="trends-timeline-line"
								data-series={series.id}
								initial={false}
								animate={{ d }}
								transition={RESCALE}
							/>
						);
					})}
				</svg>
				{/* A dot on every month of every line, and each line's name and
				    latest figure at its end. */}
				{/* On the lines' glide, so a change of scale moves them as one. */}
				{SERIES.map((series) =>
					months.map((month, index) => (
						<motion.span
							key={`${series.id}-${month.monthStart}`}
							className="trends-timeline-dot"
							data-series={series.id}
							data-active={hovering && index === activeIndex}
							style={{ "--x": `${x(index)}%` } as CSSProperties}
							initial={false}
							animate={{ top: `${y(series.value(month))}%` }}
							transition={RESCALE}
							aria-hidden="true"
						/>
					)),
				)}
				{SERIES.map((series) => {
					const last = months[count - 1];
					return last ? (
						<motion.span
							key={`${series.id}-label`}
							className="trends-timeline-label"
							data-series={series.id}
							initial={false}
							animate={{ top: `${y(series.value(last))}%` }}
							transition={RESCALE}
							aria-hidden="true"
						>
							{series.label} <strong>{format(series.value(last))}</strong>
						</motion.span>
					) : null;
				})}
				<span
					className="trends-crosshair trends-hover-line"
					data-shown={hovering}
					style={{ "--at": `${at * 100}%` } as CSSProperties}
					aria-hidden="true"
				/>
				<button
					type="button"
					className="trends-plot-hit"
					aria-label={`${description} month by month: average, p95 and p99. Use the left and right arrow keys to step through months.`}
					onPointerMove={onPointerMove}
					onKeyDown={onKeyDown}
					onBlur={clear}
				/>
				{readout ? (
					<section
						className="trends-compare trends-share-readout"
						aria-label="Hovered month"
						aria-live="polite"
						aria-hidden={!hovering}
						data-open={hovering}
					>
						<table>
							<thead>
								<tr>
									<td />
									<th scope="col">{formatMonth(readout.monthStart)}</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<th scope="row">Average</th>
									<td>{format(readout.mean)}</td>
								</tr>
								<tr>
									<th scope="row">p95</th>
									<td>{format(readout.p95)}</td>
								</tr>
								<tr>
									<th scope="row">p99</th>
									<td>{format(readout.p99)}</td>
								</tr>
								<tr>
									<th scope="row">Agent runs</th>
									<td>{formatCompact(readout.runs)}</td>
								</tr>
							</tbody>
						</table>
					</section>
				) : null}
			</div>
			<div className="trends-plot-x" aria-hidden="true">
				{[0, Math.floor((count - 1) / 2), count - 1].map((index) => (
					<span
						key={index}
						data-faded={hovering}
						style={{ "--at": `${x(index)}%` } as CSSProperties}
					>
						{formatMonth(months[index]?.monthStart ?? "")}
					</span>
				))}
				<span
					className="trends-plot-x-hover"
					data-shown={hovering}
					style={{ "--at": `${at * 100}%` } as CSSProperties}
				>
					{formatMonth(inspected?.monthStart ?? "")}
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

/** From the largest candidate under the lowest average to the first over
 * the highest p99, on a log scale. */
function logAxis(candidates: readonly number[], low: number, high: number) {
	const floor =
		[...candidates].reverse().find((tick) => tick <= low * 0.8) ??
		candidates[0] ??
		1;
	const ceiling =
		candidates.find((tick) => tick >= high) ?? candidates.at(-1) ?? high;
	const span = Math.log(ceiling) - Math.log(floor) || 1;
	return {
		ticks: candidates.filter((tick) => tick >= floor && tick <= ceiling),
		y: (value: number) =>
			100 -
			Math.min(
				100,
				Math.max(
					0,
					((Math.log(Math.max(value, floor)) - Math.log(floor)) / span) * 100,
				),
			),
	};
}

/** From zero past the highest p99, in even steps of a candidate tick. */
function linearAxis(candidates: readonly number[], high: number) {
	const step =
		candidates.find((tick) => Math.ceil(high / tick) <= 6) ??
		candidates.at(-1) ??
		high;
	const ceiling = Math.max(step, Math.ceil(high / step) * step);
	return {
		ticks: Array.from(
			{ length: Math.round(ceiling / step) + 1 },
			(_, index) => index * step,
		),
		y: (value: number) =>
			100 - Math.min(100, Math.max(0, (value / ceiling) * 100)),
	};
}
