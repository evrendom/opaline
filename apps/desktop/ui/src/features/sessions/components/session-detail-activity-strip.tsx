// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: Trigger and animated panel state must remain in one coordinated menu controller.

import type { SessionDetailOverview } from "@rudel/api-routes";
import {
	type KeyboardEvent,
	type PointerEvent,
	useCallback,
	// biome-ignore lint/style/noRestrictedImports: open panel frames must track newly paginated overview groups.
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { TouchTarget } from "@/app/ui/touch-target";
import { cn } from "@/lib/utils";
import {
	buildSessionDetailActivityGroups,
	type SessionDetailActivityGroup,
	type SessionDetailActivityKind,
	type SessionDetailActivityOccurrence,
} from "./session-detail-activity-groups";
import {
	SessionDetailActivityOccurrencePanel,
	SessionDetailActivityPanel,
} from "./session-detail-activity-panels";
import type { SessionDetailOverviewTurnOption } from "./session-detail-overview-model";
import { useSessionDetailActivityStripWidth } from "./use-session-detail-activity-strip-width";
import "./session-detail-activity-strip.css";

const ACTIVITY_CLOSE_DELAY_MS = 150;
const ACTIVITY_CONTENT_DURATION_MS = 180;
const ACTIVITY_SKIP_DELAY_MS = 300;

type SessionDetailActivityMotion =
	| "from-end"
	| "from-start"
	| "to-end"
	| "to-start";

type SessionDetailActivityPanelFrame = {
	group: SessionDetailActivityGroup;
	id: number;
	motion: SessionDetailActivityMotion | undefined;
	occurrence: SessionDetailActivityOccurrence | undefined;
};

type SessionDetailActivityTriggerFlags = {
	hasPointerMoveOpened: boolean;
	wasClickClose: boolean;
	wasEscapeClose: boolean;
};

function SessionDetailActivityMenuItem({
	flyoutsEnabled,
	group,
	onKeyDown,
	onPointerEnter,
	onPointerLeave,
	onPointerMove,
	onSelect,
	triggerRef,
	isOpen,
}: {
	flyoutsEnabled: boolean;
	group: SessionDetailActivityGroup;
	isOpen: boolean;
	onKeyDown: (
		event: KeyboardEvent<HTMLButtonElement>,
		kind: SessionDetailActivityKind,
	) => void;
	onPointerEnter: (kind: SessionDetailActivityKind) => void;
	onPointerLeave: (
		event: PointerEvent<HTMLButtonElement>,
		kind: SessionDetailActivityKind,
	) => void;
	onPointerMove: (
		event: PointerEvent<HTMLButtonElement>,
		kind: SessionDetailActivityKind,
	) => void;
	onSelect: (kind: SessionDetailActivityKind) => void;
	triggerRef: (element: HTMLButtonElement | null) => void;
}) {
	return (
		<li className="session-detail-opaline-trigger-item">
			<button
				aria-expanded={flyoutsEnabled ? isOpen : undefined}
				aria-haspopup={flyoutsEnabled ? "menu" : undefined}
				className={cn(
					// design-escape-ok(opacity): no role renders this; border-ink/20, text-ink/60, dark:border-ink/25, dark:text-ink/70
					"session-detail-opaline-trigger relative inline-flex shrink-0 items-center justify-center gap-s corner-s border-[0.5px] border-ink/20 bg-canvas px-[calc(var(--space-m)+var(--space-xxs))] py-xs text-body-l font-medium text-ink/60 focus-outline disabled:pointer-events-none dark:border-ink/25 dark:text-ink/70",
					flyoutsEnabled &&
						// design-escape-ok(opacity): no role renders this; hover:bg-ink/[0.063], hover:text-ink-90, dark:hover:bg-ink/[0.071], dark:hover:text-ink/95
						"hover:bg-ink/[0.063] hover:text-ink-90 dark:hover:bg-ink/[0.071] dark:hover:text-ink/95",
					flyoutsEnabled &&
						isOpen &&
						// design-escape-ok(opacity): no role renders this; bg-ink/[0.063], text-ink-90, dark:bg-ink/[0.071], dark:text-ink/95
						"bg-ink/[0.063] text-ink-90 dark:bg-ink/[0.071] dark:text-ink/95",
				)}
				data-state={isOpen ? "open" : "closed"}
				disabled={!flyoutsEnabled}
				onClick={() => onSelect(group.kind)}
				onKeyDown={(event) => onKeyDown(event, group.kind)}
				onPointerEnter={() => onPointerEnter(group.kind)}
				onPointerLeave={(event) => onPointerLeave(event, group.kind)}
				onPointerMove={(event) => onPointerMove(event, group.kind)}
				ref={triggerRef}
				type="button"
			>
				<TouchTarget className="pointer-events-none" />
				<span>{group.label}</span>
				{/* design-escape-ok(opacity): no role renders this; text-ink/60, dark:text-ink/70 */}
				<span className="text-ink/60 tabular-nums dark:text-ink/70">
					{group.totalCount.toLocaleString()}
				</span>
			</button>
		</li>
	);
}

export function SessionDetailActivityStrip({
	activityTotals,
	flyoutsEnabled = true,
	onMinimumWidthChange,
	onJump,
	options,
	overviewLoading = false,
	subagents,
}: {
	activityTotals: SessionDetailOverview["activityTotals"];
	flyoutsEnabled?: boolean;
	onMinimumWidthChange?: (width: number) => void;
	onJump: (target: { eventId: string | undefined; turnIndex: number }) => void;
	options: readonly SessionDetailOverviewTurnOption[];
	overviewLoading?: boolean;
	subagents: readonly SessionDetailOverview["subagents"][number][];
}) {
	const [openKind, setOpenKind] = useState<
		SessionDetailActivityKind | undefined
	>();
	const [activeFrameId, setActiveFrameId] = useState<number | undefined>();
	const [panelFrames, setPanelFrames] = useState<
		readonly SessionDetailActivityPanelFrame[]
	>([]);
	const [popupHeight, setPopupHeight] = useState(0);
	const [popupState, setPopupState] = useState<"closed" | "open">("closed");
	const groups = useMemo(
		() =>
			buildSessionDetailActivityGroups({
				activityTotals,
				// Counts come from the server. Avoid formatting thousands of
				// occurrence rows for flyouts that cannot be opened.
				options: flyoutsEnabled ? options : [],
				subagents: flyoutsEnabled ? subagents : [],
			}).filter((group) => group.totalCount > 0),
		[activityTotals, flyoutsEnabled, options, subagents],
	);
	const activeKindRef = useRef<SessionDetailActivityKind | undefined>(
		undefined,
	);
	const cleanupTimerRef = useRef<number | undefined>(undefined);
	const closeTimerRef = useRef<number | undefined>(undefined);
	const isOpenDelayedRef = useRef(true);
	const openTimerRef = useRef<number | undefined>(undefined);
	const panelElementsRef = useRef(new Map<number, HTMLDivElement>());
	const { stripElementRef, triggerListElementRef } =
		useSessionDetailActivityStripWidth(onMinimumWidthChange);
	const skipDelayTimerRef = useRef<number | undefined>(undefined);
	const transitionIdRef = useRef(0);
	const triggerElementsRef = useRef(
		new Map<SessionDetailActivityKind, HTMLButtonElement>(),
	);
	const triggerFlagsRef = useRef(
		new Map<SessionDetailActivityKind, SessionDetailActivityTriggerFlags>(),
	);

	const clearTimer = useCallback((timer: number | undefined) => {
		if (timer !== undefined) {
			window.clearTimeout(timer);
		}
	}, []);

	const updateOpenDelay = useCallback(
		(kind: SessionDetailActivityKind | undefined) => {
			clearTimer(skipDelayTimerRef.current);
			if (kind) {
				isOpenDelayedRef.current = false;
				return;
			}
			skipDelayTimerRef.current = window.setTimeout(() => {
				isOpenDelayedRef.current = true;
			}, ACTIVITY_SKIP_DELAY_MS);
		},
		[clearTimer],
	);

	const openMenu = useCallback(
		(kind: SessionDetailActivityKind) => {
			if (activeKindRef.current === kind) {
				return;
			}
			clearTimer(closeTimerRef.current);
			clearTimer(cleanupTimerRef.current);
			const group = groups.find((candidate) => candidate.kind === kind);
			if (!group) {
				return;
			}
			const previousKind = activeKindRef.current;
			activeKindRef.current = kind;
			setOpenKind(kind);
			setPopupState("open");
			updateOpenDelay(kind);
			const transitionId = ++transitionIdRef.current;
			setActiveFrameId(transitionId);

			if (!previousKind) {
				setPanelFrames([
					{
						group,
						id: transitionId,
						motion: undefined,
						occurrence: undefined,
					},
				]);
				return;
			}

			const previousGroup = groups.find(
				(candidate) => candidate.kind === previousKind,
			);
			if (!previousGroup) {
				setPanelFrames([
					{
						group,
						id: transitionId,
						motion: undefined,
						occurrence: undefined,
					},
				]);
				return;
			}
			const previousIndex = groups.indexOf(previousGroup);
			const nextIndex = groups.indexOf(group);
			const movingForward = nextIndex > previousIndex;
			setPanelFrames((currentFrames) => {
				const previousFrame = currentFrames.find(
					(frame) => frame.id === activeFrameId,
				) ?? {
					group: previousGroup,
					id: transitionId - 1,
					motion: undefined,
					occurrence: undefined,
				};
				return [
					{
						...previousFrame,
						motion: movingForward ? "to-start" : "to-end",
					},
					{
						group,
						id: transitionId,
						motion: movingForward ? "from-end" : "from-start",
						occurrence: undefined,
					},
				];
			});
			cleanupTimerRef.current = window.setTimeout(() => {
				if (transitionId === transitionIdRef.current) {
					setPanelFrames([
						{
							group,
							id: transitionId,
							motion: undefined,
							occurrence: undefined,
						},
					]);
				}
			}, ACTIVITY_CONTENT_DURATION_MS);
		},
		[activeFrameId, clearTimer, groups, updateOpenDelay],
	);

	useEffect(() => {
		const signalGroup = groups.find((group) => group.kind === "signal");
		if (!signalGroup) {
			return;
		}
		setPanelFrames((currentFrames) => {
			let changed = false;
			const nextFrames = currentFrames.map((frame) => {
				if (frame.group.kind !== "signal" || frame.group === signalGroup) {
					return frame;
				}
				changed = true;
				return { ...frame, group: signalGroup };
			});
			return changed ? nextFrames : currentFrames;
		});
	}, [groups]);

	const closeMenu = useCallback(() => {
		clearTimer(openTimerRef.current);
		clearTimer(closeTimerRef.current);
		clearTimer(cleanupTimerRef.current);
		if (!activeKindRef.current) {
			return;
		}
		activeKindRef.current = undefined;
		setOpenKind(undefined);
		setPopupState("closed");
		updateOpenDelay(undefined);
		const transitionId = ++transitionIdRef.current;
		cleanupTimerRef.current = window.setTimeout(() => {
			if (
				transitionId === transitionIdRef.current &&
				activeKindRef.current === undefined
			) {
				setPanelFrames([]);
				setActiveFrameId(undefined);
			}
		}, ACTIVITY_CONTENT_DURATION_MS);
	}, [clearTimer, updateOpenDelay]);

	const scheduleClose = useCallback(() => {
		clearTimer(openTimerRef.current);
		clearTimer(closeTimerRef.current);
		closeTimerRef.current = window.setTimeout(
			closeMenu,
			ACTIVITY_CLOSE_DELAY_MS,
		);
	}, [clearTimer, closeMenu]);

	const enterTrigger = useCallback(
		(kind: SessionDetailActivityKind) => {
			clearTimer(openTimerRef.current);
			clearTimer(closeTimerRef.current);
			if (!isOpenDelayedRef.current || activeKindRef.current) {
				openMenu(kind);
				return;
			}
			openTimerRef.current = window.setTimeout(() => openMenu(kind), 0);
		},
		[clearTimer, openMenu],
	);

	const getTriggerFlags = useCallback((kind: SessionDetailActivityKind) => {
		const existing = triggerFlagsRef.current.get(kind);
		if (existing) {
			return existing;
		}
		const next = {
			hasPointerMoveOpened: false,
			wasClickClose: false,
			wasEscapeClose: false,
		};
		triggerFlagsRef.current.set(kind, next);
		return next;
	}, []);

	const handlePointerEnter = useCallback(
		(kind: SessionDetailActivityKind) => {
			clearTimer(closeTimerRef.current);
			const flags = getTriggerFlags(kind);
			flags.wasClickClose = false;
			flags.wasEscapeClose = false;
		},
		[clearTimer, getTriggerFlags],
	);

	const handlePointerMove = useCallback(
		(
			event: PointerEvent<HTMLButtonElement>,
			kind: SessionDetailActivityKind,
		) => {
			const flags = getTriggerFlags(kind);
			if (
				event.pointerType !== "mouse" ||
				flags.hasPointerMoveOpened ||
				flags.wasClickClose ||
				flags.wasEscapeClose
			) {
				return;
			}
			flags.hasPointerMoveOpened = true;
			enterTrigger(kind);
		},
		[enterTrigger, getTriggerFlags],
	);

	const handlePointerLeave = useCallback(
		(
			event: PointerEvent<HTMLButtonElement>,
			kind: SessionDetailActivityKind,
		) => {
			if (event.pointerType !== "mouse") {
				return;
			}
			getTriggerFlags(kind).hasPointerMoveOpened = false;
			scheduleClose();
		},
		[getTriggerFlags, scheduleClose],
	);

	const handleKeyDown = useCallback(
		(
			event: KeyboardEvent<HTMLButtonElement>,
			kind: SessionDetailActivityKind,
		) => {
			if (event.key === "Escape") {
				getTriggerFlags(kind).wasEscapeClose = true;
				closeMenu();
				return;
			}
			if (event.key === "ArrowDown" && activeKindRef.current === kind) {
				event.preventDefault();
				document
					.querySelector<HTMLButtonElement>(
						'.session-detail-opaline-panel[data-active="true"] button',
					)
					?.focus();
				return;
			}
			if (!["ArrowLeft", "ArrowRight", "End", "Home"].includes(event.key)) {
				return;
			}
			event.preventDefault();
			const currentIndex = groups.findIndex((group) => group.kind === kind);
			const nextIndex =
				event.key === "Home"
					? 0
					: event.key === "End"
						? groups.length - 1
						: (currentIndex +
								(event.key === "ArrowRight" ? 1 : -1) +
								groups.length) %
							groups.length;
			const nextKind = groups[nextIndex]?.kind;
			if (nextKind) {
				triggerElementsRef.current.get(nextKind)?.focus();
			}
		},
		[closeMenu, getTriggerFlags, groups],
	);

	const transitionPanel = useCallback(
		({
			enteringMotion,
			exitingMotion,
			group,
			occurrence,
		}: {
			enteringMotion: "from-end" | "from-start";
			exitingMotion: "to-end" | "to-start";
			group: SessionDetailActivityGroup;
			occurrence: SessionDetailActivityOccurrence | undefined;
		}) => {
			clearTimer(closeTimerRef.current);
			clearTimer(cleanupTimerRef.current);
			const transitionId = ++transitionIdRef.current;
			setActiveFrameId(transitionId);
			setPanelFrames((currentFrames) => {
				const previousFrame = currentFrames.find(
					(frame) => frame.id === activeFrameId,
				);
				const nextFrame: SessionDetailActivityPanelFrame = {
					group,
					id: transitionId,
					motion: enteringMotion,
					occurrence,
				};
				return previousFrame
					? [{ ...previousFrame, motion: exitingMotion }, nextFrame]
					: [nextFrame];
			});
			cleanupTimerRef.current = window.setTimeout(() => {
				if (transitionId === transitionIdRef.current) {
					setPanelFrames([
						{ group, id: transitionId, motion: undefined, occurrence },
					]);
				}
			}, ACTIVITY_CONTENT_DURATION_MS);
		},
		[activeFrameId, clearTimer],
	);

	useLayoutEffect(() => {
		const activeFrame = panelFrames.find((frame) => frame.id === activeFrameId);
		if (!activeFrame) {
			return;
		}
		const panel = panelElementsRef.current.get(activeFrame.id);
		if (!panel) {
			return;
		}
		const nextHeight = Math.ceil(panel.getBoundingClientRect().height) + 16;
		setPopupHeight((currentHeight) =>
			currentHeight === nextHeight ? currentHeight : nextHeight,
		);
	}, [activeFrameId, panelFrames]);

	return (
		<header
			ref={stripElementRef}
			className="relative z-[60] flex h-11 shrink-0 items-center border-y-[0.5px] border-line-strong bg-canvas p-m"
		>
			<nav
				aria-label="Session detail activity"
				className="w-full min-w-0 overflow-x-auto"
			>
				<ul
					ref={triggerListElementRef}
					className="flex w-max items-center gap-m"
					data-session-detail-activity-items
				>
					{groups.map((group) => (
						<SessionDetailActivityMenuItem
							flyoutsEnabled={flyoutsEnabled}
							group={group}
							isOpen={openKind === group.kind}
							key={group.kind}
							onKeyDown={handleKeyDown}
							onPointerEnter={handlePointerEnter}
							onPointerLeave={handlePointerLeave}
							onPointerMove={handlePointerMove}
							onSelect={openMenu}
							triggerRef={(element) => {
								if (element) {
									triggerElementsRef.current.set(group.kind, element);
								} else {
									triggerElementsRef.current.delete(group.kind);
								}
							}}
						/>
					))}
				</ul>
				{flyoutsEnabled && panelFrames.length > 0 ? (
					<div
						// design-escape-ok(opacity): a translucent flyout over backdrop blur; no translucent ground role (also text-ink-90, ring-ink/8)
						className="session-detail-opaline-menu absolute top-[calc(100%+1px)] right-0 left-0 overflow-hidden corner-l bg-canvas/90 text-ink-90 shadow-float ring-1 ring-ink/8 backdrop-blur-2xl outline-none dark:text-ink"
						data-state={popupState}
						onPointerEnter={() => clearTimer(closeTimerRef.current)}
						onPointerLeave={scheduleClose}
						style={{ height: popupHeight }}
					>
						{panelFrames.map((frame) => (
							<div
								className="session-detail-opaline-panel"
								data-active={frame.id === activeFrameId}
								data-motion={frame.motion}
								key={frame.id}
							>
								<div
									ref={(element) => {
										if (element) {
											panelElementsRef.current.set(frame.id, element);
										} else {
											panelElementsRef.current.delete(frame.id);
										}
									}}
								>
									{frame.occurrence ? (
										<SessionDetailActivityOccurrencePanel
											group={frame.group}
											onBack={() =>
												transitionPanel({
													enteringMotion: "from-start",
													exitingMotion: "to-end",
													group: frame.group,
													occurrence: undefined,
												})
											}
											onClose={closeMenu}
											onJump={onJump}
											occurrence={frame.occurrence}
										/>
									) : (
										<SessionDetailActivityPanel
											group={frame.group}
											isLoading={
												overviewLoading &&
												frame.group.kind === "signal" &&
												frame.group.occurrences.length < frame.group.totalCount
											}
											onSelectOccurrence={(occurrence) =>
												transitionPanel({
													enteringMotion: "from-end",
													exitingMotion: "to-start",
													group: frame.group,
													occurrence,
												})
											}
										/>
									)}
								</div>
							</div>
						))}
					</div>
				) : null}
			</nav>
		</header>
	);
}
