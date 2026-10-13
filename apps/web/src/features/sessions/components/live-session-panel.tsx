import {
	type Conversation,
	type LiveSessionSource,
	type LiveSessionSummary,
	parseCodexConversations,
	resolveRepoIdentity,
} from "@rudel/api-routes";
import {
	memo,
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	ConversationTrace,
	TraceExpansionNamespaceProvider,
} from "@/components/conversation/ConversationTrace";
import {
	buildConversationTrace,
	type TraceItem,
} from "@/components/conversation/conversation-trace";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { parseConversations } from "@/lib/conversation-schema";
import { formatUsername } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
	formatLiveSessionActivity,
	formatLiveSessionSource,
	isLiveSessionActive,
	type LiveSessionStream,
	readLatestLiveSessionModel,
	readLiveSessionState,
} from "../live-session-model";
import { useLiveClock, useLiveSessionTail } from "../use-live-sessions";
import { LiveSessionDot } from "./live-session-dot";

// How close to the bottom still counts as following the newest lines.
const PINNED_THRESHOLD_PX = 32;
const CLOCK_INTERVAL_MS = 5_000;
const SESSION_THEME_CLASS_NAME =
	"bg-(--session-overview-surface) [--session-overview-accent:#266df0] [--session-overview-border:#eeeff1] [--session-overview-hover:#f6f7f7] [--session-overview-muted:rgba(0,0,0,0.63)] [--session-overview-subtle:rgba(0,0,0,0.5)] [--session-overview-surface:#fcfcfc] [--session-overview-text:#101112] [font-family:Inter,sans-serif] dark:[--session-overview-border:rgba(255,255,255,0.08)] dark:[--session-overview-hover:rgba(255,255,255,0.05)] dark:[--session-overview-muted:rgba(255,255,255,0.65)] dark:[--session-overview-subtle:rgba(255,255,255,0.5)] dark:[--session-overview-surface:var(--background)] dark:[--session-overview-text:#e6e6e9]";

/**
 * A session's live lines on its page. `page` fills the page while no
 * uploaded session exists; `inline` sits above the reader of an uploaded
 * session only while the session runs (updated in the last five minutes).
 * It reads the lines the page's polling holds and re-renders only when they
 * change.
 */
export function LiveSessionSlot({
	avatarMap,
	layout,
	sessionId,
	userMap,
}: {
	avatarMap: Record<string, string>;
	layout: "inline" | "page";
	sessionId: string;
	userMap: Record<string, string>;
}) {
	const tail = useLiveSessionTail(sessionId);
	const nowMs = useLiveClock(CLOCK_INTERVAL_MS);
	const session = tail?.session;
	if (!tail || !session) return null;
	if (layout === "inline" && !isLiveSessionActive(session, nowMs)) return null;
	return (
		<LiveSessionPanel
			layout={layout}
			session={session}
			streams={tail.streams}
			userImageUrl={avatarMap[session.userId]}
			userMap={userMap}
		/>
	);
}

/**
 * The transcript of a session as it runs: the main transcript, then each
 * subagent folded. The view follows new lines while the reader is at the
 * bottom.
 */
const LiveSessionPanel = memo(function LiveSessionPanel({
	layout,
	session,
	streams,
	userImageUrl,
	userMap,
}: {
	layout: "inline" | "page";
	session: LiveSessionSummary;
	streams: readonly LiveSessionStream[];
	userImageUrl: string | undefined;
	userMap: Record<string, string>;
}) {
	const scrollerRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const pinnedRef = useRef(true);
	// Our own scrolls to the bottom must not read as the reader leaving it.
	const autoScrollingRef = useRef(false);
	const main = streams.find((stream) => stream.agentId === null);
	const subagents = streams.filter((stream) => stream.agentId !== null);
	const userLabel = formatUsername(session.userId, userMap);

	const handleScroll = useCallback(() => {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		if (autoScrollingRef.current) {
			autoScrollingRef.current = false;
			return;
		}
		pinnedRef.current =
			scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <=
			PINNED_THRESHOLD_PX;
	}, []);
	// New lines, rows that finish rendering after them, and a resized pane all
	// move the bottom: keep the newest in view while the reader follows along.
	useLayoutEffect(() => {
		const scroller = scrollerRef.current;
		const content = contentRef.current;
		if (!scroller || !content) return;
		const follow = () => {
			if (!pinnedRef.current) return;
			const bottom = scroller.scrollHeight - scroller.clientHeight;
			if (Math.abs(scroller.scrollTop - bottom) < 1) return;
			autoScrollingRef.current = true;
			scroller.scrollTop = bottom;
		};
		follow();
		const observer = new ResizeObserver(follow);
		observer.observe(content);
		observer.observe(scroller);
		return () => observer.disconnect();
	}, []);

	return (
		<section
			aria-label="Live session"
			className={cn(
				"flex min-h-0 min-w-0 flex-col",
				SESSION_THEME_CLASS_NAME,
				layout === "page"
					? "h-full"
					: "max-h-[45%] shrink-0 border-b border-(--session-overview-border)",
			)}
		>
			<LiveSessionHeader
				layout={layout}
				session={session}
				userLabel={userLabel}
			/>
			<div
				ref={scrollerRef}
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4"
				data-conversation-trace-scroll-container
				onScroll={handleScroll}
			>
				<div
					ref={contentRef}
					className="mx-auto flex w-full max-w-[calc(75ch+4rem)] flex-col gap-4"
				>
					{main ? (
						<LiveSessionStreamTrace
							source={session.source}
							stream={main}
							userImageUrl={userImageUrl}
							userLabel={userLabel}
						/>
					) : (
						<p className="py-8 text-center text-sm text-(--session-overview-muted)">
							Waiting for the first lines of this session.
						</p>
					)}
					{subagents.map((stream) => (
						<LiveSubagentSection
							key={stream.agentId}
							source={session.source}
							stream={stream}
						/>
					))}
				</div>
			</div>
		</section>
	);
});

/** The panel's header; only it follows the clock ("active 12s ago"). */
function LiveSessionHeader({
	layout,
	session,
	userLabel,
}: {
	layout: "inline" | "page";
	session: LiveSessionSummary;
	userLabel: string;
}) {
	const nowMs = useLiveClock(CLOCK_INTERVAL_MS);
	const state = readLiveSessionState(session, nowMs);
	const repository = resolveRepoIdentity({
		gitRemote: session.gitRemote,
		packageName: null,
		projectPath: session.projectPath,
	}).repoLabel;
	return (
		<header
			className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-(--session-overview-border) px-6 py-2.5 text-xs text-(--session-overview-muted)"
			data-live-session={state}
		>
			<span className="inline-flex items-center gap-1.5 font-semibold text-(--session-overview-text)">
				<LiveSessionDot pulsing={state === "running"} />
				{state === "running" ? "Live" : state === "idle" ? "Idle" : "Ended"}
			</span>
			<span className="truncate">{userLabel}</span>
			<span aria-hidden="true">·</span>
			<span>{formatLiveSessionSource(session.source)}</span>
			<span aria-hidden="true">·</span>
			<span className="truncate" title={session.projectPath}>
				{repository}
				{session.gitBranch ? ` · ${session.gitBranch}` : ""}
			</span>
			<span aria-hidden="true">·</span>
			<time className="tabular-nums" dateTime={session.lastActivityAt}>
				{formatLiveSessionActivity(session.lastActivityAt, nowMs)}
			</time>
			{layout === "page" ? (
				<span className="w-full text-(--session-overview-subtle) sm:ml-auto sm:w-auto">
					{state === "ended"
						? "The full session appears here once it is uploaded."
						: "The full session appears here when it ends."}
				</span>
			) : null}
		</header>
	);
}

/** A folded subagent; its transcript is built only while it is open. */
const LiveSubagentSection = memo(function LiveSubagentSection({
	source,
	stream,
}: {
	source: LiveSessionSource;
	stream: LiveSessionStream;
}) {
	const [open, setOpen] = useState(false);
	return (
		<details
			className="group rounded-lg border border-(--session-overview-border)"
			onToggle={(event) => setOpen(event.currentTarget.open)}
			open={open}
		>
			<summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-(--session-overview-muted) hover:bg-(--session-overview-hover)">
				<span className="font-medium text-(--session-overview-text)">
					Subagent
				</span>
				<span className="truncate font-mono">{stream.agentId}</span>
				<span className="ml-auto tabular-nums">
					{stream.nextLine.toLocaleString()} lines
				</span>
			</summary>
			{open ? (
				<div className="border-t border-(--session-overview-border) px-3 py-3">
					<TraceExpansionNamespaceProvider namespace={`live-${stream.agentId}`}>
						<LiveSessionStreamTrace
							source={source}
							stream={stream}
							userImageUrl={undefined}
							userLabel="Task"
						/>
					</TraceExpansionNamespaceProvider>
				</div>
			) : null}
		</details>
	);
});

const LiveSessionStreamTrace = memo(function LiveSessionStreamTrace({
	source,
	stream,
	userImageUrl,
	userLabel,
}: {
	source: LiveSessionSource;
	stream: LiveSessionStream;
	userImageUrl: string | undefined;
	userLabel: string;
}) {
	const parsedRef = useRef<ParsedStream | undefined>(undefined);
	const { items, model } = useMemo(() => {
		const parsed = parseStream(source, stream, parsedRef.current);
		parsedRef.current = parsed;
		return {
			items: buildTrace(parsed.conversations),
			model: readLatestLiveSessionModel(stream.lines),
		};
	}, [source, stream]);
	return (
		<div className="flex min-w-0 flex-col gap-2">
			{stream.truncatedBefore ? (
				<p className="text-xs text-(--session-overview-subtle)">
					Showing the latest activity. Earlier lines arrive with the full
					session.
				</p>
			) : null}
			<ConversationTrace
				agentLabel={
					model
						? formatModelDisplayLabel(model)
						: formatLiveSessionSource(source)
				}
				agentModel={model}
				agentSectionMode="expanded"
				expandedSpeakerLayout="trace-tree"
				items={items}
				userImageUrl={userImageUrl}
				userLabel={userLabel}
			/>
		</div>
	);
});

interface ParsedStream {
	readonly conversations: readonly Conversation[];
	readonly firstLine: number;
	readonly generation: number;
	readonly lineCount: number;
}

/**
 * The stream's conversations with the shared parsers; unreadable lines show
 * nothing. A Claude Code stream that only grew parses just its new lines (a
 * plan-mode marker carried across polls may read as unknown until the next
 * prompt). Codex rollouts are parsed whole: calls and their outputs are
 * paired across lines, and a tail that starts after `session_meta` would
 * not be recognised as Codex by the generic parser.
 */
function parseStream(
	source: LiveSessionSource,
	stream: LiveSessionStream,
	previous: ParsedStream | undefined,
): ParsedStream {
	const base = {
		firstLine: stream.firstLine,
		generation: stream.generation,
		lineCount: stream.lines.length,
	};
	try {
		if (source === "codex") {
			return {
				...base,
				conversations: parseCodexConversations(stream.lines.join("\n")),
			};
		}
		const grew =
			previous !== undefined &&
			previous.generation === stream.generation &&
			previous.firstLine === stream.firstLine &&
			previous.lineCount <= stream.lines.length;
		return {
			...base,
			conversations: grew
				? [
						...previous.conversations,
						...parseConversations(
							stream.lines.slice(previous.lineCount).join("\n"),
						),
					]
				: parseConversations(stream.lines.join("\n")),
		};
	} catch (error) {
		console.error("[LiveSessionPanel] Could not read live lines", error);
		// Parse everything again with the next lines.
		return { ...base, conversations: [], lineCount: 0 };
	}
}

function buildTrace(conversations: readonly Conversation[]): TraceItem[] {
	try {
		return buildConversationTrace([...conversations]);
	} catch (error) {
		console.error("[LiveSessionPanel] Could not read live lines", error);
		return [];
	}
}
