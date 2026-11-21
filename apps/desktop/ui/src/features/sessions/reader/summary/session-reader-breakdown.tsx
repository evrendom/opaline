import { useState } from "react";
import { formatShare } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tip } from "../detail/waterfall/session-reader-waterfall-chips";

export type BreakdownPart = { color: string; label: string; value: number };

export type AgentFilter = (agent: string | null) => boolean;

type Cell = {
	height: number;
	left: number;
	part: BreakdownPart;
	top: number;
	width: number;
};

export function squarify(
	parts: readonly BreakdownPart[],
	width: number,
	height: number,
): Cell[] {
	const total = parts.reduce((sum, part) => sum + part.value, 0);
	if (total <= 0) return [];
	const items = [...parts]
		.filter((part) => part.value > 0)
		.sort((a, b) => b.value - a.value)
		.map((part) => ({ area: (part.value / total) * width * height, part }));
	const box = { height, left: 0, top: 0, width };
	const cells: Cell[] = [];
	const worst = (areas: readonly number[], side: number) => {
		const sum = areas.reduce((total, area) => total + area, 0);
		const most = Math.max(...areas);
		const least = Math.min(...areas);
		return Math.max(
			(side * side * most) / (sum * sum),
			(sum * sum) / (side * side * least),
		);
	};
	const lay = (strip: typeof items) => {
		const sum = strip.reduce((total, item) => total + item.area, 0);
		if (box.width >= box.height) {
			const across = sum / box.height;
			let top = box.top;
			for (const { area, part } of strip) {
				const down = area / across;
				cells.push({ height: down, left: box.left, part, top, width: across });
				top += down;
			}
			box.left += across;
			box.width -= across;
		} else {
			const down = sum / box.width;
			let left = box.left;
			for (const { area, part } of strip) {
				const across = area / down;
				cells.push({ height: down, left, part, top: box.top, width: across });
				left += across;
			}
			box.top += down;
			box.height -= down;
		}
	};
	let strip: typeof items = [];
	for (const item of items) {
		const side = Math.min(box.width, box.height);
		const areas = strip.map((entry) => entry.area);
		if (
			strip.length === 0 ||
			worst([...areas, item.area], side) <= worst(areas, side)
		)
			strip.push(item);
		else {
			lay(strip);
			strip = [item];
		}
	}
	if (strip.length > 0) lay(strip);
	return cells;
}

export function Breakdown({
	format,
	parts,
	title,
	toggle,
	value,
}: {
	format: (value: number) => string;
	parts: readonly BreakdownPart[];
	title: string;
	toggle?: { label: string | null; next: string; onToggle: () => void };
	value: string;
}) {
	const [hovered, setHovered] = useState<string | null>(null);
	const total = parts.reduce((sum, part) => sum + part.value, 0);
	const shown = parts.filter((part) => part.value > 0);
	const heading = (
		<span className="truncate text-body-m text-ink-3">
			{title}
			{toggle?.label ? (
				<span className="text-ink-disabled"> · {toggle.label}</span>
			) : null}
		</span>
	);
	return (
		<div className="flex min-w-0 flex-col gap-xs">
			{toggle ? (
				<Tip label={`Show ${toggle.next}`}>
					<button
						type="button"
						onClick={toggle.onToggle}
						className="flex w-fit max-w-full focus-outline hover:[&>span]:text-ink"
					>
						{heading}
					</button>
				</Tip>
			) : (
				heading
			)}
			{/* design-escape-ok(type): deliberate exception, 13/16 keeps the figure row dense; body-l's 20px line grows it */}
			<span className="truncate text-[13px]/4 text-ink tabular-nums">
				{value}
			</span>
			{/* design-escape-ok(space,opacity): shipped value; 1px gaps on ink-3/10 */}
			<span className="flex h-1 gap-px overflow-hidden corner-full bg-ink-3/10">
				{shown.map((part) => (
					<Tip
						key={part.label}
						label={`${part.label}: ${format(part.value)} · ${formatShare(part.value / total)}`}
					>
						<span
							onPointerEnter={() => setHovered(part.label)}
							onPointerLeave={() => setHovered(null)}
							className={cn(
								"h-full min-w-px transition-opacity",
								hovered !== null && hovered !== part.label && "opacity-25",
							)}
							style={{ backgroundColor: part.color, flexGrow: part.value }}
						/>
					</Tip>
				))}
			</span>
		</div>
	);
}
