import type {
	SessionDetailTurnSummary,
	SessionDetailWindow,
} from "@rudel/api-routes";
import { scanMemberLanguageSignals } from "@rudel/language-signals";
import { IconSparkles } from "@tabler/icons-react";
import {
	Children,
	type ComponentProps,
	createElement,
	type ReactNode,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import Markdown, { type Components } from "react-markdown";
import { useSearchParams } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { Skeleton } from "@/app/ui/skeleton";
import { getModelIconComponent } from "@/components/conversation/conversation-trace-model-icon";
import { SignalText } from "@/components/signal-text";
import { getModelBrandIconClassName } from "@/features/dashboard/components/dashboard-model-brand";
import { CopyButton } from "@/features/shell/components/copy-button";
import { OpalineShape } from "@/features/shell/components/shell-nav-icon";
import { formatCompactNumber, formatRoundedDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NormalizedSessionDetailOverview } from "./session-detail-fast-response";
import { attachReaderFollower } from "./session-reader-follow";
import { ReaderInspectorPane } from "./session-reader-inspector-pane";
import {
	formatReaderBytes,
	formatReaderCost,
	getCostQuintiles,
	getCostShade,
	getReaderFinalMessage,
	getReaderMemberText,
	getReaderTurnMarks,
	getReaderWaterfall,
} from "./session-reader-model";
// The chart strip is parked while it is unfinished; see below.
// import { ReaderOverviewStrip } from "./session-reader-overview-strip";
import {
	createRunUiStore,
	type RunUiStore,
} from "./session-reader-run-ui-store";
import { SessionStat } from "./session-reader-stat";
import { formatDateTime, MemberFactLine } from "./session-reader-turn-lines";
import {
	createActiveTurnStore,
	TurnRailList,
} from "./session-reader-turn-rail";
import { TurnSteps } from "./session-reader-turn-steps";
import { WHOLE_TURN_ID } from "./session-reader-waterfall";
import { OpalChip } from "./session-reader-waterfall-chips";
import { ReaderSubagentsContext } from "./use-reader-subagent-branches";
import { useSessionDetailOverviewPages } from "./use-session-detail-overview-pages";
import {
	type SessionReaderBodyState,
	useSessionReaderBodies,
} from "./use-session-reader-bodies";

const MEMBER_TEXT_CLAMP = 1_200;

function formatTokens(value: number | null) {
	return formatCompactNumber(value ?? 0);
}

/** Where a jump to a turn lands: the agent's answer, falling back to the
 * turn's top while its body has none. */
function answerOf(turnElement: HTMLElement): HTMLElement {
	return (
		turnElement.querySelector<HTMLElement>("[data-turn-answer]") ?? turnElement
	);
}

export function SessionReaderContent({
	contextChips,
	emptyMessage = "No turns in this session.",
	followNewest = false,
	initialWindow,
	model,
	onStaleRevision,
	overview,
	userImageUrl,
	userLabel,
}: {
	/** Where the session ran — repository, branch, model — for the rail. */
	contextChips?: ReactNode;
	/** What the page says while the session has no turns. */
	emptyMessage?: string;
	/** Keep the newest turn in view as turns land, while the reader is at
	 * the end of the page (a session running right now). */
	followNewest?: boolean;
	initialWindow: SessionDetailWindow | undefined;
	model: string | null;
	onStaleRevision: (error: unknown) => void;
	overview: NormalizedSessionDetailOverview;
	userImageUrl: string | undefined;
	userLabel: string;
}) {
	const [searchParams, setSearchParams] = useSearchParams();
	const pages = useSessionDetailOverviewPages(overview);
	const turns = useMemo(
		() => pages.data.pages.flatMap((page) => page.turnPage.items),
		[pages.data.pages],
	);
	const totalTurns = overview.turnPage.total;
	const costThresholds = getCostQuintiles(
		turns.map((turn) => turn.estimatedCost ?? 0),
	);
	const { getBody, requestBody, retryBody } = useSessionReaderBodies({
		initialWindow,
		onStaleRevision,
		revision: overview.revision,
		sessionId: overview.session.sessionId,
	});

	// One observer for every turn block, rooted at the scroll container so its
	// margin can pull bodies in a screen or two before they scroll into view.
	const turnElementsRef = useRef(new Map<string, HTMLElement>());
	const observerRef = useRef<IntersectionObserver | null>(null);
	const spyRef = useRef<IntersectionObserver | null>(null);
	const activeTurnRef = useRef(createActiveTurnStore());
	const activeTurn = activeTurnRef.current;
	const [runUi] = useState(() => createRunUiStore(activeTurn));
	const [jumpSlot, setJumpSlot] = useState<HTMLDivElement | null>(null);
	const requestBodyRef = useRef(requestBody);
	requestBodyRef.current = requestBody;
	const pendingScrollTurnIdRef = useRef(searchParams.get("turn") ?? undefined);
	const followRef = useRef(followNewest);
	followRef.current = followNewest;

	const setScrollContainer = useCallback((element: HTMLDivElement | null) => {
		if (!element) return;
		// A page opened at a turn does not start at the end.
		const detachFollower = attachReaderFollower(element, {
			isFollowing: () => followRef.current,
			startAtEnd: pendingScrollTurnIdRef.current === undefined,
		});
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const turnId = (entry.target as HTMLElement).dataset.turnId;
					if (entry.isIntersecting && turnId) requestBodyRef.current(turnId);
				}
			},
			{ root: element, rootMargin: "1200px 0px" },
		);
		// The turn being read: of the turns crossing the top quarter of the
		// view, the earliest. A turn taller than the view keeps it while it
		// spans that band.
		const inBand = new Map<string, number>();
		const spy = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const { turnId, turnIndex } = (entry.target as HTMLElement).dataset;
					if (!turnId) continue;
					if (entry.isIntersecting) inBand.set(turnId, Number(turnIndex));
					else inBand.delete(turnId);
				}
				let active: [string, number] | undefined;
				for (const candidate of inBand) {
					if (!active || candidate[1] < active[1]) active = candidate;
				}
				if (active) activeTurnRef.current.set(active[0]);
			},
			{ root: element, rootMargin: "0px 0px -75% 0px" },
		);
		observerRef.current = observer;
		spyRef.current = spy;
		for (const turnElement of turnElementsRef.current.values()) {
			observer.observe(turnElement);
			spy.observe(turnElement);
		}
		return () => {
			detachFollower();
			observer.disconnect();
			spy.disconnect();
			observerRef.current = null;
			spyRef.current = null;
		};
	}, []);

	// Stable per turn, so re-renders don't detach and re-observe every block.
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
						answerOf(element).scrollIntoView({ block: "start" });
					}
				}
				return () => {
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

	function scrollToTurn(turnId: string) {
		// Picking a turn in the rail picks its whole run, for the pane.
		runUi.pick(turnId, WHOLE_TURN_ID);
		const turnElement = turnElementsRef.current.get(turnId);
		if (turnElement) {
			answerOf(turnElement).scrollIntoView({
				behavior: "smooth",
				block: "start",
			});
		}
		setSearchParams(
			(params) => {
				params.set("turn", turnId);
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

	const stats = (
		<SessionStats
			cost={overview.session.estimatedCost}
			durationMinutes={overview.session.durationMinutes}
			inputTokens={overview.session.inputTokens}
			outputTokens={overview.session.outputTokens}
			startedAt={overview.session.sessionDate}
			totalTokens={overview.session.totalTokens}
			transcriptBytes={overview.session.transcriptBytes}
		/>
	);

	return (
		// Subagent transcripts a waterfall nests are fetched against this
		// session and revision.
		<ReaderSubagentsContext.Provider value={subagentsContext}>
			{/* The timeline's chart strip over the turns, the scroll area below. */}
			<div className="flex h-full min-h-0 flex-col">
				{/* Parked while it is unfinished.
				<ReaderOverviewStrip
					activeTurn={activeTurn}
					onSelect={scrollToTurn}
					turns={turns}
				/> */}
				{/* A size container, so the step inspector can size itself to the
				    visible height (cqh) while it sticks. */}
				<div
					ref={setScrollContainer}
					data-reader-scroll=""
					className="min-h-0 flex-1 overflow-y-auto [container-type:size]"
				>
					{/* The reader ends flush: 16px below, mirroring the sticky panes'
					    top offset, so they stop with the content. */}
					<div className="grid gap-8 px-8 pt-2 pb-4 lg:grid-cols-[240px_minmax(0,1fr)]">
						{/* The rail is hidden below lg, so the stats move to a row above the turns. */}
						<div className="flex flex-wrap gap-x-8 gap-y-3 lg:hidden">
							{stats}
							{contextChips}
						</div>

						<nav aria-label="Session turns" className="hidden lg:block">
							{/* Sized to the scroll area (cqh), not the window: its 16px top
					    offset mirrored below, it fits the room the bottom padding
					    leaves, so the end of the page never nudges it. */}
							<div className="sticky top-4 flex max-h-[calc(100cqh-2rem)] flex-col gap-0.5">
								<div className="mb-3 flex flex-col gap-3 border-b border-border/40 px-2 pb-4">
									{stats}
									{contextChips}
								</div>
								<TurnRailList
									activeTurn={activeTurn}
									costThresholds={costThresholds}
									getBody={getBody}
									model={model}
									onSelect={scrollToTurn}
									turns={turns}
								/>
							</div>
						</nav>

						<div className="flex min-w-0 items-start gap-8">
							<div className="flex min-w-0 flex-1 flex-col gap-8">
								{/* Where the pill pointing to the step the pane shows
									    floats while that row is out of sight: held at the
									    top of the view (just below a frozen waterfall
									    header, it places itself), centred over the
									    waterfalls — the reading measure, less the avatar
									    column. */}
								<div
									ref={setJumpSlot}
									className="pointer-events-none sticky top-0 z-40 -mb-8 h-0 w-full max-w-[calc(75ch-5rem)] text-sm"
								/>
								{turns.length === 0 ? (
									<p className="py-12 text-center text-sm text-muted-foreground">
										{emptyMessage}
									</p>
								) : null}
								{turns.map((turn, index) => (
									<div
										key={turn.turnId}
										ref={setTurnElement(turn.turnId)}
										data-turn-id={turn.turnId}
										data-turn-index={index}
										className="scroll-mt-4"
									>
										<TurnBlock
											bodyState={getBody(turn.turnId)}
											costShade={getCostShade(
												turn.estimatedCost,
												costThresholds,
											)}
											model={model}
											onRetry={() => retryBody(turn.turnId)}
											runUi={runUi}
											turn={turn}
											userImageUrl={userImageUrl}
											userLabel={userLabel}
										/>
									</div>
								))}
								{turns.length < totalTurns ? (
									<p className="text-xs text-muted-foreground tabular-nums">
										{pages.error ? (
											<>
												Turns {turns.length + 1}–{totalTurns} could not be
												loaded.{" "}
												<button
													type="button"
													onClick={() => void pages.fetchNextPage()}
													className="cursor-pointer underline underline-offset-2 hover:text-foreground"
												>
													Retry
												</button>
											</>
										) : (
											<>
												Loading turns {turns.length + 1}–{totalTurns}…
											</>
										)}
									</p>
								) : null}
							</div>
							{/* The pane for the turn in focus, in the room the reading
								    measure leaves on the right; it runs the column's
								    height so its sticky card can travel the whole way. */}
							<div className="hidden w-[380px] shrink-0 self-stretch xl:block">
								<ReaderInspectorPane
									getBody={getBody}
									jumpSlot={jumpSlot}
									model={model}
									store={runUi}
									turns={turns}
								/>
							</div>
						</div>
					</div>
				</div>
			</div>
		</ReaderSubagentsContext.Provider>
	);
}

function SessionStats({
	cost,
	durationMinutes,
	inputTokens,
	outputTokens,
	startedAt,
	totalTokens,
	transcriptBytes,
}: {
	cost: number | null;
	durationMinutes: number | null;
	inputTokens: number;
	outputTokens: number;
	startedAt: string;
	totalTokens: number;
	/** Uncompressed transcript size; unknown from older API builds. */
	transcriptBytes: number | undefined;
}) {
	return (
		<>
			<SessionStat
				label="Started"
				value={
					<span className="flex flex-wrap items-baseline gap-x-1.5">
						<span>{formatDateTime(startedAt)}</span>
						<span className="whitespace-nowrap text-xs text-muted-foreground">
							for {formatRoundedDuration(durationMinutes ?? undefined)}
						</span>
					</span>
				}
			/>
			<SessionStat
				label="Tokens"
				value={
					<span className="flex flex-wrap items-baseline gap-x-1.5">
						<span>{formatTokens(totalTokens)}</span>
						{inputTokens > 0 || outputTokens > 0 ? (
							<span className="whitespace-nowrap text-xs text-muted-foreground">
								{formatTokens(inputTokens)} in · {formatTokens(outputTokens)}{" "}
								out
							</span>
						) : null}
					</span>
				}
			/>
			<SessionStat label="Cost" value={formatReaderCost(cost)} />
			{transcriptBytes !== undefined ? (
				<SessionStat
					label="Size"
					value={
						<span
							title={`${transcriptBytes.toLocaleString()} bytes, uncompressed`}
						>
							{formatReaderBytes(transcriptBytes)}
						</span>
					}
				/>
			) : null}
		</>
	);
}

function TurnBlock({
	bodyState,
	costShade,
	model,
	onRetry,
	runUi,
	turn,
	userImageUrl,
	userLabel,
}: {
	bodyState: SessionReaderBodyState;
	costShade: string | undefined;
	model: string | null;
	onRetry: () => void;
	/** The reader's run state, shared with the right pane. */
	runUi: RunUiStore;
	turn: SessionDetailTurnSummary;
	userImageUrl: string | undefined;
	userLabel: string;
}) {
	const body = bodyState.status === "ready" ? bodyState.body : null;
	const memberText = body ? getReaderMemberText(body) : turn.userPreview;
	const finalMessage = body ? getReaderFinalMessage(body) : null;
	const waterfall = body ? getReaderWaterfall(body, turn, model) : null;

	// The member's message and the model's answer read as two messages, as far
	// apart as consecutive turns.
	return (
		// A reading measure, in ch of the text's own size (text-sm): 75ch plus
		// the avatar column (2.25rem) and the bubble's padding (1.5rem), then
		// 140px (8.75rem) narrower still, kept left with the pane to its right.
		<div className="flex w-full max-w-[calc(75ch-5rem)] flex-col gap-8 text-sm">
			{memberText ? (
				<div className="flex flex-col gap-2">
					<MemberFactLine turn={turn} userLabel={userLabel} />
					<MemberBubble
						imageUrl={userImageUrl}
						label={userLabel}
						preview={!body}
						text={memberText}
					/>
				</div>
			) : null}

			<div data-turn-answer="" className="flex scroll-mt-4 flex-col gap-4">
				{/* What the agent did, the turn's facts, then its answer beside the
				    model's avatar; the rows above line up with the answer's text. */}
				{waterfall ? (
					<div className="pl-9">
						<TurnSteps
							body={body}
							costShade={costShade}
							marks={getReaderTurnMarks(turn, body)}
							model={model}
							runUi={runUi}
							turn={turn}
							waterfall={waterfall}
						/>
					</div>
				) : null}

				<div className="flex gap-3">
					<ModelAvatar loading={bodyState.status === "loading"} model={model} />
					<div className="min-w-0 flex-1">
						{bodyState.status === "loading" ? (
							<AssistantSkeleton />
						) : bodyState.status === "failed" ? (
							<p className="pt-0.5 text-sm text-muted-foreground">
								This turn could not be loaded.{" "}
								<button
									type="button"
									onClick={onRetry}
									className="cursor-pointer underline underline-offset-2 hover:text-foreground"
								>
									Retry
								</button>
							</p>
						) : finalMessage ? (
							<AssistantResponse text={finalMessage} />
						) : (
							<p className="pt-0.5 text-sm italic text-muted-foreground">
								No response recorded.
							</p>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function MemberBubble({
	imageUrl,
	label,
	preview,
	text,
}: {
	imageUrl: string | undefined;
	label: string;
	preview: boolean;
	text: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const clamped = !expanded && text.length > MEMBER_TEXT_CLAMP;
	return (
		<div className="flex gap-3">
			<Avatar className="mt-1.5 size-6 shrink-0 shadow-(--custom-shadow) after:hidden">
				{imageUrl ? <AvatarImage src={imageUrl} alt="" /> : null}
				<AvatarFallback className="text-[0.625rem]">
					{label.charAt(0).toUpperCase()}
				</AvatarFallback>
			</Avatar>
			<div className="min-w-0 flex-1 rounded-lg bg-card px-3 py-2.5 shadow-(--custom-shadow) corner-squircle squircle:rounded-2xl dark:bg-muted-foreground/10">
				<p
					className={cn(
						"whitespace-pre-wrap text-sm [overflow-wrap:anywhere]",
						preview && "text-muted-foreground",
					)}
				>
					<SignalText
						scanSignals={scanMemberLanguageSignals}
						text={clamped ? `${text.slice(0, MEMBER_TEXT_CLAMP)}…` : text}
					/>
				</p>
				{text.length > MEMBER_TEXT_CLAMP ? (
					<button
						type="button"
						onClick={() => setExpanded((value) => !value)}
						className="mt-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
					>
						{expanded ? "Show less" : "Show more"}
					</button>
				) : null}
			</div>
		</div>
	);
}

/** The model's avatar on the Opaline pebble; a pulsing pebble while the
 * turn's body loads. */
function ModelAvatar({
	loading,
	model,
}: {
	loading: boolean;
	model: string | null;
}) {
	if (loading) {
		return (
			<span className="relative size-6 shrink-0 animate-pulse [--opal-fill:var(--muted)] [--opal-ring:transparent]">
				<OpalineShape className="absolute inset-0" />
			</span>
		);
	}
	const ModelIcon = getModelIconComponent(model ?? undefined);
	return (
		// The sessions overview's white model pebble, with the chips' soft
		// drop shadow and inner ring in a neutral tone.
		<OpalChip
			tint="var(--foreground)"
			title={model ?? undefined}
			className="size-6 text-muted-foreground [--opal-fill:#fff] dark:[--opal-fill:color-mix(in_oklab,#fff_14%,var(--background))]"
		>
			{ModelIcon ? (
				<ModelIcon
					className={cn("size-3.5", getModelBrandIconClassName(model ?? ""))}
				/>
			) : (
				<IconSparkles aria-hidden="true" className="size-3.5" />
			)}
		</OpalChip>
	);
}

/** Marks the language signals — an apology, positive or negative wording — in
 * a node's own text, as the classic reader does; nested elements mark theirs. */
function withSignals(children: ReactNode): ReactNode {
	return Children.map(children, (child) =>
		typeof child === "string" ? <SignalText text={child} /> : child,
	);
}

/** A markdown element as its own tag, with the signals in its text marked. */
function signalMarked(Tag: SignalTag) {
	return function SignalMarked({
		children,
		node: _node,
		...props
	}: ComponentProps<SignalTag> & { node?: unknown }) {
		return createElement(Tag, props, withSignals(children));
	};
}

type SignalTag =
	| "blockquote"
	| "em"
	| "h1"
	| "h2"
	| "h3"
	| "h4"
	| "li"
	| "p"
	| "strong"
	| "td"
	| "th";

/** The answer's prose elements with their signals marked; code is left
 * alone. */
const SIGNAL_MARKDOWN: Components = {
	blockquote: signalMarked("blockquote"),
	em: signalMarked("em"),
	h1: signalMarked("h1"),
	h2: signalMarked("h2"),
	h3: signalMarked("h3"),
	h4: signalMarked("h4"),
	li: signalMarked("li"),
	p: signalMarked("p"),
	strong: signalMarked("strong"),
	td: signalMarked("td"),
	th: signalMarked("th"),
};

function AssistantResponse({ text }: { text: string }) {
	return (
		<div className="group/bubble flex items-start justify-between gap-2 px-1">
			<div className="min-w-0 flex-1 text-sm leading-relaxed [overflow-wrap:anywhere] [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.8125rem] [&_h1]:mt-3 [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-2 [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
				<Markdown components={SIGNAL_MARKDOWN} remarkPlugins={[remarkGfm]}>
					{text}
				</Markdown>
			</div>
			<div className="shrink-0 opacity-0 transition-opacity group-hover/bubble:opacity-100">
				<CopyButton value={text} title="Copy response" />
			</div>
		</div>
	);
}

function AssistantSkeleton() {
	return (
		<div className="flex flex-col gap-2 px-1 pt-1">
			<Skeleton className="h-3.5 w-full" />
			<Skeleton className="h-3.5 w-11/12" />
			<Skeleton className="h-3.5 w-2/3" />
		</div>
	);
}
