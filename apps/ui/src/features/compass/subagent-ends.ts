import { getRawToolInput } from "@rudel/api-routes";
import type { SessionReaderStep } from "@/features/sessions/reader/model/session-reader-run-steps";
import { subagentIdOf } from "@/features/sessions/reader/subagents/session-reader-agent-focus";

function noticeKeys(step: SessionReaderStep): string[] {
	const result = step.toolEvent?.result as { subagentId?: string } | null;
	return [result?.subagentId, step.nativeId].filter(
		(key): key is string => typeof key === "string" && key.length > 0,
	);
}

function finishedName(step: SessionReaderStep): string {
	const description = step.toolEvent
		? getRawToolInput(step.toolEvent.input).description
		: undefined;
	return typeof description === "string" && description.trim()
		? `Agent "${description.trim()}" finished`
		: `${step.name} finished`;
}

const RAN_ON_MS = 1_000;

export function withSubagentEnds(
	given: readonly SessionReaderStep[],
	runEndMs: number,
	finishes: ReadonlyMap<string, number> | null = null,
): {
	finishedRow: ReadonlyMap<string, string>;
	steps: SessionReaderStep[];
} {
	const steps = given.map((step) => {
		const id = step.kind === "agent" ? subagentIdOf(step) : null;
		const finish = id ? finishes?.get(id) : undefined;
		return finish !== undefined && finish > step.endMs
			? { ...step, endMs: finish }
			: step;
	});
	const notices = new Map<string, SessionReaderStep>();
	for (const step of steps) {
		if (step.harness !== "notification" || !step.notification?.agent) continue;
		for (const key of [step.notification.taskId, step.notification.toolUseId])
			if (key) notices.set(key, step);
	}
	const finishedRow = new Map<string, string>();
	const added: SessionReaderStep[] = [];
	for (const step of steps) {
		if (step.kind !== "agent") continue;
		const notice = noticeKeys(step)
			.map((key) => notices.get(key))
			.find(Boolean);
		if (notice && notice.startMs >= step.endMs - RAN_ON_MS) {
			finishedRow.set(step.id, notice.id);
			continue;
		}
		if (step.endMs - runEndMs >= RAN_ON_MS) continue;
		const id = `${step.id}:finished`;
		finishedRow.set(step.id, id);
		added.push({
			children: [],
			detail: null,
			endMs: step.endMs,
			harness: "notification",
			icon: null,
			id,
			isError: step.isError,
			kind: "tool",
			name: finishedName(step),
			nativeId: null,
			notification: {
				agent: true,
				taskId: noticeKeys(step)[0] ?? "",
				toolUseId: step.nativeId,
			},
			result: null,
			startMs: step.endMs,
			text: null,
			toolEvent: null,
		});
	}
	const merged = [...steps];
	for (const finished of added.sort((a, b) => a.startMs - b.startMs)) {
		const at = merged.findIndex(
			(step) => step.startMs >= finished.startMs && step.id !== finished.id,
		);
		merged.splice(at < 0 ? merged.length : at, 0, finished);
	}
	return { finishedRow, steps: merged };
}
