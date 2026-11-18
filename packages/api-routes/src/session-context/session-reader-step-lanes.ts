import { isSearchLead, SEARCH_TOOLS } from "../command-identity.js";
import { parseBackgroundHandOff } from "../session-transcript/background-tasks.js";
import { getRawToolInput } from "../session-transcript/codex-tool-translation.js";
import { getShellCommand } from "./conversation-tools.js";
import type { SessionReaderStep } from "./session-reader-run-steps.js";

export type Activity =
	| "agent"
	| "answer"
	| "ci"
	| "compact"
	| "hooks"
	| "edit"
	| "explore"
	| "git"
	| "mcp"
	| "message"
	| "model"
	| "other"
	| "run"
	| "skill"
	| "verify"
	| "wait";

export type LaneStep = Pick<SessionReaderStep, "kind" | "name"> &
	Partial<
		Pick<
			SessionReaderStep,
			| "backgroundFromMs"
			| "command"
			| "files"
			| "harness"
			| "isError"
			| "notification"
			| "result"
			| "skill"
			| "toolEvent"
			| "waitsOnYou"
		>
	>;

export const CI_WATCH = /\bgh\s+(?:pr\s+checks\b[^\n]*--watch|run\s+watch)\b/u;

export function isSubagentMessage(step: LaneStep): boolean {
	return step.kind === "tool" && step.toolEvent?.toolName === "SendMessage";
}

export function isCiWatch(step: LaneStep): boolean {
	return step.kind === "tool" && CI_WATCH.test(shellCommandOf(step));
}

export function shellCommandOf(step: Pick<LaneStep, "toolEvent">): string {
	const event = step.toolEvent;
	if (!event) return "";
	return getShellCommand(event.toolName, getRawToolInput(event.input)) ?? "";
}

function ranInBackground(step: LaneStep): boolean {
	if (step.kind !== "tool" || isCiWatch(step) || isSubagentMessage(step))
		return false;
	return (
		step.backgroundFromMs !== undefined ||
		step.toolEvent?.background !== undefined ||
		(step.result
			? parseBackgroundHandOff(step.toolEvent?.toolName, step.result) !== null
			: false)
	);
}

const EXPLORE_TOOLS = new Set([
	"Glob",
	"Grep",
	"LS",
	"Read",
	"ToolSearch",
	"WebFetch",
	"WebSearch",
	"file_search",
	"grep_search",
	"list_dir",
	"read_file",
	"view_image",
	"web_search",
]);
export const EDIT_TOOLS: ReadonlySet<string> = new Set([
	"Edit",
	"MultiEdit",
	"NotebookEdit",
	"Write",
	"apply_patch",
	"edit_file",
	"write_file",
]);

export function activityOf(step: LaneStep): Activity {
	if (step.kind === "thinking" || step.kind === "message") return "model";
	if (step.kind === "agent") return "agent";
	if (step.kind === "ci" || isCiWatch(step)) return "ci";
	if (step.harness === "compaction") return "compact";
	if (step.harness === "hooks") return "hooks";
	if (step.harness === "notification")
		return step.notification?.agent ? "agent" : "hooks";
	if (isSubagentMessage(step)) return "message";
	if (step.skill) return "skill";
	const kind = step.command?.kind;
	if (kind) {
		if (["build", "lint", "test", "typecheck"].includes(kind)) return "verify";
		if (kind === "git" || kind === "github") return "git";
		if (kind === "read" || kind === "files") return "explore";
		if (kind === "wait") return "wait";
		return "run";
	}
	const tool = step.toolEvent?.toolName ?? step.name;
	if (EXPLORE_TOOLS.has(tool)) return "explore";
	if (EDIT_TOOLS.has(tool)) return "edit";
	if (tool.startsWith("mcp__")) return "mcp";
	return "other";
}

function isSearch(step: LaneStep): boolean {
	if (SEARCH_TOOLS.has(step.toolEvent?.toolName ?? step.name)) return true;
	return isSearchLead(step.command?.lead ?? "");
}

export const LANES = [
	{ key: "model", label: "Model" },
	{ key: "search", label: "Search" },
	{ key: "read", label: "Read" },
	{ key: "edit", label: "Edit" },
	{ key: "write", label: "Write" },
	{ key: "skill", label: "Skills" },
	{ key: "verify", label: "Verify" },
	{ key: "shell", label: "Shell" },
	{ key: "background", label: "Background" },
	{ key: "message", label: "Messages" },
	{ key: "git", label: "Git" },
	{ key: "tools", label: "Tools" },
	{ key: "agent", label: "Agents" },
	{ key: "ci", label: "CI" },
] as const;

export type LaneKey = (typeof LANES)[number]["key"];

export function laneKeysOf(step: LaneStep): LaneKey[] {
	if (step.harness === "notification")
		return step.notification?.agent ? ["message"] : [];
	const own = ownLaneKeys(step);
	return ranInBackground(step) ? [...own, "background"] : own;
}

export function railTagKeysOf(step: LaneStep): string[] {
	const keys = new Set<string>();
	for (const lane of laneKeysOf(step)) {
		if (lane === "tools") {
			if (activityOf(step) === "mcp") keys.add("mcp");
		} else if (lane === "git")
			keys.add(step.command?.kind === "github" ? "github" : "git");
		else if (RAIL_TAG_LANES.has(lane)) keys.add(lane);
	}
	return [...keys];
}

const RAIL_TAG_LANES = new Set<LaneKey>([
	"agent",
	"edit",
	"read",
	"search",
	"shell",
	"skill",
	"verify",
	"write",
]);

function ownLaneKeys(step: LaneStep): LaneKey[] {
	if (step.waitsOnYou || step.harness === "member") return [];
	const activity = activityOf(step);
	if (activity === "compact") return [];
	if (activity === "model" || activity === "answer") return ["model"];
	if (activity === "hooks" || activity === "mcp" || activity === "other")
		return ["tools"];
	if (activity === "agent") return ["agent"];
	if (activity === "message") return ["message"];
	if (activity === "ci") return [];
	if (activity === "skill") return ["skill"];
	if (activity === "verify") return ["verify"];
	if (activity === "git") return ["git"];
	const keys = new Set<LaneKey>();
	for (const op of step.files ?? []) keys.add(op.operation);
	if (isSearch(step)) keys.add("search");
	if (keys.size === 0 && activity === "explore") keys.add("read");
	if (keys.size === 0 && activity === "edit") keys.add("edit");
	return keys.size > 0 ? [...keys] : ["shell"];
}

const CHIP_ORDER: readonly LaneKey[] = [
	"background",
	"write",
	"edit",
	"read",
	"search",
];

export const isPastedText = (path: string) =>
	/-txt\.txt$/iu.test(path.split("/").pop() ?? path);

export function chipLaneKey(step: LaneStep): LaneKey {
	const keys = laneKeysOf(step);
	return (
		CHIP_ORDER.find((candidate) => keys.includes(candidate)) ??
		keys[0] ??
		"tools"
	);
}
