import { type ComponentType, createContext, useContext } from "react";
import type { Figure } from "@/lib/figure";
import { shareOfFigure, unitFigure } from "@/lib/format";
import type { TileGlyph } from "./session-reader-context-bar";
import { thingKey } from "./session-reader-context-by-run";
import type {
	ContextKind,
	ContextMap,
	ContextPart,
} from "./session-reader-context-map";
import {
	type ContextMeasure,
	MEASURE_LOOK,
} from "./session-reader-context-measure";

export type PickedBox = {
	figures: Partial<Record<ContextMeasure, Figure>>;
	glyph: TileGlyph;
	kind: ContextKind;
	label: string;
	onClear: () => void;
	onBox?: () => void;
	thing?: {
		glyph: TileGlyph;
		label: string;
		onClear: () => void;
		open: { go: () => void; words: string };
	};
};

export const PickedBoxContext = createContext<PickedBox | null>(null);

export const usePickedBox = () => useContext(PickedBoxContext);

/** The picked box as a page outside the map reads it: the repo page's rail
 * follows it. `memory` names the session the map shows, `cost` is in dollars,
 * and `runs` counts the runs that touched it; either is null when unknown. */
export type PickedPart = {
	memory: string | undefined;
	key: string;
	label: string;
	cost: number | null;
	runs: number | null;
	clear: () => void;
};

/** Set by a page that follows the picked box from outside the map: the map
 * renders it with the box it has picked, or null. */
export const PickedPartSink = createContext<ComponentType<{
	part: PickedPart | null;
}> | null>(null);

export type PickedMaps = {
	byRun: ContextMap | null | undefined;
	context: ContextMap;
	cost: ContextMap | null;
	time: ContextMap | null;
};

export type PickedRuns = {
	figures?: ReadonlyMap<string, { cost: number | null; ms: number | null }>;
	ofPart?: ReadonlyMap<string, ReadonlySet<number>>;
};

/** The picked box's own numbers: tokens of its window, cost in millionths of
 * a dollar, time in milliseconds and the runs that touched it. */
export function pickedValues(
	part: Pick<ContextPart, "folded" | "key">,
	maps: PickedMaps,
	runs: PickedRuns,
	thing?: string | null,
): {
	tokens: number | undefined;
	window: number;
	cost: number | null | undefined;
	ms: number | null | undefined;
	runs: number | undefined;
} {
	const { key } = part;
	const run = key.startsWith("run:") ? key.slice("run:".length) : null;
	const keys = part.folded ?? [key];
	const tokensIn = (map: ContextMap | null | undefined) => {
		const found = map?.parts.filter((each) => keys.includes(each.key)) ?? [];
		if (found.length === 0) return undefined;
		if (thing) {
			const items = found.flatMap((each) =>
				(each.items ?? []).filter((item) => item.label === thing),
			);
			return items.length > 0
				? items.reduce((sum, item) => sum + item.tokens, 0)
				: undefined;
		}
		return found.reduce((sum, each) => sum + each.tokens, 0);
	};
	const runKeys = thing ? keys.map((each) => thingKey(each, thing)) : keys;
	const tokens = tokensIn(run ? maps.byRun : maps.context);
	const window = (run ? maps.byRun : maps.context)?.window ?? 0;
	const own = run ? runs.figures?.get(run) : undefined;
	const cost =
		run && !thing
			? typeof own?.cost === "number"
				? own.cost * 1e6
				: undefined
			: tokensIn(maps.cost);
	const ms = run && !thing ? own?.ms : tokensIn(maps.time);
	const inRuns =
		run && !thing
			? 1
			: runKeys.some((each) => runs.ofPart?.has(each))
				? new Set(
						runKeys.flatMap((each) => [...(runs.ofPart?.get(each) ?? [])]),
					).size
				: undefined;
	return { tokens, window, cost, ms, runs: inRuns };
}

export function pickedPart(
	part: Pick<ContextPart, "folded" | "key" | "label"> | null,
	maps: PickedMaps,
	runs: PickedRuns,
	thing: string | null,
	named: string | null,
	memory: string | undefined,
	clear: () => void,
): PickedPart | null {
	if (!part) return null;
	const values = pickedValues(part, maps, runs, thing);
	return {
		memory,
		key: thing ? thingKey(part.key, thing) : part.key,
		label: named ?? part.label,
		cost: typeof values.cost === "number" ? values.cost / 1e6 : null,
		runs: values.runs ?? null,
		clear,
	};
}

export function pickedFigures(
	part: Pick<ContextPart, "folded" | "key">,
	maps: PickedMaps,
	runs: PickedRuns,
	thing?: string | null,
): Partial<Record<ContextMeasure, Figure>> {
	const {
		tokens,
		window,
		cost,
		ms,
		runs: inRuns,
	} = pickedValues(part, maps, runs, thing);
	return {
		...(tokens !== undefined
			? {
					context: [
						...MEASURE_LOOK.context.figure(tokens),
						" · ",
						...shareOfFigure(tokens, window),
					],
				}
			: {}),
		...(cost !== undefined && cost !== null
			? { cost: MEASURE_LOOK.cost.figure(cost) }
			: {}),
		...(ms !== undefined && ms !== null
			? { time: MEASURE_LOOK.time.figure(ms) }
			: {}),
		...(inRuns !== undefined ? { runs: [unitFigure(inRuns, "")] } : {}),
	};
}
