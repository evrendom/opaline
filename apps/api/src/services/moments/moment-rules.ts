import type { CompassSettings, MomentKind, RunFlag } from "@rudel/api-routes";
import { LANGUAGE_SIGNAL_RULES } from "@rudel/language-signals";
import { z } from "zod";
import { getSafeClickHouseTable } from "../../clickhouse.js";
import { committedBuildSql } from "../analysis/run-index-reader.js";
import { toolGroupSql } from "../analysis/tool-groups.js";
import { RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";

/**
 * The flags that make a run noticeable on Compass (CONTEXT.md "Moment").
 * Each reads facts the run index and the transcript records already hold, so
 * a flag costs nothing to find and needs no model; it only says where to
 * look. "User frustrated" also counts SubQ's answer about the member's next
 * prompt where the workspace has the frustration check. One query reads
 * every run of the range's committed builds with the per-run evidence the
 * flags need; `flagsOfRun` turns one run's row and the workspace's settings
 * into its flags.
 */

/** Newest runs of a range the flags read at most. */
export const MOMENT_RUNS_MAX = 5_000;
/** Runs with a cost (or a duration) a range needs before "Expensive" ("Long") can rank them. */
export const PERCENTILE_MIN_RUNS = 20;
/** Shell calls, tool results and edits per run the flags look at. */
const PER_RUN_ARRAY_MAX = 3_000;
/** Git and CI calls, and apologies, per run the flags look at. */
const PER_RUN_FEW_MAX = 200;
const COMMAND_CHARS = 160;
/** `gh pr checks` exits 8 while checks are pending, 1 when one failed. */
const CHECKS_PENDING_EXIT = 8;

/** CI status reads whose failure means CI failed (with an exit status). */
const CI_CHECK_COMMAND = /\bgh\s+(?:pr\s+checks|run\s+(?:watch|view))\b/u;
/** Git commands that throw work away (not `git restore --staged`, which only unstages). */
const GIT_REVERT_COMMAND =
	/\bgit\s+(?:revert\b|reset\s+(?:[^;&|]*\s)?--hard\b|restore\b(?![^;&|]*--staged)|checkout\s+(?:[^;&|]*\s)?--\s|checkout\s+\.(?:\s|$)|clean\s+-[a-zA-Z]*f)/u;

/** The dashboard's apology phrases (language signals), as one RE2 pattern over lowercased text. */
export const APOLOGY_PATTERN = `\\b(?:${LANGUAGE_SIGNAL_RULES.filter(
	(rule) => rule.category === "apology",
)
	.flatMap((rule) => rule.surfaces)
	.sort((a, b) => b.length - a.length)
	.map((surface) => surface.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
	.join("|")})\\b`;

export interface MomentScope {
	readonly workspaceId: string;
	/** The one member whose runs may be read, or null for every member's. */
	readonly member: string | null;
}

export const RunEvidenceSchema = z.object({
	user_id: z.string(),
	session_id: z.string(),
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	revision: z.coerce.string(),
	parser_version: z.coerce.number(),
	started_ms: z.coerce.number(),
	start_record: z.coerce.number(),
	end_record: z.coerce.number(),
	prompt_head: z.string().nullable(),
	model: z.string().nullable(),
	cost_usd: z.coerce.number().nullable(),
	minutes: z.coerce.number(),
	compactions: z.coerce.number(),
	aborted: z.string().nullable(),
	interrupted_calls: z.coerce.number(),
	denied_calls: z.coerce.number(),
	has_final_message: z.coerce.number(),
	next_reactions: z.array(z.string()),
	first_edit: z.coerce.number().nullable(),
	explore_records: z.array(z.coerce.number()),
	result_records: z.array(z.coerce.number()),
	failed_records: z.array(z.coerce.number()),
	shell_calls: z.array(z.tuple([z.coerce.number(), z.string(), z.string()])),
	failed_call_ids: z.array(z.string()),
	first_queued: z.coerce.number().nullable(),
	edit_files: z.array(z.tuple([z.coerce.number(), z.string()])),
	ci_calls: z.array(z.tuple([z.coerce.number(), z.string(), z.string()])),
	pending_call_ids: z.array(z.string()),
	git_calls: z.array(z.tuple([z.coerce.number(), z.string()])),
	apology_records: z.array(z.coerce.number()),
});
export type RunEvidence = z.infer<typeof RunEvidenceSchema>;

/** One run of one session's stream. */
export interface RunKey {
	readonly userId: string;
	readonly sessionId: string;
	readonly agentId: string;
	readonly turn: number;
}

/** What a run's flags need beyond its own evidence. */
export interface FlagContext {
	/** The cost at or above which a run is among the costliest; null when the range has too few runs. */
	readonly costCutoff: number | null;
	/** The same for minutes. */
	readonly minutesCutoff: number | null;
	readonly ranked?: {
		readonly costs: readonly number[];
		readonly minutes: readonly number[];
	};
	/** SubQ's probability that the member's next prompt is frustrated; null when not asked. */
	readonly frustration: number | null;
}

const RANGE_STARTED = {
	from: "toDateTime64({startDate:String}, 3, 'UTC')",
	to: "toDateTime64({endDate:String}, 3, 'UTC') + INTERVAL 1 DAY",
};
const EVIDENCE_STARTED = {
	...RANGE_STARTED,
	to: "toDateTime64({endDate:String}, 3, 'UTC') + INTERVAL 3 DAY",
};

/**
 * Every run of the range's committed builds, newest first, with what the
 * rules need: run index facts, the next run's prompt reactions, and the
 * ordered records of the run's tool calls and results.
 */
export function runEvidenceStatement(
	scope: MomentScope,
	range: { startDate: string; endDate: string } | { run: RunKey },
) {
	const one = "run" in range ? range.run : null;
	const runs = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const records = getSafeClickHouseTable("rudel.transcript_records");
	const owner = `organization_id = {workspaceId:String}${
		scope.member === null ? "" : " AND user_id = {member:String}"
	}`;
	const group = toolGroupSql("tool_name", "head");
	return {
		query: `WITH r AS (
				SELECT user_id, session_id, agent_id, turn_idx, revision, parser_version,
					started_at, start_record, end_record, prompt_head, model, cost_usd, minutes,
					compactions, aborted, interrupted_calls, coalesce(denied_calls, 0) AS denied_calls,
					final_message IS NOT NULL AS has_final_message,
					leadInFrame(prompt_reactions) OVER (
						PARTITION BY user_id, session_id, agent_id ORDER BY turn_idx
						ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING
					) AS next_reactions
				FROM ${runs} FINAL
				WHERE ${owner} AND row_kind = 'run'
					AND ${committedBuildSql(runs, owner, ["user_id", "session_id"], one ? undefined : EVIDENCE_STARTED)}
					AND ${
						one
							? "user_id = {runUser:String} AND session_id = {runSession:String} AND agent_id = {runAgent:String}"
							: `started_at >= toDateTime64({startDate:String}, 3, 'UTC')
					AND started_at < toDateTime64({endDate:String}, 3, 'UTC') + INTERVAL 3 DAY`
					}
			),
			ranged AS (
				SELECT * FROM r
				WHERE ${
					one
						? "turn_idx = {runTurn:UInt32}"
						: `started_at >= toDateTime64({startDate:String}, 3, 'UTC')
					AND started_at < toDateTime64({endDate:String}, 3, 'UTC') + INTERVAL 1 DAY`
				}
				ORDER BY started_at DESC
				LIMIT {maxRuns:UInt32}
			),
			rec AS (
				SELECT user_id, session_id, agent_id, turn_idx,
					minIf(record_idx, kind = 'file_change' AND file_op IN ('write', 'edit', 'delete')) AS first_edit_raw,
					countIf(kind = 'file_change' AND file_op IN ('write', 'edit', 'delete')) AS edits,
					arraySort(groupArrayIf(record_idx, kind = 'tool_call' AND ${group} IN ('read', 'search'))) AS explore_records,
					arraySlice(arraySort(groupArrayIf(record_idx, kind = 'tool_result' AND subtype != 'running')), 1, ${PER_RUN_ARRAY_MAX}) AS result_records,
					arraySort(groupArrayIf(record_idx, kind = 'tool_result' AND subtype != 'running'
						AND (is_error OR coalesce(exit_code, 0) != 0))) AS failed_records,
					arraySlice(arraySort(x -> x.1, groupArrayIf(
						(record_idx, call_id, substring(replaceRegexpAll(trimBoth(head), '\\\\s+', ' '), 1, ${COMMAND_CHARS})),
						kind = 'tool_call' AND ${group} = 'shell')), 1, ${PER_RUN_ARRAY_MAX}) AS shell_calls,
					groupArrayIf(call_id, kind = 'tool_result' AND (is_error OR coalesce(exit_code, 0) != 0)) AS failed_call_ids,
					minIf(record_idx, kind = 'user_prompt' AND subtype = 'queued') AS first_queued_raw,
					countIf(kind = 'user_prompt' AND subtype = 'queued') AS queued,
					arraySlice(arraySort(x -> x.1, groupArrayIf((record_idx, file_path),
						kind = 'file_change' AND file_op IN ('write', 'edit') AND file_path != '')), 1, ${PER_RUN_ARRAY_MAX}) AS edit_files,
					arraySlice(arraySort(x -> x.1, groupArrayIf(
						(record_idx, call_id, substring(replaceRegexpAll(trimBoth(head), '\\s+', ' '), 1, 300)),
						kind = 'tool_call' AND ${group} = 'shell' AND match(head, 'gh\\s+(pr|run)\\s'))), 1, ${PER_RUN_FEW_MAX}) AS ci_calls,
					groupArrayIf(call_id, kind = 'tool_result' AND exit_code = ${CHECKS_PENDING_EXIT}) AS pending_call_ids,
					arraySlice(arraySort(x -> x.1, groupArrayIf(
						(record_idx, substring(replaceRegexpAll(trimBoth(head), '\\s+', ' '), 1, 300)),
						kind = 'tool_call' AND ${group} = 'shell' AND match(head, 'git\\s+(revert|reset|restore|checkout|clean)'))), 1, ${PER_RUN_FEW_MAX}) AS git_calls,
					arraySlice(arraySort(groupArrayIf(record_idx,
						kind = 'assistant_text' AND match(replaceAll(lower(head), '\u2019', ''''), {apologyPattern:String}))), 1, ${PER_RUN_FEW_MAX}) AS apology_records
				FROM ${records} FINAL
				WHERE ${owner}
					AND (user_id, session_id, revision, parser_version) IN (
						SELECT user_id, session_id, revision, parser_version FROM ranged
					)
					AND turn_idx >= 1
				GROUP BY user_id, session_id, agent_id, turn_idx
			)
			SELECT ranged.user_id AS user_id, ranged.session_id AS session_id,
				ranged.agent_id AS agent_id, ranged.turn_idx AS turn_idx,
				toString(ranged.revision) AS revision,
				ranged.parser_version AS parser_version,
				toUnixTimestamp64Milli(ranged.started_at) AS started_ms,
				ranged.start_record AS start_record, ranged.end_record AS end_record,
				ranged.prompt_head AS prompt_head, ranged.model AS model,
				ranged.cost_usd AS cost_usd, ranged.minutes AS minutes,
				ranged.compactions AS compactions, ranged.aborted AS aborted,
				ranged.interrupted_calls AS interrupted_calls, ranged.denied_calls AS denied_calls,
				toUInt8(ranged.has_final_message) AS has_final_message,
				ranged.next_reactions AS next_reactions,
				if(rec.edits > 0, rec.first_edit_raw, NULL) AS first_edit,
				rec.explore_records AS explore_records,
				rec.result_records AS result_records,
				rec.failed_records AS failed_records,
				rec.shell_calls AS shell_calls,
				rec.failed_call_ids AS failed_call_ids,
				if(rec.queued > 0, rec.first_queued_raw, NULL) AS first_queued,
				rec.edit_files AS edit_files,
				rec.ci_calls AS ci_calls,
				rec.pending_call_ids AS pending_call_ids,
				rec.git_calls AS git_calls,
				rec.apology_records AS apology_records
			FROM ranged
			LEFT JOIN rec ON rec.user_id = ranged.user_id AND rec.session_id = ranged.session_id
				AND rec.agent_id = ranged.agent_id AND rec.turn_idx = ranged.turn_idx
			ORDER BY started_ms DESC, session_id, agent_id, turn_idx`,
		query_params: {
			workspaceId: scope.workspaceId,
			...(scope.member === null ? {} : { member: scope.member }),
			...(one
				? {
						runUser: one.userId,
						runSession: one.sessionId,
						runAgent: one.agentId,
						runTurn: one.turn,
					}
				: "startDate" in range
					? { startDate: range.startDate, endDate: range.endDate }
					: {}),
			maxRuns: MOMENT_RUNS_MAX,
			apologyPattern: APOLOGY_PATTERN,
		},
	};
}

const RankValueSchema = z.object({
	cost_usd: z.coerce.number().nullable(),
	minutes: z.coerce.number(),
});

/** Cost and minutes of every run of a range's committed builds (newest `MOMENT_RUNS_MAX`), to rank one run against. */
export function rankValuesStatement(
	scope: MomentScope,
	range: { startDate: string; endDate: string },
) {
	const runs = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const owner = `organization_id = {workspaceId:String}${
		scope.member === null ? "" : " AND user_id = {member:String}"
	}`;
	return {
		schema: RankValueSchema,
		query: `SELECT cost_usd, minutes FROM ${runs} FINAL
			WHERE ${owner} AND row_kind = 'run'
				AND ${committedBuildSql(runs, owner, ["user_id", "session_id"], RANGE_STARTED)}
				AND started_at >= toDateTime64({startDate:String}, 3, 'UTC')
				AND started_at < toDateTime64({endDate:String}, 3, 'UTC') + INTERVAL 1 DAY
			ORDER BY started_at DESC
			LIMIT {maxRuns:UInt32}`,
		query_params: {
			workspaceId: scope.workspaceId,
			...(scope.member === null ? {} : { member: scope.member }),
			startDate: range.startDate,
			endDate: range.endDate,
			maxRuns: MOMENT_RUNS_MAX,
		},
	};
}

/**
 * The flags of one run that the workspace has on, in the order of the kinds.
 * A run with none is not noticeable.
 */
export function flagsOfRun(
	run: RunEvidence,
	settings: CompassSettings,
	context: FlagContext,
): RunFlag[] {
	const lastRecord = Math.max(run.start_record, run.end_record - 1);
	const whole = { spanStart: run.start_record, spanEnd: lastRecord };
	const found: RunFlag[] = [];
	const on = (kind: MomentKind) => settings.flags[kind].enabled;
	const value = (kind: MomentKind) => settings.flags[kind].value ?? 1;
	const failed = new Set(run.failed_call_ids);

	if (on("search_before_edit")) {
		const firstEdit = run.first_edit;
		const explored =
			firstEdit === null
				? run.explore_records
				: run.explore_records.filter((record) => record < firstEdit);
		if (explored.length >= value("search_before_edit"))
			found.push({
				kind: "search_before_edit",
				spanStart: run.start_record,
				spanEnd: firstEdit ?? explored.at(-1) ?? lastRecord,
				count: explored.length,
				detail:
					firstEdit === null
						? `${explored.length} reads and searches, no edit`
						: `${explored.length} reads and searches before the first edit`,
			});
	}

	if (
		on("expensive_run") &&
		context.costCutoff !== null &&
		run.cost_usd !== null &&
		run.cost_usd > 0 &&
		run.cost_usd >= context.costCutoff
	)
		found.push({
			kind: "expensive_run",
			...whole,
			count: run.cost_usd,
			detail: rankedDetail({
				format: (cost) => `$${cost.toFixed(2)}`,
				cutoff: context.costCutoff,
				percent: value("expensive_run"),
				ranked: context.ranked?.costs,
				run: run.cost_usd,
				word: "costliest",
			}),
		});

	if (
		on("long_run") &&
		context.minutesCutoff !== null &&
		run.minutes > 0 &&
		run.minutes >= context.minutesCutoff
	)
		found.push({
			kind: "long_run",
			...whole,
			count: run.minutes,
			detail: rankedDetail({
				format: (minutes) => `${Math.round(minutes)} min`,
				cutoff: context.minutesCutoff,
				percent: value("long_run"),
				ranked: context.ranked?.minutes,
				run: run.minutes,
				word: "longest",
			}),
		});

	if (on("edit_churn")) {
		const churn = mostEditedFile(run.edit_files);
		if (churn && churn.edits >= value("edit_churn"))
			found.push({
				kind: "edit_churn",
				spanStart: churn.first,
				spanEnd: churn.last,
				count: churn.edits,
				detail: `${fileName(churn.path)} edited ${churn.edits} times`,
			});
	}

	if (on("failing_streak")) {
		const streak = longestFailingStreak(run.result_records, run.failed_records);
		if (streak && streak.length >= value("failing_streak"))
			found.push({
				kind: "failing_streak",
				spanStart: streak.first,
				spanEnd: streak.last,
				count: streak.length,
				detail: `${streak.length} tool results failed in a row`,
			});
	}

	if (on("repeated_command")) {
		const repeated = mostRepeatedFailingCommand(run.shell_calls, failed);
		if (repeated && repeated.runs >= value("repeated_command"))
			found.push({
				kind: "repeated_command",
				spanStart: repeated.first,
				spanEnd: repeated.last,
				count: repeated.runs,
				detail: `Ran ${repeated.runs}× (${repeated.failures} failed): ${repeated.command}`,
			});
	}

	if (on("ci_failed")) {
		const pending = new Set(run.pending_call_ids);
		const failedChecks = run.ci_calls.filter(
			([, callId, command]) =>
				CI_CHECK_COMMAND.test(command) &&
				callId !== "" &&
				failed.has(callId) &&
				!pending.has(callId),
		);
		const first = failedChecks[0];
		if (first)
			found.push({
				kind: "ci_failed",
				spanStart: first[0],
				spanEnd: Math.min(
					lastRecord,
					(failedChecks.at(-1)?.[0] ?? first[0]) + 1,
				),
				count: failedChecks.length,
				detail:
					failedChecks.length === 1
						? `CI failed: ${first[2]}`
						: `CI failed ${failedChecks.length}×: ${first[2]}`,
			});
	}

	if (on("git_reverted")) {
		const reverts = run.git_calls.filter(([, command]) =>
			GIT_REVERT_COMMAND.test(command),
		);
		const first = reverts[0];
		if (first)
			found.push({
				kind: "git_reverted",
				spanStart: first[0],
				spanEnd: reverts.at(-1)?.[0] ?? first[0],
				count: reverts.length,
				detail:
					reverts.length === 1
						? first[1]
						: `${reverts.length} reverts: ${first[1]}`,
			});
	}

	if (on("denied_calls") && run.denied_calls >= value("denied_calls"))
		found.push({
			kind: "denied_calls",
			...whole,
			count: run.denied_calls,
			detail: `${run.denied_calls} tool calls denied`,
		});

	if (
		on("interrupted") &&
		(run.aborted === "true" || run.interrupted_calls > 0)
	)
		found.push({
			kind: "interrupted",
			...whole,
			count: Math.max(1, run.interrupted_calls),
			detail:
				run.interrupted_calls > 0
					? `${run.interrupted_calls} tool calls interrupted`
					: "The run was aborted",
		});

	if (on("compaction") && run.compactions > 0)
		found.push({
			kind: "compaction",
			...whole,
			count: run.compactions,
			detail: `Context compacted ${run.compactions}× during the run`,
		});

	if (on("mid_run_redirect") && run.first_queued !== null)
		found.push({
			kind: "mid_run_redirect",
			spanStart: run.start_record,
			spanEnd: run.first_queued,
			count: 1,
			detail: "The member wrote while the agent was still working",
		});

	if (
		on("model_apology") &&
		run.apology_records.length >= value("model_apology")
	)
		found.push({
			kind: "model_apology",
			spanStart: run.apology_records[0] ?? run.start_record,
			spanEnd: run.apology_records.at(-1) ?? lastRecord,
			count: run.apology_records.length,
			detail:
				run.apology_records.length === 1
					? "The agent apologized"
					: `The agent apologized ${run.apology_records.length} times`,
		});

	if (on("user_frustrated")) {
		const words =
			run.has_final_message > 0 &&
			run.next_reactions.some((reaction) =>
				["negative", "swear"].includes(reaction),
			);
		const subq =
			context.frustration !== null &&
			context.frustration * 100 >= value("user_frustrated");
		if (words || subq)
			found.push({
				kind: "user_frustrated",
				...whole,
				count: context.frustration ?? 1,
				detail: subq
					? `SubQ: ${Math.round((context.frustration ?? 0) * 100)}% frustrated next prompt`
					: "The next prompt reads frustrated or corrects the agent",
			});
	}

	return found;
}

/**
 * The cost (or duration) at or above which a run is among the top `percent`
 * of the range's runs; null with fewer than `PERCENTILE_MIN_RUNS` positive values.
 */
export function rankedDetail({
	cutoff,
	format,
	percent,
	ranked,
	run,
	word,
}: {
	cutoff: number;
	format: (value: number) => string;
	percent: number;
	ranked: readonly number[] | undefined;
	run: number;
	word: string;
}): string {
	const positive = (ranked ?? []).filter((value) => value > 0);
	if (positive.length === 0)
		return `${format(run)}, among the ${word} ${percent}%`;
	const sorted = [...positive].sort((a, b) => a - b);
	const middle = sorted.length / 2;
	const median = Number.isInteger(middle)
		? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
		: (sorted[Math.floor(middle)] ?? 0);
	const above = sorted.filter((value) => value > run).length;
	const top = Math.max(1, Math.ceil(((above + 1) / sorted.length) * 100));
	const times = median > 0 ? run / median : null;
	const relative =
		times === null
			? ""
			: ` ${times >= 10 ? Math.round(times) : times.toFixed(1)}× the median run (${format(median)});`;
	return `${format(run)},${relative} top ${top}% of ${sorted.length} runs, the ${word} ${percent}% from ${format(cutoff)}`;
}

export function topPercentCutoff(
	values: readonly number[],
	percent: number,
): number | null {
	const positive = values.filter((value) => value > 0).sort((a, b) => b - a);
	if (positive.length < PERCENTILE_MIN_RUNS) return null;
	const index = Math.max(0, Math.ceil((positive.length * percent) / 100) - 1);
	return positive[Math.min(index, positive.length - 1)] ?? null;
}

/** The file edited most often in a run, with its first and last edit. */
export function mostEditedFile(
	edits: readonly (readonly [number, string])[],
): { path: string; edits: number; first: number; last: number } | null {
	const byPath = new Map<
		string,
		{ edits: number; first: number; last: number }
	>();
	for (const [record, path] of edits) {
		const entry = byPath.get(path) ?? { edits: 0, first: record, last: record };
		entry.edits++;
		entry.last = record;
		byPath.set(path, entry);
	}
	let best: ReturnType<typeof mostEditedFile> = null;
	for (const [path, entry] of byPath)
		if (!best || entry.edits > best.edits) best = { path, ...entry };
	return best;
}

function fileName(path: string): string {
	return path.split(/[\\/]/u).filter(Boolean).slice(-2).join("/") || path;
}

/** Whether a shell command throws work away with git. */
export function isGitRevert(command: string): boolean {
	return GIT_REVERT_COMMAND.test(command);
}

/** Whether a shell command reads CI checks in a way that fails when they failed. */
export function isCiCheck(command: string): boolean {
	return CI_CHECK_COMMAND.test(command);
}

/** The longest run of consecutive failing results, by record order. */
export function longestFailingStreak(
	results: readonly number[],
	failed: readonly number[],
): { length: number; first: number; last: number } | null {
	const failing = new Set(failed);
	let best: { length: number; first: number; last: number } | null = null;
	let length = 0;
	let first = 0;
	for (const record of results) {
		if (!failing.has(record)) {
			length = 0;
			continue;
		}
		if (length === 0) first = record;
		length++;
		if (!best || length > best.length) best = { length, first, last: record };
	}
	return best;
}

/** The shell command run most often in a run, when it ran enough and failed at least twice. */
export function mostRepeatedFailingCommand(
	calls: readonly (readonly [number, string, string])[],
	failedCallIds: ReadonlySet<string>,
): {
	command: string;
	runs: number;
	failures: number;
	first: number;
	last: number;
} | null {
	const byCommand = new Map<
		string,
		{ runs: number; failures: number; first: number; last: number }
	>();
	for (const [record, callId, command] of calls) {
		if (!command) continue;
		const entry = byCommand.get(command) ?? {
			runs: 0,
			failures: 0,
			first: record,
			last: record,
		};
		entry.runs++;
		if (callId && failedCallIds.has(callId)) entry.failures++;
		entry.last = record;
		byCommand.set(command, entry);
	}
	let best: ReturnType<typeof mostRepeatedFailingCommand> = null;
	for (const [command, entry] of byCommand) {
		if (entry.runs < 2 || entry.failures < 2) continue;
		if (!best || entry.runs > best.runs) best = { command, ...entry };
	}
	return best;
}
