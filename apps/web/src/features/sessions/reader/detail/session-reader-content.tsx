import { LegendList, type LegendListRef } from "@legendapp/list/react";
import type {
	SessionDetailTurnSummary,
	SessionDetailWindow,
} from "@rudel/api-routes";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { useFlaggedTurns } from "@/features/compass/session-flags";
import "@/hooks/scroll-fade.css";
import { cn } from "@/lib/utils";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import { useSessionDetailOverviewPages } from "../../components/use-session-detail-overview-pages";
import { matchRunAnswersToTurns } from "../../run-question-tags";
import { useRunMarksLoading } from "../../use-run-marks-loading";
import { useSessionRunAnswers } from "../../use-run-question-tags";
import { ReaderRunCiContext, useSessionRunCi } from "../../use-session-run-ci";
import {
	keptOf,
	loadSessionMap,
} from "../minimap/session-reader-minimap-store";
import { getCostQuintiles, getCostShade } from "../model/session-reader-model";
import { createRunUiStore } from "../model/session-reader-run-ui-store";
import { useRailTags } from "../rail/session-reader-rail-tags";
import {
	type ActiveTurnStore,
	createActiveTurnStore,
	TurnRailList,
} from "../rail/session-reader-turn-rail";
import {
	MAP_MODEL_MARK,
	READER_CONTENT_MARK,
	READER_SCROLL_MARK,
} from "../reader-dom";
import { AGENT_PARAM, TURN_PARAM, writePick } from "../reader-params";
import {
	READER_RAIL_BACKGROUND,
	TabsBandFade,
	useWholeSessionLine,
	ViewBottomFade,
} from "../session-reader-tabs";
import {
	ReaderMap,
	useReaderFocus,
} from "../subagents/session-reader-agent-focus";
import {
	FrozenSubagentsContext,
	FrozenSubagentsLayer,
} from "../subagents/session-reader-frozen-subagents";
import {
	SessionSubagents,
	useSessionSubagents,
} from "../subagents/session-reader-subagent-marks";
import { SubagentTalks } from "../subagents/session-reader-subagent-talks";
import { ReaderSubagentsContext } from "../subagents/use-reader-subagent-branches";
import { answerOf } from "./reader-jump-scroll";
import { ReaderLayoutContext, useReaderLayout } from "./reader-layout";
import { useMainThreadReturn } from "./reader-main-return";
import {
	jumpToRead,
	openAtTurn,
	useReaderOpening,
} from "./reader-scroll-memory";
import { watchReaderScroll } from "./reader-scroll-watch";
import { useTurnPin } from "./reader-turn-pin";
import {
	estimateTurnPx,
	pendingTurnsPx,
	TURN_GAP_PX,
} from "./reader-turns-pending";
import { FocusedSubagent } from "./session-reader-focused-subagent";
import { ReaderHiddenContext } from "./session-reader-hidden-steps";
import { ReaderStepJump } from "./session-reader-step-jump";
import { READING_MEASURE, TurnBlock } from "./session-reader-turn-block";
import { ReaderTurnSlot, TurnsPending } from "./session-reader-turn-slot";
import { turnKey, turnSizeType, usePlacedTurns } from "./use-placed-turns";
import { useReaderOpenCall } from "./use-reader-open-call";
import { useSessionReaderBodies } from "./use-session-reader-bodies";
import { TipLayer } from "./waterfall/session-reader-tips";
import { WHOLE_TURN_ID } from "./waterfall/session-reader-waterfall";

export { TurnBlock };

export const SessionReaderContent = memo(function SessionReaderContent({
	emptyMessage = "No turns in this session.",
	followNewest = false,
	initialWindow,
	model,
	onStaleRevision,
	overview,
	reading,
	userImageUrl,
	userLabel,
}: {
	emptyMessage?: string;
	followNewest?: boolean;
	initialWindow: SessionDetailWindow | undefined;
	model: string | null;
	onStaleRevision: (error: unknown) => void;
	overview: NormalizedSessionDetailOverview;
	userImageUrl: string | undefined;
	userLabel: string;
	reading?: ActiveTurnStore;
}) {
	const [searchParams, setSearchParams] = useSearchParams();
	const pages = useSessionDetailOverviewPages(overview);
	const turns = useMemo(
		() => pages.data.pages.flatMap((page) => page.turnPage.items),
		[pages.data.pages],
	);
	const totalTurns = overview.turnPage.total;
	const wholeLine = useWholeSessionLine();
	const whole = useMemo(() => ({ ...wholeLine, disabled: true }), [wholeLine]);
	const subagents = useSessionSubagents(turns, overview.subagents);
	const costThresholds = useMemo(
		() => getCostQuintiles(turns.map((turn) => turn.estimatedCost ?? 0)),
		[turns],
	);
	const numbers = useMemo(
		() => new Map(turns.map((turn, index) => [turn.turnId, index + 1])),
		[turns],
	);
	const numberOf = useCallback(
		(turnId: string) => numbers.get(turnId) ?? 0,
		[numbers],
	);
	const member = useMemo(
		() => ({ imageUrl: userImageUrl, label: userLabel }),
		[userImageUrl, userLabel],
	);
	const runAnswers = useSessionRunAnswers(overview.session.sessionId);
	const runCi = useSessionRunCi(overview.session.sessionId);
	const questionsByTurn = useMemo(
		() => matchRunAnswersToTurns(runAnswers?.runs ?? [], turns),
		[runAnswers, turns],
	);
	const opening = useReaderOpening(overview.session.sessionId, {
		asked: searchParams.get(TURN_PARAM) ?? undefined,
		follows: followNewest,
		subagent: searchParams.has(AGENT_PARAM),
	});
	const { getBody, requestBody, retryBody } = useSessionReaderBodies({
		initialWindow,
		onStaleRevision,
		revision: overview.revision,
		sessionId: overview.session.sessionId,
		startTurnId:
			opening.startTurnId ?? (followNewest ? undefined : turns[0]?.turnId),
		turns,
	});

	const turnElementsRef = useRef(new Map<string, HTMLElement>());
	const observerRef = useRef<IntersectionObserver | null>(null);
	const spyRef = useRef<IntersectionObserver | null>(null);
	const activeTurnRef = useRef(reading ?? createActiveTurnStore());
	const activeTurn = activeTurnRef.current;
	const jumpingRef = useRef(false);
	const [runUi] = useState(() => createRunUiStore(activeTurn, { open: true }));
	const [jumpSlot, setJumpSlot] = useState<HTMLDivElement | null>(null);
	const [frozenSlot, setFrozenSlot] = useState<HTMLElement | null>(null);
	const requestBodyRef = useRef(requestBody);
	requestBodyRef.current = requestBody;
	const pendingScrollTurnIdRef = useRef(opening.startTurnId);
	const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
		null,
	);
	const listRef = useRef<LegendListRef | null>(null);
	const turnPin = useTurnPin(turnElementsRef);
	useReaderOpenCall(runUi, searchParams, turnPin, turnElementsRef);
	const { focus, focusTurn, laterTurns, pickTurn, setFocus } = useReaderFocus({
		complete: turns.length >= totalTurns,
		pendingScrollTurnIdRef,
		requestBodyRef,
		scrollToTurn,
		subagents: overview.subagents,
		turns,
	});
	const readFocus = focusTurn ? focus : null;
	const readFocusRef = useRef(readFocus);
	readFocusRef.current = readFocus;
	useMountEffect(() => activeTurn.set(null));
	const [initialTurnIndex] = useState(() => {
		const index = turns.findIndex(
			(turn) => turn.turnId === pendingScrollTurnIdRef.current,
		);
		return index >= 0 ? index : undefined;
	});
	const mapKey = useMemo(
		() => ({
			revision: overview.revision,
			sessionId: overview.session.sessionId,
		}),
		[overview.revision, overview.session.sessionId],
	);
	const [kept] = useState(() => {
		const map = loadSessionMap(mapKey);
		return map?.settled ? map : undefined;
	});
	const keptHeights = kept?.heights;
	const sessionId = overview.session.sessionId;
	const shaping = useRunMarksLoading(sessionId);
	const pendingPx = useMemo(
		() =>
			pendingTurnsPx({
				estimate: estimateTurnPx,
				keptHeights,
				subagentTotal:
					overview.activityTotalsScope === "session"
						? overview.activityTotals.subagent
						: 0,
				total: totalTurns,
				turns,
			}),
		[keptHeights, overview, totalTurns, turns],
	);
	const layout = useReaderLayout({
		complete: turns.length >= totalTurns,
		getBody,
		isMounted: (turnId) => turnElementsRef.current.has(turnId),
		keptShapes: () => keptOf(kept),
		paused: readFocus !== null || shaping,
		startTurnId: opening.startTurnId,
		turnElementsRef,
		turns,
	});
	const flagged = useFlaggedTurns({
		from: overview.session.sessionDate,
		sessionId: overview.session.sessionId,
		to: overview.session.lastInteractionDate,
		totalTurns,
		turns,
	});
	const railTags = useRailTags(runUi);
	const railTurns = useMemo(
		() => flagged.railTurns.filter(railTags.keeps),
		[flagged.railTurns, railTags.keeps],
	);
	const isTurnHidden = useCallback(
		(turn: SessionDetailTurnSummary) =>
			focusTurn !== undefined ||
			!flagged.isShown(turn.turnId) ||
			!railTags.keeps(turn),
		[flagged, focusTurn, railTags],
	);
	usePlacedTurns({
		isFrustrated: flagged.isFrustrated,
		isTurnHidden,
		listRef,
		scrollElement,
		complete: turns.length >= totalTurns,
		shapes: overview.turnShapes,
		subagents: overview.subagents,
		turnElementsRef,
		turns,
	});
	const followRef = useRef(followNewest);
	followRef.current = followNewest;

	const setScrollContainer = useCallback(
		(element: HTMLDivElement | null) => {
			if (!element) return;
			setScrollElement(element);
			const watch = watchReaderScroll(element, {
				answerOf: (turnId) => {
					const turn = turnElementsRef.current.get(turnId);
					return turn && !readFocusRef.current ? answerOf(turn) : null;
				},
				isFollowing: () => followRef.current,
				isJumping: () => jumpingRef.current,
				letGo: () => runUi.clear(),
				reading: activeTurnRef.current,
				requestBody: (turnId) => requestBodyRef.current(turnId),
				sessionId,
				startAtEnd: pendingScrollTurnIdRef.current === undefined,
				turns: turnElementsRef.current.values(),
			});
			observerRef.current = watch.bodies;
			spyRef.current = watch.spy;
			return () => {
				watch.stop();
				observerRef.current = null;
				spyRef.current = null;
			};
		},
		[runUi, sessionId],
	);

	const turnRefCallbacksRef = useRef(
		new Map<string, (element: HTMLElement | null) => () => void>(),
	);
	function setTurnElement(turnId: string) {
		let callback = turnRefCallbacksRef.current.get(turnId);
		if (!callback) {
			callback = (element: HTMLElement | null) => {
				if (element) {
					turnElementsRef.current.set(turnId, element);
					observerRef.current?.observe(element);
					spyRef.current?.observe(element);
					if (pendingScrollTurnIdRef.current === turnId) {
						pendingScrollTurnIdRef.current = undefined;
						openAtTurn(answerOf(element), turnId, opening.resume);
						turnPin.pinnedRef.current = turnId;
					}
					if (turnPin.pinnedRef.current === turnId)
						turnPin.pin(element, turnId);
				}
				return () => {
					if (turnPin.pinnedRef.current === turnId) turnPin.release();
					turnElementsRef.current.delete(turnId);
					if (element) {
						observerRef.current?.unobserve(element);
						spyRef.current?.unobserve(element);
					}
				};
			};
			turnRefCallbacksRef.current.set(turnId, callback);
		}
		return callback;
	}

	useMainThreadReturn({
		focus: readFocus,
		onReturn: turnPin.pin,
		pendingTurnIdRef: pendingScrollTurnIdRef,
		sessionId,
		turnElementsRef,
	});

	function scrollToTurn(turnId: string) {
		runUi.pick(turnId, WHOLE_TURN_ID);
		const turnElement = turnElementsRef.current.get(turnId);
		if (turnElement)
			jumpToRead(answerOf(turnElement), turnId, activeTurn, jumpingRef);
		else {
			const index = turns.findIndex((turn) => turn.turnId === turnId);
			if (index >= 0) void listRef.current?.scrollToIndex({ index });
		}
		setSearchParams(
			(params) => {
				writePick(params, { kind: "run", run: turnId });
				return params;
			},
			{ replace: true },
		);
	}

	const subagentsContext = useMemo(
		() => ({
			onStaleRevision,
			revision: overview.revision,
			sessionId: overview.session.sessionId,
			subagents: overview.subagents,
		}),
		[onStaleRevision, overview],
	);

	return (
		<ReaderHiddenContext.Provider value={railTags.hidden}>
			<ReaderSubagentsContext.Provider value={subagentsContext}>
				<ReaderLayoutContext.Provider value={layout}>
					<FrozenSubagentsContext.Provider value={frozenSlot}>
						<SubagentTalks getBody={getBody} turns={turns}>
							<SessionSubagents onOpen={setFocus} subagents={subagents}>
								<ReaderRunCiContext.Provider value={runCi}>
									<TipLayer delay={0} portals>
										<div className="flex h-full min-h-0 flex-col">
											<div
												ref={setScrollContainer}
												{...READER_SCROLL_MARK}
												{...MAP_MODEL_MARK}
												className="scroll-fade min-h-0 flex-1 overflow-y-auto [--reader-pane-top:calc(var(--stage-top,0.5rem)+1rem)] [--reader-top:var(--tabs-band,var(--reader-inset))] [--scroll-fade-bottom-depth:8px] [--scroll-fade-top-depth:8px] [container-type:size]"
											>
												<TabsBandFade className="top-(--stage-top) mr-(--reader-gutter) ml-(--reader-main-left)" />
												<div
													{...READER_CONTENT_MARK}
													className="grid grid-cols-[var(--reader-rail)_minmax(0,1fr)_3.5rem] gap-8 px-(--reader-gutter) pt-2 pb-(--reader-inset) xl:grid-cols-[var(--reader-rail)_minmax(0,1fr)] xl:gap-(--reader-columns-gap)"
												>
													<nav
														aria-label="Session turns"
														// Not what the browser keeps in place as the page
														// above the view changes height (scroll anchoring): its
														// top never moves, so the view wouldn't either. The
														// turns are, so a turn opened at stays put while the
														// turns above it grow (map column likewise).
														className={`-mb-4 [overflow-anchor:none] ${READER_RAIL_BACKGROUND}`}
													>
														<div className="sticky top-(--reader-rail-inset) flex h-[calc(100cqh-2*var(--reader-rail-inset))] min-h-0 flex-col gap-3">
															<TurnRailList
																activeTurn={activeTurn}
																costThresholds={costThresholds}
																lead={flagged.filter}
																marks={flagged.tags}
																model={model}
																numberOf={numberOf}
																focusedSubagent={readFocus}
																onSelect={pickTurn}
																subagents={overview.subagents}
																tags={railTags}
																turns={railTurns}
																whole={whole}
															/>
														</div>
													</nav>

													<div className="col-start-2 row-start-1 flex min-w-0 items-start gap-8 pt-(--reader-top)">
														<div
															className="flex min-w-0 flex-1 flex-col"
															style={{ gap: TURN_GAP_PX }}
														>
															<div
																ref={setJumpSlot}
																className={cn(
																	"pointer-events-none sticky top-[calc(var(--reader-top)-var(--reader-inset))] z-40 h-0 text-sm [overflow-anchor:none]",
																	READING_MEASURE,
																)}
																style={{ marginBottom: -TURN_GAP_PX }}
															/>
															<FrozenSubagentsLayer onSlot={setFrozenSlot} />
															{turns.length === 0 ? (
																<p className="py-12 text-center text-sm text-muted-foreground">
																	{emptyMessage}
																</p>
															) : null}
															{focusTurn && focus ? (
																<FocusedSubagent
																	bodyState={getBody(focusTurn.turnId)}
																	laterBodies={laterTurns.flatMap((each) => {
																		const state = getBody(each.turnId);
																		return state.status === "ready"
																			? [state.body]
																			: [];
																	})}
																	model={model}
																	store={runUi}
																	subagentId={focus}
																	summary={overview.subagents.find(
																		(each) => each.subagentId === focus,
																	)}
																	turn={focusTurn}
																/>
															) : null}
															{turns.length > 0 ? (
																<LegendList<SessionDetailTurnSummary>
																	ref={listRef}
																	data={turns}
																	scrollElement={scrollElement}
																	keyExtractor={turnKey}
																	getItemType={turnSizeType}
																	estimatedItemSize={estimateTurnPx(turns[0])}
																	drawDistance={1600}
																	recycleItems={false}
																	initialScrollIndex={initialTurnIndex}
																	extraData={{
																		costThresholds,
																		flagged,
																		getBody,
																		keptHeights,
																		questionsByTurn,
																		railTags,
																		subagents,
																		focusTurn,
																	}}
																	renderItem={({
																		item: turn,
																		index,
																	}: {
																		item: SessionDetailTurnSummary;
																		index: number;
																	}) => (
																		<div
																			style={{
																				paddingBottom: isTurnHidden(turn)
																					? 0
																					: TURN_GAP_PX,
																			}}
																		>
																			<ReaderTurnSlot
																				frustrated={flagged.isFrustrated(turn)}
																				hidden={isTurnHidden(turn)}
																				holdsEstimate={
																					getBody(turn.turnId).status ===
																					"loading"
																				}
																				index={index}
																				keptHeight={keptHeights?.[turn.turnId]}
																				slotRef={setTurnElement(turn.turnId)}
																				turn={turn}
																			>
																				<TurnBlock
																					bodyState={getBody(turn.turnId)}
																					costShade={getCostShade(
																						turn.estimatedCost,
																						costThresholds,
																					)}
																					frustrated={flagged.isFrustrated(
																						turn,
																					)}
																					hidden={railTags.hidden}
																					model={model}
																					onRetry={retryBody}
																					questions={questionsByTurn.get(
																						turn.turnId,
																					)}
																					store={runUi}
																					subagentDurations={
																						subagents.durations
																					}
																					turn={turn}
																					userImageUrl={userImageUrl}
																					userLabel={userLabel}
																				/>
																			</ReaderTurnSlot>
																		</div>
																	)}
																/>
															) : null}
															{turns.length < totalTurns ? (
																<TurnsPending
																	failed={Boolean(pages.error)}
																	from={turns.length + 1}
																	minHeight={pendingPx}
																	onRetry={() => void pages.fetchNextPage()}
																	to={totalTurns}
																/>
															) : null}
														</div>
														<ReaderStepJump
															getBody={getBody}
															jumpSlot={jumpSlot}
															model={model}
															store={runUi}
															turns={turns}
														/>
													</div>
													<div className="col-start-3 row-start-1 grid w-14 xl:col-start-2 xl:mr-[calc(var(--reader-card)+2rem)] xl:justify-self-end">
														<ReaderMap
															focus={readFocus}
															mapKey={mapKey}
															member={member}
															model={model}
															onFocus={setFocus}
															tags={railTags.picked}
														/>
													</div>
												</div>
												<ViewBottomFade className="mr-(--reader-gutter) ml-(--reader-main-left)" />
											</div>
										</div>
									</TipLayer>
								</ReaderRunCiContext.Provider>
							</SessionSubagents>
						</SubagentTalks>
					</FrozenSubagentsContext.Provider>
				</ReaderLayoutContext.Provider>
			</ReaderSubagentsContext.Provider>
		</ReaderHiddenContext.Provider>
	);
});
