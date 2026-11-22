import { IconArrowUpRight } from "@tabler/icons-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { squarify } from "../summary/session-reader-breakdown";
import { tileGlyph, tileLook } from "./session-reader-context-bar";
import type { ContextPart } from "./session-reader-context-map";
import {
	ContextRunTiles,
	firstLitStep,
	type RunLit,
	runHolds,
} from "./session-reader-context-run-tiles";

const GAP = 6;
const MIN_CARD = { h: 110, w: 150 } as const;
const TOP = 30;

export function RunZoom({
	kind,
	lits,
	onOpen,
	onPick,
	runs,
}: {
	kind: ContextPart["kind"];
	lits: readonly RunLit[];
	onOpen: (run: string, step: string | null) => void;
	onPick: (lit: RunLit, more: boolean) => void;
	runs: readonly ContextPart[];
}) {
	const [size, setSize] = useState({ h: 0, w: 0 });
	const measure = (element: HTMLDivElement | null) => {
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			if (!entry) return;
			const { height, width } = entry.contentRect;
			setSize((had) =>
				had.w === Math.round(width) && had.h === Math.round(height)
					? had
					: { h: Math.round(height), w: Math.round(width) },
			);
		});
		observer.observe(element);
		return () => observer.disconnect();
	};
	const holding = runs.filter((run) => runHolds(run, lits));
	const whole = holding.reduce((sum, run) => sum + run.tokens, 0);
	const least =
		(whole * MIN_CARD.w * MIN_CARD.h) / Math.max(1, size.w * size.h);
	const cells =
		size.w > 0 && size.h > 0
			? squarify(
					holding.map((run, index) => ({
						color: "",
						label: String(index),
						value: Math.max(run.tokens, least),
					})),
					size.w,
					size.h,
				)
			: [];
	const look = tileLook(kind);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div
				ref={measure}
				className={cn(
					"relative min-h-0 flex-1 corner-s edge-m corner-squircle squircle:corner-l",
					look.className,
				)}
				style={look.style}
			>
				{cells.map((cell) => {
					const run = holding[Number(cell.part.label)];
					if (!run) return null;
					const id = run.key.slice("run:".length);
					const Glyph = tileGlyph(run);
					const w = Math.max(0, cell.width - GAP);
					const h = Math.max(0, cell.height - GAP);
					return (
						<div
							key={run.key}
							className="absolute overflow-hidden corner-s edge-m border-current/20 bg-surface corner-squircle squircle:corner-l"
							style={{
								height: h,
								left: cell.left + GAP / 2,
								top: cell.top + GAP / 2,
								width: w,
							}}
						>
							<span className="absolute top-1.5 left-2 flex min-w-0 items-center gap-s text-body-m font-medium">
								<Glyph className="size-3.5 shrink-0" />
								<span className="truncate">{run.label}</span>
							</span>
							<ContextRunTiles
								detailed
								h={h}
								lits={lits}
								onOpen={(step) => onOpen(id, step)}
								onPick={onPick}
								part={run}
								top={TOP}
								w={w}
							/>
							<button
								type="button"
								data-context-pick=""
								onClick={() => onOpen(id, firstLitStep(run, lits))}
								aria-label={`Open ${run.label} in Detail`}
								className={cn(
									"absolute right-1.5 bottom-1.5 z-20 inline-flex h-6 items-center gap-xxs",
									"corner-s pr-xs pl-m",
									"text-body-m font-medium",
									"bg-field text-ink-3 transition-colors focus-outline",
									"hover:bg-hover hover:text-ink",
								)}
							>
								Detail
								<IconArrowUpRight aria-hidden="true" className="size-3" />
							</button>
						</div>
					);
				})}
			</div>
		</div>
	);
}
