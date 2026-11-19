import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { resolveModelPricing } from "@rudel/api-routes/model-pricing";
import { useCallback, useMemo, useState } from "react";
import {
	formatModelDisplayLabel,
	getModelBrandChip,
} from "@/features/dashboard/components/dashboard-model-brand";
import { formatCompactNumber } from "@/lib/format";
import { callContextTokens } from "../context/session-reader-context-fill";
import { formatReaderCost } from "../model/session-reader-model";
import { LANE_LOOK } from "../model/session-reader-step-lanes";
import {
	type SubagentFigures,
	useSubagentFigures,
} from "../subagents/session-reader-subagent-marks";
import { useSubagentsCounted } from "../subagents/session-reader-subagents-counted";
import {
	type AgentFilter,
	Breakdown,
	type BreakdownPart,
} from "../summary/session-reader-breakdown";

type UsageCall = SessionDetailTurnSummary["usageCalls"][number];

const CATEGORIES = [
	{ color: "#F97316", key: "input", label: "Input" },
	{ color: "#FDBA74", key: "cacheRead", label: "Cached input" },
	{ color: "#C2410C", key: "cacheWrite", label: "Cache write" },
	{ color: "#0090FD", key: "output", label: "Output" },
] as const;

const FALLBACK_COLORS = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#64748b"];

function getBreakdownParts(
	calls: readonly UsageCall[],
	model: string | null,
	subagents: readonly SubagentFigures[],
): { byCategory: BreakdownPart[]; byModel: BreakdownPart[] } {
	const byCategory = { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 };
	const byModel = new Map<string, { model: string; value: number }>();
	for (const call of calls) {
		const callModel = call.model ?? model;
		const pricing = resolveModelPricing(callModel, {
			at: call.at,
			contextInputTokens: callContextTokens(call),
		});
		if (!callModel || !pricing) continue;
		const cost = {
			cacheRead:
				(call.cacheReadInputTokens * (pricing.cacheReadPerMTok ?? 0)) / 1e6,
			cacheWrite:
				(call.cacheCreationInputTokens * (pricing.cacheWrite5mPerMTok ?? 0)) /
				1e6,
			input: (call.freshInputTokens * pricing.inputPerMTok) / 1e6,
			output: (call.outputTokens * pricing.outputPerMTok) / 1e6,
		};
		for (const key of Object.keys(cost) as (keyof typeof cost)[])
			byCategory[key] += cost[key];
		const label = formatModelDisplayLabel(callModel);
		const spent = cost.cacheRead + cost.cacheWrite + cost.input + cost.output;
		byModel.set(label, {
			model: callModel,
			value: (byModel.get(label)?.value ?? 0) + spent,
		});
	}
	let subagentCost = 0;
	for (const subagent of subagents) {
		const cost = subagent.estimatedCost ?? 0;
		if (cost <= 0) continue;
		subagentCost += cost;
		const label = subagent.model
			? formatModelDisplayLabel(subagent.model)
			: "Subagents";
		byModel.set(label, {
			model: subagent.model ?? label,
			value: (byModel.get(label)?.value ?? 0) + cost,
		});
	}
	const used = new Set<string>();
	let fallback = 0;
	const models = [...byModel].sort((a, b) => b[1].value - a[1].value);
	return {
		byCategory: [
			...CATEGORIES.map(({ color, key, label }) => ({
				color,
				label,
				value: byCategory[key],
			})),
			{ color: LANE_LOOK.agent.tint, label: "Subagents", value: subagentCost },
		].filter((part) => part.value > 0),
		byModel: models
			.filter(([, { value }]) => value > 0)
			.map(([label, { model: id, value }]) => {
				let color = getModelBrandChip(id)?.tint ?? null;
				if (!color || used.has(color)) {
					color = FALLBACK_COLORS[fallback % FALLBACK_COLORS.length];
					fallback += 1;
				}
				used.add(color);
				return { color, label, value };
			}),
	};
}

export function RunCostBreakdown({
	calls,
	model,
	subagents,
	total,
}: {
	calls: readonly UsageCall[];
	model: string | null;
	subagents: readonly SubagentFigures[];
	total: number | null;
}) {
	const [mode, setMode] = useState<"category" | "model">("category");
	const { byCategory, byModel } = useMemo(
		() => getBreakdownParts(calls, model, subagents),
		[calls, model, subagents],
	);
	const hasCategory = byCategory.length > 1;
	const hasModel = byModel.length > 1;
	if (!hasCategory && !hasModel) return null;
	const active =
		hasCategory && hasModel ? mode : hasCategory ? "category" : "model";
	return (
		<Breakdown
			format={formatReaderCost}
			parts={active === "category" ? byCategory : byModel}
			title="Cost"
			toggle={
				hasCategory && hasModel
					? {
							label: active === "model" ? "by model" : null,
							next: active === "model" ? "by category" : "by model",
							onToggle: () =>
								setMode(active === "model" ? "category" : "model"),
						}
					: undefined
			}
			value={formatReaderCost(total)}
		/>
	);
}

export function RunTokenBreakdown({
	calls,
	subagents,
}: {
	calls: readonly UsageCall[];
	subagents: readonly SubagentFigures[];
}) {
	const parts = useMemo(() => {
		const sums = { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 };
		for (const call of calls) {
			sums.cacheRead += call.cacheReadInputTokens;
			sums.cacheWrite += call.cacheCreationInputTokens;
			sums.input += call.freshInputTokens;
			sums.output += call.outputTokens;
		}
		const subagentTokens = subagents.reduce(
			(sum, subagent) =>
				sum + (subagent.inputTokens ?? 0) + (subagent.outputTokens ?? 0),
			0,
		);
		return [
			...CATEGORIES.map(({ color, key, label }) => ({
				color,
				label,
				value: sums[key],
			})),
			{
				color: LANE_LOOK.agent.tint,
				label: "Subagents",
				value: subagentTokens,
			},
		].filter((part) => part.value > 0);
	}, [calls, subagents]);
	const total = parts.reduce((sum, part) => sum + part.value, 0);
	if (total <= 0) return null;
	return (
		<Breakdown
			format={formatCompactNumber}
			parts={parts}
			title="Tokens"
			value={formatCompactNumber(total)}
		/>
	);
}

const NO_SUBAGENTS: readonly SubagentFigures[] = [];

export function useCountedAgents(turn: SessionDetailTurnSummary) {
	const figures = useSubagentFigures();
	const withSubagents = useSubagentsCounted();
	const counts = useCallback<AgentFilter>(
		(agent) => agent === null || withSubagents,
		[withSubagents],
	);
	const subagents = useMemo(
		() =>
			[
				...new Set(
					(turn.subagentEvents ?? []).flatMap((event) =>
						event.subagentId ? [event.subagentId] : [],
					),
				),
			].flatMap((id) => figures.get(id) ?? []),
		[turn.subagentEvents, figures],
	);
	const cost =
		withSubagents || turn.estimatedCost === null
			? turn.estimatedCost
			: Math.max(
					0,
					turn.estimatedCost -
						subagents.reduce(
							(sum, subagent) => sum + (subagent.estimatedCost ?? 0),
							0,
						),
				);
	return {
		cost,
		counts,
		subagents: withSubagents ? subagents : NO_SUBAGENTS,
		withSubagents,
	};
}
