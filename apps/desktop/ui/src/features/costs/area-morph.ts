// Animates a Recharts chart's own area paths from a recorded starting line
// (the loading heartbeat) into whatever Recharts has drawn for the real data.
// Recharts' built-in animation pairs points by index and restarts whenever the
// chart re-lays out, so instead each frame rewrites the `d` of the real
// `<path>`s, re-reading Recharts' latest geometry as the target. The last
// frame restores Recharts' exact paths, so nothing swaps at the end.

type Point = readonly [number, number];

/** A drawn area: its line and the baseline its fill closes on. */
export type AreaShape = { line: Point[]; base: number };

// Advance at most this much per frame, so a long frame (the dashboard
// rendering around the chart) slows the morph down instead of skipping it.
const MAX_STEP_MS = 34;

/** The first area as drawn in `root` right now. */
export function readAreaShape(root: Element): AreaShape | null {
	const area = root.querySelector(".recharts-area");
	const line = area?.querySelector(".recharts-area-curve")?.getAttribute("d");
	const fill = area?.querySelector(".recharts-area-area")?.getAttribute("d");
	if (!line) return null;
	const points = segments(line).flat();
	if (points.length < 2) return null;
	return {
		line: points.sort((a, b) => a[0] - b[0]),
		base: Math.max(...parsePoints(fill ?? line).map(([, y]) => y)),
	};
}

/**
 * Morphs every area in `root` from `from` to its current geometry over
 * `duration`, starting on the next frame (`onStart` runs just before it is
 * painted). `onFrame` gets each frame's eased progress, for anything that
 * should move in step. Returns a cancel function.
 */
export function morphAreas(
	root: Element,
	from: AreaShape,
	duration: number,
	callbacks: {
		onStart?: () => void;
		onFrame?: (progress: number) => void;
		onDone: () => void;
	},
): () => void {
	// What this morph last wrote, so a different `d` means Recharts redrew.
	const written = new WeakMap<Element, string>();
	const targets = new WeakMap<
		Element,
		{ line: string; fill: string; segments: Point[][]; base: number }
	>();
	let elapsed = 0;
	let last = 0;
	let frame = 0;

	const draw = (progress: number) => {
		const shape = easeInOutCubic(progress);
		callbacks.onFrame?.(shape);
		for (const area of root.querySelectorAll(".recharts-area")) {
			const curve = area.querySelector(".recharts-area-curve");
			const fill = area.querySelector(".recharts-area-area");
			if (!curve) continue;
			const current = curve.getAttribute("d") ?? "";
			let target = targets.get(curve);
			if (!target || current !== written.get(curve)) {
				// First sight, or Recharts redrew: its path is the target now.
				const fillD = fill?.getAttribute("d") ?? "";
				target = {
					line: current,
					fill: fillD,
					segments: segments(current).map((points) =>
						points.sort((a, b) => a[0] - b[0]),
					),
					base: Math.max(...parsePoints(fillD || current).map(([, y]) => y)),
				};
				targets.set(curve, target);
			}
			if (progress >= 1) {
				curve.setAttribute("d", target.line);
				if (fill) fill.setAttribute("d", target.fill);
				continue;
			}
			const base = lerp(from.base, target.base, shape);
			const lines = target.segments.map((points) =>
				resample(from.line, points).map(
					([x, start, end]) => [x, lerp(start, end, shape)] as const,
				),
			);
			const lineD = lines.map(toPath).join(" ");
			const fillD = lines
				.map((points) => {
					const first = points[0]?.[0] ?? 0;
					const lastX = points.at(-1)?.[0] ?? 0;
					return `${toPath(points)} L ${lastX} ${base} L ${first} ${base} Z`;
				})
				.join(" ");
			curve.setAttribute("d", lineD);
			written.set(curve, lineD);
			fill?.setAttribute("d", fillD);
		}
	};

	const tick = (now: number) => {
		elapsed += Math.min(now - last, MAX_STEP_MS);
		last = now;
		const progress = Math.min(1, elapsed / duration);
		draw(progress);
		if (progress < 1) frame = requestAnimationFrame(tick);
		else callbacks.onDone();
	};

	draw(0);
	frame = requestAnimationFrame((now) => {
		callbacks.onStart?.();
		draw(0);
		last = now;
		frame = requestAnimationFrame(tick);
	});
	return () => cancelAnimationFrame(frame);
}

/**
 * Both lines on the x positions of either within `points`' span, as
 * [x, from y, to y], so each keeps its exact vertices.
 */
function resample(from: readonly Point[], points: readonly Point[]) {
	const left = points[0]?.[0] ?? 0;
	const right = points.at(-1)?.[0] ?? 0;
	const xs = [
		...new Set([
			...points.map(([x]) => x),
			...from.map(([x]) => x).filter((x) => x > left && x < right),
		]),
	].sort((a, b) => a - b);
	return xs.map((x) => [x, sampleY(from, x), sampleY(points, x)] as const);
}

/** The subpaths of an `M … L … M …` path, as point lists. */
function segments(d: string): Point[][] {
	return d
		.split(/(?=M)/)
		.map(parsePoints)
		.filter((points) => points.length > 0);
}

function parsePoints(d: string): Point[] {
	const numbers = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
	const points: Point[] = [];
	for (let index = 0; index + 1 < numbers.length; index += 2) {
		points.push([numbers[index] ?? 0, numbers[index + 1] ?? 0]);
	}
	return points;
}

/** The height at `x` of points sorted by x, held flat past either end. */
function sampleY(points: readonly Point[], x: number) {
	const first = points[0];
	const last = points.at(-1);
	if (!first || !last) return 0;
	if (x <= first[0]) return first[1];
	if (x >= last[0]) return last[1];
	let low = 0;
	let high = points.length - 1;
	while (high - low > 1) {
		const middle = (low + high) >> 1;
		if ((points[middle]?.[0] ?? 0) <= x) low = middle;
		else high = middle;
	}
	const [x0, y0] = points[low] ?? first;
	const [x1, y1] = points[high] ?? last;
	return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

function toPath(points: readonly Point[]) {
	return points
		.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x},${y}`)
		.join("");
}

function lerp(from: number, to: number, progress: number) {
	return from + (to - from) * progress;
}

function easeInOutCubic(progress: number) {
	return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}
