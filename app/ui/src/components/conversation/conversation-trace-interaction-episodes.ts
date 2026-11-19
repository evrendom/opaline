import { getCodexOperationMetadata } from "@rudel/api-routes";
import type { TraceEvent } from "./conversation-trace";

type ToolTraceEvent = Extract<TraceEvent, { kind: "tool" }>;

export type ConversationTraceInteractionEpisode = {
	events: readonly ToolTraceEvent[];
	id: string;
	isError: boolean;
	kind: "interaction-episode";
	target: string;
};

export type ConversationTracePresentedEvent =
	| { event: TraceEvent; kind: "event" }
	| ConversationTraceInteractionEpisode;

export function groupConsecutiveInteractionEpisodes(
	events: readonly TraceEvent[],
): readonly ConversationTracePresentedEvent[] {
	const presented: ConversationTracePresentedEvent[] = [];
	let pendingEvents: ToolTraceEvent[] = [];
	let pendingTarget: string | undefined;
	let pendingTargetKey: string | undefined;

	function flushPending() {
		const firstEvent = pendingEvents[0];
		if (!firstEvent || !pendingTarget) {
			return;
		}
		if (pendingEvents.length === 1) {
			presented.push({ event: firstEvent, kind: "event" });
		} else {
			presented.push({
				events: Object.freeze([...pendingEvents]),
				id: `interaction-episode:${firstEvent.id}`,
				isError: pendingEvents.some((event) => event.result?.isError === true),
				kind: "interaction-episode",
				target: pendingTarget,
			});
		}
		pendingEvents = [];
		pendingTarget = undefined;
		pendingTargetKey = undefined;
	}

	for (const event of events) {
		if (event.kind !== "tool") {
			flushPending();
			presented.push({ event, kind: "event" });
			continue;
		}
		const target = getInteractionTarget(event);
		if (!target) {
			flushPending();
			presented.push({ event, kind: "event" });
			continue;
		}
		const targetKey = target.toLocaleLowerCase();
		if (pendingTargetKey === targetKey) {
			pendingEvents.push(event);
			continue;
		}
		flushPending();
		pendingEvents.push(event);
		pendingTarget = target;
		pendingTargetKey = targetKey;
	}
	flushPending();
	return presented;
}

function getInteractionTarget(event: ToolTraceEvent) {
	if (event.provider !== "codex") {
		return undefined;
	}
	return getCodexOperationMetadata(event.input)?.computerUseTarget;
}
