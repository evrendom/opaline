import {
	getRawToolInput,
	type SessionDetailTurnSummary,
} from "@rudel/api-routes";
import {
	createContext,
	memo,
	type RefObject,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
} from "react";
import { useLatestValueRef } from "@/app/hooks/useLatestValueRef";
import { cn } from "@/lib/utils";
import { ReaderMinimap } from "../minimap/session-reader-minimap";
import type { SessionMapKey } from "../minimap/session-reader-minimap-store";
import type { SessionReaderStep } from "../model/session-reader-model";
import {
	AGENT_PARAM,
	pickOf,
	updateReaderParams,
	useReaderSearchParams,
	writeAgent,
	writePick,
} from "../reader-params";
import { getSubagentLaunches } from "../summary/session-summary-model";

export { subagentIdOf } from "@rudel/api-routes/session-context/session-reader-subagents";

export function useAgentFocus(): {
	focus: string | null;
	setFocus: (
		subagentId: string | null,
		run?: string,
		options?: { replace?: boolean },
	) => void;
} {
	const [searchParams, setSearchParams] = useReaderSearchParams();
	const setSearchParamsRef = useLatestValueRef(setSearchParams);
	return {
		focus: searchParams.get(AGENT_PARAM),
		setFocus: useCallback(
			(
				subagentId: string | null,
				run?: string,
				options?: { replace?: boolean },
			) =>
				updateReaderParams(
					setSearchParamsRef.current,
					(params) => {
						if (run !== undefined) writePick(params, pickOf(run, subagentId));
						else writeAgent(params, subagentId);
					},
					options,
				),
			[setSearchParamsRef],
		),
	};
}

export const OpenSubagentContext = createContext<
	((subagentId: string) => void) | null
>(null);

export function useOpenSubagent() {
	return useContext(OpenSubagentContext);
}

export function subagentBrief(step: SessionReaderStep): {
	prompt: string | null;
	purpose: string | null;
	report: string | null;
} {
	const input = step.toolEvent ? getRawToolInput(step.toolEvent.input) : {};
	const text = (value: unknown) =>
		typeof value === "string" && value.trim() ? value.trim() : null;
	return {
		prompt: text(input.prompt),
		purpose: text(input.description),
		report: text(step.result),
	};
}

export function turnsWorkedThrough(
	turns: readonly SessionDetailTurnSummary[],
	id: string,
	durationSeconds: number | null | undefined,
): { first: number; last: number } | null {
	const has = (turn: SessionDetailTurnSummary) =>
		(turn.subagentEvents ?? []).some((event) => event.subagentId === id);
	const first = turns.findIndex(has);
	const launch = turns[first];
	if (!launch) return null;
	const launchedAt = Date.parse(
		launch.subagentEvents?.find((event) => event.subagentId === id)?.at ??
			launch.startedAt ??
			"",
	);
	const doneAt =
		typeof durationSeconds === "number"
			? launchedAt + durationSeconds * 1_000
			: null;
	let last = first;
	turns.forEach((turn, index) => {
		if (
			index > last &&
			(has(turn) ||
				(doneAt !== null && Date.parse(turn.startedAt ?? "") <= doneAt))
		)
			last = index;
	});
	return { first, last };
}

export function useReaderFocus({
	complete,
	pendingScrollTurnIdRef,
	requestBodyRef,
	scrollToTurn,
	subagents,
	turns,
}: {
	complete: boolean;
	pendingScrollTurnIdRef: RefObject<string | undefined>;
	requestBodyRef: RefObject<(turnId: string) => void>;
	scrollToTurn: (turnId: string) => void;
	subagents: readonly { durationSeconds?: number | null; subagentId: string }[];
	turns: readonly SessionDetailTurnSummary[];
}) {
	const { focus, setFocus } = useAgentFocus();
	const launches = useMemo(() => getSubagentLaunches(turns), [turns]);
	const turnId = focus ? launches.get(focus) : undefined;
	const focusTurn = turnId
		? turns.find((turn) => turn.turnId === turnId)
		: undefined;
	const laterTurns = useMemo(() => {
		if (!focus) return [];
		const span = turnsWorkedThrough(
			turns,
			focus,
			subagents.find((each) => each.subagentId === focus)?.durationSeconds,
		);
		return span ? turns.slice(span.first + 1, span.last + 1) : [];
	}, [focus, turns, subagents]);
	useLayoutEffect(() => {
		if (focus && !turnId && complete)
			setFocus(null, undefined, { replace: true });
	}, [focus, turnId, complete, setFocus]);
	useLayoutEffect(() => {
		if (turnId) requestBodyRef.current(turnId);
		for (const turn of laterTurns) requestBodyRef.current(turn.turnId);
	}, [turnId, laterTurns, requestBodyRef]);
	const pickRef = useLatestValueRef((id: string) => {
		if (!focusTurn) return scrollToTurn(id);
		pendingScrollTurnIdRef.current = id;
		setFocus(null, id);
	});
	const pickTurn = useCallback((id: string) => pickRef.current(id), [pickRef]);
	const launchesRef = useLatestValueRef(launches);
	const focusOn = useCallback(
		(subagentId: string | null) =>
			setFocus(
				subagentId,
				subagentId ? launchesRef.current.get(subagentId) : undefined,
			),
		[launchesRef, setFocus],
	);
	return { focus, focusTurn, laterTurns, pickTurn, setFocus: focusOn };
}

export const ReaderMap = memo(function ReaderMap({
	focus,
	mapKey,
	member,
	model,
	onFocus,
	tags,
}: {
	focus: string | null;
	mapKey: SessionMapKey;
	member: { imageUrl: string | undefined; label: string };
	model: string | null;
	onFocus: (subagentId: string | null) => void;
	tags?: readonly string[];
}) {
	return (
		<div className="-mx-xxl -mt-m -mb-xl [overflow-anchor:none]">
			<div
				className={cn(
					"sticky top-0 z-40 flex h-[100cqh] flex-col",
					focus
						? "pt-[calc(var(--focused-strip-bottom,1rem)+1rem)]"
						: "pt-(--reader-pane-top,0.875rem)",
				)}
			>
				<ReaderMinimap
					focus={focus}
					mapKey={mapKey}
					member={member}
					model={model}
					onFocus={onFocus}
					tags={tags}
				/>
			</div>
		</div>
	);
});
