import { resolveModelPricing } from "../model-pricing.js";
import type { SessionDetailTurnSummary } from "../schemas/session-detail-payload.js";
import { shortSubagentId } from "./run-id.js";
import { SUBAGENTS_PART } from "./session-reader-context-collect.js";
import { callContextTokens } from "./session-reader-context-fill.js";
import type {
	ContextItem,
	ContextMap,
	ContextPart,
	ContextStep,
} from "./session-reader-context-map.js";

// What each part of a session's context map cost and which runs touched it.
// The session page works these out in the browser; the server stores them in
// the context snapshot, whose map drops the trail they are read from.

type UsageCall = SessionDetailTurnSummary["usageCalls"][number];

const SUBAGENTS_KEY = SUBAGENTS_PART.key;

export const pairKey = (part: string, item: string) => `${part}\u0000${item}`;

export const thingKey = (part: string, label: string) =>
	`${part}\u0000${label}`;

export function remeasured(
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
	outsideLabel?: string,
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
	const later =
		calls
			.filter((call) => map.until !== null && Date.parse(call.at) > map.until)
			.reduce((sum, call) => {
				const cost = callCosts(call, map.model);
				return cost ? sum + cost.input + cost.output : sum;
			}, 0) * 1e6;
	const placed = [...byPart.values()].reduce((sum, value) => sum + value, 0);
	const scale =
		total && placed + later > 0 ? (total * 1e6) / (placed + later) : 1;
	if (scale !== 1) {
		for (const [key, value] of byPart) byPart.set(key, value * scale);
		for (const [key, value] of byItem) byItem.set(key, value * scale);
	}
	const outside = later * scale;
	const measured = remeasured(map, byPart, byItem, (used) => used);
	if (outside < 0.005 * Math.max(placed * scale, 1)) return measured;
	const part: ContextPart = {
		count: 1,
		key: "cost:outside",
		kind: "earlier",
		label: outsideLabel ?? "Outside this map",
		note: "Calls after the moment this map shows, before the next compaction.",
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

export function runsByPart(
	map: ContextMap,
	runs: readonly Pick<SessionDetailTurnSummary, "startedAt" | "turnId">[],
): Map<string, ReadonlySet<number>> {
	const starts = runs.map((run) =>
		run.startedAt ? Date.parse(run.startedAt) : Number.NaN,
	);
	const runAt = (ms: number) => {
		let at = 0;
		starts.forEach((start, index) => {
			if (start <= ms) at = index;
		});
		return at;
	};
	const seen = new Map<string, Set<number>>();
	for (const step of map.trail) {
		const at = runAt(step.start);
		seen.set(step.key, (seen.get(step.key) ?? new Set()).add(at));
		for (const item of step.items) {
			const key = thingKey(step.key, item);
			seen.set(key, (seen.get(key) ?? new Set()).add(at));
		}
	}
	const out = new Map<string, ReadonlySet<number>>(seen);
	out.set("you", new Set(runs.map((_, index) => index)));
	return out;
}

/** A cost map's costs as a snapshot stores them: millionths of a dollar by
 * part key and by `pairKey(part, item)`. */
export function storedCost(costed: ContextMap): Record<string, number> {
	const cost: Record<string, number> = {};
	for (const part of costed.parts) {
		cost[part.key] = Math.round(part.tokens);
		for (const item of part.items ?? [])
			cost[pairKey(part.key, item.label)] = Math.round(item.tokens);
	}
	return cost;
}

/** A cost map rebuilt from a stored snapshot's costs (millionths of a dollar
 * by part key and by `pairKey(part, item)`), for a map without its trail. */
export function storedCostMap(
	map: ContextMap,
	cost: Readonly<Record<string, number>>,
): ContextMap {
	const byPart = new Map<string, number>();
	const byItem = new Map<string, number>();
	for (const [key, value] of Object.entries(cost))
		(key.includes("\u0000") ? byItem : byPart).set(key, value);
	return remeasured(map, byPart, byItem, (used) => used);
}

/** A stored snapshot's runs by part, as `runsByPart` gives them. */
export function storedPartRuns(
	runs: Readonly<Record<string, readonly number[]>>,
): Map<string, ReadonlySet<number>> {
	return new Map(
		Object.entries(runs).map(([key, at]) => [key, new Set(at)] as const),
	);
}
