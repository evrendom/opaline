import { useCallback, useState } from "react";
import type { MouseHandlerDataParam, XAxisTickContentProps } from "recharts";

export interface AxisHover {
	readonly index: number;
	readonly x: number;
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
	if (hover && hover.index >= 0 && hover.index < count) return [hover.index];
	return [...new Set([0, count - 1])];
}

export function EdgeTick({
	tick,
	count,
	hover,
	label,
	inset = 0,
	bars = false,
}: {
	tick: XAxisTickContentProps;
	count: number;
	hover: AxisHover | null;
	label: (index: number) => string;
	inset?: number;
	bars?: boolean;
}) {
	const index = Number(tick.payload?.value);
	const x = Number(tick.x ?? 0);
	const y = Number(tick.y ?? 0);
	const text = label(index);
	const first = index === 0;
	const last = index === count - 1 && !first;
	const hovered = hover?.index === index;
	const anchor =
		count === 1 || (bars && count === 2) || (hovered && !first && !last)
			? "middle"
			: first
				? "start"
				: "end";
	const position =
		anchor === "start" ? x - inset : anchor === "end" ? x + inset : x;
	return (
		<text
			x={position}
			y={y}
			dy="0.71em"
			textAnchor={anchor}
			fill={hovered ? "var(--ink)" : "var(--ink-3)"}
			fontSize={11}
		>
			{text}
		</text>
	);
}
