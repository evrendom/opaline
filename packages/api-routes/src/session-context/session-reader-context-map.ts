import {
	COMPACTION_SUMMARY,
	type ContextRuns,
	compactedSummary,
	partsBefore,
	sinceCompaction,
} from "./session-reader-context-before.js";
import { CHARS_PER_TOKEN, collect } from "./session-reader-context-collect.js";
import { getContextUseFill } from "./session-reader-context-fill.js";
import type { SessionReaderStep } from "./session-reader-run-steps.js";
import type { LaneKey } from "./session-reader-step-lanes.js";

export type ContextKind = LaneKey | "context" | "earlier" | "summary" | "you";

export type ContextPart = {
	count: number;
	key: string;
	kind: ContextKind;
	label: string;
	tokens: number;
	files?: number;
	parts?: number;
	folded?: string[];
	items?: ContextItem[];
	nested?: RunPart[];
	run?: { model: string | null; subagent: boolean };
	note?: string;
	compacted?: ContextPart[];
	before?: string;
};

export type ContextItem = { count: number; label: string; tokens: number };

export type RunPart = {
	key: string;
	kind: ContextKind;
	label: string;
	things: RunThing[];
	tokens: number;
};

export type RunThing = { label: string; steps: string[]; tokens: number };

export type ContextMap = {
	compacted: boolean;
	estimate: { scale: number; text: number };
	model: string | null;
	parts: ContextPart[];
	trail: ContextStep[];
	until: number | null;
	used: number;
	window: number;
};

export type ContextStep = {
	end: number;
	id?: string;
	items: readonly string[];
	key: string;
	start: number;
	tokens: number;
	waited: number;
	written: number;
};

const MOST_PER_CHAR = 3;

function inCall(step: SessionReaderStep, until: number | null) {
	if (until === null) return true;
	return step.kind === "message" || step.kind === "thinking"
		? step.endMs < until
		: step.startMs < until;
}

export function getContextMap({
	baseline,
	compacted,
	earlier,
	earlierRuns,
	firstInput,
	setup,
	prompt,
	steps,
	until,
	use,
}: {
	baseline: number | null;
	compacted?: ContextRuns | null;
	setup?: readonly { chars: number; key: string; label: string }[];
	earlier: string | null;
	earlierRuns?: ContextRuns | null;
	firstInput?: number | null;
	prompt: string | readonly string[] | null;
	steps: readonly SessionReaderStep[];
	until: number | null;
	use: { model: string | null; tokens: number; window: number | null };
}): ContextMap | null {
	const fill = getContextUseFill(use);
	if (!fill) return null;
	const inWindow = steps.filter((step) => inCall(step, until));
	const { cut, kept: own } = sinceCompaction(inWindow);
	const before = cut >= 0 ? COMPACTION_SUMMARY : earlier;
	const { estimated, promptTokens, things, trail } = collect(prompt, own);
	const used = fill.tokens;
	const texts = (setup ?? [])
		.map((text) => ({
			count: 1,
			key: `setup:${text.key}`,
			kind: "context" as const,
			label: text.label,
			note: `${text.chars.toLocaleString("en")} characters, as the run received it.`,
			tokens: Math.ceil(text.chars / CHARS_PER_TOKEN),
		}))
		.filter((text) => text.tokens > 0);
	const textSum = texts.reduce((total, text) => total + text.tokens, 0);
	const system = Math.min(used, Math.max(0, baseline ?? textSum));
	const left = cut >= 0 ? inWindow[cut]?.compaction?.afterTokens : undefined;
	const measuredBefore =
		before && cut < 0 && firstInput !== null && firstInput !== undefined
			? Math.min(used - system, Math.max(0, firstInput - system - promptTokens))
			: before && left !== undefined
				? Math.min(used - system, left)
				: null;
	const room = used - system - (measuredBefore ?? 0);
	const sum = estimated.reduce((total, part) => total + part.tokens, 0);
	const fills = measuredBefore !== null || !before;
	const scale = sum === 0 ? 1 : fills || sum > room ? room / sum : 1;
	for (const entry of trail) entry.tokens *= scale;
	const perChar =
		fills && sum > 0 ? Math.min(MOST_PER_CHAR, Math.max(1, scale)) : 1;
	for (const text of texts) text.tokens = Math.round(text.tokens * perChar);
	const textTokens = texts.reduce((total, text) => total + text.tokens, 0);
	for (const part of estimated) {
		part.tokens = Math.round(part.tokens * scale);
		part.items = [...(things.get(part.key)?.values() ?? [])]
			.map((item) => ({ ...item, tokens: Math.round(item.tokens * scale) }))
			.sort((a, b) => b.tokens - a.tokens);
	}
	const ownTokens = Math.round(sum * scale);
	const parts = [...estimated];
	const beforeTokens =
		measuredBefore ?? (before ? Math.max(0, room - ownTokens) : 0);
	const beforeParts =
		before && cut < 0 && beforeTokens > 0 && earlierRuns
			? partsBefore(earlierRuns, compacted, before, beforeTokens, system)
			: [];
	if (beforeParts.length > 0) parts.push(...beforeParts);
	else if (before && beforeTokens > 0)
		parts.push({
			count: 1,
			key: "earlier",
			kind: cut >= 0 ? "summary" : "earlier",
			label: before,
			note:
				measuredBefore === null
					? "What the run's own parts leave of what the model was sent."
					: cut >= 0
						? "Measured: what the compaction left, as the harness recorded it."
						: "Measured: the run's first call, less the system prompt and tools and its prompt.",
			tokens: beforeTokens,
			...(cut >= 0
				? compactedSummary(inWindow, earlierRuns, compacted, system)
				: {}),
		});
	const systemTokens = system + (sum === 0 && !before ? room : 0);
	const fit =
		textTokens > systemTokens ? systemTokens / Math.max(textTokens, 1) : 1;
	for (const text of texts) text.tokens = Math.round(text.tokens * fit);
	parts.push(...texts);
	const unsaid =
		systemTokens - texts.reduce((total, text) => total + text.tokens, 0);
	if (unsaid > 0)
		parts.push({
			count: 1,
			key: "system",
			kind: "context",
			label:
				texts.length > 0
					? "Tool definitions & the rest"
					: "System prompt & tools",
			note:
				texts.length > 0
					? "Measured from the session's smallest input, less the setup texts: the tools' definitions, and what the harness doesn't record."
					: "Measured from the session's smallest input, less its first prompt.",
			tokens: unsaid,
		});
	parts.sort((a, b) => b.tokens - a.tokens);
	return {
		compacted: cut >= 0,
		estimate: { scale, text: sum },
		model: fill.model,
		parts: parts.filter((part) => part.tokens > 0),
		trail,
		until,
		used,
		window: fill.window,
	};
}
