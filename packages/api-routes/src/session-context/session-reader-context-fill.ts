import type { SessionDetailTurnSummary } from "../schemas/session-detail-payload.js";
import { resolveSessionOverviewContextWindow } from "./session-thread-overview-context-limits.js";

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
