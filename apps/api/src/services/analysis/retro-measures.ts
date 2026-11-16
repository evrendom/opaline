import { createHash } from "node:crypto";
import {
	type MeasureScope,
	type MeasureSummary,
	type MeasuresDescribeOutput,
	PATTERN_KINDS,
} from "@rudel/api-routes";
import { patternFamilies, patternsListSql } from "./patterns-sql.js";
import {
	cohortSql,
	FAILURE_KINDS,
	filesHuntedBeforeEditSql,
	instructionCostSql,
	LOCAL_CHECK_CLASSES,
	localPassThenCiFailSql,
	type MeasureParams,
	pickedCte,
	repeatedCommandsSql,
	repeatedCorrectionsSql,
	timeLostByCauseSql,
} from "./retro-measure-sql.js";
import { SQL_MEASURES } from "./sql-measures.js";

export interface RetroMeasure {
	readonly name: string;
	readonly title: string;
	readonly description: string;
	readonly unit: string;
	readonly definition: string;
	readonly columns: readonly { name: string; meaning: string }[];
	readonly traps: readonly string[];
	build(params: MeasureParams): string;
}

export const SCOPE_PARAMETERS = [
	"from",
	"to",
	"repository",
	"latest",
	"sessions",
	"limit",
] as const;

const COHORT =
	"The cohort every measure reads: sessions whose main stream (agent_id = '', not a Codex subagent thread) started between from and to, in repository (its value or the part after the last /), optionally the latest N of them by start time or only the sessions named; each with all its streams.";
const EVIDENCE = {
	name: "session_id, agent_id, turn_idx",
	meaning: "An example run of the row: open it with run or read.",
};
const RUN_TIME =
	"group_run_time (approved): active minutes of the runs that contain the group, each run once.";
const CALL_TIME =
	"group_call_time (approved): minutes from each call of the group to its result; parallel calls each count in full.";

export const RETRO_MEASURES: readonly RetroMeasure[] = [
	{
		name: "cohort",
		title: "Sessions in the cohort",
		description:
			"The sessions a measure reads, newest first, with their runs, active time, cost, re-asks and frustration.",
		unit: "sessions",
		definition: `${COHORT} Pass the same from, to, repository and latest to every other measure to read the same sessions.`,
		columns: [
			{ name: "session_start", meaning: "First main-stream run start, UTC." },
			{
				name: "runs, main_runs",
				meaning: "runs (approved) of all streams; of the main stream.",
			},
			{
				name: "active_time, cost",
				meaning:
					"The approved measures over every run of the session; cost NULL runs are unpriced_runs.",
			},
			{ name: "re_asks, frustration", meaning: "The approved measures." },
		],
		traps: [
			"A session that started before from is not in the cohort, even with runs inside the window.",
		],
		build: cohortSql,
	},
	{
		name: "time_lost_by_cause",
		title: "Time lost by failure cause",
		description:
			"Failed calls grouped by kind and cause, with the time of the runs that contain them and of the calls themselves.",
		unit: "minutes",
		definition: `Calls with failed = 1 in the cohort, grouped by kind (${FAILURE_KINDS.join("; ")}) and cause (the refused tool and why, else the command's program and subcommand, else the tool). Ranked by group_run_time. ${RUN_TIME} ${CALL_TIME}`,
		columns: [
			{ name: "kind, cause", meaning: "The group." },
			{
				name: "failed_calls, runs, sessions, members",
				meaning:
					"Failed calls, the runs and sessions holding them, members (approved).",
			},
			{
				name: "group_run_time, group_call_time",
				meaning: "The two approved times, in minutes.",
			},
			EVIDENCE,
		],
		traps: [
			"Neither time is time lost until the runs are read: a run holding a failure may have gone on fine.",
			"The cause is what failed (program, tool), not why: find source=tool reads the error text, and read shows it.",
			"probe rows are usually expected answers (no match), not failures.",
		],
		build: timeLostByCauseSql,
	},
	{
		name: "local_pass_then_ci_fail",
		title: "Local check passed, then CI failed",
		description:
			"Pushes after a passing local test, typecheck, lint or build in the same session, with how CI on the pushed commit ended.",
		unit: "pushes",
		definition: `Each push (git_events push_range) in a cohort session that had a ${LOCAL_CHECK_CLASSES.join(", ")} command (calls.command_class) with a result, not failed, before the push. Its commits (edges commit_pushed from the push's evidence) lead to CI runs (edges ci_on_sha) and their jobs (ci_jobs). outcome: ci_failed when a job concluded failure or timed_out, ci_pending while one has not completed, ci_passed otherwise; unknown: no GitHub link when the push's run has github_link in coverage_gaps; unknown: no CI jobs collected when no job was found. Ranked ci_failed first, then unknown, then newest.`,
		columns: [
			{
				name: "outcome",
				meaning: "ci_failed, ci_pending, ci_passed or unknown with why.",
			},
			{ name: "pushed_at, branch, pushed_sha", meaning: "The push." },
			{
				name: "local_passes_before, last_local_check",
				meaning:
					"Passing local checks before it, and the last one's program and subcommand.",
			},
			{
				name: "ci_runs, failed_jobs, failed_job_names",
				meaning: "CI on the pushed commits.",
			},
			{
				name: "session_id, agent_id, turn_idx",
				meaning: "The run that pushed.",
			},
		],
		traps: [
			"The local check and the failing CI job may test different things: read the failed job and the check before naming a cause.",
			"unknown is not passed: GitHub is not connected for that repository, or its CI was not collected.",
		],
		build: localPassThenCiFailSql,
	},
	{
		name: "files_hunted_before_edit",
		title: "Files searched for before their first edit",
		description:
			"Per file, the read and search calls that touched it before its first edit in each session, over every cohort session in one query.",
		unit: "calls",
		definition:
			"Per session and file edited by an edit tool (Edit, Write, MultiEdit, NotebookEdit, apply_patch) without failing: the calls before that first edit that read it (file_op read, or Read) or searched it (Grep, Glob, LS), matched by the path itself or a relative path its end matches. Summed per file (relative to the session's first directory when inside it).",
		columns: [
			{ name: "file", meaning: "The edited file." },
			{
				name: "sessions",
				meaning: "Sessions that edited it after hunting for it.",
			},
			{
				name: "hunting_calls, reads, searches",
				meaning: "Calls before the first edit.",
			},
			{
				name: "hunt_call_minutes",
				meaning: "group_call_time (approved) of those calls.",
			},
			{
				name: "minutes_to_first_edit",
				meaning:
					"From the first such call to the first edit, summed over sessions.",
			},
			{
				name: "session_id, agent_id, turn_idx",
				meaning: "The run of the first edit in the session that hunted most.",
			},
		],
		traps: [
			"A file only a shell command changed (sed -i, a redirect) has no edit call and is not here.",
			"Searches that matched the file without naming it (a grep over a folder) are not counted.",
		],
		build: filesHuntedBeforeEditSql,
	},
	{
		name: "instruction_cost",
		title: "Instruction file cost",
		description:
			"Each setup file version the cohort's runs received, with its size, estimated tokens and how many runs carried it.",
		unit: "tokens",
		definition:
			"setup_files rows of the cohort's runs, per setup file and version: chars, est_tokens (chars / 4, rounded up), runs that had it (received or carried), received (times it arrived during a run), sessions, members, est_token_runs = est_tokens × runs. Ranked by est_token_runs.",
		columns: [
			{
				name: "setup_file, kind, version_name",
				meaning: "The file and version.",
			},
			{
				name: "chars, est_tokens",
				meaning: "Its size; tokens are an estimate, not usage.",
			},
			{ name: "runs, received, sessions, members", meaning: "Reach." },
			{
				name: "est_token_runs",
				meaning: "est_tokens × runs: the context it took across runs.",
			},
			EVIDENCE,
		],
		traps: [
			"Context a run carried is mostly cache reads, not new input: compare with cost before calling it expensive.",
			"Runs whose received setup was not read (coverage_gaps received_setup) are missing, not zero.",
		],
		build: instructionCostSql,
	},
	{
		name: "repeated_commands",
		title: "Repeated commands",
		description:
			"Shell command families run at least twice (the same program and script however it was invoked), with failures, sessions and their most common variants.",
		unit: "calls",
		definition: `Calls with command_from = 'command' (each shell command once, also the commands a Codex code-mode script ran; never the script itself), read from command_head. Each call is split into its statements (&&, ||, ;, |, new lines; quoted text and heredocs never split it) and each statement reduced to its family: without cd, environment assignments, wrappers (env, time, timeout N, nohup, sudo), redirects, directory flags (--cwd, --prefix, --dir, --filter, -C) and output trims after a pipe (tail, head, grep, sed, jq and the like); then program and subcommand (git status; gh keeps a third word: gh pr view), the script a package manager runs (bun run check-types), a package runner's tool and its subcommand (bunx biome check), or an interpreter's script file (node build.mjs); other programs by name alone. A chained call counts once in each of its families. Families with at least 2 calls, ranked by calls, then group_call_time. ${CALL_TIME}`,
		columns: [
			{ name: "family", meaning: "The command family; drill takes it." },
			{
				name: "calls, failed",
				meaning: "Calls holding the family, and those that failed.",
			},
			{ name: "group_call_time", meaning: "The approved time, in minutes." },
			{ name: "sessions, members", meaning: "Reach." },
			{
				name: "variants",
				meaning:
					"The 5 most common ways it was written (by command_fingerprint), with their calls.",
			},
			{
				name: "example, session_id, agent_id, turn_idx",
				meaning: "The slowest call's text and run.",
			},
		],
		traps: [
			"A long command is not wasted time: a test suite is meant to run often; read before calling it waste.",
			"A failed call fails as a whole: in a chain the failing statement may be another family's.",
			"A command a Codex code-mode script ran records almost no time of its own (the script holds it): compare calls there.",
			"Only the first 300 characters are read: a statement after them is not counted.",
		],
		build: repeatedCommandsSql,
	},
	{
		name: "repeated_corrections",
		title: "Repeated corrections",
		description:
			"Sessions where the person corrected or complained at least twice, with the words used and re-asks.",
		unit: "prompts",
		definition:
			"Main-stream runs whose first genuine prompt the language-signals rules mark negative or swearing (prompt_reactions), counted per session; sessions with at least 2. top_words: the rules' negative and swear words and phrases found in those prompts, most frequent first. re_asks and frustration are the approved measures over the session's main-stream runs.",
		columns: [
			{ name: "corrections", meaning: "Flagged prompts in the session." },
			{
				name: "top_words",
				meaning: "Up to 5 of the rules' words and phrases found in them.",
			},
			{
				name: "re_asks, unknown_re_asks, frustration",
				meaning:
					"The approved measures; unknown_re_asks are runs built before the rule could be read.",
			},
			{
				name: "session_id, agent_id, turn_idx",
				meaning: "The first flagged run.",
			},
		],
		traps: [
			"Words only: sarcasm, polite complaints and other languages are missed; read the prompts before naming a cause.",
		],
		build: repeatedCorrectionsSql,
	},
];

const BASE_UNITS: Readonly<Record<string, string>> = {
	active_time: "minutes",
	cost: "usd",
	tokens: "tokens",
	runs: "runs",
	members: "members",
	re_asks: "runs",
	frustration: "runs",
	group_run_time: "minutes",
	group_call_time: "minutes",
};

export const MEASURE_WINDOW_DAYS = 30;
export const MEASURE_MAX_DAYS = 180;

export function measureParams(
	scope: MeasureScope & { limit?: number },
	today: Date,
): MeasureParams | { error: string } {
	const to = scope.to ?? today.toISOString().slice(0, 10);
	const from =
		scope.from ??
		new Date(
			Date.parse(`${to}T00:00:00Z`) - (MEASURE_WINDOW_DAYS - 1) * 86_400_000,
		)
			.toISOString()
			.slice(0, 10);
	const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
	if (days < 1) return { error: `from ${from} is after to ${to}` };
	if (days > MEASURE_MAX_DAYS)
		return {
			error: `from ${from} to ${to} is ${days} days; at most ${MEASURE_MAX_DAYS}`,
		};
	return {
		from,
		to,
		limit: scope.limit ?? 50,
		...(scope.repository ? { repository: scope.repository } : {}),
		...(scope.latest ? { latest: scope.latest } : {}),
		...(scope.sessions ? { sessions: scope.sessions } : {}),
	};
}

export function cohortSelect(params: MeasureParams): string {
	return `WITH ${pickedCte(params)}
	SELECT user_id, session_id FROM picked`;
}

export function findRetroMeasure(name: string): RetroMeasure | undefined {
	return RETRO_MEASURES.find((measure) => measure.name === name);
}

const CANONICAL: MeasureParams = {
	from: "2000-01-01",
	to: "2000-01-30",
	repository: "owner/name",
	latest: 50,
	limit: 50,
};

function sha256(text: string): string {
	return createHash("sha256")
		.update(text.replace(/\s+/gu, " ").trim())
		.digest("hex");
}

export function measureHash(name: string): string | null {
	if (name === "patterns")
		return sha256(
			patternFamilies(PATTERN_KINDS)
				.map((part) =>
					patternsListSql(CANONICAL, part.family, {
						kinds: part.kinds,
						minCount: 2,
					}),
				)
				.join("\n;\n"),
		);
	const retro = findRetroMeasure(name);
	if (retro) return sha256(retro.build(CANONICAL));
	const base = SQL_MEASURES.find((measure) => measure.name === name);
	return base ? sha256(base.sql) : null;
}

export function listMeasures(): MeasureSummary[] {
	return [
		...SQL_MEASURES.map((measure) => ({
			name: measure.name,
			title: measure.name.replaceAll("_", " "),
			description: measure.definition.split(/(?<=\.)\s/u)[0] ?? "",
			status: "approved" as const,
			isDrifted: false,
			unit: BASE_UNITS[measure.name] ?? "",
			kind: "aggregate" as const,
			parameters: [],
		})),
		...RETRO_MEASURES.map((measure) => ({
			name: measure.name,
			title: measure.title,
			description: measure.description,
			status: "approved" as const,
			isDrifted: false,
			unit: measure.unit,
			kind: "query" as const,
			parameters: [...SCOPE_PARAMETERS],
		})),
	];
}

export function describeMeasure(
	name: string,
	today: Date,
): MeasuresDescribeOutput | null {
	const summary = listMeasures().find((measure) => measure.name === name);
	const hash = measureHash(name);
	if (!summary || !hash) return null;
	const retro = findRetroMeasure(name);
	if (!retro) {
		const base = SQL_MEASURES.find((measure) => measure.name === name);
		return {
			...summary,
			definition: base?.definition ?? "",
			sql: base?.sql ?? "",
			traps: [
				"An aggregate: use it inside sql over the view its column belongs to; measures action=run runs only the query measures.",
			],
			columns: [],
			hash,
		};
	}
	const params = measureParams({}, today);
	return {
		...summary,
		definition: retro.definition,
		sql: "error" in params ? "" : retro.build(params),
		traps: [COHORT, ...retro.traps],
		columns: retro.columns.map((column) => ({ ...column })),
		hash,
	};
}

export function driftNotice(measure: {
	name: string;
	status: "approved" | "proposed";
	hash: string;
}): string | null {
	if (measureHash(measure.name) === measure.hash) return null;
	const approval =
		measure.status === "approved" ? "approved" : "not yet approved";
	return `NONCANONICAL: status=${measure.status} is_drifted=true. The measure's definition changed after this result was stored, and this result used the old definition. Use it only if that definition measures what the user asked. If you use it, open the answer with 'Drifted measure: ${measure.name}, ${approval}, and its definition changed after this result was stored. Rerun it with measures action=run before you rely on this number.', and say in one sentence why you used it.`;
}
