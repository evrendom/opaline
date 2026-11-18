import { motion } from "motion/react";
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import type { TrendsProvider } from "../../trends/trends-snapshot";
import { shortModelName } from "./trends-benchmark-charts";
import { ProviderMark } from "./trends-marks";
import { AnimatedValue, ROW_GLIDE } from "./trends-motion";

export interface RankRow {
	readonly id: string;
	readonly name: string;
	readonly provider: TrendsProvider;
	readonly color?: string;
	readonly value: number;
}

/** Where the rows stand on screen: the list's top, one row's pitch, and
 * the models from the top down; the model list lines its rows up with it. */
export interface RankRowsGeometry {
	readonly top: number;
	readonly right: number;
	readonly pitch: number;
	readonly order: readonly string[];
}

/** About five round steps from zero past the largest value. */
function niceTicks(max: number) {
	if (max <= 0) return [0, 1];
	const rough = max / 5;
	const magnitude = 10 ** Math.floor(Math.log10(rough));
	const step =
		[1, 2, 2.5, 5, 10]
			.map((factor) => factor * magnitude)
			.find((value) => value >= rough) ?? 10 * magnitude;
	const ticks: number[] = [];
	for (let tick = 0; tick < max + step * 0.999; tick += step) ticks.push(tick);
	return ticks;
}

/**
 * A ranking laid on its side: a row per model, least first from the top,
 * its bar running left from zero at the right with the figure at its end,
 * and the scale's vertical lines across every row. The model list beside
 * it names the rows, each at its bar's height; a new order glides both.
 */
export function RankRows({
	rows,
	format,
	axisTitle,
	focusIds,
	onGeometry,
}: {
	readonly rows: readonly RankRow[];
	readonly format: (value: number) => string;
	readonly axisTitle?: string;
	readonly focusIds: ReadonlySet<string>;
	readonly onGeometry?: (geometry: RankRowsGeometry | undefined) => void;
}) {
	const [hovered, setHovered] = useState<string | null>(null);
	const listRef = useRef<HTMLOListElement>(null);
	// Least first from the top.
	const sorted = [...rows].sort((first, second) => first.value - second.value);
	const ticks = niceTicks(Math.max(0, ...sorted.map((row) => row.value)));
	const max = ticks.at(-1) ?? 1;
	const at = (value: number) => `${(value / max) * 100}%`;
	const focusInRows = sorted.some((row) => focusIds.has(row.id));
	// The rows share the list's height evenly (space-around), so each row's
	// middle is the list's top plus half-pitch steps.
	const orderKey = sorted.map((row) => row.id).join(",");
	useLayoutEffect(() => {
		const list = listRef.current;
		if (!list || !onGeometry) return;
		const order = orderKey ? orderKey.split(",") : [];
		const report = () => {
			const rect = list.getBoundingClientRect();
			onGeometry(
				order.length > 0
					? {
							top: rect.top,
							right: rect.right,
							pitch: rect.height / order.length,
							order,
						}
					: undefined,
			);
		};
		report();
		const observer = new ResizeObserver(report);
		observer.observe(list);
		return () => observer.disconnect();
	}, [orderKey, onGeometry]);
	useLayoutEffect(() => () => onGeometry?.(undefined), [onGeometry]);
	return (
		<div className="trends-rank-rows" onPointerLeave={() => setHovered(null)}>
			<div className="trends-rank-rows-plot">
				{ticks.map((tick) => (
					<span
						key={tick}
						className="trends-rank-rows-gridline"
						style={{ "--at-ratio": tick / max } as CSSProperties}
						aria-hidden="true"
					/>
				))}
				<ol ref={listRef} style={{ "--rows": sorted.length } as CSSProperties}>
					{sorted.map((row) => (
						<motion.li
							key={row.id}
							layout="position"
							transition={ROW_GLIDE}
							className="trends-rank-row"
							aria-label={row.name}
							data-dimmed={
								(hovered !== null && hovered !== row.id) ||
								(focusInRows && !focusIds.has(row.id))
							}
							onPointerEnter={() => setHovered(row.id)}
							style={
								{
									"--bar": row.color ?? "var(--color-ink-strong)",
									"--width": at(row.value),
								} as CSSProperties
							}
						>
							{/* Named here only on a phone, where the model list is in
							    its sheet rather than beside the rows. */}
							<span className="trends-rank-row-name" aria-hidden="true">
								<ProviderMark provider={row.provider} />
								{shortModelName(row.name)}
							</span>
							<span className="trends-rank-row-track">
								<span className="trends-rank-row-bar" aria-hidden="true" />
								<span className="trends-rank-row-value">
									<AnimatedValue value={row.value} format={format} />
								</span>
							</span>
						</motion.li>
					))}
				</ol>
			</div>
			<div className="trends-rank-rows-axis" aria-hidden="true">
				{ticks.map((tick) => (
					<span key={tick} style={{ "--at": at(tick) } as CSSProperties}>
						{format(tick)}
					</span>
				))}
			</div>
			{axisTitle ? <p className="trends-rank-rows-title">{axisTitle}</p> : null}
		</div>
	);
}
