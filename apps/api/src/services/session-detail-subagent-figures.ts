import {
	parseTaskNotification,
	type SessionDetailContextUse,
	type SessionTurn,
	type TokenUsageEvent,
} from "@rudel/api-routes";

export type SubagentContextUse = SessionDetailContextUse;

export type SubagentFigures = {
	context: SubagentContextUse | null;
	firstInputTokens: number | null;
	durationSeconds: number | null;
	mainThread: SubagentContextUse | null;
};

const IMAGE_CHARS = 6_000;

export function isSubagentLaunchTool(toolName: string) {
	const normalizedName = toolName.split(/\.|__/u).at(-1)?.toLowerCase();
	return (
		normalizedName === "agent" ||
		normalizedName === "task" ||
		normalizedName === "spawn_agent"
	);
}

function sizeOf(content: unknown): number {
	if (typeof content === "string") return content.length;
	if (!Array.isArray(content)) return 0;
	let size = 0;
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const {
			content: inner,
			text,
			type,
		} = block as {
			content?: unknown;
			text?: unknown;
			type?: unknown;
		};
		if (type === "image") size += IMAGE_CHARS;
		else if (typeof text === "string") size += text.length;
		else if (inner !== undefined) size += sizeOf(inner);
	}
	return size;
}

function contextOf(event: TokenUsageEvent) {
	return (
		event.inputTokens +
		event.cacheCreationInputTokens +
		event.cacheReadInputTokens
	);
}

function toMs(timestamp: string | null | undefined): number | null {
	const value = timestamp ? Date.parse(timestamp) : Number.NaN;
	return Number.isFinite(value) ? value : null;
}

type Arrival = { at: number; size: number };

type Launch = {
	reports: Arrival[];
	startedAt: number;
	subagentId: string;
};

function queuedCommandOf(line: string) {
	try {
		const entry = JSON.parse(line) as {
			attachment?: { prompt?: unknown; type?: unknown };
			isSidechain?: unknown;
			timestamp?: unknown;
			type?: unknown;
		};
		const prompt = entry.attachment?.prompt;
		return entry.type === "attachment" &&
			entry.isSidechain !== true &&
			entry.attachment?.type === "queued_command" &&
			typeof prompt === "string" &&
			typeof entry.timestamp === "string"
			? { prompt, timestamp: entry.timestamp }
			: null;
	} catch {
		return null;
	}
}

function readMainThread(turns: readonly SessionTurn[], content: string) {
	const arrivals: Arrival[] = [];
	const arrive = (timestamp: string | undefined, size: number) => {
		const at = toMs(timestamp);
		if (at === null || size === 0) return null;
		const arrival = { at, size };
		arrivals.push(arrival);
		return arrival;
	};
	const notices = new Map<string, Arrival[]>();
	const notice = (text: string, arrival: Arrival | null) => {
		const taskId = parseTaskNotification(text)?.taskId;
		if (arrival && taskId)
			notices.set(taskId, [...(notices.get(taskId) ?? []), arrival]);
	};
	const launches: (Omit<Launch, "reports"> & { result: Arrival | null })[] = [];
	for (const turn of turns) {
		for (const item of [...turn.userItems, ...turn.responseItems]) {
			if (item.kind === "user") {
				arrive(item.timestamp, sizeOf(item.content));
				continue;
			}
			if (item.kind === "system") {
				const arrival = arrive(item.timestamp, item.text.length);
				if (item.systemType === "notification") notice(item.text, arrival);
				continue;
			}
			if (item.kind !== "agent") continue;
			for (const event of item.events) {
				if (event.kind === "orphan-result") {
					arrive(
						event.result.timestamp ?? event.timestamp,
						sizeOf(event.result.content),
					);
					continue;
				}
				if (event.kind !== "tool" || !event.result) continue;
				const result = arrive(
					event.result.timestamp ?? event.timestamp,
					sizeOf(event.result.content),
				);
				const subagentId = event.result.subagentId;
				const startedAt = toMs(event.timestamp);
				if (!subagentId || startedAt === null) continue;
				if (!isSubagentLaunchTool(event.toolName)) continue;
				launches.push({ result, startedAt, subagentId });
			}
		}
	}
	// What Claude Code queued while the main thread was busy, handed to it
	// mid-run as an attachment the trace doesn't keep: notifications among
	// them.
	for (const line of content.split("\n")) {
		if (!line.includes('"queued_command"')) continue;
		const queued = queuedCommandOf(line);
		if (queued)
			notice(queued.prompt, arrive(queued.timestamp, queued.prompt.length));
	}
	arrivals.sort((a, b) => a.at - b.at);
	return {
		arrivals,
		launches: launches.map(
			({ result, ...launch }): Launch => ({
				...launch,
				reports: (
					notices.get(launch.subagentId) ?? (result ? [result] : [])
				).sort((a, b) => a.at - b.at),
			}),
		),
	};
}

function addedToMainThread(
	report: Arrival,
	calls: readonly (TokenUsageEvent & { atMs: number })[],
	arrivals: readonly Arrival[],
): SubagentContextUse | null {
	const after = calls.findIndex((call) => call.atMs >= report.at);
	const before = calls[after - 1];
	const next = calls[after];
	if (after < 1 || !before || !next) return null;
	const added = contextOf(next) - contextOf(before) - before.outputTokens;
	if (added <= 0) return null;
	const gap = arrivals.reduce(
		(total, arrival) =>
			arrival.at > before.atMs && arrival.at <= next.atMs
				? total + arrival.size
				: total,
		0,
	);
	if (gap === 0) return null;
	return {
		model: next.model ?? null,
		tokens: Math.round((added * report.size) / gap),
		window: next.modelContextWindow ?? null,
	};
}

export function getSubagentFigures(
	turns: readonly SessionTurn[],
	content: string,
	mainUsage: readonly TokenUsageEvent[],
	subagentUsage: ReadonlyMap<string, readonly TokenUsageEvent[]>,
): Map<string, SubagentFigures> {
	const calls = mainUsage
		.flatMap((call) => {
			const atMs = toMs(call.at);
			return atMs === null ? [] : [{ ...call, atMs }];
		})
		.sort((a, b) => a.atMs - b.atMs);
	const { arrivals, launches } = readMainThread(turns, content);
	const figures = new Map<string, SubagentFigures>();
	for (const [subagentId, usage] of subagentUsage) {
		let fullest: TokenUsageEvent | undefined;
		let first: { atMs: number; call: TokenUsageEvent } | undefined;
		for (const call of usage) {
			if (!fullest || contextOf(call) > contextOf(fullest)) fullest = call;
			const atMs = toMs(call.at);
			if (atMs !== null && (!first || atMs < first.atMs))
				first = { atMs, call };
		}
		figures.set(subagentId, {
			context:
				fullest && contextOf(fullest) > 0
					? {
							model: fullest.model ?? null,
							tokens: contextOf(fullest),
							window: fullest.modelContextWindow ?? null,
						}
					: null,
			durationSeconds: null,
			firstInputTokens:
				first && contextOf(first.call) > 0 ? contextOf(first.call) : null,
			mainThread: null,
		});
	}
	for (const launch of launches) {
		const own = figures.get(launch.subagentId);
		const last = launch.reports.at(-1);
		if (!own || !last) continue;
		own.durationSeconds = Math.max((last.at - launch.startedAt) / 1000, 0);
		const added = launch.reports.flatMap((report) => {
			const use = addedToMainThread(report, calls, arrivals);
			return use ? [use] : [];
		});
		const latest = added.at(-1);
		own.mainThread = latest
			? {
					...latest,
					tokens: added.reduce((total, use) => total + use.tokens, 0),
				}
			: null;
	}
	return figures;
}
