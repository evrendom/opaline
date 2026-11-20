import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { type GitInfo, getGitInfo, getGitRemoteUrl, git } from "./git-info.js";
import { isProtectedPath } from "./protected-folders.js";

const WRITE_WEIGHT = 3;
const LOCATION_WEIGHT = 1;
const MIN_REPOSITORY_SCORE = 2;
const MAX_RESOLVED_DIRECTORIES = 32;

const WRITE_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);
const LOCATION_TOOLS = new Set(["Glob", "Grep", "LS", "Read"]);
const PATCH_FILE_PATTERN =
	/\*\*\* (?:Add|Update|Delete) File: ([^\n\\"]+)|\*\*\* Move to: ([^\n\\"]+)/gu;
const SHELL_PATH_PATTERN =
	/(?:^|[\s;&|("'])(?:cd|git\s+-C)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)'"\\]+))/gu;
const WORKDIR_PATTERN = /"?workdir"?\s*:\s*\\?"([^"\\]+)\\?"/gu;

interface PathSignal {
	readonly path: string;
	readonly weight: number;
}

export async function inferSessionRepository(input: {
	readonly projectPath: string;
	readonly gitRemote?: string;
	readonly packageName?: string;
	readonly streams: readonly string[];
}): Promise<GitInfo | null> {
	if (input.gitRemote || input.packageName) return null;
	const signals: PathSignal[] = [];
	for (const content of input.streams)
		for (const line of lines(content))
			collectLineSignals(line, input.projectPath, signals);
	const root = await pickRepositoryRoot(signals);
	if (!root) return null;
	const gitInfo = await getGitInfo(root);
	return gitInfo.gitRemote ? gitInfo : null;
}

function* lines(content: string): Generator<string> {
	let start = 0;
	while (start < content.length) {
		const end = content.indexOf("\n", start);
		const stop = end === -1 ? content.length : end;
		yield content.slice(start, stop);
		start = stop + 1;
	}
}

function collectLineSignals(
	line: string,
	projectPath: string,
	signals: PathSignal[],
): void {
	if (!line.includes("tool_use") && !line.includes("_call")) return;
	let record: unknown;
	try {
		record = JSON.parse(line);
	} catch {
		return;
	}
	if (!isRecord(record)) return;
	collectClaudeSignals(record, projectPath, signals);
	collectCodexSignals(record, projectPath, signals);
}

function collectClaudeSignals(
	record: Record<string, unknown>,
	projectPath: string,
	signals: PathSignal[],
): void {
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
	signals: PathSignal[],
): void {
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
		for (const match of text.matchAll(WORKDIR_PATTERN))
			pushPath(signals, match[1], projectPath, LOCATION_WEIGHT);
		collectShellSignals(text, signals);
	}
	for (const match of text.matchAll(PATCH_FILE_PATTERN))
		pushPath(signals, (match[1] ?? match[2])?.trim(), workdir, WRITE_WEIGHT);
}

function collectShellSignals(command: string, signals: PathSignal[]): void {
	for (const match of command.matchAll(SHELL_PATH_PATTERN)) {
		const path = match[1] ?? match[2] ?? match[3];
		if (path && (isAbsolute(path) || path.startsWith("~/")))
			pushPath(signals, path, "/", LOCATION_WEIGHT);
	}
}

function pushPath(
	signals: PathSignal[],
	value: unknown,
	base: string,
	weight: number,
): void {
	if (typeof value !== "string" || !value.trim()) return;
	const path = value.startsWith("~/")
		? resolve(homedir(), value.slice(2))
		: resolve(base, value);
	if (isProtectedPath(path)) return;
	signals.push({ path, weight });
}

async function pickRepositoryRoot(
	signals: readonly PathSignal[],
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
		directories.map(async ([directory]) => {
			const result = await git([
				"-C",
				directory,
				"rev-parse",
				"--show-toplevel",
			]);
			return result.exitCode === 0 ? result.stdout.trim() || null : null;
		}),
	);
	const rootScores = new Map<string, number>();
	for (const [index, root] of roots.entries()) {
		const score = directories[index]?.[1];
		if (!root || score === undefined) continue;
		rootScores.set(root, (rootScores.get(root) ?? 0) + score);
	}
	const repositories = new Map<
		string,
		{ remote: string | null; score: number; root: string; rootScore: number }
	>();
	for (const [root, score] of rootScores) {
		const remote = await getGitRemoteUrl(root);
		const key = remote ?? `local:${root}`;
		const current = repositories.get(key);
		repositories.set(key, {
			remote,
			score: (current?.score ?? 0) + score,
			...(current && current.rootScore >= score
				? { root: current.root, rootScore: current.rootScore }
				: { root, rootScore: score }),
		});
	}
	const [top] = [...repositories.values()].sort(
		(left, right) => right.score - left.score,
	);
	if (!top || top.score < MIN_REPOSITORY_SCORE || !top.remote) return null;
	return top.root;
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
