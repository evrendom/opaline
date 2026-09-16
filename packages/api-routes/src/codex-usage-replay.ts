// Shared with ingestion and detail pricing: fork snapshots replay parent usage
// in a dense timestamp burst. Those records are context, not new child spend.
const CODEX_REPLAY_BURST_MAX_GAP_MS = 1_000;
interface CodexReplayState {
	active: boolean;
	previousTimestampMs: number;
	previousTotalKey: string;
	suppressedTransitionKeys: Set<string>;
}

export function createCodexReplayState(content: string): CodexReplayState {
	const replayStart = hasCodexParentMetadata(content)
		? detectCodexReplayBurstStart(content)
		: null;
	return {
		active: replayStart !== null,
		previousTimestampMs: replayStart ?? 0,
		previousTotalKey: "",
		suppressedTransitionKeys: new Set<string>(),
	};
}

export function shouldSuppressCodexReplayEvent(
	state: CodexReplayState,
	totalKey: string,
	occurredAt: string | null,
): boolean {
	if (!state.active) return false;
	if (state.previousTotalKey !== "" && state.previousTotalKey === totalKey) {
		return true;
	}
	if (occurredAt === null) {
		state.active = false;
		return false;
	}
	const timestampMs = Date.parse(occurredAt);
	const gap = timestampMs - state.previousTimestampMs;
	if (gap >= 0 && gap <= CODEX_REPLAY_BURST_MAX_GAP_MS) {
		state.previousTimestampMs = timestampMs;
		state.previousTotalKey = totalKey;
		return true;
	}
	state.active = false;
	return false;
}

function hasCodexParentMetadata(content: string): boolean {
	const newline = content.indexOf("\n");
	const firstLine = content
		.slice(0, newline === -1 ? content.length : newline)
		.trim();
	if (firstLine === "") return false;
	let parsed: unknown;
	try {
		parsed = JSON.parse(firstLine);
	} catch {
		return false;
	}
	const value = readRecord(parsed);
	const payload = readRecord(value?.payload);
	if (value?.type !== "session_meta" || !payload) return false;
	const source = readRecord(payload.source);
	const subagent = readRecord(source?.subagent);
	const threadSpawn = readRecord(subagent?.thread_spawn);
	const parentId =
		readNonEmptyString(payload.forked_from_id) ??
		readNonEmptyString(threadSpawn?.parent_thread_id);
	const sessionId = readNonEmptyString(payload.id);
	return parentId !== undefined && parentId !== sessionId;
}

function detectCodexReplayBurstStart(content: string): number | null {
	const timestamps: number[] = [];
	visitJsonLines(content, (line) => {
		const payload = readRecord(line.value.payload);
		if (line.value.type !== "event_msg" || payload?.type !== "token_count") {
			return;
		}
		const info = readRecord(payload.info);
		if (
			!readRecord(info?.last_token_usage) &&
			!readRecord(info?.total_token_usage)
		) {
			return;
		}
		const occurredAt = readTimestamp(line.value.timestamp);
		if (occurredAt === null) return;
		timestamps.push(Date.parse(occurredAt));
		return timestamps.length < 2;
	});
	const first = timestamps[0];
	const second = timestamps[1];
	if (first === undefined || second === undefined) return null;
	const gap = second - first;
	return gap >= 0 && gap <= CODEX_REPLAY_BURST_MAX_GAP_MS ? first : null;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}
function readNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" ? value.trim() || undefined : undefined;
}
function readTimestamp(value: unknown): string | null {
	if (
		typeof value !== "string" ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
			value,
		)
	)
		return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function visitJsonLines(
	content: string,
	visit: (line: { value: Record<string, unknown> }) => boolean | undefined,
) {
	for (const raw of content.split("\n")) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			continue;
		}
		const value = readRecord(parsed);
		if (value && visit({ value }) === false) break;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
