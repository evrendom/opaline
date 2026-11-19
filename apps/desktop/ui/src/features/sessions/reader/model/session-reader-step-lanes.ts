import {
	type Activity,
	chipLaneKey,
	isCiWatch,
	isPastedText,
	type LaneKey,
	type LaneStep,
} from "@rudel/api-routes/session-context/session-reader-step-lanes";
import {
	IconAlignBoxLeftTop,
	IconBrain,
	IconBrandGithub,
	IconClipboardText,
	IconFlask,
	IconGhost,
	IconGitBranch,
	IconHourglass,
	IconMessage,
	IconSparkles,
	IconTerminal2,
	IconUser,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import { CONVERSATION_TOOL_ICONS } from "@/components/conversation/conversation-trace-tool-icons";

export * from "@rudel/api-routes/session-context/session-reader-step-lanes";

export const ACTIVITY_COLOR: Record<Activity, string> = {
	model: "bg-violet-500",
	answer: "bg-violet-300 dark:bg-violet-400",
	explore: "bg-sky-500",
	skill: "bg-indigo-500",
	edit: "bg-amber-500",
	verify: "bg-emerald-500",
	run: "bg-blue-500",
	git: "bg-orange-500",
	wait: "bg-zinc-400 dark:bg-zinc-500",
	mcp: "bg-teal-500",
	agent: "bg-pink-500",
	message: "bg-pink-400",
	ci: "bg-zinc-400",
	compact: "bg-green-500",
	hooks: "bg-zinc-400 dark:bg-zinc-500",
	other: "bg-zinc-400 dark:bg-zinc-500",
};

type Glyph = ComponentType<{ className?: string }>;

export type LaneLook = { glyph: Glyph; tint: string };

export const LANE_LOOK: Record<LaneKey | "context" | "you", LaneLook> = {
	agent: { glyph: IconGhost, tint: "var(--color-pink-500)" },
	background: { glyph: IconHourglass, tint: "var(--color-blue-400)" },
	ci: { glyph: IconBrandGithub, tint: "var(--color-zinc-400)" },
	context: { glyph: IconAlignBoxLeftTop, tint: "var(--color-violet-400)" },
	edit: {
		glyph: CONVERSATION_TOOL_ICONS.pencil,
		tint: "var(--color-yellow-500)",
	},
	git: { glyph: IconGitBranch, tint: "var(--color-orange-500)" },
	message: { glyph: IconMessage, tint: "var(--color-pink-400)" },
	model: { glyph: IconBrain, tint: "var(--color-violet-500)" },
	read: { glyph: CONVERSATION_TOOL_ICONS.file, tint: "var(--color-cyan-500)" },
	search: {
		glyph: CONVERSATION_TOOL_ICONS.search,
		tint: "var(--color-sky-500)",
	},
	shell: { glyph: IconTerminal2, tint: "var(--color-blue-500)" },
	skill: { glyph: IconSparkles, tint: "var(--color-indigo-500)" },
	tools: {
		glyph: CONVERSATION_TOOL_ICONS.wrench,
		tint: "var(--color-teal-500)",
	},
	verify: { glyph: IconFlask, tint: "var(--color-emerald-500)" },
	write: {
		glyph: CONVERSATION_TOOL_ICONS["file-add"],
		tint: "var(--color-lime-500)",
	},
	you: { glyph: IconUser, tint: "var(--color-amber-400)" },
};

const COMPACTION_LOOK: LaneLook = {
	glyph: IconAlignBoxLeftTop,
	tint: "var(--color-green-500)",
};

export function stepLaneLook(step: LaneStep): LaneLook {
	if (step.kind === "ci") return LANE_LOOK.ci;
	if (isCiWatch(step))
		return step.isError
			? { glyph: LANE_LOOK.ci.glyph, tint: "var(--color-rose-500)" }
			: LANE_LOOK.ci;
	if (step.harness === "compaction") return COMPACTION_LOOK;
	if (step.waitsOnYou || step.harness === "member") return LANE_LOOK.you;
	if (step.harness === "notification")
		return step.notification?.agent ? LANE_LOOK.agent : LANE_LOOK.background;
	const look = LANE_LOOK[chipLaneKey(step)];
	const files = step.files ?? [];
	if (
		files.length > 0 &&
		files.every((op) => op.operation === "read" && isPastedText(op.path))
	)
		return { ...look, glyph: IconClipboardText };
	return look;
}
