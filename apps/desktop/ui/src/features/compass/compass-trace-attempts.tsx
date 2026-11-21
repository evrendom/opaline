import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import {
	type ComponentProps,
	type CSSProperties,
	memo,
	type ReactNode,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import { createPortal } from "react-dom";
import { measureAttempts } from "@/features/sessions/reader/detail/reader-attempt-measure";
import {
	ReaderLayoutContext,
	useMeasuringTurn,
} from "@/features/sessions/reader/detail/reader-layout";
import { AssistantResponse } from "@/features/sessions/reader/detail/session-reader-assistant-response";
import { scrollToCenter } from "@/features/sessions/reader/detail/session-reader-jump-pill";
import { ModelAvatar } from "@/features/sessions/reader/detail/session-reader-model-avatar";
import { TipLayer } from "@/features/sessions/reader/detail/waterfall/session-reader-tips";
import { SessionReaderWaterfallView } from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall";
import {
	flattenSteps,
	type SessionReaderStep,
	type SessionReaderWaterfall,
} from "@/features/sessions/reader/model/session-reader-run-steps";
import {
	type RunUiStore,
	useRunUi,
} from "@/features/sessions/reader/model/session-reader-run-ui-store";
import { readerScrollerOf } from "@/features/sessions/reader/reader-dom";
import type { SubagentEnd } from "@/features/sessions/reader/subagents/session-reader-subagent-done";
import {
	reportingSubagentOf,
	SubagentTints,
	useSubagentFinishes,
	useSubagentTintById,
} from "@/features/sessions/reader/subagents/session-reader-subagent-tints";
import { cn } from "@/lib/utils";
import { AttemptPlaceholder, useSeenAttempts } from "./attempt-placeholder";
import { RunLanes } from "./compass-run-lanes";
import { withSubagentEnds } from "./subagent-ends";
import {
	SubagentAvatar,
	type SubagentExchange,
	SubagentMessage,
	tintedGround,
} from "./subagent-exchanges";
import { type Attempt, getAttempts } from "./trace-attempts";
import { useTraceWhole } from "./use-trace-whole";

function interleave(
	attempts: readonly Attempt[],
	exchanges: readonly SubagentExchange[],
): (
	| { attempt: Attempt; exchange?: undefined; index: number }
	| { attempt?: undefined; exchange: SubagentExchange; index?: undefined }
)[] {
	const out: ReturnType<typeof interleave> = [];
	let next = 0;
	attempts.forEach((attempt, index) => {
		while (
			next < exchanges.length &&
			(exchanges[next]?.atMs ?? 0) < attempt.startMs
		)
			out.push({ exchange: exchanges[next++] as SubagentExchange });
		out.push({ attempt, index });
	});
	while (next < exchanges.length)
		out.push({ exchange: exchanges[next++] as SubagentExchange });
	return out;
}

export const TraceAttempts = memo(function TraceAttempts({
	exchanges,
	lanesSlot,
	onlyPickedLane = false,
	runningSlot,
	subagentSlot,
	model,
	run,
	store,
	turnId,
	usage,
	waterfall,
}: {
	exchanges?: { list: readonly SubagentExchange[]; subagentId: string };
	lanesSlot: HTMLElement | null;
	onlyPickedLane?: boolean;
	subagentSlot?: HTMLElement | null;
	runningSlot?: HTMLElement | null;
	model: string | null;
	run: ComponentProps<typeof SessionReaderWaterfallView>["run"];
	store: RunUiStore;
	turnId: string;
	usage: SessionDetailTurnSummary["usageCalls"];
	waterfall: SessionReaderWaterfall;
}) {
	const finishes = useSubagentFinishes();
	const ends = useMemo(
		() => withSubagentEnds(waterfall.steps, waterfall.endMs, finishes),
		[waterfall.steps, waterfall.endMs, finishes],
	);
	const attempts = useMemo(() => getAttempts(ends.steps), [ends.steps]);
	const ui = useRunUi(store, turnId);
	const listRef = useRef<HTMLOListElement>(null);
	const attemptOf = useMemo(() => {
		const out = new Map<string, string>();
		const walk = (step: Attempt["steps"][number], id: string) => {
			out.set(step.id, id);
			for (const child of step.children) walk(child, id);
		};
		for (const attempt of attempts)
			for (const step of attempt.steps) walk(step, attempt.id);
		return out;
	}, [attempts]);
	const pick = useCallback(
		(stepId: string) => store.pick(turnId, stepId),
		[store, turnId],
	);
	const selection = useMemo(
		() => ({ onSelect: pick, selected: ui.selected, shown: true }),
		[pick, ui.selected],
	);
	const onPickLane = useCallback(
		(stepId: string) => {
			pick(stepId);
			requestAnimationFrame(() =>
				requestAnimationFrame(() => {
					const list = listRef.current;
					const row = list?.querySelector<HTMLElement>("[data-active-row]");
					const scroller = readerScrollerOf(list);
					if (row && scroller) scrollToCenter(scroller, row, 1 / 3);
					else
						list
							?.querySelector(`[data-attempt="${attemptOf.get(stepId)}"]`)
							?.scrollIntoView({ behavior: "smooth", block: "nearest" });
				}),
			);
		},
		[pick, attemptOf],
	);
	const {
		isSeen,
		listRef: watchList,
		watch,
	} = useSeenAttempts(listRef, waterfall.allSteps.length);
	const pickedAttempt = attemptOf.get(ui.selected);
	const layout = useContext(ReaderLayoutContext);
	const measuring = useMeasuringTurn(exchanges ? undefined : turnId);
	const whole = useTraceWhole(waterfall.allSteps);
	useLayoutEffect(() => {
		if (!exchanges) layout?.setWhole(turnId, whole);
	}, [layout, turnId, whole, exchanges]);
	useLayoutEffect(() => {
		if (!measuring || !layout || !listRef.current) return;
		if (!whole && layout.defer(turnId)) return;
		measureAttempts(listRef.current, layout.shapes);
		layout.done(turnId);
	}, [measuring, layout, turnId, whole]);
	const rowsKey = `${waterfall.steps.length}:${attempts.map((attempt) => attempt.steps.length).join()}`;
	const laidOutWith = useRef(rowsKey);
	useLayoutEffect(() => {
		if (laidOutWith.current === rowsKey) return;
		laidOutWith.current = rowsKey;
		if (!exchanges) layout?.invalidate(turnId);
	}, [rowsKey, layout, turnId, exchanges]);
	const subagentEnds = useMemo(
		() =>
			new Map<string, SubagentEnd>(
				waterfall.steps.flatMap((step) =>
					step.kind === "agent"
						? [[step.id, { until: ends.finishedRow.get(step.id) ?? null }]]
						: [],
				),
			),
		[waterfall.steps, ends],
	);
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
	return (
		<SubagentTints ids={subagentIds}>
			<TipLayer>
				<div
					data-trace=""
					className="relative flex flex-col gap-[calc(var(--space-xl)+var(--space-xs))]"
				>
					{lanesSlot
						? createPortal(
								<RunLanes
									onlyPickedLane={onlyPickedLane}
									onPick={onPickLane}
									selected={ui.selected}
									runningSlot={runningSlot}
									subagentSlot={subagentSlot}
									trace={listRef}
									usage={usage}
									waterfall={waterfall}
								/>,
								lanesSlot,
							)
						: null}
					<ol ref={watchList} className="flex flex-col gap-m">
						{interleave(
							attempts.filter((attempt) => !attempt.answer),
							exchanges?.list ?? [],
						).map(({ attempt, exchange, index }) =>
							exchange ? (
								<li key={`exchange:${exchange.atMs}:${exchange.direction}`}>
									<SubagentMessage
										exchange={exchange}
										model={model}
										subagentId={exchanges?.subagentId ?? ""}
									/>
								</li>
							) : measuring ||
								isSeen(attempt.id) ||
								attempt.id === pickedAttempt ? (
								<AttemptWaterfall
									key={attempt.id}
									agent={exchanges?.subagentId}
									attempt={attempt}
									model={model}
									run={run}
									startMs={index === 0 ? waterfall.startMs : attempt.startMs}
									selection={selection}
									subagentEnds={subagentEnds}
								/>
							) : (
								<AttemptPlaceholder
									key={attempt.id}
									attempt={attempt}
									watch={watch}
								/>
							),
						)}
					</ol>
				</div>
			</TipLayer>
		</SubagentTints>
	);
});

const AttemptWaterfall = memo(function AttemptWaterfall({
	agent,
	attempt,
	model,
	run,
	selection,
	startMs,
	subagentEnds,
}: {
	agent?: string;
	attempt: Attempt;
	model: string | null;
	run: ComponentProps<typeof SessionReaderWaterfallView>["run"];
	selection: ComponentProps<typeof SessionReaderWaterfallView>["selection"];
	subagentEnds: ReadonlyMap<string, SubagentEnd>;
	startMs: number;
}) {
	const agentTint = useSubagentTintById()(agent);
	const saidMs = attempt.saidStep?.startMs ?? startMs;
	const [before, after] = useMemo(() => {
		const at = attempt.saidStep ? attempt.steps.indexOf(attempt.saidStep) : -1;
		return [
			attempt.steps.slice(0, Math.max(at, 0)),
			attempt.steps.slice(at + 1),
		];
	}, [attempt]);
	return (
		<li data-attempt={attempt.id} className="flex flex-col gap-l">
			<AttemptSteps
				endMs={saidMs}
				model={model}
				rails={{ above: "0.5rem", below: "0.75rem" }}
				run={run}
				selection={selection}
				subagentEnds={subagentEnds}
				startMs={startMs}
				steps={before}
			/>
			<div className="flex gap-l" style={{ marginLeft: `-${AVATAR_COLUMN}` }}>
				<span className="mt-s h-fit shrink-0">
					{agent ? (
						<SubagentAvatar subagentId={agent} />
					) : (
						<ModelAvatar flat loading={false} model={model} />
					)}
				</span>
				<Bubble tint={agentTint}>
					{attempt.said ? (
						<AssistantResponse text={attempt.said} />
					) : (
						<p className="px-xs text-body-xl text-ink-3 italic">
							{attempt.intent ?? "Worked without saying what for."}
						</p>
					)}
				</Bubble>
			</div>
			<AttemptSteps
				endMs={attempt.endMs}
				model={model}
				rails={{ above: "0.75rem", below: "0.5rem" }}
				run={run}
				selection={selection}
				subagentEnds={subagentEnds}
				startMs={saidMs}
				steps={after}
			/>
		</li>
	);
});

const AVATAR_COLUMN = "2.25rem";
const STEP_ROW_INDENT_PX = 12;
const STEP_CHIP_HALF_NARROWER_PX = 3;

function AttemptSteps({
	endMs,
	model,
	rails,
	run,
	selection,
	startMs,
	steps,
	subagentEnds,
}: {
	endMs: number;
	model: string | null;
	rails: { above: string; below: string };
	run: ComponentProps<typeof SessionReaderWaterfallView>["run"];
	selection: ComponentProps<typeof SessionReaderWaterfallView>["selection"];
	startMs: number;
	steps: SessionReaderStep[];
	subagentEnds: ReadonlyMap<string, SubagentEnd>;
}) {
	const waterfall = useMemo<SessionReaderWaterfall>(
		() => ({
			allSteps: flattenSteps(steps),
			endMs: Math.max(endMs, startMs + 1),
			model,
			startMs,
			steps,
		}),
		[endMs, model, startMs, steps],
	);
	if (steps.length === 0) return null;
	return (
		<div
			style={
				{
					"--rails-above": rails.above,
					"--rails-below": rails.below,
					marginLeft: `calc(-1 * (${AVATAR_COLUMN} + ${STEP_ROW_INDENT_PX - STEP_CHIP_HALF_NARROWER_PX}px))`,
				} as CSSProperties
			}
		>
			<SessionReaderWaterfallView
				bare
				keepOut={waterfall.allSteps.map((step) => step.id)}
				run={run}
				selection={selection}
				subagentsWhole={subagentEnds}
				waterfall={waterfall}
			/>
		</div>
	);
}

function Bubble({
	children,
	tint,
}: {
	children: ReactNode;
	tint?: string | null;
}) {
	return (
		<div
			className={cn(
				"min-w-0 flex-1 corner-m px-l py-[calc(var(--space-m)+var(--space-xxs))] corner-squircle squircle:corner-xl-inner",
				// design-escape-ok(colour,opacity): shipped value; black/[0.025] (white/[0.04] in dark)
				!tint && "bg-black/[0.025] dark:bg-white/[0.04]",
			)}
			style={tint ? tintedGround(tint) : undefined}
		>
			{children}
		</div>
	);
}
