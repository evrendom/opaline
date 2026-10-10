import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { shortRunId } from "@/features/sessions/run-id";
import type { ItemRect } from "@/hooks/use-fluid-hover";
import { cn } from "@/lib/utils";
import {
	getOffscreen,
	JumpPill,
	scrollToCenter,
	useLastOffscreen,
	useOffscreen,
} from "./session-reader-jump-pill";
import {
	formatReaderCost,
	formatReaderDuration,
	getCostShade,
	getReaderTurnSignals,
} from "./session-reader-model";
import { TurnRailMarks } from "./session-reader-turn-marks";
import { StepIconChip } from "./session-reader-waterfall-chips";
import type { SessionReaderBodyState } from "./use-session-reader-bodies";

// The reader's turn rail: one row per turn, with the turn being read lit up.
// Which turn that is changes on scroll, so it lives in a tiny store the rail
// alone subscribes to — the turns themselves never re-render for it.

export type ActiveTurnStore = {
	get: () => string | null;
	set: (turnId: string | null) => void;
	subscribe: (listener: () => void) => () => void;
};

export function createActiveTurnStore(): ActiveTurnStore {
	let value: string | null = null;
	const listeners = new Set<() => void>();
	return {
		get: () => value,
		set(turnId) {
			if (turnId === value) return;
			value = turnId;
			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

/** The rows of the rail, with the hover gliding between them and a fill on
 * the turn in view that springs along as you read. */
export function TurnRailList({
	activeTurn,
	costThresholds,
	currentTurnId,
	getBody,
	model,
	onSelect,
	turns,
}: {
	activeTurn: ActiveTurnStore;
	costThresholds: readonly number[];
	/** A turn to mark regardless of scroll — the open run, on its page. */
	currentTurnId?: string | null;
	getBody: (turnId: string) => SessionReaderBodyState;
	/** The session's model, whose chip marks a turn in the pill. */
	model: string | null;
	onSelect: (turnId: string) => void;
	turns: readonly SessionDetailTurnSummary[];
}) {
	const turnInView = useSyncExternalStore(
		activeTurn.subscribe,
		activeTurn.get,
		activeTurn.get,
	);
	const activeTurnId = currentTurnId ?? turnInView;
	const rowsRef = useRef(new Map<string, HTMLButtonElement>());
	const listRef = useRef<HTMLDivElement>(null);
	const [activeRect, setActiveRect] = useState<ItemRect | null>(null);
	// The in-view fill sits on the active row's box, measured like the fluid
	// hover measures its items (offsets inside the list), so it scrolls with
	// the rows and springs from one to the next.
	useLayoutEffect(() => {
		const row = activeTurnId ? rowsRef.current.get(activeTurnId) : undefined;
		setActiveRect(
			row
				? {
						height: row.offsetHeight,
						left: row.offsetLeft,
						top: row.offsetTop,
						width: row.offsetWidth,
					}
				: null,
		);
	}, [activeTurnId]);
	// The marked turn scrolled out of the list's sight, for the pill.
	const activeRow = () => {
		const list = listRef.current;
		const row = activeTurnId ? rowsRef.current.get(activeTurnId) : undefined;
		return list && row ? { list, row } : null;
	};
	const where = useOffscreen(() => {
		const found = activeRow();
		if (!found) return null;
		const view = found.list.getBoundingClientRect();
		return getOffscreen(
			found.row.getBoundingClientRect(),
			view.top,
			view.bottom,
		);
	}, activeTurnId ?? "");
	const side = useLastOffscreen(where);

	return (
		<div className="relative flex min-h-0 flex-col">
			{/* One root for both fills: the hover glides between rows (Opaline's
			    fluid hover) over the in-view fill, which travels as you read.
			    overscroll-contain keeps scrolling past the list's ends in the
			    list. */}
			<div
				ref={listRef}
				data-fluid-menu-root=""
				className="relative flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain"
			>
				<FluidMenuHover bridgeGap={2} />
				<FluidHoverHighlight
					rect={activeRect}
					session={0}
					className="z-[-2] rounded-md bg-accent"
				/>
				{turns.map((turn, index) => (
					<button
						key={turn.turnId}
						ref={(row) => {
							if (row) rowsRef.current.set(turn.turnId, row);
							else rowsRef.current.delete(turn.turnId);
						}}
						type="button"
						aria-current={turn.turnId === activeTurnId ? "true" : undefined}
						aria-label={`Turn ${index + 1}`}
						onClick={() => onSelect(turn.turnId)}
						className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
					>
						{/* The marks hug the number on the left. */}
						<span className="flex min-w-0 items-center gap-1">
							{/* The turn's short id; its full id on hover. */}
							<span title={turn.turnId} className="font-medium tabular-nums">
								{shortRunId(turn.turnId)}
							</span>
							<TurnRailMarks
								bodyState={getBody(turn.turnId)}
								signals={getReaderTurnSignals(turn)}
								turn={turn}
							/>
						</span>
						<span className="ml-auto text-muted-foreground tabular-nums">
							{formatReaderDuration(turn.durationSeconds)}
						</span>
						<span
							className={cn(
								"tabular-nums",
								getCostShade(turn.estimatedCost, costThresholds) ??
									"text-muted-foreground",
							)}
						>
							{formatReaderCost(turn.estimatedCost)}
						</span>
					</button>
				))}
			</div>
			{/* Pointing to the turn being read while the list has it out of
			    sight, at the list's edge on that side; the model's chip and the
			    turn's short id name it. */}
			<div
				className={cn(
					"pointer-events-none absolute inset-x-0 flex justify-center",
					side === "above" ? "top-2" : "bottom-2",
				)}
			>
				<JumpPill
					icon={
						<span className="flex items-center gap-1.5 text-xs font-medium tabular-nums">
							<StepIconChip
								model={model}
								step={{ icon: null, kind: "message", name: "Message" }}
							/>
							{activeTurnId ? shortRunId(activeTurnId) : null}
						</span>
					}
					label="Scroll to the turn being read"
					onClick={() => {
						const found = activeRow();
						if (found) scrollToCenter(found.list, found.row);
					}}
					where={where}
				/>
			</div>
		</div>
	);
}
