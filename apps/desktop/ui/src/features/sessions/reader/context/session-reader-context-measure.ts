import {
	pairKey,
	remeasured,
} from "@rudel/api-routes/session-context/session-reader-context-part-figures";
import { createContext, useContext } from "react";
import { type Figure, figureText } from "@/lib/figure";
import { compactNumberFigure } from "@/lib/format";
import {
	readerCostFigure,
	readerDurationFigure,
} from "../model/session-reader-model";
import type { ContextMap } from "./session-reader-context-map";

export type ContextMeasure = "context" | "cost" | "runs" | "time";

export type MeasureLook = {
	figure: (value: number) => Figure;
	format: (value: number) => string;
	freeNote: string;
	freeWord: string;
	label: string;
	windowed: boolean;
};

const measured = (figure: (value: number) => Figure) => ({
	figure,
	format: (value: number) => figureText(figure(value)),
});

export const MEASURE_LOOK: Record<ContextMeasure, MeasureLook> = {
	context: {
		...measured(compactNumberFigure),
		freeNote: "Room left",
		freeWord: "Free",
		label: "Context",
		windowed: true,
	},
	cost: {
		...measured((value) => readerCostFigure(value / 1e6)),
		freeNote: "Room left",
		freeWord: "Free",
		label: "Cost",
		windowed: false,
	},
	runs: {
		...measured(compactNumberFigure),
		freeNote: "Room left",
		freeWord: "Free",
		label: "Runs",
		windowed: true,
	},
	time: {
		...measured((value) => readerDurationFigure(value / 1000)),
		freeNote: "No step running",
		freeWord: "Idle",
		label: "Time",
		windowed: true,
	},
};

export const MeasureContext = createContext<MeasureLook>(MEASURE_LOOK.context);

export const useMeasure = () => useContext(MeasureContext);

export function timeMap(map: ContextMap): ContextMap | null {
	if (map.trail.length === 0) return null;
	const start = Math.min(...map.trail.map((step) => step.start));
	const end = map.until ?? Math.max(...map.trail.map((step) => step.end));
	const spans = map.trail
		.map((step) => ({
			from: step.start,
			items: step.items,
			key: step.key,
			to: Math.min(step.waited, end),
		}))
		.filter((span) => span.to > span.from);
	const events = spans
		.flatMap((span, index) => [
			{ at: span.from, index, opens: true },
			{ at: span.to, index, opens: false },
		])
		.sort((a, b) => a.at - b.at || Number(a.opens) - Number(b.opens));
	const byPart = new Map<string, number>();
	const byItem = new Map<string, number>();
	const running = new Set<number>();
	let busy = 0;
	let last = start;
	for (const event of events) {
		const length = event.at - last;
		if (length > 0 && running.size > 0) {
			busy += length;
			const share = length / running.size;
			for (const index of running) {
				const span = spans[index];
				if (!span) continue;
				byPart.set(span.key, (byPart.get(span.key) ?? 0) + share);
				for (const item of span.items) {
					const pair = pairKey(span.key, item);
					byItem.set(pair, (byItem.get(pair) ?? 0) + share / span.items.length);
				}
			}
		}
		last = event.at;
		if (event.opens) running.add(event.index);
		else running.delete(event.index);
	}
	return remeasured(map, byPart, byItem, () => Math.max(end - start, busy));
}

export { costMap } from "@rudel/api-routes/session-context/session-reader-context-part-figures";
