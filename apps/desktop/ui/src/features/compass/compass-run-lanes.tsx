import {
	IconAlertTriangle,
	IconArrowUpRight,
	IconChevronDown,
	IconChevronUp,
} from "@tabler/icons-react";
import {
	type CSSProperties,
	Fragment,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { TipLayer } from "@/features/sessions/reader/detail/waterfall/session-reader-tips";
import {
	formatDuration,
	formatRanOn,
	OpalChip,
	Tip,
} from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips";
import { barGeometry } from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall-layout";
import type { SessionReaderWaterfall } from "@/features/sessions/reader/model/session-reader-run-steps";
import {
	chipLaneKey,
	LANE_LOOK,
	type LaneLook,
	laneKeysOf,
} from "@/features/sessions/reader/model/session-reader-step-lanes";
import {
	subagentIdOf,
	useOpenSubagent,
} from "@/features/sessions/reader/subagents/session-reader-agent-focus";
import {
	FrozenSubagentsContext,
	LaunchedSubagentsContext,
} from "@/features/sessions/reader/subagents/session-reader-frozen-subagents";
import {
	type SubagentTalk,
	useSubagentTalks,
} from "@/features/sessions/reader/subagents/session-reader-subagent-talks";
import {
	useSubagentFinishes,
	useSubagentTintOf,
} from "@/features/sessions/reader/subagents/session-reader-subagent-tints";
import { useSubagentsCounted } from "@/features/sessions/reader/subagents/session-reader-subagents-counted";
import { cn } from "@/lib/utils";
import { ContextLane, type UsageCall } from "./run-lanes-context";
import {
	ciOutcomeTint,
	classTint,
	formatPreciseOffset,
	getLanes,
	getSubagentGroups,
	type Lane,
	ranOnPast,
	type Span,
	SUBAGENT_LANE,
	type SubagentGroup,
} from "./run-lanes-model";
import { useSharedWidth } from "./shared-width";
import { useTraceWindow } from "./use-trace-window";

function LaneMark({
	label,
	look,
	opens = false,
	state,
	tint,
}: {
	label: string;
	look: LaneLook;
	opens?: boolean;
	state: "empty" | "faded" | "picked" | "rest";
	tint?: string | null;
}) {
	const Glyph = look.glyph;
	const glyph = opens ? (
		<span className="grid place-items-center *:col-start-1 *:row-start-1 *:transition-[opacity,scale] *:duration-(--motion-duration) *:ease-out">
			<Glyph
				aria-hidden="true"
				className="size-2.5 group-hover/open:scale-50 group-hover/open:opacity-0 group-focus-visible/open:scale-50 group-focus-visible/open:opacity-0"
			/>
			<IconArrowUpRight
				aria-hidden="true"
				className="size-3 scale-50 opacity-0 group-hover/open:scale-100 group-hover/open:opacity-100 group-focus-visible/open:scale-100 group-focus-visible/open:opacity-100"
			/>
		</span>
	) : (
		<Glyph aria-hidden="true" className="size-2.5" />
	);
	return (
		<OpalChip
			tint={tint ?? look.tint}
			title={label}
			className={cn(
				"size-4 text-(--opal-tint) transition-[opacity,scale,filter]",
				state === "picked" && "scale-110",
				state === "faded" && "opacity-35 saturate-[0.15]",
				state === "empty" && "opacity-30 grayscale",
			)}
		>
			{glyph}
		</OpalChip>
	);
}

function opalLight(tint: string): CSSProperties {
	return {
		boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tint} 55%, white 25%)`,
		filter: `drop-shadow(0 1px 1.5px color-mix(in oklab, ${tint} 45%, transparent))`,
	};
}

const OPEN_TAIL = "3%";

const DRAG_PX = 4;

const SNAP_PX = 5;

function LaterTalks({
	after,
	children,
	subagentId,
}: {
	after: number;
	children: (talks: readonly SubagentTalk[]) => ReactNode;
	subagentId: string | null;
}) {
	const talks = useSubagentTalks(subagentId);
	return children(talks.filter((talk) => talk.atMs > after));
}

function GroupGap() {
	return <div aria-hidden="true" className="h-1.5" />;
}

const AgentGlyph = LANE_LOOK.agent.glyph;

const TRACE_WINDOW =
	"pointer-events-none absolute -top-1.5 -bottom-0.5 -z-5 hidden corner-xs bg-canvas corner-squircle squircle:corner-l shadow-[0_1px_2px_rgb(0_0_0/0.06),0_2px_8px_-2px_rgb(0_0_0/0.08)] ring-1 ring-zinc-950/10 will-change-transform dark:bg-hover-strong dark:shadow-none dark:ring-white/15";

export function RunLanes({
	onlyPickedLane = false,
	onPick,
	runningSlot,
	selected,
	subagentSlot,
	trace,
	usage,
	waterfall,
}: {
	onlyPickedLane?: boolean;
	onPick: (stepId: string) => void;
	runningSlot?: HTMLElement | null;
	selected: string;
	subagentSlot?: HTMLElement | null;
	trace?: RefObject<HTMLElement | null>;
	usage?: readonly UsageCall[];
	waterfall: SessionReaderWaterfall;
}) {
	const runSpan = { from: waterfall.startMs, to: waterfall.endMs };
	const tintOfStep = useSubagentTintOf();
	const stepById = useMemo(
		() => new Map(waterfall.allSteps.map((step) => [step.id, step])),
		[waterfall.allSteps],
	);
	const tintOf = (stepId: string) => {
		const step = stepById.get(stepId);
		return step ? tintOfStep(step) : null;
	};
	const [zoom, setZoom] = useState<Span | null>(null);
	const [brush, setBrush] = useState<Span | null>(null);
	const view = zoom ?? runSpan;
	const total = Math.max(view.to - view.from, 1);
	const trackRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{ x: number; dragging: boolean } | null>(null);
	const everyLane = getLanes(waterfall);
	const compactions = useMemo(
		() => waterfall.steps.filter((step) => step.harness === "compaction"),
		[waterfall.steps],
	);
	const [allLanes, setAllLanes] = useState(false);
	const unused = everyLane.filter((lane) => lane.bars.length === 0).length;
	const lanes = allLanes
		? everyLane
		: everyLane.filter((lane) => lane.bars.length > 0);
	const apart = subagentSlot !== undefined;
	const agentGroups = useMemo(
		() => (apart ? getSubagentGroups(waterfall) : []),
		[apart, waterfall],
	);
	const withSubagents = useSubagentsCounted();
	const talksLane: Lane | null =
		!withSubagents && agentGroups.length > 0
			? {
					bars: agentGroups
						.flatMap((group) => group.head.bars)
						.sort((a, b) => a.from - b.from),
					counts: agentGroups.reduce(
						(sum, group) =>
							sum +
							(typeof group.head.counts === "number" ? group.head.counts : 0),
						0,
					),
					id: "subagents",
					key: "agent",
					label: "Subagents",
				}
			: null;
	const ownLanes = apart
		? [
				...lanes.filter((lane) => lane.key !== "agent"),
				...(talksLane ? [talksLane] : []),
			]
		: lanes;
	const frozenSlot = useContext(FrozenSubagentsContext);
	const launchedSlot = useContext(LaunchedSubagentsContext);
	const finishes = useSubagentFinishes();
	const outliving = useMemo(
		() =>
			frozenSlot && launchedSlot && withSubagents
				? agentGroups.flatMap((group) => {
						const step = stepById.get(group.id);
						if (!step) return [];
						const id = subagentIdOf(step);
						const endMs = Math.max(
							step.endMs,
							(id ? finishes?.get(id) : undefined) ?? 0,
							...group.head.bars.map((bar) => bar.to),
						);
						return endMs - waterfall.endMs >= 1_000
							? [
									{
										base: step.startMs,
										clock: { from: step.startMs, to: endMs },
										group,
										subagentId: id,
									},
								]
							: [];
					})
				: [],
		[
			frozenSlot,
			launchedSlot,
			withSubagents,
			agentGroups,
			stepById,
			waterfall.endMs,
			finishes,
		],
	);
	const frozen = new Set(outliving.map((each) => each.group.id));
	const cardGroups = withSubagents
		? agentGroups.filter((group) => !frozen.has(group.id))
		: [];
	const openSubagent = useOpenSubagent();
	const pickedLanes = new Set(
		[...lanes, ...agentGroups.map((group) => group.head)]
			.filter((lane) => lane.bars.some((bar) => bar.stepId === selected))
			.map((lane) => lane.id),
	);
	const anyPicked = pickedLanes.size > 0;
	const shownLanes =
		onlyPickedLane && anyPicked
			? ownLanes.filter((lane) => pickedLanes.has(lane.id))
			: ownLanes;
	const narrowed = shownLanes !== ownLanes;
	const agentTrackRef = useRef<HTMLDivElement>(null);
	const edges = useMemo(
		() =>
			[...lanes, ...agentGroups.map((group) => group.head)].flatMap((lane) =>
				lane.bars.flatMap((bar) => [bar.from, bar.to]),
			),
		[lanes, agentGroups],
	);
	const msAt = (
		clientX: number,
		track: RefObject<HTMLDivElement | null> = trackRef,
		snap = false,
	) => {
		const box = track.current?.getBoundingClientRect();
		if (!box) return view.from;
		const fraction = Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
		const ms = view.from + fraction * total;
		if (!snap || box.width <= 0) return ms;
		const reach = (SNAP_PX / box.width) * total;
		let best = ms;
		let bestGap = reach;
		for (const edge of edges) {
			const gap = Math.abs(edge - ms);
			if (gap <= bestGap && edge >= view.from && edge <= view.to) {
				best = edge;
				bestGap = gap;
			}
		}
		return best;
	};
	const pct = (ms: number) => ((ms - view.from) / total) * 100;
	const offset = (ms: number) => `+${formatDuration(ms - runSpan.from)}`;
	const marksColumn = useSharedWidth();
	const [windowRef, agentWindowRef, runningRef] = useTraceWindow(
		trace,
		waterfall,
		view,
	);
	const launched = waterfall.steps.filter((step) => step.kind === "agent");
	const trackEvents = (track: RefObject<HTMLDivElement | null>) => ({
		onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
			drag.current = { dragging: false, x: event.clientX };
		},
		onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
			const start = drag.current;
			if (!start) return;
			if (!start.dragging && Math.abs(event.clientX - start.x) < DRAG_PX)
				return;
			if (!start.dragging)
				event.currentTarget.setPointerCapture(event.pointerId);
			start.dragging = true;
			const [a, b] = [
				msAt(start.x, track, true),
				msAt(event.clientX, track, true),
			];
			setBrush({ from: Math.min(a, b), to: Math.max(a, b) });
		},
		onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
			const start = drag.current;
			drag.current = null;
			if (start?.dragging) {
				if (brush && brush.to - brush.from > 0) setZoom(brush);
				setBrush(null);
				return;
			}
			const hit =
				event.target instanceof HTMLElement
					? event.target.closest<HTMLElement>("[data-step]")?.dataset.step
					: undefined;
			if (hit) onPick(hit);
			else setZoom(null);
		},
	});
	const failedIn = (lane: Lane) =>
		lane.failed ??
		new Set(
			lane.bars
				.filter((bar) => {
					const step = stepById.get(bar.stepId);
					if (!step?.isError) return false;
					return (
						laneKeysOf(step).length === 0 || chipLaneKey(step) === lane.key
					);
				})
				.map((bar) => bar.stepId),
		).size;
	const renderMark = (lane: Lane, agent?: string, onOpen?: () => void) => {
		const mark = (
			<LaneMark
				opens={onOpen !== undefined}
				label={lane.label}
				look={LANE_LOOK[lane.key]}
				tint={
					lane.id.startsWith(SUBAGENT_LANE)
						? tintOf(lane.id.slice(SUBAGENT_LANE.length))
						: agent && lane.key === "model"
							? tintOf(agent)
							: lane.key === "ci"
								? ciOutcomeTint(lane.bars)
								: null
				}
				state={
					lane.bars.length === 0
						? "empty"
						: pickedLanes.has(lane.id)
							? "picked"
							: anyPicked
								? "faded"
								: "rest"
				}
			/>
		);
		return (
			<div key={lane.id} className="flex h-4 items-center gap-xs">
				{onOpen ? (
					<button
						type="button"
						aria-label={`Open ${lane.label}'s thread`}
						onClick={onOpen}
						className="group/open flex corner-full"
					>
						{mark}
					</button>
				) : (
					mark
				)}
				{lane.bars.length > 0 && lane.counts !== "none" ? (
					<span className="text-body-m text-ink-3 tabular-nums">
						{lane.counts === "bars"
							? new Set(lane.bars.map((bar) => bar.stepId)).size
							: lane.counts}
					</span>
				) : null}
				{lane.counts !== "none" && failedIn(lane) > 0 ? (
					<Tip label={`${failedIn(lane)} failed`}>
						<span
							role="img"
							aria-label={`${failedIn(lane)} failed`}
							className={cn(
								"inline-flex shrink-0 items-center gap-xxs",
								"text-body-m tabular-nums",
								"text-error transition-[opacity,filter] duration-200",
								anyPicked &&
									!pickedLanes.has(lane.id) &&
									"opacity-35 saturate-[0.15]",
							)}
						>
							<IconAlertTriangle aria-hidden="true" className="size-3" />
							{failedIn(lane)}
						</span>
					</Tip>
				) : null}
			</div>
		);
	};
	const renderHead = (group: SubagentGroup) => {
		const step = stepById.get(group.id);
		const subagentId = step ? subagentIdOf(step) : null;
		return renderMark(
			group.head,
			undefined,
			openSubagent && subagentId ? () => openSubagent(subagentId) : undefined,
		);
	};
	const renderLane = (
		lane: Lane,
		agent?: string,
		clock?: Span,
		base?: number,
	) => {
		const agentTint = agent ? tintOf(agent) : null;
		const on = clock ?? view;
		const onTotal = Math.max(on.to - on.from, 1);
		const ends = clock ?? runSpan;
		return (
			<div
				key={lane.id}
				className={cn(
					"relative h-4 overflow-hidden",
					"corner-xs",
					"before:absolute before:inset-0 before:-z-10 before:bg-field/60",
				)}
			>
				{lane.bars.map((bar) => {
					if (base === undefined && (bar.to < on.from || bar.from > on.to))
						return null;
					const at = barGeometry(
						Math.max(bar.from, on.from),
						Math.min(bar.to, on.to),
						on.from,
						onTotal,
					);
					const ranOnMs = on.to >= ends.to ? bar.to - ends.to : 0;
					const runsOn = base === undefined && !bar.open && ranOnMs >= 1_000;
					const own = bar.className.includes("bg-rose")
						? null
						: (tintOf(bar.stepId) ??
							(agentTint && /\bbg-violet-/u.test(bar.className)
								? agentTint
								: null));
					return (
						<span
							key={`${bar.stepId}:${bar.from}`}
							data-step={bar.stepId}
							className={cn(
								"absolute inset-y-[2px] flex min-w-[2px] items-center overflow-hidden",
								"corner-xs",
								"hover:brightness-110",
								own ? null : bar.className,
								"transition-[opacity,filter] duration-200",
								bar.stepId === selected &&
									"z-10 ring-2 ring-white/90 ring-inset",
								anyPicked &&
									bar.stepId !== selected &&
									"opacity-35 saturate-[0.15]",
								bar.open &&
									"[mask-image:linear-gradient(to_right,black_60%,transparent)]",
								runsOn &&
									"inset-y-[7px] [mask-image:repeating-linear-gradient(to_right,#000_0_3px,transparent_3px_5px)]",
								base !== undefined &&
									"transition-[left,width,opacity,filter] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
							)}
							style={{
								...(own ? { backgroundColor: own } : {}),
								...(bar.stepId === selected
									? opalLight(own ?? classTint(bar.className))
									: {}),
								left:
									base === undefined
										? `${at.offset}%`
										: `calc(100% * (${bar.from - base} - var(--clock-from)) / var(--clock-span))`,
								width: bar.open
									? OPEN_TAIL
									: base === undefined
										? `${at.width}%`
										: `calc(100% * ${bar.to - bar.from} / var(--clock-span))`,
							}}
						>
							{bar.name && !bar.open && at.width > 18 ? (
								<span className="pointer-events-none truncate pl-xs font-data text-body-xxs leading-none text-white">
									{bar.name}
								</span>
							) : null}
						</span>
					);
				})}
				{base === undefined &&
				on.to >= ends.to &&
				ranOnPast(lane.bars, ends.to) >= 1_000 ? (
					<span
						className={cn(
							"absolute top-1/2 right-0.5",
							"corner-xs px-xxs",
							"text-body-xxs tabular-nums",
							"pointer-events-none -translate-y-1/2 bg-canvas/90 text-ink-3",
						)}
					>
						+{formatRanOn(ranOnPast(lane.bars, ends.to))}
					</span>
				) : null}
			</div>
		);
	};
	const renderFrozen = (
		{ base, group, subagentId }: (typeof outliving)[number],
		launched: boolean,
	) => (
		<div
			key={group.id}
			{...(launched
				? { "data-launched-subagent": group.id }
				: {
						"data-clock-base": base,
						"data-frozen-subagent": group.id,
						"data-launch-from": view.from,
						"data-launch-to": view.to,
					})}
			data-clock-from={view.from}
			data-clock-to={view.to}
			className={cn(
				"corner-m bg-card px-m py-m shadow-card corner-squircle squircle:corner-xl",
				!launched &&
					"pointer-events-auto sticky top-(--reader-pane-top,var(--reader-top,1rem))",
			)}
			style={
				{
					"--clock-from": view.from - base,
					"--clock-span": Math.max(view.to - view.from, 1),
				} as CSSProperties
			}
		>
			<div className="flex gap-s select-none">
				<div ref={marksColumn} className="flex shrink-0 flex-col gap-xxs">
					{renderHead(group)}
				</div>
				<div className="relative isolate flex min-w-0 flex-1 flex-col gap-xxs">
					<LaterTalks
						after={Math.max(
							waterfall.endMs,
							...group.head.bars.map((bar) => bar.to),
						)}
						subagentId={subagentId}
					>
						{(talks) =>
							renderLane(
								{
									...group.head,
									bars: [
										...group.head.bars,
										...talks.map((talk) => ({
											className:
												group.head.bars[1]?.className ??
												group.head.bars[0]?.className ??
												"",
											from: talk.atMs,
											stepId: group.id,
											title:
												talk.direction === "to-main"
													? "Reported to the run"
													: "Message from the run",
											to: talk.atMs,
										})),
									],
								},
								group.id,
								undefined,
								base,
							)
						}
					</LaterTalks>
					<span data-frozen-window="" className={TRACE_WINDOW} />
				</div>
			</div>
		</div>
	);
	return (
		<TipLayer delay={150}>
			<div
				data-run-from={view.from}
				data-run-to={view.to}
				className="flex gap-s select-none"
			>
				<div ref={marksColumn} className="flex shrink-0 flex-col gap-xxs">
					{shownLanes.map((lane) => renderMark(lane))}
					{usage && usage.length > 0 && !narrowed ? (
						<div className="flex h-8 items-center">
							<LaneMark label="Context" look={LANE_LOOK.context} state="rest" />
						</div>
					) : null}
					{unused > 0 && !narrowed ? (
						<div className="flex h-2 items-center justify-center pt-xxs">
							<button
								type="button"
								aria-pressed={allLanes}
								aria-label={
									allLanes
										? "Hide the lanes this run didn't use"
										: `Show all lanes, ${unused} this run didn't use`
								}
								title={
									allLanes
										? "Hide the lanes this run didn't use"
										: `Show all lanes, ${unused} this run didn't use`
								}
								onClick={() => setAllLanes((shown) => !shown)}
								className="inline-flex items-center corner-xs px-xxs text-ink-3/70 hover:bg-hover hover:text-ink"
							>
								{allLanes ? (
									<IconChevronUp aria-hidden="true" className="size-2.5" />
								) : (
									<IconChevronDown aria-hidden="true" className="size-2.5" />
								)}
							</button>
						</div>
					) : null}
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-xs">
					<div
						ref={trackRef}
						className="relative isolate flex cursor-crosshair touch-none flex-col gap-xxs"
						{...trackEvents(trackRef)}
					>
						{shownLanes.map((lane) => renderLane(lane))}
						{usage && usage.length > 0 && !narrowed ? (
							<ContextLane
								compactions={compactions}
								usage={usage}
								view={view}
							/>
						) : null}
						<span ref={windowRef} className={TRACE_WINDOW} />
						{brush ? (
							<span
								className="pointer-events-none absolute -inset-y-0.5 corner-xs edge-m border-ink/30 bg-ink/5"
								style={{
									left: `${pct(brush.from)}%`,
									width: `${pct(brush.to) - pct(brush.from)}%`,
								}}
							/>
						) : null}
					</div>
					<div className="relative flex justify-between gap-m px-xxs text-body-xxs leading-none text-ink-3/70 tabular-nums">
						<span className={cn(brush && "invisible")}>
							{offset(view.from)}
						</span>
						<span className={cn(brush && "invisible")}>
							{zoom
								? "zoomed · click empty to reset"
								: offset(view.from + total / 2)}
						</span>
						<span className={cn(brush && "invisible")}>{offset(view.to)}</span>
						{brush ? (
							<>
								<span
									className="absolute top-0 whitespace-nowrap"
									style={{
										left: `${pct(brush.from)}%`,
										transform: "translateX(calc(-100% - 2px))",
									}}
								>
									{formatPreciseOffset(brush.from - runSpan.from)}
								</span>
								<span
									className="absolute top-0 whitespace-nowrap"
									style={{
										left: `${pct(brush.to)}%`,
										transform: "translateX(2px)",
									}}
								>
									{formatPreciseOffset(brush.to - runSpan.from)}
								</span>
							</>
						) : null}
					</div>
				</div>
			</div>
			{withSubagents && launched.length > 0 && runningSlot
				? createPortal(
						<div
							ref={runningRef}
							className="flex flex-wrap items-center gap-xs"
						>
							{launched.map((step) => (
								<span
									key={step.id}
									data-from={step.startMs}
									data-to={step.endMs}
									className="flex transition-[opacity,filter]"
								>
									<OpalChip
										tint={tintOf(step.id) ?? LANE_LOOK.agent.tint}
										className="size-4 text-(--opal-tint)"
									>
										<AgentGlyph aria-hidden="true" className="size-2.5" />
									</OpalChip>
								</span>
							))}
							<span
								data-running-count=""
								className="ml-xs text-body-s text-ink-3 tabular-nums"
							/>
						</div>,
						runningSlot,
					)
				: null}
			{cardGroups.length > 0 && subagentSlot
				? createPortal(
						<TipLayer delay={150}>
							<div className="flex gap-s select-none">
								<div
									ref={marksColumn}
									className="flex shrink-0 flex-col gap-xxs"
								>
									{cardGroups.map((group, index) => (
										<Fragment key={group.id}>
											{index > 0 ? <GroupGap /> : null}
											{renderHead(group)}
										</Fragment>
									))}
								</div>
								<div
									ref={agentTrackRef}
									className="relative isolate flex min-w-0 flex-1 cursor-crosshair touch-none flex-col gap-xxs"
									{...trackEvents(agentTrackRef)}
								>
									{cardGroups.map((group, index) => (
										<Fragment key={group.id}>
											{index > 0 ? <GroupGap /> : null}
											{renderLane(group.head, group.id)}
										</Fragment>
									))}
									<span ref={agentWindowRef} className={TRACE_WINDOW} />
									{brush ? (
										<span
											className="pointer-events-none absolute -inset-y-0.5 corner-xs edge-m border-ink/30 bg-ink/5"
											style={{
												left: `${pct(brush.from)}%`,
												width: `${pct(brush.to) - pct(brush.from)}%`,
											}}
										/>
									) : null}
								</div>
							</div>
						</TipLayer>,
						subagentSlot,
					)
				: null}
			{outliving.length > 0 && launchedSlot
				? createPortal(
						<TipLayer delay={150}>
							{outliving.map((each) => renderFrozen(each, true))}
						</TipLayer>,
						launchedSlot,
					)
				: null}
			{outliving.length > 0 && frozenSlot
				? createPortal(
						<TipLayer delay={150}>
							{outliving.map((each) => (
								<div
									key={each.group.id}
									data-frozen-wrap={each.group.id}
									data-frozen-from={each.clock.from}
									data-frozen-to={each.clock.to}
									className="pointer-events-none absolute -right-(--scrollbar,0px) hidden w-[calc(var(--reader-card)+var(--scrollbar,0px))]"
								>
									{renderFrozen(each, false)}
								</div>
							))}
						</TipLayer>,
						frozenSlot,
					)
				: null}
		</TipLayer>
	);
}
