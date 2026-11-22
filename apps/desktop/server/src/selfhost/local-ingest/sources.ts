import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";

type Environment = Readonly<Record<string, string | undefined>>;

export interface LocalIngestRoots {
	readonly claudeProjects: string;
	readonly codexSessions: string;
	readonly codexArchivedSessions: string;
	/** Gemini CLI's project folders: `<geminiTmp>/<project>/chats/session-*.jsonl`. */
	readonly geminiTmp?: string;
	/** Antigravity's conversations: `<brain>/<id>/.system_generated/logs/transcript.jsonl`. */
	readonly antigravityBrains?: readonly string[];
	/**
	 * Where T3 Code keeps Antigravity's data, one folder per workspace:
	 * `<antigravityProviders>/<id>/antigravity-acp/brain`. Read on each scan,
	 * so a workspace started after the app is found too.
	 */
	readonly antigravityProviders?: string;
}

export type TranscriptSource = "claude_code" | "codex" | "gemini";

export interface TranscriptFile {
	readonly path: string;
	readonly source: TranscriptSource;
	readonly role: "session" | "subagent";
	readonly sessionPath: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,200}$/u;
const SUBAGENT_FILE = /^agent-([A-Za-z0-9_-]{1,200})\.jsonl$/u;

export function localIngestRoots(
	env: Environment = process.env,
): LocalIngestRoots {
	const home = env.HOME?.trim() || homedir();
	const claude = env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
	const codex = env.CODEX_HOME?.trim() || join(home, ".codex");
	const gemini = join(env.GEMINI_CLI_HOME?.trim() || home, ".gemini");
	return {
		claudeProjects: join(claude, "projects"),
		codexSessions: join(codex, "sessions"),
		codexArchivedSessions: join(codex, "archived_sessions"),
		geminiTmp: join(gemini, "tmp"),
		antigravityBrains: [
			join(gemini, "antigravity-cli", "brain"),
			join(gemini, "antigravity", "brain"),
		],
		antigravityProviders: join(
			home,
			".t3",
			"userdata",
			"providers",
			"antigravity",
		),
	};
}

const HOSTED_BRAIN = ["antigravity-acp", "brain"] as const;

/** Every Antigravity `brain` folder: its own, and each T3 Code workspace's. */
export function antigravityBrains(roots: LocalIngestRoots): string[] {
	const brains = [...(roots.antigravityBrains ?? [])];
	if (!roots.antigravityProviders) return brains;
	try {
		for (const entry of readdirSync(roots.antigravityProviders, {
			withFileTypes: true,
		}))
			if (entry.isDirectory())
				brains.push(
					join(roots.antigravityProviders, entry.name, ...HOSTED_BRAIN),
				);
	} catch {}
	return brains;
}

/** Every folder the importer watches, in the order it walks them. */
export function watchedRoots(roots: LocalIngestRoots): string[] {
	return [
		roots.claudeProjects,
		roots.codexSessions,
		roots.codexArchivedSessions,
		...(roots.geminiTmp ? [roots.geminiTmp] : []),
		...antigravityBrains(roots),
	];
}

const GEMINI_CLI_SESSION_FILE = /^session-[\w.:-]+\.jsonl?$/u;
const ANTIGRAVITY_TRANSCRIPT = "transcript.jsonl";

/** Gemini CLI writes `.jsonl`; versions before 0.5x wrote one `.json`. */
export function isWatchedTranscriptName(path: string): boolean {
	return (
		path.endsWith(".jsonl") ||
		path.endsWith(".jsonl.zst") ||
		GEMINI_CLI_SESSION_FILE.test(basename(path))
	);
}

function classifyGemini(
	roots: LocalIngestRoots,
	path: string,
): TranscriptFile | null {
	const cli = roots.geminiTmp ? inside(roots.geminiTmp, path) : null;
	if (cli) {
		// <project>/chats/session-<time>-<id>.jsonl. Subagent chats live in
		// <project>/chats/<parent session id>/ and are read with their parent,
		// which Gemini CLI writes again when the subagent's call completes.
		const [project, chats, name] = cli;
		if (
			cli.length === 3 &&
			project &&
			chats === "chats" &&
			name &&
			GEMINI_CLI_SESSION_FILE.test(name)
		)
			return { path, source: "gemini", role: "session", sessionPath: path };
		return null;
	}
	const hosted = roots.antigravityProviders
		? inside(roots.antigravityProviders, path)
		: null;
	const brains: string[] = [...(roots.antigravityBrains ?? [])];
	if (
		hosted?.[0] &&
		hosted[1] === HOSTED_BRAIN[0] &&
		hosted[2] === HOSTED_BRAIN[1]
	)
		brains.push(
			join(roots.antigravityProviders ?? "", hosted[0], ...HOSTED_BRAIN),
		);
	for (const brain of brains) {
		const parts = inside(brain, path);
		if (!parts) continue;
		const [conversation, generated, logs, name] = parts;
		if (
			parts.length === 4 &&
			conversation &&
			SAFE_ID.test(conversation) &&
			generated === ".system_generated" &&
			logs === "logs" &&
			name === ANTIGRAVITY_TRANSCRIPT
		)
			return { path, source: "gemini", role: "session", sessionPath: path };
		return null;
	}
	return null;
}

function inside(root: string, path: string): string[] | null {
	const rest = relative(root, path);
	if (rest === "" || rest.startsWith("..") || rest.startsWith(sep)) return null;
	return rest.split(sep);
}

export function classifyTranscriptPath(
	roots: LocalIngestRoots,
	path: string,
): TranscriptFile | null {
	const gemini = classifyGemini(roots, path);
	if (gemini) return gemini;
	const compressed = path.endsWith(".jsonl.zst");
	if (!path.endsWith(".jsonl") && !compressed) return null;
	const claude = compressed ? null : inside(roots.claudeProjects, path);
	if (claude) {
		const [project, second, third, fourth] = claude;
		if (claude.length === 2 && project && second) {
			const id = second.slice(0, -".jsonl".length);
			if (second.startsWith("agent-") || !SAFE_ID.test(id)) return null;
			return {
				path,
				source: "claude_code",
				role: "session",
				sessionPath: path,
			};
		}
		if (
			claude.length === 4 &&
			project &&
			second &&
			SAFE_ID.test(second) &&
			third === "subagents" &&
			fourth &&
			SUBAGENT_FILE.test(fourth)
		)
			return {
				path,
				source: "claude_code",
				role: "subagent",
				sessionPath: join(roots.claudeProjects, project, `${second}.jsonl`),
			};
		return null;
	}
	const codex =
		inside(roots.codexSessions, path) ??
		inside(roots.codexArchivedSessions, path);
	if (codex && !basename(path).startsWith("."))
		return { path, source: "codex", role: "session", sessionPath: path };
	return null;
}

export function claudeSessionId(sessionPath: string): string {
	return basename(sessionPath, ".jsonl");
}

export function claudeProjectDirectory(sessionPath: string): string {
	return basename(dirname(sessionPath));
}

/** Whether a Gemini session file is Antigravity's (else Gemini CLI's). */
export function isAntigravityTranscript(sessionPath: string): boolean {
	return (
		basename(sessionPath) === ANTIGRAVITY_TRANSCRIPT &&
		basename(dirname(sessionPath)) === "logs" &&
		basename(dirname(dirname(sessionPath))) === ".system_generated"
	);
}
