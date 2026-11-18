import type { MomentKind, SessionDetailTurnSummary } from "@rudel/api-routes";
import { useMemo } from "react";
import { useTurnFlags } from "@/features/compass/session-flags";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import type { RunFlags } from "../context/session-reader-context-problems";
import { soundsFrustrated } from "../summary/session-reader-summary-flags";

export function useRunFlags(
	overview: NormalizedSessionDetailOverview,
	turns: readonly SessionDetailTurnSummary[],
): RunFlags {
	const { flags } = useTurnFlags(
		{
			from: overview.session.sessionDate,
			sessionId: overview.session.sessionId,
			to: overview.session.lastInteractionDate,
			totalTurns: overview.turnPage.total,
			turns,
		},
		turns,
		null,
	);
	return useMemo(() => {
		const byRun = new Map<string, MomentKind[]>();
		const add = (turnId: string, kind: MomentKind) => {
			const had = byRun.get(turnId) ?? [];
			if (!had.includes(kind)) byRun.set(turnId, [...had, kind]);
		};
		for (const { kind, reasons } of flags) {
			if (kind === "failing_streak") continue;
			for (const { turnId } of reasons) {
				if (kind !== "user_frustrated") {
					add(turnId, kind);
					continue;
				}
				const next =
					turns[turns.findIndex((turn) => turn.turnId === turnId) + 1];
				if (next) add(next.turnId, kind);
			}
		}
		for (const turn of turns)
			if (soundsFrustrated(turn)) add(turn.turnId, "user_frustrated");
		return byRun;
	}, [flags, turns]);
}
