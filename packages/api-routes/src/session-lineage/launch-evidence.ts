import { buildCodexActivityGraph } from "../session-transcript/codex-activity-graph.js";
import { classifyShellLaunch } from "./shell-launch.js";
import type { LaunchAnchor, RawLineageSession } from "./types.js";

const SESSION_ID_PATTERN =
	/\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|01[0-9a-z]{6}-[0-9a-z-]{27})\b/giu;

export function extractLaunchAnchors(
	session: RawLineageSession,
): readonly LaunchAnchor[] {
	return session.source === "codex"
		? extractCodexLaunchAnchors(session)
		: extractClaudeLaunchAnchors(session);
}

function extractCodexLaunchAnchors(
	session: RawLineageSession,
): readonly LaunchAnchor[] {
	const graph = buildCodexActivityGraph(session.content);
	const sessionWorkdir = readCodexSessionWorkdir(session.content);
	return graph.carriers.flatMap((carrier) =>
		carrier.operations.flatMap((operation, operationOrdinal) => {
			if (operation.name !== "exec_command") return [];
			const command = readString(operation.input.cmd);
			if (!command) return [];
			const classification = classifyShellLaunch(command);
			if (classification.disposition !== "launch") return [];
			return [
				{
					anchorTs: operation.timestamp,
					command,
					echoedSessionIds: readSessionIdsFromOutput(operation.outputBlocks),
					operationOrdinal,
					organizationId: session.organizationId,
					parentIngestedAt: session.latestIngestedAt,
					parentSessionDate: session.sessionDate,
					parentSessionId: session.sessionId,
					parentSource: session.source,
					prompt: classification.prompt,
					targetModel: classification.model,
					targetProvider: classification.targetProvider,
					toolUseId: carrier.callId,
					userId: session.userId,
					workdir:
						readString(operation.input.workdir) ??
						readString(operation.input.cwd) ??
						sessionWorkdir,
				},
			];
		}),
	);
}

function extractClaudeLaunchAnchors(
	session: RawLineageSession,
): readonly LaunchAnchor[] {
	const lines = parseJsonLines(session.content);
	const resultsByToolUseId = collectClaudeToolResults(lines);
	const anchors: LaunchAnchor[] = [];
	for (const line of lines) {
		if (line.type !== "assistant") continue;
		const message = readRecord(line.message);
		const content = Array.isArray(message?.content) ? message.content : [];
		let operationOrdinal = 0;
		for (const block of content) {
			const tool = readRecord(block);
			if (tool?.type !== "tool_use") continue;
			const input = readRecord(tool.input);
			const command = readString(input?.command);
			const name = readString(tool.name)?.toLowerCase();
			if (!command || name !== "bash") {
				operationOrdinal += 1;
				continue;
			}
			const classification = classifyShellLaunch(command);
			if (classification.disposition === "launch") {
				const toolUseId =
					readString(tool.id) ?? `claude-tool-${anchors.length}`;
				anchors.push({
					anchorTs: readString(line.timestamp) ?? session.sessionDate,
					command,
					echoedSessionIds: readSessionIds(
						resultsByToolUseId.get(toolUseId) ?? "",
					),
					operationOrdinal,
					organizationId: session.organizationId,
					parentIngestedAt: session.latestIngestedAt,
					parentSessionDate: session.sessionDate,
					parentSessionId: session.sessionId,
					parentSource: session.source,
					prompt: classification.prompt,
					targetModel: classification.model,
					targetProvider: classification.targetProvider,
					toolUseId,
					userId: session.userId,
					workdir:
						readString(input?.workdir) ??
						readString(line.cwd) ??
						session.projectPath,
				});
			}
			operationOrdinal += 1;
		}
	}
	return anchors;
}

function collectClaudeToolResults(
	lines: readonly Readonly<Record<string, unknown>>[],
): ReadonlyMap<string, string> {
	const results = new Map<string, string>();
	for (const line of lines) {
		const message = readRecord(line.message);
		const content = Array.isArray(message?.content) ? message.content : [];
		for (const block of content) {
			const result = readRecord(block);
			if (result?.type !== "tool_result") continue;
			const toolUseId = readString(result.tool_use_id);
			if (!toolUseId) continue;
			results.set(toolUseId, readTextContent(result.content));
		}
	}
	return results;
}

function readTextContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.flatMap((item) => {
			const block = readRecord(item);
			return typeof block?.text === "string" ? [block.text] : [];
		})
		.join("\n");
}

function readSessionIdsFromOutput(
	blocks: readonly { readonly type: string; readonly text?: string }[],
): readonly string[] {
	return readSessionIds(
		blocks
			.flatMap((block) => (block.type === "text" ? [block.text ?? ""] : []))
			.join("\n"),
	);
}

function readSessionIds(value: string): readonly string[] {
	return [...new Set(value.match(SESSION_ID_PATTERN) ?? [])];
}

function readCodexSessionWorkdir(content: string): string | undefined {
	for (const line of parseJsonLines(content)) {
		if (line.type !== "session_meta") continue;
		return readString(readRecord(line.payload)?.cwd);
	}
	return undefined;
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
