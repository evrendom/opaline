import { posix } from "node:path";
import { z } from "zod";
import type { ClickHouseStatement } from "../../clickhouse.js";
import {
	pinnedParams,
	pinnedRecords,
	type SessionGeneration,
	type TranscriptReadScope,
} from "../transcript-generations/generations.js";
import { SHELL_TOOLS } from "./command-identity.js";
import { repositoryKey } from "./received-setup.js";
import { ANALYSIS_QUERY_SETTINGS, records } from "./sql.js";

/**
 * Where each run worked, and the repository that directory belongs to
 * (`runs.cwd`, `cwd_repository`, `cwd_repository_basis`). The session's
 * `repository` is one value per upload: a coordinator session started in a
 * folder outside any repository, whose subagents work in other checkouts,
 * puts every run on the one repository the upload named. These columns name
 * the directory a run's shell commands ran in, and a repository only where
 * the session's own records tie that directory (or one above it) to a git
 * remote; anywhere else it is unknown, never the session's.
 *
 * Both statements read one committed generation; the evidence is the
 * session's own, so a build is the same whenever it runs.
 */

/** How a directory's repository is known, strongest first. */
export const CWD_REPOSITORY_BASES = [
	/** A Codex session_meta's git remote, for the directory it names (parser 12). */
	"codex_session_meta",
	/** The upload's remote, for the session's own directory, whose records show the upload's branch there. */
	"session_branch",
	/** The origin URL a call printed (`git remote get-url`, `git remote -v`, `git config remote.origin.url`). */
	"remote_output",
	/** The remote a `git push` printed it pushed to (`To <remote>`), or a `git fetch` or `git pull` fetched from (`From <remote>`). */
	"transfer_remote",
	/** The one GitHub repository whose pull request or Actions run URLs a `gh pr` or `gh run` command printed, run without `--repo`, so gh named the directory's own. */
	"gh_output",
] as const;
export type CwdRepositoryBasis = (typeof CWD_REPOSITORY_BASES)[number];

/** A run's directory columns. */
export interface RunDirectoryColumns {
	cwd: string | null;
	cwd_repository: string | null;
	/** One of {@link CWD_REPOSITORY_BASES}, `conflicting`, or '' when nothing ties cwd to a repository. */
	cwd_repository_basis: string;
}

export const NO_RUN_DIRECTORY: RunDirectoryColumns = {
	cwd: null,
	cwd_repository: null,
	cwd_repository_basis: "",
};

/** A regular expression as a ClickHouse string literal. */
const sqlRegex = (pattern: string) =>
	`'${pattern.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
const lit = (value: string) => `'${value.replaceAll("'", "\\'")}'`;
/** The first value of a record's components fact. */
const componentValue = (key: string) =>
	`JSONExtractString(arrayElement(JSONExtractArrayRaw(facts['${key}']), 1), 'value')`;
/** The directory a record names: Claude Code's record cwd, Codex CommandExecution cwd (a file: URI). */
const RECORDED_CWD = `if(startsWith(${componentValue("cwd_components")}, 'file://'),
	decodeURLComponent(substring(${componentValue("cwd_components")}, 8)), ${componentValue("cwd_components")})`;
const CALL_CWD = `if(facts['cwd_components'] != '', ${RECORDED_CWD}, facts['workdir'])`;
const HAS_CALL_CWD =
	"(facts['cwd_components'] != '' OR facts['workdir'] != '')";
export const FIRST_CWD = `multiIf(facts['cwd_components'] != '', ${RECORDED_CWD}, facts['workdir'] != '', facts['workdir'], facts['turn_cwd'])`;
export const HAS_FIRST_CWD =
	"(facts['cwd_components'] != '' OR facts['workdir'] != '' OR facts['turn_cwd'] != '')";
const SHELL_CALL = `kind = 'tool_call' AND lower(tool_name) IN (${SHELL_TOOLS.map(lit).join(", ")})`;
/** A command's text: as stored, or its head when the text was cut. */
const COMMAND_TEXT = "if(empty(text), head, text)";
/** A literal directory operand: quoted without expansions, or bare without shell syntax. */
const BACKTICK = "`";
const LITERAL_TARGET = `("[^"$${BACKTICK}]*"|'[^']*'|[^\\s;&|()<>"'$${BACKTICK}\\\\]+)`;
const LEADING_MOVE =
	String.raw`^\s*(?:cd|pushd)\s+` +
	LITERAL_TARGET +
	String.raw`\s*(?:&&|;|\n|$)`;
const LEADING_GIT_C =
	String.raw`^\s*git\s+-C\s+` + LITERAL_TARGET + String.raw`\s`;
/**
 * The directory a shell command starts by moving to, as written: the target
 * of a leading `cd` or `pushd`, else of a leading `git -C`; `?` when it
 * starts with one whose target is not literal (a variable, a substitution,
 * none); '' when it starts with neither.
 */
export const CD_TARGET_SQL = `multiIf(
	match(${COMMAND_TEXT}, ${sqlRegex(String.raw`^\s*(cd|pushd)(\s|;|&|$)`)}),
		if(extract(${COMMAND_TEXT}, ${sqlRegex(LEADING_MOVE)}) = '', '?', extract(${COMMAND_TEXT}, ${sqlRegex(LEADING_MOVE)})),
	match(${COMMAND_TEXT}, ${sqlRegex(String.raw`^\s*git\s+-C\s`)}),
		if(extract(${COMMAND_TEXT}, ${sqlRegex(LEADING_GIT_C)}) = '', '?', extract(${COMMAND_TEXT}, ${sqlRegex(LEADING_GIT_C)})),
	'')`;
/** Commands whose output can name a directory's remote. */
const EVIDENCE_COMMAND = sqlRegex(
	String.raw`git\s+(?:push|fetch|pull|remote)\b|gh\s+(?:pr|run)\s|remote\.origin\.url`,
);
/** Most of a result's text the evidence keeps: its start and its end, where git prints the remote. */
const OUTPUT_HEAD_CHARS = 4_096;
const OUTPUT_TAIL_CHARS = 16_384;

/**
 * How the run facts leave out the calls a forked Codex session replays from
 * its parent (`run-index-sql.ts` `forkReplayCtes` and `FORK_REPLAY_FILTER`),
 * passed in so this module does not import the run facts.
 */
export interface ForkReplayRules {
	readonly ctes: string;
	readonly filter: string;
}

export const RunDirectoryRowSchema = z.object({
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	/** 1 for a group of shell calls, 0 for the run's first recorded cwd. */
	shell: z.coerce.number(),
	cd_target: z.string(),
	recorded_cwd: z.string(),
	calls: z.coerce.number(),
	first_record: z.coerce.number(),
});
export type RunDirectoryRow = z.infer<typeof RunDirectoryRowSchema>;

export const DirectoryEvidenceRowSchema = z.object({
	evidence: z.enum(["call", "codex_session_meta", "session_branch"]),
	agent_id: z.string(),
	first_record: z.coerce.number(),
	cd_target: z.string(),
	recorded_cwd: z.string(),
	command: z.string(),
	output: z.string(),
});
export type DirectoryEvidenceRow = z.infer<typeof DirectoryEvidenceRowSchema>;

/**
 * Per run of one committed generation: its shell calls grouped by the
 * directory their command moves to and the directory recorded for them, and
 * its first recorded cwd. Calls a forked Codex session replays from its
 * parent are left out, as in the run facts.
 */
export function buildRunDirectoriesStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	replay: ForkReplayRules,
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: runDirectoriesSql(replay),
		query_params: pinnedParams(scope, [generation]),
	};
}

/** Records that carry the directory they were written in. */
const CWD_RECORDS = `(kind IN ('user_prompt', 'assistant_text', 'tool_call') OR (kind = 'meta' AND startsWith(subtype, 'item_completed:')))`;

export function buildRunDirectoriesBatchStatement(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
	replay: ForkReplayRules,
	settings: Record<string, string | number> = {},
): ClickHouseStatement {
	return {
		clickhouse_settings: { ...ANALYSIS_QUERY_SETTINGS, ...settings },
		query: runDirectoriesSql(replay, true),
		query_params: pinnedParams(scope, generations),
	};
}

function runDirectoriesSql(replay: ForkReplayRules, batch = false): string {
	const at = "tuple(record_idx, block_idx)";
	const session = batch ? "session_id, " : "";
	const call = batch ? "(session_id, call_id)" : "call_id";
	return `WITH ${replay.ctes},
		shell_calls AS (
			SELECT ${session}agent_id, call_id,
				argMinIf(turn_idx, ${at}, kind = 'tool_call') AS turn,
				minIf(record_idx, kind = 'tool_call') AS first_record,
				argMinIf(${CD_TARGET_SQL}, ${at}, kind = 'tool_call') AS cd_target,
				argMinIf(${CALL_CWD}, ${at}, ${HAS_CALL_CWD}) AS recorded_cwd
			FROM ${records()}
			WHERE ${pinnedRecords()} AND kind IN ('tool_call', 'tool_result', 'meta') AND call_id != '' AND ${replay.filter}
				AND ${call} IN (SELECT ${session}call_id FROM ${records()} WHERE ${pinnedRecords()} AND ${SHELL_CALL})
			GROUP BY ${session}agent_id, call_id
			HAVING countIf(${SHELL_CALL}) > 0 AND turn >= 1
		)
		SELECT ${session}agent_id, turn AS turn_idx, 1 AS shell, cd_target, recorded_cwd,
			count() AS calls, min(first_record) AS first_record
		FROM shell_calls
		GROUP BY ${session}agent_id, turn_idx, cd_target, recorded_cwd
		UNION ALL
		SELECT ${session}agent_id, turn_idx, 0 AS shell, '' AS cd_target,
			argMin(${FIRST_CWD}, ${at}) AS recorded_cwd, 0 AS calls, min(record_idx) AS first_record
		FROM ${records()}
		WHERE ${pinnedRecords()} AND turn_idx >= 1 AND ${CWD_RECORDS}
			AND facts['fork_replayed'] != 'true' AND ${HAS_FIRST_CWD}
		GROUP BY ${session}agent_id, turn_idx`;
}

/**
 * What the session's own records say about which repository a directory
 * belongs to: the calls whose command can print a remote (with the
 * directory they ran in, their command and the start and end of their
 * output), each stream's first Codex session_meta remote, and whether a
 * Claude Code record at the session's directory shows the upload's branch.
 */
export function buildDirectoryEvidenceStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	session: { projectPath: string; gitBranch: string },
	replay: ForkReplayRules,
): ClickHouseStatement {
	// A detached HEAD names no branch, so it ties nothing.
	const branch =
		session.gitBranch === "HEAD" || session.projectPath === ""
			? ""
			: session.gitBranch;
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: directoryEvidenceSql(replay),
		query_params: {
			...pinnedParams(scope, [generation]),
			projectPath: session.projectPath,
			gitBranch: branch,
		},
	};
}

export function buildDirectoryEvidenceBatchStatement(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
	sessions: ReadonlyMap<string, { projectPath: string; gitBranch: string }>,
	replay: ForkReplayRules,
	settings: Record<string, string | number> = {},
): ClickHouseStatement {
	const branches = generations.map((generation) => {
		const session = sessions.get(generation.sessionId) ?? {
			projectPath: "",
			gitBranch: "",
		};
		return session.gitBranch === "HEAD" || session.projectPath === ""
			? { projectPath: session.projectPath, gitBranch: "" }
			: session;
	});
	return {
		clickhouse_settings: { ...ANALYSIS_QUERY_SETTINGS, ...settings },
		query: directoryEvidenceSql(replay, true),
		query_params: {
			...pinnedParams(scope, generations),
			projectPaths: branches.map((branch) => branch.projectPath),
			gitBranches: branches.map((branch) => branch.gitBranch),
		},
	};
}

function directoryEvidenceSql(replay: ForkReplayRules, batch = false): string {
	const at = "tuple(record_idx, block_idx)";
	const output = "if(empty(text), concat(head, '\\n', tail), text)";
	const session = batch ? "session_id, " : "";
	const call = batch ? "(session_id, call_id)" : "call_id";
	const branch = batch
		? `SELECT 'session_branch' AS evidence, session_id, '' AS agent_id, min(record_idx) AS first_record, '' AS cd_target,
			any(${RECORDED_CWD}) AS recorded_cwd, '' AS command, '' AS output
		FROM ${records()}
		WHERE ${pinnedRecords()} AND source = 'claude_code'
			AND kind IN ('user_prompt', 'tool_call')
			AND (session_id, ${RECORDED_CWD}, ${componentValue("git_branch_components")}) IN (
				SELECT b.1, b.2, b.3 FROM (SELECT arrayJoin(arrayZip({sessionIds:Array(String)}, {projectPaths:Array(String)}, {gitBranches:Array(String)})) AS b)
				WHERE b.3 != '')
		GROUP BY session_id`
		: `SELECT 'session_branch' AS evidence, '' AS agent_id, min(record_idx) AS first_record, '' AS cd_target,
			{projectPath:String} AS recorded_cwd, '' AS command, '' AS output
		FROM ${records()}
		WHERE ${pinnedRecords()} AND source = 'claude_code' AND {gitBranch:String} != ''
			AND kind IN ('user_prompt', 'tool_call')
			AND ${RECORDED_CWD} = {projectPath:String}
			AND ${componentValue("git_branch_components")} = {gitBranch:String}
		HAVING count() > 0`;
	return `WITH ${replay.ctes}
		SELECT 'call' AS evidence, ${session}agent_id, minIf(record_idx, kind = 'tool_call') AS first_record,
			argMinIf(${CD_TARGET_SQL}, ${at}, kind = 'tool_call') AS cd_target,
			argMinIf(${CALL_CWD}, ${at}, ${HAS_CALL_CWD}) AS recorded_cwd,
			argMinIf(${COMMAND_TEXT}, ${at}, kind = 'tool_call') AS command,
			arrayStringConcat(arrayMap(entry -> entry.2, arraySort(groupArrayIf(tuple(${at},
				if(lengthUTF8(${output}) <= ${OUTPUT_HEAD_CHARS + OUTPUT_TAIL_CHARS}, ${output},
					concat(substringUTF8(${output}, 1, ${OUTPUT_HEAD_CHARS}), '\\n', substringUTF8(${output}, -${OUTPUT_TAIL_CHARS})))),
				kind = 'tool_result'))), '\\n') AS output
		FROM ${records()}
		WHERE ${pinnedRecords()} AND kind IN ('tool_call', 'tool_result', 'meta') AND call_id != '' AND ${replay.filter}
			AND ${call} IN (SELECT ${session}call_id FROM ${records()} WHERE ${pinnedRecords()} AND ${SHELL_CALL}
				AND match(${COMMAND_TEXT}, ${EVIDENCE_COMMAND}))
		GROUP BY ${session}agent_id, call_id
		HAVING countIf(${SHELL_CALL}) > 0
		UNION ALL
		SELECT 'codex_session_meta' AS evidence, ${session}agent_id, min(record_idx) AS first_record, '' AS cd_target,
			argMin(facts['git_remote_cwd'], record_idx) AS recorded_cwd, '' AS command,
			argMin(facts['git_remote'], record_idx) AS output
		FROM ${records()}
		WHERE ${pinnedRecords()} AND source = 'codex' AND kind = 'meta' AND subtype = 'session_meta'
		GROUP BY ${session}agent_id
		UNION ALL
		${branch}`;
}

/** The SQL and bases the directory columns are read with, for the build fingerprint. */
export function runDirectoryRules(replay: ForkReplayRules): string {
	return `${runDirectoriesSql(replay)}\n${directoryEvidenceSql(replay)}\n${CWD_REPOSITORY_BASES.join(",")}`;
}

/** `/Users/<name>`, `/home/<name>` or `/root`: the home a `~` stands for, from a directory under it. */
const HOME = /^(\/Users\/[^/]+|\/home\/[^/]+|\/root)(?:\/|$)/u;

/**
 * The directory a call ran in: the literal target its command moves to (a
 * leading `~` read as the home directory of the directory recorded for it,
 * a relative target joined to that directory), else that recorded
 * directory; null when the target is not literal or cannot be placed.
 */
export function callDirectory(
	cdTarget: string,
	recordedCwd: string,
): string | null {
	const recorded = recordedCwd === "" ? null : normalizeDirectory(recordedCwd);
	if (cdTarget === "") return recorded;
	if (cdTarget === "?") return null;
	const target = unquote(cdTarget);
	if (target === "" || target === "-") return null;
	if (target.startsWith("/")) return normalizeDirectory(target);
	if (target === "~" || target.startsWith("~/")) {
		const home = recorded === null ? undefined : HOME.exec(recorded)?.[1];
		return home === undefined
			? normalizeDirectory(target)
			: normalizeDirectory(`${home}${target.slice(1)}`);
	}
	if (target.startsWith("~")) return null;
	return recorded?.startsWith("/") === true
		? normalizeDirectory(`${recorded}/${target}`)
		: null;
}

function unquote(target: string): string {
	return /^(["']).*\1$/su.test(target) ? target.slice(1, -1) : target;
}

function normalizeDirectory(path: string): string {
	const normalized = posix.normalize(path);
	return normalized.length > 1 ? normalized.replace(/\/+$/u, "") : normalized;
}

/** A directory and the repository a record ties it to. */
export interface DirectoryRepository {
	readonly directory: string;
	readonly repository: string;
	readonly basis: CwdRepositoryBasis;
}

/** A line that is only a remote URL (https, ssh, scp-like `git@host:owner/name`). */
const REMOTE_LINE =
	/^(?:[a-z][a-z\d+.-]*:\/\/\S+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:\S+)$/u;
const PUSH_REMOTE = /^To (\S+)$/gmu;
const FETCH_REMOTE = /^From (\S+)$/gmu;
const ORIGIN_FETCH = /^origin\s+(\S+)\s+\(fetch\)$/gmu;
/** A pull request or Actions run URL at the start of a line or after a tab, as gh prints them. */
const GH_URL =
	/(?:^|\t)https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:pull|actions\/runs)\/\d+/gmu;
/** A command that moves again after its leading move, or points git or gh elsewhere: its output may be another directory's. */
const ELSEWHERE =
	/(?:^|[\s;&|(])(?:cd|pushd)(?:\s|$)|\s-C\s|--git-dir|--work-tree|\s--repo(?:\s|=)|\s-R\s/u;

/**
 * The directories the session's records tie to a repository. A call counts
 * only when its command moves at most once, at its start (so its output is
 * the output of the directory it ran in), and its output names exactly one
 * remote of its kind.
 */
export function directoryRepositories(
	evidence: readonly DirectoryEvidenceRow[],
	session: { projectPath: string; gitRemote: string },
): DirectoryRepository[] {
	const found: DirectoryRepository[] = [];
	const add = (
		directory: string | null,
		remote: string | null,
		basis: CwdRepositoryBasis,
	) => {
		const repository = remote === null ? null : repositoryKey(remote);
		if (directory === null || directory === "" || repository === null) return;
		found.push({ directory, repository, basis });
	};
	for (const row of evidence) {
		if (row.evidence === "codex_session_meta") {
			if (row.output !== "" && row.recorded_cwd !== "")
				add(normalizeDirectory(row.recorded_cwd), row.output, row.evidence);
			continue;
		}
		if (row.evidence === "session_branch") {
			if (session.projectPath !== "" && session.gitRemote !== "")
				add(
					normalizeDirectory(session.projectPath),
					session.gitRemote,
					row.evidence,
				);
			continue;
		}
		const directory = callDirectory(row.cd_target, row.recorded_cwd);
		const rest =
			row.cd_target === ""
				? row.command
				: row.command.replace(/^\s*\S+\s+(?:-C\s+)?\S+/u, "");
		if (directory === null || ELSEWHERE.test(rest)) continue;
		for (const [basis, remote] of callRemotes(row.command, row.output))
			add(directory, remote, basis);
	}
	return found;
}

/** The remotes one call's output names, by what printed them; none when a kind names several. */
function callRemotes(
	command: string,
	output: string,
): [CwdRepositoryBasis, string][] {
	const remotes: [CwdRepositoryBasis, string][] = [];
	const single = (values: string[]) => {
		const distinct = [...new Set(values)];
		return distinct.length === 1 ? distinct[0] : undefined;
	};
	if (/\bgit\s+push\b/u.test(command)) {
		const remote = single(
			[...output.matchAll(PUSH_REMOTE)].map((m) => m[1] ?? ""),
		);
		if (remote !== undefined) remotes.push(["transfer_remote", remote]);
	}
	if (/\bgit\s+(?:fetch|pull)\b/u.test(command)) {
		const remote = single(
			[...output.matchAll(FETCH_REMOTE)].map((m) => m[1] ?? ""),
		);
		if (remote !== undefined) remotes.push(["transfer_remote", remote]);
	}
	if (/\bgh\s+(?:pr|run)\s/u.test(command)) {
		const repository = single(
			[...output.matchAll(GH_URL)].map((m) => `github.com/${m[1]}/${m[2]}`),
		);
		if (repository !== undefined)
			remotes.push(["gh_output", `https://${repository}`]);
	}
	const origin = single(
		[...output.matchAll(ORIGIN_FETCH)].map((m) => m[1] ?? ""),
	);
	if (/\bgit\s+remote\s+(?:-v|--verbose)\b/u.test(command) && origin)
		remotes.push(["remote_output", origin]);
	else if (
		/\bgit\s+remote\s+get-url(?:\s+origin)?(?:\s*$|\s*[;&|\n])|\bremote\.origin\.url\b/u.test(
			command,
		)
	) {
		const url = single(
			output
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => REMOTE_LINE.test(line)),
		);
		if (url !== undefined) remotes.push(["remote_output", url]);
	}
	return remotes;
}

/**
 * The repository of a directory: the one the deepest directory at or above
 * it with evidence is tied to, with the strongest basis that names it; null
 * with `conflicting` when that directory's evidence names more than one,
 * and null with '' when no directory at or above it has any.
 */
export function directoryRepository(
	directory: string | null,
	known: readonly DirectoryRepository[],
): Pick<RunDirectoryColumns, "cwd_repository" | "cwd_repository_basis"> {
	if (directory === null)
		return { cwd_repository: null, cwd_repository_basis: "" };
	const deepest = knownAncestor(directory, known);
	const tied = known.filter((entry) => entry.directory === deepest);
	if (tied.length === 0)
		return { cwd_repository: null, cwd_repository_basis: "" };
	if (new Set(tied.map((entry) => entry.repository)).size > 1)
		return { cwd_repository: null, cwd_repository_basis: "conflicting" };
	const strongest = CWD_REPOSITORY_BASES.find((basis) =>
		tied.some((entry) => entry.basis === basis),
	);
	return {
		cwd_repository: tied[0]?.repository ?? null,
		cwd_repository_basis: strongest ?? "",
	};
}

/**
 * Each run's directory columns, by stream and run: the directory most of its
 * shell calls ran in (the earliest on a tie), a call below a directory with
 * evidence counting for that directory (one checkout, whichever of its
 * folders a command moved to); else its first recorded cwd; and that
 * directory's repository.
 */
export function runDirectoryColumns(
	rows: readonly RunDirectoryRow[],
	known: readonly DirectoryRepository[],
): (agentId: string, turn: number) => RunDirectoryColumns {
	const byRun = new Map<
		string,
		{
			calls: Map<string, { calls: number; first: number }>;
			first: string | null;
		}
	>();
	for (const row of rows) {
		const key = runKey(row.agent_id, row.turn_idx);
		const run = byRun.get(key) ?? { calls: new Map(), first: null };
		byRun.set(key, run);
		if (row.shell === 0) {
			run.first =
				row.recorded_cwd === "" ? null : normalizeDirectory(row.recorded_cwd);
			continue;
		}
		const called = callDirectory(row.cd_target, row.recorded_cwd);
		if (called === null) continue;
		const directory = knownAncestor(called, known) ?? called;
		const seen = run.calls.get(directory);
		run.calls.set(directory, {
			calls: (seen?.calls ?? 0) + row.calls,
			first: Math.min(seen?.first ?? row.first_record, row.first_record),
		});
	}
	return (agentId, turn) => {
		const run = byRun.get(runKey(agentId, turn));
		if (run === undefined) return NO_RUN_DIRECTORY;
		let cwd: string | null = null;
		let best = { calls: 0, first: Number.POSITIVE_INFINITY };
		for (const [directory, count] of run.calls)
			if (
				count.calls > best.calls ||
				(count.calls === best.calls && count.first < best.first)
			) {
				cwd = directory;
				best = count;
			}
		cwd ??= run.first;
		return { cwd, ...directoryRepository(cwd, known) };
	};
}

/** The deepest directory with evidence at or above `directory`; undefined when none is. */
function knownAncestor(
	directory: string,
	known: readonly DirectoryRepository[],
): string | undefined {
	let deepest: string | undefined;
	for (const { directory: candidate } of known)
		if (
			candidate.length > (deepest?.length ?? -1) &&
			(directory === candidate ||
				directory.startsWith(candidate === "/" ? "/" : `${candidate}/`))
		)
			deepest = candidate;
	return deepest;
}

function runKey(agentId: string, turn: number): string {
	return JSON.stringify([agentId, turn]);
}
