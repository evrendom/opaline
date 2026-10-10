import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { IconRoute } from "@tabler/icons-react";
import { useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
	getOffscreen,
	JumpPill,
	type Offscreen,
	useOffscreen,
} from "./session-reader-jump-pill";
import type { SessionReaderStep } from "./session-reader-model";
import { getReaderTurnMarks, getReaderWaterfall } from "./session-reader-model";
import {
	type RunUiStore,
	toggleFilterKey,
	useFocusedTurnId,
	useRunUi,
} from "./session-reader-run-ui-store";
import { SessionReaderStepDetail } from "./session-reader-step-detail";
import { OpalChip, StepIconChip } from "./session-reader-waterfall-chips";
import { FROZEN_ROW_REM } from "./session-reader-waterfall-layout";
import { getWaterfallFilterOptions } from "./session-reader-waterfall-rows";
import { useReaderSubagentBranches } from "./use-reader-subagent-branches";
import type { SessionReaderBodyState } from "./use-session-reader-bodies";

// The reader's right pane: the inspector for the turn being worked with —
// the one being read, or the one whose waterfall was last clicked — sharing
// that turn's selection and step filter with its inline waterfall.

function PaneMessage({ children }: { children: string }) {
	return (
		<div className="sticky top-4 flex h-[calc(100cqh-2rem)] items-center justify-center rounded-lg bg-card px-6 text-center text-sm text-muted-foreground shadow-(--custom-shadow) corner-squircle squircle:rounded-3xl dark:bg-muted-foreground/10">
			{children}
		</div>
	);
}

/** The scroll area the reader's turns scroll in, and in it the waterfall row
 * that looks selected — what the pane shows. */
function findActiveRow(slot: HTMLElement) {
	const scroller = slot.closest<HTMLElement>("[data-reader-scroll]");
	const row = scroller?.querySelector<HTMLElement>("[data-active-row]");
	return scroller && row ? { row, scroller } : null;
}

/** Where the row's waterfall stops covering the view from the top: below its
 * header and the open groups' rows frozen under it — each counted only while
 * stuck at its place — or the view's top when none are. */
function getFrozenEdge(row: HTMLElement, viewTop: number): number {
	let edge = viewTop;
	const frozen =
		row
			.closest("[data-waterfall]")
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
) {
	const view = scroller.getBoundingClientRect();
	const box = row.getBoundingClientRect();
	const turn = row.closest("[data-turn-id]");
	const turnAtTop = turn
		? scroller.scrollTop + turn.getBoundingClientRect().top - view.top - 16
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
				scroller.scrollTop + box.top - view.top - frozen,
				turnAtTop,
			);
		} else {
			top = Math.max(
				scroller.scrollTop + box.bottom - view.bottom + 16,
				turnAtTop,
			);
		}
	}
	scroller.scrollTo({ behavior: "smooth", top });
}

/**
 * The pill pointing to the waterfall row the pane shows while it's out of
 * sight — scrolled past, or up under its waterfall's frozen header — with
 * that step's icon; clicking it scrolls the row to the middle.
 */
function ActiveStepJump({
	model,
	slot,
	step,
	target,
}: {
	model: string | null;
	/** Where it floats: the top of the turns column. */
	slot: HTMLElement;
	/** The step shown; null for the whole run. */
	step: SessionReaderStep | null;
	/** Names what's shown, so a new one is measured at once. */
	target: string;
}) {
	const floatRef = useRef<HTMLDivElement>(null);
	const where = useOffscreen(() => {
		const found = findActiveRow(slot);
		if (!found) return null;
		const view = found.scroller.getBoundingClientRect();
		const edge = getFrozenEdge(found.row, view.top);
		// A row frozen itself stays in sight; the rest go out of it up under
		// what's frozen.
		const inFrozen = found.row.closest(
			"[data-frozen-header], [data-frozen-row]",
		);
		const where = getOffscreen(
			found.row.getBoundingClientRect(),
			inFrozen ? view.top : edge,
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
			className="absolute inset-x-0 top-2 flex justify-center pl-9"
		>
			<JumpPill
				icon={
					step ? (
						<StepIconChip model={model} step={step} />
					) : (
						// The whole run is what's shown, so its chip wears the active
						// look the root row's does then.
						<OpalChip sidebar="active">
							<IconRoute aria-hidden="true" className="size-3" />
						</OpalChip>
					)
				}
				label={`Scroll to ${step ? step.name : "the Reasoning Trace"}`}
				onClick={() => {
					const found = findActiveRow(slot);
					if (found && where) scrollToRow(found.scroller, found.row, where);
				}}
				where={where}
			/>
		</div>
	);
}

export function ReaderInspectorPane({
	getBody,
	jumpSlot,
	model,
	store,
	turns,
}: {
	getBody: (turnId: string) => SessionReaderBodyState;
	/** Where the pill pointing to the shown step floats, once mounted. */
	jumpSlot?: HTMLElement | null;
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
	const branches = useReaderSubagentBranches(body, true);
	const waterfall = useMemo(
		() =>
			body && turn ? getReaderWaterfall(body, turn, model, branches) : null,
		[body, turn, model, branches],
	);
	const filterOptions = useMemo(
		() => (waterfall ? getWaterfallFilterOptions(waterfall.allSteps) : []),
		[waterfall],
	);

	if (!turnId || !turn || bodyState?.status === "loading") {
		return <PaneMessage>Scroll to a turn to inspect its steps.</PaneMessage>;
	}
	if (!body || !waterfall) {
		return <PaneMessage>This turn ran no steps.</PaneMessage>;
	}

	const step =
		waterfall.allSteps.find((step) => step.id === ui.selected) ?? null;
	return (
		<>
			<SessionReaderStepDetail
				fill
				run={{
					filter: ui.filter,
					filterOptions,
					marks: getReaderTurnMarks(turn, body),
					onToggleFilter: (key) =>
						store.update(turnId, (state) => ({
							filter: toggleFilterKey(state.filter, key),
							open: true,
						})),
					turn,
				}}
				step={step}
				waterfall={waterfall}
			/>
			{jumpSlot
				? createPortal(
						<ActiveStepJump
							model={model}
							slot={jumpSlot}
							step={step}
							target={`${turnId}:${ui.selected}`}
						/>,
						jumpSlot,
					)
				: null}
		</>
	);
}
