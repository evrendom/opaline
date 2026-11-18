import { IconMessage, IconMessageCheck } from "@tabler/icons-react";
import { createContext, useContext } from "react";
import { TraceBrainIcon } from "@/components/conversation/conversation-trace-glyphs";
import type {
	SessionReaderStep,
	SessionReaderWaterfall,
} from "../model/session-reader-model";
import { flattenSteps } from "../model/session-reader-run-steps";
import {
	LANE_LOOK,
	type LaneLook,
	railTagKeysOf,
} from "../model/session-reader-step-lanes";

export type ReaderPart = {
	key: "messages" | "prompts" | "responses" | "thinking" | "toolCalls";
	label: string;
} & LaneLook;

export const READER_PARTS: readonly ReaderPart[] = [
	{
		key: "prompts",
		label: "Prompts",
		...LANE_LOOK.you,
	},
	{ key: "thinking", label: "Thinking", ...LANE_LOOK.model },
	{
		key: "messages",
		label: "Messages",
		glyph: IconMessage,
		tint: "var(--color-zinc-400)",
	},
	{
		key: "toolCalls",
		label: "Reasoning Trace",
		glyph: TraceBrainIcon,
		tint: "var(--color-violet-500)",
	},
	{
		key: "responses",
		label: "Responses",
		glyph: IconMessageCheck,
		tint: "var(--color-violet-400)",
	},
];

export const OTHER_CALLS = "otherCalls";

export const ReaderHiddenContext = createContext<ReadonlySet<string>>(
	new Set(),
);

export function useReaderHidden(): ReadonlySet<string> {
	return useContext(ReaderHiddenContext);
}

function keepsStep(step: SessionReaderStep, hidden: ReadonlySet<string>) {
	if (hidden.has("toolCalls")) return false;
	if (step.kind === "thinking") return !hidden.has("thinking");
	if (step.kind === "message") return !hidden.has("messages");
	const tags = railTagKeysOf(step);
	if (tags.length === 0) return !hidden.has(OTHER_CALLS);
	return tags.some((tag) => !hidden.has(tag));
}

function keptSteps(
	steps: readonly SessionReaderStep[],
	hidden: ReadonlySet<string>,
): SessionReaderStep[] {
	return steps.flatMap((step) => {
		if (!keepsStep(step, hidden)) return [];
		if (step.children.length === 0) return [step];
		return [{ ...step, children: keptSteps(step.children, hidden) }];
	});
}

export function withoutHiddenSteps(
	waterfall: SessionReaderWaterfall,
	hidden: ReadonlySet<string>,
): SessionReaderWaterfall | null {
	if (hidden.size === 0) return waterfall;
	const steps = keptSteps(waterfall.steps, hidden);
	if (steps.length === 0) return null;
	return { ...waterfall, allSteps: flattenSteps(steps), steps };
}
