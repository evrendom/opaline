import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import type { IngestSessionInput } from "@rudel/api-routes";
import { exec } from "./exec.js";
import { type GitInfo, getGitInfo, getGitRemoteUrl } from "./git-info.js";

// A session started outside a repository (a scratch folder, an empty launcher
// repository, a folder that only links to projects) still works in one: its
// tool calls edit, read and run commands there. Attribute it to the repository
// with the most such activity, edits counting more than reads and commands.

const WRITE_WEIGHT = 3;
const LOCATION_WEIGHT = 1;
// One edit, or two other signals: a single read elsewhere is not the session's work.
const MIN_REPOSITORY_SCORE = 2;
const MAX_RESOLVED_DIRECTORIES = 32;

const WRITE_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);
const LOCATION_TOOLS = new Set(["Glob", "Grep", "LS", "Read"]);
const PATCH_FILE_PATTERN =
	/\*\*\* (?:Add|Update|Delete) File: ([^\n\\"]+)|\*\*\* Move to: ([^\n\\"]+)/gu;
const SHELL_PATH_PATTERN =
	/(?:^|[\s;&|("'])(?:cd|git\s+-C)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)'"\\]+))/gu;
const WORKDIR_PATTERN = /"?workdir"?\s*:\s*\\?"([^"\\]+)\\?"/gu;

export interface SessionPathSignal {
	readonly path: string;
	readonly weight: number;
}

/**
 * Fills in the repository of a session whose working directory has none (no
 * origin remote and no package), from the paths its tool calls worked in.
 */
export async function withInferredSessionRepository(
	request: IngestSessionInput,
): Promise<IngestSessionInput> {
	if (request.gitRemote || request.packageName) return request;
	const gitInfo = await inferSessionGitInfo(
		[request.content, ...(request.subagents ?? []).map((sub) => sub.content)],
		request.projectPath,
	);
	if (!gitInfo?.gitRemote) return request;
	return {
		...request,
		gitRemote: gitInfo.gitRemote,
		packageName: gitInfo.packageName,
		packageType: gitInfo.packageType,
		gitBranch: gitInfo.branch,
		gitSha: gitInfo.sha,
	};
}

export async function inferSessionGitInfo(
	transcripts: readonly string[],
	projectPath: string,
): Promise<GitInfo | null> {
	const signals = transcripts.flatMap((content) =>
		collectSessionPathSignals(content, projectPath),
	);
	const root = await pickSessionRepositoryRoot(signals);
	return root ? getGitInfo(root) : null;
}

/** Paths a Claude Code or Codex transcript's tool calls wrote, read or ran in. */
export function collectSessionPathSignals(
	content: string,
	projectPath: string,
): SessionPathSignal[] {
	const signals: SessionPathSignal[] = [];
	for (const line of content.split("\n")) {
		if (!line.includes("tool_use") && !line.includes("_call")) continue;
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(record)) continue;
		collectClaudeSignals(record, projectPath, signals);
		collectCodexSignals(record, projectPath, signals);
	}
	return signals;
}

function collectClaudeSignals(
	record: Record<string, unknown>,
	projectPath: string,
	signals: SessionPathSignal[],
) {
	const message = record.message;
	if (!isRecord(message) || !Array.isArray(message.content)) return;
	for (const block of message.content) {
		if (!isRecord(block) || block.type !== "tool_use") continue;
		if (typeof block.name !== "string" || !isRecord(block.input)) continue;
		const input = block.input;
		if (WRITE_TOOLS.has(block.name)) {
			pushPath(signals, input.file_path, projectPath, WRITE_WEIGHT);
		} else if (block.name === "NotebookEdit") {
			pushPath(signals, input.notebook_path, projectPath, WRITE_WEIGHT);
		} else if (LOCATION_TOOLS.has(block.name)) {
			pushPath(signals, input.file_path, projectPath, LOCATION_WEIGHT);
			pushPath(signals, input.path, projectPath, LOCATION_WEIGHT);
		} else if (block.name === "Bash" && typeof input.command === "string") {
			collectShellSignals(input.command, signals);
		}
	}
}

function collectCodexSignals(
	record: Record<string, unknown>,
	projectPath: string,
	signals: SessionPathSignal[],
) {
	const payload = record.payload;
	if (record.type !== "response_item" || !isRecord(payload)) return;
	if (payload.type === "local_shell_call" && isRecord(payload.action)) {
		const { command, working_directory: workdir } = payload.action;
		pushPath(signals, workdir, projectPath, LOCATION_WEIGHT);
		if (Array.isArray(command)) collectShellSignals(command.join(" "), signals);
		return;
	}
	const text =
		payload.type === "function_call"
			? payload.arguments
			: payload.type === "custom_tool_call"
				? payload.input
				: undefined;
	if (typeof text !== "string") return;

	const args = parseJsonObject(text);
	const workdir =
		typeof args?.workdir === "string" ? args.workdir : projectPath;
	if (args) {
		pushPath(signals, args.workdir, projectPath, LOCATION_WEIGHT);
		const command = Array.isArray(args.command)
			? args.command.join(" ")
			: (args.cmd ?? args.command);
		if (typeof command === "string") collectShellSignals(command, signals);
	} else {
		// Tool calls wrapped in code (such as `exec`) are scanned as text.
		for (const match of text.matchAll(WORKDIR_PATTERN)) {
			pushPath(signals, match[1], projectPath, LOCATION_WEIGHT);
		}
		collectShellSignals(text, signals);
	}
	for (const match of text.matchAll(PATCH_FILE_PATTERN)) {
		pushPath(signals, (match[1] ?? match[2])?.trim(), workdir, WRITE_WEIGHT);
	}
}

function collectShellSignals(command: string, signals: SessionPathSignal[]) {
	for (const match of command.matchAll(SHELL_PATH_PATTERN)) {
		const path = match[1] ?? match[2] ?? match[3];
		// Relative shell paths depend on earlier commands, so only absolute ones count.
		if (path && (isAbsolute(path) || path.startsWith("~/"))) {
			pushPath(signals, path, "/", LOCATION_WEIGHT);
		}
	}
}

function pushPath(
	signals: SessionPathSignal[],
	value: unknown,
	base: string,
	weight: number,
) {
	if (typeof value !== "string" || !value.trim()) return;
	const path = value.startsWith("~/")
		? resolve(homedir(), value.slice(2))
		: resolve(base, value);
	signals.push({ path, weight });
}

async function pickSessionRepositoryRoot(
	signals: readonly SessionPathSignal[],
): Promise<string | null> {
	const directoryScores = new Map<string, number>();
	const directoryByPath = new Map<string, Promise<string | null>>();
	for (const signal of signals) {
		let lookup = directoryByPath.get(signal.path);
		if (!lookup) {
			lookup = nearestExistingDirectory(signal.path);
			directoryByPath.set(signal.path, lookup);
		}
		const directory = await lookup;
		if (!directory) continue;
		directoryScores.set(
			directory,
			(directoryScores.get(directory) ?? 0) + signal.weight,
		);
	}
	const directories = [...directoryScores]
		.sort((left, right) => right[1] - left[1])
		.slice(0, MAX_RESOLVED_DIRECTORIES);

	const roots = await Promise.all(
		directories.map(([directory]) => getGitRoot(directory)),
	);
	const rootScores = new Map<string, number>();
	for (const [index, root] of roots.entries()) {
		const score = directories[index]?.[1];
		if (!root || score === undefined) continue;
		rootScores.set(root, (rootScores.get(root) ?? 0) + score);
	}

	const [top] = [...rootScores].sort((left, right) => right[1] - left[1]);
	// The most active repository wins even without a remote: a local-only
	// project the session edited must not be credited to one it only read.
	if (!top || top[1] < MIN_REPOSITORY_SCORE) return null;
	return (await getGitRemoteUrl(top[0])) ? top[0] : null;
}

async function nearestExistingDirectory(path: string): Promise<string | null> {
	let current = path;
	while (current !== dirname(current)) {
		const stats = await stat(current).catch(() => null);
		if (stats?.isDirectory()) return current;
		if (stats) return dirname(current);
		current = dirname(current);
	}
	return null;
}

async function getGitRoot(directory: string): Promise<string | null> {
	const result = await exec("git", [
		"-C",
		directory,
		"rev-parse",
		"--show-toplevel",
	]).catch(() => null);
	if (!result || result.exitCode !== 0) return null;
	return result.stdout.trim() || null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
	if (!text.trimStart().startsWith("{")) return null;
	try {
		const value: unknown = JSON.parse(text);
		return isRecord(value) ? value : null;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
