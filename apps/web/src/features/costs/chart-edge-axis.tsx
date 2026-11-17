import { useCallback, useState } from "react";
import type { MouseHandlerDataParam, XAxisTickContentProps } from "recharts";

const LABEL_CHAR_PX = 6.2;
const LABEL_GAP_PX = 10;

export interface AxisHover {
	readonly index: number;
	readonly x: number;
}

function labelWidth(label: string): number {
	return label.length * LABEL_CHAR_PX;
}

export function useAxisHover() {
	const [hover, setHover] = useState<AxisHover | null>(null);
	const onMouseMove = useCallback((state: MouseHandlerDataParam) => {
		const index = Number(state.activeTooltipIndex);
		const x = state.activeCoordinate?.x;
		if (!state.isTooltipActive || !Number.isInteger(index) || x === undefined)
			return setHover(null);
		setHover((current) =>
			current?.index === index && current.x === x ? current : { index, x },
		);
	}, []);
	const onMouseLeave = useCallback(() => setHover(null), []);
	return { hover, onMouseMove, onMouseLeave };
}

export function edgeTicks(count: number, hover: AxisHover | null): number[] {
	if (count <= 0) return [];
	const ticks = new Set([0, count - 1]);
	if (hover && hover.index >= 0 && hover.index < count) ticks.add(hover.index);
	return [...ticks];
}

export function EdgeTick({
	tick,
	count,
	hover,
	label,
	inset = 0,
}: {
	tick: XAxisTickContentProps;
	count: number;
	hover: AxisHover | null;
	label: (index: number) => string;
	inset?: number;
}) {
	const index = Number(tick.payload?.value);
	const x = Number(tick.x ?? 0);
	const y = Number(tick.y ?? 0);
	const text = label(index);
	const first = index === 0;
	const last = index === count - 1 && !first;
	const hovered = hover?.index === index;
	if (hover && !hovered) {
		const half = labelWidth(label(hover.index)) / 2;
		const from = first ? x - inset : x + inset - labelWidth(text);
		const to = from + labelWidth(text);
		if (
			from < hover.x + half + LABEL_GAP_PX &&
			to > hover.x - half - LABEL_GAP_PX
		)
			return null;
	}
	const anchor =
		hovered && !first && !last ? "middle" : first ? "start" : "end";
	const position =
		anchor === "start" ? x - inset : anchor === "end" ? x + inset : x;
	return (
		<text
			x={position}
			y={y}
			dy="0.71em"
			textAnchor={anchor}
			fill={hovered ? "var(--cost-foreground)" : "var(--cost-muted)"}
			fontSize={11}
		>
			{text}
		</text>
	);
}
