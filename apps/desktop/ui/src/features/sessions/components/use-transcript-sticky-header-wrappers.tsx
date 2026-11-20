// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: Sticky-header grouping and wrapper rendering share one geometry contract.

import type { VirtualItem } from "@tanstack/react-virtual";
import { memo, useCallback, useRef, useState } from "react";
import { TouchTarget } from "@/app/ui/touch-target";
import { ConversationTraceTreeItem } from "@/components/conversation/ConversationTrace";
import type { TraceEvent } from "@/components/conversation/conversation-trace";
import {
	TraceBotIcon,
	TraceBrainIcon,
	TraceChevronDownIcon,
	TraceFileAddIcon,
	TraceImageIcon,
	TraceMessageIcon,
	TracePencilIcon,
	TraceReadIcon,
	TraceSparklesIcon,
} from "@/components/conversation/conversation-trace-glyphs";
import { UserTraceAvatar } from "@/components/conversation/conversation-trace-icons";
import {
	ModelSectionHeader,
	type ModelSectionHeaderData,
} from "@/components/conversation/model-section-header";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { cn } from "@/lib/utils";
import { hasTranscriptFoldActivity } from "./session-transcript-folds";
import type { SessionTranscriptRow } from "./session-transcript-sections";

type TranscriptStickyHeaderKind = "member" | "model";

type TranscriptStickyHeaderGeometry = {
	continues: boolean;
	renderHeight?: number;
	terminal: boolean;
};

export type TranscriptMemberHeaderData = TranscriptStickyHeaderGeometry & {
	kind: "member";
	userImageUrl: string | undefined;
	userLabel: string;
};

export type TranscriptModelHeaderData = ModelSectionHeaderData &
	TranscriptStickyHeaderGeometry & {
		events: readonly TraceEvent[] | undefined;
		fold?: Pick<
			Extract<SessionTranscriptRow, { kind: "turn-fold" }>,
			"expanded" | "hidden"
		>;
		kind: "model";
	};

export function TranscriptFoldSummaryControl({
	expanded,
	hidden,
	onToggle,
	turnId,
}: {
	expanded: boolean;
	hidden: Extract<SessionTranscriptRow, { kind: "turn-fold" }>["hidden"];
	onToggle: () => void;
	turnId: string | undefined;
}) {
	if (!hasTranscriptFoldActivity(hidden)) return null;
	const label = [
		hidden.toolCalls > 0
			? `${hidden.toolCalls.toLocaleString()} tool call${hidden.toolCalls === 1 ? "" : "s"}`
			: undefined,
		hidden.messages > 0
			? `${hidden.messages.toLocaleString()} message${hidden.messages === 1 ? "" : "s"}`
			: undefined,
	]
		.filter(Boolean)
		.join(", ");
	const metrics = [
		{
			count: hidden.reasoning,
			Icon: TraceBrainIcon,
			kind: "reasoning",
			label: "Reasoning",
			tone: "violet",
			toolIcon: undefined,
		},
		{
			count: hidden.messages,
			Icon: TraceMessageIcon,
			kind: "messages",
			label: "Messages",
			tone: "blue",
			toolIcon: undefined,
		},
		{
			count: hidden.skills,
			Icon: TraceSparklesIcon,
			kind: "skills",
			label: "Skills",
			tone: "amber",
			toolIcon: "sparkle",
		},
		{
			count: hidden.subagents,
			Icon: TraceBotIcon,
			kind: "subagents",
			label: "Subagents",
			tone: "amber",
			toolIcon: "bot",
		},
		{
			count: hidden.filesRead,
			Icon: TraceReadIcon,
			kind: "files-read",
			label: "Files Read",
			tone: "neutral",
			toolIcon: undefined,
		},
		{
			count: hidden.filesViewed,
			Icon: TraceImageIcon,
			kind: "images-viewed",
			label: "Images Viewed",
			tone: "amber",
			toolIcon: "image",
		},
		{
			count: hidden.filesWritten,
			Icon: TraceFileAddIcon,
			kind: "files-written",
			label: "Files Written",
			tone: "amber",
			toolIcon: "file-add",
		},
		{
			count: hidden.filesEdited,
			Icon: TracePencilIcon,
			kind: "files-edited",
			label: "Files Edited",
			tone: "amber",
			toolIcon: "pencil",
		},
	].filter(({ count }) => count > 0);
	const action = expanded ? "Collapse" : "Show";
	const metricLabel = metrics
		.map(({ count, label }) => `${count.toLocaleString()} ${label}`)
		.join(", ");
	return (
		<div className="min-w-0 pr-l">
			<button
				aria-expanded={expanded}
				aria-label={`${action} ${label}${metricLabel ? `: ${metricLabel}` : ""}`}
				className="group group/fold pointer-events-auto relative flex h-8 max-w-full min-w-0 select-none items-center gap-m corner-s pr-s pl-l text-left text-[0.6875rem]/[1.0625rem] text-ink-3 outline-none hover:text-ink"
				data-transcript-fold-turn-id={turnId}
				data-trace-hover-row
				onClick={onToggle}
				title={`${action} ${label}`}
				type="button"
			>
				<TouchTarget className="pointer-events-none" />
				<span className="shrink-0 font-medium">{label}</span>
				<span
					aria-hidden="true"
					className="flex min-w-0 items-center gap-m overflow-x-auto tabular-nums [scrollbar-width:none]"
					data-transcript-fold-summary-metrics
				>
					{metrics.map(({ count, Icon, kind, label, tone, toolIcon }) => (
						<span
							key={kind}
							className={cn(
								"flex h-5 min-w-5 shrink-0 items-center gap-xxs",
								"py-zero pr-s pl-xs",
								"font-medium",
							)}
							data-transcript-fold-summary-metric={kind}
							data-trace-icon-tone={tone}
							data-trace-tool-icon={toolIcon}
							title={`${count.toLocaleString()} ${label}`}
						>
							<Icon className="size-3.5 shrink-0" />
							<span>{count.toLocaleString()}</span>
						</span>
					))}
				</span>
				<TraceChevronDownIcon
					aria-hidden="true"
					className={cn("size-3 shrink-0", !expanded && "-rotate-90")}
				/>
			</button>
		</div>
	);
}

export type TranscriptStickyHeaderGroup = {
	endRowIndex: number;
	header: TranscriptMemberHeaderData | TranscriptModelHeaderData;
	headerRowIndex: number;
	ownerKey: string;
	startRowIndex: number;
	turnId: string;
};

export type TranscriptStickyHeaderPlacement = {
	extent: number;
	group: TranscriptStickyHeaderGroup;
	start: number;
};

type TranscriptStickyHeaderAnchor = {
	header:
		| Omit<TranscriptMemberHeaderData, "continues" | "terminal">
		| Omit<TranscriptModelHeaderData, "continues" | "terminal">;
	headerRowIndex: number;
	turnId: string;
};

function createMemberHeaderAnchor(input: {
	headerRowIndex: number;
	renderHeight: number | undefined;
	turnId: string;
	userImageUrl: string | undefined;
	userLabel: string;
}): TranscriptStickyHeaderAnchor {
	return {
		header: {
			kind: "member",
			renderHeight: input.renderHeight,
			userImageUrl: input.userImageUrl,
			userLabel: input.userLabel,
		},
		headerRowIndex: input.headerRowIndex,
		turnId: input.turnId,
	};
}

function finalizeStickyHeaderAnchor(input: {
	anchor: TranscriptStickyHeaderAnchor;
	endRowIndex: number;
	rowCount: number;
	startRowIndex: number;
}): TranscriptStickyHeaderGroup {
	const geometry = {
		continues: input.anchor.headerRowIndex < input.rowCount - 1,
		terminal: input.endRowIndex === input.rowCount - 1,
	};
	const header: TranscriptMemberHeaderData | TranscriptModelHeaderData = {
		...input.anchor.header,
		...geometry,
	};
	return {
		endRowIndex: input.endRowIndex,
		header,
		headerRowIndex: input.anchor.headerRowIndex,
		ownerKey: [
			input.anchor.turnId,
			header.kind,
			input.anchor.headerRowIndex,
			header.kind === "model" ? header.agentModel : header.userImageUrl,
			header.kind === "model" ? header.agentLabel : header.userLabel,
			header.kind === "model" ? header.modelSetting : undefined,
			header.kind === "model" ? header.planMode : false,
			header.kind === "model" ? header.fold?.expanded : undefined,
			header.continues,
			header.terminal,
			header.renderHeight,
		].join(":"),
		startRowIndex: input.startRowIndex,
		turnId: input.anchor.turnId,
	};
}

export function deriveTranscriptStickyHeaderGroups(input: {
	agentModel: string | undefined;
	headerHeights?: Partial<Record<TranscriptStickyHeaderKind, number>>;
	rows: readonly SessionTranscriptRow[];
	userImageUrl: string | undefined;
	userLabel: string;
}) {
	if (input.rows.length === 0) {
		return [];
	}
	const anchors: TranscriptStickyHeaderAnchor[] = [];
	for (const [index, row] of input.rows.entries()) {
		if (row.kind === "member") {
			anchors.push(
				createMemberHeaderAnchor({
					headerRowIndex: index,
					renderHeight: input.headerHeights?.member,
					turnId: row.turnId,
					userImageUrl: input.userImageUrl,
					userLabel: input.userLabel,
				}),
			);
			continue;
		}
		if (row.kind === "turn-fold") {
			const agentModel = row.agentModel ?? input.agentModel;
			anchors.push({
				header: {
					agentLabel: agentModel
						? formatModelDisplayLabel(agentModel)
						: "Agent",
					agentModel,
					events: row.allEvents,
					fold: { expanded: row.expanded, hidden: row.hidden },
					kind: "model",
					...(row.modelSetting ? { modelSetting: row.modelSetting } : {}),
					planMode: row.planMode,
					renderHeight: input.headerHeights?.model,
				},
				headerRowIndex: index,
				turnId: row.turnId,
			});
			continue;
		}
		if (row.kind === "section" && row.isFirst) {
			const traceSection = row.section.payload.traceSection;
			const agentModel =
				(traceSection.kind === "agent"
					? traceSection.usage?.model
					: undefined) ?? input.agentModel;
			anchors.push({
				header: {
					agentLabel: agentModel
						? formatModelDisplayLabel(agentModel)
						: "Agent",
					agentModel,
					events: row.section.payload.allEvents.events,
					kind: "model",
					...(row.section.payload.modelSetting
						? { modelSetting: row.section.payload.modelSetting }
						: {}),
					planMode: row.section.payload.planMode,
					renderHeight: input.headerHeights?.model,
				},
				headerRowIndex: index,
				turnId: row.turnId,
			});
			continue;
		}
		if (
			(row.kind === "turn-pending" ||
				row.kind === "turn-error" ||
				row.kind === "no-response") &&
			anchors.at(-1)?.turnId !== row.turnId
		) {
			anchors.push(
				createMemberHeaderAnchor({
					headerRowIndex: index,
					renderHeight: input.headerHeights?.member,
					turnId: row.turnId,
					userImageUrl: input.userImageUrl,
					userLabel: input.userLabel,
				}),
			);
		}
	}
	if (anchors.length === 0) {
		const firstRow = input.rows[0];
		anchors.push(
			createMemberHeaderAnchor({
				headerRowIndex: 0,
				renderHeight: input.headerHeights?.member,
				turnId:
					firstRow && "turnId" in firstRow ? firstRow.turnId : "transcript",
				userImageUrl: input.userImageUrl,
				userLabel: input.userLabel,
			}),
		);
	}
	return anchors.map((anchor, index) => {
		const nextAnchor = anchors[index + 1];
		return finalizeStickyHeaderAnchor({
			anchor,
			endRowIndex: nextAnchor
				? nextAnchor.headerRowIndex - 1
				: input.rows.length - 1,
			rowCount: input.rows.length,
			startRowIndex: index === 0 ? 0 : anchor.headerRowIndex,
		});
	});
}

export function placeTranscriptStickyHeaderGroups(input: {
	groups: readonly TranscriptStickyHeaderGroup[];
	measurements: readonly VirtualItem[];
	virtualItems: readonly VirtualItem[];
}) {
	const firstVirtualIndex = input.virtualItems[0]?.index;
	const lastVirtualIndex = input.virtualItems.at(-1)?.index;
	if (firstVirtualIndex === undefined || lastVirtualIndex === undefined) {
		return [];
	}
	return input.groups.flatMap((group) => {
		if (
			group.endRowIndex < firstVirtualIndex ||
			group.headerRowIndex > lastVirtualIndex
		) {
			return [];
		}
		const start = input.measurements[group.headerRowIndex]?.start;
		const end = input.measurements[group.endRowIndex]?.end;
		if (start === undefined || end === undefined || end <= start) {
			return [];
		}
		return [{ extent: end - start, group, start }];
	});
}

function haveSamePlacementMembership(
	left: readonly TranscriptStickyHeaderPlacement[],
	right: readonly TranscriptStickyHeaderPlacement[],
) {
	return (
		left.length === right.length &&
		left.every(
			(placement, index) =>
				right[index]?.group.ownerKey === placement.group.ownerKey,
		)
	);
}

function applyStickyHeaderPlacement(
	element: HTMLElement,
	placement: TranscriptStickyHeaderPlacement,
) {
	const height = `${placement.extent}px`;
	const top = `${placement.start}px`;
	if (element.style.height !== height) {
		element.style.height = height;
	}
	if (element.style.top !== top) {
		element.style.top = top;
	}
}

export function useTranscriptStickyHeaderWrappers(input: {
	groups: readonly TranscriptStickyHeaderGroup[];
}) {
	const placementsRef = useRef<readonly TranscriptStickyHeaderPlacement[]>([]);
	const wrapperElementsRef = useRef(new Map<string, HTMLElement>());
	const [placements, setPlacements] = useState<
		readonly TranscriptStickyHeaderPlacement[]
	>([]);
	const registerWrapper = useCallback(
		(ownerKey: string, element: HTMLDivElement | null) => {
			if (!element) {
				wrapperElementsRef.current.delete(ownerKey);
				return;
			}
			wrapperElementsRef.current.set(ownerKey, element);
			const placement = placementsRef.current.find(
				(candidate) => candidate.group.ownerKey === ownerKey,
			);
			if (placement) {
				applyStickyHeaderPlacement(element, placement);
			}
		},
		[],
	);
	const sync = useCallback(
		(inputValue: {
			measurements: readonly VirtualItem[];
			virtualItems: readonly VirtualItem[];
		}) => {
			const next = placeTranscriptStickyHeaderGroups({
				groups: input.groups,
				...inputValue,
			});
			const current = placementsRef.current;
			if (haveSamePlacementMembership(current, next)) {
				if (
					current.some(
						(placement, index) => placement.group !== next[index]?.group,
					)
				) {
					placementsRef.current = next;
					setPlacements(next);
					return;
				}
				for (const [index, placement] of current.entries()) {
					const nextPlacement = next[index];
					if (!nextPlacement) {
						continue;
					}
					if (
						placement.extent === nextPlacement.extent &&
						placement.start === nextPlacement.start
					) {
						continue;
					}
					placement.extent = nextPlacement.extent;
					placement.start = nextPlacement.start;
					const element = wrapperElementsRef.current.get(
						placement.group.ownerKey,
					);
					if (element) {
						applyStickyHeaderPlacement(element, placement);
					}
				}
				return;
			}
			placementsRef.current = next;
			setPlacements(next);
		},
		[input.groups],
	);
	return { placements, registerWrapper, sync };
}

function TranscriptStickyHeaderVisual({
	group,
}: {
	group: TranscriptStickyHeaderGroup;
}) {
	return (
		<ConversationTraceTreeItem
			childRailExitLength={group.header.kind === "model" ? 2 : 0}
			continues={group.header.continues}
			depth={1}
			descends={group.header.kind === "model"}
			rowHeight={group.header.renderHeight}
		>
			<div
				className="@container/model-header flex min-h-10 min-w-0 items-center gap-m pr-l"
				style={
					group.header.renderHeight
						? { minHeight: group.header.renderHeight }
						: undefined
				}
			>
				{group.header.kind === "member" ? (
					<>
						<UserTraceAvatar
							expanded={false}
							expandable={false}
							imageUrl={group.header.userImageUrl}
						/>
						<div className="group flex min-w-0 items-center gap-zero text-left">
							<h3
								className="min-w-0 shrink-0 truncate text-body-m font-medium text-ink"
								data-trace-user-label
							>
								{group.header.userLabel}
							</h3>
						</div>
					</>
				) : (
					<div className="flex min-h-10 min-w-0 flex-1 items-center gap-m text-left">
						<ModelSectionHeader
							data={group.header}
							expanded
							expandable={false}
						/>
					</div>
				)}
			</div>
		</ConversationTraceTreeItem>
	);
}

export const TranscriptStickyHeaderWrappers = memo(
	function TranscriptStickyHeaderWrappers({
		placements,
		registerWrapper,
	}: {
		placements: readonly TranscriptStickyHeaderPlacement[];
		registerWrapper: (ownerKey: string, element: HTMLDivElement | null) => void;
	}) {
		return placements.map((placement) => (
			<div
				key={placement.group.ownerKey}
				className="pointer-events-none absolute left-0 z-40 w-full min-w-0"
				data-transcript-sticky-header-wrapper={placement.group.ownerKey}
				ref={(element) => registerWrapper(placement.group.ownerKey, element)}
				style={{ height: placement.extent, top: placement.start }}
			>
				<div
					aria-hidden="true"
					className="pointer-events-none sticky top-0 w-full min-w-0 bg-canvas"
					data-transcript-sticky-header
					data-transcript-sticky-header-kind={placement.group.header.kind}
					data-transcript-sticky-header-owner={placement.group.turnId}
					data-transcript-sticky-header-terminal={
						placement.group.header.terminal || undefined
					}
				>
					<TranscriptStickyHeaderVisual group={placement.group} />
				</div>
			</div>
		));
	},
);
