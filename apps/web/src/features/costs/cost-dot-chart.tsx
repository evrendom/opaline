import {
	type CSSProperties,
	createContext,
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent,
	type ReactNode,
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import "./cost-dot-chart.css";
import { Bones } from "@/app/ui/bones";
import { OPALINE_OUTLINE } from "@/features/shell/components/shell-nav-icon";
import type { ChartInterval, groupChartTrend } from "./chart-interval";
import {
	type CalendarFit,
	columnLabel,
	fitCalendar,
	LABEL_PX,
	labelWidth,
	nearestSlot,
	ROW_LABEL_LEFT_PX,
	rowLabel,
	SPACING,
	slotKey,
	slotLabel,
	slotPlace,
	slotRowLabel,
	weekday,
} from "./cost-dot-calendar";
import { pebbleMasks } from "./cost-dot-pebble";
import { useDotPick, useHoverDateStore } from "./cost-hover-date";
import { RollingText } from "./cost-rolling-text";

type ChartPoint = ReturnType<typeof groupChartTrend>[number];

export const DotHighlightContext = createContext<ReadonlySet<string> | null>(
	null,
);

export const DotMarkContext = createContext<string | null>(null);

export const DotFocusContext = createContext<string | null>(null);

export const DotLoadingContext = createContext(false);

export const DotFocusDaysContext = createContext<ReadonlySet<string> | null>(
	null,
);

const lights = (days: ReadonlySet<string>, point: ChartPoint) => {
	for (const day of days)
		if (day >= point.startDate && day <= point.endDate) return true;
	return false;
};

const LEVELS = [0, 0.28, 0.5, 0.74, 1];
const LONG_DAILY_DAYS = 120;
const HOVER_GRACE_MS = 80;

function useBoxSize(fit: boolean) {
	const ref = useRef<HTMLDivElement>(null);
	const [box, setBox] = useState<{ width: number; height: number } | null>(
		null,
	);
	useLayoutEffect(() => {
		const area = ref.current?.parentElement;
		if (!fit || !area) return;
		const read = () => {
			const rect = area.getBoundingClientRect();
			const cap = Number.parseFloat(getComputedStyle(area).maxHeight);
			const width = Math.floor(rect.width);
			const height = Math.floor(Number.isFinite(cap) ? cap : rect.height);
			setBox((current) =>
				current && current.width === width && current.height === height
					? current
					: { width, height },
			);
		};
		read();
		const observer = new ResizeObserver(read);
		observer.observe(area);
		return () => observer.disconnect();
	}, [fit]);
	return [ref, box] as const;
}

const levelOf = (value: number, max: number) =>
	value <= 0 || max <= 0
		? 0
		: Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));

const short = (date: string, interval: ChartInterval) =>
	new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
		day: interval === "daily" || interval === "weekly" ? "numeric" : undefined,
		month: "short",
		timeZone: "UTC",
	});

type AxisLabel = {
	key: string;
	text: string;
	at: number;
	end?: boolean;
	rolling?: boolean;
	span?: number;
	selected?: boolean;
	note?: string;
	faded?: boolean;
	hidden?: boolean;
};

type Selection = { first: number; last: number } | null;

function extentOf(mark: AxisLabel, span: number): [number, number] {
	const width = labelWidth(mark.text);
	if (mark.rolling) {
		const left = Math.min(Math.max(0, mark.at - width / 2), span - width);
		return [left, left + width];
	}
	return mark.end
		? [span - mark.at - width, span - mark.at]
		: [mark.at, mark.at + width];
}

function settle(idle: AxisLabel[], hover: AxisLabel | null, span: number) {
	if (!hover) return idle;
	const [from, to] = extentOf(hover, span);
	return [
		...idle.map((mark) => {
			const [start, end] = extentOf(mark, span);
			const clash = start < to + 4 && end > from - 4;
			return { ...mark, faded: true, hidden: clash };
		}),
		hover,
	];
}

function xLabels(
	fit: CalendarFit,
	interval: ChartInterval,
	hovered: number | null,
	selection: Selection,
	current: number | null,
): AxisLabel[] {
	const pitch = fit.size + fit.gap;
	const span = fit.columns * pitch - fit.gap + 2 * fit.inset;
	const daily = interval === "daily";
	const idle: AxisLabel[] = [];
	if (interval === "weekly" && selection) {
		idle.push({
			key: "selection-first",
			text: slotLabel(fit, interval, selection.first),
			at: fit.inset,
			selected: true,
		});
		idle.push({
			key: "selection-last",
			text: slotLabel(fit, interval, selection.last),
			at: fit.inset,
			end: true,
			selected: true,
		});
	} else if (daily && selection) {
		const start = slotPlace(fit, selection.first).column;
		const finish = slotPlace(fit, selection.last).column;
		const first: AxisLabel = {
			key: "selection-first",
			text: slotLabel(fit, interval, selection.first),
			at: fit.inset + start * pitch,
			selected: true,
		};
		const last: AxisLabel = {
			key: "selection-last",
			text: slotLabel(fit, interval, selection.last),
			at: span - (fit.inset + finish * pitch + fit.size),
			end: true,
			selected: true,
		};
		idle.push(first);
		if (
			finish > start &&
			extentOf(last, span)[0] > extentOf(first, span)[1] + 6
		)
			idle.push(last);
	} else {
		idle.push({
			key: "first",
			text: columnLabel(fit, interval, 0),
			at: fit.inset,
		});
		if (fit.columns > 1)
			idle.push({
				key: "last",
				text: columnLabel(fit, interval, fit.columns - 1),
				at: fit.inset,
				end: true,
			});
	}
	const hover: AxisLabel | null =
		hovered === null
			? null
			: {
					key: "hover",
					text:
						hovered === current
							? `Current · ${slotLabel(fit, interval, hovered)}`
							: slotLabel(fit, interval, hovered),
					at: fit.inset + slotPlace(fit, hovered).column * pitch + fit.size / 2,
					rolling: true,
					span,
				};
	return settle(idle, hover, span);
}

function yLabels(
	fit: CalendarFit,
	interval: ChartInterval,
	hovered: number | null,
	current: number | null,
): AxisLabel[] {
	const pitch = fit.size + fit.gap;
	const topOf = (row: number) =>
		fit.inset + row * pitch + (fit.size - LABEL_PX) / 2;
	const idle = (fit.rows > 1 ? [0, fit.rows - 1] : [0]).map((row) => ({
		key: `edge-${row}`,
		text: rowLabel(fit, interval, row),
		at: topOf(row),
	}));
	if (hovered === null) return idle;
	const row = slotPlace(fit, hovered).row;
	const at = topOf(row);
	const note =
		interval === "weekly" && hovered === current ? "Current" : undefined;
	const reach = note ? 2 * LABEL_PX : LABEL_PX;
	return [
		...idle.map((mark) => ({
			...mark,
			faded: true,
			hidden: mark.at > at - reach - 2 && mark.at < at + LABEL_PX + 2,
		})),
		{
			key: "hover",
			text: slotRowLabel(fit, interval, hovered),
			at,
			rolling: true,
			note,
		},
	];
}

function Axis({
	axis,
	direction,
	marks,
}: {
	axis: "x" | "y";
	direction: 1 | -1;
	marks: AxisLabel[];
}) {
	return (
		<div className="cost-dot-axis" data-axis={axis} aria-hidden="true">
			{marks.map((mark) => (
				<div
					key={mark.key}
					data-end={mark.end || undefined}
					data-rolling={mark.rolling || undefined}
					data-hover={mark.key === "hover" || undefined}
					data-selected={mark.selected || undefined}
					data-faded={mark.faded || undefined}
					data-hidden={mark.hidden || undefined}
					style={
						{
							"--axis-at": `${mark.at}px`,
							"--axis-span": mark.span ? `${mark.span}px` : undefined,
						} as CSSProperties
					}
				>
					{mark.note ? (
						<span className="cost-dot-axis-note">{mark.note}</span>
					) : null}
					{mark.rolling ? (
						<RollingText text={mark.text} direction={direction} />
					) : (
						mark.text
					)}
				</div>
			))}
		</div>
	);
}

export function CostDotChart({
	color,
	fit = false,
	format,
	interval,
	label,
	loading: loadingPoints = false,
	points,
}: {
	color: string;
	fit?: boolean;
	format: (value: number) => string;
	interval: ChartInterval;
	label: string;
	loading?: boolean;
	points: readonly ChartPoint[];
}) {
	const railLoading = useContext(DotLoadingContext);
	const loading = loadingPoints || railLoading;
	const [boxRef, box] = useBoxSize(fit);
	const [hovered, setHovered] = useState<number | null>(null);
	const [direction, setDirection] = useState<1 | -1>(1);
	const [trail, setTrail] = useState<number | null>(null);
	if (hovered !== null && trail !== hovered) setTrail(hovered);
	const highlight = useContext(DotHighlightContext);
	const mark = useContext(DotMarkContext);
	const focus = useContext(DotFocusContext);
	const focusDays = useContext(DotFocusDaysContext);
	const max = Math.max(0, ...points.map((point) => point.total));
	const daily = interval === "daily";
	const first = points[0]?.date;
	const last = points.at(-1)?.date;
	const inner = useMemo(
		() =>
			box
				? {
						width: box.width - SPACING.left - SPACING.right,
						height: box.height - SPACING.top - SPACING.bottom,
					}
				: null,
		[box],
	);
	const fitted = useMemo(
		() =>
			fit && inner && first && last
				? fitCalendar(interval, first, last, inner)
				: null,
		[inner, fit, interval, first, last],
	);
	const byDate = useMemo(
		() => new Map(points.map((point) => [point.date, point])),
		[points],
	);
	const slots = useMemo(
		() =>
			fitted
				? Array.from({ length: fitted.rows * fitted.columns }, (_, slot) => {
						const key = slotKey(fitted, interval, slot);
						return { slot, point: key ? byDate.get(key) : undefined };
					})
				: [],
		[fitted, interval, byDate],
	);
	const selection = useMemo(() => {
		const held = slots.filter((each) => each.point);
		const head = held[0];
		const tail = held.at(-1);
		return head && tail ? { first: head.slot, last: tail.slot } : null;
	}, [slots]);
	const pickedDate = useDotPick()?.picked?.date;
	const currentSlot = useMemo(() => {
		if (mark === null) return null;
		const found = slots.find(
			({ point }) => point && mark >= point.startDate && mark <= point.endDate,
		);
		return found ? found.slot : null;
	}, [slots, mark]);
	const pickedSlot = useMemo(() => {
		if (!pickedDate) return null;
		const found = slots.find((each) => each.point?.date === pickedDate);
		return found ? found.slot : null;
	}, [slots, pickedDate]);
	const litSlots = useMemo(
		() =>
			new Set(
				highlight
					? slots
							.filter(({ point }) => point && lights(highlight, point))
							.map(({ slot }) => slot)
					: [],
			),
		[slots, highlight],
	);
	const pebbleSize = fitted?.size;
	const pebbles = useMemo(
		() => (pebbleSize ? pebbleMasks(pebbleSize) : undefined),
		[pebbleSize],
	);
	const lead = daily && first ? weekday(first) : 0;
	const rows = fitted
		? fitted.rows
		: daily
			? points.length > LONG_DAILY_DAYS
				? 14
				: 7
			: 1;
	const columns = fitted
		? fitted.columns
		: daily
			? Math.ceil((lead + points.length) / rows)
			: points.length;
	const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
	const hoverDates = useHoverDateStore();
	const picker = useDotPick();
	const pickSlot = (slot: number) => {
		const point = slots[slot]?.point;
		if (!picker || !point) return;
		picker.pick(
			picker.picked?.date === point.date
				? null
				: { date: point.date, end: point.endDate },
		);
	};
	const onClick = (event: MouseEvent<HTMLButtonElement>) => {
		if (!fitted) return;
		if (event.detail === 0) {
			if (hovered !== null) pickSlot(hovered);
			return;
		}
		const rect = event.currentTarget.getBoundingClientRect();
		pickSlot(
			nearestSlot(fitted, event.clientX - rect.left, event.clientY - rect.top),
		);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (!fitted) return;
		const step = {
			ArrowUp: [0, -1],
			ArrowDown: [0, 1],
			ArrowLeft: [-1, 0],
			ArrowRight: [1, 0],
		}[event.key];
		if (!step) return;
		event.preventDefault();
		const from = hovered ?? selection?.last ?? 0;
		const place = slotPlace(fitted, from);
		const column = Math.min(
			fitted.columns - 1,
			Math.max(0, place.column + (step[0] ?? 0)),
		);
		const row = Math.min(
			fitted.rows - 1,
			Math.max(0, place.row + (step[1] ?? 0)),
		);
		const next =
			fitted.flow === "column"
				? column * fitted.rows + row
				: row * fitted.columns + column;
		setDirection(next >= from ? 1 : -1);
		setHovered(next);
		hoverDates?.set(slotKey(fitted, interval, next));
	};
	const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
		if (!fitted) return;
		if (leaving.current) clearTimeout(leaving.current);
		leaving.current = null;
		const rect = event.currentTarget.getBoundingClientRect();
		const next = nearestSlot(
			fitted,
			event.clientX - rect.left,
			event.clientY - rect.top,
		);
		if (hovered !== null && next !== hovered)
			setDirection(next > hovered ? 1 : -1);
		hoverDates?.set(slotKey(fitted, interval, next));
		setHovered((current) => (current === next ? current : next));
	};
	const onPointerLeave = () => {
		if (leaving.current) clearTimeout(leaving.current);
		leaving.current = setTimeout(() => {
			setHovered(null);
			hoverDates?.set(null);
		}, HOVER_GRACE_MS);
	};
	const dot = (
		point: ChartPoint,
		slot: number | null,
		style?: CSSProperties,
	) => {
		const level = levelOf(point.total, max);
		const current =
			mark !== null && mark >= point.startDate && mark <= point.endDate;
		const muted =
			focus !== null
				? focus < point.startDate || focus > point.endDate
				: focusDays !== null && !lights(focusDays, point);
		return (
			<span
				key={slot ?? undefined}
				className="cost-dot"
				skullet-block={loading ? "" : undefined}
				data-hovered={(slot !== null && hovered === slot) || undefined}
				data-empty={level === 0 || undefined}
				data-lit={(highlight !== null && lights(highlight, point)) || undefined}
				data-picked={picker?.picked?.date === point.date || undefined}
				data-muted={muted || undefined}
				title={`${current ? "Current · " : ""}${short(point.startDate, interval)} · ${format(point.total)} ${label.toLowerCase()}`}
				style={
					{
						...style,
						"--dot-level": level === 0 || muted ? undefined : LEVELS[level],
					} as CSSProperties
				}
			>
				{current ? <span className="cost-dot-mark" /> : null}
			</span>
		);
	};
	return (
		<div
			ref={boxRef}
			className="cost-dot-chart"
			aria-busy={loading || undefined}
			data-daily={daily || undefined}
			data-loading={loading || undefined}
			data-fit={fitted ? true : undefined}
			data-small={(fitted && fitted.size < 10) || undefined}
			style={
				{
					"--dot-color": color,
					"--dot-columns": columns,
					"--dot-rows": rows,
					...pebbles,
				} as CSSProperties
			}
		>
			{fitted && inner ? (
				<FrameBones loading={loading}>
					<div
						className="cost-dot-frame"
						style={
							{
								"--row-label-left": `${ROW_LABEL_LEFT_PX}px`,
								width: inner.width,
								height:
									fitted.strip +
									fitted.rows * (fitted.size + fitted.gap) -
									fitted.gap +
									2 * fitted.inset,
								margin: `${SPACING.top}px ${SPACING.right}px ${SPACING.bottom}px ${SPACING.left}px`,
								gridTemplateColumns: `${fitted.gutter}px auto`,
								gridTemplateRows: `${fitted.strip}px auto`,
								placeContent: "center",
							} as CSSProperties
						}
					>
						<Axis
							axis="x"
							direction={direction}
							marks={xLabels(
								fitted,
								interval,
								hovered ?? pickedSlot,
								selection,
								currentSlot,
							)}
						/>
						<Axis
							axis="y"
							direction={direction}
							marks={yLabels(
								fitted,
								interval,
								hovered ?? pickedSlot,
								currentSlot,
							)}
						/>
						<button
							type="button"
							className="cost-dot-grid"
							style={
								{
									"--dot-cell": `${fitted.size}px`,
									gridArea: "2 / 2",
									gridTemplateColumns: `repeat(${fitted.columns}, ${fitted.size}px)`,
									gridTemplateRows: `repeat(${fitted.rows}, ${fitted.size}px)`,
									gridAutoFlow: fitted.flow,
									gap: `${fitted.gap}px`,
									padding: `${fitted.inset}px`,
								} as CSSProperties
							}
							onPointerMove={onPointerMove}
							onPointerLeave={onPointerLeave}
							onClick={onClick}
							onKeyDown={onKeyDown}
							onBlur={onPointerLeave}
							aria-label={`${label} by ${interval === "daily" ? "day" : interval.replace("ly", "")}`}
							data-pickable={picker ? true : undefined}
						>
							{loading ? null : (
								<>
									<Halos fit={fitted} lit={litSlots} />
									<Crosshair
										key="lines"
										fit={fitted}
										slot={hovered ?? pickedSlot ?? trail}
										part="lines"
										fading={hovered === null && pickedSlot === null}
									/>
								</>
							)}
							{slots.map(({ slot, point }) =>
								point ? (
									dot(point, slot)
								) : (
									<span
										key={slot}
										className="cost-dot"
										skullet-block={loading ? "" : undefined}
										data-outside=""
										data-hovered={hovered === slot || undefined}
										aria-hidden="true"
									/>
								),
							)}
							{loading ? null : (
								<>
									<Crosshair
										key="pinned"
										fit={fitted}
										slot={pickedSlot}
										part="ring"
										tone="pinned"
									/>
									<Crosshair
										key="hover"
										fit={fitted}
										slot={trail}
										part="ring"
										tone={pickedSlot !== null ? "hover" : "pinned"}
										fading={hovered === null}
									/>
								</>
							)}
						</button>
					</div>
				</FrameBones>
			) : (
				<div className="cost-dot-frame">
					<div className="cost-dot-grid">
						{points.map((point, at) => (
							<div key={point.date} className="cost-dot-cell">
								{dot(
									point,
									null,
									at === 0 && lead ? { gridRowStart: lead + 1 } : undefined,
								)}
								{daily ? null : (
									<span className="cost-dot-label">
										{short(point.startDate, interval)}
									</span>
								)}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

const pebbleBars =
	typeof CSSStyleSheet !== "undefined" &&
	"replaceSync" in CSSStyleSheet.prototype
		? new CSSStyleSheet()
		: null;
pebbleBars?.replaceSync(
	'[skullet-rect][style*="border-radius: 28%"] { border-radius: 0; mask: var(--pebble-fill, none) center / 100% 100% no-repeat; }',
);

function FrameBones({
	children,
	loading,
}: {
	children: ReactNode;
	loading: boolean;
}) {
	const host = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		if (!pebbleBars || !host.current) return;
		for (const layer of host.current.querySelectorAll("[skullet-layer]")) {
			const root = layer.shadowRoot ?? layer.attachShadow({ mode: "open" });
			if (!root.adoptedStyleSheets.includes(pebbleBars))
				root.adoptedStyleSheets = [...root.adoptedStyleSheets, pebbleBars];
		}
	});
	if (!loading) return children;
	return (
		<div ref={host} className="contents">
			<Bones label="Loading the calendar">{children}</Bones>
		</div>
	);
}

function Crosshair({
	fit,
	slot,
	part,
	tone,
	fading = false,
}: {
	fit: CalendarFit;
	slot: number | null;
	part: "lines" | "ring";
	tone?: "pinned" | "hover";
	fading?: boolean;
}) {
	if (slot === null) return null;
	const { column, row } = slotPlace(fit, slot);
	const pitch = fit.size + fit.gap;
	return (
		<span
			className="cost-dot-crosshair"
			data-tone={tone}
			data-fading={fading || undefined}
			aria-hidden="true"
			style={
				{
					"--cross-x": `${fit.inset + column * pitch}px`,
					"--cross-y": `${fit.inset + row * pitch}px`,
					"--cross-size": `${fit.size}px`,
					"--cross-pitch": `${pitch}px`,
					"--cross-inset": `${fit.inset}px`,
					...(part === "lines" ? dashes(fit) : undefined),
				} as CSSProperties
			}
		>
			{part === "ring" ? (
				<span data-part="ring">
					<svg
						viewBox="0 0 1049 1042"
						preserveAspectRatio="none"
						aria-hidden="true"
					>
						<path
							d={OPALINE_OUTLINE}
							fill="none"
							stroke="currentColor"
							strokeWidth={1.5}
							vectorEffect="non-scaling-stroke"
						/>
					</svg>
				</span>
			) : (
				<>
					<span data-part="row" />
					<span data-part="column" />
				</>
			)}
		</span>
	);
}

const LINE_PX = 1.5;

function dashes(fit: CalendarFit): CSSProperties {
	const pitch = fit.size + fit.gap;
	const margin = Math.min(0.75, Math.max(0, (fit.gap - LINE_PX) / 2));
	const length = Math.max(0, fit.gap - 2 * margin);
	const tile = (across: boolean) => {
		const [w, h] = across ? [pitch, LINE_PX] : [LINE_PX, pitch];
		const [x, y, rw, rh] = across
			? [fit.size + margin, 0, length, LINE_PX]
			: [0, fit.size + margin, LINE_PX, length];
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="${x}" y="${y}" width="${rw}" height="${rh}" rx="${LINE_PX / 2}"/></svg>`;
		return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
	};
	return {
		"--cross-dash-x": tile(true),
		"--cross-dash-y": tile(false),
	} as CSSProperties;
}

const HALO_RADIUS = 0.28;

function Halos({ fit, lit }: { fit: CalendarFit; lit: ReadonlySet<number> }) {
	if (lit.size === 0) return null;
	const pitch = fit.size + fit.gap;
	const pad = fit.gap / 2;
	const radius = fit.size * HALO_RADIUS + pad;
	const at = (column: number, row: number) =>
		column < 0 || row < 0 || column >= fit.columns || row >= fit.rows
			? -1
			: fit.flow === "column"
				? column * fit.rows + row
				: row * fit.columns + column;
	return [...lit].map((slot) => {
		const { column, row } = slotPlace(fit, slot);
		const up = lit.has(at(column, row - 1));
		const down = lit.has(at(column, row + 1));
		const left = lit.has(at(column - 1, row));
		const right = lit.has(at(column + 1, row));
		const corner = (a: boolean, b: boolean) => (a || b ? 0 : radius);
		return (
			<span
				key={slot}
				className="cost-dot-halo"
				aria-hidden="true"
				style={
					{
						"--halo-pad": `${pad}px`,
						"--halo-size": `${fit.size}px`,
						left: fit.inset + column * pitch - pad,
						top: fit.inset + row * pitch - pad,
						width: fit.size + 2 * pad,
						height: fit.size + 2 * pad,
						borderRadius: `${corner(up, left)}px ${corner(up, right)}px ${corner(down, right)}px ${corner(down, left)}px`,
					} as CSSProperties
				}
			/>
		);
	});
}
