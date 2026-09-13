import { deriveTranscriptToolActivity } from "@rudel/api-routes";
import type { TraceEvent } from "@/components/conversation/conversation-trace";
import { measureTranscriptSuspect } from "./transcript-forensics";

export type TranscriptSectionFoldMetadata = {
	events: number;
	filesEdited: number;
	filesRead: number;
	filesViewed: number;
	filesWritten: number;
	groupId: string;
	hasError: boolean;
	hasSubagentSpawn: boolean;
	isTerminalBoundary: boolean;
	messages: number;
	reasoning: number;
	skills: number;
	subagents: number;
	toolCalls: number;
};

export type TranscriptFoldSummary = {
	events: number;
	filesEdited: number;
	filesRead: number;
	filesViewed: number;
	filesWritten: number;
	messages: number;
	reasoning: number;
	skills: number;
	subagents: number;
	toolCalls: number;
};

export function hasTranscriptFoldActivity(summary: TranscriptFoldSummary) {
	return summary.toolCalls > 0 || summary.messages > 0;
}

function normalizeToolName(toolName: string) {
	return (
		toolName.split(/\.|__/u).at(-1)?.toLowerCase() ?? toolName.toLowerCase()
	);
}

export function deriveTranscriptSectionFoldMetadata(
	events: readonly TraceEvent[],
	groupId: string,
	isTerminalBoundary: boolean,
): TranscriptSectionFoldMetadata {
	return measureTranscriptSuspect(
		"fold-metadata",
		{ events: events.length, groupId },
		() =>
			deriveTranscriptSectionFoldMetadataUnmeasured(
				events,
				groupId,
				isTerminalBoundary,
			),
	);
}

function deriveTranscriptSectionFoldMetadataUnmeasured(
	events: readonly TraceEvent[],
	groupId: string,
	isTerminalBoundary: boolean,
): TranscriptSectionFoldMetadata {
	const toolEvents = events.filter((event) => event.kind === "tool");
	const normalizedToolNames = toolEvents.map((event) =>
		normalizeToolName(event.toolName),
	);
	const semanticActivities = toolEvents.map(
		(event) => event.activity ?? deriveTranscriptToolActivity(event),
	);
	const fileActivities = toolEvents.flatMap((event, index) => {
		const activities = semanticActivities[index]?.files ?? [];
		if (activities.length > 0) {
			return activities;
		}
		const toolName = normalizeToolName(event.toolName);
		if (toolName === "read" || toolName === "read_file") {
			return [{ operation: "read" as const, path: "" }];
		}
		if (toolName === "write" || toolName === "write_file") {
			return [{ operation: "created" as const, path: "" }];
		}
		if (toolName === "edit" || toolName === "notebookedit") {
			return [{ operation: "edited" as const, path: "" }];
		}
		return [];
	});
	return {
		events: events.length,
		filesEdited: fileActivities.filter(
			(file) => file.operation === "edited" || file.operation === "deleted",
		).length,
		filesRead: fileActivities.filter((file) => file.operation === "read")
			.length,
		filesViewed: fileActivities.filter((file) => file.operation === "viewed")
			.length,
		filesWritten: fileActivities.filter((file) => file.operation === "created")
			.length,
		groupId,
		hasError: events.some(
			(event) =>
				(event.kind === "tool" && event.result?.isError === true) ||
				(event.kind === "orphan-result" && event.result.isError),
		),
		hasSubagentSpawn: events.some(
			(event) =>
				event.kind === "tool" &&
				["agent", "spawn_agent", "task"].includes(
					normalizeToolName(event.toolName),
				),
		),
		isTerminalBoundary,
		messages: events.filter((event) => event.kind === "message").length,
		reasoning: events.filter((event) => event.kind === "reasoning").length,
		skills: semanticActivities.reduce(
			(count, activity) => count + activity.skills.length,
			0,
		),
		subagents: normalizedToolNames.filter((toolName) =>
			["agent", "spawn_agent", "task"].includes(toolName),
		).length,
		toolCalls: toolEvents.length,
	};
}

export function deriveTranscriptFoldPlan(
	sections: readonly {
		fold: TranscriptSectionFoldMetadata;
		id: string;
	}[],
	protectedTurn: boolean,
) {
	return measureTranscriptSuspect(
		"fold-derivation",
		{ protectedTurn, sections: sections.length },
		() => deriveTranscriptFoldPlanUnmeasured(sections, protectedTurn),
	);
}

function deriveTranscriptFoldPlanUnmeasured(
	sections: readonly {
		fold: TranscriptSectionFoldMetadata;
		id: string;
	}[],
	protectedTurn: boolean,
) {
	if (protectedTurn) {
		return undefined;
	}
	const groups = [
		...new Map(sections.map((section) => [section.fold.groupId, section.fold])),
	].map(([groupId, fold]) => ({ fold, groupId }));
	const terminalGroupIndex = groups.findIndex(
		(group) => group.fold.isTerminalBoundary,
	);
	if (terminalGroupIndex <= 0) {
		return undefined;
	}
	const hiddenGroups = groups.slice(0, terminalGroupIndex);
	if (hiddenGroups.length === 0) {
		return undefined;
	}
	const hiddenGroupIds = new Set(hiddenGroups.map((group) => group.groupId));
	return {
		hiddenSectionIds: new Set(
			sections
				.filter((section) => hiddenGroupIds.has(section.fold.groupId))
				.map((section) => section.id),
		),
		summary: hiddenGroups.reduce<TranscriptFoldSummary>(
			(summary, group) => ({
				events: summary.events + group.fold.events,
				filesEdited: summary.filesEdited + group.fold.filesEdited,
				filesRead: summary.filesRead + group.fold.filesRead,
				filesViewed: summary.filesViewed + group.fold.filesViewed,
				filesWritten: summary.filesWritten + group.fold.filesWritten,
				messages: summary.messages + group.fold.messages,
				reasoning: summary.reasoning + group.fold.reasoning,
				skills: summary.skills + group.fold.skills,
				subagents: summary.subagents + group.fold.subagents,
				toolCalls: summary.toolCalls + group.fold.toolCalls,
			}),
			{
				events: 0,
				filesEdited: 0,
				filesRead: 0,
				filesViewed: 0,
				filesWritten: 0,
				messages: 0,
				reasoning: 0,
				skills: 0,
				subagents: 0,
				toolCalls: 0,
			},
		),
	};
}
