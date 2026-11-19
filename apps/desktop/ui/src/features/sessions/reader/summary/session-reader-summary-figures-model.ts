import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import {
	IconClockFilled,
	IconCoinFilled,
	IconHexagonFilled,
	IconMessagesFilled,
} from "@tabler/icons-react";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import {
	countFigure,
	formatCompactNumber,
	roundedDurationFigure,
	unitFigure,
} from "@/lib/format";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import { ContextMark } from "../context/session-reader-context-bar";
import { getContextUseFill } from "../context/session-reader-context-fill";
import type { ContextMeasure } from "../context/session-reader-context-measure";
import { fullestCall } from "../context/session-reader-context-runs";
import { readerCostFigure } from "../model/session-reader-model";
import type { SummaryFigure } from "./session-reader-summary-figures";

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

function nearestWindow(
	turns: readonly SessionDetailTurnSummary[],
	turn: SessionDetailTurnSummary,
): number | null {
	const at = turns.indexOf(turn);
	if (at < 0) return null;
	for (let step = 1; step < turns.length; step++)
		for (const index of [at - step, at + step]) {
			for (const call of turns[index]?.usageCalls ?? []) {
				const fill = getContextUseFill({
					model: call.model,
					tokens: 1,
					window: call.contextWindow,
				});
				if (fill) return fill.window;
			}
		}
	return null;
}

function contextFigure(
	fill: ReturnType<typeof getContextUseFill>,
	tokens: number,
	called = true,
	window: number | null = null,
): SummaryFigure {
	if (!called)
		return {
			...CONTEXT,
			detail: "It ended before its first model call",
			valueTip: window ? `0 / ${formatCompactNumber(window)}` : undefined,
			value: window ? [unitFigure(0, "%")] : ["—"],
		};
	return {
		...CONTEXT,
		detail: `${
			fill
				? `${formatCompactNumber(fill.tokens)} of a ${formatCompactNumber(fill.window)} window, at its fullest`
				: "Its model's window isn't known"
		} · ${formatCompactNumber(tokens)} tokens in all`,
		valueTip: fill
			? `${formatCompactNumber(fill.tokens)} / ${formatCompactNumber(fill.window)}`
			: undefined,
		value: fill ? [unitFigure(Math.round(fill.share * 100), "%")] : ["—"],
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
): SummaryFigure[] {
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
			value: readerCostFigure(session.estimatedCost),
		},
		{
			...DURATION,
			detail: startedAt(session.sessionDate),
			label: "Duration",
			value: roundedDurationFigure(session.durationMinutes ?? undefined),
		},
		contextFigure(fill, session.totalTokens),
		{
			detail: `${subagentCount} ${subagentCount === 1 ? "subagent" : "subagents"}`,
			icon: IconMessagesFilled,
			label: "Turns",
			measure: "runs",
			tint: "text-emerald-500",
			value: countFigure(totalTurns),
		},
	];
}

export function runFigures(
	turn: SessionDetailTurnSummary,
	turns: readonly SessionDetailTurnSummary[] = [],
): SummaryFigure[] {
	const tokens = (turn.inputTokens ?? 0) + (turn.outputTokens ?? 0);
	const called = turn.usageCalls.length > 0 || turn.estimatedCost !== null;
	return [
		{
			...COST,
			detail: called
				? tokensDetail(turn.inputTokens, turn.outputTokens)
				: "No model call",
			label: "Cost",
			value: readerCostFigure(called ? turn.estimatedCost : 0),
		},
		{
			...DURATION,
			detail: turn.startedAt ? startedAt(turn.startedAt) : "",
			label: "Duration",
			value: roundedDurationFigure(
				turn.durationSeconds === null ? undefined : turn.durationSeconds / 60,
			),
		},
		contextFigure(
			((call) => call && getContextUseFill(call))(fullestCall(turn)),
			tokens,
			called,
			called ? null : nearestWindow(turns, turn),
		),
	];
}

export function subagentFigures(
	subagent: NonNullable<NormalizedSessionDetailOverview["subagents"]>[number],
): SummaryFigure[] {
	return [
		{
			...COST,
			detail: tokensDetail(subagent.inputTokens, subagent.outputTokens),
			label: "Cost",
			value: readerCostFigure(subagent.estimatedCost),
		},
		{
			...DURATION,
			detail: "From its launch to its answer",
			label: "Duration",
			value: roundedDurationFigure(
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
			value: [subagent.model ? formatModelDisplayLabel(subagent.model) : "—"],
		},
	];
}
