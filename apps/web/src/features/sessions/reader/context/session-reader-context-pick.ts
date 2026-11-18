import { createContext, useContext } from "react";
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

export function pickedFigures(
	part: Pick<ContextPart, "folded" | "key">,
	maps: {
		byRun: ContextMap | null | undefined;
		context: ContextMap;
		cost: ContextMap | null;
		time: ContextMap | null;
	},
	runs: {
		figures?: ReadonlyMap<string, { cost: number | null; ms: number | null }>;
		ofPart?: ReadonlyMap<string, ReadonlySet<number>>;
	},
	thing?: string | null,
): Partial<Record<ContextMeasure, Figure>> {
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
