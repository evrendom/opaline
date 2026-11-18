import { LANES, type LaneKey } from "../model/session-reader-step-lanes";
import type { ContextKind, ContextPart } from "./session-reader-context-map";

export const RESULT_LANES = LANES.map((lane) => lane.key).filter(
	(key): key is Exclude<LaneKey, "model" | "skill"> =>
		key !== "model" && key !== "skill",
);

export const GROUPS: {
	key: string;
	kinds: readonly ContextKind[];
	label: string;
}[] = [
	{ key: "context", kinds: ["context"], label: "System prompt & tools" },
	{ key: "chat", kinds: ["you", "model"], label: "Chat" },
	{ key: "skills", kinds: ["skill"], label: "Skills" },
	{ key: "before", kinds: ["earlier", "summary"], label: "Earlier" },
];

export const ownKey = (key: string) =>
	key.replace(/^(?:compacted|earlier):/u, "");

export const filterKind = (part: ContextPart): ContextKind =>
	part.before ? "earlier" : part.kind;

export function categoryOf(kind: ContextKind): { key: string; label: string } {
	const group = GROUPS.find((each) => each.kinds.includes(kind));
	return group
		? { key: group.key, label: group.label }
		: { key: "results", label: "Tool results" };
}
