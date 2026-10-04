import { animate } from "motion/react";
import {
	type CSSProperties,
	type KeyboardEvent,
	type PointerEvent,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import {
	formatCompact,
	formatDay,
	formatPercent,
} from "../../trends/trends-format";
import type {
	TrendsHarness,
	TrendsHarnessDay,
	TrendsSnapshot,
} from "../../trends/trends-snapshot";
import { HARNESS_LABELS, TRENDS_HARNESS_COLORS } from "./trends-colors";
import { HarnessMark } from "./trends-marks";
import {
	AnimatedValue,
	prefersReducedMotion,
	useGlide,
	useLiveMotion,
} from "./trends-motion";

export type HarnessMeasure = "runs" | "outputTokens" | "costUsd";
/** Split: each day's two shares as bands. Difference: Claude Code's lead
 * over Codex, in points around Even. */
export type HarnessView = "split" | "difference";

export const HARNESS_MEASURES: readonly {
	readonly id: HarnessMeasure;
	readonly tab: string;
	readonly format: (value: number) => string;
}[] = [
	{ id: "runs", tab: "Agent runs", format: formatCompact },
	{ id: "outputTokens", tab: "Tokens", format: formatCompact },
	{
		id: "costUsd",
		tab: "Est. spend",
		format: (value) => `$${formatCompact(value)}`,
	},
];

/** T3 Code counts sent prompts, not Opaline's agent runs. */
export function harnessMeasures(
	source: TrendsSnapshot["sources"]["harnesses"]["kind"],
): typeof HARNESS_MEASURES {
	return source === "t3_code"
		? HARNESS_MEASURES.map((entry) =>
				entry.id === "runs" ? { ...entry, tab: "Prompts" } : entry,
			)
		: HARNESS_MEASURES;
}

/** The balance's days: the 30-day window without its first day, which T3
 * Code reports only in part. */
export const HARNESS_SHOWN_DAYS = 29;

export interface ReportedBalanceDay {
	readonly day: string;
	readonly claude: number;
	readonly codex: number;
	/** Claude Code's share of the day's total, 0 to 1. */
	readonly share: number;
	/** Claude Code minus Codex share, in percentage points. */
	readonly difference: number;
}

/** A day without a report from both harnesses is a gap, not an even split. */
export type BalanceDay =
	| ReportedBalanceDay
	| {
			readonly day: string;
			readonly claude: null;
			readonly codex: null;
			readonly share: null;
			readonly difference: null;
	  };

export function harnessBalance(
	days: readonly TrendsHarnessDay[],
	measure: HarnessMeasure,
): readonly BalanceDay[] {
	return days.slice(-HARNESS_SHOWN_DAYS).map((day): BalanceDay => {
		const values = day[measure];
		const total = values ? values["claude-code"] + values.codex : 0;
		if (!values || total <= 0)
			return {
				day: day.day,
				claude: null,
				codex: null,
				share: null,
				difference: null,
			};
		const share = values["claude-code"] / total;
		return {
			day: day.day,
			claude: values["claude-code"],
			codex: values.codex,
			share,
			difference: (share - (1 - share)) * 100,
		};
	});
}

function isReported(day: BalanceDay): day is ReportedBalanceDay {
	return day.share !== null;
}

/** A day's Claude Code share at a fraction of the way across, from shares
 * spread evenly over the plot (gaps take the nearest reported day). */
function shareAt(shares: readonly (number | null)[], fraction: number) {
	const reported = shares.flatMap((share, index) =>
		share === null ? [] : [{ index, share }],
	);
	if (reported.length === 0) return 0.5;
	const position = fraction * Math.max(0, shares.length - 1);
	const before = reported.filter((point) => point.index <= position).at(-1);
	const after = reported.find((point) => point.index >= position);
	if (!before || !after) return (before ?? after)?.share ?? 0.5;
	if (before.index === after.index) return before.share;
	const t = (position - before.index) / (after.index - before.index);
	return before.share + (after.share - before.share) * t;
}

/**
 * The shares the chart draws, eased toward the data: a chart switched to
 * swells from an even split, and a new measure or range morphs from the
 * shape on screen (resampled across the plot) instead of redrawing. The
 * first page load paints the data as it is.
 */
function useMorphedShares(target: readonly (number | null)[]) {
	const live = useLiveMotion();
	const [shown, setShown] = useState<readonly (number | null)[]>(() =>
		live.current
			? target.map((share) => (share === null ? null : 0.5))
			: target,
	);
	const current = useRef(shown);
	const entered = useRef(false);
	const key = target.join(",");
	useEffect(() => {
		const goal = key
			.split(",")
			.map((value) => (value === "" ? null : Number(value)));
		const from = current.current;
		const start = goal.map((_, index) =>
			shareAt(from, goal.length > 1 ? index / (goal.length - 1) : 0.5),
		);
		const show = (t: number) => {
			const next = goal.map((share, index) =>
				share === null
					? null
					: (start[index] ?? 0.5) + (share - (start[index] ?? 0.5)) * t,
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
	// A new range has another number of days: until the morph starts, the
	// shape on screen resampled to them, so nothing blinks out.
	return shown.length === target.length
		? shown
		: target.map((share, index) =>
				share === null
					? null
					: shareAt(
							shown,
							target.length > 1 ? index / (target.length - 1) : 0.5,
						),
			);
}

/**
 * How far the chart has turned from split (0) to difference (1). The two
 * views mirror each other about Even, so switching folds the line over it:
 * the split's bands follow the line down onto Even and fade, then the
 * lead's areas grow out of Even with it.
 */
function useViewTurn(view: HarnessView) {
	const live = useLiveMotion();
	const goal = view === "difference" ? 1 : 0;
	const [turn, setTurn] = useState(goal);
	const current = useRef(goal);
	useEffect(() => {
		if (!live.current || prefersReducedMotion()) {
			current.current = goal;
			setTurn(goal);
			return;
		}
		const controls = animate(current.current, goal, {
			duration: 0.75,
			ease: [0.65, 0, 0.35, 1],
			onUpdate: (latest) => {
				current.current = latest;
				setTurn(latest);
			},
		});
		return () => controls.stop();
	}, [goal, live]);
	return turn;
}

/**
 * The inspected day's dot: the leading harness's mark, swapped with a pop
 * when the lead changes. It glides along the boundary itself (its height
 * read off the drawn shares at every step), so it never leaves the line,
 * mid-morph included.
 */
function BalanceDot({
	at,
	shares,
	y,
	leader,
}: {
	/** Where the dot stands across the plot, 0 to 1, as it glides. */
	readonly at: number;
	readonly shares: readonly (number | null)[];
	readonly y: (share: number) => number;
	readonly leader: TrendsHarness;
}) {
	return (
		<span
			className="trends-balance-dot"
			style={
				{
					"--x": `${at * 100}%`,
					"--y": `${y(shareAt(shares, at))}%`,
				} as CSSProperties
			}
			aria-hidden="true"
		>
			{(["claude-code", "codex"] as const).map((harness) => (
				<span
					key={harness}
					className="trends-balance-dot-mark"
					data-shown={harness === leader}
					style={
						{
							"--mark-color": TRENDS_HARNESS_COLORS[harness],
						} as CSSProperties
					}
				>
					<HarnessMark harness={harness} className="trends-balance-dot-svg" />
				</span>
			))}
		</span>
	);
}

export function HarnessBalance({
	days,
	view = "split",
	measure,
	tickRoom = 0,
}: {
	readonly days: readonly BalanceDay[];
	readonly view?: HarnessView;
	/** What the day is split by; the split view shows each side's amount. */
	readonly measure?: (typeof HARNESS_MEASURES)[number];
	/** The scatter's room for tick labels (none in its insight views). */
	readonly tickRoom?: number;
}) {
	const [activeIndex, setActiveIndex] = useState<number | null>(null);
	const clipId = useId();
	const shares = useMorphedShares(
		days.map((day) => (isReported(day) ? day.share : null)),
	);
	const turn = useViewTurn(view);
	const reported = days.filter(isReported);
	const first = reported[0];
	const last = reported.at(-1);
	const active = activeIndex === null ? undefined : days[activeIndex];
	const inspected = active && isReported(active) ? active : last;
	const inspectedIndex = inspected ? days.indexOf(inspected) : 0;
	// The dot, the hover line and the hovered date glide together.
	const at = useGlide(
		days.length > 1 ? inspectedIndex / (days.length - 1) : 0.5,
	);
	if (!first || !inspected) {
		return <p className="trends-empty">No harness observations.</p>;
	}
	const hovering = activeIndex !== null;
	// Both views draw Claude Code's share. Split: its band from the top down
	// to the share, Codex's from there to the foot. Difference: the lead in
	// points (all Claude Code at the top, Even across the middle), the split
	// mirrored about Even. Between them, the line part way over.
	const split = view === "split";
	const x = (index: number) =>
		days.length > 1 ? (index / (days.length - 1)) * 100 : 50;
	const y = (share: number) => share * 100 + turn * (100 - share * 200);
	// Consecutive reported days draw one stretch; a gap day breaks it.
	const stretches: { index: number; share: number }[][] = [];
	days.forEach((day, index) => {
		const share = shares[index];
		if (!isReported(day) || share == null) {
			if (stretches.at(-1)?.length) stretches.push([]);
			return;
		}
		if (stretches.length === 0) stretches.push([]);
		stretches.at(-1)?.push({ index, share });
	});
	const drawn = stretches.filter((stretch) => stretch.length > 0);
	const boundaries = drawn.map((stretch) =>
		stretch.map((point) => `${x(point.index)},${y(point.share)}`),
	);
	// Each fill runs from an edge to the line: the split's bands from the
	// top and the foot (until the line reaches Even), the difference's areas
	// from Even (once it has passed it).
	const fill = (edge: 0 | 50 | 100) =>
		drawn
			.map((stretch, index) => {
				const start = stretch[0]?.index ?? 0;
				const end = stretch.at(-1)?.index ?? start;
				return `M${x(start)},${edge} L${boundaries[index]?.join(" L")} L${x(end)},${edge} Z`;
			})
			.join(" ");
	const folded = turn >= 0.5;
	// Claude Code's share along the axis (the split's edges are the frame).
	const ticks = [0, 0.25, 0.5, 0.75, 1];
	const tickLabel = (share: number, labelView: HarnessView) => {
		const percent = Math.round(share * 100);
		if (labelView === "split") return `${percent}/${100 - percent}`;
		const points = percent * 2 - 100;
		return points === 0
			? "Even"
			: `${points > 0 ? "+" : "−"}${Math.abs(points)}`;
	};
	// Each side's figure: its share of the day (split), or the lead the line
	// shows, in points, from that side (difference).
	const points = (value: number) =>
		`${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)} pp`;
	// Always one decimal, a zero included (64.0%), so the figures keep one
	// shape as they count. Shares count in percent, like the lead in points,
	// so switching views counts from the number on screen.
	const percent = (value: number) => `${value.toFixed(1)}%`;
	const leader: TrendsHarness =
		inspected.difference >= 0 ? "claude-code" : "codex";
	const gaps = days.length - reported.length;

	// No tooltip: hovering moves the dot, and the figures follow it.
	const activate = (index: number) => setActiveIndex(index);
	const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		const ratio = (event.clientX - rect.left) / (rect.width || 1);
		const index = Math.min(
			days.length - 1,
			Math.max(0, Math.round(ratio * (days.length - 1))),
		);
		activate(index);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		const delta = event.key === "ArrowLeft" ? -1 : 1;
		const index = Math.min(
			days.length - 1,
			Math.max(0, (activeIndex ?? days.length - 1) + delta),
		);
		activate(index);
	};
	const clear = () => setActiveIndex(null);

	return (
		<div className="trends-balance">
			<div
				className="trends-plot-frame trends-balance-frame"
				data-plot-box="true"
				style={{ "--tick-room": `${tickRoom}px` } as CSSProperties}
			>
				{/* Both views' labels, the other's faded out, so they cross-fade as
				    the chart turns. */}
				<div className="trends-plot-y" aria-hidden="true">
					{(["split", "difference"] as const).flatMap((labelView) =>
						ticks.map((tick) =>
							labelView === "split" && (tick === 0 || tick === 1) ? null : (
								<span
									key={`${labelView}-${tick}`}
									className="trends-balance-tick"
									style={
										{
											"--at": `${labelView === "split" ? tick * 100 : 100 - tick * 100}%`,
										} as CSSProperties
									}
									data-even={tick === 0.5}
									data-shown={labelView === view}
								>
									{tickLabel(tick, labelView)}
								</span>
							),
						),
					)}
				</div>
				<div className="trends-plot trends-balance-plot" onPointerLeave={clear}>
					{/* Each harness's share of the day, inside its own band:
					    Claude Code at the top, Codex at the foot. */}
					<dl
						className="trends-balance-head"
						// Split: the figures stand on the solid bands.
						data-on-fill={split}
					>
						<div className="trends-balance-side" data-harness="claude-code">
							<dt>
								<HarnessMark harness="claude-code" />
								{HARNESS_LABELS["claude-code"]}
							</dt>
							<dd
								// Difference: the leader's lead in its own colour.
								data-lead={!split && inspected.difference > 0}
								style={
									{
										"--harness-color": TRENDS_HARNESS_COLORS["claude-code"],
									} as CSSProperties
								}
							>
								{split ? (
									<AnimatedValue
										value={inspected.share * 100}
										format={percent}
										from={50}
									/>
								) : (
									<AnimatedValue value={inspected.difference} format={points} />
								)}
							</dd>
							{split && measure ? (
								<dd className="trends-balance-amount">
									<AnimatedValue
										value={inspected.claude}
										format={measure.format}
									/>{" "}
									{measure.tab.toLowerCase()}
								</dd>
							) : null}
						</div>
						<div className="trends-balance-side" data-harness="codex">
							<dt>
								<HarnessMark harness="codex" />
								{HARNESS_LABELS.codex}
							</dt>
							<dd
								data-lead={!split && inspected.difference < 0}
								style={
									{
										"--harness-color": TRENDS_HARNESS_COLORS.codex,
									} as CSSProperties
								}
							>
								{split ? (
									<AnimatedValue
										value={(1 - inspected.share) * 100}
										format={percent}
										from={50}
									/>
								) : (
									<AnimatedValue
										value={-inspected.difference}
										format={points}
									/>
								)}
							</dd>
							{split && measure ? (
								<dd className="trends-balance-amount">
									<AnimatedValue
										value={inspected.codex}
										format={measure.format}
									/>{" "}
									{measure.tab.toLowerCase()}
								</dd>
							) : null}
						</div>
					</dl>
					{ticks.map((tick) => (
						<span
							key={tick}
							className="trends-plot-gridline"
							data-even={tick === 0.5}
							style={{ "--at": `${tick * 100}%` } as CSSProperties}
							aria-hidden="true"
						/>
					))}
					<svg
						className="trends-share-svg trends-balance-svg"
						viewBox="0 0 100 100"
						preserveAspectRatio="none"
						aria-hidden="true"
						style={{ "--turn": turn } as CSSProperties}
					>
						<defs>
							<clipPath id={`${clipId}-claude-code`}>
								<rect x="-5" y="-50" width="110" height="100" />
							</clipPath>
							<clipPath id={`${clipId}-codex`}>
								<rect x="-5" y="50" width="110" height="100" />
							</clipPath>
						</defs>
						{folded ? (
							(["claude-code", "codex"] as const).map((harness) => (
								<path
									key={harness}
									className="trends-balance-area"
									d={fill(50)}
									clipPath={`url(#${clipId}-${harness})`}
									style={
										{
											"--fill": TRENDS_HARNESS_COLORS[harness],
										} as CSSProperties
									}
								/>
							))
						) : (
							<>
								<path
									className="trends-balance-band"
									d={fill(0)}
									style={
										{
											"--fill": TRENDS_HARNESS_COLORS["claude-code"],
										} as CSSProperties
									}
								/>
								<path
									className="trends-balance-band"
									d={fill(100)}
									style={
										{ "--fill": TRENDS_HARNESS_COLORS.codex } as CSSProperties
									}
								/>
								{/* A hairline in the page's colour where the bands meet. */}
								{boundaries.map((points, index) => (
									<polyline
										key={drawn[index]?.[0]?.index}
										className="trends-share-line trends-balance-boundary"
										points={points.join(" ")}
									/>
								))}
							</>
						)}
						{/* The line in the colour of the side of Even it is on,
						    drawing in as the chart turns. */}
						{(["claude-code", "codex"] as const).map((harness) => (
							<g
								key={harness}
								className="trends-balance-lead"
								clipPath={`url(#${clipId}-${harness})`}
							>
								{boundaries.map((points, index) => (
									<polyline
										key={drawn[index]?.[0]?.index}
										className="trends-share-line"
										points={points.join(" ")}
										style={
											{
												"--line-color": TRENDS_HARNESS_COLORS[harness],
											} as CSSProperties
										}
									/>
								))}
							</g>
						))}
					</svg>
					{/* Always shown: the day the figures above report, the last
					    one unless another is hovered. */}
					<span
						className="trends-crosshair trends-hover-line"
						data-shown={hovering}
						style={{ "--at": `${at * 100}%` } as CSSProperties}
						aria-hidden="true"
					/>
					<BalanceDot at={at} shares={shares} y={y} leader={leader} />
					<button
						type="button"
						className="trends-plot-hit"
						aria-label="Each day's agent runs split between Claude Code and Codex. Use the left and right arrow keys to step through days."
						onPointerMove={onPointerMove}
						onKeyDown={onKeyDown}
						onBlur={clear}
					/>
				</div>
				<div className="trends-plot-x" aria-hidden="true">
					{[0, Math.floor((days.length - 1) / 2), days.length - 1].map(
						(index) => (
							<span
								key={index}
								data-faded={hovering}
								style={{ "--at": `${x(index)}%` } as CSSProperties}
							>
								{formatDay(days[index]?.day ?? "")}
							</span>
						),
					)}
					{/* The hovered day's date under its line; the others fade. */}
					<span
						className="trends-plot-x-hover"
						data-shown={hovering}
						style={{ "--at": `${at * 100}%` } as CSSProperties}
					>
						{formatDay(inspected.day)}
					</span>
					{/* Split, the line stays empty but holds its height, so the
					    plot keeps its place. */}
					<p className="trends-plot-title trends-plot-axis-title">
						{split
							? "\u00a0"
							: `Daily difference, Claude Code minus Codex · Even = 50/50 · +20 = 60/40${
									gaps > 0
										? ` · ${gaps} ${gaps === 1 ? "day" : "days"} without both reporting left blank`
										: ""
								}`}
					</p>
				</div>
			</div>
		</div>
	);
}

export function HarnessTable({
	days,
	measure,
	measures = HARNESS_MEASURES,
}: {
	readonly days: readonly BalanceDay[];
	readonly measure: HarnessMeasure;
	readonly measures?: typeof HARNESS_MEASURES;
}) {
	const entry = measures.find((candidate) => candidate.id === measure);
	const format = entry?.format ?? formatCompact;
	return (
		<div className="trends-table-scroll">
			<table className="trends-table">
				<caption className="visually-hidden">
					Daily {entry?.tab ?? "agent runs"} by harness
				</caption>
				<thead>
					<tr>
						<th scope="col">Day</th>
						<th scope="col" data-numeric="true">
							Claude Code
						</th>
						<th scope="col" data-numeric="true">
							Codex
						</th>
						<th scope="col" data-numeric="true">
							Claude Code share
						</th>
						<th scope="col" data-numeric="true">
							Difference
						</th>
					</tr>
				</thead>
				<tbody>
					{days.map((day) =>
						isReported(day) ? (
							<tr key={day.day}>
								<th scope="row">{formatDay(day.day)}</th>
								<td data-numeric="true">{format(day.claude)}</td>
								<td data-numeric="true">{format(day.codex)}</td>
								<td data-numeric="true">{formatPercent(day.share)}</td>
								<td data-numeric="true">
									{day.difference >= 0 ? "+" : "−"}
									{Math.abs(day.difference).toFixed(1)} pp
								</td>
							</tr>
						) : (
							<tr key={day.day}>
								<th scope="row">{formatDay(day.day)}</th>
								<td data-numeric="true" colSpan={4}>
									No report from both harnesses
								</td>
							</tr>
						),
					)}
				</tbody>
			</table>
		</div>
	);
}
