import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { resolveModelPricing } from "@rudel/api-routes/model-pricing";
import { formatCompactNumber, formatShare } from "@/lib/format";
import { callContextTokens } from "../context/session-reader-context-fill";
import {
	formatReaderCost,
	type SessionReaderStep,
	type SessionReaderWaterfall,
} from "../model/session-reader-model";
import { stepLaneLook } from "../model/session-reader-step-lanes";
import {
	formatSpanDuration,
	Tip,
} from "./waterfall/session-reader-waterfall-chips";

type UsageCall = SessionDetailTurnSummary["usageCalls"][number];

export function findStepCall(
	step: SessionReaderStep,
	turn: SessionDetailTurnSummary,
	waterfall: SessionReaderWaterfall,
): UsageCall | null {
	if (turn.activityResolution !== "exact") return null;
	if (!waterfall.steps.includes(step)) return null;
	const at =
		step.kind === "thinking" || step.kind === "message"
			? step.endMs
			: (step.writtenUntilMs ?? step.startMs);
	let found: UsageCall | null = null;
	let foundMs = Number.NEGATIVE_INFINITY;
	for (const call of turn.usageCalls) {
		const ms = Date.parse(call.at);
		if (Number.isFinite(ms) && ms <= at && ms >= foundMs) {
			found = call;
			foundMs = ms;
		}
	}
	return found;
}

function callTokens(call: UsageCall): number {
	return callContextTokens(call) + call.outputTokens;
}

function callCost(call: UsageCall, model: string | null): number | null {
	const pricing = resolveModelPricing(call.model ?? model, {
		at: call.at,
		contextInputTokens: callTokens(call) - call.outputTokens,
	});
	if (!pricing) return null;
	return (
		(call.freshInputTokens * pricing.inputPerMTok +
			call.cacheReadInputTokens * (pricing.cacheReadPerMTok ?? 0) +
			call.cacheCreationInputTokens * (pricing.cacheWrite5mPerMTok ?? 0) +
			call.outputTokens * pricing.outputPerMTok) /
		1e6
	);
}

function StepFigure({
	color,
	note,
	share,
	title,
	value,
}: {
	color: string;
	note: string;
	share: number | null;
	title: string;
	value: string | null;
}) {
	const fill = share === null ? 0 : Math.min(Math.max(share, 0), 1);
	return (
		<Tip
			label={
				share === null
					? `${note}: not known for this step`
					: `${note}: ${formatShare(fill)} of the run's`
			}
		>
			<div className="flex min-w-0 flex-col gap-xs">
				<span className="truncate text-body-m text-ink-3">{title}</span>
				{/* design-escape-ok(type): deliberate exception, 13/16 keeps the figure row dense; body-l's 20px line grows it */}
				<span className="flex min-w-0 items-baseline gap-s text-[13px]/4 tabular-nums">
					<span className="truncate text-ink">{value ?? "—"}</span>
					{share === null ? null : (
						// design-escape-ok(opacity): shipped value; muted-foreground/70
						<span className="shrink-0 text-body-s text-ink-3/70">
							{formatShare(fill)}
						</span>
					)}
				</span>
				<span className="relative h-1 overflow-hidden corner-full bg-wash">
					<span
						className="absolute inset-y-0 left-0 corner-full"
						style={{ backgroundColor: color, width: `${fill * 100}%` }}
					/>
				</span>
			</div>
		</Tip>
	);
}

export function StepBreakdowns({
	model,
	step,
	turn,
	waterfall,
}: {
	model: string | null;
	step: SessionReaderStep;
	turn: SessionDetailTurnSummary;
	waterfall: SessionReaderWaterfall;
}) {
	const color = stepLaneLook(step).tint;
	const runMs = Math.max(waterfall.endMs - waterfall.startMs, 1);
	const stepMs = Math.max(
		Math.min(step.endMs, waterfall.endMs) - step.startMs,
		0,
	);
	const call = findStepCall(step, turn, waterfall);
	const runSpent = turn.usageCalls.reduce(
		(sum, each) => sum + (callCost(each, model) ?? 0),
		0,
	);
	const runTokens = turn.usageCalls.reduce(
		(sum, each) => sum + callTokens(each),
		0,
	);
	const callSpent = call ? callCost(call, model) : null;
	const spent = callSpent !== null && runSpent > 0 ? callSpent : null;
	const tokens = call && runTokens > 0 ? callTokens(call) : null;
	return (
		<div className="grid grid-cols-3 gap-xl">
			<StepFigure
				color={color}
				note="Its time"
				share={stepMs / runMs}
				title="Time"
				value={formatSpanDuration(stepMs)}
			/>
			<StepFigure
				color={color}
				note="Its model call's cost"
				share={spent === null ? null : spent / runSpent}
				title="Cost"
				value={spent === null ? null : formatReaderCost(spent)}
			/>
			<StepFigure
				color={color}
				note="Its model call's tokens"
				share={tokens === null ? null : tokens / runTokens}
				title="Tokens"
				value={tokens === null ? null : formatCompactNumber(tokens)}
			/>
		</div>
	);
}
