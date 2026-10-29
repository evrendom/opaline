import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { resolveModelPricing } from "@rudel/api-routes/model-pricing";
import { createContext, useContext } from "react";
import { shortSubagentId } from "@/features/sessions/run-id";
import { formatCompactNumber } from "@/lib/format";
import {
	formatReaderCost,
	formatReaderDuration,
} from "../model/session-reader-model";
import { SUBAGENTS_PART } from "./session-reader-context-collect";
import { callContextTokens } from "./session-reader-context-fill";
import type {
	ContextItem,
	ContextMap,
	ContextPart,
	ContextStep,
} from "./session-reader-context-map";

const SUBAGENTS_KEY = SUBAGENTS_PART.key;

export type ContextMeasure = "context" | "cost" | "runs" | "time";

type UsageCall = SessionDetailTurnSummary["usageCalls"][number];

export type MeasureLook = {
	format: (value: number) => string;
	freeNote: string;
	freeWord: string;
	label: string;
	windowed: boolean;
};

export const MEASURE_LOOK: Record<ContextMeasure, MeasureLook> = {
	context: {
		format: formatCompactNumber,
		freeNote: "Room left",
		freeWord: "Free",
		label: "Context",
		windowed: true,
	},
	cost: {
		format: (value) => formatReaderCost(value / 1e6),
		freeNote: "Room left",
		freeWord: "Free",
		label: "Cost",
		windowed: false,
	},
	runs: {
		format: formatCompactNumber,
		freeNote: "Room left",
		freeWord: "Free",
		label: "Runs",
		windowed: true,
	},
	time: {
		format: (value) => formatReaderDuration(value / 1000),
		freeNote: "No step running",
		freeWord: "Idle",
		label: "Time",
		windowed: true,
	},
};

export const MeasureContext = createContext<MeasureLook>(MEASURE_LOOK.context);

export const useMeasure = () => useContext(MeasureContext);

const pairKey = (part: string, item: string) => `${part}\u0000${item}`;

function remeasured(
	map: ContextMap,
	byPart: ReadonlyMap<string, number>,
	byItem: ReadonlyMap<string, number>,
	window: (used: number) => number,
): ContextMap {
	const parts = map.parts
		.map(
			(part): ContextPart => ({
				...part,
				items: (part.items ?? [])
					.map(
						(item): ContextItem => ({
							...item,
							tokens: Math.round(
								byItem.get(pairKey(part.key, item.label)) ?? 0,
							),
						}),
					)
					.filter((item) => item.tokens > 0)
					.sort((a, b) => b.tokens - a.tokens),
				tokens: Math.round(byPart.get(part.key) ?? 0),
			}),
		)
		.filter((part) => part.tokens > 0)
		.sort((a, b) => b.tokens - a.tokens);
	const used = parts.reduce((sum, part) => sum + part.tokens, 0);
	return { ...map, parts, used, window: Math.max(used, window(used)) };
}

function callCosts(call: UsageCall, model: string | null) {
	const input = callContextTokens(call);
	const pricing = resolveModelPricing(call.model ?? model, {
		at: call.at,
		contextInputTokens: input,
	});
	if (!pricing) return null;
	return {
		input:
			(call.freshInputTokens * pricing.inputPerMTok +
				call.cacheReadInputTokens * (pricing.cacheReadPerMTok ?? 0) +
				call.cacheCreationInputTokens * (pricing.cacheWrite5mPerMTok ?? 0)) /
			1e6,
		output: (call.outputTokens * pricing.outputPerMTok) / 1e6,
	};
}

export function costMap(
	map: ContextMap,
	calls: readonly UsageCall[],
	total?: number | null,
	subagents?: ReadonlyMap<string, number | null>,
): ContextMap | null {
	const traced = new Set(map.trail.map((step) => step.key));
	const byPart = new Map<string, number>();
	const byItem = new Map<string, number>();
	const credit = (key: string, items: readonly string[], cost: number) => {
		byPart.set(key, (byPart.get(key) ?? 0) + cost);
		for (const item of items) {
			const pair = pairKey(key, item);
			byItem.set(pair, (byItem.get(pair) ?? 0) + cost / items.length);
		}
	};
	const held: { items: readonly string[]; key: string; tokens: number }[] = [];
	for (const part of map.parts)
		if (!traced.has(part.key)) {
			const items = part.items ?? [];
			if (items.length > 0)
				for (const item of items)
					held.push({
						items: [item.label],
						key: part.key,
						tokens: item.tokens,
					});
			else held.push({ items: [], key: part.key, tokens: part.tokens });
		}
	const steps = [...map.trail].sort((a, b) => a.end - b.end);
	const sorted = [...calls]
		.map((call) => ({ at: Date.parse(call.at), call }))
		.filter(({ at }) => map.until === null || at <= map.until)
		.sort((a, b) => a.at - b.at);
	let next = 0;
	let priced = false;
	sorted.forEach(({ at, call }, index) => {
		const cost = callCosts(call, map.model);
		if (!cost) return;
		priced = true;
		while (next < steps.length && (steps[next]?.end ?? 0) <= at) {
			const step = steps[next] as ContextStep;
			held.push({ items: step.items, key: step.key, tokens: step.tokens });
			next += 1;
		}
		const total = held.reduce((sum, each) => sum + each.tokens, 0);
		if (total > 0)
			for (const each of held)
				credit(each.key, each.items, (cost.input * each.tokens) / total);
		const until = sorted[index + 1]?.at ?? Number.POSITIVE_INFINITY;
		const wrote = map.trail.filter(
			(step) => step.written >= at && step.written < until,
		);
		const wroteTokens = wrote.reduce((sum, step) => sum + step.tokens, 0);
		if (wroteTokens > 0)
			for (const step of wrote)
				credit(step.key, step.items, (cost.output * step.tokens) / wroteTokens);
		else credit("model:messages", [], cost.output);
	});
	if (!priced) return null;
	const agents = map.parts.find((part) => part.key === SUBAGENTS_KEY);
	for (const [id, spent] of subagents ?? []) {
		if (!spent || spent <= 0) continue;
		const short = shortSubagentId(id);
		const thing = agents?.items?.find(
			(item) => item.label === short || item.label.startsWith(`${short} · `),
		);
		if (thing) credit(SUBAGENTS_KEY, [thing.label], spent);
	}
	for (const [key, value] of byPart) byPart.set(key, value * 1e6);
	for (const [key, value] of byItem) byItem.set(key, value * 1e6);
	const placed = [...byPart.values()].reduce((sum, value) => sum + value, 0);
	const outside = total ? total * 1e6 - placed : 0;
	const measured = remeasured(map, byPart, byItem, (used) => used);
	if (outside < 0.005 * Math.max(placed, 1)) return measured;
	const part: ContextPart = {
		count: 1,
		key: "cost:outside",
		kind: "earlier",
		label: "Outside this map",
		note: "Its calls the map doesn't hold: before its context's compaction, after its fullest moment, and subagents it has no box for.",
		tokens: Math.round(outside),
	};
	const used = measured.used + part.tokens;
	return {
		...measured,
		parts: [...measured.parts, part].sort((a, b) => b.tokens - a.tokens),
		used,
		window: used,
	};
}

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
