import { IconRoute } from "@tabler/icons-react";
import {
	type ComponentProps,
	type ReactNode,
	useCallback,
	useMemo,
	useState,
} from "react";
import { Pressable } from "@/app/ui/pressable";
import { TooltipProvider } from "@/app/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SessionReaderWaterfall } from "../../model/session-reader-model";
import { flattenSteps } from "../../model/session-reader-run-steps";
import { WATERFALL_MARK } from "../../reader-dom";
import { subagentIdOf } from "../../subagents/session-reader-agent-focus";
import type { SubagentEnd } from "../../subagents/session-reader-subagent-done";
import {
	reportingSubagentOf,
	SubagentTints,
} from "../../subagents/session-reader-subagent-tints";
import type { SessionReaderStepDetail } from "../step/session-reader-step-detail";
import {
	ChipToggle,
	formatWholeDuration,
	OpalChip,
	toggleFocus,
} from "./session-reader-waterfall-chips";
import { FoldRow } from "./session-reader-waterfall-fold-row";
import {
	FROZEN_ROW_REM,
	GRID,
	GRID_TRACK,
	GRID_UNTIMED_TRACK,
	ROW,
	rowState,
} from "./session-reader-waterfall-layout";
import {
	buildWaterfallRows,
	getFoldKeysAround,
	getSubtraceKeys,
	nestWaterfallRows,
	subtraceKey,
	type WaterfallRow,
	type WaterfallRowNode,
} from "./session-reader-waterfall-rows";
import { StepRowView } from "./session-reader-waterfall-step-row";
import {
	GRID_FRACTIONS,
	ProgressBar,
	RowTotals,
	TimeRuler,
} from "./session-reader-waterfall-track";
import { useWaterfallCursor } from "./use-waterfall-cursor";
import { useWaterfallScrollProgress } from "./use-waterfall-scroll-progress";

export const WHOLE_TURN_ID = "__whole_turn__";

const rowKeyOpenOrShut = (row: WaterfallRow) =>
	row.kind === "fold" ? `fold:${row.key}` : row.step.id;

export function SessionReaderWaterfallView({
	collapse,
	freezeRows = true,
	header,
	keepOut,
	bare = false,
	run,
	selection,
	subagentsWhole,
	unfolded = false,
	waterfall,
}: {
	collapse?: { onToggle: () => void; open: boolean };
	freezeRows?: boolean;
	keepOut?: readonly string[];
	header?: ReactNode;
	bare?: boolean;
	run: ComponentProps<typeof SessionReaderStepDetail>["run"];
	selection?: {
		onSelect: (stepId: string) => void;
		selected: string;
		shown?: boolean;
	};
	subagentsWhole?: ReadonlyMap<string, SubagentEnd>;
	unfolded?: boolean;
	waterfall: SessionReaderWaterfall;
}) {
	const { filter, turn } = run;
	const cost = turn.estimatedCost;
	const tokens = (turn.inputTokens ?? 0) + (turn.outputTokens ?? 0);
	const { model, startMs, steps } = waterfall;
	const subagentIds = useMemo(
		() =>
			[...waterfall.allSteps]
				.sort((a, b) => a.startMs - b.startMs)
				.flatMap((step) => {
					const id = reportingSubagentOf(step);
					return id ? [id] : [];
				}),
		[waterfall.allSteps],
	);
	const total = Math.max(waterfall.endMs - startMs, 1);
	const runMs = Math.max(waterfall.endMs - startMs, 1);
	const [ownSelected, setOwnSelected] = useState(WHOLE_TURN_ID);
	const selected = selection?.selected ?? ownSelected;
	const marked = selection?.shown === false ? null : selected;
	const setSelected = selection?.onSelect ?? setOwnSelected;
	const [toggled, setToggled] = useState<ReadonlySet<string>>(
		() => new Set(unfolded ? [] : getSubtraceKeys(steps)),
	);
	const isExpanded = (key: string) => toggled.has(key) !== unfolded;
	const toggleExpanded = useCallback(
		(key: string) =>
			setToggled((prev) => {
				const next = new Set(prev);
				if (!next.delete(key)) next.add(key);
				return next;
			}),
		[],
	);
	const open = collapse?.open ?? true;
	const whole = useMemo(
		() =>
			subagentsWhole
				? new Set(
						flattenSteps(steps)
							.filter((step) => step.kind === "agent")
							.map((step) => subtraceKey(step.id)),
					)
				: null,
		[subagentsWhole, steps],
	);
	const rows = useMemo(
		() =>
			open
				? buildWaterfallRows(
						steps,
						total,
						(key) => !whole?.has(key) && toggled.has(key) !== unfolded,
						filter,
						keepOut ? new Set(keepOut) : undefined,
					)
				: [],
		[open, steps, total, toggled, unfolded, filter, keepOut, whole],
	);
	const nodes = useMemo(() => nestWaterfallRows(rows), [rows]);

	const [shownSelected, setShownSelected] = useState(selected);
	if (selected !== shownSelected) {
		setShownSelected(selected);
		const folds = getFoldKeysAround(steps, total, selected, filter);
		if (folds.some((key) => !isExpanded(key))) {
			setToggled((prev) =>
				unfolded
					? new Set([...prev].filter((key) => !folds.includes(key)))
					: new Set([...prev, ...folds]),
			);
		}
	}

	const { cursorLabelRef, cursorRef, hideCursor, moveCursor, trackOverlayRef } =
		useWaterfallCursor(total, startMs);
	const progress = useWaterfallScrollProgress();

	const renderRow = (row: WaterfallRow) =>
		row.kind === "fold" ? (
			<FoldRow
				totals={!bare}
				holdsSelection={row.steps.some((step) => step.id === marked)}
				model={model}
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
				totals={!bare}
				depth={row.depth}
				model={model}
				onSelect={setSelected}
				onToggleSubtrace={toggleExpanded}
				selected={row.step.id === marked}
				startMs={startMs}
				step={row.step}
				subtraceKey={
					whole?.has(row.subtrace?.key ?? "") ? undefined : row.subtrace?.key
				}
				subtraceOpen={row.subtrace?.expanded}
				total={total}
			/>
		);
	const renderNodes = (
		list: readonly WaterfallRowNode[],
		level: number,
	): ReactNode[] =>
		list.map((node) => {
			const group = node.children.length > 0;
			const frozen = group && freezeRows;
			return (
				<div
					key={rowKeyOpenOrShut(node.row)}
					data-group={group ? "" : undefined}
					{...(node.row.kind !== "fold" && node.row.step.kind === "agent"
						? {
								"data-subagent": "",
								"data-subagent-id": subagentIdOf(node.row.step) ?? undefined,
								"data-subagent-end-ms": subagentsWhole
									? node.row.step.endMs
									: undefined,
								"data-subagent-until":
									subagentsWhole?.get(node.row.step.id)?.until ?? undefined,
							}
						: {})}
					className="flex flex-col gap-xxs"
				>
					<div
						data-frozen-row={frozen ? "" : undefined}
						className={cn(
							frozen &&
								"sticky bg-(--dashboard-01-content-background,var(--canvas))",
						)}
						style={
							frozen
								? {
										top: `calc(var(--frozen-offset, calc(var(--reader-top, 1rem) - 1rem)) + var(--frozen-top, 0px) + ${level * FROZEN_ROW_REM}rem)`,
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

	const rootRow = (
		<div
			data-active-row={marked === WHOLE_TURN_ID ? "" : undefined}
			className={cn(
				"relative corner-l-s corner-r-xs",
				collapse && "group/toggle",
				rowState(marked === WHOLE_TURN_ID),
			)}
			{...(collapse ? toggleFocus : {})}
		>
			<Pressable
				type="button"
				onClick={() => {
					if (collapse && marked === WHOLE_TURN_ID) collapse.onToggle();
					else setSelected(WHOLE_TURN_ID);
				}}
				className={cn(GRID, ROW, "py-xxs")}
			>
				<div className="flex min-w-0 items-center gap-m pr-l pl-xs">
					<OpalChip
						open={collapse ? open : undefined}
						sidebar={marked === WHOLE_TURN_ID ? "active" : "resting"}
					>
						<IconRoute aria-hidden="true" className="size-3" />
					</OpalChip>
					<span className="truncate font-medium">Reasoning Trace</span>
				</div>
				<div key={String(open)} className="relative h-5">
					<ProgressBar
						ref={progress.barRef}
						baseClassName="bg-ink-2 opacity-35"
						fillClassName="bg-ink-2"
						left={0}
						width={(runMs / total) * 100}
					/>
				</div>
				<RowTotals cost={cost} durationMs={runMs} tokens={tokens} />
			</Pressable>
			{collapse ? (
				<ChipToggle
					className="pl-xs"
					label="the run's steps"
					onToggle={collapse.onToggle}
					open={open}
				/>
			) : null}
		</div>
	);

	const ruler = (
		<div className={cn(GRID, "items-center")}>
			<div />
			<div className="relative">
				<TimeRuler total={total} />
				<span
					ref={cursorLabelRef}
					style={{ display: "none" }}
					className="pointer-events-none absolute top-0 z-10 corner-xs border bg-canvas px-s py-xxs text-body-xs whitespace-nowrap text-ink-3 tabular-nums shadow-float"
				/>
			</div>
			<div />
		</div>
	);

	return (
		<SubagentTints ids={subagentIds}>
			<div {...WATERFALL_MARK} className="@container/steps">
				<div className="flex flex-col">
					<TooltipProvider delay={150}>
						<div className="@container min-w-0 flex-1">
							{collapse ? (
								<div
									ref={progress.headerRef}
									data-frozen-header=""
									className="sticky top-[var(--frozen-offset,calc(var(--reader-top,1rem)-1rem))] z-30 -mt-xl flex flex-col gap-s bg-(--dashboard-01-content-background,var(--canvas)) pt-xl"
								>
									{header}
									{rootRow}
									{open ? ruler : null}
								</div>
							) : null}
							{open ? (
								/* biome-ignore lint/a11y/noStaticElementInteractions: purely decorative hover cursor */
								<div
									className={cn(
										"@container relative flex flex-col",
										collapse && "mt-xxs",
									)}
									onMouseMove={moveCursor}
									onMouseLeave={hideCursor}
								>
									{collapse || bare ? null : ruler}

									<div
										ref={trackOverlayRef}
										className={cn(
											"pointer-events-none absolute inset-y-0 z-20",
											bare ? GRID_UNTIMED_TRACK : GRID_TRACK,
										)}
									>
										<div
											ref={cursorRef}
											style={{ display: "none" }}
											className="absolute inset-y-0 w-px bg-ink-3"
										/>
									</div>

									<div className="relative">
										<div
											className={cn(
												"pointer-events-none absolute z-0",
												bare ? GRID_UNTIMED_TRACK : GRID_TRACK,
												bare
													? "-top-(--rails-above,0px) -bottom-(--rails-below,0px)"
													: "inset-y-0",
											)}
										>
											{GRID_FRACTIONS.map((fraction) => (
												<div
													key={fraction}
													className="absolute inset-y-0 w-px"
													style={{
														borderLeft: "1px dashed var(--line)",
														left: `${fraction * 100}%`,
														opacity: 0.5,
													}}
												/>
											))}
											{bare ? (
												<div className="absolute inset-x-0 top-0 flex justify-between px-xs text-body-xxs text-ink-4 tabular-nums">
													<span>0s</span>
													<span>{formatWholeDuration(total)}</span>
												</div>
											) : null}
										</div>

										<div
											ref={progress.rowsRef}
											className="relative z-10 flex flex-col gap-xxs"
										>
											{collapse || bare ? null : rootRow}
											{renderNodes(nodes, 0)}
										</div>
									</div>
								</div>
							) : null}
						</div>
					</TooltipProvider>
				</div>
			</div>
		</SubagentTints>
	);
}
