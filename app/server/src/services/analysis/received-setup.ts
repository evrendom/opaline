import { resolveRepoIdentity } from "@rudel/api-routes";
import {
	type ReceivedSetupEntry,
	TRANSCRIPT_RECORD_FACT_KEYS,
} from "@rudel/api-routes/transcript-records";

/**
 * Received setup of each run (CONTEXT.md "Setup file", "Setup file version",
 * "Received setup"). Pure: the run index build reads the pieces the parser
 * named on a generation's records, and this names each piece's setup file by
 * where it lives rather than by machine path, decides whether its version
 * was uncommitted, and ties every run to the versions it had.
 *
 * Nothing is read from disk: setup the transcript does not record is unknown.
 */

/** The run index version from which builds write received setup (`rudel.run_setup`). */
export const SETUP_SINCE_INDEX_VERSION = 6;
/** The parser version from which records name the setup they carry. */
export const SETUP_SINCE_PARSER_VERSION =
	TRANSCRIPT_RECORD_FACT_KEYS.received_setup;

export type SetupScope = "repository" | "plugin" | "member" | "harness" | "mcp";

export interface SetupFileIdentity {
	/** `<scope>:<owner>:<path>`; `mcp:<server>` for MCP instructions. */
	readonly setupFile: string;
	readonly scope: SetupScope;
	readonly owner: string;
	readonly path: string;
}

/** What names a session's setup files. */
export interface SetupFileContext {
	/** The agent, for its own text (the system prompt, developer messages). */
	readonly source: string;
	/** The session's repository (`repositoryKey`); null when it has no remote. */
	readonly repository: string | null;
	/** The member whose personal setup a file in a home directory is. */
	readonly memberId: string;
}

/** The git status a session recorded at its start. */
export interface GitStatus {
	/** Changed paths, relative to the working directory; a directory ends in '/'. */
	readonly paths: readonly string[];
	/** False when the harness cut the status: an unlisted file is then unknown. */
	readonly complete: boolean;
}

/** A record that carried setup (the parser's `received_setup` fact). */
export interface SetupReception {
	readonly agentId: string;
	readonly record: number;
	readonly block: number;
	readonly atMs: number;
	/** A record a forked Codex session replays from its parent: its parent's setup. */
	readonly replayed: boolean;
	readonly entries: readonly ReceivedSetupEntry[];
}

export interface ReceivedSetupInput {
	readonly runs: readonly {
		readonly agentId: string;
		readonly turnIdx: number;
		readonly startRecord: number;
		readonly endRecord: number;
		readonly runId: string;
		readonly startedMs: number;
	}[];
	readonly receptions: readonly SetupReception[];
	readonly compactions: readonly {
		readonly agentId: string;
		readonly record: number;
	}[];
	/** The first time the session changed each path (absolute, or relative to its cwd). */
	readonly edits: readonly { readonly path: string; readonly atMs: number }[];
	readonly gitStatus: GitStatus | null;
	readonly context: SetupFileContext;
}

/** One run and one setup file version it had. */
export interface ReceivedSetupRow extends SetupFileIdentity {
	readonly agentId: string;
	readonly runStartRecord: number;
	readonly runId: string;
	readonly turnIdx: number;
	readonly runStartedMs: number;
	readonly kind: string;
	readonly version: string;
	readonly versionName: string;
	readonly recordedPath: string;
	readonly cwd: string;
	readonly chars: number;
	readonly uncommitted: boolean | null;
	readonly carried: boolean;
	readonly compactedSince: boolean;
	readonly record: number;
	readonly block: number;
	readonly atMs: number;
}

/** Hex digits of a version shown in its name. */
const VERSION_NAME_DIGITS = 12;

const PLUGIN_PATHS: readonly RegExp[] = [
	// ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/<path>
	/(?:^|\/)\.(?:claude|codex)\/plugins\/cache\/(?<market>[^/]+)\/(?<plugin>[^/]+)\/[^/]+\/(?<path>.+)$/u,
	// ~/.claude/plugins/marketplaces/<marketplace>/plugins/<plugin>/<path>
	/(?:^|\/)\.(?:claude|codex)\/plugins\/marketplaces\/(?<market>[^/]+)\/plugins\/(?<plugin>[^/]+)\/(?<path>.+)$/u,
	// A marketplace that is itself the plugin.
	/(?:^|\/)\.(?:claude|codex)\/plugins\/marketplaces\/(?<market>[^/]+)\/(?<path>.+)$/u,
];
const HOME =
	/^(?:[A-Za-z]:)?\/(?:Users|home)\/[^/]+\/(?<path>.+)$|^\/root\/(?<root>.+)$/u;
/** Worktrees the agent created inside the checkout: their files are the checkout's. */
const NESTED_WORKTREE =
	/^(?:\.claude\/worktrees|\.worktrees)\/[^/]+\/(?<path>.+)$/u;
const HARNESS_KINDS: ReadonlySet<string> = new Set([
	"system_prompt",
	"developer",
]);

/**
 * The setup file a piece belongs to. A plugin's file is its plugin's (any
 * version, any machine); a file under the working directory of a session
 * with a repository is the repository's; a file in a home directory is the
 * member's, by its path there; anything else is the member's by its machine
 * path. The agent's own text is the harness's, MCP instructions the server's.
 */
export function setupFileIdentity(
	piece: Pick<ReceivedSetupEntry, "kind" | "path" | "name" | "cwd">,
	context: SetupFileContext,
): SetupFileIdentity {
	if (HARNESS_KINDS.has(piece.kind))
		return identity("harness", context.source, piece.name);
	if (piece.kind === "mcp_instructions")
		return {
			setupFile: `mcp:${piece.name}`,
			scope: "mcp",
			owner: piece.name,
			path: "",
		};
	const path = normalize(piece.path);
	for (const pattern of PLUGIN_PATHS) {
		const match = pattern.exec(path)?.groups;
		if (match?.market !== undefined && match.path !== undefined)
			return identity(
				"plugin",
				`${match.plugin ?? match.market}@${match.market}`,
				match.path,
			);
	}
	const cwd = normalize(piece.cwd);
	if (context.repository !== null && cwd !== "" && path.startsWith(`${cwd}/`)) {
		const relative = path.slice(cwd.length + 1);
		return identity(
			"repository",
			context.repository,
			NESTED_WORKTREE.exec(relative)?.groups?.path ?? relative,
		);
	}
	const home = HOME.exec(path)?.groups;
	const inHome = home?.path ?? home?.root;
	return identity(
		"member",
		context.memberId,
		inHome === undefined ? path : `~/${inHome}`,
	);
}

/** A git remote as a repository name (host/owner/name); null without one. */
export function repositoryKey(gitRemote: string): string | null {
	if (gitRemote.trim() === "") return null;
	const { repoKey } = resolveRepoIdentity({
		projectPath: "",
		gitRemote,
		packageName: null,
	});
	return repoKey.startsWith("remote:") ? repoKey.slice("remote:".length) : null;
}

/**
 * The changed paths of a git status Claude Code recorded (`git status
 * --short` under `Status:`), or null when it has no status section.
 */
export function parseGitStatus(text: string): GitStatus | null {
	const start = /(?:^|\n)Status:\n/u.exec(text);
	if (start === null) return null;
	const section =
		text.slice(start.index + start[0].length).split("\n\n", 1)[0] ?? "";
	const paths: string[] = [];
	let complete = true;
	for (const line of section.split("\n")) {
		if (/truncated/iu.test(line)) {
			complete = false;
			continue;
		}
		const entry = /^[ MADRCU?!T]{2} (.+)$/u.exec(line)?.[1];
		if (entry === undefined) continue;
		const renamed = entry.split(" -> ");
		paths.push(unquote(renamed.at(-1) ?? entry));
	}
	return { paths, complete };
}

/**
 * Every run with each setup file version it had: the latest version of each
 * setup file its stream received before it started (carried), and every
 * version received during it. Streams are separate: a subagent has only what
 * its own transcript recorded.
 */
export function receivedSetupRows(
	input: ReceivedSetupInput,
): ReceivedSetupRow[] {
	const rows: ReceivedSetupRow[] = [];
	const firstEdit = new Map<string, number>();
	for (const edit of input.edits) {
		const at = firstEdit.get(edit.path);
		if (at === undefined || edit.atMs < at) firstEdit.set(edit.path, edit.atMs);
	}
	const pieces = input.receptions
		.filter((reception) => !reception.replayed)
		.flatMap((reception) =>
			reception.entries.map((entry) => ({ reception, entry })),
		)
		.sort(
			(a, b) =>
				a.reception.record - b.reception.record ||
				a.reception.block - b.reception.block,
		);
	const runs = [...input.runs].sort(
		(a, b) =>
			a.agentId.localeCompare(b.agentId) || a.startRecord - b.startRecord,
	);
	for (const run of runs) {
		const stream = pieces.filter(
			(piece) =>
				piece.reception.agentId === run.agentId &&
				piece.reception.record < run.endRecord,
		);
		const carried = new Map<string, (typeof stream)[number]>();
		const during: (typeof stream)[number][] = [];
		for (const piece of stream) {
			const file = setupFileIdentity(piece.entry, input.context).setupFile;
			if (piece.reception.record < run.startRecord) carried.set(file, piece);
			else during.push(piece);
		}
		const seen = new Set<string>();
		for (const piece of [...carried.values(), ...during]) {
			const identity = setupFileIdentity(piece.entry, input.context);
			const key = `${identity.setupFile}\n${piece.entry.sha256}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const uncommitted = uncommittedOf(piece, identity, input, firstEdit);
			rows.push({
				...identity,
				agentId: run.agentId,
				runStartRecord: run.startRecord,
				runId: run.runId,
				turnIdx: run.turnIdx,
				runStartedMs: run.startedMs,
				kind: piece.entry.kind,
				version: piece.entry.sha256,
				versionName: `${piece.entry.sha256.slice(0, VERSION_NAME_DIGITS)}${
					uncommitted === true
						? ` uncommitted by ${input.context.memberId}`
						: ""
				}`,
				recordedPath: piece.entry.path,
				cwd: piece.entry.cwd,
				chars: piece.entry.chars,
				uncommitted,
				carried: piece.reception.record < run.startRecord,
				compactedSince: input.compactions.some(
					(compaction) =>
						compaction.agentId === run.agentId &&
						compaction.record > piece.reception.record &&
						compaction.record < run.endRecord,
				),
				record: piece.reception.record,
				block: piece.reception.block,
				atMs: piece.reception.atMs,
			});
		}
	}
	return rows;
}

/**
 * Whether a repository file's version was uncommitted when received: the
 * session changed the file before (it no longer is what was checked out), or
 * the git status recorded at the session's start lists it. Unknown without a
 * status, with a cut one, and for files outside a repository.
 */
function uncommittedOf(
	piece: { reception: SetupReception; entry: ReceivedSetupEntry },
	identity: SetupFileIdentity,
	input: ReceivedSetupInput,
	firstEdit: ReadonlyMap<string, number>,
): boolean | null {
	if (identity.scope !== "repository") return null;
	const cwd = normalize(piece.entry.cwd);
	const recorded = normalize(piece.entry.path);
	const relative = recorded.slice(cwd.length + 1);
	const edited = [recorded, relative].some((path) => {
		const at = firstEdit.get(path);
		return at !== undefined && at < piece.reception.atMs;
	});
	if (edited) return true;
	const status = input.gitStatus;
	if (status === null) return null;
	const listed = status.paths.some((path) =>
		path.endsWith("/") ? relative.startsWith(path) : path === relative,
	);
	if (listed) return true;
	return status.complete ? false : null;
}

function identity(
	scope: SetupScope,
	owner: string,
	path: string,
): SetupFileIdentity {
	return { setupFile: `${scope}:${owner}:${path}`, scope, owner, path };
}

/** Forward slashes, no repeated or trailing ones. */
function normalize(path: string): string {
	return path
		.replaceAll("\\", "/")
		.replace(/\/{2,}/gu, "/")
		.replace(/\/+$/u, "");
}

/** A path git quoted for its special characters (C escapes, octal UTF-8 bytes). */
function unquote(path: string): string {
	if (!path.startsWith('"') || !path.endsWith('"')) return path;
	const bytes: number[] = [];
	const body = path.slice(1, -1);
	const escapes: Readonly<Record<string, number>> = {
		n: 10,
		t: 9,
		'"': 34,
		"\\": 92,
	};
	for (let index = 0; index < body.length; index++) {
		const octal = /^\\([0-7]{3})/u.exec(body.slice(index))?.[1];
		const escaped =
			body[index] === "\\" ? escapes[body[index + 1] ?? ""] : undefined;
		if (octal !== undefined) {
			bytes.push(Number.parseInt(octal, 8));
			index += 3;
		} else if (escaped !== undefined) {
			bytes.push(escaped);
			index += 1;
		} else bytes.push(...new TextEncoder().encode(body[index]));
	}
	return new TextDecoder().decode(new Uint8Array(bytes));
}
