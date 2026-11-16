import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import {
	claudeCodeAdapter,
	codexAdapter,
	decodeProjectPath,
	extractAgentIds,
	readSubagentFiles,
} from "@rudel/agent-adapters";
import {
	type IngestSessionInput,
	IngestSessionInputSchema,
} from "@rudel/api-routes";
import { type GitInfo, getGitInfo } from "./git-info.js";
import { inferSessionRepository } from "./session-repository.js";
import { claudeProjectDirectory, claudeSessionId } from "./sources.js";

export type LocalSessionInput =
	| {
			readonly kind: "ready";
			readonly input: IngestSessionInput;
			readonly bytes: number;
	  }
	| { readonly kind: "skipped"; readonly reason: string };

const GIT_INFO_TTL_MS = 5 * 60_000;
const gitInfoCache = new Map<string, { at: number; info: Promise<GitInfo> }>();
const MAX_CACHED_PROJECTS = 512;

function cachedGitInfo(projectPath: string, now: number): Promise<GitInfo> {
	const cached = gitInfoCache.get(projectPath);
	if (cached && now - cached.at < GIT_INFO_TTL_MS) return cached.info;
	if (gitInfoCache.size >= MAX_CACHED_PROJECTS) gitInfoCache.clear();
	const info = getGitInfo(projectPath).catch(() => ({}));
	gitInfoCache.set(projectPath, { at: now, info });
	return info;
}

function firstRecordedCwd(content: string): string | null {
	let start = 0;
	for (let lines = 0; lines < 200 && start < content.length; lines++) {
		const end = content.indexOf("\n", start);
		const stop = end === -1 ? content.length : end;
		const line = content.slice(start, stop);
		start = stop + 1;
		if (!line.includes('"cwd"')) continue;
		try {
			const record = JSON.parse(line) as { cwd?: unknown };
			if (typeof record.cwd === "string" && record.cwd.startsWith("/"))
				return record.cwd;
		} catch {}
	}
	return null;
}

function codexMeta(content: string): {
	id: string | null;
	cwd: string;
	branch?: string;
	sha?: string;
} | null {
	const end = content.indexOf("\n");
	const first = end === -1 ? content : content.slice(0, end);
	try {
		const parsed = JSON.parse(first) as {
			type?: unknown;
			payload?: {
				id?: unknown;
				cwd?: unknown;
				git?: { branch?: unknown; commit_hash?: unknown; sha?: unknown };
			};
		};
		if (parsed.type !== "session_meta" || !parsed.payload) return null;
		const git = parsed.payload.git ?? {};
		const text = (value: unknown) =>
			typeof value === "string" ? value : undefined;
		return {
			id: text(parsed.payload.id) ?? null,
			cwd: text(parsed.payload.cwd) ?? "",
			branch: text(git.branch),
			sha: text(git.commit_hash) ?? text(git.sha),
		};
	} catch {
		return null;
	}
}

function byteLength(input: IngestSessionInput): number {
	let bytes = Buffer.byteLength(input.content, "utf8");
	for (const subagent of input.subagents ?? [])
		bytes += Buffer.byteLength(subagent.content, "utf8");
	return bytes;
}

export async function readSessionFile(path: string): Promise<string> {
	if (!path.endsWith(".zst")) return readFile(path, "utf8");
	return zstdDecompressSync(await readFile(path)).toString("utf8");
}

export async function buildLocalSessionInput(input: {
	readonly sessionPath: string;
	readonly source: "claude_code" | "codex";
	readonly organizationId: string;
	readonly now: number;
}): Promise<LocalSessionInput> {
	const content = await readSessionFile(input.sessionPath);
	if (input.source === "codex") {
		const meta = codexMeta(content);
		if (!meta) return { kind: "skipped", reason: "not a Codex session" };
		if (!codexAdapter.extractTimestamps(content))
			return { kind: "skipped", reason: "no timestamped records" };
		const gitInfo = meta.cwd ? await cachedGitInfo(meta.cwd, input.now) : {};
		const inferred = await inferSessionRepository({
			projectPath: meta.cwd,
			gitRemote: gitInfo.gitRemote,
			packageName: gitInfo.packageName,
			streams: [content],
		}).catch(() => null);
		const repository = inferred ?? gitInfo;
		return parsed(
			{
				source: "codex",
				sessionId:
					meta.id ??
					basename(input.sessionPath).replace(/\.jsonl(?:\.zst)?$/u, ""),
				projectPath: meta.cwd,
				gitRemote: repository.gitRemote,
				packageName: repository.packageName,
				packageType: repository.packageType,
				gitBranch: inferred ? inferred.branch : (meta.branch ?? gitInfo.branch),
				gitSha: inferred ? inferred.sha : (meta.sha ?? gitInfo.sha),
				content,
				organizationId: input.organizationId,
				upload_mode: "hook",
			},
			input.sessionPath,
		);
	}
	if (!claudeCodeAdapter.extractTimestamps(content))
		return {
			kind: "skipped",
			reason: "no timestamped user or assistant messages",
		};
	const sessionId = claudeSessionId(input.sessionPath);
	const subagents = await readSubagentFiles(
		dirname(input.sessionPath),
		extractAgentIds(content),
		sessionId,
	);
	const projectPath =
		firstRecordedCwd(content) ??
		(await decodeProjectPath(claudeProjectDirectory(input.sessionPath)));
	const gitInfo = await cachedGitInfo(projectPath, input.now);
	const inferred = await inferSessionRepository({
		projectPath,
		gitRemote: gitInfo.gitRemote,
		packageName: gitInfo.packageName,
		streams: [content, ...subagents.map((subagent) => subagent.content)],
	}).catch(() => null);
	const repository = inferred ?? gitInfo;
	return parsed(
		{
			source: "claude_code",
			sessionId,
			projectPath,
			gitRemote: repository.gitRemote,
			packageName: repository.packageName,
			packageType: repository.packageType,
			gitBranch: repository.branch,
			gitSha: repository.sha,
			content,
			subagents: subagents.length > 0 ? subagents : undefined,
			organizationId: input.organizationId,
			upload_mode: "hook",
		},
		input.sessionPath,
	);
}

function parsed(raw: unknown, path: string): LocalSessionInput {
	const result = IngestSessionInputSchema.safeParse(raw);
	if (!result.success)
		return {
			kind: "skipped",
			reason: `${basename(path)} is not a session Opaline can store: ${result.error.issues
				.map((issue) => `${issue.path.join(".")} ${issue.message}`)
				.join("; ")
				.slice(0, 300)}`,
		};
	return { kind: "ready", input: result.data, bytes: byteLength(result.data) };
}
