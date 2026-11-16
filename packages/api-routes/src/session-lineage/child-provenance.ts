import type {
	ChildLineageEvidence,
	LineageOutcome,
	NativeCodexLineageEvidence,
	RawLineageSession,
} from "./types.js";

export function extractNativeCodexLineageEvidence(
	session: Pick<
		RawLineageSession,
		"content" | "sessionDate" | "sessionId" | "source"
	>,
): NativeCodexLineageEvidence | undefined {
	if (session.source !== "codex") return undefined;
	const lines = new LazyJsonLines(session.content);
	const sessionMeta = lines.find((line) => line.type === "session_meta");
	const metadata = readRecord(sessionMeta?.payload);
	if (metadata?.thread_source !== "subagent") return undefined;
	const childSessionId = readString(metadata.id);
	if (!childSessionId || childSessionId !== session.sessionId) return undefined;

	const source = readRecord(metadata.source);
	const subagent = readRecord(source?.subagent);
	const threadSpawn = readRecord(subagent?.thread_spawn);
	const nestedParentId = readString(threadSpawn?.parent_thread_id);
	if (!nestedParentId || nestedParentId === childSessionId) return undefined;
	const parentIds = [
		readString(metadata.parent_thread_id),
		nestedParentId,
	].filter((value): value is string => value !== undefined);
	if (parentIds.some((value) => value !== nestedParentId)) return undefined;

	const modelLine = lines.find(readPayloadModel);
	const model = modelLine && readPayloadModel(modelLine);
	const depth = threadSpawn?.depth;
	return {
		agentNickname: readString(threadSpawn?.agent_nickname),
		agentPath: readString(threadSpawn?.agent_path),
		childSessionId,
		depth:
			typeof depth === "number" && Number.isSafeInteger(depth) && depth > 0
				? depth
				: undefined,
		model: model ?? "codex",
		parentSessionId: nestedParentId,
		sessionDate: session.sessionDate,
		startTs: readString(sessionMeta?.timestamp) ?? session.sessionDate,
		workdir: readString(metadata.cwd),
	};
}

export function extractChildLineageEvidence(
	session: RawLineageSession,
): ChildLineageEvidence | undefined {
	return session.source === "codex"
		? extractCodexChildEvidence(session)
		: extractClaudeChildEvidence(session);
}

function extractCodexChildEvidence(
	session: RawLineageSession,
): ChildLineageEvidence | undefined {
	const lines = parseJsonLines(session.content);
	const sessionMeta = lines.find((line) => line.type === "session_meta");
	const metadata = readRecord(sessionMeta?.payload);
	if (
		metadata?.originator !== "codex_exec" ||
		metadata.thread_source === "subagent"
	) {
		return undefined;
	}
	const assistantMessageCount = lines.filter((line) => {
		const payload = readRecord(line.payload);
		return (
			line.type === "response_item" &&
			payload?.type === "message" &&
			payload.role === "assistant"
		);
	}).length;
	const model = lines
		.map((line) => readRecord(line.payload))
		.map((payload) => readString(payload?.model))
		.find(Boolean);
	const rootPrompt = readCodexRootPrompt(lines);
	return {
		assistantMessageCount,
		childFirstIngestedAt: session.firstIngestedAt,
		childLatestIngestedAt: session.latestIngestedAt,
		childSessionDate: session.sessionDate,
		childSessionId: readString(metadata.id) ?? session.sessionId,
		childSource: session.source,
		childStartTs: readString(sessionMeta?.timestamp) ?? session.sessionDate,
		entrypoint: undefined,
		model: model ?? "codex",
		organizationId: session.organizationId,
		originator: readString(metadata.originator),
		outcome: readOutcome(assistantMessageCount),
		provider: "openai",
		rootPrompt,
		threadSource: readString(metadata.thread_source),
		userId: session.userId,
		workdir: readString(metadata.cwd) ?? session.projectPath,
	};
}

function extractClaudeChildEvidence(
	session: RawLineageSession,
): ChildLineageEvidence | undefined {
	const lines = parseJsonLines(session.content);
	const rootUser = lines.find(
		(line) =>
			line.type === "user" &&
			(line.parentUuid === null || line.parentUuid === undefined) &&
			readMessageText(line.message) !== undefined,
	);
	const entrypoint = readString(rootUser?.entrypoint);
	if (entrypoint !== "sdk-cli") return undefined;
	const assistants = lines.filter((line) => line.type === "assistant");
	const model = assistants
		.map((line) => readString(readRecord(line.message)?.model))
		.find(Boolean);
	return {
		assistantMessageCount: assistants.length,
		childFirstIngestedAt: session.firstIngestedAt,
		childLatestIngestedAt: session.latestIngestedAt,
		childSessionDate: session.sessionDate,
		childSessionId: readString(rootUser?.sessionId) ?? session.sessionId,
		childSource: session.source,
		childStartTs: readString(rootUser?.timestamp) ?? session.sessionDate,
		entrypoint,
		model: model ?? "claude",
		organizationId: session.organizationId,
		originator: undefined,
		outcome: readOutcome(assistants.length),
		provider: "claude",
		rootPrompt: readMessageText(rootUser?.message),
		threadSource: undefined,
		userId: session.userId,
		workdir: readString(rootUser?.cwd) ?? session.projectPath,
	};
}

function readCodexRootPrompt(
	lines: readonly Readonly<Record<string, unknown>>[],
): string | undefined {
	const userMessages = lines.flatMap((line) => {
		const payload = readRecord(line.payload);
		if (
			line.type !== "response_item" ||
			payload?.type !== "message" ||
			payload.role !== "user"
		) {
			return [];
		}
		const content = Array.isArray(payload.content) ? payload.content : [];
		const texts = content.flatMap((item) => {
			const block = readRecord(item);
			return block?.type === "input_text" && typeof block.text === "string"
				? [block.text]
				: [];
		});
		return texts;
	});
	return userMessages.find(
		(text) =>
			!text.startsWith("# AGENTS.md instructions") &&
			!text.startsWith("<environment_context"),
	);
}

function readMessageText(value: unknown): string | undefined {
	const message = readRecord(value);
	if (typeof message?.content === "string") return message.content;
	if (!Array.isArray(message?.content)) return undefined;
	const texts = message.content.flatMap((item) => {
		const block = readRecord(item);
		return block?.type === "text" && typeof block.text === "string"
			? [block.text]
			: [];
	});
	return texts.length > 0 ? texts.join("\n") : undefined;
}

function readOutcome(assistantMessageCount: number): LineageOutcome {
	return assistantMessageCount > 0 ? "successful" : "failed";
}

function parseJsonLines(
	content: string,
): readonly Readonly<Record<string, unknown>>[] {
	return content.split("\n").flatMap((line) => {
		const record = parseJsonLine(line);
		return record ? [record] : [];
	});
}

function parseJsonLine(
	line: string,
): Readonly<Record<string, unknown>> | undefined {
	if (!line.trim()) return undefined;
	try {
		return readRecord(JSON.parse(line));
	} catch {
		return undefined;
	}
}

function readPayloadModel(
	line: Readonly<Record<string, unknown>>,
): string | undefined {
	return readString(readRecord(line.payload)?.model);
}

class LazyJsonLines {
	private readonly parsed: Readonly<Record<string, unknown>>[] = [];
	private next = 0;

	constructor(private readonly content: string) {}

	find(
		matches: (line: Readonly<Record<string, unknown>>) => unknown,
	): Readonly<Record<string, unknown>> | undefined {
		const found = this.parsed.find(matches);
		if (found) return found;
		for (let line = this.read(); line; line = this.read()) {
			if (matches(line)) return line;
		}
		return undefined;
	}

	private read(): Readonly<Record<string, unknown>> | undefined {
		while (this.next <= this.content.length) {
			const newline = this.content.indexOf("\n", this.next);
			const end = newline === -1 ? this.content.length : newline;
			const record = parseJsonLine(this.content.slice(this.next, end));
			this.next = newline === -1 ? this.content.length + 1 : newline + 1;
			if (record) {
				this.parsed.push(record);
				return record;
			}
		}
		return undefined;
	}
}

function readRecord(
	value: unknown,
): Readonly<Record<string, unknown>> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}
