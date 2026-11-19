import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { shortRunId } from "@/features/sessions/run-id";
import { promptLabelOf, tokensOf } from "./session-reader-context-collect";
import type {
	ContextItem,
	ContextKind,
	ContextMap,
	ContextPart,
	RunPart,
	RunThing,
} from "./session-reader-context-map";

export const thingKey = (part: string, label: string) =>
	`${part}\u0000${label}`;

type RunStart = Pick<SessionDetailTurnSummary, "startedAt" | "turnId">;

const ownKey = (key: string) => key.replace(/^(?:compacted|earlier):/u, "");

export function placeOf(
	map: Pick<ContextMap, "trail">,
	runs: readonly RunStart[],
	part: Pick<ContextPart, "folded" | "key" | "nested">,
	label: string | null,
): { run: string; step: string | null } | null {
	if (part.key.startsWith("run:")) {
		const run = part.key.slice("run:".length);
		const nested = label
			? part.nested?.find((each) => each.label === label)
			: undefined;
		return { run, step: nested?.things[0]?.steps[0] ?? null };
	}
	const keys = new Set((part.folded ?? [part.key]).map(ownKey));
	const inPart = map.trail.filter(
		(step) => step.id && keys.has(ownKey(step.key)),
	);
	const step =
		(label === null
			? undefined
			: inPart.find((each) => each.items.includes(label))) ?? inPart[0];
	if (!step?.id) return null;
	let at = runs[0];
	for (const run of runs)
		if (run.startedAt && Date.parse(run.startedAt) <= step.start) at = run;
	return at ? { run: at.turnId, step: step.id } : null;
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

export function byRunMap(
	map: ContextMap,
	runs: readonly Pick<SessionDetailTurnSummary, "startedAt" | "turnId">[],
	prompts: readonly string[],
): ContextMap {
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
	const own = runs.map(() => new Map<string, number>());
	const things = runs.map(() => new Map<string, Map<string, RunThing>>());
	const add = (index: number, key: string, tokens: number) => {
		const of = own[index];
		if (of) of.set(key, (of.get(key) ?? 0) + tokens);
	};
	const addThing = (
		index: number,
		key: string,
		label: string,
		tokens: number,
		step: string | undefined,
	) => {
		const inRun = things[index];
		if (!inRun) return;
		const inPart = inRun.get(key) ?? new Map<string, RunThing>();
		inRun.set(key, inPart);
		const thing = inPart.get(label) ?? { label, steps: [], tokens: 0 };
		thing.tokens += tokens;
		if (step && !thing.steps.includes(step)) thing.steps.push(step);
		inPart.set(label, thing);
	};
	for (const step of map.trail) {
		const at = runAt(step.start);
		add(at, step.key, step.tokens);
		for (const item of step.items)
			addThing(
				at,
				step.key,
				item,
				step.tokens / Math.max(1, step.items.length),
				step.id,
			);
	}
	const you = map.parts.find((part) => part.key === "you");
	const weights = prompts.map((prompt) => tokensOf(prompt));
	const weight = weights.reduce((sum, each) => sum + each, 0);
	if (you && weight > 0)
		weights.forEach((each, index) => {
			add(index, "you", (you.tokens * each) / weight);
			addThing(
				index,
				"you",
				promptLabelOf(prompts[index]),
				(you.tokens * each) / weight,
				undefined,
			);
		});
	const partOf = new Map(map.parts.map((part) => [part.key, part]));
	const runParts = runs.flatMap((run, index): ContextPart[] => {
		const items = [...(own[index] ?? [])]
			.map(([key, tokens]) => ({
				count: 1,
				kind: partOf.get(key)?.kind,
				label: partOf.get(key)?.label ?? key,
				tokens: Math.round(tokens),
			}))
			.filter((item) => item.tokens > 0)
			.sort((a, b) => b.tokens - a.tokens);
		const tokens = items.reduce((sum, item) => sum + item.tokens, 0);
		if (tokens === 0) return [];
		const nested = [...(own[index] ?? [])]
			.map(([key, partTokens]): RunPart => {
				const part = partOf.get(key);
				return {
					key,
					kind: part?.kind ?? "tools",
					label: part?.label ?? key,
					things: [...(things[index]?.get(key)?.values() ?? [])]
						.map((thing) => ({ ...thing, tokens: Math.round(thing.tokens) }))
						.filter((thing) => thing.tokens > 0)
						.sort((a, b) => b.tokens - a.tokens),
					tokens: Math.round(partTokens),
				};
			})
			.filter((part) => part.tokens > 0)
			.sort((a, b) => b.tokens - a.tokens);
		return [
			{
				count: items.length,
				items: items.map(({ kind: _kind, ...item }): ContextItem => item),
				nested,
				key: `run:${run.turnId}`,
				run: { model: map.model, subagent: false },
				kind: items[0]?.kind ?? ("model" satisfies ContextKind),
				label: shortRunId(run.turnId),
				tokens,
			},
		];
	});
	const traced = new Set(map.trail.map((step) => step.key));
	const kept = map.parts.filter(
		(part) => part.key !== "you" && !traced.has(part.key),
	);
	const parts = [...runParts, ...kept].sort((a, b) => b.tokens - a.tokens);
	const used = parts.reduce((sum, part) => sum + part.tokens, 0);
	return {
		...map,
		parts,
		trail: [],
		used,
		window: Math.max(used, map.window),
	};
}
