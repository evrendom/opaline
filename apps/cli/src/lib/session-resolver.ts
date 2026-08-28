import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
	decodeProjectPath,
	findActiveRolloutFile,
	readCodexSessionMeta,
} from "@rudel/agent-adapters";
import type { Source } from "@rudel/api-routes";

export const SESSIONS_BASE_DIR = join(homedir(), ".claude", "projects");

export interface SessionInfo {
	source: Source;
	transcriptPath: string;
	projectPath: string;
	sessionDir: string;
	sessionId: string;
}

export async function resolveSession(input: string): Promise<SessionInfo> {
	const isPath = input.includes("/") || input.endsWith(".jsonl");

	if (isPath) {
		return resolveFromPath(input);
	}
	return resolveFromId(input);
}

async function resolveFromPath(filePath: string): Promise<SessionInfo> {
	const filename = basename(filePath);
	validateNotSubagent(filename);

	try {
		await access(filePath);
	} catch {
		throw new Error(`Session file not found: ${filePath}`);
	}

	const sessionId = filename.replace(/\.jsonl$/, "");
	const sessionDir = dirname(filePath);
	const codexMeta = await readCodexSessionMeta(filePath);
	if (codexMeta) {
		if (!codexMeta.id || !codexMeta.cwd) {
			throw new Error("Could not read Codex session metadata.");
		}
		return {
			source: "codex",
			transcriptPath: filePath,
			projectPath: codexMeta.cwd,
			sessionDir,
			sessionId: codexMeta.id,
		};
	}

	// Walk up from sessionDir to find the project directory name
	// Sessions live at: ~/.claude/projects/<encoded-project-dir>/<sessionId>.jsonl
	const parentDir = basename(sessionDir);
	const projectPath = await decodeProjectPath(parentDir);

	return {
		source: "claude_code",
		transcriptPath: filePath,
		projectPath,
		sessionDir,
		sessionId,
	};
}

async function resolveFromId(sessionId: string): Promise<SessionInfo> {
	validateNotSubagent(`${sessionId}.jsonl`);
	const sessionFileName = `${sessionId}.jsonl`;

	let projectDirs: string[];
	try {
		projectDirs = await readdir(SESSIONS_BASE_DIR);
	} catch {
		throw new Error(`Session not found: ${sessionId}`);
	}

	for (const projectDir of projectDirs) {
		const sessionDir = join(SESSIONS_BASE_DIR, projectDir);
		try {
			const files = await readdir(sessionDir);
			if (files.includes(sessionFileName)) {
				const transcriptPath = join(sessionDir, sessionFileName);
				const projectPath = await decodeProjectPath(projectDir);
				return {
					source: "claude_code",
					transcriptPath,
					projectPath,
					sessionDir,
					sessionId,
				};
			}
		} catch {}
	}

	try {
		const transcriptPath = await findActiveRolloutFile(sessionId);
		if (transcriptPath) {
			const meta = await readCodexSessionMeta(transcriptPath);
			if (!meta?.id || !meta.cwd) {
				throw new Error("Could not read Codex session metadata.");
			}
			return {
				source: "codex",
				transcriptPath,
				projectPath: meta.cwd,
				sessionDir: dirname(transcriptPath),
				sessionId: meta.id,
			};
		}
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === "Could not read Codex session metadata."
		) {
			throw error;
		}
	}

	throw new Error(`Session not found: ${sessionId}`);
}

function validateNotSubagent(filename: string): void {
	if (filename.startsWith("agent-") && filename.endsWith(".jsonl")) {
		throw new Error(
			"This is a subagent file, not a main session. Please provide the main session ID or path.",
		);
	}
}
