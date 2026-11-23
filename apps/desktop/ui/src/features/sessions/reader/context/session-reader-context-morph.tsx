import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { tileGlyph, tileLook } from "./session-reader-context-bar";
import { GAP, type Placed } from "./session-reader-context-place";

type Rect = { height: number; left: number; top: number; width: number };

type Ghost = { from: Rect; tile: Placed; to: Rect | null };

type Layout = {
	compacted: ReadonlySet<string>;
	rects: Map<string, Rect>;
	source: unknown;
	summary: Rect | null;
	tiles: Map<string, Placed>;
	width: number;
};

const DURATION = 480;
const EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

const rectOf = (tile: Placed): Rect => ({
	height: Math.max(0, tile.h - GAP),
	left: tile.x,
	top: tile.y,
	width: Math.max(0, tile.w - GAP),
});

const px = (rect: Rect) => ({
	height: `${rect.height}px`,
	left: `${rect.left}px`,
	top: `${rect.top}px`,
	width: `${rect.width}px`,
});

const toward = (from: Rect, to: Rect) => {
	const sx = to.width > 0 ? from.width / to.width : 1;
	const sy = to.height > 0 ? from.height / to.height : 1;
	return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`;
};

const holdsAny = (tile: Placed, keys: ReadonlySet<string>) =>
	(tile.part?.folded ?? [tile.key]).some((key) => keys.has(key));

const summaryOf = (drawn: readonly Placed[]) => {
	const tile = drawn.find((each) => each.part?.kind === "summary");
	return tile ? rectOf(tile) : null;
};

const reduced = () =>
	typeof window !== "undefined" &&
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useTileMorph({
	compactedRuns,
	drawn,
	list,
	source,
	width,
}: {
	compactedRuns: readonly string[] | undefined;
	drawn: readonly Placed[];
	list: RefObject<HTMLUListElement | null>;
	source: unknown;
	width: number;
}): Ghost[] {
	const last = useRef<Layout | null>(null);
	const [ghosts, setGhosts] = useState<Ghost[]>([]);
	useLayoutEffect(() => {
		const compacted = new Set(compactedRuns ?? []);
		const rects = new Map(drawn.map((tile) => [tile.key, rectOf(tile)]));
		const summary = summaryOf(drawn);
		const was = last.current;
		last.current = {
			compacted,
			rects,
			source,
			summary,
			tiles: new Map(drawn.map((tile) => [tile.key, tile])),
			width,
		};
		const root = list.current;
		if (
			!was ||
			!root ||
			was.source === source ||
			was.width !== width ||
			drawn.length === 0 ||
			reduced()
		)
			return;
		for (const tile of drawn) {
			const element = root.querySelector<HTMLElement>(
				`[data-tile-key="${CSS.escape(tile.key)}"]`,
			);
			if (!element) continue;
			const to = rectOf(tile);
			const kept = was.rects.get(tile.key);
			const from =
				kept ??
				(was.summary && holdsAny(tile, was.compacted) ? was.summary : null);
			if (from)
				element.animate(
					[
						{
							opacity: kept ? 1 : 0,
							transform: toward(from, to),
							transformOrigin: "0 0",
						},
						{ opacity: 1, transform: "none", transformOrigin: "0 0" },
					],
					{ duration: DURATION, easing: EASING },
				);
			else
				element.animate(
					[
						{ opacity: 0, transform: "scale(0.94)" },
						{ opacity: 1, transform: "none" },
					],
					{
						delay: DURATION * 0.12,
						duration: DURATION * 0.8,
						easing: EASING,
						fill: "backwards",
					},
				);
		}
		const gone: Ghost[] = [];
		for (const [key, from] of was.rects) {
			if (rects.has(key) || key === "free") continue;
			const tile = was.tiles.get(key);
			if (!tile) continue;
			gone.push({
				from,
				tile,
				to: summary && holdsAny(tile, compacted) ? summary : null,
			});
		}
		setGhosts(gone);
	}, [compactedRuns, drawn, list, source, width]);
	useLayoutEffect(() => {
		const root = list.current;
		if (!root || ghosts.length === 0) return;
		const runs = ghosts.flatMap((ghost) => {
			const element = root.querySelector<HTMLElement>(
				`[data-ghost-key="${CSS.escape(ghost.tile.key)}"]`,
			);
			if (!element) return [];
			return [
				element.animate(
					[
						{ opacity: 1, transform: "none", transformOrigin: "0 0" },
						{
							opacity: 0,
							transform: ghost.to
								? toward(ghost.to, ghost.from)
								: "scale(0.96)",
							transformOrigin: "0 0",
						},
					],
					{ duration: DURATION, easing: EASING, fill: "forwards" },
				).finished,
			];
		});
		let live = true;
		Promise.allSettled(runs).then(() => {
			if (live) setGhosts([]);
		});
		return () => {
			live = false;
		};
	}, [ghosts, list]);
	return ghosts;
}

export function GhostTiles({
	ghosts,
	look: own,
}: {
	ghosts: readonly Ghost[];
	look?: ReturnType<typeof tileLook>;
}) {
	return ghosts.map((ghost) => {
		const tile = ghost.tile;
		const look = own ?? tileLook(tile.part?.kind ?? "free", true);
		const Glyph = tileGlyph(tile.part);
		const roomy = ghost.from.height >= 28 && ghost.from.width >= 56;
		return (
			<li
				key={ghost.tile.key}
				aria-hidden="true"
				data-ghost-key={ghost.tile.key}
				className={cn(
					"absolute z-30 overflow-hidden",
					"corner-s corner-squircle edge-m",
					"pointer-events-none",
					"squircle:corner-l",
					tile.part ? look.className : "border-transparent",
				)}
				style={{ ...look.style, ...px(ghost.from) }}
			>
				<span
					className={cn(
						"flex min-w-0 items-center gap-s text-body-l",
						roomy ? "px-l py-xs" : "h-full justify-center",
					)}
				>
					<Glyph aria-hidden="true" className="size-3.5 shrink-0" />
					{roomy && tile.part ? (
						<span className="truncate font-medium">{tile.part.label}</span>
					) : null}
				</span>
			</li>
		);
	});
}
