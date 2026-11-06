import { readCodexAgentId } from "./codex-records.js";
import { type CodexEndEvent, isRecord } from "./line-items.js";

export function collectCodexOutcome(
	record: Record<string, unknown>,
	outcomes: Map<string, CodexEndEvent>,
): void {
	if (record.type !== "event_msg" || !isRecord(record.payload)) return;
	const payload = record.payload;
	const item =
		payload.type === "item_completed" && isRecord(payload.item)
			? payload.item
			: payload;
	const callId = item === payload ? payload.call_id : item.id;
	if (typeof callId !== "string" || callId === "") return;
	if (
		payload.type !== "item_completed" &&
		item.type !== "CommandExecution" &&
		item.type !== "exec_command_end" &&
		item.type !== "patch_apply_end" &&
		item.type !== "FileChange"
	)
		return;
	const exitCode =
		(item.type === "CommandExecution" || item.type === "exec_command_end") &&
		typeof item.exit_code === "number" &&
		Number.isSafeInteger(item.exit_code)
			? item.exit_code
			: null;
	const failed =
		item.success === false ||
		item.status === "failed" ||
		item.status === "aborted" ||
		(isRecord(item.result) && item.result.isError === true) ||
		(item.type === "McpToolCall" && item.error != null);
	const success = failed
		? false
		: item.success === true || item.status === "completed"
			? true
			: null;
	if (exitCode !== null || success !== null)
		outcomes.set(callId, {
			exitCode,
			success:
				success === false
					? false
					: exitCode === null
						? success
						: exitCode === 0,
		});
}

export interface CodexPrescan {
	readonly commandItemStreams: ReadonlySet<string>;
	readonly outcomes: Map<string, Map<string, CodexEndEvent>>;
}

export function codexPrescan(content: string): CodexPrescan {
	const outcomes = new Map<string, Map<string, CodexEndEvent>>();
	const commandItemStreams = new Set<string>();
	let start = 0;
	while (start < content.length) {
		const newline = content.indexOf("\n", start);
		const end = newline === -1 ? content.length : newline;
		const line = content.slice(start, end);
		start = end + 1;
		if (!line.includes('"call_id"') && !line.includes('"item_completed"'))
			continue;
		if (line.length > 16 * 1024 * 1024) continue;
		try {
			const record: unknown = JSON.parse(line);
			if (isRecord(record)) {
				const agentId = readCodexAgentId(record) ?? "";
				let stream = outcomes.get(agentId);
				if (stream === undefined) {
					stream = new Map();
					outcomes.set(agentId, stream);
				}
				collectCodexOutcome(record, stream);
				if (isCommandItem(record)) commandItemStreams.add(agentId);
			}
		} catch {}
	}
	return { commandItemStreams, outcomes };
}

function isCommandItem(record: Record<string, unknown>): boolean {
	const payload = isRecord(record.payload) ? record.payload : undefined;
	return (
		record.type === "event_msg" &&
		payload?.type === "item_completed" &&
		isRecord(payload.item) &&
		payload.item.type === "CommandExecution"
	);
}
