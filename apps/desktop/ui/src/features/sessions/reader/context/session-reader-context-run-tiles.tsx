import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { squarify } from "../summary/session-reader-breakdown";
import { TINT, tileGlyph, tileLook } from "./session-reader-context-bar";
import { fitting } from "./session-reader-context-fit";
import type {
	ContextPart,
	RunPart,
	RunThing,
} from "./session-reader-context-map";
import type { Tone } from "./session-reader-context-problems";
import { markGlow, markOf } from "./session-reader-context-subtiles";

const INSET = 6;
const PART_INSET = 3;
const MIN_AREA = { h: 28, w: 40 } as const;
const LIT_SIDE = 18;
const PART_ROOM = 14;
const NAME_ROW = 20;

export type RunLit = { key: string; thing: string | null };

const partHolds = (part: RunPart, lits: readonly RunLit[]) =>
	lits.some(
		(lit) =>
			lit.key === part.key &&
			(lit.thing === null
				? part.tokens > 0
				: part.things.some((thing) => thing.label === lit.thing)),
	);

const thingIsLit = (part: RunPart, thing: RunThing, lits: readonly RunLit[]) =>
	lits.some(
		(lit) =>
			lit.key === part.key && (lit.thing === null || lit.thing === thing.label),
	);

export function runHolds(part: ContextPart, lits: readonly RunLit[]): boolean {
	return (part.nested ?? []).some((each) => partHolds(each, lits));
}

export function firstLitStep(
	part: ContextPart,
	lits: readonly RunLit[],
): string | null {
	for (const each of part.nested ?? [])
		for (const thing of each.things)
			if (thingIsLit(each, thing, lits) && thing.steps[0])
				return thing.steps[0];
	return null;
}

export function drawsRunTiles(
	part: ContextPart,
	w: number,
	h: number,
	top: number,
): boolean {
	return (
		(part.nested?.length ?? 0) > 0 &&
		w - 2 * INSET >= MIN_AREA.w &&
		h - top - INSET >= MIN_AREA.h
	);
}

const MIN_CELL = 14;

function cellsOf<T extends { tokens: number }>(
	all: readonly T[],
	isLit: (item: T) => boolean,
	w: number,
	h: number,
	side: number,
) {
	const items = fitting(all, (item) => item.tokens, w, h, MIN_CELL, isLit);
	const whole = items.reduce((sum, item) => sum + item.tokens, 0);
	const least = (whole * side * side) / Math.max(1, w * h);
	return squarify(
		items.map((item, index) => ({
			color: "",
			label: String(index),
			value: isLit(item) ? Math.max(item.tokens, least) : item.tokens,
		})),
		w,
		h,
	).map((cell) => ({ cell, item: items[Number(cell.part.label)] as T }));
}

export function ContextRunTiles({
	detailed = false,
	h,
	lits,
	marks,
	onOpen,
	onPick,
	part,
	top,
	w,
}: {
	detailed?: boolean;
	h: number;
	lits: readonly RunLit[];
	marks?: ReadonlyMap<string, Tone>;
	onOpen: (step: string | null) => void;
	onPick?: (lit: RunLit, more: boolean) => void;
	part: ContextPart;
	top: number;
	w: number;
}) {
	if (!drawsRunTiles(part, w, h, top)) return null;
	const area = { h: h - top - INSET, w: w - 2 * INSET };
	const parts = (part.nested ?? []).filter((each) => each.tokens > 0);
	const anyLit = lits.length > 0;
	return (
		<span
			className={cn("absolute", !detailed && "pointer-events-none")}
			style={{ height: area.h, left: INSET, top, width: area.w }}
		>
			{cellsOf(
				parts,
				(each) => partHolds(each, lits),
				area.w,
				area.h,
				LIT_SIDE + 2 * PART_INSET + (detailed ? NAME_ROW : 0),
			).map(({ cell, item: each }) => {
				const width = Math.max(0, cell.width - 2);
				const height = Math.max(0, cell.height - 2);
				const named = detailed && width >= 56 && height >= NAME_ROW + 18;
				const inner = {
					h: height - 2 * PART_INSET - (named ? NAME_ROW : 0),
					w: width - 2 * PART_INSET,
				};
				const Glyph = tileGlyph({ key: each.key, kind: each.kind } as never);
				const things = each.things.filter((thing) => thing.tokens > 0);
				const roomy =
					inner.w >= PART_ROOM && inner.h >= PART_ROOM && things.length > 1;
				const holds = partHolds(each, lits);
				const tone = markOf(marks, each.label);
				const look = tileLook(each.kind, true);
				const firstOf = () =>
					(things.find((thing) => thingIsLit(each, thing, lits)) ?? things[0])
						?.steps[0] ?? null;
				return (
					<span
						key={each.key}
						title={each.label}
						className={cn(
							"absolute corner-xs edge-m corner-squircle transition-opacity squircle:corner-s",
							detailed ? look.className : "border-current/20",
							tone && markGlow(tone),
							anyLit && !holds && (detailed ? "opacity-55" : "opacity-25"),
						)}
						style={
							{
								...(detailed ? look.style : {}),
								"--tint": TINT[each.kind],
								height,
								left: cell.left,
								top: cell.top,
								width,
							} as CSSProperties
						}
					>
						{named ? (
							<button
								type="button"
								data-context-tile=""
								onClick={(event) =>
									onPick?.({ key: each.key, thing: null }, event.shiftKey)
								}
								className={cn(
									"absolute inset-x-0 top-0 flex h-5 items-center gap-xs",
									"px-s",
									"text-left text-body-s font-medium",
								)}
							>
								<Glyph className="size-3 shrink-0" />
								<span className="truncate">{each.label}</span>
							</button>
						) : null}
						<span
							className="absolute"
							style={{
								height: inner.h,
								left: PART_INSET,
								top: PART_INSET + (named ? NAME_ROW : 0),
								width: inner.w,
							}}
						>
							{roomy ? (
								cellsOf(
									things,
									(thing) => thingIsLit(each, thing, lits),
									inner.w,
									inner.h,
									LIT_SIDE,
								).map(({ cell: at, item: thing }) => (
									<Thing
										key={thing.label}
										at={at}
										detailed={detailed}
										glyph={Glyph}
										lit={thingIsLit(each, thing, lits)}
										onOpen={() => onOpen(thing.steps[0] ?? null)}
										onPick={(more) =>
											onPick?.({ key: each.key, thing: thing.label }, more)
										}
										quiet={anyLit && !thingIsLit(each, thing, lits)}
										thing={thing}
									/>
								))
							) : (
								<Thing
									at={{ height: inner.h, left: 0, top: 0, width: inner.w }}
									detailed={detailed}
									glyph={Glyph}
									lit={holds}
									onOpen={() => onOpen(firstOf())}
									onPick={(more) =>
										onPick?.({ key: each.key, thing: null }, more)
									}
									quiet={false}
									thing={{ label: each.label, steps: [], tokens: each.tokens }}
								/>
							)}
						</span>
					</span>
				);
			})}
		</span>
	);
}

function Thing({
	at,
	detailed,
	glyph: Glyph,
	lit,
	onOpen,
	onPick,
	quiet,
	thing,
}: {
	at: { height: number; left: number; top: number; width: number };
	detailed: boolean;
	glyph: ReturnType<typeof tileGlyph>;
	lit: boolean;
	onOpen: () => void;
	onPick: (more: boolean) => void;
	quiet: boolean;
	thing: RunThing;
}) {
	const width = Math.max(0, at.width - 2);
	const height = Math.max(0, at.height - 2);
	const style = { height, left: at.left, top: at.top, width };
	const mark =
		width >= 14 && height >= 14 ? (
			<Glyph className={cn("relative size-3", !lit && "opacity-45")} />
		) : null;
	const litLook =
		"edge-l border-(--tint) bg-[color-mix(in_oklab,var(--tint)_35%,transparent)] text-(--tint) hover:bg-[color-mix(in_oklab,var(--tint)_55%,transparent)]";
	if (!lit && !detailed)
		return (
			<span
				className={cn(
					"absolute flex items-center justify-center",
					"corner-xs edge-m corner-squircle",
					"border-current",
					"squircle:corner-xs",
					quiet ? "opacity-10" : "opacity-25",
				)}
				style={style}
			>
				{mark}
			</span>
		);
	return (
		<button
			type="button"
			data-context-tile=""
			title={thing.label}
			aria-pressed={detailed ? lit : undefined}
			aria-label={
				detailed ? `Pick ${thing.label}` : `Open ${thing.label} in the detail`
			}
			onClick={(event) => {
				event.stopPropagation();
				if (detailed) onPick(event.shiftKey);
				else onOpen();
			}}
			className={cn(
				"absolute z-10 flex items-center justify-center",
				"corner-xs corner-squircle",
				"pointer-events-auto transition-colors",
				"squircle:corner-xs",
				lit
					? litLook
					: "edge-m border-current/25 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
			)}
			style={style}
		>
			{mark}
		</button>
	);
}
