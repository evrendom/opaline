import type {
	ChildLineageEvidence,
	LineageOutcome,
	RawLineageSession,
} from "./types.js";

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
		if (!line.trim()) return [];
		try {
			const parsed: unknown = JSON.parse(line);
			const record = readRecord(parsed);
			return record ? [record] : [];
		} catch {
			return [];
		}
	});
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
