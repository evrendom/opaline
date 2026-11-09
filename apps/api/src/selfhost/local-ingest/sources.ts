import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";

type Environment = Readonly<Record<string, string | undefined>>;

export interface LocalIngestRoots {
	readonly claudeProjects: string;
	readonly codexSessions: string;
}

export type TranscriptSource = "claude_code" | "codex";

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
	return {
		claudeProjects: join(claude, "projects"),
		codexSessions: join(codex, "sessions"),
	};
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
	if (!path.endsWith(".jsonl")) return null;
	const claude = inside(roots.claudeProjects, path);
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
	const codex = inside(roots.codexSessions, path);
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
