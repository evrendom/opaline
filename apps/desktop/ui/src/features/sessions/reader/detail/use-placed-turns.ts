import type { LegendListRef } from "@legendapp/list/react";
import type {
	SessionDetailTurnShape,
	SessionDetailTurnSummary,
} from "@rudel/api-routes";
import { type RefObject, useLayoutEffect, useMemo, useRef } from "react";
import {
	MAP_MODEL_EVENT,
	type ModelTurn,
	setPlacedTurns,
	setSessionModel,
} from "../reader-dom";
import { estimateTurnPx, TURN_GAP_PX } from "./reader-turns-pending";

const MEMBER_BASE_PX = 48;
const MEMBER_LINE_PX = 20;
const MEMBER_LINE_CHARS = 90;
const MEMBER_MAX_PX = 260;
const MIN_AGENT_PX = 40;

const timeOf = (value: string | null | undefined) => {
	const ms = value ? Date.parse(value) : Number.NaN;
	return Number.isFinite(ms) ? ms : undefined;
};

type ModelInput = {
	apology: boolean;
	endedAt: string | null;
	errorAt: readonly string[];
	errorCount: number;
	frustrated: boolean;
	hidden: boolean;
	startedAt: string | null;
	subagents: readonly { at: string; subagentId?: string }[];
	toolCallCount: number;
	turnId: string;
	userCharacterCount: number;
};

function inputsOf(
	shapes: readonly SessionDetailTurnShape[] | undefined,
	turns: readonly SessionDetailTurnSummary[],
	isFrustrated: (turn: SessionDetailTurnSummary) => boolean,
	isTurnHidden: (turn: SessionDetailTurnSummary) => boolean,
): ModelInput[] {
	const loaded = new Map(turns.map((turn) => [turn.turnId, turn]));
	if (shapes)
		return shapes.map((shape) => {
			const turn = loaded.get(shape.turnId);
			return {
				...shape,
				frustrated: turn ? isFrustrated(turn) : shape.negative,
				hidden: turn ? isTurnHidden(turn) : false,
			};
		});
	return turns.map((turn) => ({
		apology: (turn.modelApologyCount ?? turn.modelSignalCount) > 0,
		endedAt: turn.endedAt,
		errorAt: turn.errorEvents.map((event) => event.at),
		errorCount: turn.errorCount,
		frustrated: isFrustrated(turn),
		hidden: isTurnHidden(turn),
		startedAt: turn.startedAt,
		subagents: turn.subagentEvents ?? [],
		toolCallCount: turn.toolCallCount,
		turnId: turn.turnId,
		userCharacterCount: turn.userCharacterCount ?? 0,
	}));
}

export function modelTurns(
	inputs: readonly ModelInput[],
	subagentSeconds: ReadonlyMap<string, number>,
): ModelTurn[] {
	return inputs.map((turn) => {
		const member = Math.min(
			MEMBER_BASE_PX +
				Math.ceil(turn.userCharacterCount / MEMBER_LINE_CHARS) * MEMBER_LINE_PX,
			MEMBER_MAX_PX,
		);
		return {
			endMs: timeOf(turn.endedAt),
			errors: turn.errorAt.flatMap((at) => {
				const ms = timeOf(at);
				return ms === undefined ? [] : [ms];
			}),
			height: Math.max(
				estimateTurnPx({
					subagentEvents: turn.subagents,
					toolCallCount: turn.toolCallCount,
					turnId: turn.turnId,
				}),
				member + MIN_AGENT_PX,
			),
			hidden: turn.hidden,
			marks: {
				apology: turn.apology,
				errors: turn.errorCount > 0,
				frustrated: turn.frustrated,
			},
			member,
			startMs: timeOf(turn.startedAt),
			subagents: turn.subagents.flatMap((event) => {
				const startMs = timeOf(event.at);
				if (startMs === undefined) return [];
				const seconds = event.subagentId
					? subagentSeconds.get(event.subagentId)
					: undefined;
				return [
					{
						endMs: seconds === undefined ? undefined : startMs + seconds * 1000,
						id: event.subagentId,
						startMs,
					},
				];
			}),
			turnId: turn.turnId,
		};
	});
}

export function usePlacedTurns({
	complete,
	isFrustrated,
	isTurnHidden,
	listRef,
	scrollElement,
	shapes,
	subagents,
	turnElementsRef,
	turns,
}: {
	complete: boolean;
	isFrustrated: (turn: SessionDetailTurnSummary) => boolean;
	isTurnHidden: (turn: SessionDetailTurnSummary) => boolean;
	listRef: RefObject<LegendListRef | null>;
	scrollElement: HTMLElement | null;
	shapes: readonly SessionDetailTurnShape[] | undefined;
	subagents: readonly {
		durationSeconds?: number | null;
		subagentId: string;
	}[];
	turnElementsRef: RefObject<Map<string, HTMLElement>>;
	turns: readonly SessionDetailTurnSummary[];
}): void {
	const placingRef = useRef({
		isFrustrated,
		isTurnHidden,
		turns,
	});
	placingRef.current = {
		isFrustrated,
		isTurnHidden,
		turns,
	};
	const subagentSeconds = useMemo(
		() =>
			new Map(
				subagents.flatMap((each) =>
					typeof each.durationSeconds === "number"
						? [[each.subagentId, each.durationSeconds] as const]
						: [],
				),
			),
		[subagents],
	);
	const modelRef = useRef<{ key: unknown[]; model: ModelTurn[] } | null>(null);
	const modelKey = [shapes, turns, isFrustrated, isTurnHidden, subagentSeconds];
	if (
		!modelRef.current ||
		modelRef.current.key.some((part, index) => part !== modelKey[index])
	)
		modelRef.current = {
			key: modelKey,
			model: modelTurns(
				inputsOf(shapes, turns, isFrustrated, isTurnHidden),
				subagentSeconds,
			),
		};
	useLayoutEffect(() => {
		if (!scrollElement) return;
		return setPlacedTurns(scrollElement, () => {
			const state = listRef.current?.getState();
			const {
				isFrustrated,
				isTurnHidden: hiddenOf,
				turns: all,
			} = placingRef.current;
			if (!state || all.length === 0) return null;
			const scrollerTop =
				scrollElement.getBoundingClientRect().top - scrollElement.scrollTop;
			const indexes = new Map(all.map((turn, index) => [turn.turnId, index]));
			let origin: number | null = null;
			for (const [turnId, element] of turnElementsRef.current) {
				const index = indexes.get(turnId);
				if (index === undefined) continue;
				origin =
					element.getBoundingClientRect().top -
					scrollerTop -
					state.positionAtIndex(index);
				break;
			}
			if (origin === null) return null;
			const listTop = origin;
			return all.map((turn, index) => {
				const marks = {
					apology: (turn.modelApologyCount ?? turn.modelSignalCount) > 0,
					errors: turn.errorCount > 0,
					frustrated: isFrustrated(turn),
				};
				const element = turnElementsRef.current.get(turn.turnId);
				if (element) {
					const box = element.getBoundingClientRect();
					return {
						bottom: box.bottom - scrollerTop,
						element,
						hidden: hiddenOf(turn),
						marks,
						top: box.top - scrollerTop,
						turnId: turn.turnId,
					};
				}
				const top = listTop + state.positionAtIndex(index);
				const next = all[index + 1]
					? state.positionAtIndex(index + 1)
					: undefined;
				const size = Number.isFinite(state.sizeAtIndex(index))
					? state.sizeAtIndex(index)
					: next !== undefined && Number.isFinite(next)
						? next - state.positionAtIndex(index)
						: estimateTurnPx(turn) + TURN_GAP_PX;
				const height = hiddenOf(turn) ? 0 : Math.max(size - TURN_GAP_PX, 0);
				return {
					bottom: top + height,
					element: undefined,
					hidden: hiddenOf(turn),
					marks,
					top,
					turnId: turn.turnId,
				};
			});
		});
	}, [listRef, scrollElement, turnElementsRef]);
	const ready = complete || shapes !== undefined;
	const readyRef = useRef(ready);
	readyRef.current = ready;
	const model = modelRef.current.model;
	useLayoutEffect(() => {
		if (!scrollElement) return;
		return setSessionModel(scrollElement, () =>
			readyRef.current ? (modelRef.current?.model ?? null) : null,
		);
	}, [scrollElement]);
	useLayoutEffect(() => {
		if (scrollElement && ready && model.length > 0)
			scrollElement.dispatchEvent(new Event(MAP_MODEL_EVENT));
	}, [ready, model, scrollElement]);
}

export function turnKey(turn: SessionDetailTurnSummary) {
	return turn.turnId;
}

export function turnSizeType(turn: SessionDetailTurnSummary) {
	return `turn:${Math.round(Math.log2(Math.max(estimateTurnPx(turn), 1)))}`;
}
