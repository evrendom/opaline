export const CONVERSATION_TRACE_TREE_LEVEL_GAP = 23;
const CONVERSATION_TRACE_TREE_FIRST_X = 16;
export const TRACE_MARKER_SIZE = 16;
const TRACE_RAIL_GAP = 4;
export const TRACE_RAIL_OFFSET = TRACE_MARKER_SIZE / 2 + TRACE_RAIL_GAP;
export const TRACE_DOT_RADIUS = 2;
export const TRACE_DOT_SIZE = TRACE_DOT_RADIUS * 2;
const TRACE_DOT_HORIZONTAL_LINE_OFFSET = TRACE_DOT_RADIUS + TRACE_RAIL_GAP;
export const TRACE_DOT_VERTICAL_LINE_OFFSET = TRACE_DOT_RADIUS + TRACE_RAIL_GAP;

export type ConversationTraceTreeConnectorStyle =
	| "curved"
	| "split-rail"
	| "split-rail-branch"
	| "split-rail-branch-dots"
	| "split-rail-branch-dots-no-horizontal";

export function getConversationTraceTreeBranchPath({
	continues,
	currentX,
	elbowY,
	style,
	width,
}: {
	continues: boolean;
	currentX: number;
	elbowY: number;
	style: ConversationTraceTreeConnectorStyle;
	width: number;
}) {
	if (style === "split-rail") {
		return continues
			? undefined
			: `M ${currentX} 0 V ${Math.max(elbowY - TRACE_RAIL_OFFSET, 0)}`;
	}
	if (style === "split-rail-branch") {
		return continues
			? `M ${currentX} ${elbowY} H ${width - 1}`
			: `M ${currentX} 0 V ${elbowY} H ${width - 1}`;
	}
	if (style === "split-rail-branch-dots-no-horizontal") {
		return continues
			? undefined
			: `M ${currentX} 0 V ${elbowY - TRACE_DOT_VERTICAL_LINE_OFFSET}`;
	}
	if (style === "split-rail-branch-dots") {
		const horizontalPath = `M ${currentX + TRACE_DOT_HORIZONTAL_LINE_OFFSET} ${elbowY} H ${width - 1}`;
		return continues
			? horizontalPath
			: `M ${currentX} 0 V ${elbowY - TRACE_DOT_VERTICAL_LINE_OFFSET} ${horizontalPath}`;
	}
	return continues
		? `M ${currentX} ${elbowY - 6} Q ${currentX} ${elbowY} ${currentX + 6} ${elbowY} H ${width - 1}`
		: `M ${currentX} 0 V ${elbowY - 6} Q ${currentX} ${elbowY} ${currentX + 6} ${elbowY} H ${width - 1}`;
}

export function getConversationTraceTreeX(
	depth: number,
	style: ConversationTraceTreeConnectorStyle = "curved",
) {
	if (style === "split-rail") {
		return (
			6 + depth * CONVERSATION_TRACE_TREE_LEVEL_GAP + TRACE_MARKER_SIZE / 2
		);
	}
	return (
		CONVERSATION_TRACE_TREE_FIRST_X +
		(depth - 1) * CONVERSATION_TRACE_TREE_LEVEL_GAP
	);
}
