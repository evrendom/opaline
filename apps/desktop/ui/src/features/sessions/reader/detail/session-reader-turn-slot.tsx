import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import type { CSSProperties, ReactNode } from "react";
import {
	TURN_SLOT_LAYOUT_CLASS,
	TURNS_PENDING_MARK,
	turnMarks,
} from "../reader-dom";
import { estimateTurnPx } from "./reader-turns-pending";

export function ReaderTurnSlot({
	children,
	frustrated,
	hidden,
	holdsEstimate,
	index,
	keptHeight,
	slotRef,
	turn,
}: {
	children: ReactNode;
	frustrated: boolean;
	hidden: boolean;
	holdsEstimate: boolean;
	index: number;
	keptHeight: number | undefined;
	slotRef: (element: HTMLElement | null) => () => void;
	turn: SessionDetailTurnSummary;
}) {
	return (
		<div
			hidden={hidden}
			ref={slotRef}
			{...turnMarks({
				apology: (turn.modelApologyCount ?? turn.modelSignalCount) > 0,
				errors: turn.errorCount > 0,
				frustrated,
				index,
				startMs: turn.startedAt ? Date.parse(turn.startedAt) : undefined,
				turnId: turn.turnId,
			})}
			className={`-mx-xxl -mb-(--reader-inset) scroll-mt-(--reader-top) px-xxl pb-(--reader-inset) [contain-intrinsic-block-size:auto_var(--turn-estimate)] [content-visibility:auto] ${TURN_SLOT_LAYOUT_CLASS}`}
			style={
				{
					"--turn-estimate": `${keptHeight ?? estimateTurnPx(turn)}px`,
					"--turn-kept":
						keptHeight === undefined
							? undefined
							: `calc(${keptHeight}px + var(--reader-inset))`,
					minHeight: holdsEstimate
						? "calc(var(--turn-estimate) + var(--reader-inset))"
						: undefined,
				} as CSSProperties
			}
		>
			{children}
		</div>
	);
}

export function TurnsPending({
	failed,
	from,
	minHeight,
	onRetry,
	to,
}: {
	failed: boolean;
	from: number;
	minHeight: number;
	onRetry: () => void;
	to: number;
}) {
	return (
		<div {...TURNS_PENDING_MARK} style={{ minHeight }}>
			{failed ? (
				<p className="text-body-m text-ink-3 tabular-nums">
					Turns {from}–{to} could not be loaded.{" "}
					<button
						type="button"
						onClick={onRetry}
						className="underline underline-offset-2 focus-outline hover:text-ink"
					>
						Retry
					</button>
				</p>
			) : null}
		</div>
	);
}
