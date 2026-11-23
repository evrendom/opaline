import { scanMemberLanguageSignals } from "@rudel/language-signals";
import { type ReactNode, useId } from "react";
import { Pressable } from "@/app/ui/pressable";
import {
	type ConversationTraceSpeakerLayout,
	ConversationTraceTreeItem,
	TraceTextDisclosureIcon,
} from "@/components/conversation/ConversationTrace";
import {
	type UserContent,
	userContentText,
} from "@/components/conversation/conversation-trace";
import {
	conversationTraceSignalAwarePreviewClassName,
	conversationTraceStickyOnlyFillClassName,
} from "@/components/conversation/conversation-trace-class-names";
import { UserTraceAvatar } from "@/components/conversation/conversation-trace-icons";
import {
	isTraceTextCollapsible,
	TraceTextCollapsedPreview,
} from "@/components/conversation/conversation-trace-text-disclosure";
import { useTraceExpansionState } from "@/components/conversation/expandable-trace-row";
import { SignalText } from "@/components/signal-text";
import { cn } from "@/lib/utils";
import type { SessionTurn } from "./session-turns";

function UserPrompt({
	content,
	trailingContent,
}: {
	content: UserContent;
	trailingContent?: ReactNode;
}) {
	return (
		<p className="max-w-[65ch] whitespace-pre-wrap break-words text-body-l text-ink [overflow-wrap:anywhere]">
			<SignalText
				scanSignals={scanMemberLanguageSignals}
				text={userContentText(content)}
			/>
			{trailingContent ? <> {trailingContent}</> : null}
		</p>
	);
}

const userPromptRowClassName = "min-w-0 pt-zero pr-l pb-m pl-xxxl";

export function SessionMemberRow({
	active,
	continues = true,
	headerHeight,
	headerTrailing,
	headingId,
	items,
	speakerLayout,
	startsTrace,
	stickyHeader = true,
	terminal = false,
	userImageUrl,
	userLabel,
}: {
	active: boolean;
	continues?: boolean;
	headerHeight?: number;
	headerTrailing?: ReactNode;
	headingId: string;
	items: SessionTurn["userItems"];
	speakerLayout: ConversationTraceSpeakerLayout;
	startsTrace: boolean;
	stickyHeader?: boolean;
	terminal?: boolean;
	userImageUrl: string | undefined;
	userLabel: string;
}) {
	const promptPanelId = useId();
	const { open: promptExpanded, setOpen: setPromptExpanded } =
		useTraceExpansionState(headingId);

	if (speakerLayout === "trace-tree") {
		const promptPreviewParts = items
			.flatMap((item) =>
				item.kind === "user"
					? [
							{
								text: userContentText(item.content),
							},
						]
					: [],
			)
			.filter(({ text }) => text.length > 0);
		const promptCollapsible = isTraceTextCollapsible(
			promptPreviewParts.map(({ text }) => text).join(""),
		);
		const showFullPrompt = !promptCollapsible || promptExpanded;
		const promptControl = promptCollapsible ? (
			<Pressable
				type="button"
				aria-controls={promptPanelId}
				aria-expanded={promptExpanded}
				className={cn(
					"group inline-flex items-center gap-xxs",
					"corner-xs",
					"align-baseline text-body-m font-medium",
					"text-ink-3",
					"hover:text-ink",
				)}
				data-trace-content-disclosure
				onClick={() => setPromptExpanded((current) => !current)}
			>
				{promptExpanded ? "Less" : "More"}
				<TraceTextDisclosureIcon expanded={promptExpanded} />
			</Pressable>
		) : null;
		const promptItems = items.filter((item) => item.kind === "user");
		const promptRows = (
			<div id={promptPanelId} className="grid min-w-0 divide-y divide-line">
				{showFullPrompt ? (
					promptItems.map((item, index) => (
						<div key={item.id} className={userPromptRowClassName}>
							<UserPrompt
								content={item.content}
								trailingContent={
									index === promptItems.length - 1 ? promptControl : undefined
								}
							/>
						</div>
					))
				) : (
					<div className={userPromptRowClassName}>
						<p
							className={cn(
								conversationTraceSignalAwarePreviewClassName,
								"max-w-[65ch]",
							)}
							data-trace-preview
						>
							<TraceTextCollapsedPreview
								scanSignals={scanMemberLanguageSignals}
								text={promptPreviewParts.map(({ text }) => text)}
								trailingContent={promptControl}
							/>
						</p>
					</div>
				)}
			</div>
		);

		return (
			<section
				aria-labelledby={headingId}
				className={cn("min-w-0", conversationTraceStickyOnlyFillClassName)}
				data-active-member={active ? "true" : undefined}
				data-session-turn-speaker="member"
				data-transcript-member-terminal={terminal || undefined}
				data-trace-start-node={startsTrace ? "true" : undefined}
			>
				<ConversationTraceTreeItem
					continues={continues}
					continuesThroughSubtree
					depth={1}
					hideIncomingRail={startsTrace}
					rowHeight={headerHeight}
					sticky={stickyHeader}
					subtree={promptRows}
				>
					<div
						className={cn(
							"flex min-h-10 w-full min-w-0 items-center gap-m",
							"pr-l",
							"text-left",
						)}
						data-transcript-user-header-source="row"
						style={headerHeight ? { minHeight: headerHeight } : undefined}
					>
						<UserTraceAvatar
							expanded={false}
							expandable={false}
							imageUrl={userImageUrl}
						/>
						<h3
							id={headingId}
							className="min-w-0 shrink-0 truncate text-body-m font-medium text-ink"
						>
							{userLabel}
						</h3>
						{headerTrailing ? (
							<div className="ml-auto min-w-0">{headerTrailing}</div>
						) : null}
					</div>
				</ConversationTraceTreeItem>
			</section>
		);
	}

	if (speakerLayout === "table-row") {
		return (
			<section
				aria-labelledby={headingId}
				className="min-w-0 edge-b-m border-line bg-canvas"
			>
				<div
					className={cn(
						"sticky top-0 z-20 flex min-h-9 min-w-0 items-center gap-m",
						"edge-b-m px-l py-m",
						"border-line bg-canvas",
					)}
				>
					<UserTraceAvatar
						expanded={false}
						expandable={false}
						imageUrl={userImageUrl}
					/>
					<h3
						id={headingId}
						className="min-w-0 truncate text-body-m font-medium text-ink-3"
					>
						{userLabel}
					</h3>
					{headerTrailing ? (
						<div className="ml-auto min-w-0">{headerTrailing}</div>
					) : null}
				</div>
				<div className="grid min-w-0 divide-y divide-line">
					{items.map((item) =>
						item.kind === "user" ? (
							<div key={item.id} className="min-w-0 py-m pr-l pl-xxxl">
								<UserPrompt content={item.content} />
							</div>
						) : null,
					)}
				</div>
			</section>
		);
	}

	return (
		<section
			aria-labelledby={headingId}
			className="flex min-w-0 items-start gap-m py-xxl"
		>
			<UserTraceAvatar
				expanded={false}
				expandable={false}
				imageUrl={userImageUrl}
			/>
			<div className="grid min-w-0 flex-1 gap-m">
				<h3 id={headingId} className="text-body-m font-medium text-ink-3">
					{userLabel}
				</h3>
				{items.map((item) =>
					item.kind === "user" ? (
						<UserPrompt key={item.id} content={item.content} />
					) : null,
				)}
			</div>
		</section>
	);
}
