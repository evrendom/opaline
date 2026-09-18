import {
	buildConversationTrace,
	extractSessionCompactionMetadata,
	getSessionTurnMemberText,
	groupTraceIntoTurns,
	parseConversations,
} from "@rudel/api-routes";
import {
	type LanguageSignalCounts,
	type LanguageSignalSummary,
	summarize,
	summarizeWithMatches,
} from "@rudel/language-signals";
import {
	captureSessionAgentRuns,
	type SessionAgentRun,
} from "./session-agent-runs.js";

export interface SessionLanguageSignalScan extends LanguageSignalSummary {
	readonly agentRuns: readonly SessionAgentRun[];
}

function getVisibleSessionLanguageSignalText(content: string) {
	const compactionMetadata = extractSessionCompactionMetadata(content);
	const visibleTrace = buildConversationTrace(
		parseConversations(content),
	).filter((item) => !compactionMetadata.hiddenTraceItemIds.has(item.id));
	const turns = groupTraceIntoTurns(visibleTrace);
	const memberText = turns.map(getSessionTurnMemberText).filter(Boolean);
	const modelText = visibleTrace.flatMap((item) =>
		item.kind === "agent"
			? item.events.flatMap((event) =>
					event.kind === "message" ? [event.text] : [],
				)
			: [],
	);

	return { memberText, modelText, turns };
}

export function summarizeSessionLanguageSignals(
	content: string,
): LanguageSignalCounts {
	return summarize(getVisibleSessionLanguageSignalText(content));
}

export function captureSessionLanguageSignals(
	content: string,
): LanguageSignalSummary {
	return summarizeWithMatches(getVisibleSessionLanguageSignalText(content));
}

export function captureSessionLanguageSignalsWithRuns(
	content: string,
): SessionLanguageSignalScan {
	const visible = getVisibleSessionLanguageSignalText(content);
	return {
		...summarizeWithMatches(visible),
		agentRuns: captureSessionAgentRuns(content, visible.turns),
	};
}
