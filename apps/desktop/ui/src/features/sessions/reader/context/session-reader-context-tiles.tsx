import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import {
	type ReactNode,
	useCallback,
	useContext,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useElementWidth } from "@/app/ui/horizontal-resize-handle";
import { MOMENT_KINDS_APPEARANCE } from "@/features/compass/moment-labels";
import { cn } from "@/lib/utils";
import {
	ContextBar,
	excludedOf,
	kindWord,
	tileGlyph,
	tileLook,
} from "./session-reader-context-bar";
import { withCompacted } from "./session-reader-context-before";
import {
	CompactionMark,
	compactionWords,
} from "./session-reader-context-compaction";
import { tileName } from "./session-reader-context-fold";
import { ContextMapFrame } from "./session-reader-context-frame";
import { filterKind } from "./session-reader-context-groups";
import {
	ContextAreaHeight,
	ContextPreview,
} from "./session-reader-context-head";
import type { ContextKind, ContextMap } from "./session-reader-context-map";
import {
	type ContextMeasure,
	costMap,
	MEASURE_LOOK,
	MeasureContext,
	timeMap,
} from "./session-reader-context-measure";
import {
	useRememberedLits,
	useRememberedPick,
} from "./session-reader-context-memory";
import { GhostTiles, useTileMorph } from "./session-reader-context-morph";
import { useContextOpen } from "./session-reader-context-open";
import { PickedBoxContext, pickedFigures } from "./session-reader-context-pick";
import {
	AREA_HEIGHT,
	GAP,
	MIN_TILE,
	placeTiles,
} from "./session-reader-context-place";
import {
	type BoxProblems,
	problemsOf,
	useOwnProblems,
} from "./session-reader-context-problems";
import { RunLegend } from "./session-reader-context-run-legend";
import {
	ContextRunTiles,
	type RunLit,
	runHolds,
} from "./session-reader-context-run-tiles";
import { RunZoom } from "./session-reader-context-run-zoom";
import {
	clickBox,
	clickThing,
	type Selection,
} from "./session-reader-context-selection";
import {
	ContextSubTiles,
	drawsSubTiles,
	MarkLegend,
	markGlow,
	ownsInside,
} from "./session-reader-context-subtiles";
import {
	ContextZoom,
	thingGlyph,
	thingName,
	thingOpen,
} from "./session-reader-context-zoom";

const costMaps = new WeakMap<ContextMap, ContextMap | null>();
const timeMaps = new WeakMap<ContextMap, ContextMap | null>();

function keptBy(
	kept: WeakMap<ContextMap, ContextMap | null>,
	map: ContextMap,
	build: () => ContextMap | null,
): ContextMap | null {
	if (kept.has(map)) return kept.get(map) ?? null;
	const built = build();
	kept.set(map, built);
	return built;
}

type UsageCall = SessionDetailTurnSummary["usageCalls"][number];

export function ContextTiles({
	byRun,
	calls,
	caption,
	compacting,
	compactedRuns,
	costOutside,
	footer,
	cost,
	map,
	measure: asked,
	memory,
	partRuns,
	problems,
	runs,
	subagent,
	runFigures,
	subagentCosts,
	whole,
}: {
	partRuns?: ReadonlyMap<string, ReadonlySet<number>>;
	runs?: readonly Pick<SessionDetailTurnSummary, "startedAt" | "turnId">[];
	subagent?: string;
	runFigures?: ReadonlyMap<string, { cost: number | null; ms: number | null }>;
	problems?: ReadonlyMap<string, BoxProblems>;
	measure?: ContextMeasure;
	byRun?: ContextMap | null;
	calls?: readonly UsageCall[];
	caption?: string;
	compacting?: ReadonlySet<string>;
	compactedRuns?: readonly string[];
	costOutside?: string;
	footer?: ReactNode;
	cost?: number | null;
	subagentCosts?: ReadonlyMap<string, number | null>;
	map: ContextMap;
	whole: boolean;
	memory?: string;
}) {
	const [own, setOwn] = useState<ContextMeasure>("context");
	const costed = useMemo(
		() =>
			calls && calls.length > 0
				? keptBy(costMaps, map, () =>
						costMap(map, calls, cost, subagentCosts, costOutside),
					)
				: null,
		[calls, cost, costOutside, map, subagentCosts],
	);
	const timed = useMemo(() => keptBy(timeMaps, map, () => timeMap(map)), [map]);
	const [showCompacted] = useState(whole);
	const wanted = asked ?? own;
	const measure: ContextMeasure =
		(wanted === "cost" && !costed) ||
		(wanted === "time" && !timed) ||
		(wanted === "runs" && !byRun)
			? "context"
			: wanted;
	const base =
		(measure === "cost"
			? costed
			: measure === "time"
				? timed
				: measure === "runs"
					? byRun
					: map) ?? map;
	const measured = useMemo(
		() => (measure === "context" && showCompacted ? withCompacted(base) : base),
		[base, measure, showCompacted],
	);
	const measureLook = MEASURE_LOOK[measure];
	const offMeasures = useMemo(
		() =>
			new Set<ContextMeasure>([
				...(costed ? [] : (["cost"] as const)),
				...(timed ? [] : (["time"] as const)),
			]),
		[costed, timed],
	);
	const titleId = useId();
	const area = useRef<HTMLDivElement>(null);
	const width = useElementWidth(area);
	const [hidden] = useState<ReadonlySet<ContextKind | "free">>(() => new Set());
	const shown = useMemo(() => filtered(measured, hidden), [hidden, measured]);
	const shownBase = useMemo(() => filtered(base, hidden), [base, hidden]);
	const { keep, own: ownProblems } = useOwnProblems(problems, measure);
	const markTones = useMemo(
		() => new Set(ownProblems.flatMap(([, box]) => [...box.items.values()])),
		[ownProblems],
	);
	const areaHeight = useContext(ContextAreaHeight) ?? AREA_HEIGHT;
	const preview = useContext(ContextPreview);
	const withFree = !preview && !hidden.has("free");
	const tiles =
		width > 0 ? placeTiles(shown, width, withFree, keep, areaHeight) : [];
	const drawn = tiles.flatMap((tile) => [tile, ...(tile.inside ?? [])]);
	const inGroup = new Set(
		tiles.flatMap((tile) => (tile.inside ?? []).map((each) => each.key)),
	);
	const list = useRef<HTMLUListElement>(null);
	const ghosts = useTileMorph({
		compactedRuns,
		drawn,
		list,
		source: shown,
		width,
	});
	const excluded = useMemo(
		() => excludedOf(base, hidden, measureLook.freeWord),
		[base, hidden, measureLook.freeWord],
	);
	const [picked, setPicked] = useRememberedPick(memory);
	const pickedTile = drawn.find((tile) => tile.key === picked);
	const [lits, setLits] = useRememberedLits<RunLit>(
		memory ? `${memory}:lits` : undefined,
	);
	const thing =
		picked === null
			? null
			: ([...lits].reverse().find((lit) => lit.key === picked && lit.thing)
					?.thing ?? null);
	const select = (next: Selection) => {
		setLits(next.lits);
		setPicked(next.zoom);
	};
	const selection: Selection = { lits, zoom: picked };
	const pickBox = (key: string, more = false) =>
		select(clickBox(selection, key, more));
	const pickThing = (label: string | null, more = false) => {
		if (picked === null) return;
		if (label === null)
			setLits(lits.filter((each) => !(each.key === picked && each.thing)));
		else select(clickThing(selection, picked, label, more));
	};
	const pickLit = (lit: RunLit, more = false) =>
		select(
			lit.thing === null
				? clickBox(selection, lit.key, more)
				: clickThing(selection, lit.key, lit.thing, more),
		);
	const pickedPart =
		pickedTile?.part ??
		(picked !== null
			? (map.parts.find((part) => part.key === picked) ?? null)
			: null);
	const { openAt, zoomOpen } = useContextOpen({ map, runs, subagent });
	const pickedProblems = problemsOf(problems, pickedTile?.part);
	const keepPick = useCallback(
		(element: HTMLDivElement | null) => {
			if (!element) return;
			const letGo = (event: PointerEvent) => {
				const target = event.target;
				if (
					target instanceof Element &&
					!target.closest(
						'[data-context-tile], [data-context-pick], [role="tab"], [role="tablist"]',
					)
				) {
					setPicked(null);
					setLits([]);
				}
			};
			document.addEventListener("pointerdown", letGo);
			return () => document.removeEventListener("pointerdown", letGo);
		},
		[setLits, setPicked],
	);
	const boxChart = (
		<ul
			ref={list}
			aria-labelledby={titleId}
			className="relative"
			style={{ height: areaHeight }}
		>
			{drawn.map((tile) => {
				const kind = tile.part?.kind ?? "free";
				const look = tileLook(kind, true);
				const word = tile.part ? kindWord(kind) : measureLook.freeWord;
				const name = tile.part ? tileName(tile.part) : word;
				const label = tile.part ? tile.part.label : word;
				const Glyph = tileGlyph(tile.part);
				const compacts =
					tile.part?.kind === "summary" ||
					(tile.part?.folded ?? [tile.key]).some(
						(key) => compacting?.has(key) ?? false,
					);
				const tokens = measureLook.format(tile.tokens);
				const showName = tile.h - GAP >= MIN_TILE && tile.w - GAP >= 56;
				const its = problemsOf(
					problems,
					measure === "runs" &&
						tile.part?.kind === "summary" &&
						compactedRuns?.length
						? { folded: [...compactedRuns], key: tile.part.key }
						: tile.part,
				);
				const inner =
					tile.part !== null &&
					showName &&
					drawsSubTiles(
						tile.part,
						Math.max(0, tile.w - GAP),
						Math.max(0, tile.h - GAP),
						30,
					);
				const markedInside = inner && (its?.items.size ?? 0) > 0;
				const focused =
					tile.key === picked ||
					(tile.part !== null &&
						(measure === "runs"
							? runHolds(tile.part, lits)
							: (tile.part.folded ?? [tile.part.key]).some((key) =>
									lits.some((lit) => lit.key === key),
								)));
				return (
					<li
						key={tile.key}
						data-tile-key={tile.key}
						aria-label={
							tile.part
								? `${name}, ${word}${compacts ? `, ${compactionWords}` : ""} – ${tokens} tokens`
								: `${word} – ${tokens} tokens`
						}
						className={cn(
							"group/tile absolute overflow-hidden corner-s corner-squircle squircle:corner-l edge-m",
							look.className,
							"transition-opacity duration-200",
							(picked !== null || lits.length > 0) && !focused && "opacity-40",
							inGroup.has(tile.key)
								? focused
									? "z-30"
									: "z-20"
								: focused && "z-10",
							its && !markedInside && !focused && markGlow(its.tone),
							focused &&
								(tile.part
									? "bg-[color-mix(in_oklab,var(--tint)_34%,transparent)] shadow-[0_2px_10px_-2px_color-mix(in_oklab,var(--tint)_45%,transparent)] dark:bg-[color-mix(in_oklab,var(--tint)_40%,transparent)] dark:shadow-[0_2px_12px_-2px_color-mix(in_oklab,var(--tint)_55%,transparent)]"
									: "bg-wash shadow-[0_2px_10px_-2px_rgba(0,0,0,0.2)] dark:bg-[rgba(255,255,255,0.06)] dark:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.6)]"),
						)}
						style={{
							...look.style,
							height: Math.max(0, tile.h - GAP),
							left: tile.x,
							top: tile.y,
							width: Math.max(0, tile.w - GAP),
						}}
					>
						<button
							type="button"
							data-context-tile=""
							aria-pressed={tile.key === picked}
							aria-label={`Show what's in ${name}`}
							onClick={(event) => pickBox(tile.key, event.shiftKey)}
							className="absolute inset-0 rounded-[calc(var(--radius-md)-1px)] corner-squircle outline-none transition-colors hover:bg-black/[0.03] squircle:rounded-[calc(var(--radius-xl)-1px)] dark:hover:bg-white/[0.04]"
						/>
						<span
							aria-hidden="true"
							className={cn(
								"pointer-events-none relative flex min-w-0 flex-col text-body-l",
								showName ? "px-l py-xs" : "h-full items-center justify-center",
							)}
						>
							<span className="flex min-w-0 items-center gap-s">
								{compacts && !showName && tile.part?.kind !== "summary" ? (
									<CompactionMark />
								) : (
									<Glyph aria-hidden="true" className="size-3.5 shrink-0" />
								)}
								{showName ? (
									<span className="truncate font-medium">{label}</span>
								) : null}
								{compacts && showName && tile.part?.kind !== "summary" ? (
									<CompactionMark />
								) : null}
							</span>
						</span>
						{(its?.strokes.length ?? 0) > 0 &&
						tile.h - GAP >= 22 &&
						tile.w - GAP >= 22 ? (
							<span className="pointer-events-none absolute right-1.5 bottom-1.5 z-20 flex items-center gap-xs">
								{(its?.strokes ?? []).map((kind) => (
									<span
										key={kind}
										aria-hidden="true"
										title={MOMENT_KINDS_APPEARANCE[kind].label}
										className="size-2 shrink-0 corner-full"
										style={{
											backgroundColor: MOMENT_KINDS_APPEARANCE[kind].color,
										}}
									/>
								))}
							</span>
						) : null}
						{tile.part?.nested && showName && ownsInside(tile.part) ? (
							<ContextRunTiles
								h={Math.max(0, tile.h - GAP)}
								lits={lits}
								marks={its?.items}
								onOpen={(step) => openAt(tile.key.slice("run:".length), step)}
								part={tile.part}
								top={30}
								w={Math.max(0, tile.w - GAP)}
							/>
						) : tile.part && showName ? (
							<ContextSubTiles
								glyph={Glyph}
								h={Math.max(0, tile.h - GAP)}
								marks={its?.items}
								part={tile.part}
								top={30}
								w={Math.max(0, tile.w - GAP)}
							/>
						) : null}
					</li>
				);
			})}
			<GhostTiles ghosts={ghosts} />
		</ul>
	);
	return (
		<MeasureContext.Provider value={measureLook}>
			<div className="group/chart flex flex-col gap-l">
				<ContextBar
					map={shownBase}
					measure={measure}
					offMeasures={offMeasures}
					onMeasure={asked ? undefined : setOwn}
					titleId={titleId}
					caption={caption}
					excluded={excluded}
				/>
				<PickedBoxContext.Provider
					value={
						pickedPart
							? {
									figures: pickedFigures(
										pickedPart,
										{ byRun, context: map, cost: costed, time: timed },
										{ figures: runFigures, ofPart: partRuns },
										thing,
									),
									glyph: tileGlyph(pickedPart),
									kind: pickedPart.kind,
									label: pickedPart.label,
									onClear: () => setPicked(null),
									...(thing
										? {
												onBox: () => pickThing(null),
												thing: {
													glyph: thingGlyph(pickedPart, thing),
													label: thingName(pickedPart, thing),
													onClear: () => pickThing(null),
													open: thingOpen(pickedPart, thing, zoomOpen),
												},
											}
										: {}),
								}
							: null
					}
				>
					<ContextMapFrame>
						<div ref={area} className="min-w-0">
							{boxChart}
							{footer || markTones.size > 0 ? (
								<div className="flex items-center gap-l px-xs pt-m pb-xs">
									<MarkLegend tones={markTones} />
									{footer ? <div className="ml-auto">{footer}</div> : null}
								</div>
							) : null}
							{pickedTile?.part ||
							(measure === "runs" && lits.length > 0 && pickedPart) ? (
								<div
									ref={keepPick}
									data-context-pick=""
									className="relative mt-s flex h-[420px] flex-col px-xs pb-xs"
								>
									{pickedTile?.part?.key.startsWith("run:") ? (
										<RunLegend
											problems={pickedProblems}
											turnId={pickedTile.part.key.slice("run:".length)}
										/>
									) : null}
									{pickedTile?.part ? (
										<ContextZoom
											onOpen={zoomOpen}
											onPick={pickThing}
											part={pickedTile.part}
											picked={
												new Set(
													lits.flatMap((lit) =>
														lit.key === pickedTile.part?.key && lit.thing
															? [lit.thing]
															: [],
													),
												)
											}
											problems={pickedProblems}
										/>
									) : (
										<RunZoom
											kind={pickedPart?.kind ?? "tools"}
											lits={lits}
											onOpen={openAt}
											onPick={pickLit}
											runs={byRun?.parts ?? []}
										/>
									)}
								</div>
							) : null}
						</div>
					</ContextMapFrame>
				</PickedBoxContext.Provider>
			</div>
		</MeasureContext.Provider>
	);
}

function filtered(
	map: ContextMap,
	hidden: ReadonlySet<ContextKind | "free">,
): ContextMap {
	if (![...hidden].some((kind) => kind !== "free")) return map;
	const parts = map.parts.filter((part) => !hidden.has(filterKind(part)));
	return {
		...map,
		parts,
		used: parts.reduce((sum, part) => sum + part.tokens, 0),
	};
}
