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

function getVisibleSessionLanguageSignalText(content: string) {
	const compactionMetadata = extractSessionCompactionMetadata(content);
	const visibleTrace = buildConversationTrace(
		parseConversations(content),
	).filter((item) => !compactionMetadata.hiddenTraceItemIds.has(item.id));
	const memberText = groupTraceIntoTurns(visibleTrace)
		.map(getSessionTurnMemberText)
		.filter(Boolean);
	const modelText = visibleTrace.flatMap((item) =>
		item.kind === "agent"
			? item.events.flatMap((event) =>
					event.kind === "message" ? [event.text] : [],
				)
			: [],
	);

	return { memberText, modelText };
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
