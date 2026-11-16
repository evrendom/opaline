import { LegendList, type LegendListRef } from "@legendapp/list/react";
import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import type { RefObject } from "react";
import type { useFlaggedTurns } from "@/features/compass/session-flags";
import type { RunQuestionAnswer } from "../../run-question-tags";
import { getCostShade } from "../model/session-reader-model";
import type { RunUiStore } from "../model/session-reader-run-ui-store";
import type { RailTagsState } from "../rail/session-reader-rail-tags";
import type { useSessionSubagents } from "../subagents/session-reader-subagent-marks";
import { estimateTurnPx, TURN_GAP_PX } from "./reader-turns-pending";
import { TurnBlock } from "./session-reader-turn-block";
import { ReaderTurnSlot } from "./session-reader-turn-slot";
import { turnKey, turnSizeType } from "./use-placed-turns";
import type { SessionReaderBodyState } from "./use-session-reader-bodies";

const TURN_OVERHANG_PX = 24;

export function ReaderTurnList({
	costThresholds,
	flagged,
	focusTurn,
	getBody,
	initialTurnIndex,
	isTurnHidden,
	keptHeights,
	listRef,
	model,
	onRetry,
	questionsByTurn,
	railTags,
	scrollElement,
	setTurnElement,
	store,
	subagents,
	turns,
	userImageUrl,
	userLabel,
}: {
	costThresholds: number[];
	flagged: ReturnType<typeof useFlaggedTurns>;
	focusTurn: SessionDetailTurnSummary | undefined;
	getBody: (turnId: string) => SessionReaderBodyState;
	initialTurnIndex: number | undefined;
	isTurnHidden: (turn: SessionDetailTurnSummary) => boolean;
	keptHeights: Record<string, number> | undefined;
	listRef: RefObject<LegendListRef | null>;
	model: string | null;
	onRetry: (turnId: string) => void;
	questionsByTurn: ReadonlyMap<string, readonly RunQuestionAnswer[]>;
	railTags: RailTagsState;
	scrollElement: HTMLDivElement | null;
	setTurnElement: (
		turnId: string,
	) => (element: HTMLElement | null) => () => void;
	store: RunUiStore;
	subagents: ReturnType<typeof useSessionSubagents>;
	turns: SessionDetailTurnSummary[];
	userImageUrl: string | undefined;
	userLabel: string;
}) {
	return (
		<LegendList<SessionDetailTurnSummary>
			style={{ marginInline: -TURN_OVERHANG_PX }}
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
						paddingBottom: isTurnHidden(turn) ? 0 : TURN_GAP_PX,
						paddingInline: TURN_OVERHANG_PX,
					}}
				>
					<ReaderTurnSlot
						frustrated={flagged.isFrustrated(turn)}
						hidden={isTurnHidden(turn)}
						holdsEstimate={getBody(turn.turnId).status === "loading"}
						index={index}
						keptHeight={keptHeights?.[turn.turnId]}
						slotRef={setTurnElement(turn.turnId)}
						turn={turn}
					>
						<TurnBlock
							bodyState={getBody(turn.turnId)}
							costShade={getCostShade(turn.estimatedCost, costThresholds)}
							frustrated={flagged.isFrustrated(turn)}
							hidden={railTags.hidden}
							model={model}
							onRetry={onRetry}
							questions={questionsByTurn.get(turn.turnId)}
							store={store}
							subagentDurations={subagents.durations}
							turn={turn}
							userImageUrl={userImageUrl}
							userLabel={userLabel}
						/>
					</ReaderTurnSlot>
				</div>
			)}
		/>
	);
}
