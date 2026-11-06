import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { IngestSessionInput } from "@rudel/api-routes";
import {
	type Ingestor,
	ingestRudelClaudeSessions,
	type RudelClaudeSessionsRow,
} from "@rudel/ch-schema/generated";
import { MissingTranscriptTimestampError } from "../../errors.js";
import { extractStrictTranscriptTimestamps } from "../../timestamps.js";
import type {
	AgentAdapter,
	IngestContext,
	ScannedProject,
	SessionFile,
	SessionTimestamps,
	UploadContext,
} from "../../types.js";
import {
	readFileWithRetry,
	toClickHouseDateTime,
	toDisplayPath,
} from "../../utils.js";
import {
	addHook,
	getClaudeSettingsPath,
	isHookEnabled,
	removeHook,
} from "./settings.js";

const SESSIONS_BASE_DIR = join(homedir(), ".claude", "projects");
const SAFE_BASENAME_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const SUBAGENT_FILE_PATTERN = /^agent-(.+)\.jsonl$/;
const MAX_SUBAGENT_FILES = 512;

// ── Exported utilities ──

export function encodeProjectPath(projectPath: string): string {
	return projectPath.replace(/\//g, "-");
}

export async function decodeProjectPath(encodedDir: string): Promise<string> {
	const parts = encodedDir.replace(/^-/, "").split("-");

	async function findPath(
		partIndex: number,
		currentPath: string,
	): Promise<string | null> {
		if (partIndex >= parts.length) {
			try {
				await stat(currentPath);
				return currentPath;
			} catch {
				return null;
			}
		}

		for (let endIndex = parts.length; endIndex > partIndex; endIndex--) {
			const segment = parts.slice(partIndex, endIndex).join("-");
			const testPath = currentPath
				? `${currentPath}/${segment}`
				: `/${segment}`;

			try {
				await stat(testPath);
				if (endIndex === parts.length) {
					return testPath;
				}
				const result = await findPath(endIndex, testPath);
				if (result) {
					return result;
				}
			} catch {
				// Path doesn't exist, try shorter segment
			}
		}

		return null;
	}

	const result = await findPath(0, "");
	if (result) {
		return result;
	}

	return `/${parts.join("/")}`;
}

export function extractAgentIds(sessionContent: string): string[] {
	const agentIds = new Set<string>();

	for (const line of sessionContent.split("\n")) {
		if (!line.trim()) continue;

		try {
			const entry: unknown = JSON.parse(line);
			if (!isRecord(entry) || !isRecord(entry.toolUseResult)) continue;

			const agentId = entry.toolUseResult.agentId;
			if (isSafeBasename(agentId)) {
				agentIds.add(agentId);
			}
		} catch {
			// Skip malformed lines
		}
	}

	return Array.from(agentIds);
}

interface SubagentFile {
	agentId: string;
	content: string;
}

export async function readSubagentFiles(
	sessionDir: string,
	agentIds: string[],
	sessionId?: string,
): Promise<SubagentFile[]> {
	const subagents: SubagentFile[] = [];
	const subagentDirs = await resolveSubagentDirectories(sessionDir, sessionId);
	const queued = new Set(agentIds.filter(isSafeBasename));
	const queue = [...queued];
	for (const agentId of await listSessionSubagentIds(subagentDirs.slice(1))) {
		if (queued.size >= MAX_SUBAGENT_FILES || queued.has(agentId)) continue;
		queued.add(agentId);
		queue.push(agentId);
	}

	for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
		const agentId = queue[queueIndex];
		if (!agentId) continue;
		if (!isSafeBasename(agentId)) continue;

		for (const subagentDir of subagentDirs) {
			let agentPath: string;
			try {
				agentPath = await realpath(join(subagentDir, `agent-${agentId}.jsonl`));
			} catch {
				continue;
			}
			if (!isContainedPath(subagentDir, agentPath)) continue;

			try {
				const content = await readFile(agentPath, "utf-8");
				subagents.push({ agentId, content });
				for (const nestedAgentId of extractAgentIds(content)) {
					if (queued.size >= MAX_SUBAGENT_FILES || queued.has(nestedAgentId))
						continue;
					queued.add(nestedAgentId);
					queue.push(nestedAgentId);
				}
				break;
			} catch {
				// Try next path
			}
		}
	}

	return subagents;
}

// ── Adapter ──

class ClaudeCodeAdapter implements AgentAdapter {
	name = "Claude Code";
	source = "claude_code" as const;
	rawTableName = "rudel.claude_sessions";

	getSessionsBaseDir(): string {
		return SESSIONS_BASE_DIR;
	}

	async findProjectSessions(projectPath: string): Promise<SessionFile[]> {
		const encoded = encodeProjectPath(projectPath);
		const sessionDir = join(SESSIONS_BASE_DIR, encoded);

		const files = await this.listSessionFiles(sessionDir, projectPath);
		if (files.length > 0) return files;

		return this.findByDecoding(projectPath);
	}

	async scanAllSessions(): Promise<ScannedProject[]> {
		let projectDirs: string[];
		try {
			projectDirs = await readdir(SESSIONS_BASE_DIR);
		} catch {
			return [];
		}

		const projects: ScannedProject[] = [];

		for (const dir of projectDirs) {
			const sessionDir = `${SESSIONS_BASE_DIR}/${dir}`;
			let files: string[];
			try {
				files = await readdir(sessionDir);
			} catch {
				continue;
			}

			const sessionFiles = files.filter(
				(f) => f.endsWith(".jsonl") && !f.startsWith("agent-"),
			);

			if (sessionFiles.length === 0) continue;

			const decodedPath = await decodeProjectPath(dir);

			const sessions: SessionFile[] = sessionFiles.map((f) => ({
				sessionId: f.replace(/\.jsonl$/, ""),
				transcriptPath: join(sessionDir, f),
				projectPath: decodedPath,
			}));

			projects.push({
				source: this.source,
				projectPath: decodedPath,
				displayPath: toDisplayPath(decodedPath),
				sessions,
				sessionCount: sessions.length,
			});
		}

		return projects;
	}

	getHookConfigPath(): string {
		return getClaudeSettingsPath();
	}

	installHook(): void {
		addHook();
	}

	removeHook(): void {
		removeHook();
	}

	isHookInstalled(): boolean {
		return isHookEnabled();
	}

	async buildUploadRequest(
		session: SessionFile,
		context: UploadContext,
	): Promise<IngestSessionInput> {
		const content = await readFileWithRetry(session.transcriptPath);
		if (!this.extractTimestamps(content)) {
			throw new MissingTranscriptTimestampError(this.source);
		}

		const subagents = await readSubagentFiles(
			dirname(session.transcriptPath),
			extractAgentIds(content),
			session.sessionId,
		);

		return {
			source: this.source,
			sessionId: session.sessionId,
			projectPath: session.projectPath,
			gitRemote: context.gitInfo.gitRemote,
			packageName: context.gitInfo.packageName,
			packageType: context.gitInfo.packageType,
			gitBranch: context.gitInfo.branch,
			gitSha: context.gitInfo.sha,
			tag: context.tag,
			content,
			subagents: subagents.length > 0 ? subagents : undefined,
			organizationId: context.organizationId,
			upload_mode: context.uploadMode,
		};
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
		const row = this.buildRow(input, context);
		await ingestRudelClaudeSessions(ingestor, [row]);
	}

	private buildRow(
		input: IngestSessionInput,
		context: IngestContext,
	): RudelClaudeSessionsRow {
		const now = context.ingestedAt.toISOString().replace("Z", "");

		const subagents: Record<string, string> = {};
		if (input.subagents) {
			for (const sub of input.subagents) {
				subagents[sub.agentId] = sub.content;
			}
		}

		const timestamps =
			context.timestamps ?? this.extractTimestamps(input.content);
		if (!timestamps) {
			throw new MissingTranscriptTimestampError(this.source);
		}

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
			ingested_at: now,
			user_id: context.userId,
			git_branch: input.gitBranch ?? null,
			git_sha: input.gitSha ?? null,
			tag: input.tag ?? null,
		};
	}

	private async listSessionFiles(
		sessionDir: string,
		projectPath: string,
	): Promise<SessionFile[]> {
		try {
			const entries = await readdir(sessionDir);
			return entries
				.filter((f) => f.endsWith(".jsonl") && !f.startsWith("agent-"))
				.map((f) => ({
					sessionId: f.replace(/\.jsonl$/, ""),
					transcriptPath: join(sessionDir, f),
					projectPath,
				}));
		} catch {
			return [];
		}
	}

	private async findByDecoding(projectPath: string): Promise<SessionFile[]> {
		let projectDirs: string[];
		try {
			projectDirs = await readdir(SESSIONS_BASE_DIR);
		} catch {
			return [];
		}

		for (const dir of projectDirs) {
			try {
				const decoded = await decodeProjectPath(dir);
				if (decoded === projectPath) {
					const sessionDir = join(SESSIONS_BASE_DIR, dir);
					return this.listSessionFiles(sessionDir, projectPath);
				}
			} catch {
				// skip undecodable dirs
			}
		}

		return [];
	}
}

export const claudeCodeAdapter = new ClaudeCodeAdapter();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isSafeBasename(value: unknown): value is string {
	return typeof value === "string" && SAFE_BASENAME_PATTERN.test(value);
}

async function resolveSubagentDirectories(
	sessionDir: string,
	sessionId: string | undefined,
): Promise<string[]> {
	let canonicalSessionDir: string;
	try {
		canonicalSessionDir = await realpath(sessionDir);
	} catch {
		return [];
	}

	const directories = [canonicalSessionDir];
	if (!isSafeBasename(sessionId)) {
		return directories;
	}

	try {
		const nestedDir = await realpath(
			join(canonicalSessionDir, sessionId, "subagents"),
		);
		if (isContainedPath(canonicalSessionDir, nestedDir)) {
			directories.push(nestedDir);
		}
	} catch {
		// The nested subagent directory is optional.
	}

	return directories;
}

async function listSessionSubagentIds(
	sessionSubagentDirs: readonly string[],
): Promise<string[]> {
	const agentIds: string[] = [];
	for (const directory of sessionSubagentDirs) {
		let names: string[];
		try {
			names = await readdir(directory);
		} catch {
			continue;
		}
		for (const name of names.sort()) {
			const agentId = SUBAGENT_FILE_PATTERN.exec(name)?.[1];
			if (isSafeBasename(agentId)) agentIds.push(agentId);
		}
	}
	return agentIds;
}

function isContainedPath(parentPath: string, candidatePath: string): boolean {
	const pathFromParent = relative(parentPath, candidatePath);
	return (
		pathFromParent !== "" &&
		pathFromParent !== ".." &&
		!pathFromParent.startsWith(`..${sep}`) &&
		!isAbsolute(pathFromParent)
	);
}
