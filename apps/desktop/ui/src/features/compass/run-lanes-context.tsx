import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { resolveSessionOverviewContextWindow } from "@/features/sessions/components/session-thread-overview-context-limits";
import { callContextTokens } from "@/features/sessions/reader/context/session-reader-context-fill";
import {
	formatDuration,
	Tip,
} from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips";
import type { SessionReaderStep } from "@/features/sessions/reader/model/session-reader-run-steps";
import { formatCompactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Span } from "./run-lanes-model";

export type UsageCall = SessionDetailTurnSummary["usageCalls"][number];

const COMPACTION_DROP = 0.4;
const COMPACTION_FROM = 0.3;

const CONTEXT_HEADROOM = 1.1;

export const LANE_LABEL =
	"absolute text-body-xxs line-solid font-medium tabular-nums";

export function ContextLane({
	compactions: recorded,
	usage,
	view,
}: {
	compactions: readonly SessionReaderStep[];
	usage: readonly UsageCall[];
	view: Span;
}) {
	const points = [
		...usage.map((call) => ({
			atMs: Date.parse(call.at),
			tokens: callContextTokens(call),
			call,
		})),
		...recorded.flatMap((step) => {
			const { afterTokens, beforeTokens } = step.compaction ?? {};
			return [
				...(beforeTokens === undefined
					? []
					: [{ atMs: step.startMs, tokens: beforeTokens, call: null }]),
				...(afterTokens === undefined
					? []
					: [{ atMs: step.endMs, tokens: afterTokens, call: null }]),
			];
		}),
	]
		.filter((point) => Number.isFinite(point.atMs))
		.sort((a, b) => a.atMs - b.atMs);
	const peak = Math.max(...points.map((point) => point.tokens), 1);
	const windows = points.flatMap(({ call }) => {
		if (!call) return [];
		if (call.contextWindow !== null) return [call.contextWindow];
		const catalog = call.model
			? resolveSessionOverviewContextWindow(call.model, 0)
			: null;
		return catalog?.source === "catalog" ? [catalog.tokenLimit] : [];
	});
	const window = Math.max(peak, ...windows);
	const windowKnown = windows.length > 0;
	const ceiling = window * CONTEXT_HEADROOM;
	const total = Math.max(view.to - view.from, 1);
	const x = (ms: number) => ((ms - view.from) / total) * 100;
	const y = (tokens: number) => 100 - (tokens / ceiling) * 100;
	const path = points
		.map((point, index) => {
			const next = points[index + 1];
			const to = next ? next.atMs : point.atMs;
			return `${index === 0 ? "M" : "L"} ${x(point.atMs)} ${y(point.tokens)} L ${x(to)} ${y(point.tokens)}`;
		})
		.join(" ");
	const fillAt = (ms: number) => {
		const point =
			points.filter((candidate) => candidate.atMs <= ms).at(-1) ?? points[0];
		return point ? `${Math.round((point.tokens / window) * 100)}%` : "";
	};
	const falls = [
		...recorded.flatMap((step) => {
			const { afterTokens, beforeTokens } = step.compaction ?? {};
			return beforeTokens === undefined || afterTokens === undefined
				? []
				: [
						{
							atMs: step.endMs,
							from: beforeTokens,
							label: `Compacted from ${formatCompactNumber(beforeTokens)} to ${formatCompactNumber(afterTokens)} tokens in ${formatDuration(step.endMs - step.startMs)}`,
							to: afterTokens,
						},
					];
		}),
		...points.flatMap((point, index) => {
			const before = points[index - 1];
			if (!before?.call || !point.call) return [];
			const fell = before.tokens - point.tokens;
			return before.tokens >= window * COMPACTION_FROM &&
				fell >= before.tokens * COMPACTION_DROP
				? [
						{
							atMs: point.atMs,
							from: before.tokens,
							label: `Context fell from ${formatCompactNumber(before.tokens)} to ${formatCompactNumber(point.tokens)}: compacted or cleared`,
							to: point.tokens,
						},
					]
				: [];
		}),
	];
	return (
		<div
			className={cn(
				"relative h-8 overflow-hidden",
				"corner-xs",
				"before:absolute before:inset-0 before:-z-10 before:bg-hover",
			)}
		>
			<svg
				aria-hidden="true"
				className="absolute inset-0 size-full"
				preserveAspectRatio="none"
				viewBox="0 0 100 100"
			>
				<path
					d={`${path} L ${x(points.at(-1)?.atMs ?? view.to)} 100 L ${x(points[0]?.atMs ?? view.from)} 100 Z`}
					// design-escape-ok(colour): data paint; the context lane's violet series
					className="fill-violet-500/15"
				/>
				<path
					d={path}
					// design-escape-ok(colour): data paint; the context lane's violet series
					className="fill-none stroke-violet-500"
					strokeWidth={1.25}
					vectorEffect="non-scaling-stroke"
				/>
				{falls.map((fall) => (
					<path
						key={fall.atMs}
						d={`M ${x(fall.atMs)} ${y(fall.from)} L ${x(fall.atMs)} ${y(fall.to)}`}
						className="fill-none stroke-success"
						strokeWidth={1.5}
						vectorEffect="non-scaling-stroke"
					/>
				))}
			</svg>
			{falls.map((fall) => (
				<Tip key={fall.atMs} label={fall.label}>
					<span
						className="absolute inset-y-0 w-1.5 -translate-x-1/2"
						style={{ left: `${x(fall.atMs)}%` }}
					/>
				</Tip>
			))}
			<Tip
				label={`Context at each model call · peak ${formatCompactNumber(peak)}${windowKnown ? ` of a ${formatCompactNumber(window)} window` : ""}`}
			>
				<span className={cn(LANE_LABEL, "top-1 right-1 text-ink-3")}>
					{formatCompactNumber(window)}
				</span>
			</Tip>
			<span
				// design-escape-ok(colour): data paint; the context lane's violet series
				className={cn(LANE_LABEL, "bottom-1 left-1 text-violet-500")}
			>
				{fillAt(view.from)}
			</span>
			<span
				// design-escape-ok(colour): data paint; the context lane's violet series
				className={cn(LANE_LABEL, "right-1 bottom-1 text-violet-500")}
			>
				{fillAt(view.to)}
			</span>
		</div>
	);
}
