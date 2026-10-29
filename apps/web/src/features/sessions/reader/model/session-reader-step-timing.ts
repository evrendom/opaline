import { getRawToolInput, parseTaskNotification } from "@rudel/api-routes";
import { formatCompactNumber } from "@/lib/format";
import type { SessionReaderBody } from "./session-reader-model";
import type { SessionReaderStep } from "./session-reader-run-steps";

export function getOutputStartMs(
	atMs: number,
	openTools: readonly { resultMs: number | null }[],
	previousOutputMs: number | null,
): number {
	if (openTools.length === 0) {
		return previousOutputMs === null ? atMs : Math.min(previousOutputMs, atMs);
	}
	let lastResultMs = Number.NEGATIVE_INFINITY;
	for (const tool of openTools) {
		if (tool.resultMs === null) return atMs;
		lastResultMs = Math.max(lastResultMs, tool.resultMs);
	}
	return Math.min(lastResultMs, atMs);
}

export function getHarnessSteps(body: SessionReaderBody): SessionReaderStep[] {
	return body.responseItems.flatMap((item): SessionReaderStep[] => {
		if (item.kind !== "system") return [];
		const notice =
			item.systemType === "notification"
				? parseTaskNotification(item.text)
				: null;
		if (notice) {
			const atMs = Date.parse(item.timestamp);
			if (!Number.isFinite(atMs)) return [];
			return [
				{
					children: [],
					detail: notice.result,
					endMs: atMs,
					harness: "notification",
					icon: null,
					id: item.id,
					isError:
						notice.status === "failed" ||
						notice.status === "killed" ||
						(notice.exitCode ?? 0) !== 0,
					kind: "tool",
					name: notice.summary ?? "Background task finished",
					nativeId: null,
					notification: {
						agent: /^Agent\b/u.test(notice.summary ?? ""),
						taskId: notice.taskId,
						toolUseId: notice.toolUseId,
					},
					result: notice.result,
					startMs: atMs,
					text: null,
					toolEvent: null,
				},
			];
		}
		if (item.systemType === "member") {
			const atMs = Date.parse(item.timestamp);
			if (!Number.isFinite(atMs)) return [];
			return [
				{
					children: [],
					detail: item.text.trim().split("\n")[0] ?? null,
					endMs: atMs,
					harness: "member",
					icon: null,
					id: item.id,
					isError: false,
					kind: "tool",
					name: "Redirect",
					nativeId: null,
					result: null,
					startMs: atMs,
					text: item.text,
					toolEvent: null,
				},
			];
		}
		if (item.systemType !== "compaction" && item.systemType !== "hooks")
			return [];
		const compaction = item.systemType === "compaction";
		if (!item.durationMs && !compaction) return [];
		const endMs = Date.parse(item.timestamp);
		if (!Number.isFinite(endMs)) return [];
		return [
			{
				children: [],
				detail: compaction ? compactionDetail(item.compaction) : item.text,
				endMs,
				harness: item.systemType,
				icon: compaction ? "sparkle" : "list",
				id: item.id,
				isError: false,
				kind: "tool" as const,
				name: compaction ? "Compaction" : "Hooks",
				nativeId: null,
				result: null,
				startMs: endMs - (item.durationMs ?? 0),
				text: null,
				toolEvent: null,
				...(compaction && item.compaction
					? { compaction: item.compaction }
					: {}),
			},
		];
	});
}

function compactionDetail(compaction: SessionReaderStep["compaction"]): string {
	const trigger =
		compaction?.trigger === "manual"
			? "/compact"
			: compaction?.trigger === "auto"
				? "Automatic"
				: "Conversation compacted";
	const { afterTokens, beforeTokens } = compaction ?? {};
	return beforeTokens !== undefined && afterTokens !== undefined
		? `${trigger} · ${formatCompactNumber(beforeTokens)} → ${formatCompactNumber(afterTokens)} tokens`
		: trigger;
}

export const WRITTEN_CHARS_PER_SECOND = 300;

export function writingMs(input: unknown): number {
	const raw = getRawToolInput(
		(input && typeof input === "object" ? input : {}) as Record<
			string,
			unknown
		>,
	);
	const size = Object.values(raw).reduce<number>(
		(sum, value) =>
			sum +
			(typeof value === "string" ? value.length : JSON.stringify(value).length),
		0,
	);
	return (size / WRITTEN_CHARS_PER_SECOND) * 1000;
}

export function modelStep(
	call: SessionReaderStep,
	fromMs: number,
	toMs: number,
	produced: boolean,
): SessionReaderStep {
	return {
		children: [],
		detail: "No thinking written down",
		endMs: toMs,
		icon: null,
		id: `${call.id}:thinking`,
		isError: false,
		kind: "thinking",
		name: "Thinking",
		nativeId: null,
		result: null,
		startMs: fromMs,
		text: null,
		toolEvent: null,
		...(produced ? { writes: call.id } : {}),
	};
}

export const INPUT_IS_THE_CALL = new Set([
	"Edit",
	"ExitPlanMode",
	"MultiEdit",
	"NotebookEdit",
	"SendMessage",
	"TodoWrite",
	"Write",
	"apply_patch",
	"edit_file",
	"write_file",
]);

export const WAITS_ON_YOU = new Set(["AskUserQuestion", "ExitPlanMode"]);

export const MIN_WRITE_MS = 250;

export function getWriteStartMs(
	atMs: number,
	openTools: readonly { resultMs: number | null }[],
	previousOutputMs: number | null,
	wakes: readonly number[],
): number {
	let fromMs = previousOutputMs ?? atMs;
	const back = openTools.map((tool) => tool.resultMs);
	if (
		back.length > 0 &&
		back.every((resultMs) => resultMs !== null && resultMs <= atMs)
	)
		fromMs = Math.max(fromMs, ...(back as number[]));
	return Math.min(afterWake(fromMs, atMs, wakes), atMs);
}

export function afterWake(
	startMs: number,
	atMs: number,
	wakes: readonly number[],
): number {
	let woke = startMs;
	for (const wakeMs of wakes) {
		if (wakeMs > woke && wakeMs <= atMs) woke = wakeMs;
	}
	return woke;
}

export function runOnInBackground(steps: readonly SessionReaderStep[]): void {
	for (const step of steps) {
		const background = step.toolEvent?.background;
		if (!background) continue;
		if (step.toolEvent?.toolName === "SendMessage") continue;
		const { exitCode, status } = background;
		if (status === "failed" || status === "killed" || (exitCode ?? 0) !== 0)
			step.isError = true;
		const until = background.finishedAt
			? Date.parse(background.finishedAt)
			: Number.NaN;
		if (!Number.isFinite(until) || until <= step.endMs) continue;
		step.backgroundFromMs = step.endMs;
		step.endMs = until;
	}
}
