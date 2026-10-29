import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import {
	IconClockFilled,
	IconCoinFilled,
	IconHexagonFilled,
	IconMessagesFilled,
} from "@tabler/icons-react";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { formatCompactNumber, formatRoundedDuration } from "@/lib/format";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import { ContextMark } from "../context/session-reader-context-bar";
import { getContextUseFill } from "../context/session-reader-context-fill";
import type { ContextMeasure } from "../context/session-reader-context-measure";
import { fullestCall } from "../context/session-reader-context-runs";
import { formatReaderCost } from "../model/session-reader-model";
import type { SummaryFigure } from "./session-reader-summary-figures";

type Figure = SummaryFigure;

const tokensDetail = (
	input: number | null | undefined,
	output: number | null | undefined,
) =>
	`${formatCompactNumber(input ?? 0)} in · ${formatCompactNumber(output ?? 0)} out`;

const COST = {
	icon: IconCoinFilled,
	measure: "cost",
	tint: "text-amber-400 dark:text-yellow-500",
} as const;
const DURATION = {
	icon: IconClockFilled,
	measure: "time",
	tint: "text-sky-400 dark:text-sky-500",
} as const;
const CONTEXT = {
	icon: ContextMark,
	label: "Context window",
	shortLabel: "Context",
	measure: "context",
	tint: "text-[rgba(0,96,226,0.765)] dark:text-[#6aa6ff]",
} as const;

function contextFigure(
	fill: ReturnType<typeof getContextUseFill>,
	tokens: number,
): Figure {
	return {
		...CONTEXT,
		detail: `${
			fill
				? `${formatCompactNumber(fill.tokens)} of a ${formatCompactNumber(fill.window)} window, at its fullest`
				: "Its model's window isn't known"
		} · ${formatCompactNumber(tokens)} tokens in all`,
		note: fill
			? `${formatCompactNumber(fill.tokens)} / ${formatCompactNumber(fill.window)}`
			: undefined,
		value: fill ? `${Math.round(fill.share * 100)}%` : "—",
	};
}

export const ACCENT: Record<ContextMeasure, string> = {
	context: "rgb(0 96 226)",
	cost: "var(--color-amber-400)",
	runs: "var(--color-emerald-500)",
	time: "var(--color-sky-400)",
};

const startedAt = (at: string) =>
	`Started ${new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;

export function sessionFigures(
	session: NormalizedSessionDetailOverview["session"],
	turns: readonly SessionDetailTurnSummary[],
	totalTurns: number,
	subagentCount: number,
): Figure[] {
	let fullest: ReturnType<typeof fullestCall> = null;
	for (const turn of turns) {
		const call = fullestCall(turn);
		if (call && (!fullest || call.share > fullest.share)) fullest = call;
	}
	const fill = fullest && getContextUseFill(fullest);
	const tokens =
		turns.length >= totalTurns
			? {
					inputTokens: turns.reduce(
						(sum, turn) => sum + (turn.inputTokens ?? 0),
						0,
					),
					outputTokens: turns.reduce(
						(sum, turn) => sum + (turn.outputTokens ?? 0),
						0,
					),
				}
			: session;
	return [
		{
			...COST,
			detail: tokensDetail(tokens.inputTokens, tokens.outputTokens),
			label: "Cost",
			value: formatReaderCost(session.estimatedCost),
		},
		{
			...DURATION,
			detail: startedAt(session.sessionDate),
			label: "Duration",
			value: formatRoundedDuration(session.durationMinutes ?? undefined),
		},
		contextFigure(fill, session.totalTokens),
		{
			detail: `${subagentCount} ${subagentCount === 1 ? "subagent" : "subagents"}`,
			icon: IconMessagesFilled,
			label: "Turns",
			measure: "runs",
			tint: "text-emerald-500",
			value: totalTurns.toLocaleString(),
		},
	];
}

export function runFigures(turn: SessionDetailTurnSummary): Figure[] {
	const tokens = (turn.inputTokens ?? 0) + (turn.outputTokens ?? 0);
	return [
		{
			...COST,
			detail: tokensDetail(turn.inputTokens, turn.outputTokens),
			label: "Cost",
			value: formatReaderCost(turn.estimatedCost),
		},
		{
			...DURATION,
			detail: turn.startedAt ? startedAt(turn.startedAt) : "",
			label: "Duration",
			value: formatRoundedDuration(
				turn.durationSeconds === null ? undefined : turn.durationSeconds / 60,
			),
		},
		contextFigure(
			((call) => call && getContextUseFill(call))(fullestCall(turn)),
			tokens,
		),
	];
}

export function subagentFigures(
	subagent: NonNullable<NormalizedSessionDetailOverview["subagents"]>[number],
): Figure[] {
	return [
		{
			...COST,
			detail: tokensDetail(subagent.inputTokens, subagent.outputTokens),
			label: "Cost",
			value: formatReaderCost(subagent.estimatedCost),
		},
		{
			...DURATION,
			detail: "From its launch to its answer",
			label: "Duration",
			value: formatRoundedDuration(
				typeof subagent.durationSeconds === "number"
					? subagent.durationSeconds / 60
					: undefined,
			),
		},
		contextFigure(
			subagent.context ? getContextUseFill(subagent.context) : null,
			subagent.totalTokens ?? 0,
		),
		{
			detail: "The model it ran on",
			icon: IconHexagonFilled,
			label: "Model",
			tint: "text-muted-foreground",
			value: subagent.model ? formatModelDisplayLabel(subagent.model) : "—",
		},
	];
}
