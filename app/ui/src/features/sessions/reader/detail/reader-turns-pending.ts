import type { SessionDetailTurnSummary } from "@rudel/api-routes";

export const TURN_GAP_PX = 32;

export type EstimatedTurn = Pick<
	SessionDetailTurnSummary,
	"toolCallCount" | "turnId"
> & { subagentEvents?: readonly unknown[] };

const sum = (values: readonly number[]) =>
	values.reduce((total, value) => total + value, 0);

export function pendingTurnsPx({
	estimate,
	keptHeights,
	subagentTotal,
	total,
	turns,
}: {
	estimate: (turn: EstimatedTurn) => number;
	keptHeights: Record<string, number> | undefined;
	subagentTotal: number;
	total: number;
	turns: readonly EstimatedTurn[];
}): number {
	const missing = total - turns.length;
	if (missing <= 0) return 0;
	const gaps = TURN_GAP_PX * (missing - 1);
	const loaded = new Set(turns.map((turn) => turn.turnId));
	const kept = Object.entries(keptHeights ?? {}).flatMap(([turnId, height]) =>
		loaded.has(turnId) ? [] : [height],
	);
	if (kept.length === missing) return sum(kept) + gaps;
	const calls = Math.round(
		sum(turns.map((turn) => turn.toolCallCount)) / Math.max(turns.length, 1),
	);
	const subagents = Math.max(
		subagentTotal - sum(turns.map((turn) => turn.subagentEvents?.length ?? 0)),
		0,
	);
	const like = { toolCallCount: calls, turnId: turns[0]?.turnId ?? "" };
	return (
		(missing - 1) * estimate({ ...like, subagentEvents: [] }) +
		estimate({ ...like, subagentEvents: Array.from({ length: subagents }) }) +
		gaps
	);
}

export const FITTED_TURN_PX = {
	claude: { base: 1_000, perSubagent: 1_700, perToolCall: 140 },
	codex: { base: 500, perToolCall: 110 },
} as const;

export function estimateTurnPx(turn: EstimatedTurn): number {
	if (turn.turnId.startsWith("codex-")) {
		const { base, perToolCall } = FITTED_TURN_PX.codex;
		return base + turn.toolCallCount * perToolCall;
	}
	const { base, perSubagent, perToolCall } = FITTED_TURN_PX.claude;
	const subagents = turn.subagentEvents?.length ?? 0;
	return base + turn.toolCallCount * perToolCall + subagents * perSubagent;
}
