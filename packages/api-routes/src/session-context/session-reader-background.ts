import {
	parseBackgroundHandOff,
	parseTaskNotification,
	type TaskNotification,
} from "../session-transcript/background-tasks.js";
import { getRawToolInput } from "../session-transcript/codex-tool-translation.js";
import type { SessionReaderBody } from "./session-reader-body.js";
import type { AgentItem } from "./session-reader-run-steps.js";

type Notified = TaskNotification & { at: string };

function resultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) =>
			block && typeof block === "object" && "text" in block
				? String(block.text)
				: "",
		)
		.join("\n");
}

function agentLaunch(event: {
	result?: { content: unknown; subagentId?: string } | null;
}): { taskId: string; timedOut: false } | null {
	const id = event.result?.subagentId;
	return id && /^Async agent launched/mu.test(resultText(event.result?.content))
		? { taskId: id, timedOut: false }
		: null;
}

function getNotifications(body: SessionReaderBody): {
	allByTask: Map<string, Notified[]>;
	byCall: Map<string, Notified>;
	byTask: Map<string, Notified>;
} {
	const allByTask = new Map<string, Notified[]>();
	const byCall = new Map<string, Notified>();
	const byTask = new Map<string, Notified>();
	for (const item of body.responseItems) {
		if (item.kind !== "system" || item.systemType !== "notification") continue;
		const notice = parseTaskNotification(item.text);
		if (!notice) continue;
		const notified = { ...notice, at: item.timestamp };
		if (notice.toolUseId) byCall.set(notice.toolUseId, notified);
		byTask.set(notice.taskId, notified);
		allByTask.set(notice.taskId, [
			...(allByTask.get(notice.taskId) ?? []),
			notified,
		]);
	}
	for (const notices of allByTask.values())
		notices.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	return { allByTask, byCall, byTask };
}

function messagedTask(event: { input: unknown; toolName: string }) {
	if (event.toolName !== "SendMessage") return null;
	const to = getRawToolInput(
		(event.input && typeof event.input === "object"
			? event.input
			: {}) as Record<string, unknown>,
	).to;
	return typeof to === "string" && to ? to : null;
}

export function withBackground(
	items: readonly AgentItem[],
	body: SessionReaderBody,
): AgentItem[] {
	const { allByTask, byCall, byTask } = getNotifications(body);
	return items.map((item) => ({
		...item,
		events: item.events.map((event) => {
			if (event.kind !== "tool" || event.background?.finishedAt) return event;
			const handOff =
				event.background ??
				parseBackgroundHandOff(
					event.toolName,
					resultText(event.result?.content),
				) ??
				agentLaunch(event);
			const messaged = messagedTask(event);
			const notice =
				(event.nativeId ? byCall.get(event.nativeId) : undefined) ??
				byCall.get(event.id) ??
				(handOff ? byTask.get(handOff.taskId) : undefined) ??
				(messaged
					? allByTask
							.get(messaged)
							?.find(
								(each) => Date.parse(each.at) > Date.parse(event.timestamp),
							)
					: undefined);
			if (!handOff && !notice) return event;
			return {
				...event,
				background: {
					exitCode: notice?.exitCode ?? null,
					finishedAt: notice?.at ?? null,
					result: notice?.result ?? null,
					status: notice?.status ?? null,
					summary: notice?.summary ?? null,
					taskId: handOff?.taskId ?? notice?.taskId ?? "",
					timedOut: handOff?.timedOut ?? false,
				},
			};
		}),
	}));
}
