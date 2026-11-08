import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import {
	IconAlertTriangle,
	IconArrowDown,
	IconArrowsDiagonal,
	IconArrowsDiagonalMinimize2,
	IconArrowUp,
	IconGhost,
} from "@tabler/icons-react";
import { type ReactNode, useMemo } from "react";
import { ConversationTracePlanTag } from "@/components/conversation/conversation-trace-plan-tag";
import { formatConversationModelSetting } from "@/components/conversation/model-section-header";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { shortRunId } from "@/features/sessions/run-id";
import { CopyButton } from "@/features/shell/components/copy-button";
import { formatCompactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTurnCi } from "../../use-session-run-ci";
import { isAgentStep, withRunCi } from "../ci/session-reader-run-ci";
import {
	ContextFill,
	getContextFill,
} from "../context/session-reader-context-fill";
import {
	formatReaderCost,
	type getReaderRunMode,
	getReaderWaterfall,
	type SessionReaderBody,
	type SessionReaderStep,
	type SessionReaderTurnMark,
	type SessionReaderWaterfall,
} from "../model/session-reader-model";
import {
	type RunUiStore,
	toggleFilterKey,
	useIsFocusedTurn,
	useRunUi,
} from "../model/session-reader-run-ui-store";
import { stepLaneLook } from "../model/session-reader-step-lanes";
import { RunTouchTags } from "../rail/session-reader-turn-marks";
import { useReaderSubagentBranches } from "../subagents/use-reader-subagent-branches";
import { OpalTag } from "./opal-tag";
import { SessionReaderWaterfallView } from "./waterfall/session-reader-waterfall";
import {
	ModelChip,
	OpalChip,
	Tip,
} from "./waterfall/session-reader-waterfall-chips";
import {
	barGeometry,
	rowState,
} from "./waterfall/session-reader-waterfall-layout";
import { getWaterfallFilterOptions } from "./waterfall/session-reader-waterfall-rows";

export function RunSummaryBar({
	copyLabel = "Copy run ID",
	expanded = false,
	id,
	mode,
	model,
	onToggle,
	shortId = shortRunId(id),
	waterfall,
}: {
	copyLabel?: string;
	expanded?: boolean;
	id: string;
	mode?: ReturnType<typeof getReaderRunMode>;
	model: string | null;
	onToggle?: () => void;
	shortId?: string;
	waterfall: SessionReaderWaterfall;
}) {
	const steps = waterfall.allSteps.filter(isAgentStep);
	const setting = formatConversationModelSetting(mode?.modelSetting);
	const className = cn(
		"group/run -mx-1.5 flex gap-3 rounded-md px-1.5 py-1.5 text-xs text-muted-foreground transition-colors",
		onToggle && "w-full text-left",
		onToggle && rowState(false),
	);
	const content = (
		<>
			<span className="flex min-w-0 flex-1 flex-col gap-3">
				<span className="flex items-center gap-2">
					<ModelChip model={model} />
					<span className="flex min-w-0 flex-1 items-center gap-0.5">
						<Tip label={id} side="bottom">
							<span className="truncate font-heading text-base font-medium text-foreground tabular-nums">
								{shortId}
							</span>
						</Tip>
						{onToggle ? null : (
							<CopyButton
								className="[&_svg]:size-4"
								title={copyLabel}
								value={id}
							/>
						)}
						<span className="ml-auto flex min-w-0 items-center gap-1.5 pl-2 text-xs text-muted-foreground">
							{model ? (
								<span className="truncate">
									{formatModelDisplayLabel(model)}
								</span>
							) : null}
							{setting ? (
								<span className="shrink-0 text-muted-foreground/60">
									{setting}
								</span>
							) : null}
							{mode?.planMode ? <ConversationTracePlanTag /> : null}
						</span>
					</span>
					{onToggle ? (
						expanded ? (
							<IconArrowsDiagonalMinimize2
								aria-hidden="true"
								className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover/run:text-foreground"
							/>
						) : (
							<IconArrowsDiagonal
								aria-hidden="true"
								className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover/run:text-foreground"
							/>
						)
					) : null}
				</span>
				{expanded ? null : (
					<StepStrip focus={null} steps={steps} waterfall={waterfall} />
				)}
			</span>
		</>
	);
	return onToggle ? (
		<button
			type="button"
			aria-expanded={expanded}
			aria-label={expanded ? "Fold the trace" : "Expand the trace"}
			onClick={onToggle}
			className={className}
		>
			{content}
		</button>
	) : (
		<div className={className}>{content}</div>
	);
}

type StripFocus = {
	has: (step: SessionReaderStep) => boolean;
	tint: string;
};

function StepStrip({
	focus,
	steps,
	waterfall,
}: {
	focus: StripFocus | null;
	steps: readonly SessionReaderStep[];
	waterfall: SessionReaderWaterfall;
}) {
	const total = Math.max(waterfall.endMs - waterfall.startMs, 1);
	return (
		<span
			aria-hidden="true"
			className="relative h-2 w-full shrink-0 overflow-hidden rounded-xs bg-muted-foreground/10"
		>
			{steps.map((step) => {
				const { offset, width } = barGeometry(
					step.startMs,
					Math.min(step.endMs, waterfall.endMs),
					waterfall.startMs,
					total,
				);
				const lit = !focus || focus.has(step);
				return (
					<span
						key={step.id}
						className={cn(
							"absolute inset-y-0 min-w-0.5 transition-[opacity,background-color] duration-200",
							!lit && "opacity-15",
						)}
						style={{
							backgroundColor:
								focus && lit ? focus.tint : stepLaneLook(step).tint,
							left: `${offset}%`,
							width: `${width}%`,
						}}
					/>
				);
			})}
		</span>
	);
}

export function TurnSteps({
	body,
	costShade,
	marks,
	model,
	runUi,
	turn,
	unfolded,
	waterfall: baseWaterfall,
}: {
	body: SessionReaderBody | null;
	costShade: string | undefined;
	marks: readonly SessionReaderTurnMark[];
	runUi: RunUiStore;
	model: string | null;
	turn: SessionDetailTurnSummary;
	unfolded?: boolean;
	waterfall: SessionReaderWaterfall;
}) {
	const ui = useRunUi(runUi, turn.turnId);
	const inPane = useIsFocusedTurn(runUi, turn.turnId);
	const branches = useReaderSubagentBranches(body, ui.open);
	const ci = useTurnCi(turn);
	const waterfall = useMemo(
		() =>
			withRunCi(
				body && branches.size > 0
					? (getReaderWaterfall(body, turn, model, branches) ?? baseWaterfall)
					: baseWaterfall,
				ci,
				Date.now(),
			),
		[body, branches, turn, model, baseWaterfall, ci],
	);
	const filterOptions = useMemo(
		() => getWaterfallFilterOptions(waterfall.allSteps),
		[waterfall.allSteps],
	);
	const stepCount = waterfall.allSteps.filter(isAgentStep).length;
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
				<div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
					<RunTags
						agentCount={agentCount}
						costShade={costShade}
						marks={marks}
						stepCount={stepCount}
						turn={turn}
					/>
					<Tip label={turn.turnId} side="bottom">
						<span className="ml-auto shrink-0 tabular-nums">
							{shortRunId(turn.turnId)}
						</span>
					</Tip>
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
				shown: inPane && ui.picked,
			}}
			unfolded={unfolded}
			waterfall={waterfall}
		/>
	);
}

function RunTags(props: {
	agentCount: number;
	costShade: string | undefined;
	marks: readonly SessionReaderTurnMark[];
	stepCount: number;
	turn: SessionDetailTurnSummary;
}) {
	return (
		<>
			<RunStepTags {...props} />
			<RunNumberTags {...props} />
		</>
	);
}

function RunStepTags({
	agentCount,
	marks,
	stepCount,
}: {
	agentCount: number;
	marks: readonly SessionReaderTurnMark[];
	stepCount?: number;
}) {
	return (
		<>
			{stepCount !== undefined ? (
				<RunTag>
					{formatCompactNumber(stepCount)} {stepCount === 1 ? "step" : "steps"}
				</RunTag>
			) : null}
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
			<RunTouchTags marks={marks} />
		</>
	);
}

function RunNumberTags({
	costShade,
	turn,
}: {
	costShade?: string;
	turn: SessionDetailTurnSummary;
}) {
	return (
		<>
			<RunTag className="gap-1.5" title="Input / output tokens">
				<TokenCounts turn={turn} />
			</RunTag>
			{getContextFill(turn) ? (
				<RunTag>
					<ContextFill turn={turn} />
				</RunTag>
			) : null}
			<RunTag className={costShade}>
				{formatReaderCost(turn.estimatedCost)}
			</RunTag>
			<RunAlertTags turn={turn} />
		</>
	);
}

export function TokenCounts({
	turn,
}: {
	turn: Pick<SessionDetailTurnSummary, "inputTokens" | "outputTokens">;
}) {
	return (
		<>
			<span className="inline-flex items-center gap-0.5">
				<IconArrowUp aria-label="Input" className="size-3" />
				{formatCompactNumber(turn.inputTokens ?? 0)}
			</span>
			<span className="inline-flex items-center gap-0.5">
				<IconArrowDown aria-label="Output" className="size-3" />
				{formatCompactNumber(turn.outputTokens ?? 0)}
			</span>
		</>
	);
}

function RunAlertTags({
	onHover,
	turn,
}: {
	onHover?: (focus: StripFocus) => (hovered: boolean) => void;
	turn: SessionDetailTurnSummary;
}) {
	const apologies = turn.signalOccurrences.filter(
		(signal) => signal.category === "apology",
	);
	return (
		<>
			{turn.errorCount > 0 ? (
				<OpalTag
					onHover={onHover?.({
						has: (step) => step.isError,
						tint: "var(--color-rose-500)",
					})}
					title={
						onHover
							? undefined
							: `${turn.errorCount} ${turn.errorCount === 1 ? "error" : "errors"}`
					}
					word={
						onHover ? (turn.errorCount === 1 ? "error" : "errors") : undefined
					}
				>
					<OpalChip
						tint="var(--color-rose-500)"
						className="size-4 text-rose-600 dark:text-rose-400"
					>
						<IconAlertTriangle aria-hidden="true" className="size-2.5" />
					</OpalChip>
					{turn.errorCount}
				</OpalTag>
			) : null}
			{apologies.length > 0 ? (
				<OpalTag
					title={apologies
						.map((signal) => `“${signal.matchedText}”`)
						.join(", ")}
				>
					<OpalChip
						tint="var(--color-amber-500)"
						className="size-4 text-amber-600 dark:text-amber-400"
					>
						<IconAlertTriangle aria-hidden="true" className="size-2.5" />
					</OpalChip>
					Apology
				</OpalTag>
			) : null}
		</>
	);
}

function RunTag({
	children,
	className,
	title,
}: {
	children: ReactNode;
	className?: string;
	title?: string;
}) {
	const tag = (
		<span
			className={cn(
				"inline-flex h-5 items-center rounded-full bg-background px-2 text-foreground/80 tabular-nums shadow-(--custom-outline-shadow) dark:bg-card",
				className,
			)}
		>
			{children}
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
