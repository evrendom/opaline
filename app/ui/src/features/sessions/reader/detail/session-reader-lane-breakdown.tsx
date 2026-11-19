import { useMemo } from "react";
import { formatCompactNumber } from "@/lib/format";
import { isAgentStep } from "../ci/session-reader-run-ci";
import type {
	SessionReaderStep,
	SessionReaderWaterfall,
} from "../model/session-reader-model";
import {
	chipLaneKey,
	LANE_LOOK,
	LANES,
} from "../model/session-reader-step-lanes";
import { subagentIdOf } from "../subagents/session-reader-agent-focus";
import {
	type AgentFilter,
	Breakdown,
	type BreakdownPart,
} from "../summary/session-reader-breakdown";
import { type Interval, unionMs } from "./session-reader-run-overview";
import { formatSpanDuration } from "./waterfall/session-reader-waterfall-chips";

const LANE_PARTS = 5;

function getLaneParts(
	waterfall: SessionReaderWaterfall,
	counts: AgentFilter,
): {
	steps: number;
	stepParts: BreakdownPart[];
	timeParts: BreakdownPart[];
} {
	const groups = new Map<
		string,
		{ color: string; intervals: Interval[]; label: string; steps: number }
	>();
	const group = (key: string, label: string, color: string) => {
		const found = groups.get(key);
		if (found) return found;
		const created = { color, intervals: [], label, steps: 0 };
		groups.set(key, created);
		return created;
	};
	const model = () => group("model", "Model", LANE_LOOK.model.tint);
	const all: Interval[] = [];
	const add = (step: SessionReaderStep) => {
		const target = laneGroup(step, group);
		target.steps += 1;
		const from =
			target === groups.get("model")
				? step.startMs
				: (step.writtenUntilMs ?? step.queuedUntilMs ?? step.startMs);
		const end = Math.min(step.endMs, waterfall.endMs);
		if (end > from) target.intervals.push([from, end]);
		if (step.writtenUntilMs !== undefined && step.writtenUntilMs > step.startMs)
			model().intervals.push([step.startMs, step.writtenUntilMs]);
	};
	const visit = (steps: readonly SessionReaderStep[], owner: string | null) => {
		for (const step of steps) {
			if (!isAgentStep(step) || step.harness === "notification") continue;
			const subagent = subagentIdOf(step);
			if (subagent && counts(subagent) && step.children.length > 0) {
				if (counts(owner)) laneGroup(step, group).steps += 1;
				visit(step.children, subagent);
			} else if ((subagent && counts(subagent)) || counts(owner)) add(step);
		}
	};
	visit(waterfall.steps, null);
	for (const { intervals } of groups.values()) all.push(...intervals);
	const groupsOf = [...groups.values()];
	const idle = Math.max(0, waterfall.endMs - waterfall.startMs - unionMs(all));
	const timeParts = topParts(
		groupsOf.map(({ color, intervals, label }) => ({
			color,
			label,
			value: unionMs(intervals),
		})),
	);
	return {
		steps: groupsOf.reduce((sum, { steps }) => sum + steps, 0),
		stepParts: topParts(
			groupsOf.map(({ color, label, steps }) => ({
				color,
				label,
				value: steps,
			})),
		),
		timeParts:
			idle > 0
				? [
						...timeParts,
						{ color: "var(--color-zinc-300)", label: "Idle", value: idle },
					]
				: timeParts,
	};
}

function topParts(parts: readonly BreakdownPart[]): BreakdownPart[] {
	const ranked = parts
		.filter((part) => part.value > 0)
		.sort((a, b) => b.value - a.value);
	const rest = ranked.slice(LANE_PARTS);
	return rest.length > 0
		? [
				...ranked.slice(0, LANE_PARTS),
				{
					color: "var(--color-slate-400)",
					label: "Other",
					value: rest.reduce((sum, part) => sum + part.value, 0),
				},
			]
		: ranked;
}

function laneGroup(
	step: SessionReaderStep,
	group: (
		key: string,
		label: string,
		color: string,
	) => { color: string; intervals: Interval[]; label: string; steps: number },
) {
	if (step.waitsOnYou || step.harness === "member")
		return group("you", "Waiting on you", LANE_LOOK.you.tint);
	if (step.harness === "compaction")
		return group("compaction", "Compacting", "var(--color-green-500)");
	const key = chipLaneKey(step);
	const lane = LANES.find((candidate) => candidate.key === key);
	return group(key, lane?.label ?? key, LANE_LOOK[key].tint);
}

export function RunTimeBreakdown({
	counts,
	waterfall,
}: {
	counts: AgentFilter;
	waterfall: SessionReaderWaterfall;
}) {
	const { timeParts } = useMemo(
		() => getLaneParts(waterfall, counts),
		[waterfall, counts],
	);
	if (timeParts.length === 0) return null;
	return (
		<Breakdown
			format={formatSpanDuration}
			parts={timeParts}
			title="Time"
			value={formatSpanDuration(
				Math.max(waterfall.endMs - waterfall.startMs, 0),
			)}
		/>
	);
}

export function RunStepBreakdown({
	counts,
	waterfall,
}: {
	counts: AgentFilter;
	waterfall: SessionReaderWaterfall;
}) {
	const { stepParts, steps } = useMemo(
		() => getLaneParts(waterfall, counts),
		[waterfall, counts],
	);
	if (stepParts.length === 0) return null;
	return (
		<Breakdown
			format={formatCompactNumber}
			parts={stepParts}
			title="Steps"
			value={formatCompactNumber(steps)}
		/>
	);
}
