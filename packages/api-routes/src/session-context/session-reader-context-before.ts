import { formatCompactNumber } from "./format.js";
import { collect, tokensOf } from "./session-reader-context-collect.js";
import type {
	ContextItem,
	ContextMap,
	ContextPart,
} from "./session-reader-context-map.js";
import type { SessionReaderStep } from "./session-reader-run-steps.js";

export function sinceCompaction(steps: readonly SessionReaderStep[]) {
	let cut = -1;
	steps.forEach((step, index) => {
		if (step.harness === "compaction") cut = index;
	});
	return { cut, kept: cut >= 0 ? steps.slice(cut + 1) : steps };
}

export const COMPACTION_SUMMARY = "Compaction summary";

export type ContextRuns = {
	prompts: readonly string[];
	steps: readonly SessionReaderStep[];
};

function partsIn(
	prompts: readonly string[],
	steps: readonly SessionReaderStep[],
	label: string,
	tokens: number,
): ContextPart[] {
	const { estimated, things } = collect(prompts, steps);
	const sum = estimated.reduce((total, part) => total + part.tokens, 0);
	if (sum === 0 || tokens <= 0) return [];
	const scale = tokens / sum;
	const parts = estimated.map((part) => ({
		...part,
		before: label,
		items: [...(things.get(part.key)?.values() ?? [])]
			.map((item) => ({ ...item, tokens: Math.round(item.tokens * scale) }))
			.sort((a, b) => b.tokens - a.tokens),
		key: `earlier:${part.key}`,
		tokens: Math.round(part.tokens * scale),
	}));
	const first = parts[0];
	if (first)
		first.tokens +=
			tokens - parts.reduce((total, part) => total + part.tokens, 0);
	return parts;
}

function compactedBy(
	steps: readonly SessionReaderStep[],
	runs: ContextRuns,
): (ContextRuns & { at: SessionReaderStep }) | null {
	const all = [...sinceCompaction(runs.steps).kept, ...steps];
	const cuts = all.flatMap((step, index) =>
		step.harness === "compaction" ? [index] : [],
	);
	const last = cuts.at(-1);
	const at = last === undefined ? undefined : all[last];
	if (last === undefined || !at) return null;
	return {
		at,
		prompts: runs.prompts,
		steps: all.slice((cuts.at(-2) ?? -1) + 1, last),
	};
}

const summaryTokens = (step: SessionReaderStep | undefined) =>
	tokensOf(step?.compaction?.summary ?? step?.text);

function compactedOf(
	material: (ContextRuns & { at: SessionReaderStep }) | null,
	system: number,
): Pick<ContextPart, "compacted" | "items" | "note"> {
	if (!material) return {};
	const { estimated, things } = collect(material.prompts, material.steps);
	const sum = estimated.reduce((total, part) => total + part.tokens, 0);
	if (sum === 0) return {};
	const measured = material.at.compaction?.beforeTokens;
	const whole =
		measured !== undefined ? Math.max(0, measured - system) || sum : sum;
	const items = estimated.map(
		(part): ContextItem => ({
			count: part.count,
			label: part.files ? `${part.label} · ${part.files}` : part.label,
			tokens: Math.round((part.tokens * whole) / sum),
		}),
	);
	const scale = whole / sum;
	return {
		compacted: estimated.map((part) => ({
			...part,
			items: [...(things.get(part.key)?.values() ?? [])]
				.map((item) => ({ ...item, tokens: Math.round(item.tokens * scale) }))
				.sort((a, b) => b.tokens - a.tokens),
			key: `compacted:${part.key}`,
			tokens: Math.round(part.tokens * scale),
		})),
		items,
		note: `What it compacted${
			measured !== undefined
				? ` — ${formatCompactNumber(whole)} besides the system prompt and tools —`
				: ""
		} at the size it was then.`,
	};
}

export function partsBefore(
	runs: ContextRuns,
	compacted: ContextRuns | null | undefined,
	label: string,
	tokens: number,
	system: number,
): ContextPart[] {
	const { cut, kept } = sinceCompaction(runs.steps);
	const summary = cut >= 0 ? summaryTokens(runs.steps[cut]) : 0;
	const keptSum = collect(runs.prompts, kept).estimated.reduce(
		(total, part) => total + part.tokens,
		0,
	);
	const left = cut >= 0 ? runs.steps[cut]?.compaction?.afterTokens : undefined;
	if (keptSum + summary === 0 && left === undefined) return [];
	const summaryShare =
		cut >= 0 && keptSum === 0
			? tokens
			: left !== undefined
				? Math.min(tokens, left)
				: Math.round((tokens * summary) / (keptSum + summary));
	const own = partsIn(runs.prompts, kept, label, tokens - summaryShare);
	if (summaryShare <= 0) return own;
	return [
		...own,
		{
			before: label,
			count: 1,
			key: "earlier:summary",
			kind: "summary",
			label: COMPACTION_SUMMARY,
			tokens: summaryShare,
			...compactedOf(
				compacted ? compactedBy(runs.steps, compacted) : null,
				system,
			),
		},
	];
}

export function compactedSummary(
	steps: readonly SessionReaderStep[],
	earlierRuns: ContextRuns | null | undefined,
	compacted: ContextRuns | null | undefined,
	system: number,
): Pick<ContextPart, "compacted" | "items" | "note"> {
	if (!compacted) return {};
	const material = compactedBy(
		[...(earlierRuns?.steps ?? []), ...steps],
		compacted,
	);
	return compactedOf(
		material && {
			...material,
			prompts: [...material.prompts, ...(earlierRuns?.prompts ?? [])],
		},
		system,
	);
}

export function withCompacted(map: ContextMap): ContextMap {
	if (!map.parts.some((part) => part.compacted?.length)) return map;
	const parts = map.parts.flatMap((part) =>
		part.compacted?.length
			? part.compacted.map((each) => ({
					...each,
					before: `Compacted into ${formatCompactNumber(part.tokens)}`,
				}))
			: [part],
	);
	const used = parts.reduce((total, part) => total + part.tokens, 0);
	return { ...map, parts, used, window: map.window + used - map.used };
}
