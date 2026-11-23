import { type ReactNode, useLayoutEffect, useRef } from "react";
import { OPALINE_OUTLINE } from "@/features/shell/components/shell-nav-icon";
import { cn } from "@/lib/utils";
import { Tip } from "./waterfall/session-reader-waterfall-chips";

const TAG_HEIGHT = 20;
const CHIP_SIZE = 16;
const INSET = (TAG_HEIGHT - CHIP_SIZE) / 2;
const VIEW_WIDTH = 1049;
const VIEW_HEIGHT = 1042;
const SCALE = CHIP_SIZE / VIEW_WIDTH;
const SAMPLES_PER_CURVE = 16;

type Point = [number, number];

function outlineCurves(): [Point, Point, Point, Point][] {
	const numbers = (
		OPALINE_OUTLINE.match(/-?\d*\.?\d+(?:e-?\d+)?/giu) ?? []
	).map(Number);
	const curves: [Point, Point, Point, Point][] = [];
	let start: Point = [numbers[0] ?? 0, numbers[1] ?? 0];
	for (let index = 2; index + 5 < numbers.length; index += 6) {
		const [x1, y1, x2, y2, x, y] = numbers.slice(index, index + 6) as [
			number,
			number,
			number,
			number,
			number,
			number,
		];
		curves.push([start, [x1, y1], [x2, y2], [x, y]]);
		start = [x, y];
	}
	return curves;
}

function offsetLeftHalf(offset: number): Point[] {
	const points: Point[] = [];
	for (const [p0, p1, p2, p3] of outlineCurves()) {
		for (let step = 0; step < SAMPLES_PER_CURVE; step++) {
			const t = step / SAMPLES_PER_CURVE;
			const u = 1 - t;
			const x =
				u * u * u * p0[0] +
				3 * u * u * t * p1[0] +
				3 * u * t * t * p2[0] +
				t * t * t * p3[0];
			const y =
				u * u * u * p0[1] +
				3 * u * u * t * p1[1] +
				3 * u * t * t * p2[1] +
				t * t * t * p3[1];
			const dx =
				3 * u * u * (p1[0] - p0[0]) +
				6 * u * t * (p2[0] - p1[0]) +
				3 * t * t * (p3[0] - p2[0]);
			const dy =
				3 * u * u * (p1[1] - p0[1]) +
				6 * u * t * (p2[1] - p1[1]) +
				3 * t * t * (p3[1] - p2[1]);
			const length = Math.hypot(dx, dy) || 1;
			points.push([
				(x - VIEW_WIDTH / 2) * SCALE + (dy / length) * offset,
				(y - VIEW_HEIGHT / 2) * SCALE - (dx / length) * offset,
			]);
		}
	}
	const left = points.filter(([x]) => x < 0);
	return [
		[0, Math.max(...points.map(([, y]) => y))],
		...left,
		[0, Math.min(...points.map(([, y]) => y))],
	];
}

const LEFT_END = offsetLeftHalf(INSET);
const RIGHT_END: Point[] = [...LEFT_END].reverse().map(([x, y]) => [-x, y]);

const format = (value: number) => Number(value.toFixed(2));

function opalTagPath(width: number): string {
	const centre = INSET + CHIP_SIZE / 2;
	const middle = TAG_HEIGHT / 2;
	const right = Math.max(width - centre, centre);
	const points = [
		...RIGHT_END.map(([x, y]): Point => [right + x, middle + y]),
		...LEFT_END.map(([x, y]): Point => [centre + x, middle + y]),
	];
	return `M${points.map(([x, y]) => `${format(x)} ${format(y)}`).join("L")}Z`;
}

export function OpalTag({
	children,
	className,
	onHover,
	title,
	word,
}: {
	children: ReactNode;
	className?: string;
	onHover?: (hovered: boolean) => void;
	title?: string;
	word?: string;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	const outlineRef = useRef<SVGSVGElement>(null);
	const pathRef = useRef<SVGPathElement>(null);
	useLayoutEffect(() => {
		const element = ref.current;
		const outline = outlineRef.current;
		const path = pathRef.current;
		if (!element || !outline || !path) return;
		const draw = () => {
			const width = element.offsetWidth;
			outline.setAttribute("width", String(width));
			outline.setAttribute("viewBox", `0 0 ${width} ${TAG_HEIGHT}`);
			path.setAttribute("d", opalTagPath(width));
		};
		const observer = new ResizeObserver(draw);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const tag = (
		<span
			ref={ref}
			onPointerEnter={onHover ? () => onHover(true) : undefined}
			onPointerLeave={onHover ? () => onHover(false) : undefined}
			className={cn(
				"group/tag relative inline-flex h-5 items-center pr-s pl-xxs text-ink tabular-nums",
				className,
			)}
		>
			<svg
				ref={outlineRef}
				aria-hidden="true"
				height={TAG_HEIGHT}
				// design-escape-ok(shadow): artwork; the opal tag's drop
				className="pointer-events-none absolute top-0 left-0 overflow-visible drop-shadow-[0_0.5px_1px_rgb(0_0_0/0.06)]"
			>
				<path
					ref={pathRef}
					strokeWidth={0.5}
					className="fill-surface stroke-line"
				/>
			</svg>
			<span className="relative inline-flex items-center gap-xs">
				{children}
				{word ? (
					<span className="-ml-xs grid grid-cols-[0fr] transition-[grid-template-columns] duration-(--motion-medium-duration) ease-base group-hover/tag:grid-cols-[1fr]">
						<span className="overflow-hidden whitespace-nowrap">
							{"\u00a0"}
							{word}
						</span>
					</span>
				) : null}
			</span>
		</span>
	);
	return title ? (
		<Tip label={title} side="bottom">
			{tag}
		</Tip>
	) : (
		tag
	);
}
