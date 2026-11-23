import { homedir } from "node:os";
import { join } from "node:path";
import type { IngestSessionInput } from "@rudel/api-routes";
import {
	type Ingestor,
	ingestRudelGeminiSessions,
	type RudelGeminiSessionsRow,
} from "@rudel/ch-schema/generated";
import { MissingTranscriptTimestampError } from "../../errors.js";
import { extractStrictTranscriptTimestamps } from "../../timestamps.js";
import type {
	AgentAdapter,
	IngestContext,
	ScannedProject,
	SessionFile,
	SessionTimestamps,
} from "../../types.js";
import { toClickHouseDateTime } from "../../utils.js";

export {
	GEMINI_TRANSCRIPT_VERSION,
	type GeminiTranscript,
	geminiUsage,
	inferAntigravityCwd,
	readGeminiCliRecord,
	translateAntigravityTranscript,
	translateGeminiCliSession,
} from "./transcript.js";

/**
 * Gemini CLI and Antigravity sessions. The Mac app imports them from disk and
 * translates them into Claude Code's transcript shape before they reach this
 * adapter; there is no CLI upload or hook for them.
 */
class GeminiAdapter implements AgentAdapter {
	name = "Gemini";
	source = "gemini" as const;
	rawTableName = "rudel.gemini_sessions";

	getSessionsBaseDir(): string {
		return join(
			process.env.GEMINI_CLI_HOME?.trim() || homedir(),
			".gemini",
			"tmp",
		);
	}

	async findProjectSessions(_projectPath: string): Promise<SessionFile[]> {
		return [];
	}

	async scanAllSessions(): Promise<ScannedProject[]> {
		return [];
	}

	getHookConfigPath(): string {
		return "";
	}

	installHook(): void {}

	removeHook(): void {}

	isHookInstalled(): boolean {
		return false;
	}

	async buildUploadRequest(): Promise<IngestSessionInput> {
		throw new Error("Gemini sessions are imported by the Opaline app");
	}

	extractTimestamps(content: string): SessionTimestamps | null {
		return extractStrictTranscriptTimestamps({
			content,
			isTimestampRecord: (record) =>
				record.type === "user" || record.type === "assistant",
			source: this.source,
		});
	}

	async ingest(
		ingestor: Ingestor,
		input: IngestSessionInput,
		context: IngestContext,
	): Promise<void> {
		await ingestRudelGeminiSessions(ingestor, [this.buildRow(input, context)]);
	}

	private buildRow(
		input: IngestSessionInput,
		context: IngestContext,
	): RudelGeminiSessionsRow {
		const timestamps =
			context.timestamps ?? this.extractTimestamps(input.content);
		if (!timestamps) throw new MissingTranscriptTimestampError(this.source);
		const subagents: Record<string, string> = {};
		for (const sub of input.subagents ?? [])
			subagents[sub.agentId] = sub.content;
		return {
			session_date: toClickHouseDateTime(timestamps.sessionDate),
			last_interaction_date: toClickHouseDateTime(
				timestamps.lastInteractionDate,
			),
			session_id: input.sessionId,
			organization_id: context.organizationId,
			project_path: input.projectPath,
			git_remote: input.gitRemote ?? "",
			package_name: input.packageName ?? "",
			package_type: input.packageType ?? "",
			content: input.content,
			filter_version: input.filter_version ?? 0,
			revision: context.revision,
			subagents,
			ingested_at: context.ingestedAt.toISOString().replace("Z", ""),
			user_id: context.userId,
			git_branch: input.gitBranch ?? null,
			git_sha: input.gitSha ?? null,
			tag: input.tag ?? null,
		};
	}
}

export const geminiAdapter = new GeminiAdapter();
