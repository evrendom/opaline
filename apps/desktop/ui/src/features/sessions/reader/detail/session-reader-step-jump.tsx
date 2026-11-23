import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useTurnCi } from "../../use-session-run-ci";
import { withRunCi } from "../ci/session-reader-run-ci";
import type { SessionReaderStep } from "../model/session-reader-model";
import { getReaderWaterfall } from "../model/session-reader-model";
import {
	type RunUiStore,
	useFocusedTurnId,
	useRunUi,
} from "../model/session-reader-run-ui-store";
import {
	KEEPS_PICK_MARK,
	readerScrollerOf,
	turnElementOf,
	WATERFALL,
} from "../reader-dom";
import { useReaderSubagentBranches } from "../subagents/use-reader-subagent-branches";
import { jumpNearThenEase } from "./reader-jump-scroll";
import {
	getOffscreen,
	JumpPill,
	type Offscreen,
	useOffscreen,
} from "./session-reader-jump-pill";
import type { SessionReaderBodyState } from "./use-session-reader-bodies";
import { StepIconChip } from "./waterfall/session-reader-waterfall-chips";
import { FROZEN_ROW_REM } from "./waterfall/session-reader-waterfall-layout";

/** The scroll area the reader's turns scroll in, and in it the waterfall row
 * that looks selected — what the pane shows. */
function findActiveRow(slot: HTMLElement) {
	const scroller = readerScrollerOf(slot);
	const row = scroller?.querySelector<HTMLElement>("[data-active-row]");
	return scroller && row ? { row, scroller } : null;
}

function getShownFrom(slot: HTMLElement): number {
	return Number.parseFloat(getComputedStyle(slot).top) || 0;
}

function getFrozenEdge(
	row: HTMLElement,
	viewTop: number,
	from: number,
): number {
	let edge = from;
	const frozen =
		row
			.closest(WATERFALL)
			?.querySelectorAll<HTMLElement>(
				"[data-frozen-header], [data-frozen-row]",
			) ?? [];
	for (const element of frozen) {
		const box = element.getBoundingClientRect();
		const stuckAt =
			viewTop + (Number.parseFloat(getComputedStyle(element).top) || 0);
		if (Math.abs(box.top - stuckAt) < 1) edge = Math.max(edge, box.bottom);
	}
	return edge;
}

/**
 * Scroll the reader just far enough that `row` is in sight and its turn the
 * one being read: up to rest right under what will be frozen above it — its
 * waterfall's header, and a row per open group it's in — or down to rest on
 * the view's bottom edge. The reader follows the earliest turn crossing the
 * view's top quarter, so the turn must start no lower than the top (16px
 * down, as the rail's jumps leave it); the header's own row is in sight
 * whenever that's so.
 */
function scrollToRow(
	scroller: HTMLElement,
	row: HTMLElement,
	where: Exclude<Offscreen, null>,
	shownFrom: number,
) {
	const view = scroller.getBoundingClientRect();
	const box = row.getBoundingClientRect();
	const turn = turnElementOf(row);
	const turnAtTop = turn
		? scroller.scrollTop +
			turn.getBoundingClientRect().top -
			view.top -
			(Number.parseFloat(getComputedStyle(turn).scrollMarginTop) || 16)
		: Number.NEGATIVE_INFINITY;
	let top = turnAtTop;
	if (!row.closest("[data-frozen-header]")) {
		if (where === "above") {
			// A frozen row rests at its own place; the rest just under the
			// frozen rows of the groups they're in.
			const ownHead = row.closest("[data-frozen-row]");
			let levels = 0;
			for (
				let group = row.closest("[data-group]");
				group;
				group = group.parentElement?.closest("[data-group]") ?? null
			) {
				if (ownHead?.parentElement !== group) levels++;
			}
			const rem = Number.parseFloat(
				getComputedStyle(document.documentElement).fontSize,
			);
			const frozen =
				(Number.parseFloat(
					getComputedStyle(row).getPropertyValue("--frozen-top"),
				) || 0) +
				levels * FROZEN_ROW_REM * rem;
			top = Math.max(
				scroller.scrollTop + box.top - view.top - shownFrom - frozen,
				turnAtTop,
			);
		} else {
			top = Math.max(
				scroller.scrollTop + box.bottom - view.bottom + 16,
				turnAtTop,
			);
		}
	}
	jumpNearThenEase(scroller, () => top);
}

function ActiveStepJump({
	slot,
	step,
	target,
}: {
	/** Where it floats: the top of the turns column. */
	slot: HTMLElement;
	step: SessionReaderStep;
	/** Names what's shown, so a new one is measured at once. */
	target: string;
}) {
	const floatRef = useRef<HTMLDivElement>(null);
	const where = useOffscreen(() => {
		const found = findActiveRow(slot);
		if (!found) return null;
		const view = found.scroller.getBoundingClientRect();
		const shownFrom = view.top + Math.max(getShownFrom(slot) - 8, 0);
		const edge = getFrozenEdge(found.row, view.top, shownFrom);
		// A row frozen itself stays in sight; the rest go out of it up under
		// what's frozen.
		const inFrozen = found.row.closest(
			"[data-frozen-header], [data-frozen-row]",
		);
		const where = getOffscreen(
			found.row.getBoundingClientRect(),
			inFrozen ? shownFrom : edge,
			view.bottom,
		);
		// On the side the row is out of sight on: just under what's frozen at
		// the top, or 16px up from the bottom. Gone, it stays where it was.
		const float = floatRef.current;
		if (float && where) {
			const at =
				where === "above" ? edge + 8 : view.bottom - 16 - float.offsetHeight;
			float.style.top = `${at - slot.getBoundingClientRect().top}px`;
		}
		return where;
	}, target);
	return (
		<div
			ref={floatRef}
			{...KEEPS_PICK_MARK}
			className="absolute inset-x-0 top-2 flex justify-center pl-xxxl"
		>
			<JumpPill
				icon={<StepIconChip step={step} />}
				label={`Scroll to ${step.name}`}
				onClick={() => {
					const found = findActiveRow(slot);
					if (found && where)
						scrollToRow(found.scroller, found.row, where, getShownFrom(slot));
				}}
				where={where}
			/>
		</div>
	);
}

export function ReaderStepJump({
	getBody,
	jumpSlot,
	model,
	store,
	turns,
}: {
	getBody: (turnId: string) => SessionReaderBodyState;
	jumpSlot: HTMLElement | null;
	model: string | null;
	store: RunUiStore;
	turns: readonly SessionDetailTurnSummary[];
}) {
	const turnId = useFocusedTurnId(store);
	const ui = useRunUi(store, turnId ?? "");
	const turn = turnId
		? turns.find((candidate) => candidate.turnId === turnId)
		: undefined;
	const bodyState = turnId ? getBody(turnId) : null;
	const body = bodyState?.status === "ready" ? bodyState.body : null;
	const branches = useReaderSubagentBranches(body, ui.picked);
	const ci = useTurnCi(turn ?? { startedAt: null });
	const waterfall = useMemo(() => {
		const own =
			body && turn ? getReaderWaterfall(body, turn, model, branches) : null;
		return own ? withRunCi(own, ci, Date.now()) : null;
	}, [body, turn, model, branches, ci]);
	const step =
		waterfall?.allSteps.find((step) => step.id === ui.selected) ?? null;
	return jumpSlot && step
		? createPortal(
				<ActiveStepJump
					slot={jumpSlot}
					step={step}
					target={`${turnId}:${ui.selected}`}
				/>,
				jumpSlot,
			)
		: null;
}
