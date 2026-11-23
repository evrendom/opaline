import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type GeminiTranscript,
	inferAntigravityCwd,
	translateAntigravityTranscript,
	translateGeminiCliSession,
} from "@rudel/agent-adapters";
import { isAntigravityTranscript } from "./sources.js";
import { createImageCollector } from "./transcript-file/images.js";
import type {
	ReadFile,
	SessionRead,
	SubagentTranscript,
} from "./transcript-file/index.js";
import { rawLines, readLines, slimText } from "./transcript-file/reader.js";

/** Subagent chats read per session, like Claude Code's limit. */
const MAX_SUBAGENTS = 512;

export interface GeminiSessionRead extends SessionRead {
	readonly transcript: GeminiTranscript | null;
	readonly projectPath: string;
}

async function readRaw(
	path: string,
	files: ReadFile[],
): Promise<string | null> {
	try {
		const read = await readLines(path, null, rawLines());
		files.push({ ...read.identity, path });
		return read.lines.join("\n");
	} catch {
		return null;
	}
}

async function readText(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

/**
 * The folder a Gemini CLI project folder (`~/.gemini/tmp/<id>`) belongs to:
 * its `.project_root` file, else the `projects.json` entry naming it, else
 * (older versions named folders by the folder's SHA-256) the entry hashing to it.
 */
export async function geminiCliProjectRoot(
	projectDirectory: string,
): Promise<string | null> {
	const recorded = (
		await readText(join(projectDirectory, ".project_root"))
	)?.trim();
	if (recorded?.startsWith("/")) return recorded;
	const id = basename(projectDirectory);
	const registry = await readText(
		join(dirname(dirname(projectDirectory)), "projects.json"),
	);
	if (!registry) return null;
	try {
		const projects = (JSON.parse(registry) as { projects?: unknown }).projects;
		if (!projects || typeof projects !== "object") return null;
		for (const [root, slug] of Object.entries(
			projects as Record<string, unknown>,
		))
			if (slug === id || createHash("sha256").update(root).digest("hex") === id)
				return root;
	} catch {}
	return null;
}

interface AntigravitySummary {
	readonly title: string;
	readonly workspaces: readonly string[];
	readonly parentId: string;
	readonly childIds: readonly string[];
}

/**
 * What Antigravity keeps beside its transcripts about a conversation, in
 * `<appData>/conversation_summaries.db`: its title, its workspace folders and
 * the conversation that started it (a subagent's parent). Read-only; the
 * database is Antigravity's and may be open while it runs.
 */
export function readAntigravitySummary(
	conversationDirectory: string,
): AntigravitySummary | null {
	const appData = dirname(dirname(conversationDirectory));
	const id = basename(conversationDirectory);
	let database: Database | undefined;
	try {
		database = new Database(join(appData, "conversation_summaries.db"), {
			readonly: true,
		});
		const row = database
			.query<
				{
					title: string;
					workspace_uris: string;
					parent_conversation_id: string;
				},
				[string]
			>(
				"SELECT title, workspace_uris, parent_conversation_id FROM conversation_summaries WHERE conversation_id = ?",
			)
			.get(id);
		if (!row) return null;
		const children = database
			.query<{ conversation_id: string }, [string]>(
				"SELECT conversation_id FROM conversation_summaries WHERE parent_conversation_id = ? ORDER BY conversation_id",
			)
			.all(id);
		let uris: unknown = [];
		try {
			uris = JSON.parse(row.workspace_uris);
		} catch {}
		return {
			title: row.title,
			workspaces: (Array.isArray(uris) ? uris : [])
				.filter((uri): uri is string => typeof uri === "string")
				.flatMap((uri) => {
					try {
						return uri.startsWith("file:") ? [fileURLToPath(uri)] : [];
					} catch {
						return [];
					}
				}),
			parentId: row.parent_conversation_id,
			childIds: children.map((child) => child.conversation_id),
		};
	} catch {
		return null;
	} finally {
		database?.close();
	}
}

/**
 * The folder the conversation worked in: the workspace folder its paths use
 * most; when none of them is used (Antigravity also works in folders it was
 * not opened on, such as a worktree), the git repository its file tools
 * touched most; else the first workspace folder.
 */
export function chooseWorkspace(
	workspaces: readonly string[],
	raw: string,
	repositoryOf: (path: string) => string | null = gitRepositoryOf,
): string | undefined {
	let best: { path: string; uses: number } | undefined;
	for (const path of workspaces) {
		const uses = raw.split(`${path}/`).length - 1;
		if (!best || uses > best.uses) best = { path, uses };
	}
	if (best && best.uses > 0) return best.path;
	const repositories = new Map<string, number>();
	for (const match of raw.matchAll(TOOL_PATH)) {
		const path = match[1];
		const repository = path ? repositoryOf(path) : null;
		if (repository)
			repositories.set(repository, (repositories.get(repository) ?? 0) + 1);
	}
	const touched = [...repositories].sort(
		(left, right) => right[1] - left[1],
	)[0];
	return touched?.[0] ?? best?.path;
}

/** Absolute paths in file tool arguments (quoted or not). */
const TOOL_PATH =
	/"(?:Path|AbsolutePath|TargetFile|FilePath|DirectoryPath|SearchPath)"\s*:\s*"(?:\\")?(\/[^"\\]+)/gu;

const repositoryCache = new Map<string, string | null>();

/** The nearest folder holding `.git` at or above `path`'s folder. */
function gitRepositoryOf(path: string): string | null {
	let directory = dirname(path);
	const visited: string[] = [];
	while (directory !== dirname(directory)) {
		const known = repositoryCache.get(directory);
		if (known !== undefined) {
			for (const each of visited) repositoryCache.set(each, known);
			return known;
		}
		visited.push(directory);
		if (existsSync(join(directory, ".git"))) {
			for (const each of visited) repositoryCache.set(each, directory);
			return directory;
		}
		directory = dirname(directory);
	}
	for (const each of visited) repositoryCache.set(each, null);
	return null;
}

async function readAntigravitySubagents(
	brain: string,
	ids: readonly string[],
	options: { cwd: string; defaultModel: string | undefined },
	files: ReadFile[],
): Promise<{ agentId: string; content: string }[]> {
	const subagents: { agentId: string; content: string }[] = [];
	for (const agentId of [...new Set(ids)].sort()) {
		if (subagents.length >= MAX_SUBAGENTS) break;
		if (!/^[A-Za-z0-9_-]{1,200}$/u.test(agentId)) continue;
		const logs = join(brain, agentId, ".system_generated", "logs");
		const raw =
			(await readRaw(join(logs, "transcript_full.jsonl"), files)) ??
			(await readRaw(join(logs, "transcript.jsonl"), files));
		if (!raw) continue;
		const translated = translateAntigravityTranscript(raw, agentId, {
			...options,
			agentId,
		});
		if (translated?.content)
			subagents.push({ agentId, content: translated.content });
	}
	return subagents;
}

/** The model Antigravity was set to, for steps that do not record one. */
async function antigravityDefaultModel(
	conversationDirectory: string,
): Promise<string | undefined> {
	const appData = dirname(dirname(conversationDirectory));
	const text = await readText(join(appData, "settings.json"));
	if (!text) return undefined;
	try {
		const settings = JSON.parse(text) as Record<string, unknown>;
		for (const key of ["model", "defaultModel", "selectedModel"]) {
			const value = settings[key];
			if (typeof value === "string" && value.startsWith("gemini")) return value;
			if (value && typeof value === "object") {
				const name = (value as Record<string, unknown>).name;
				if (typeof name === "string" && name.startsWith("gemini")) return name;
			}
		}
	} catch {}
	return undefined;
}

async function readGeminiCliSubagents(
	sessionPath: string,
	transcript: GeminiTranscript,
	projectPath: string,
	files: ReadFile[],
): Promise<{ agentId: string; content: string }[]> {
	// Gemini CLI keeps a session's subagents in chats/<parent session id>/.
	const directory = join(dirname(sessionPath), transcript.sessionId);
	const names = await readdir(directory).catch(() => [] as string[]);
	const subagents: { agentId: string; content: string }[] = [];
	for (const name of names.sort()) {
		if (subagents.length >= MAX_SUBAGENTS) break;
		if (!name.endsWith(".jsonl") && !name.endsWith(".json")) continue;
		const raw = await readRaw(join(directory, name), files);
		if (!raw) continue;
		const agentId = name.replace(/\.jsonl?$/u, "");
		const translated = translateGeminiCliSession(raw, {
			cwd: projectPath,
			agentId,
		});
		if (translated?.content)
			subagents.push({ agentId, content: translated.content });
	}
	return subagents;
}

/**
 * Reads a Gemini CLI or Antigravity session and translates it into Claude
 * Code's transcript shape. The file is read whole: the stored transcript is a
 * translation, so it cannot be extended by appending the file's new lines.
 */
export async function readGeminiSession(
	sessionPath: string,
): Promise<GeminiSessionRead> {
	const images = createImageCollector();
	const files: ReadFile[] = [];
	const antigravity = isAntigravityTranscript(sessionPath);
	let transcript: GeminiTranscript | null = null;
	let projectPath = "";
	let subagents: { agentId: string; content: string }[] = [];
	if (antigravity) {
		const logs = dirname(sessionPath);
		const conversationDirectory = dirname(dirname(logs));
		const compact = await readRaw(sessionPath, files);
		// The full transcript keeps the outputs the compact one truncates.
		const full = await readRaw(join(logs, "transcript_full.jsonl"), files);
		const raw = full ?? compact;
		if (raw) {
			const conversationId = basename(conversationDirectory);
			const summary = readAntigravitySummary(conversationDirectory);
			projectPath =
				chooseWorkspace(summary?.workspaces ?? [], raw) ??
				inferAntigravityCwd(raw) ??
				"";
			const modified = await stat(sessionPath).catch(() => null);
			const defaultModel = await antigravityDefaultModel(conversationDirectory);
			transcript = translateAntigravityTranscript(raw, conversationId, {
				cwd: projectPath,
				defaultModel,
				fallbackTimestamp: modified?.mtime.toISOString(),
				title: summary?.title || undefined,
				// A subagent's conversation is imported with its parent's.
				agentId: summary?.parentId ? conversationId : undefined,
			});
			if (transcript && transcript.kind === "main")
				subagents = await readAntigravitySubagents(
					dirname(conversationDirectory),
					[...transcript.subagentIds, ...(summary?.childIds ?? [])],
					{ cwd: projectPath, defaultModel },
					files,
				);
		}
	} else {
		const raw = await readRaw(sessionPath, files);
		projectPath =
			(await geminiCliProjectRoot(dirname(dirname(sessionPath)))) ?? "";
		if (raw) {
			transcript = translateGeminiCliSession(raw, { cwd: projectPath });
			if (!projectPath && transcript?.directories[0]) {
				projectPath = transcript.directories[0];
				transcript = translateGeminiCliSession(raw, { cwd: projectPath });
			}
			if (transcript && transcript.kind === "main")
				subagents = await readGeminiCliSubagents(
					sessionPath,
					transcript,
					projectPath,
					files,
				);
		}
	}
	const content = transcript ? slimText(transcript.content, "", images) : "";
	const slimmedSubagents: SubagentTranscript[] = subagents.map((subagent) => ({
		agentId: subagent.agentId,
		content: slimText(subagent.content, subagent.agentId, images),
	}));
	return {
		transcript,
		projectPath,
		content,
		revision: { kind: "whole", reason: "rewritten" },
		subagents: async () => slimmedSubagents,
		images: () => images.images(),
		imageDirectory: () => images.directory(),
		discardImages: () => images.discard(),
		files: () => files,
	};
}
