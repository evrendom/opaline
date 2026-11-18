import { getRawToolInput } from "../session-transcript/codex-tool-translation.js";
import type { SessionReaderStep } from "./session-reader-run-steps.js";

export function subagentIdOf(step: SessionReaderStep): string | null {
	const result = step.toolEvent?.result as { subagentId?: string } | null;
	return step.kind === "agent" && result?.subagentId ? result.subagentId : null;
}

export function subagentTalkedTo(
	step: Partial<
		Pick<SessionReaderStep, "harness" | "notification" | "toolEvent">
	>,
): string | null {
	if (step.harness === "notification" && step.notification?.agent)
		return step.notification.taskId;
	if (step.toolEvent?.toolName !== "SendMessage") return null;
	const to = getRawToolInput(step.toolEvent.input).to;
	return typeof to === "string" && to ? to : null;
}
