import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import {
	type ComponentProps,
	memo,
	type ReactNode,
	useMemo,
	useState,
} from "react";
import { TraceAttempts } from "@/features/compass/compass-trace-attempts";
import { getSubagentExchanges } from "@/features/compass/subagent-exchanges";
import { cn } from "@/lib/utils";
import { BODY_PRIORITY } from "../../components/body-request-scheduler";
import { useTurnCi } from "../../use-session-run-ci";
import { withRunCi } from "../ci/session-reader-run-ci";
import {
	getReaderTurnMarks,
	getReaderWaterfall,
	type SessionReaderBody,
	type SessionReaderWaterfall,
} from "../model/session-reader-model";
import { flattenSteps } from "../model/session-reader-run-steps";
import {
	type RunUiStore,
	toggleFilterKey,
	useIsFocusedTurn,
	useRunUi,
} from "../model/session-reader-run-ui-store";
import { KEEPS_PICK_MARK } from "../reader-dom";
import { subagentIdOf } from "../subagents/session-reader-agent-focus";
import { LaunchedSubagentsContext } from "../subagents/session-reader-frozen-subagents";
import { useSubagentModels } from "../subagents/session-reader-subagent-marks";
import { useSubagentHoverPrefetch } from "../subagents/subagent-hover-prefetch";
import { useReaderSubagentBranches } from "../subagents/use-reader-subagent-branches";
import { useWarmStepDetail } from "./reader-warmup";
import {
	RunCostBreakdown,
	RunTokenBreakdown,
	useCountedAgents,
} from "./session-reader-cost-breakdown";
import {
	useReaderHidden,
	withoutHiddenSteps,
} from "./session-reader-hidden-steps";
import {
	RunStepBreakdown,
	RunTimeBreakdown,
} from "./session-reader-lane-breakdown";
import { StepBreakdowns } from "./session-reader-step-breakdown";
import { SessionReaderStepDetail } from "./step/session-reader-step-detail";
import { useFillToViewBottom } from "./use-fill-to-view-bottom";
import { useTraceVisibility } from "./use-trace-visibility";
import { getWaterfallFilterOptions } from "./waterfall/session-reader-waterfall-rows";

export const TurnTrace = memo(function TurnTrace({
	agent,
	body,
	foot,
	head,
	laterBodies,
	model,
	store,
	turn,
}: {
	agent?: string;
	body: SessionReaderBody;
	head?: ReactNode | ((waterfall: SessionReaderWaterfall) => ReactNode);
	foot?: ReactNode;
	laterBodies?: readonly SessionReaderBody[];
	model: string | null;
	store: RunUiStore;
	turn: SessionDetailTurnSummary;
}) {
	const turnId = turn.turnId;
	const ui = useRunUi(store, turnId);
	const models = useSubagentModels();
	const counting = useCountedAgents(turn);
	const focused = useIsFocusedTurn(store, turnId);
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const seen = useTraceVisibility(root);
	const branches = useReaderSubagentBranches(body, true, {
		focus: agent,
		priority:
			agent !== undefined
				? BODY_PRIORITY.urgent
				: seen === "visible"
					? BODY_PRIORITY.visible
					: seen === "near"
						? BODY_PRIORITY.near
						: BODY_PRIORITY.background,
	});
	useSubagentHoverPrefetch(root);
	const ci = useTurnCi(turn);
	const hidden = useReaderHidden();
	const waterfall = useMemo(() => {
		const base = getReaderWaterfall(body, turn, model, branches);
		if (!base) return null;
		if (!agent)
			return withoutHiddenSteps(withRunCi(base, ci, Date.now()), hidden);
		const launch = base.allSteps.find((step) => subagentIdOf(step) === agent);
		if (!launch || launch.children.length === 0) return null;
		return withoutHiddenSteps(
			{
				allSteps: flattenSteps(launch.children),
				endMs: launch.endMs,
				model: models.get(agent) ?? launch.model ?? base.model,
				startMs: launch.startMs,
				steps: launch.children,
			},
			hidden,
		);
	}, [agent, body, branches, turn, model, ci, models, hidden]);
	const filterOptions = useMemo(
		() => getWaterfallFilterOptions(waterfall?.allSteps ?? []),
		[waterfall],
	);
	const exchanges = useMemo(() => {
		if (!agent) return undefined;
		const base = getReaderWaterfall(body, turn, model, branches);
		const launch =
			base?.allSteps.find((step) => subagentIdOf(step) === agent) ?? null;
		return {
			list: getSubagentExchanges([body, ...(laterBodies ?? [])], agent, launch),
			subagentId: agent,
		};
	}, [agent, body, laterBodies, branches, turn, model]);
	useWarmStepDetail(
		seen === "visible" || agent !== undefined ? waterfall : null,
	);
	const [lanesSlot, setLanesSlot] = useState<HTMLDivElement | null>(null);
	const [subagentSlot, setSubagentSlot] = useState<HTMLDivElement | null>(null);
	const [runningSlot, setRunningSlot] = useState<HTMLDivElement | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [card, setCard] = useState<HTMLDivElement | null>(null);
	useFillToViewBottom(
		card,
		focused &&
			ui.picked &&
			(waterfall?.allSteps.some((each) => each.id === ui.selected) ?? false),
	);
	const [launchedSlot, setLaunchedSlot] = useState<HTMLDivElement | null>(null);
	const run = useMemo(
		(): ComponentProps<typeof SessionReaderStepDetail>["run"] => ({
			filter: ui.filter,
			filterOptions,
			marks: getReaderTurnMarks(turn, body),
			onToggleFilter: (key) =>
				store.update(turnId, (state) => ({
					filter: toggleFilterKey(state.filter, key),
					open: true,
				})),
			turn,
		}),
		[ui.filter, filterOptions, turn, body, store, turnId],
	);
	if (!waterfall) return foot ?? null;
	const headNode = typeof head === "function" ? head(waterfall) : head;
	const step =
		focused && ui.picked
			? (waterfall.allSteps.find((candidate) => candidate.id === ui.selected) ??
				null)
			: null;
	const subagentsAtStep =
		step !== null &&
		waterfall.steps.some(
			(each) =>
				each.kind === "agent" &&
				each.startMs <= step.endMs &&
				each.endMs >= step.startMs,
		);
	return (
		<div
			ref={setRoot}
			data-turn-trace=""
			className="grid gap-[calc(var(--space-xxl)*4/3)] xl:grid-cols-[minmax(0,1fr)_3.5rem_var(--reader-card)]"
		>
			<div className="isolate flex min-w-0 flex-col gap-xl pl-[calc(var(--space-xxl)*1.5)]">
				{headNode ? (
					<div className="-ml-[calc(var(--space-xxl)*1.5)] xl:hidden">
						{headNode}
					</div>
				) : null}
				<LaunchedSubagentsContext.Provider value={agent ? null : launchedSlot}>
					<TraceAttempts
						exchanges={exchanges}
						lanesSlot={lanesSlot}
						model={model}
						onlyPickedLane={step !== null && expanded}
						runningSlot={runningSlot}
						subagentSlot={subagentSlot}
						run={run}
						store={store}
						turnId={turnId}
						usage={turn.usageCalls}
						waterfall={waterfall}
					/>
				</LaunchedSubagentsContext.Provider>
				{foot ? (
					<div className="-ml-[calc(var(--space-xxl)*1.5)]">{foot}</div>
				) : null}
			</div>
			<div className="hidden min-w-0 self-stretch xl:col-start-3 xl:-mr-(--scrollbar,0px) xl:block">
				<div
					{...KEEPS_PICK_MARK}
					className="sticky top-[calc(var(--reader-pane-top,var(--reader-top,1rem))+var(--frozen-subagents,0px))] flex flex-col"
				>
					<div
						ref={setCard}
						className={cn(
							"flex flex-col overflow-hidden",
							"corner-m corner-squircle",
							"bg-surface shadow-card",
							"squircle:corner-xl",
							step &&
								"h-[calc(100cqh-var(--reader-pane-top,var(--reader-top,1rem))-var(--frozen-subagents,0px)-0.5rem)]",
						)}
					>
						{headNode ? (
							<div className="shrink-0 edge-b-m border-line px-l py-[calc(var(--space-m)+var(--space-xxs))]">
								{headNode}
							</div>
						) : null}
						{headNode && step ? (
							<div className="shrink-0 edge-b-m border-line px-l py-m">
								<StepBreakdowns
									model={model}
									step={step}
									turn={turn}
									waterfall={waterfall}
								/>
							</div>
						) : null}
						{headNode && !step ? (
							<div
								className={cn(
									"grid shrink-0 gap-xl",
									"edge-b-m px-l py-m",
									"border-line",
									"empty:hidden",
									agent ? "grid-cols-2" : "grid-cols-4",
								)}
							>
								<RunTimeBreakdown
									waterfall={waterfall}
									counts={counting.counts}
								/>
								{agent ? null : (
									<RunCostBreakdown
										calls={turn.usageCalls}
										model={model}
										subagents={counting.subagents}
										total={counting.cost}
									/>
								)}
								{agent ? null : (
									<RunTokenBreakdown
										calls={turn.usageCalls}
										subagents={counting.subagents}
									/>
								)}
								<RunStepBreakdown
									waterfall={waterfall}
									counts={counting.counts}
								/>
							</div>
						) : null}
						<div
							ref={setLanesSlot}
							className={cn(
								"shrink-0 px-m pb-s",
								step && expanded ? "pt-xl" : "pt-m",
							)}
						/>
						<div
							ref={setRunningSlot}
							className={cn(
								"shrink-0 edge-t-m border-line px-l py-m empty:hidden",
								(!subagentsAtStep || expanded) && "hidden",
							)}
						/>
						<div
							ref={setSubagentSlot}
							className={cn(
								"shrink-0 edge-t-m border-line px-m py-m empty:hidden",
								step && "hidden",
							)}
						/>
						{step ? (
							<div className="flex min-h-0 flex-1 flex-col edge-t-m border-line">
								<SessionReaderStepDetail
									bare
									expanded={expanded}
									fit
									onExpand={setExpanded}
									run={run}
									step={step}
									waterfall={waterfall}
								/>
							</div>
						) : null}
					</div>
					<div
						ref={setLaunchedSlot}
						className={cn(
							"flex shrink-0 flex-col gap-l empty:hidden",
							step ? "mt-[calc(var(--space-xxl)*4/3)]" : "mt-l",
						)}
					/>
				</div>
			</div>
		</div>
	);
});
