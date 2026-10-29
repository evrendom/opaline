import { squarify } from "../summary/session-reader-breakdown";
import {
	foldAll,
	foldByKind,
	foldSmallest,
	tileName,
} from "./session-reader-context-fold";
import type { ContextMap, ContextPart } from "./session-reader-context-map";

export const AREA_HEIGHT = 280;
export const GAP = 3;

export type Placed = {
	h: number;
	inside?: Placed[];
	key: string;
	part: ContextPart | null;
	tokens: number;
	w: number;
	x: number;
	y: number;
};

type Box = { h: number; w: number; x: number; y: number };

export const MIN_TILE = 28;

const READABLE = { h: 48, w: 96 };

const MOST_GROWTH = 2.5;
const GROWTH_STEP = 1.25;

const GROUP_HEADER = 48;
const GROUP_INSET = 4;

const tooSmall = (tile: Placed) =>
	tile.w - GAP < MIN_TILE || tile.h - GAP < MIN_TILE;

const NONE: ReadonlySet<string> = new Set();

const pinned = (part: ContextPart) => part.kind === "skill";

function tileIn(
	parts: readonly ContextPart[],
	box: Box,
	keep: ReadonlySet<string> = NONE,
): Placed[] {
	const held = (part: ContextPart) => pinned(part) || keep.has(part.key);
	const lay = (
		parts: readonly ContextPart[],
		grown?: ReadonlyMap<string, number>,
	) => {
		const byKey = new Map(parts.map((part) => [part.key, part]));
		return squarify(
			parts.map((part) => ({
				color: "",
				label: part.key,
				value: grown?.get(part.key) ?? part.tokens,
			})),
			box.w,
			box.h,
		).map((cell): Placed => {
			const part = byKey.get(cell.part.label) ?? null;
			return {
				h: cell.height,
				key: cell.part.label,
				part,
				tokens: part?.tokens ?? cell.part.value,
				w: cell.width,
				x: box.x + cell.left,
				y: box.y + cell.top,
			};
		});
	};
	const cramped = (tile: Placed) =>
		tile.w - GAP < READABLE.w || tile.h - GAP < READABLE.h;
	const grow = (laid: readonly ContextPart[]) => {
		let placed = lay(laid);
		let grown = new Map(laid.map((part) => [part.key, part.tokens]));
		for (let step = 0; step < 12 && placed.some(cramped); step += 1) {
			const next = new Map(grown);
			for (const tile of placed) {
				if (!tile.part || !cramped(tile)) continue;
				const was = next.get(tile.key) ?? tile.part.tokens;
				const most =
					held(tile.part) && tooSmall(tile)
						? Number.POSITIVE_INFINITY
						: tile.part.tokens * MOST_GROWTH;
				next.set(tile.key, Math.min(most, was * GROWTH_STEP));
			}
			if ([...next].every(([key, value]) => grown.get(key) === value)) break;
			grown = next;
			placed = lay(laid, grown);
		}
		return placed;
	};
	const pinnedParts = parts.filter(held);
	let laid: readonly ContextPart[] = parts.filter((part) => !held(part));
	let placed = grow([...laid, ...pinnedParts]);
	for (let round = 0; round < 3 * parts.length && laid.length > 1; round += 1) {
		const small = placed.filter(
			(tile) => tooSmall(tile) && !(tile.part && held(tile.part)),
		).length;
		if (small === 0) break;
		let next = foldByKind(laid, small);
		if (next.length === laid.length) next = foldAll(laid, small);
		if (next.length === laid.length) next = foldSmallest(laid);
		laid = next;
		placed = grow([...laid, ...pinnedParts]);
	}
	return placed;
}

const groupKey = (parts: readonly ContextPart[]) =>
	parts[0]?.key.startsWith("compacted:") ? "compacted" : "earlier";

function groupOf(parts: readonly ContextPart[]): ContextPart {
	const biggestFirst = [...parts].sort((a, b) => b.tokens - a.tokens);
	const key = groupKey(parts);
	return {
		count: parts.reduce((sum, part) => sum + part.count, 0),
		items: biggestFirst.map((part) => ({
			count: part.count,
			label: tileName(part),
			tokens: part.tokens,
		})),
		key,
		kind: key === "compacted" ? "summary" : "earlier",
		label: parts[0]?.before ?? "Earlier",
		parts: parts.length,
		tokens: parts.reduce((sum, part) => sum + part.tokens, 0),
	};
}

export function placeTiles(
	map: ContextMap,
	width: number,
	withFree: boolean,
	keep: ReadonlySet<string> = NONE,
): Placed[] {
	const inner = { h: AREA_HEIGHT - GAP, w: width - GAP };
	const free = withFree ? Math.max(0, map.window - map.used) : 0;
	const usedWidth = withFree
		? inner.w * Math.min(1, map.used / map.window)
		: inner.w;
	const groups = new Map<string, ContextPart[]>();
	for (const part of map.parts)
		if (part.before)
			groups.set(part.before, [...(groups.get(part.before) ?? []), part]);
	const inGroup = new Map(
		[...groups.values()].map((parts) => [groupKey(parts), parts]),
	);
	const top = [
		...map.parts.filter((part) => !part.before),
		...[...groups.values()].map(groupOf),
	];
	const placed = tileIn(
		top,
		{ h: inner.h, w: usedWidth, x: GAP, y: GAP },
		keep,
	).map((tile): Placed => {
		const before = inGroup.get(tile.key);
		if (!before) return tile;
		const box = {
			h: tile.h - GROUP_HEADER - GROUP_INSET,
			w: tile.w - 2 * GROUP_INSET,
			x: tile.x + GROUP_INSET,
			y: tile.y + GROUP_HEADER,
		};
		if (box.w - GAP < MIN_TILE || box.h - GAP < MIN_TILE) return tile;
		return {
			...tile,
			inside: tileIn(before, box).map((each) => ({
				...each,
				key: `before:${each.key}`,
			})),
		};
	});
	if (free > 0 && inner.w - usedWidth - GAP >= MIN_TILE)
		placed.push({
			h: inner.h,
			key: "free",
			part: null,
			tokens: free,
			w: inner.w - usedWidth,
			x: GAP + usedWidth,
			y: GAP,
		});
	return placed;
}
