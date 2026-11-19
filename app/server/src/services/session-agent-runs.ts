import {
	type AgentRunSignal,
	buildConversationTrace,
	extractSessionCompactionMetadata,
	extractSessionTurnMetricBreakdown,
	getSessionTurnId,
	getSessionTurnTiming,
	groupTraceIntoTurns,
	parseConversations,
	type SessionTurn,
	userContentText,
} from "@rudel/api-routes";
import { summarize } from "@rudel/language-signals";

// Version 6 adds run-level facts to the existing revisioned signal summaries.
export const SESSION_AGENT_RUN_SCAN_VERSION = 6;

export interface SessionAgentRun {
	readonly id: string;
	readonly startedAt: string | undefined;
	readonly elapsedSeconds: number | undefined;
	readonly model: string | undefined;
	readonly hasSkills: boolean;
	readonly signal: AgentRunSignal;
}

export function captureSessionAgentRuns(
	content: string,
	visibleTurns?: readonly SessionTurn[],
): SessionAgentRun[] {
	const turns = visibleTurns ?? parseVisibleTurns(content);
	const { primaryTurnMetrics } = extractSessionTurnMetricBreakdown(content, {
		fallbackModel: undefined,
		turns,
	});
	return turns.flatMap((turn, index) => {
		const events = turn.responseItems.flatMap((item) =>
			item.kind === "agent" ? item.events : [],
		);
		const metrics = primaryTurnMetrics[index];
		// A run needs a real member prompt and an observed agent response. Copied
		// history and unanswered prompts must not inflate the run count.
		if (
			turn.userItems.length === 0 ||
			events.length === 0 ||
			(metrics &&
				(metrics.excludedReplayUsageCount ?? 0) > 0 &&
				metrics.usageEvents.length === 0)
		)
			return [];
		const timing = getSessionTurnTiming(turn);
		const lastItem = turn.responseItems.at(-1);
		const endedWithMessage =
			events.at(-1)?.kind === "message" &&
			!(lastItem?.kind === "system" && lastItem.systemType === "interruption");
		const reply = turns[index + 1]?.userItems.find(
			(item) => item.kind === "user",
		);
		return [
			{
				id: getSessionTurnId(turn),
				startedAt: timing.startTimestamp,
				elapsedSeconds: endedWithMessage ? timing.durationSeconds : undefined,
				model: metrics?.usageEvents.filter((event) => event.model).at(-1)
					?.model,
				hasSkills: (metrics?.skills.length ?? 0) > 0,
				signal: getFollowUpSignal(
					reply?.kind === "user" ? userContentText(reply.content) : undefined,
				),
			},
		];
	});
}

function parseVisibleTurns(content: string): SessionTurn[] {
	const metadata = extractSessionCompactionMetadata(content);
	return groupTraceIntoTurns(
		buildConversationTrace(parseConversations(content)).filter(
			(item) => !metadata.hiddenTraceItemIds.has(item.id),
		),
	);
}

function getFollowUpSignal(reply: string | undefined): AgentRunSignal {
	if (reply === undefined) return "noReply";
	const signals = summarize({ memberText: [reply], modelText: [] });
	if (signals.member_positive > 0 && signals.member_negative > 0)
		return "mixed";
	if (signals.member_positive > 0) return "positive";
	if (signals.member_negative > 0) return "negative";
	return "none";
}
