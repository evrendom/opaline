import { ConversationTrace } from "@/components/conversation/ConversationTrace";
import type { TraceItem } from "@/components/conversation/conversation-trace";
import {
	buildConversationTraceFixtureTurns,
	CONVERSATION_TRACE_FIXTURE_AGENT_LABEL,
	CONVERSATION_TRACE_FIXTURE_MODEL,
	CONVERSATION_TRACE_FIXTURE_USER_LABEL,
} from "@/components/conversation/conversation-trace-fixture";
import "@/features/dashboard/dashboard-theme.css";
import { SessionContinuousTurnSkeleton } from "./session-continuous-turn-skeleton";
import "./session-constellation-tree.css";
import "./session-transcript-mask.css";
import type { SessionTurnTablePaneOption } from "./session-turn-table-pane";

const MASK_SKELETON_OPTION = {
	compactionsBefore: [],
	key: "transcript-mask-skeleton",
	memberPreview: "No member message",
	metrics: {
		editedFiles: [],
		errorCount: 0,
		errorEvents: [],
		estimatedCost: 0,
		inputTokens: 0,
		outputTokens: 0,
		skillEvents: [],
		skills: [],
		usageEvents: [],
	},
	preview: "Loading response",
	slashCommands: [],
	timing: {
		durationLabel: undefined,
		durationSeconds: undefined,
		endTime: "10:02",
		startTime: "10:00",
	},
	toolCallCount: 1,
	turnNumber: 1,
} satisfies SessionTurnTablePaneOption;

const MASK_COLLAPSED_TRACE_ITEMS = buildMaskCollapsedTraceItems();

function buildMaskCollapsedTraceItems(): TraceItem[] {
	const agentItem = buildConversationTraceFixtureTurns()
		.flatMap((turn) => turn.items)
		.find((item) => item.kind === "agent");
	const reasoningEvent = agentItem?.events.find(
		(event) => event.kind === "reasoning",
	);
	if (!(agentItem && reasoningEvent)) {
		return [];
	}
	return [
		{ ...agentItem, events: [reasoningEvent], id: "transcript-mask-row" },
	];
}

const SESSION_THEME_CLASS_NAME = "";

export function TranscriptMaskFixturePage() {
	return (
		<main className="transcript-mask-demo dashboardy-page grid h-dvh min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-canvas font-body text-ink">
			<header className="flex min-h-12 items-center justify-between edge-b-m border-line px-xl">
				<div>
					<h1 className="text-body-xl font-heavy">Transcript gap texture</h1>
					<p className="text-body-m text-(--dashboardy-body-muted)">
						The exposed panes are the production scroll surface with no rows.
					</p>
				</div>
				<label className="flex min-h-11 items-center gap-m text-body-m font-medium">
					<input
						className="size-4"
						data-transcript-mask-toggle
						type="checkbox"
					/>
					Overlay real rows
				</label>
			</header>
			<div className="grid min-h-0 grid-cols-2">
				<MaskPane label="Light" />
				<div className="dark min-h-0">
					<MaskPane label="Dark" />
				</div>
			</div>
		</main>
	);
}

function MaskPane({ label }: { label: string }) {
	return (
		<section
			className={`dashboardy-page relative h-full min-h-0 overflow-hidden bg-canvas ${SESSION_THEME_CLASS_NAME}`}
			data-transcript-mask-theme={label.toLowerCase()}
		>
			<div className="pointer-events-none absolute top-3 left-4 z-10 corner-xs bg-canvas px-m py-xs text-body-m font-medium text-ink-3 shadow-sm">
				{label}
			</div>
			<section
				aria-label={`${label} transcript texture`}
				className="session-constellation-tree session-transcript-mask h-full min-h-0 overflow-y-auto overscroll-contain bg-canvas [overflow-anchor:none] [scrollbar-gutter:stable]"
				data-conversation-trace-scroll-container
				data-transcript-mask-exposed
			>
				<div aria-hidden className="h-[200vh]" />
			</section>
			<div
				className="session-transcript-row-surface absolute inset-x-4 top-14 z-20 max-h-[calc(100%-4.5rem)] overflow-hidden corner-s edge-m border-line-strong shadow-sm"
				data-transcript-mask-overlay
			>
				<SessionContinuousTurnSkeleton
					continuesThread
					option={MASK_SKELETON_OPTION}
					userLabel={CONVERSATION_TRACE_FIXTURE_USER_LABEL}
				/>
				<ConversationTrace
					agentLabel={CONVERSATION_TRACE_FIXTURE_AGENT_LABEL}
					agentModel={CONVERSATION_TRACE_FIXTURE_MODEL}
					className="edge-t-m border-line-strong"
					expandedSpeakerLayout="trace-tree"
					items={MASK_COLLAPSED_TRACE_ITEMS}
					userLabel={CONVERSATION_TRACE_FIXTURE_USER_LABEL}
				/>
			</div>
		</section>
	);
}
