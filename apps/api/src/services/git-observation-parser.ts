import { createHash } from "node:crypto";
import {
	parseShellCommand,
	splitTranscript,
	type TranscriptSource,
} from "@rudel/api-routes/transcript-records";
import type { RudelSessionGitObservationsRow } from "@rudel/ch-schema/generated";
import { filterKnownSecrets } from "@rudel/secret-filter";

export const GIT_OBSERVATION_PARSER_VERSION = 4;
export const GIT_OBSERVATION_MAX_RAW_BYTES = 1024 * 1024;
export const GIT_OBSERVATION_MAX_ROWS = 10_000;
export const GIT_TOOL_PATTERN =
	/\bgit\b[^\n;&|]*\b(?:commit|push|merge|cherry-pick|rebase|revert)\b|\bgh\b[^\n;&|]*\b(?:pr|run)\b/iu;
/**
 * GitHub MCP tools that may read Actions runs, jobs or check status. The
 * consolidated tools (`actions_get`, `actions_list`, `pull_request_read`) do
 * so only for some methods, which the parser checks.
 */
export const GITHUB_CI_TOOL_PATTERN =
	/(?:github|mcp).*?(?:workflow_run|workflow_job|job_logs|check_run|check_suite|commit_status|pull_request_status|actions_list|actions_get)/iu;
const GITHUB_CI_METHOD_TOOL_PATTERN =
	/(?:actions_list|actions_get|pull_request_read)$/iu;
/** `gh` flags that take a value, so the value is not read as a PR, run or branch. */
const GH_VALUE_FLAGS = new Set([
	"-R",
	"--repo",
	"-i",
	"--interval",
	"--json",
	"-q",
	"--jq",
	"-t",
	"--template",
	"-j",
	"--job",
	"-a",
	"--attempt",
	"-L",
	"--limit",
	"-w",
	"--workflow",
	"-b",
	"--branch",
	"-u",
	"--user",
	"-e",
	"--event",
	"-s",
	"--status",
	"-c",
	"--commit",
	"--created",
]);
export const GITHUB_PR_TOOL_PATTERN =
	/(?:github|mcp).*?(?:create_pull_request|pull_request_create|create_pr|pull_request_read|pull_request_write|list_pull_requests|get_pull_request)/iu;

export interface GitObservationRecord {
	agent_id: string;
	record_idx: number;
	block_idx: number;
	call_id: string;
	kind: string;
	subtype: string;
	tool_name: string;
	is_error: boolean;
	exit_code: number | null;
	ts: string;
	text: string;
	text_chars: number;
	byte_start: string;
	byte_len: number;
	/** Parser 6+ literal facts of the record (`facts` map); empty on older generations. */
	facts?: Record<string, string>;
	/** Parser 6+ `gitOperation` keys of a tool result. */
	git_operation?: readonly string[];
	raw?: string;
}

export interface GitObservationParseInput {
	organizationId: string;
	userId: string;
	source: TranscriptSource;
	sessionId: string;
	revision: string;
	transcriptParserVersion: number;
	records: readonly GitObservationRecord[];
}

export function parseGitObservations(
	input: GitObservationParseInput,
): RudelSessionGitObservationsRow[] {
	const records = input.records
		.map((record) => recoverRecord(record, input.source))
		.sort(
			(left, right) =>
				left.record_idx - right.record_idx || left.block_idx - right.block_idx,
		);
	const calls = new Map(
		records
			.filter(
				(record) =>
					record.kind === "tool_call" &&
					(GIT_TOOL_PATTERN.test(record.text) ||
						GITHUB_PR_TOOL_PATTERN.test(record.tool_name) ||
						GITHUB_CI_TOOL_PATTERN.test(record.tool_name) ||
						(input.source === "codex" &&
							record.tool_name.split(".").at(-1) === "write_stdin")),
			)
			.map((record) => [callKey(record), record]),
	);
	const sessions = new Map<string, GitObservationRecord>();
	const observations: RudelSessionGitObservationsRow[] = [];
	for (const record of records) {
		if (
			record.kind === "meta" &&
			record.subtype === "session_meta" &&
			input.source === "codex"
		) {
			if (!record.raw)
				throw new Error("Missing bounded raw session_meta range");
			const envelope: unknown = JSON.parse(record.raw);
			const payload = objectValue(objectValue(envelope).payload);
			const git = objectValue(payload.git);
			const branch = safeText(stringValue(git.branch));
			const commitHash = stringValue(git.commit_hash);
			const repositoryUrl = safeRepositoryUrl(stringValue(git.repository_url));
			if (branch || commitHash || repositoryUrl)
				observations.push({
					...baseRow(input, record),
					kind: "codex_session_meta",
					branch,
					commit_hash: /^[a-f\d]{40,64}$/iu.test(commitHash)
						? commitHash.toLowerCase()
						: "",
					repository_url: repositoryUrl,
				});
		}
		// Claude `pr-link` records name the PR the session worked on (parser 6+).
		if (record.kind === "meta" && record.subtype === "pr-link") {
			const pr = pullRequestFromFacts(
				record.facts?.pr_repository,
				record.facts?.pr_number,
			);
			if (pr)
				observations.push({
					...baseRow(input, record),
					kind: "pr_url",
					label: "pr_link",
					...pr,
				});
			continue;
		}
		if (record.kind !== "tool_result") continue;
		let call = calls.get(callKey(record));
		if (
			input.source === "codex" &&
			call?.tool_name.split(".").at(-1) === "write_stdin"
		) {
			const sessionId = objectValue(JSON.parse(call.text)).session_id;
			const sessionKey = callKey({
				agent_id: record.agent_id,
				call_id: String(sessionId),
			});
			call = sessions.get(sessionKey);
			if (record.is_error || record.exit_code !== null)
				sessions.delete(sessionKey);
		}
		let ordinal = 0;
		const added: Partial<RudelSessionGitObservationsRow>[] = [];
		const add = (fields: Partial<RudelSessionGitObservationsRow>) => {
			if (observations.length >= GIT_OBSERVATION_MAX_ROWS)
				throw new Error("Git observation expansion limit exceeded");
			added.push(fields);
			observations.push({
				...baseRow(input, record),
				block_idx: record.block_idx * 65_536 + ordinal++,
				...fields,
			});
		};
		// Claude records what a call did to git (`gitOperation`, parser 6+);
		// each fact the output text did not already show becomes an
		// observation labelled git_operation, after the text's own.
		const addRecordedOperations = () => {
			for (const fields of gitOperationObservations(
				record,
				added,
				call ? shellCommand(call) : null,
			))
				add(fields);
		};
		// A call that ran (it has an exit code, or no error) may have done things
		// even when it failed overall: a CI status read is a fact whether checks
		// passed or failed (`gh pr checks` exits non-zero while they are pending
		// or failing), and a push may update one ref and reject another. Calls that
		// never ran (an error without an exit code) or are still running are not.
		if (
			call &&
			record.subtype !== "running" &&
			(record.exit_code !== null || !record.is_error)
		) {
			for (const check of ciChecks(call, record)) add(check);
			if (GIT_TOOL_PATTERN.test(call.text)) {
				for (const match of record.text.matchAll(
					/^\s*\[(.+?)\s+([a-f\d]{4,40})\]\s+(.+)$/gimu,
				)) {
					const branch = (match[1] ?? "").replace(/\s+\(root-commit\)$/u, "");
					add({
						kind: "commit_created",
						short_sha: (match[2] ?? "").toLowerCase(),
						branch: safeText(branch),
						subject_sha256: createHash("sha256")
							.update(match[3] ?? "")
							.digest("hex"),
					});
				}
				if (
					!/\bgit\b[^\n;&|]*\bpush\b[^\n;&|]*\s(?:--dry-run|-[A-Za-z]*n[A-Za-z]*)(?=\s|["']|$)/u.test(
						call.text,
					)
				)
					for (const push of pushLines(record.text)) add(push);
			}
		}
		if (
			record.is_error ||
			(record.exit_code !== null && record.exit_code !== 0)
		) {
			addRecordedOperations();
			continue;
		}
		if (!call) {
			addRecordedOperations();
			continue;
		}
		if (
			input.source === "codex" &&
			call.tool_name.split(".").at(-1) === "exec_command"
		) {
			const sessionId = /^Process running with session ID (\d+)\s*$/mu.exec(
				record.text,
			)?.[1];
			if (sessionId)
				sessions.set(
					callKey({ agent_id: record.agent_id, call_id: sessionId }),
					call,
				);
		}
		const mcp = GITHUB_PR_TOOL_PATTERN.test(call.tool_name);
		if (mcp && mcpFailed(record.text)) {
			addRecordedOperations();
			continue;
		}
		const urlText = record.text.replaceAll("\\/", "/");
		const seenUrls = new Set<string>();
		for (const match of urlText.matchAll(
			/https:\/\/github\.com\/([a-z\d_.-]+)\/([a-z\d_.-]+)\/pull\/([1-9]\d*)(?![\dA-Za-z])/giu,
		)) {
			const number = Number(match[3]);
			if (
				!Number.isSafeInteger(number) ||
				number > 4_294_967_295 ||
				seenUrls.has(match[0])
			)
				continue;
			seenUrls.add(match[0]);
			add({
				kind:
					mcp &&
					(/create/iu.test(call.tool_name) ||
						(/pull_request_write/iu.test(call.tool_name) &&
							/"method"\s*:\s*"create"/iu.test(call.text)))
						? "mcp_pr_created"
						: "pr_url",
				pr_repo: safeText(`${match[1]}/${match[2]}`),
				pr_number: number,
			});
		}
		addRecordedOperations();
	}
	return observations;
}

/**
 * Observations from a tool result's recorded `gitOperation` facts that its
 * output text did not already yield: a pushed branch with no push line, a
 * commit SHA with no commit line, a pull request with no URL in the output.
 */
function gitOperationObservations(
	record: GitObservationRecord,
	fromText: readonly Partial<RudelSessionGitObservationsRow>[],
	command: string | null,
): Partial<RudelSessionGitObservationsRow>[] {
	const facts = record.facts ?? {};
	const operations = new Set(record.git_operation ?? []);
	const out: Partial<RudelSessionGitObservationsRow>[] = [];
	const label = "git_operation";
	const pushBranch = safeText(facts["git.push.branch"] ?? "");
	if (
		operations.has("push") &&
		pushBranch !== "" &&
		!fromText.some(
			(row) => row.kind === "push_range" && row.branch === pushBranch,
		)
	)
		out.push({ kind: "push_range", label, branch: pushBranch });
	const sha = (facts["git.commit.sha"] ?? "").toLowerCase();
	if (
		operations.has("commit") &&
		/^[a-f\d]{4,64}$/u.test(sha) &&
		!fromText.some(
			(row) =>
				row.kind === "commit_created" &&
				(row.short_sha?.startsWith(sha) ||
					sha.startsWith(row.short_sha ?? "-")),
		)
	)
		out.push({ kind: "commit_created", label, short_sha: sha });
	// A recorded PR number without a URL takes the repository its command
	// names (`--repo owner/name`, `-R`, a PR URL argument); naming none keeps
	// it unknown, so the edge resolver uses the session's repository and
	// records that basis; naming several makes it ambiguous, so it is skipped.
	const recordedNumber = Number(facts["git.pr.number"]);
	const named = commandRepository(command, recordedNumber);
	const pr =
		pullRequestFromUrl(facts["git.pr.url"] ?? "") ??
		(Number.isSafeInteger(recordedNumber) &&
		recordedNumber >= 1 &&
		recordedNumber <= 4_294_967_295 &&
		named !== null
			? { pr_repo: named, pr_number: recordedNumber }
			: null);
	if (
		operations.has("pr") &&
		pr &&
		!fromText.some(
			(row) =>
				(row.kind === "pr_url" || row.kind === "mcp_pr_created") &&
				row.pr_number === pr.pr_number &&
				(pr.pr_repo === "" ||
					row.pr_repo?.toLowerCase() === pr.pr_repo.toLowerCase()),
		)
	)
		out.push({ kind: "pr_url", label, ...pr });
	return out;
}

/**
 * The repository a shell command's `gh pr` invocations name for pull request
 * `number`: their `--repo`/`-R` values or PR URL arguments. Only `gh pr`
 * invocations that name that number or none (the current branch's PR) count;
 * a matching number alone does not prove the same PR across repositories, so
 * any two that name different repositories, or one naming a repository and
 * one naming none (the session's), make it ambiguous (null). "" when none of
 * them names a repository.
 */
function commandRepository(
	command: string | null,
	number: number,
): string | null {
	if (!command) return "";
	// "" stands for the session's repository: an invocation naming none
	// disagrees with one naming another repository.
	const named = new Set<string>();
	for (const segment of parseShellCommand(command)) {
		const target = ghPrTarget(segment.words);
		if (!target || (target.number !== number && target.number !== 0)) continue;
		named.add(target.repo);
	}
	if (named.size > 1) return null;
	const [repository = ""] = named;
	return safeText(repository);
}

/** The PR number (0 when none) and repository ("" when none) a `gh pr` invocation names. */
function ghPrTarget(
	words: readonly string[],
): { number: number; repo: string } | null {
	if (words[0]?.split("/").at(-1) !== "gh") return null;
	// `gh --repo owner/name pr ready 148`: repository flags may precede `pr`.
	let repo = "";
	const positional: string[] = [];
	for (let index = 1; index < words.length; index++) {
		const word = words[index] ?? "";
		const repoFlag = /^(?:--repo|-R)(?:=(.*))?$/u.exec(word);
		if (repoFlag) {
			repo = repoFlag[1] ?? words[++index] ?? "";
			continue;
		}
		if (word.startsWith("-R") && word.length > 2) {
			repo = word.slice(2);
			continue;
		}
		const [flag] = word.startsWith("--") ? word.split("=", 2) : [word];
		if (GH_VALUE_FLAGS.has(flag ?? "") && !word.includes("=")) {
			index++;
			continue;
		}
		if (word.startsWith("-")) continue;
		positional.push(word);
	}
	// Only commands acting on one pull request; `gh pr list` and
	// `gh pr status` name none.
	if (positional[0] !== "pr" || GH_PR_MULTI_ACTIONS.has(positional[1] ?? ""))
		return null;
	const target = positional[2] ?? "";
	const url = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/u.exec(
		target,
	);
	if (url)
		return {
			number: prNumber(url[3]),
			repo: normalizeRepository(`${url[1]}/${url[2]}`),
		};
	return {
		number: /^\d+$/u.test(target) ? prNumber(target) : 0,
		repo: normalizeRepository(repo),
	};
}

const GH_PR_MULTI_ACTIONS: ReadonlySet<string> = new Set(["list", "status"]);

/** `owner/name` of a gh repository argument (HOST/OWNER/REPO, URL, .git), lowercased. */
function normalizeRepository(value: string): string {
	const path = value
		.trim()
		.replace(/^https?:\/\//u, "")
		.replace(/^github\.com\//iu, "")
		.replace(/\.git$/u, "");
	return /^[\w.-]+\/[\w.-]+$/u.test(path) ? path.toLowerCase() : "";
}

function pullRequestFromUrl(
	url: string,
): { pr_repo: string; pr_number: number } | null {
	const match =
		/^https:\/\/github\.com\/([a-z\d_.-]+)\/([a-z\d_.-]+)\/pull\/([1-9]\d*)(?![\dA-Za-z])/iu.exec(
			url,
		);
	return match
		? pullRequestFromFacts(`${match[1]}/${match[2]}`, match[3])
		: null;
}

function pullRequestFromFacts(
	repository: string | undefined,
	number: string | undefined,
): { pr_repo: string; pr_number: number } | null {
	if (!repository || !/^[a-z\d_.-]+\/[a-z\d_.-]+$/iu.test(repository))
		return null;
	const parsed = Number(number);
	if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 4_294_967_295)
		return null;
	return { pr_repo: safeText(repository), pr_number: parsed };
}

export function baseRow(
	input: Omit<GitObservationParseInput, "records">,
	record: Pick<
		GitObservationRecord,
		"agent_id" | "record_idx" | "block_idx" | "call_id" | "ts"
	>,
): RudelSessionGitObservationsRow {
	return {
		organization_id: input.organizationId,
		user_id: input.userId,
		source: input.source,
		session_id: input.sessionId,
		revision: input.revision,
		parser_version: gitObservationGenerationVersion(
			input.transcriptParserVersion,
		),
		transcript_parser_version: input.transcriptParserVersion,
		agent_id: record.agent_id,
		record_idx: record.record_idx,
		block_idx: record.block_idx,
		call_id: record.call_id,
		kind: "",
		short_sha: "",
		branch: "",
		subject_sha256: "",
		push_from_sha: "",
		push_to_sha: "",
		push_source_branch: "",
		pr_repo: "",
		pr_number: 0,
		commit_hash: "",
		repository_url: "",
		ts: timestampIso(record.ts).replace("T", " ").replace("Z", ""),
		label: "observed",
		run_id: "",
	};
}

export function gitObservationGenerationVersion(
	transcriptParserVersion: number,
): number {
	if (
		!Number.isInteger(transcriptParserVersion) ||
		transcriptParserVersion < 1 ||
		transcriptParserVersion > 255 ||
		GIT_OBSERVATION_PARSER_VERSION > 255
	)
		throw new Error(
			"Git observation parser version exceeds generation encoding",
		);
	return GIT_OBSERVATION_PARSER_VERSION * 256 + transcriptParserVersion;
}

function recoverRecord(
	record: GitObservationRecord,
	source: TranscriptSource,
): GitObservationRecord {
	if (!record.raw || record.kind === "meta") return record;
	for (const draft of splitTranscript({
		content: record.raw,
		source,
		agentId: record.agent_id,
		fallbackTs: timestampIso(record.ts),
		textMaxChars: GIT_OBSERVATION_MAX_RAW_BYTES,
		maxParseLineBytes: GIT_OBSERVATION_MAX_RAW_BYTES,
	})) {
		if (
			draft.kind === record.kind &&
			draft.blockIdx === record.block_idx &&
			draft.callId === record.call_id
		)
			return {
				...record,
				text: draft.text,
				is_error: record.is_error || draft.isError,
				exit_code: draft.exitCode ?? record.exit_code,
			};
	}
	throw new Error("Bounded raw range did not contain the indexed tool block");
}

function callKey(
	record: Pick<GitObservationRecord, "agent_id" | "call_id">,
): string {
	return JSON.stringify([record.agent_id, record.call_id]);
}

function safeText(value: string): string {
	return filterKnownSecrets(value).text.slice(0, 512);
}

function safeRepositoryUrl(value: string): string {
	const withoutCredentials = value.replace(
		/([a-z][a-z\d+.-]*:\/\/)[^/\s]*@/giu,
		"$1",
	);
	return safeText(withoutCredentials);
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}
function timestampIso(value: string): string {
	return new Date(
		value.includes("T") ? value : `${value.replace(" ", "T")}Z`,
	).toISOString();
}
function objectValue(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function mcpFailed(text: string): boolean {
	if (/"(?:isError|is_error)"\s*:\s*true/iu.test(text)) return true;
	if (/"success"\s*:\s*false|"error"\s*:\s*(?:"[^"\n]+"|\{)/iu.test(text))
		return true;
	return /^\s*(?:error|failed|failure)\b/iu.test(text);
}

/**
 * `git push` output, line by line: the `To <remote>` line names the
 * repository of the ref updates that follow it. A new branch has no SHA range,
 * so its push carries only the refs.
 */
function pushLines(text: string): Partial<RudelSessionGitObservationsRow>[] {
	const pushes: Partial<RudelSessionGitObservationsRow>[] = [];
	let remote = "";
	for (const line of text.split(/\r?\n/u)) {
		const to = /^To\s+(\S+)\s*$/u.exec(line);
		if (to) {
			remote = safeRepositoryUrl(to[1] ?? "");
			continue;
		}
		const range =
			/^\s*(?:\+\s+)?([a-f\d]{4,40})\.{2,3}([a-f\d]{4,40})\s+(\S+)\s+->\s+(\S+)(?:\s|$)/iu.exec(
				line,
			);
		if (range) {
			pushes.push({
				kind: "push_range",
				label: /^\s*\+\s|\(forced update\)/u.test(line)
					? "forced_update"
					: "observed",
				push_from_sha: (range[1] ?? "").toLowerCase(),
				push_to_sha: (range[2] ?? "").toLowerCase(),
				push_source_branch: safeText(range[3] ?? ""),
				branch: safeText(range[4] ?? ""),
				repository_url: remote,
			});
			continue;
		}
		const created =
			/^\s*\*\s+\[new branch\]\s+(\S+)\s+->\s+(\S+)(?:\s|$)/iu.exec(line);
		if (created)
			pushes.push({
				kind: "push_range",
				push_source_branch: safeText(created[1] ?? ""),
				branch: safeText(created[2] ?? ""),
				repository_url: remote,
			});
	}
	return pushes;
}

/**
 * The CI status reads a call made: `gh pr checks` and `gh run watch|view|list`
 * invocations in a shell command (not text that merely mentions them), and
 * GitHub MCP calls that read runs, jobs or check status. Each keeps the
 * repository, PR and branch it names. A shell check is `unconfirmed` when the
 * command does not show that it ran: it follows `||` or sits in a compound
 * construct, or follows `&&` while the command failed overall.
 */
function ciChecks(
	call: GitObservationRecord,
	record: GitObservationRecord,
): Partial<RudelSessionGitObservationsRow>[] {
	const command = shellCommand(call);
	if (command !== null) {
		const segments = parseShellCommand(command);
		return segments.flatMap((segment, index) => {
			const target = ghCiTarget(segment.words);
			if (!target) return [];
			const connectors = segments
				.slice(1, index + 1)
				.map((part) => part.connector);
			const unconditional = connectors.every(
				(connector) => connector === ";" || connector === "|",
			);
			// Success proves every segment ran only for a pure `&&` chain:
			// `false && gh pr checks; true` also exits 0 without running the check.
			const chained =
				record.exit_code === 0 &&
				segments.every((part) => !part.nested) &&
				segments.slice(1).every((part) => part.connector === "&&");
			return [
				{
					kind: "ci_check",
					...target,
					label:
						!segment.nested && (unconditional || chained)
							? "observed"
							: "unconfirmed",
				},
			];
		});
	}
	if (record.is_error || mcpFailed(record.text)) return [];
	if (GITHUB_CI_METHOD_TOOL_PATTERN.test(call.tool_name)) {
		const method = /"method"\s*:\s*"([^"]+)"/u.exec(call.text)?.[1] ?? "";
		if (!/status|check|run|job/iu.test(method)) return [];
	} else if (!GITHUB_CI_TOOL_PATTERN.test(call.tool_name)) return [];
	const owner = /"owner"\s*:\s*"([\w.-]+)"/u.exec(call.text)?.[1];
	const name = /"repo"\s*:\s*"([\w.-]+)"/u.exec(call.text)?.[1];
	return [
		{
			kind: "ci_check",
			pr_repo: owner && name ? safeText(`${owner}/${name}`) : "",
			pr_number: prNumber(
				/"pull(?:_n|N)umber"\s*:\s*(\d+)/u.exec(call.text)?.[1],
			),
			run_id: /"run(?:_i|I)d"\s*:\s*"?(\d+)/u.exec(call.text)?.[1] ?? "",
			commit_hash: commitSha(
				/"(?:head_sha|headSha|sha|commit_sha)"\s*:\s*"([a-f\d]{7,40})"/iu.exec(
					call.text,
				)?.[1],
			),
		},
	];
}

/**
 * The shell command a call ran: Claude Bash input is the command; Codex shell
 * calls carry it as JSON (`cmd`, or `command` as a string or an argv whose
 * `-c`/`-lc` script is the command). Null for GitHub MCP tools.
 */
function shellCommand(call: GitObservationRecord): string | null {
	if (
		GITHUB_CI_TOOL_PATTERN.test(call.tool_name) ||
		GITHUB_PR_TOOL_PATTERN.test(call.tool_name)
	)
		return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(call.text);
	} catch {
		return call.text;
	}
	const input = objectValue(parsed);
	if (typeof input.cmd === "string") return input.cmd;
	if (typeof input.command === "string") return input.command;
	if (Array.isArray(input.command)) {
		const words = input.command.filter(
			(word): word is string => typeof word === "string",
		);
		const flag = words.findIndex((word) => /^-[a-z]*c$/u.test(word));
		const script = flag > 0 ? words[flag + 1] : undefined;
		return script ?? words.join(" ");
	}
	return call.text;
}

/** The repository, PR and branch a `gh` CI status invocation names. */
function ghCiTarget(
	words: readonly string[],
): Pick<
	RudelSessionGitObservationsRow,
	"pr_repo" | "pr_number" | "branch" | "run_id" | "commit_hash"
> | null {
	if (words[0]?.split("/").at(-1) !== "gh") return null;
	let repo = "";
	let branch = "";
	let commit = "";
	const positional: string[] = [];
	for (let index = 1; index < words.length; index++) {
		const word = words[index] ?? "";
		const [flag, inline] = word.startsWith("--") ? word.split("=", 2) : [word];
		if (GH_VALUE_FLAGS.has(flag ?? "")) {
			const value = inline ?? words[++index] ?? "";
			if (flag === "-R" || flag === "--repo") repo = value;
			if (flag === "-b" || flag === "--branch") branch = value;
			if (flag === "-c" || flag === "--commit") commit = value;
			continue;
		}
		if (word.startsWith("-")) continue;
		positional.push(word);
	}
	const [group, action, target = ""] = positional;
	const isCheck =
		(group === "pr" && action === "checks") ||
		(group === "run" && ["watch", "view", "list"].includes(action ?? ""));
	if (!isCheck) return null;
	let number = 0;
	let runId = "";
	if (group === "run" && action !== "list" && /^\d+$/u.test(target))
		runId = target;
	if (group === "pr") {
		const url =
			/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/u.exec(target);
		if (url) {
			repo = `${url[1]}/${url[2]}`;
			number = prNumber(url[3]);
		} else if (/^\d+$/u.test(target)) number = prNumber(target);
		else if (target) branch = target;
	}
	return {
		pr_repo: safeText(repo.replace(/^https:\/\/github\.com\//u, "")),
		pr_number: number,
		branch: safeText(branch),
		run_id: runId,
		commit_hash: commitSha(commit),
	};
}

/** A literal commit SHA a CI check names, lowercased; empty when it is not one. */
function commitSha(value: string | undefined): string {
	return value && /^[a-f\d]{7,40}$/iu.test(value) ? value.toLowerCase() : "";
}

function prNumber(value: string | undefined): number {
	const number = Number(value ?? 0);
	return Number.isSafeInteger(number) && number > 0 && number <= 4_294_967_295
		? number
		: 0;
}
