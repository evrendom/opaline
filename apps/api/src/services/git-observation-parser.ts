import { createHash } from "node:crypto";
import {
	splitTranscript,
	type TranscriptSource,
} from "@rudel/api-routes/transcript-records";
import type { RudelSessionGitObservationsRow } from "@rudel/ch-schema/generated";
import { filterKnownSecrets } from "@rudel/secret-filter";

export const GIT_OBSERVATION_PARSER_VERSION = 2;
export const GIT_OBSERVATION_MAX_RAW_BYTES = 1024 * 1024;
export const GIT_OBSERVATION_MAX_ROWS = 10_000;
export const GIT_TOOL_PATTERN =
	/\bgit\b[^\n;&|]*\b(?:commit|push|merge|cherry-pick|rebase|revert)\b|\bgh\s+pr\b/iu;
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
		if (
			record.is_error ||
			(record.exit_code !== null && record.exit_code !== 0)
		)
			continue;
		if (!call) continue;
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
		if (mcp && mcpFailed(record.text)) continue;
		let ordinal = 0;
		const add = (fields: Partial<RudelSessionGitObservationsRow>) => {
			if (observations.length >= GIT_OBSERVATION_MAX_ROWS)
				throw new Error("Git observation expansion limit exceeded");
			observations.push({
				...baseRow(input, record),
				block_idx: record.block_idx * 65_536 + ordinal++,
				...fields,
			});
		};
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
				for (const match of record.text.matchAll(
					/^\s*(?:\+\s+)?([a-f\d]{4,40})\.{2,3}([a-f\d]{4,40})\s+(\S+)\s+->\s+(\S+)(?:\s|$)/gimu,
				)) {
					add({
						kind: "push_range",
						push_from_sha: (match[1] ?? "").toLowerCase(),
						push_to_sha: (match[2] ?? "").toLowerCase(),
						push_source_branch: safeText(match[3] ?? ""),
						branch: safeText(match[4] ?? ""),
					});
				}
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
	}
	return observations;
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
