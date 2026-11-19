import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { readClaudeLine } from "../packages/api-routes/src/session-transcript/transcript-records/claude-records.js";
import { collectCodexOutcome } from "../packages/api-routes/src/session-transcript/transcript-records/codex-outcomes.js";
import {
	readCodexAgentId,
	readCodexLine,
} from "../packages/api-routes/src/session-transcript/transcript-records/codex-records.js";
import {
	createStreamState,
	isRecord,
} from "../packages/api-routes/src/session-transcript/transcript-records/line-items.js";
import { budgetFacts } from "../packages/api-routes/src/session-transcript/transcript-records/split-transcript.js";
import { buildTranscriptTextFields } from "../packages/api-routes/src/session-transcript/transcript-records/text-fields.js";
import {
	TRANSCRIPT_RECORD_INJECTED_TEXT_MAX_CHARS,
	TRANSCRIPT_RECORD_MAX_PARSE_LINE_BYTES,
	TRANSCRIPT_RECORD_META_TEXT_MAX_CHARS,
	TRANSCRIPT_RECORD_TEXT_MAX_CHARS,
	TRANSCRIPT_RECORDS_SESSION_FACT_BUDGET_CHARS,
	TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS,
	type TranscriptSource,
} from "../packages/api-routes/src/session-transcript/transcript-records/types.js";
import {
	codexLifecycleFactsByRun,
	streamTurnKey,
} from "../apps/desktop/server/src/services/analysis/codex-lifecycle.js";
import {
	isRunIndexColumnRecordable,
	type RunIndexFactColumn,
} from "../apps/desktop/server/src/services/analysis/run-index-columns.js";
import {
	RUN_INDEX_PR_URL_PATTERN,
	readRunIndexComponentValues,
} from "../apps/desktop/server/src/services/analysis/run-index-components.js";
import {
	type CodexLifecycleRow,
	CodexLifecycleRowSchema,
	type CodexTurnMark,
} from "../apps/desktop/server/src/services/analysis/run-index-sql.js";

const COLUMNS = [
	"skills",
	"subagent_types",
	"per_turn_effort",
	"abort_reason",
	"api_errors",
	"api_error",
	"api_error_statuses",
	"pr_urls",
	"duration_ms",
	"turn_origin",
	"prompt_source",
	"origin_kind",
	"compact_pre_tokens",
	"refusals",
] as const satisfies readonly RunIndexFactColumn[];
const RESPONSE_KINDS = new Set([
	"assistant_text",
	"reasoning",
	"tool_call",
	"tool_result",
	"file_change",
]);
const LIFECYCLE = new Set([
	"turn_context",
	"task_started",
	"task_complete",
	"turn_aborted",
]);
const PR_URL = new RegExp(RUN_INDEX_PR_URL_PATTERN, "u");
const started = performance.now();
const report = {
	agents: {} as Record<
		TranscriptSource,
		{
			files: number;
			records: number;
			runs: number;
			accountEmailRows: number;
			columns: Record<string, { before: number; after: number }>;
		}
	>,
	oversized: 0,
	unparseable: 0,
	replayed: 0,
	peakRssBytes: 0,
	seconds: 0,
};

async function inventory(
	directory: string,
): Promise<{ path: string; bytes: number }[]> {
	const result: { path: string; bytes: number }[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = `${directory}/${entry.name}`;
		if (entry.isDirectory()) result.push(...(await inventory(path)));
		else if (entry.isFile() && entry.name.endsWith(".jsonl"))
			result.push({ path, bytes: (await stat(path)).size });
	}
	return result.sort((left, right) => left.path.localeCompare(right.path));
}

async function* records(file: { path: string; bytes: number }) {
	let offset = 0;
	const stream = createReadStream(file.path, {
		highWaterMark: 64 * 1024,
		end: file.bytes - 1,
	});
	const lines = createInterface({ input: stream, crlfDelay: Infinity });
	let index = 0;
	for await (const line of lines) {
		index++;
		offset += Buffer.byteLength(line) + 1;
		if (Buffer.byteLength(line) > TRANSCRIPT_RECORD_MAX_PARSE_LINE_BYTES) {
			report.oversized++;
			continue;
		}
		if (line.trim() === "") continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			report.unparseable++;
			continue;
		}
		if (isRecord(parsed)) yield { record: parsed, index, offset };
	}
}

function jsonString(text: string, key: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, "u").exec(text)?.[1] ?? "";
	}
	return isRecord(parsed) && typeof parsed[key] === "string" ? parsed[key] : "";
}

for (const source of ["claude_code", "codex"] as const) {
	const files = await inventory(
		`${homedir()}/${source === "codex" ? ".codex/sessions" : ".claude/projects"}`,
	);
	const groups = new Map<string, typeof files>();
	for (const file of files.filter((file) => file.bytes > 0)) {
		const group =
			source === "codex"
				? file.path
				: file.path.replace(
						/\/([^/]+)\/subagents\/[^/]+[.]jsonl$/u,
						"/$1.jsonl",
					);
		const groupFiles = groups.get(group) ?? [];
		groupFiles.push(file);
		groups.set(group, groupFiles);
	}
	const counters = {
		files: 0,
		records: 0,
		runs: 0,
		accountEmailRows: 0,
		columns: Object.fromEntries(
			COLUMNS.map((column) => [column, { before: 0, after: 0 }]),
		),
	};
	report.agents[source] = counters;
	for (const [group, groupFiles] of groups) {
		groupFiles.sort(
			(left, right) =>
				Number(right.path === group) - Number(left.path === group) ||
				left.path.localeCompare(right.path),
		);
		const factBudget = {
			remaining: TRANSCRIPT_RECORDS_SESSION_FACT_BUDGET_CHARS,
		};
		const textBudget = {
			remaining: TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS,
		};
		const totalBytes = groupFiles.reduce((sum, file) => sum + file.bytes, 0);
		let bytesBefore = 0;
		for (const file of groupFiles) {
			const streams = new Map<string, ReturnType<typeof createStreamState>>();
			const streamFor = (agent: string) => {
				let state = streams.get(agent);
				if (state === undefined) {
					state = createStreamState("1970-01-01T00:00:00Z", agent !== "");
					streams.set(agent, state);
				}
				return state;
			};
			if (source === "codex")
				for await (const { record } of records(file))
					collectCodexOutcome(
						record,
						streamFor(readCodexAgentId(record) ?? "").codexEndEvents,
					);
			const runs = new Map<
				string,
				{ before: Set<string>; after: Set<string>; promptSeen: boolean }
			>();
			const marks = new Map<string, CodexTurnMark>();
			const lifecycle: CodexLifecycleRow[] = [];
			for await (const { record, index, offset } of records(file)) {
				counters.records++;
				const agent =
					source === "codex"
						? (readCodexAgentId(record) ?? "")
						: file.path === group
							? ""
							: "subagent";
				const state = streamFor(agent);
				const items = (
					source === "codex"
						? readCodexLine(record, state)
						: readClaudeLine(record, state)
				).items;
				for (const [block, item] of items.entries()) {
					if (item.kind === "user_prompt") {
						if (state.turnIdx === 0 || state.responseSincePrompt) {
							state.turnIdx++;
							state.responseSincePrompt = false;
						}
						state.lastPromptText = item.text ?? "";
					} else if (RESPONSE_KINDS.has(item.kind))
						state.responseSincePrompt = true;
					const facts = budgetFacts(item.facts, factBudget);
					const extra: Readonly<Record<string, string | undefined>> = facts?.extra ?? {};
					const allowance =
						Math.floor(
							TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS *
								Math.min(1, (bytesBefore + offset) / totalBytes),
						) -
						(TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS -
							textBudget.remaining);
					const fields = buildTranscriptTextFields(item.text ?? "", {
						allowance,
						budget: textBudget,
						keepTail: item.kind === "tool_result" || item.isError === true,
						textMaxChars:
							item.kind === "meta"
								? TRANSCRIPT_RECORD_META_TEXT_MAX_CHARS
								: item.kind === "injected_context"
									? TRANSCRIPT_RECORD_INJECTED_TEXT_MAX_CHARS
									: TRANSCRIPT_RECORD_TEXT_MAX_CHARS,
					});
					if (
						extra.account_context_components?.includes(
							"attachment/session_context.attachment.context.userEmail",
						)
					)
						counters.accountEmailRows++;
					if (extra.fork_replayed === "true") {
						report.replayed++;
						continue;
					}
					const key = streamTurnKey(agent, state.turnIdx);
					const mark = marks.get(key) ?? {
						agent_id: agent,
						turn_idx: state.turnIdx,
						turn_start: index,
						last_response: 0,
					};
					if (RESPONSE_KINDS.has(item.kind)) mark.last_response = index;
					marks.set(key, mark);
					if (
						source === "codex" &&
						item.kind === "meta" &&
						LIFECYCLE.has(item.subtype ?? "")
					) {
						const shape = CodexLifecycleRowSchema.shape;
						lifecycle.push(
							CodexLifecycleRowSchema.parse({
								...Object.fromEntries(
									Object.keys(shape).map((column) => [
										column,
										extra[column] ?? "",
									]),
								),
								agent_id: agent,
								record_idx: index,
								block_idx: block,
								turn_idx: state.turnIdx,
								subtype: item.subtype,
								task_duration_ms: facts?.durationMs ?? null,
							}),
						);
					}
					if (state.turnIdx < 1) continue;
					const run = runs.get(key) ?? {
						before: new Set<string>(),
						after: new Set<string>(),
						promptSeen: false,
					};
					runs.set(key, run);
					const value = (
						column: (typeof COLUMNS)[number],
						present: boolean,
						before = present,
					) => {
						if (before) run.before.add(column);
						if (present && isRunIndexColumnRecordable(column, 9, source))
							run.after.add(column);
					};
					const components = readRunIndexComponentValues(extra);
					const oldSkill =
						Boolean(facts?.attributionSkill) ||
						(item.kind === "tool_call" &&
							item.toolName === "Skill" &&
							jsonString(fields.head.slice(0, 240), "skill") !== "");
					value(
						"skills",
						source === "codex"
							? components.skills.length > 0
							: oldSkill || Boolean(extra.skill),
						source === "claude_code" && oldSkill,
					);
					const oldType =
						item.kind === "tool_call" &&
						["Task", "Agent"].includes(item.toolName ?? "") &&
						jsonString(fields.text, "subagent_type") !== "";
					value(
						"subagent_types",
						source === "codex" ? components.subagentTypes.length > 0 : oldType,
						source === "claude_code" && oldType,
					);
					value(
						"per_turn_effort",
						source === "claude_code"
							? Boolean(extra.per_turn_effort)
							: !LIFECYCLE.has(item.subtype ?? "") && Boolean(extra.effort),
						source === "claude_code" && Boolean(extra.per_turn_effort),
					);
					value(
						"abort_reason",
						source === "claude_code" && components.abortReason !== "",
						false,
					);
					const oldApi = Boolean(extra.api_error || extra.api_error_status);
					value(
						"api_errors",
						source === "codex" ? components.apiError !== "" : oldApi,
						source === "claude_code" && oldApi,
					);
					value(
						"api_error",
						source === "codex"
							? components.apiError !== ""
							: Boolean(extra.api_error),
						source === "claude_code" && Boolean(extra.api_error),
					);
					value(
						"api_error_statuses",
						source === "codex"
							? components.apiErrorStatuses.length > 0
							: Boolean(extra.api_error_status),
						source === "claude_code" && Boolean(extra.api_error_status),
					);
					const oldPr = Boolean(extra.pr_url || extra["git.pr.url"]);
					value(
						"pr_urls",
						source === "codex"
							? item.kind === "tool_result" && PR_URL.test(fields.text)
							: oldPr,
						source === "claude_code" && oldPr,
					);
					if (item.kind === "user_prompt" && !run.promptSeen) {
						for (const column of [
							"turn_origin",
							"prompt_source",
							"origin_kind",
						] as const)
							value(
								column,
								Boolean(extra[column]),
								source === "claude_code" && Boolean(extra[column]),
							);
						run.promptSeen = true;
					}
					value(
						"compact_pre_tokens",
						source === "claude_code" &&
							/^\d+$/u.test(extra.compact_pre_tokens ?? ""),
					);
					value(
						"refusals",
						source === "claude_code" && Boolean(extra.refusal_category),
					);
				}
				if (index % 1000 === 0) {
					report.peakRssBytes = Math.max(
						report.peakRssBytes,
						process.memoryUsage().rss,
					);
					if (report.peakRssBytes > 1_450_000_000)
						throw new Error("Counter audit exceeded its memory bound");
				}
			}
			for (const [key, native] of codexLifecycleFactsByRun(lifecycle, [
				...marks.values(),
			])) {
				const run = runs.get(key);
				if (run === undefined) continue;
				if (native.effort !== "") run.after.add("per_turn_effort");
				if (native.abortReason !== "") {
					run.before.add("abort_reason");
					run.after.add("abort_reason");
				}
				if (native.durationMs !== null) {
					run.before.add("duration_ms");
					run.after.add("duration_ms");
				}
			}
			counters.runs += runs.size;
			for (const run of runs.values())
				for (const column of COLUMNS) {
					const count = counters.columns[column];
					if (count === undefined) throw new Error("Missing column counter");
					count.before += Number(run.before.has(column));
					count.after += Number(run.after.has(column));
				}
			bytesBefore += file.bytes;
			counters.files++;
			if (counters.files % 100 === 0)
				process.stderr.write(
					`${JSON.stringify({
						source,
						files: counters.files,
						records: counters.records,
						rssBytes: process.memoryUsage().rss,
					})}\n`,
				);
		}
	}
}
report.seconds = (performance.now() - started) / 1000;
report.peakRssBytes = Math.max(
	report.peakRssBytes,
	process.resourceUsage().maxRSS,
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
