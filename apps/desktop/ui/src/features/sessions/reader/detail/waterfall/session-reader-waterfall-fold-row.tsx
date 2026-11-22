import { IconStack2 } from "@tabler/icons-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { SessionReaderStep } from "../../model/session-reader-model";
import {
	ChipToggle,
	OpalChip,
	StepIconChip,
	stepBar,
	toggleFocus,
} from "./session-reader-waterfall-chips";
import {
	barGeometry,
	GRID,
	GRID_UNTIMED,
	INDENT,
	ROW,
	rowState,
} from "./session-reader-waterfall-layout";
import {
	summarizeSteps,
	type WaterfallFoldRow,
} from "./session-reader-waterfall-rows";
import { ProgressBar, RowTotals } from "./session-reader-waterfall-track";

export function FoldRow({
	holdsSelection,
	model,
	onSelect,
	onToggle,
	row,
	startMs,
	total,
	totals = true,
}: {
	holdsSelection: boolean;
	model: string | null;
	onSelect: () => void;
	onToggle: () => void;
	row: WaterfallFoldRow;
	startMs: number;
	total: number;
	totals?: boolean;
}) {
	const { expanded, steps, variant } = row;
	const first = Math.min(...steps.map((step) => step.startMs));
	const last = Math.max(...steps.map((step) => step.endMs));
	const { durationMs, offset, width } = barGeometry(
		first,
		last,
		startMs,
		total,
	);
	const head = steps[0] as SessionReaderStep;
	const chip =
		variant === "repeat" ? (
			<StepIconChip open={expanded} step={head} tip={false} />
		) : (
			<OpalChip
				open={expanded}
				tint="var(--color-slate-500)"
				className="text-ink-3"
			>
				<IconStack2 aria-hidden="true" className="size-3" />
			</OpalChip>
		);
	const label = (
		<span className="min-w-0 truncate">
			{variant === "repeat" ? (
				<>
					<span className="text-ink-3 tabular-nums">×{steps.length}</span>{" "}
					<span>{head.name}</span>
				</>
			) : (
				<>
					<span className="tabular-nums">
						{steps.length} {variant === "filtered" ? "hidden" : "steps"}
					</span>
					<span className="ml-s text-ink-3">{summarizeSteps(steps)}</span>
				</>
			)}
		</span>
	);
	const bar = (
		<ProgressBar
			// design-escape-ok(opacity): no role renders this; bg-ink-3/25
			baseClassName="bg-ink-3/25"
			color="var(--ink-3)"
			fillClassName="bg-ink-disabled"
			left={offset}
			width={width}
		>
			{steps.map((step) => {
				const tick = stepBar(step, model);
				return (
					<div
						key={step.id}
						className={cn("absolute inset-y-0 w-px", tick.className)}
						style={{
							...tick.style,
							left: `${last > first ? ((step.startMs - first) / (last - first)) * 100 : 0}%`,
						}}
					/>
				);
			})}
		</ProgressBar>
	);
	return (
		<div
			data-active-row={!expanded && holdsSelection ? "" : undefined}
			data-fold-from={first}
			data-fold-to={Math.max(
				...steps.map((step) => step.backgroundFromMs ?? step.endMs),
			)}
			className={cn(
				"relative corner-s group/toggle",
				rowState(!expanded && holdsSelection),
				variant === "filtered" && !expanded && "opacity-60",
			)}
			{...toggleFocus}
		>
			<button
				type="button"
				onClick={holdsSelection ? onToggle : onSelect}
				aria-expanded={expanded}
				className={cn(totals ? GRID : GRID_UNTIMED, ROW)}
			>
				<div
					className={cn("flex min-w-0 items-center gap-m pr-l", INDENT)}
					style={{ "--depth": row.depth } as CSSProperties}
				>
					{chip}
					{label}
				</div>
				<div className="relative h-5">{bar}</div>
				{totals ? (
					<RowTotals cost={null} durationMs={durationMs} tokens={0} />
				) : null}
			</button>
			<ChipToggle
				className={INDENT}
				label={variant === "repeat" ? "each call" : "these steps"}
				onToggle={onToggle}
				open={expanded}
				style={{ "--depth": row.depth } as CSSProperties}
			/>
		</div>
	);
}
