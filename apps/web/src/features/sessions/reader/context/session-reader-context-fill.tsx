import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { IconArrowRight } from "@tabler/icons-react";
import { resolveSessionOverviewContextWindow } from "../../components/session-thread-overview-context-limits";
import { Tip } from "../detail/waterfall/session-reader-waterfall-chips";

export const callContextTokens = (
	call: Pick<
		SessionDetailTurnSummary["usageCalls"][number],
		"cacheCreationInputTokens" | "cacheReadInputTokens" | "freshInputTokens"
	>,
) =>
	call.freshInputTokens +
	call.cacheCreationInputTokens +
	call.cacheReadInputTokens;

export type ContextUse = {
	model: string | null;
	tokens: number;
	window: number | null;
};

export function getContextUseFill(use: ContextUse) {
	const catalog = use.model
		? resolveSessionOverviewContextWindow(use.model, 0)
		: null;
	const window =
		use.window ?? (catalog?.source === "catalog" ? catalog.tokenLimit : null);
	if (!window || use.tokens === 0) return null;
	return {
		model: use.model,
		reported: use.window !== null,
		share: use.tokens / window,
		tokens: use.tokens,
		window,
	};
}

export function getContextFill(turn: SessionDetailTurnSummary) {
	let fullest: ReturnType<typeof getContextUseFill> = null;
	for (const call of turn.usageCalls) {
		const fill = getContextUseFill({
			model: call.model,
			tokens: callContextTokens(call),
			window: call.contextWindow,
		});
		if (fill && (!fullest || fill.share > fullest.share)) fullest = fill;
	}
	return fullest;
}

function getContextRange(turn: SessionDetailTurnSummary) {
	if (turn.activityResolution !== "exact") return null;
	const fills = turn.usageCalls.flatMap((call) => {
		const fill = getContextUseFill({
			model: call.model,
			tokens: callContextTokens(call),
			window: call.contextWindow,
		});
		return fill ? [fill] : [];
	});
	const first = fills[0];
	const last = fills.at(-1);
	return first && last && fills.length > 1 ? { first, last } : null;
}

export function ContextFill({
	compact = false,
	tip = true,
	turn,
	use,
}: {
	compact?: boolean;
	tip?: boolean;
	turn?: SessionDetailTurnSummary;
	use?: ContextUse | null;
}) {
	const fill = use
		? getContextUseFill(use)
		: turn
			? getContextFill(turn)
			: null;
	if (!fill) return null;
	const range = !compact && turn ? getContextRange(turn) : null;
	if (range) return <ContextRange {...range} />;
	const share = Math.min(fill.share, 1);
	const ring = (
		<span className="inline-flex items-center gap-1.5">
			<svg aria-hidden="true" className="size-3 -rotate-90" viewBox="0 0 12 12">
				<circle
					cx="6"
					cy="6"
					r="4.5"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					className="text-muted-foreground/20"
				/>
				<circle
					cx="6"
					cy="6"
					r="4.5"
					fill="none"
					pathLength={100}
					stroke="currentColor"
					strokeDasharray={`${Math.max(share * 100, 1)} 100`}
					strokeLinecap="round"
					strokeWidth="2"
					className={
						share > 0.8 ? "text-amber-500" : "text-muted-foreground/70"
					}
				/>
			</svg>
			<span>
				{Math.max(1, Math.round(fill.share * 100))}%
				{compact ? null : (
					<span className="text-muted-foreground"> context window</span>
				)}
			</span>
		</span>
	);
	return tip ? (
		<Tip
			side="bottom"
			label={`Fullest call: ${fill.tokens.toLocaleString()} of ${fill.model ?? "its model"}'s ${fill.window.toLocaleString()}-token context window (${
				fill.reported ? "as the agent reported it" : "from the model catalog"
			})`}
		>
			{ring}
		</Tip>
	) : (
		ring
	);
}

function percentOf(share: number): string {
	return `${Math.max(1, Math.round(share * 100))}%`;
}

function ContextRange({
	first,
	last,
}: {
	first: NonNullable<ReturnType<typeof getContextUseFill>>;
	last: NonNullable<ReturnType<typeof getContextUseFill>>;
}) {
	const start = Math.min(first.share, 1);
	const end = Math.min(last.share, 1);
	return (
		<Tip
			side="bottom"
			label={`Context window: ${first.tokens.toLocaleString()} tokens on its first call, ${last.tokens.toLocaleString()} on its last, of ${last.model ?? "its model"}'s ${last.window.toLocaleString()} (${
				last.reported ? "as the agent reported it" : "from the model catalog"
			})`}
		>
			<span className="inline-flex items-center gap-1.5">
				<svg
					aria-hidden="true"
					className="size-3 -rotate-90"
					viewBox="0 0 12 12"
				>
					<circle
						cx="6"
						cy="6"
						r="4.5"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						className="text-muted-foreground/20"
					/>
					<circle
						cx="6"
						cy="6"
						r="4.5"
						fill="none"
						pathLength={100}
						stroke="currentColor"
						strokeDasharray={`${Math.max(start * 100, 1)} 100`}
						strokeWidth="2"
						className="text-muted-foreground/40"
					/>
					<circle
						cx="6"
						cy="6"
						r="4.5"
						fill="none"
						pathLength={100}
						stroke="currentColor"
						strokeDasharray={`${Math.max((end >= start ? end - start : end) * 100, 1)} 100`}
						strokeDashoffset={end >= start ? -start * 100 : 0}
						strokeWidth="2"
						className={end > 0.8 ? "text-amber-500" : "text-muted-foreground"}
					/>
				</svg>
				<span className="inline-flex items-center gap-1">
					<span className="text-muted-foreground">
						{percentOf(first.share)}
					</span>
					<IconArrowRight
						aria-hidden="true"
						className="size-3 text-muted-foreground/70"
					/>
					<span>{percentOf(last.share)}</span>
					<span className="text-muted-foreground">context window</span>
				</span>
			</span>
		</Tip>
	);
}
