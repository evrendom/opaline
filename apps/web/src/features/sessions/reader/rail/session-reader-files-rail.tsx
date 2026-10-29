import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import { useFlaggedTurns } from "@/features/compass/session-flags";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import { getCostQuintiles } from "../model/session-reader-model";
import { createRunUiStore } from "../model/session-reader-run-ui-store";
import { OpenSubagentContext } from "../subagents/session-reader-agent-focus";
import { getSubagentLaunches } from "../summary/session-summary-model";
import { type RailTagsState, useRailTags } from "./session-reader-rail-tags";
import {
	createActiveTurnStore,
	TurnRailList,
} from "./session-reader-turn-rail";
import type { RailSubagent } from "./session-reader-turn-rail-row";

const FILE_TAGS: readonly string[] = [];

export function useFilesRailTags(): RailTagsState {
	const [runUi] = useState(() => createRunUiStore(createActiveTurnStore()));
	const tags = useRailTags(runUi);
	return useMemo(() => ({ ...tags, picked: FILE_TAGS }), [tags]);
}

export function FilesRail({
	agent,
	figureMarks,
	idle,
	marks,
	model,
	onPickRun,
	overview,
	run,
	subagents,
	tags,
	turns,
}: {
	agent: string | null;
	idle?: ReadonlySet<string>;
	marks?: ReadonlyMap<string, ReactNode>;
	figureMarks?: ReadonlyMap<string, ReactNode>;
	model: string | null;
	onPickRun: (turnId: string | null, agent?: string | null) => void;
	overview: NormalizedSessionDetailOverview;
	run: string | null;
	subagents: readonly RailSubagent[] | undefined;
	tags: RailTagsState;
	turns: readonly SessionDetailTurnSummary[];
}) {
	const [activeTurn] = useState(createActiveTurnStore);
	const costThresholds = useMemo(
		() => getCostQuintiles(turns.map((turn) => turn.estimatedCost ?? 0)),
		[turns],
	);
	const flagged = useFlaggedTurns({
		from: overview.session.sessionDate,
		sessionId: overview.session.sessionId,
		to: overview.session.lastInteractionDate,
		totalTurns: overview.turnPage.total,
		turns,
	});
	const railTurns = useMemo(
		() => flagged.railTurns.filter(tags.keeps),
		[flagged.railTurns, tags.keeps],
	);
	const rowMarks = useMemo(() => {
		if (!marks || marks.size === 0) return flagged.tags;
		const all = new Map(flagged.tags);
		for (const [turnId, mark] of marks)
			all.set(
				turnId,
				<Fragment key={turnId}>
					{flagged.tags.get(turnId)}
					{mark}
				</Fragment>,
			);
		return all;
	}, [flagged.tags, marks]);
	const launches = useMemo(() => getSubagentLaunches(turns), [turns]);
	const openSubagent = (subagentId: string) => {
		const turnId = launches.get(subagentId);
		if (turnId) onPickRun(turnId, agent === subagentId ? null : subagentId);
	};
	return (
		<OpenSubagentContext.Provider value={openSubagent}>
			<TurnRailList
				activeTurn={activeTurn}
				costThresholds={costThresholds}
				currentTurnId={run}
				figureMarks={figureMarks}
				focusedSubagent={agent}
				idle={idle}
				lead={flagged.filter}
				marks={rowMarks}
				model={model}
				onSelect={(turnId) =>
					onPickRun(turnId === run && agent === null ? null : turnId)
				}
				subagents={subagents}
				tags={tags}
				turns={railTurns}
				whole={{ onPick: () => onPickRun(null), picked: run === null }}
			/>
		</OpenSubagentContext.Provider>
	);
}
