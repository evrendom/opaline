import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import {
	IconAlertTriangle,
	IconArrowDown,
	IconArrowUp,
	IconGhost,
} from "@tabler/icons-react";
import { type ReactNode, useMemo } from "react";
import { shortRunId } from "@/features/sessions/run-id";
import { formatCompactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
	formatReaderCost,
	getReaderWaterfall,
	type SessionReaderBody,
	type SessionReaderTurnMark,
	type SessionReaderWaterfall,
} from "./session-reader-model";
import {
	type RunUiStore,
	toggleFilterKey,
	useIsFocusedTurn,
	useRunUi,
} from "./session-reader-run-ui-store";
import { RunTouchTags } from "./session-reader-turn-marks";
import { SessionReaderWaterfallView } from "./session-reader-waterfall";
import { OpalChip } from "./session-reader-waterfall-chips";
import { getWaterfallFilterOptions } from "./session-reader-waterfall-rows";
import { useReaderSubagentBranches } from "./use-reader-subagent-branches";

// A turn's run under its member message: its waterfall folded into the root
// row, which unfolds it in place, under the run's tags.

/** The turn's run: its waterfall's root row, unfolding the steps in place,
 * under its steps, tokens, cost, errors and what it touched as tags. */
export function TurnSteps({
	body,
	costShade,
	marks,
	model,
	runUi,
	turn,
	waterfall: baseWaterfall,
}: {
	/** The turn's body — whose subagents' transcripts are fetched to nest
	 * under their calls once the waterfall opens. */
	body: SessionReaderBody | null;
	costShade: string | undefined;
	/** Skills used and files touched, shown as tags after the run's numbers. */
	marks: readonly SessionReaderTurnMark[];
	/** The reader's per-turn run state: whether the waterfall is open, and
	 * its selection, shared with the right pane. */
	runUi: RunUiStore;
	model: string | null;
	turn: SessionDetailTurnSummary;
	waterfall: SessionReaderWaterfall;
}) {
	const ui = useRunUi(runUi, turn.turnId);
	const inPane = useIsFocusedTurn(runUi, turn.turnId);
	// Open, the run shows what its subagents did too.
	const branches = useReaderSubagentBranches(body, ui.open);
	const waterfall = useMemo(
		() =>
			body && branches.size > 0
				? (getReaderWaterfall(body, turn, model, branches) ?? baseWaterfall)
				: baseWaterfall,
		[body, branches, turn, model, baseWaterfall],
	);
	const filterOptions = useMemo(
		() => getWaterfallFilterOptions(waterfall.allSteps),
		[waterfall.allSteps],
	);
	const stepCount = waterfall.allSteps.length;
	// From the run's own steps, so the count doesn't grow as subagents'
	// transcripts load in.
	const agentCount = baseWaterfall.allSteps.filter(
		(step) => step.kind === "agent",
	).length;
	return (
		<SessionReaderWaterfallView
			collapse={{
				onToggle: () =>
					runUi.update(turn.turnId, (state) => ({ open: !state.open })),
				open: ui.open,
			}}
			header={
				// The run's facts, read-only above the root row that folds it.
				<div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
					<RunTags
						agentCount={agentCount}
						costShade={costShade}
						marks={marks}
						stepCount={stepCount}
						turn={turn}
					/>
					{/* The run's id, set apart on the right. */}
					<span title={turn.turnId} className="ml-auto shrink-0 tabular-nums">
						{shortRunId(turn.turnId)}
					</span>
				</div>
			}
			run={{
				filter: ui.filter,
				filterOptions,
				marks,
				onToggleFilter: (key) =>
					runUi.update(turn.turnId, (state) => ({
						filter: toggleFilterKey(state.filter, key),
					})),
				turn,
			}}
			selection={{
				onSelect: (stepId) => runUi.pick(turn.turnId, stepId),
				selected: ui.selected,
				// Picked, and the turn the pane shows.
				shown: inPane && ui.picked,
			}}
			waterfall={waterfall}
		/>
	);
}

/** The run's steps, subagents, tokens, cost, errors and what it touched, as
 * tags, in the run's header. */
function RunTags({
	agentCount,
	costShade,
	marks,
	stepCount,
	turn,
}: {
	/** Subagents the run called. */
	agentCount: number;
	costShade: string | undefined;
	marks: readonly SessionReaderTurnMark[];
	stepCount: number;
	turn: SessionDetailTurnSummary;
}) {
	const apologies = turn.signalOccurrences.filter(
		(signal) => signal.category === "apology",
	);
	return (
		<>
			<RunTag>
				{formatCompactNumber(stepCount)} {stepCount === 1 ? "step" : "steps"}
			</RunTag>
			{agentCount > 0 ? (
				<span
					title={`${agentCount} ${agentCount === 1 ? "subagent" : "subagents"}`}
					className="inline-flex h-5 items-center gap-1 rounded-full bg-background pr-2 pl-0.5 text-foreground/80 tabular-nums shadow-(--custom-outline-shadow) dark:bg-card"
				>
					<OpalChip
						tint="var(--color-indigo-500)"
						className="size-4 text-indigo-600 dark:text-indigo-400"
					>
						<IconGhost
							aria-hidden="true"
							className="size-2.5 fill-current/20"
						/>
					</OpalChip>
					{agentCount}
				</span>
			) : null}
			{/* Up what went to the model, down what came back. */}
			<RunTag className="gap-1.5" title="Input / output tokens">
				<span className="inline-flex items-center gap-0.5">
					<IconArrowUp aria-label="Input" className="size-3" />
					{formatCompactNumber(turn.inputTokens ?? 0)}
				</span>
				<span className="inline-flex items-center gap-0.5">
					<IconArrowDown aria-label="Output" className="size-3" />
					{formatCompactNumber(turn.outputTokens ?? 0)}
				</span>
			</RunTag>
			<RunTag className={costShade}>
				{formatReaderCost(turn.estimatedCost)}
			</RunTag>
			{turn.errorCount > 0 ? (
				<span
					title={`${turn.errorCount} ${turn.errorCount === 1 ? "error" : "errors"}`}
					className="inline-flex h-5 items-center gap-1 rounded-full bg-background pr-2 pl-0.5 text-foreground/80 tabular-nums shadow-(--custom-outline-shadow) dark:bg-card"
				>
					<OpalChip
						tint="var(--color-rose-500)"
						className="size-4 text-rose-600 dark:text-rose-400"
					>
						<IconAlertTriangle aria-hidden="true" className="size-2.5" />
					</OpalChip>
					{turn.errorCount}
				</span>
			) : null}
			{apologies.length > 0 ? (
				<span
					title={apologies
						.map((signal) => `“${signal.matchedText}”`)
						.join(", ")}
					className="inline-flex h-5 items-center gap-1 rounded-full bg-background pr-2 pl-0.5 text-foreground/80 shadow-(--custom-outline-shadow) dark:bg-card"
				>
					<OpalChip
						tint="var(--color-amber-500)"
						className="size-4 text-amber-600 dark:text-amber-400"
					>
						<IconAlertTriangle aria-hidden="true" className="size-2.5" />
					</OpalChip>
					Apology
				</span>
			) : null}
			<RunTouchTags marks={marks} />
		</>
	);
}

/** One fact about a run — its steps, tokens, cost, errors — as a small tag. */
function RunTag({
	children,
	className,
	title,
}: {
	children: ReactNode;
	className?: string;
	title?: string;
}) {
	return (
		<span
			title={title}
			className={cn(
				"inline-flex h-5 items-center rounded-full bg-background px-2 text-foreground/80 tabular-nums shadow-(--custom-outline-shadow) dark:bg-card",
				className,
			)}
		>
			{children}
		</span>
	);
}
