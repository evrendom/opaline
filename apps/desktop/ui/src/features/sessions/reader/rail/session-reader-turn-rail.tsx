import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import {
	type Icon,
	IconAlignBoxLeftTop,
	IconClock,
	IconCoin,
} from "@tabler/icons-react";
import {
	memo,
	type ReactNode,
	type RefObject,
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useLatestValueRef } from "@/app/hooks/useLatestValueRef";
import { FluidMenuHover } from "@/app/ui/fluid-menu-hover";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import { shortRunId } from "@/features/sessions/run-id";
import type { ItemRect } from "@/hooks/use-fluid-hover";
import { useScrollFade } from "@/hooks/use-scroll-fade";
import { centerInList } from "@/lib/reveal-in-list";
import { cn } from "@/lib/utils";
import {
	getOffscreen,
	JumpPill,
	scrollToCenter,
	useLastOffscreen,
	useOffscreen,
} from "../detail/session-reader-jump-pill";
import { ModelChip } from "../detail/waterfall/session-reader-waterfall-chips";
import { CARD } from "../files/session-reader-files-parts";
import { useOpenSubagent } from "../subagents/session-reader-agent-focus";
import { useSubagentsCounted } from "../subagents/session-reader-subagents-counted";
import { RailTagsPicker, type RailTagsState } from "./session-reader-rail-tags";
import {
	type RailFigure,
	RailRow,
	type RailSubagent,
	subagentIdsOf,
} from "./session-reader-turn-rail-row";

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

function useKeyedRefs<T extends Element>(
	elements: RefObject<Map<string, T>>,
): (key: string) => (element: T | null) => void {
	const [callbacks] = useState(
		() => new Map<string, (element: T | null) => void>(),
	);
	return useCallback(
		(key: string) => {
			let callback = callbacks.get(key);
			if (!callback) {
				callback = (element) => {
					if (element) elements.current.set(key, element);
					else elements.current.delete(key);
				};
				callbacks.set(key, callback);
			}
			return callback;
		},
		[callbacks, elements],
	);
}

export const TurnRailList = memo(function TurnRailList({
	activeTurn,
	idle,
	costThresholds,
	lead,
	currentTurnId,
	figureMarks,
	focusedSubagent = null,
	marks,
	model,
	numberOf,
	onSelect,
	subagents,
	tags,
	turns,
	whole,
}: {
	tags: RailTagsState;
	idle?: ReadonlySet<string>;
	focusedSubagent?: string | null;
	activeTurn: ActiveTurnStore;
	costThresholds: readonly number[];
	currentTurnId?: string | null;
	marks?: ReadonlyMap<string, ReactNode>;
	figureMarks?: ReadonlyMap<string, ReactNode>;
	lead?: ReactNode;
	numberOf?: (turnId: string) => number;
	model: string | null;
	onSelect: (turnId: string) => void;
	subagents?: readonly RailSubagent[];
	turns: readonly SessionDetailTurnSummary[];
	whole?: {
		disabled?: boolean;
		onPick: () => void;
		picked: boolean;
		total: number;
	};
}) {
	const [figure, setFigure] = useState<RailFigure>("context");
	const turnInView = useSyncExternalStore(
		activeTurn.subscribe,
		activeTurn.get,
		activeTurn.get,
	);
	const activeTurnId =
		currentTurnId ?? turnInView ?? (whole?.picked ? WHOLE_SESSION : null);
	const subagentOf = useMemo(
		() =>
			new Map(
				(subagents ?? []).map((subagent) => [subagent.subagentId, subagent]),
			),
		[subagents],
	);
	const rowsRef = useRef(new Map<string, HTMLButtonElement>());
	const withSubagents = useSubagentsCounted();
	const subagentRowsRef = useRef(new Map<string, HTMLElement>());
	const rowRef = useKeyedRefs(rowsRef);
	const lineRef = useKeyedRefs(subagentRowsRef);
	const numbers = useMemo(
		() =>
			new Map(
				turns.map((turn, index) => [
					turn.turnId,
					numberOf?.(turn.turnId) ?? index + 1,
				]),
			),
		[numberOf, turns],
	);
	const listRef = useRef<HTMLDivElement>(null);
	const { fade, ref: fadeRef } = useScrollFade<HTMLDivElement>();
	const setList = useCallback(
		(list: HTMLDivElement | null) => {
			listRef.current = list;
			fadeRef(list);
		},
		[fadeRef],
	);
	const [active, setActive] = useState<{ rect: ItemRect | null }>({
		rect: null,
	});
	const turnIds = useMemo(() => turns.map((turn) => turn.turnId), [turns]);
	useLayoutEffect(() => {
		const measure = () => {
			const line = focusedSubagent
				? subagentRowsRef.current.get(focusedSubagent)
				: undefined;
			const list = listRef.current;
			if (line && list) {
				const row = line.closest("button");
				const index = row
					? [...row.querySelectorAll("[data-rail-subagent]")].indexOf(line)
					: -1;
				const strip = row?.querySelectorAll("[data-rail-line]")[index + 1];
				const box = (strip ?? line).getBoundingClientRect();
				const at = list.getBoundingClientRect();
				setActive({
					rect: {
						height: box.height,
						left: box.left - at.left + list.scrollLeft,
						top: box.top - at.top + list.scrollTop,
						width: box.width,
					},
				});
				return;
			}
			const row = activeTurnId ? rowsRef.current.get(activeTurnId) : undefined;
			if (!row) {
				setActive({ rect: null });
				return;
			}
			const box = {
				height: row.offsetHeight,
				left: row.offsetLeft,
				top: row.offsetTop,
				width: row.offsetWidth,
			};
			const own = row.querySelector<HTMLElement>("[data-rail-line]");
			const first = row.querySelector("[data-rail-subagent]");
			setActive({
				rect: first && own ? { ...box, height: own.offsetHeight } : box,
			});
		};
		measure();
		const resize = new ResizeObserver(measure);
		for (const rowId of [WHOLE_SESSION, ...turnIds]) {
			const row = rowsRef.current.get(rowId);
			if (row) resize.observe(row);
		}
		return () => resize.disconnect();
	}, [activeTurnId, focusedSubagent, turnIds]);
	const openSubagent = useOpenSubagent();
	const subagentLineAt = (turn: SessionDetailTurnSummary, y: number) =>
		subagentIdsOf(turn).find((subagentId) => {
			const line = subagentRowsRef.current.get(subagentId);
			const strip = line
				?.closest("button")
				?.querySelectorAll("[data-rail-line]")[
				subagentIdsOf(turn).indexOf(subagentId) + 1
			];
			const box = (strip ?? line)?.getBoundingClientRect();
			return box !== undefined && y >= box.top && y < box.bottom;
		}) ?? null;
	const pickRef = useLatestValueRef(
		(turn: SessionDetailTurnSummary, clientY: number) => {
			const subagentId = openSubagent ? subagentLineAt(turn, clientY) : null;
			if (subagentId && openSubagent) openSubagent(subagentId);
			else onSelect(turn.turnId);
		},
	);
	const pick = useCallback(
		(turn: SessionDetailTurnSummary, clientY: number) =>
			pickRef.current(turn, clientY),
		[pickRef],
	);
	const activeRow = useCallback(() => {
		const list = listRef.current;
		const row = activeTurnId ? rowsRef.current.get(activeTurnId) : undefined;
		return list && row ? { list, row } : null;
	}, [activeTurnId]);
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
	const shownTurn = useRef(activeTurnId);
	useLayoutEffect(() => {
		if (shownTurn.current === activeTurnId) return;
		shownTurn.current = activeTurnId;
		const found = activeRow();
		if (!found) return;
		const view = found.list.getBoundingClientRect();
		if (getOffscreen(found.row.getBoundingClientRect(), view.top, view.bottom))
			scrollToCenter(found.list, found.row);
	}, [activeRow, activeTurnId]);
	const scrollKey = turns[0]?.turnId ?? "";
	const openedAt = useLatestValueRef({ activeRow, scrollKey });
	useLayoutEffect(() => {
		const list = listRef.current;
		if (!list) return;
		list.scrollTop = railScrolls.get(openedAt.current.scrollKey) ?? 0;
		const found = openedAt.current.activeRow();
		if (!found) return;
		const view = list.getBoundingClientRect();
		if (getOffscreen(found.row.getBoundingClientRect(), view.top, view.bottom))
			centerInList(list, found.row);
	}, [openedAt]);

	return (
		<div className={cn("relative isolate flex min-h-0 flex-1 flex-col", CARD)}>
			<div
				className={cn(
					"flex shrink-0 items-center justify-between gap-m",
					"edge-b-m py-m pr-m pl-xl",
					"border-line-soft",
				)}
			>
				<h2 className="truncate text-body-xl font-medium">Agent runs</h2>
				<div className="flex shrink-0 items-center gap-s">
					{lead}
					<RailTagsPicker
						figure={{
							onPick: (value) => {
								const picked = FIGURES.find((each) => each.value === value);
								if (picked) setFigure(picked.value);
							},
							options: FIGURES,
							value: figure,
						}}
					/>
				</div>
			</div>
			<div className="relative flex min-h-0 flex-1 flex-col px-s">
				<div
					ref={setList}
					{...fade}
					data-fluid-menu-root=""
					onScroll={(event) =>
						railScrolls.set(scrollKey, event.currentTarget.scrollTop)
					}
					className={cn(
						"relative flex min-h-0 flex-col gap-(--rail-line-gap) overflow-y-auto overscroll-contain [scrollbar-width:none] [--scroll-fade-top-depth:16px]",
						"-mx-s px-s pt-m pb-m",
						"scroll-fade",
						"[&::-webkit-scrollbar]:hidden [&_.fluid-menu-hover-fill]:corner-squircle",
					)}
				>
					<FluidMenuHover bridgeGap={2} items="[data-rail-line]" />
					<FluidHoverHighlight
						rect={active.rect}
						session={0}
						transition={false}
						className={cn(
							"z-0 corner-s bg-card-soft corner-squircle squircle:corner-l",
							// design-escape-ok(shadow): shipped value; the picked turn's 1px and 2px/6px drops (the card shadow in dark)
							"shadow-[0_0_0_0.5px_rgb(0_0_0/0.08),0_1px_2px_-0.5px_rgb(0_0_0/0.1),0_2px_6px_-2px_rgb(0_0_0/0.12)] dark:shadow-card",
						)}
					/>
					{whole ? (
						<button
							ref={rowRef(WHOLE_SESSION)}
							type="button"
							aria-pressed={whole.picked}
							disabled={whole.disabled}
							onClick={whole.onPick}
							className={cn(
								"relative flex h-(--rail-line-height) shrink-0 items-center justify-between gap-s",
								"corner-s px-s corner-squircle",
								"text-left text-body-m tabular-nums",
								"transition-opacity duration-(--motion-large-duration) ease-base",
								"squircle:corner-l",
								whole.disabled &&
									"cursor-default opacity-40 starting:opacity-100",
							)}
						>
							<span
								className={cn(
									"font-medium",
									whole.picked ? "text-ink" : "text-ink-3",
								)}
							>
								Entire session
							</span>
							<span className="text-ink-3">
								{whole.total} {whole.total === 1 ? "turn" : "turns"}
							</span>
							<span
								data-rail-line={whole.disabled ? undefined : ""}
								className="pointer-events-none absolute inset-0 corner-s corner-squircle squircle:corner-l"
							/>
						</button>
					) : null}
					{turns.map((turn) => (
						<RailRow
							key={turn.turnId}
							active={turn.turnId === activeTurnId}
							costThresholds={costThresholds}
							figure={figure}
							figureMarks={figureMarks}
							focusedSubagent={
								focusedSubagent && subagentIdsOf(turn).includes(focusedSubagent)
									? focusedSubagent
									: null
							}
							idle={idle}
							lineRef={lineRef}
							marks={marks}
							number={numbers.get(turn.turnId) ?? 0}
							onPick={pick}
							picked={tags.picked}
							rowRef={rowRef(turn.turnId)}
							subagentOf={subagentOf}
							turn={turn}
							withSubagents={withSubagents}
						/>
					))}
				</div>
				<div
					className={cn(
						"pointer-events-none absolute inset-x-0 flex justify-center",
						side === "above" ? "top-2" : "bottom-2",
					)}
				>
					<JumpPill
						icon={
							<span className="flex items-center gap-s text-body-m font-medium tabular-nums">
								<ModelChip glyph="size-3" model={model} />
								{activeTurnId === WHOLE_SESSION
									? "Entire session"
									: activeTurnId
										? shortRunId(activeTurnId)
										: null}
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
		</div>
	);
});

const railScrolls = new Map<string, number>();

const WHOLE_SESSION = "entire-session";

const FIGURES: {
	glyph: Icon;
	label: string;
	tint: string;
	value: RailFigure;
}[] = [
	{
		glyph: IconAlignBoxLeftTop,
		label: "Context",
		tint: "var(--color-violet-400)",
		value: "context",
	},
	{
		glyph: IconClock,
		label: "Time",
		tint: "var(--color-zinc-500)",
		value: "time",
	},
	{
		glyph: IconCoin,
		label: "Cost",
		tint: "var(--color-zinc-500)",
		value: "cost",
	},
];
