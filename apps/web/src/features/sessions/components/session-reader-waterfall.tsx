import { IconAlertTriangle, IconRoute, IconStack2 } from "@tabler/icons-react";
import {
	type ComponentProps,
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useMemo,
	useRef,
	useState,
} from "react";
import { TooltipProvider } from "@/app/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
	SessionReaderStep,
	SessionReaderWaterfall,
} from "./session-reader-model";
import type { SessionReaderStepDetail } from "./session-reader-step-detail";
import {
	ChipToggle,
	formatSpanDuration,
	OpalChip,
	StepIconChip,
	stepBar,
} from "./session-reader-waterfall-chips";
import {
	barGeometry,
	FROZEN_ROW_REM,
	GRID,
	INDENT,
	ROW,
	rowState,
} from "./session-reader-waterfall-layout";
import {
	buildWaterfallRows,
	getFoldKeysAround,
	getSubtraceKeys,
	isToolStep,
	nestWaterfallRows,
	summarizeSteps,
	type WaterfallFoldRow,
	type WaterfallRow,
	type WaterfallRowNode,
} from "./session-reader-waterfall-rows";
import {
	BarTooltip,
	GRID_FRACTIONS,
	ProgressBar,
	RowTotals,
	TimeRuler,
} from "./session-reader-waterfall-track";
import { useWaterfallScrollProgress } from "./use-waterfall-scroll-progress";

// The waterfall is one turn as a trace timeline: the turn is the root row and
// every thing the agent did — thinking, writing, each tool call — a row
// beneath it. Selecting a row drives the reader's right pane.

/** Sentinel selection for the whole-run root row. */
export const WHOLE_TURN_ID = "__whole_turn__";

/**
 * One turn as a waterfall on a shared time axis, topped by a time ruler. A
 * shared 3-column
 * grid (`[15rem | track | 6.5rem]`) keeps the gridlines and bars in column
 * alignment; the same `left-60 right-26` insets position the overlays.
 */
export function SessionReaderWaterfallView({
	collapse,
	header,
	run,
	selection,
	waterfall,
}: {
	/** Fold the waterfall into its root row, which then opens and closes it.
	 * Without it every row always shows. */
	collapse?: { onToggle: () => void; open: boolean };
	/** Above the root row when folding — the two stay frozen at the top while
	 * the steps scroll up under them. */
	header?: ReactNode;
	/** The run behind the waterfall: its summary for the root row, and the
	 * step-kind filter (empty shows all). */
	run: ComponentProps<typeof SessionReaderStepDetail>["run"];
	/** Hold the selection outside, for a pane elsewhere to share it.
	 * `shown`: whether that pane is showing this waterfall's selection — off,
	 * no row looks selected, since what it remembers isn't on screen. */
	selection?: {
		onSelect: (stepId: string) => void;
		selected: string;
		shown?: boolean;
	};
	waterfall: SessionReaderWaterfall;
}) {
	const { filter, turn } = run;
	const cost = turn.estimatedCost;
	const tokens = (turn.inputTokens ?? 0) + (turn.outputTokens ?? 0);
	const { model, startMs, steps } = waterfall;
	const total = Math.max(waterfall.endMs - startMs, 1);
	const [ownSelected, setOwnSelected] = useState(WHOLE_TURN_ID);
	const selected = selection?.selected ?? ownSelected;
	// The row that looks selected: the selection, while it's on screen.
	const marked = selection?.shown === false ? null : selected;
	const setSelected = selection?.onSelect ?? setOwnSelected;
	// Subagents' steps show from the start; folds start closed.
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(
		() => new Set(getSubtraceKeys(steps)),
	);
	const toggleExpanded = (key: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (!next.delete(key)) next.add(key);
			return next;
		});
	const open = collapse?.open ?? true;
	const rows = useMemo(
		() =>
			open
				? buildWaterfallRows(steps, total, (key) => expanded.has(key), filter)
				: [],
		[open, steps, total, expanded, filter],
	);
	const nodes = useMemo(() => nestWaterfallRows(rows), [rows]);

	// Whatever selects a step — a row, the pane beside it — opens the folds
	// hiding it. Adjusted while rendering, so it lands in
	// the same paint.
	const [shownSelected, setShownSelected] = useState(selected);
	if (selected !== shownSelected) {
		setShownSelected(selected);
		const folds = getFoldKeysAround(steps, total, selected, filter);
		if (folds.some((key) => !expanded.has(key))) {
			setExpanded((prev) => new Set([...prev, ...folds]));
		}
	}

	// Hover time cursor — a vertical line + offset chip following the pointer
	// over the track. Driven imperatively (direct style writes on refs) so
	// mousemove never re-renders the row tree.
	const trackOverlayRef = useRef<HTMLDivElement>(null);
	const cursorRef = useRef<HTMLDivElement>(null);
	const cursorLabelRef = useRef<HTMLSpanElement>(null);
	const moveCursor = (event: ReactMouseEvent<HTMLDivElement>) => {
		const overlay = trackOverlayRef.current;
		const cursor = cursorRef.current;
		const label = cursorLabelRef.current;
		if (!overlay || !cursor || !label) return;
		const rect = overlay.getBoundingClientRect();
		const frac = (event.clientX - rect.left) / Math.max(rect.width, 1);
		if (frac < 0 || frac > 1) {
			cursor.style.display = "none";
			return;
		}
		const offsetMs = frac * total;
		cursor.style.display = "block";
		cursor.style.left = `${frac * 100}%`;
		label.textContent = `${formatSpanDuration(offsetMs)} · ${new Date(
			startMs + offsetMs,
		).toLocaleTimeString(undefined, {
			hour: "numeric",
			minute: "2-digit",
			second: "2-digit",
		})}`;
		// Flip the chip to the line's left near the right edge so it stays inside.
		const flip = frac > 0.75;
		label.style.left = flip ? "auto" : "6px";
		label.style.right = flip ? "6px" : "auto";
	};
	const hideCursor = () => {
		if (cursorRef.current) cursorRef.current.style.display = "none";
	};
	const progress = useWaterfallScrollProgress();

	const renderRow = (row: WaterfallRow) =>
		row.kind === "fold" ? (
			<FoldRow
				holdsSelection={row.steps.some((step) => step.id === marked)}
				model={model}
				// Picks its first step, leaving it folded: marking it shown keeps
				// the fold-opening above from firing.
				onSelect={() => {
					const head = row.steps[0]?.id;
					if (!head) return;
					setShownSelected(head);
					setSelected(head);
				}}
				onToggle={() => toggleExpanded(row.key)}
				row={row}
				startMs={startMs}
				total={total}
			/>
		) : (
			<StepRowView
				depth={row.depth}
				model={model}
				onSelect={() => setSelected(row.step.id)}
				onToggleSubtrace={
					row.subtrace
						? () => toggleExpanded(row.subtrace?.key ?? "")
						: undefined
				}
				selected={row.step.id === marked}
				startMs={startMs}
				step={row.step}
				subtraceOpen={row.subtrace?.expanded}
				total={total}
			/>
		);
	// An open fold or subagent call freezes under the rows frozen above it
	// (the header's height, then a row's per level) while what it holds
	// scrolls up under it, and goes on up once that has all gone by. Open or
	// shut, a row sits in the same two wrappers under the same key, so folding
	// keeps its element: remounted under a still pointer, it would lose :hover
	// until the browser next hit-tests, flashing its glyph over the chevron.
	const renderNodes = (
		list: readonly WaterfallRowNode[],
		level: number,
	): ReactNode[] =>
		list.map((node) => {
			const group = node.children.length > 0;
			return (
				<div
					key={
						node.row.kind === "fold" ? `fold:${node.row.key}` : node.row.step.id
					}
					data-group={group ? "" : undefined}
					className="flex flex-col gap-0.5"
				>
					<div
						data-frozen-row={group ? "" : undefined}
						className={cn(
							group &&
								"sticky bg-(--dashboard-01-content-background,var(--background))",
						)}
						style={
							group
								? {
										top: `calc(var(--frozen-top, 0px) + ${level * FROZEN_ROW_REM}rem)`,
										zIndex: 20 - level,
									}
								: undefined
						}
					>
						{renderRow(node.row)}
					</div>
					{renderNodes(node.children, level + 1)}
				</div>
			);
		});

	// Whole-turn root row — the turn as one bar; every step indents beneath
	// it. Folding, it opens and closes the steps too.
	const rootRow = (
		<div
			// What the pane shows, for its pill to find when it's out of sight.
			data-active-row={marked === WHOLE_TURN_ID ? "" : undefined}
			className={cn(
				"relative rounded-l-md rounded-r-sm",
				collapse && "group/toggle",
				rowState(marked === WHOLE_TURN_ID),
			)}
		>
			<button
				type="button"
				// Picks the whole run; once it's picked, the row folds and unfolds
				// the steps too.
				onClick={() => {
					if (collapse && marked === WHOLE_TURN_ID) collapse.onToggle();
					else setSelected(WHOLE_TURN_ID);
				}}
				className={cn(GRID, ROW, "py-0.5")}
			>
				<div className="flex min-w-0 items-center gap-2 pr-3 pl-1">
					<OpalChip
						open={collapse ? open : undefined}
						sidebar={marked === WHOLE_TURN_ID ? "active" : "resting"}
					>
						<IconRoute aria-hidden="true" className="size-3" />
					</OpalChip>
					<span className="truncate font-medium">Reasoning Trace</span>
				</div>
				{/* Keyed by `open`, so folding drops a progress mark left behind. */}
				<div key={String(open)} className="relative h-5">
					<ProgressBar
						ref={progress.barRef}
						// Rests at the dimmed ground it reads as once scrolling fills it.
						baseClassName="bg-primary/50 opacity-35"
						fillClassName="bg-primary/50"
						left={0}
						width={100}
					/>
				</div>
				<RowTotals cost={cost} durationMs={total} tokens={tokens} />
			</button>
			{collapse ? (
				<ChipToggle
					className="pl-1"
					label="the run's steps"
					onToggle={collapse.onToggle}
					open={open}
				/>
			) : null}
		</div>
	);

	return (
		<div data-waterfall="" className="@container/steps">
			<div className="flex flex-col">
				<TooltipProvider delay={150}>
					{/* The rows' grid sizes from this container, so a root row
					    folding the timeline lines up with the steps beneath it. */}
					<div className="@container min-w-0 flex-1">
						{/* Folding, the header and root row come first, frozen at the
						    top on an opaque ground while the timeline beneath them
						    scrolls under; the negative margin keeps them in place
						    while their padding covers the reader's top inset. */}
						{collapse ? (
							<div
								ref={progress.headerRef}
								data-frozen-header=""
								className="sticky top-0 z-30 -mt-4 flex flex-col gap-1.5 bg-(--dashboard-01-content-background,var(--background)) pt-4"
							>
								{header}
								{rootRow}
							</div>
						) : null}
						{open ? (
							/* biome-ignore lint/a11y/noStaticElementInteractions: purely decorative hover cursor */
							<div
								className={cn(
									"@container relative flex flex-col",
									collapse && "mt-0.5",
								)}
								onMouseMove={moveCursor}
								onMouseLeave={hideCursor}
							>
								{/* Time ruler, aligned to the bar track. */}
								<div className={cn(GRID, "items-center")}>
									<div />
									<TimeRuler total={total} />
									<div />
								</div>

								{/* Hover time cursor: a full-height line at the pointer with an
					    elapsed-time chip up in the ruler row. Same insets as the
					    gridlines. */}
								<div
									ref={trackOverlayRef}
									className="pointer-events-none absolute inset-y-0 right-13 left-38 z-20 @lg:right-26 @lg:left-60"
								>
									<div
										ref={cursorRef}
										style={{ display: "none" }}
										className="absolute inset-y-0 w-px bg-foreground/25"
									>
										<span
											ref={cursorLabelRef}
											className="absolute top-0 rounded-sm border bg-background px-1.5 py-0.5 text-[10px] whitespace-nowrap text-muted-foreground tabular-nums shadow-sm"
										/>
									</div>
								</div>

								<div className="relative">
									{/* Quarter-point time gridlines, behind the bars. The insets
						    mirror the grid template's label and total columns. */}
									<div className="pointer-events-none absolute inset-y-0 right-13 left-38 z-0 @lg:right-26 @lg:left-60">
										{GRID_FRACTIONS.map((fraction) => (
											<div
												key={fraction}
												className="absolute inset-y-0 w-px"
												style={{
													borderLeft: "1px dashed var(--border)",
													left: `${fraction * 100}%`,
													opacity: 0.5,
												}}
											/>
										))}
									</div>

									<div
										ref={progress.rowsRef}
										className="relative z-10 flex flex-col gap-0.5"
									>
										{collapse ? null : rootRow}
										{renderNodes(nodes, 0)}
									</div>
								</div>
							</div>
						) : null}
					</div>
				</TooltipProvider>
			</div>
		</div>
	);
}

function StepRowView({
	depth,
	model,
	onSelect,
	onToggleSubtrace,
	selected,
	startMs,
	step,
	subtraceOpen,
	total,
}: {
	depth: number;
	model: string | null;
	onSelect: () => void;
	/** A subagent's call: its chip shows or hides its steps beneath. */
	onToggleSubtrace?: () => void;
	selected: boolean;
	startMs: number;
	step: SessionReaderStep;
	subtraceOpen?: boolean;
	total: number;
}) {
	const { durationMs, offset, offsetMs, width } = barGeometry(
		step.startMs,
		step.endMs,
		startMs,
		total,
	);
	const bar = stepBar(step, model);
	// Written output right after a tool call is a point in time, not a span.
	const timed = isToolStep(step) || durationMs > 0;
	return (
		<div
			data-active-row={selected ? "" : undefined}
			className={cn(
				"relative rounded-md",
				onToggleSubtrace && "group/toggle",
				rowState(selected),
			)}
		>
			<button
				type="button"
				// Picks the step; once it's picked, a subagent's call folds and
				// unfolds its steps too, as the root row does the run's.
				onClick={() => {
					if (onToggleSubtrace && selected) onToggleSubtrace();
					else onSelect();
				}}
				className={cn(GRID, ROW)}
			>
				<div
					className={cn("flex min-w-0 items-center gap-2 pr-3", INDENT)}
					style={{ "--depth": depth } as CSSProperties}
				>
					<StepIconChip
						model={model}
						open={onToggleSubtrace ? subtraceOpen === true : undefined}
						step={step}
					/>
					<div className="flex min-w-0 flex-col gap-1">
						{/* Just the step's name — what it said or ran is the inspector's.
					    Single line: a long name truncates (full on hover) instead of
					    wrapping and stretching the row. */}
						<span
							className={cn(
								"truncate",
								isToolStep(step) && "font-mono text-xs",
							)}
							title={step.name}
						>
							{step.name}
						</span>
						{step.isError ? (
							<span className="inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-3xl bg-rose-500/10 px-2 text-xs font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-400 [&>svg]:size-3">
								<IconAlertTriangle aria-hidden="true" />
								error
							</span>
						) : null}
					</div>
				</div>
				<div className="relative h-5">
					<BarTooltip
						durationMs={timed ? durationMs : null}
						offsetMs={offsetMs}
					>
						{onToggleSubtrace ? (
							// A subagent's call fills as its steps are read.
							<ProgressBar
								baseClassName={bar.className}
								baseStyle={bar.style}
								fillClassName={bar.className}
								fillStyle={bar.style}
								left={offset}
								width={width}
							/>
						) : (
							<div
								// Where it sits, for the bar of the row frozen above it.
								data-left={offset}
								data-mark=""
								data-width={width}
								className={cn(
									"absolute top-1/2 h-2 -translate-y-1/2 rounded-xs",
									bar.className,
								)}
								style={{
									...bar.style,
									left: `${offset}%`,
									width: `${width}%`,
								}}
							/>
						)}
					</BarTooltip>
				</div>
				<RowTotals
					cost={null}
					durationMs={timed ? durationMs : null}
					tokens={0}
				/>
			</button>
			{onToggleSubtrace ? (
				<ChipToggle
					className={INDENT}
					label={`${step.name}'s steps`}
					onToggle={onToggleSubtrace}
					open={subtraceOpen === true}
					style={{ "--depth": depth } as CSSProperties}
				/>
			) : null}
		</div>
	);
}

const FOLD_TITLES: Record<WaterfallFoldRow["variant"], [string, string]> = {
	filtered: ["Show the steps the filter hides", "Fold the hidden steps"],
	quiet: ["Show these steps", "Fold these steps"],
	repeat: ["Show each call", "Fold repeated calls"],
};

/**
 * One row standing in for several steps: a run of identical calls (`×12
 * Read`), a quiet stretch of a large turn (`9 steps`), or steps the filter
 * hides. It shows their wall-clock envelope, with a bar spanning the run and a
 * tick per step — so a loop reads as one loop, and you can still see the
 * rhythm inside it. Like the root row, a click picks it and a second unfolds
 * the run in place; its chip unfolds it at once.
 */
function FoldRow({
	holdsSelection,
	model,
	onSelect,
	onToggle,
	row,
	startMs,
	total,
}: {
	/** One of its steps is the selection. */
	holdsSelection: boolean;
	model: string | null;
	onSelect: () => void;
	onToggle: () => void;
	row: WaterfallFoldRow;
	startMs: number;
	total: number;
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
	const [showTitle, foldTitle] = FOLD_TITLES[variant];
	return (
		<div
			data-active-row={!expanded && holdsSelection ? "" : undefined}
			className={cn(
				"relative rounded-md group/toggle",
				// Open, the selected step shows as its own row instead.
				rowState(!expanded && holdsSelection),
				variant === "filtered" && !expanded && "opacity-60",
			)}
		>
			<button
				type="button"
				// Picks the run; once it holds the selection, folds and unfolds
				// it too, as the root row does the run's steps.
				onClick={holdsSelection ? onToggle : onSelect}
				aria-expanded={expanded}
				title={expanded ? foldTitle : showTitle}
				className={cn(GRID, ROW)}
			>
				<div
					className={cn("flex min-w-0 items-center gap-2 pr-3", INDENT)}
					style={{ "--depth": row.depth } as CSSProperties}
				>
					{variant === "repeat" ? (
						<StepIconChip model={model} open={expanded} step={head} />
					) : (
						<OpalChip
							open={expanded}
							tint="var(--color-slate-500)"
							className="text-muted-foreground"
						>
							<IconStack2 aria-hidden="true" className="size-3" />
						</OpalChip>
					)}
					<span className="min-w-0 truncate" title={summarizeSteps(steps)}>
						{variant === "repeat" ? (
							<>
								<span className="text-muted-foreground tabular-nums">
									×{steps.length}
								</span>{" "}
								<span className="font-mono text-xs">{head.name}</span>
							</>
						) : (
							<>
								<span className="tabular-nums">
									{steps.length} {variant === "filtered" ? "hidden" : "steps"}
								</span>
								<span className="ml-1.5 text-muted-foreground">
									{summarizeSteps(steps)}
								</span>
							</>
						)}
					</span>
				</div>
				<div className="relative h-5">
					<ProgressBar
						baseClassName="bg-muted-foreground/25"
						color="var(--muted-foreground)"
						fillClassName="bg-muted-foreground/50"
						left={offset}
						width={width}
					>
						{/* One tick per step, positioned within the run's span. */}
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
				</div>
				<RowTotals cost={null} durationMs={durationMs} tokens={0} />
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
