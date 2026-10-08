import { useId, useLayoutEffect, useRef } from "react";
import { useLatestValueRef } from "@/app/hooks/useLatestValueRef";

type Point = readonly [number, number];
type Curve = {
	points: Point[];
	stroke: string;
	opacity: number;
	width: number;
};
type Fill = { top: number; bottom: number; color: string; base: number };

const DURATION_MS = 750;
// ChartLoadingWave's flow window fades out its outer 35% on each side.
const FLOW_FADE = 0.35;
// A chart may need a frame or two to measure before it draws its curves.
const MAX_WAIT_FRAMES = 12;
// Advance at most this much per frame, so a long frame (the dashboard
// rendering around us) slows the morph down instead of skipping its start.
const MAX_STEP_MS = 34;
const SAMPLES = 240;

/**
 * Turns a ChartLoadingWave into the loaded chart beside it: the flowing line
 * bends into each target line while its window widens to their full range,
 * and its fill eases into the target's, so the swap to the real chart at the
 * end is invisible. Everything is read from the DOM of the parent element,
 * which must be positioned: the wave as it currently flows, and the target
 * lines once they hold still for a frame (a chart may still be measuring).
 * Hide the targets and the wave's flow while this is mounted.
 */
export function ChartMorph({
	wave,
	lines,
	fill,
	onDone,
}: {
	/** Selector for the ChartLoadingWave to start from. */
	wave: string;
	/** Selector for the `<path>`s the line ends as, one per series. */
	lines: string;
	/** Selector for the `<path>` whose gradient fill the wave's fill ends as. */
	fill: string;
	onDone: () => void;
}) {
	const id = useId().replace(/[^\w-]/g, "");
	const svgRef = useRef<SVGSVGElement>(null);
	const onDoneRef = useLatestValueRef(onDone);

	useLayoutEffect(() => {
		const svg = svgRef.current;
		const container = svg?.parentElement;
		const flow = container
			?.querySelector(wave)
			?.querySelector("[data-session-chart-loading-flow]");
		const waveLine = flow?.querySelector<SVGPathElement>("path.fill-none");
		const waveSvg = waveLine?.ownerSVGElement;
		const waveFill = flow?.querySelector<SVGPathElement>(
			"path:not(.fill-none)",
		);
		const group = svg?.querySelector<SVGGElement>("[data-morph-lines]");
		const fillPath = svg?.querySelector<SVGPathElement>("[data-morph-fill]");
		const maskRect = svg?.querySelector<SVGRectElement>("[data-morph-mask]");
		const maskGradient = svg?.querySelector<SVGLinearGradientElement>(
			"[data-morph-mask-gradient]",
		);
		const fillGradient = svg?.querySelector<SVGLinearGradientElement>(
			"[data-morph-fill-gradient]",
		);
		const finish = () => onDoneRef.current();
		if (
			!svg ||
			!container ||
			!flow ||
			!waveSvg ||
			!waveLine ||
			!group ||
			!fillPath ||
			!maskRect ||
			!maskGradient ||
			!fillGradient ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		) {
			finish();
			return;
		}

		const box = container.getBoundingClientRect();
		svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
		const toWave = mapper(waveSvg, box);
		const start = byX(
			parsePolyline(waveLine.getAttribute("d") ?? "").map(toWave),
		);
		const startStroke = getComputedStyle(waveLine).stroke;
		const startOpacity = strokeOpacity(waveLine);
		const startWidth = strokeWidth(waveLine, 2);
		const startFill = readFill(waveFill, box, { top: 0.16, bottom: 0.015 });
		const startBase =
			startFill?.base ?? Math.max(...start.map(([, y]) => y), 0);
		const startFillTop = startFill?.top ?? 0.16;
		const startFillBottom = startFill?.bottom ?? 0.015;
		// Where the flow window is right now (its transform included).
		const flowRect = flow.getBoundingClientRect();
		const windowStart = flowRect.left - box.left;
		const windowEnd = flowRect.right - box.left;
		const fadeStart = FLOW_FADE * (windowEnd - windowStart);
		const startExtent = start.map(([x]) => x);
		const startLeft = Math.min(...startExtent);
		const startRight = Math.max(...startExtent);

		const maskStops = maskGradient.querySelectorAll("stop");
		const fillStops = fillGradient.querySelectorAll("stop");
		let curves: Curve[] | null = null;
		let target: Fill | null = null;
		let drawn: SVGPathElement[] = [addLine(group)];
		let waited = 0;
		let previous = "";
		let elapsed = 0;
		let last = 0;
		let frame = 0;

		const readCurves = (): Curve[] =>
			[...container.querySelectorAll<SVGPathElement>(lines)]
				.map((path) => {
					const owner = path.ownerSVGElement;
					return {
						points: owner
							? byX(
									parsePolyline(path.getAttribute("d") ?? "").map(
										mapper(owner, box),
									),
								)
							: [],
						stroke: getComputedStyle(path).stroke,
						opacity: strokeOpacity(path),
						width: strokeWidth(path, startWidth),
					};
				})
				.filter((curve) => curve.points.length > 1);

		const draw = (progress: number) => {
			// Both ease in, so the first frames still read as the loading wave.
			const shape = easeInOutCubic(progress);
			const reveal = easeInOutCubic(progress);
			const targets = curves ?? [];
			const extent = targets.flatMap((curve) => curve.points.map(([x]) => x));
			const left = Math.min(startLeft, ...extent);
			const right = Math.max(startRight, ...extent);
			const xs = [
				...new Set([
					...Array.from(
						{ length: SAMPLES + 1 },
						(_, index) => left + ((right - left) * index) / SAMPLES,
					),
					...start.map(([x]) => x),
					...extent,
				]),
			].sort((a, b) => a - b);
			const endBase = target?.base ?? startBase;
			const shapes = (targets.length > 0 ? targets : [null]).map((curve) =>
				xs.map((x) => {
					const from = sampleY(start, x);
					const to = !curves
						? from
						: curve
							? sampleY(curve.points, x)
							: endBase;
					return [x, lerp(from, to, shape)] as const;
				}),
			);
			shapes.forEach((points, index) => {
				const line = drawn[index];
				if (!line) return;
				line.setAttribute("d", toPath(points));
				line.setAttribute(
					"stroke-width",
					String(lerp(startWidth, targets[index]?.width ?? startWidth, shape)),
				);
			});

			const first = shapes[0] ?? [];
			const base = lerp(startBase, endBase, shape);
			const firstX = first[0]?.[0] ?? left;
			const lastX = first.at(-1)?.[0] ?? right;
			fillPath.setAttribute(
				"d",
				`${toPath(first)} L ${lastX} ${base} L ${firstX} ${base} Z`,
			);
			// Both gradients span the fill: wave units at the start, the target's
			// bounding box (peak to base) at the end.
			const peak = Math.min(...first.map(([, y]) => y));
			fillGradient.setAttribute(
				"y1",
				String(lerp(startFill?.y1 ?? peak, peak, shape)),
			);
			fillGradient.setAttribute(
				"y2",
				String(lerp(startFill?.y2 ?? base, base, shape)),
			);
			fillStops[0]?.setAttribute(
				"stop-opacity",
				String(lerp(startFillTop, target?.top ?? 0, shape)),
			);
			fillStops[1]?.setAttribute(
				"stop-opacity",
				String(lerp(startFillBottom, target?.bottom ?? 0, shape)),
			);

			// The window opens from wherever the flow was to the lines' extent.
			const open = curves ? reveal : 0;
			const maskStart = lerp(
				windowStart,
				(extent.length > 0 ? Math.min(...extent) : startLeft) - 4,
				open,
			);
			const maskEnd = lerp(
				windowEnd,
				(extent.length > 0 ? Math.max(...extent) : startRight) + 4,
				open,
			);
			const fade = lerp(fadeStart, 0, open) / Math.max(1, maskEnd - maskStart);
			maskGradient.setAttribute("x1", String(maskStart));
			maskGradient.setAttribute("x2", String(maskEnd));
			maskRect.setAttribute("x", String(maskStart));
			maskRect.setAttribute("width", String(Math.max(0, maskEnd - maskStart)));
			maskRect.setAttribute("height", String(box.height));
			maskStops[0]?.setAttribute("stop-opacity", String(open));
			maskStops[1]?.setAttribute("offset", String(fade));
			maskStops[2]?.setAttribute("offset", String(1 - fade));
			maskStops[3]?.setAttribute("stop-opacity", String(open));
			// No lines to land on: settle onto the baseline and fade away.
			svg.style.opacity =
				curves && targets.length === 0 ? String(1 - shape) : "";
		};

		const begin = (found: Curve[]) => {
			curves = found;
			target = readFill(container.querySelector<SVGPathElement>(fill), box, {
				top: 0,
				bottom: 0,
			});
			for (const line of drawn) line.remove();
			// One line per series, in paint order, all starting in the wave's
			// colour so the first frame still looks like the loading state.
			drawn = (found.length > 0 ? found : [null]).map(() => addLine(group));
			for (const line of drawn) {
				line.style.stroke = startStroke;
				line.style.strokeOpacity = String(startOpacity);
			}
			for (const stop of fillStops) {
				stop.style.stopColor = startFill?.color ?? startStroke;
			}
			// Let the starting colours paint before easing to the targets'.
			requestAnimationFrame(() => {
				drawn.forEach((line, index) => {
					line.style.transition = `stroke ${DURATION_MS}ms ease, stroke-opacity ${DURATION_MS}ms ease`;
					line.style.stroke = found[index]?.stroke ?? startStroke;
					line.style.strokeOpacity = String(
						found[index]?.opacity ?? startOpacity,
					);
				});
				for (const stop of fillStops) {
					stop.style.transition = `stop-color ${DURATION_MS}ms ease`;
					stop.style.stopColor =
						target?.color ?? found[0]?.stroke ?? startStroke;
				}
			});
		};

		const tick = (now: number) => {
			if (!curves) {
				// Begin once the lines read the same two frames running.
				const found = readCurves();
				const key = found
					.map((curve) => curve.points.flat().join(","))
					.join("|");
				if (
					(found.length > 0 && key === previous) ||
					++waited > MAX_WAIT_FRAMES
				) {
					begin(found);
					last = now;
				}
				previous = key;
			} else {
				elapsed += Math.min(now - last, MAX_STEP_MS);
				last = now;
			}
			const progress = curves ? Math.min(1, elapsed / DURATION_MS) : 0;
			draw(progress);
			if (progress < 1) frame = requestAnimationFrame(tick);
			else finish();
		};

		for (const line of drawn) {
			line.style.stroke = startStroke;
			line.style.strokeOpacity = String(startOpacity);
		}
		for (const stop of fillStops) {
			stop.style.stopColor = startFill?.color ?? startStroke;
		}
		draw(0);
		frame = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(frame);
			// The lines are added imperatively; drop them so a re-run starts clean.
			for (const line of drawn) line.remove();
		};
	}, [fill, lines, onDoneRef, wave]);

	return (
		<svg
			ref={svgRef}
			className="cost-chart-morph"
			aria-hidden="true"
			preserveAspectRatio="none"
		>
			<defs>
				<linearGradient
					id={`${id}-mask`}
					data-morph-mask-gradient=""
					gradientUnits="userSpaceOnUse"
				>
					<stop offset="0" stopColor="white" stopOpacity={0} />
					<stop offset={FLOW_FADE} stopColor="white" />
					<stop offset={1 - FLOW_FADE} stopColor="white" />
					<stop offset="1" stopColor="white" stopOpacity={0} />
				</linearGradient>
				<mask id={`${id}-window`} maskUnits="userSpaceOnUse">
					<rect data-morph-mask="" y="0" fill={`url(#${id}-mask)`} />
				</mask>
				<linearGradient
					id={`${id}-fill`}
					data-morph-fill-gradient=""
					gradientUnits="userSpaceOnUse"
					x1="0"
					x2="0"
				>
					<stop offset="0" />
					<stop offset="1" />
				</linearGradient>
			</defs>
			<g mask={`url(#${id}-window)`}>
				<path data-morph-fill="" fill={`url(#${id}-fill)`} />
				<g data-morph-lines="" />
			</g>
		</svg>
	);
}

function addLine(group: SVGGElement) {
	const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
	line.setAttribute("fill", "none");
	line.setAttribute("stroke-linecap", "round");
	line.setAttribute("stroke-linejoin", "round");
	group.appendChild(line);
	return line;
}

/**
 * Maps an `<svg>`'s user units to pixels relative to `box`, assuming
 * `preserveAspectRatio="none"` (true of the wave, sparkline and Recharts).
 */
function mapper(owner: SVGSVGElement, box: DOMRect) {
	const rect = owner.getBoundingClientRect();
	const view = owner.viewBox?.baseVal;
	const scaleX = view?.width ? rect.width / view.width : 1;
	const scaleY = view?.height ? rect.height / view.height : 1;
	return ([x, y]: Point): Point => [
		rect.left - box.left + (x - (view?.x ?? 0)) * scaleX,
		rect.top - box.top + (y - (view?.y ?? 0)) * scaleY,
	];
}

/**
 * A fill path's gradient, in pixels relative to `box`: its colour and top and
 * bottom stop opacities, the baseline it closes on, and (for a user-space
 * gradient) the span it covers. A path without a gradient reads as `fallback`.
 */
function readFill(
	path: SVGPathElement | null | undefined,
	box: DOMRect,
	fallback: { top: number; bottom: number },
): (Fill & { y1?: number; y2?: number }) | null {
	const owner = path?.ownerSVGElement;
	if (!path || !owner) return null;
	const toPx = mapper(owner, box);
	const points = parsePolyline(path.getAttribute("d") ?? "").map(toPx);
	const ref = path.getAttribute("fill")?.match(/url\(#(.+)\)/)?.[1];
	const gradient = ref ? document.getElementById(ref) : null;
	const stops = gradient ? [...gradient.querySelectorAll("stop")] : [];
	const first = stops[0];
	const last = stops.at(-1);
	const opacity = (stop: Element | undefined, value: number) =>
		stop ? Number.parseFloat(getComputedStyle(stop).stopOpacity) || 0 : value;
	const userSpace =
		gradient?.getAttribute("gradientUnits") === "userSpaceOnUse";
	return {
		color: first ? getComputedStyle(first).stopColor : "currentColor",
		top: opacity(first, fallback.top),
		bottom: opacity(last, fallback.bottom),
		base: Math.max(...points.map(([, y]) => y)),
		...(userSpace
			? {
					y1: toPx([0, Number(gradient.getAttribute("y1") ?? 0)])[1],
					y2: toPx([0, Number(gradient.getAttribute("y2") ?? 0)])[1],
				}
			: {}),
	};
}

function strokeOpacity(path: SVGPathElement) {
	const value = Number.parseFloat(getComputedStyle(path).strokeOpacity);
	return Number.isFinite(value) ? value : 1;
}

function strokeWidth(path: SVGPathElement, fallback: number) {
	return Number.parseFloat(path.getAttribute("stroke-width") ?? "") || fallback;
}

/** Vertices of an `M x y L x y …` polyline (Recharts' linear curves included). */
function parsePolyline(d: string): Point[] {
	const numbers = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
	const points: Point[] = [];
	for (let index = 0; index + 1 < numbers.length; index += 2) {
		points.push([numbers[index] ?? 0, numbers[index + 1] ?? 0]);
	}
	return points;
}

function byX(points: Point[]) {
	return points.sort((a, b) => a[0] - b[0]);
}

/** The polyline's height at `x` (points sorted by x), held flat past either end. */
function sampleY(sorted: readonly Point[], x: number) {
	const first = sorted[0];
	const last = sorted.at(-1);
	if (!first || !last) return 0;
	if (x <= first[0]) return first[1];
	if (x >= last[0]) return last[1];
	let low = 0;
	let high = sorted.length - 1;
	while (high - low > 1) {
		const middle = (low + high) >> 1;
		if ((sorted[middle]?.[0] ?? 0) <= x) low = middle;
		else high = middle;
	}
	const [x0, y0] = sorted[low] ?? first;
	const [x1, y1] = sorted[high] ?? last;
	return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

function toPath(points: readonly Point[]) {
	return points
		.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
		.join(" ");
}

function lerp(from: number, to: number, progress: number) {
	return from + (to - from) * progress;
}

function easeInOutCubic(progress: number) {
	return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}
