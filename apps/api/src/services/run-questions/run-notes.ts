import { redactReturnedValue } from "@rudel/secret-filter";
import { z } from "zod";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import { readAnalysis } from "../analysis/read.service.js";
import { buildPromptHeadStatement } from "../analysis/read-queries.js";
import {
	ANALYSIS_QUERY_SETTINGS,
	chunkByParamBytes,
	GenerationRowSchema,
	pinnedFilter,
	pinnedParams,
	query,
	records,
} from "../analysis/sql.js";
import { committedRunsSql, SQL_SCOPE_PARAMS } from "../analysis/sql-views.js";
import {
	buildCommittedGenerationsStatement,
	type SessionGeneration,
} from "../transcript-records-queries.js";
import { type RunKey, type RunVersion, runKey } from "./answers.js";
import type { JobRun } from "./jobs.js";
import { RUN_NOTE_MAX_CHARS, type RunQuestionProvider } from "./provider.js";

/**
 * The run note a run question is answered from (docs/retro-architecture.md
 * "Run questions"): the prompt, tool names and counts, the failing calls'
 * error lines, the final message and how the next prompt reacted, from
 * `read`'s exchange digest. Secrets are redacted before the note leaves the
 * stack. Facts L1 records exactly are not questions, so the note gives the
 * model only what it needs to judge meaning.
 */

/** Characters of the exchange digest read per run; the whole note has at most `RUN_NOTE_MAX_CHARS`. */
const NOTE_READ_CHARS = 5_000;
const TOOL_NAMES = 20;
/** Digest sections the note keeps, with the label it gives them. */
const SECTIONS: Readonly<Record<string, string>> = {
	prompt: "prompt",
	task: "task from the parent agent",
	"failed calls": "failed calls (record, tool, error line)",
	final: "final message",
	"next prompt reaction": "how the next prompt reacted",
};

export interface RunFacts extends RunVersion {
	readonly ownerId: string;
	readonly promptHead: string;
}

/**
 * The owner, prompt head and transcript revision of each run, from the runs
 * view's statement, so only runs of each session's committed build, and of
 * the sessions the reader may read, are found. Runs not found are left out.
 */
export async function readRunFacts(
	executor: ClickHouseExecutor,
	workspaceId: string,
	runs: readonly RunKey[],
	/** The one member whose sessions may be found, or null for every member's. */
	member: string | null = null,
): Promise<Map<string, RunFacts>> {
	const facts = new Map<string, RunFacts>();
	if (runs.length === 0) return facts;
	const wanted = new Set(runs.map(runKey));
	for (const fact of await readSessionRuns(
		executor,
		workspaceId,
		[...new Set(runs.map((run) => run.sessionId))],
		member,
	))
		if (wanted.has(runKey(fact))) facts.set(runKey(fact), fact);
	return facts;
}

/**
 * Every run of these sessions in their committed build, with its owner,
 * prompt head and transcript revision; only the member's sessions when one
 * is named.
 */
export async function readSessionRuns(
	executor: ClickHouseExecutor,
	workspaceId: string,
	sessionIds: readonly string[],
	member: string | null = null,
): Promise<RunFacts[]> {
	const facts: RunFacts[] = [];
	for (const batch of chunkByParamBytes([...sessionIds], (session) => [
		session,
	]))
		for (const row of await query(executor, FactRowSchema, {
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
			query: `SELECT session_id, agent_id, turn_idx, user_id, prompt_head, revision
				FROM (${committedRunsSql(member !== null, [
					"session_id",
					"agent_id",
					"turn_idx",
					"user_id",
					"prompt_head",
					"toString(revision) AS revision",
				])})
				WHERE session_id IN {sessionIds:Array(String)}`,
			query_params: {
				[SQL_SCOPE_PARAMS.workspace]: workspaceId,
				...(member === null ? {} : { [SQL_SCOPE_PARAMS.member]: member }),
				sessionIds: batch,
			},
		}))
			facts.push({
				sessionId: row.session_id,
				agentId: row.agent_id,
				turn: row.turn_idx,
				revision: row.revision,
				ownerId: row.user_id,
				promptHead: row.prompt_head ?? "",
			});
	return facts;
}

/** What a provider reads about a run, and which input it is. */
export interface RunState {
	readonly text: string;
	/** run: the run's whole text; note: the compact run note. */
	readonly input: "run" | "note";
}

/**
 * What the provider reads about the run, from the transcript revision the job
 * names: for a provider that reads whole runs, the run's full text (`read` at
 * turn depth, secrets redacted) when it fits the provider's cap, otherwise
 * (or for a provider that reads notes) the compact note; either way followed
 * by the opening of the next prompt in the run's stream. Null when the
 * session's committed transcript is another revision (uploaded again since it
 * was asked about), checked before and after reading so a state never mixes
 * two revisions. A session without committed transcript records gets a note
 * from its prompt head alone.
 */
export async function buildRunState(
	executor: ClickHouseExecutor,
	workspaceId: string,
	run: JobRun,
	promptHead: string,
	provider: Pick<RunQuestionProvider, "state" | "stateMaxChars">,
): Promise<RunState | null> {
	const scope = { organizationId: workspaceId, userId: run.ownerId };
	const generation = await committedGeneration(executor, scope, run);
	if (generation && generation.revision !== run.revision) return null;
	const owners = new Map([[run.sessionId, run.ownerId]]);
	const refs = [
		{ sessionId: run.sessionId, agentId: run.agentId, turn: run.turn },
	];
	let state: RunState | null = null;
	if (provider.state === "run") {
		const read = await readAnalysis(
			workspaceId,
			owners,
			{ refs, depth: "turn", maxChars: provider.stateMaxChars },
			{ executor },
		);
		const sections = read.reads[0]?.sections ?? [];
		const text = String(
			redactReturnedValue(
				[
					...(sections.length ? [] : [`prompt:\n${promptHead}`]),
					...sections.map((section) => `${section.name}:\n${section.text}`),
				].join("\n\n"),
			),
		);
		// A run larger than the provider takes is sent as its note instead.
		if (!read.truncated && text.length <= provider.stateMaxChars)
			state = { text, input: "run" };
	}
	if (!state) {
		const [read, tools] = await Promise.all([
			readAnalysis(
				workspaceId,
				owners,
				{ refs, depth: "exchange", maxChars: NOTE_READ_CHARS },
				{ executor },
			),
			generation ? toolCounts(executor, scope, generation, run) : [],
		]);
		state = {
			text: composeRunNote({
				promptHead,
				sections: read.reads[0]?.sections ?? [],
				tools: tools.map((tool) => ({
					name: tool.tool_name,
					calls: tool.calls,
				})),
			}),
			input: "note",
		};
	}
	// The next prompt, which "asked again" and "said done but was not" turn on:
	// without it a provider can only guess how the run was received. Only from
	// the session's records; without them nothing is known about what followed.
	if (generation) {
		const next = await nextPromptHead(executor, scope, generation, run);
		state = {
			...state,
			text: `${state.text}\n\nnext prompt:\n${
				next === null
					? "(none: nothing followed this run in its stream)"
					: String(redactReturnedValue(next))
			}`,
		};
	}
	const after = await committedGeneration(executor, scope, run);
	if (
		after?.revision !== generation?.revision ||
		after?.parserVersion !== generation?.parserVersion
	)
		return null;
	return state;
}

function capped(text: string, maxChars: number): string {
	return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/**
 * The note from the run's exchange digest sections and tool counts: the
 * prompt (the run index's prompt head when the digest has none), the tools,
 * the failed calls, the final message and the next prompt's reaction; other
 * sections are left out. Secrets are redacted and the note is capped.
 */
export function composeRunNote(run: {
	promptHead: string;
	sections: readonly { name: string; text: string }[];
	tools: readonly { name: string; calls: number }[];
}): string {
	const sections = new Map(
		run.sections.map((section) => [section.name, section.text.trim()]),
	);
	const lines: string[] = [];
	if (!sections.get("prompt") && !sections.get("task") && run.promptHead)
		lines.push(`prompt:\n${run.promptHead}`);
	for (const [name, label] of Object.entries(SECTIONS)) {
		if (name === "failed calls")
			lines.push(
				`tools: ${run.tools.length ? run.tools.map((tool) => `${tool.name}×${tool.calls}`).join(", ") : "none recorded"}`,
			);
		const text = sections.get(name);
		if (text) lines.push(`${label}:\n${text}`);
	}
	const note = String(redactReturnedValue(lines.join("\n\n")));
	return capped(note, RUN_NOTE_MAX_CHARS);
}

/** The session's committed transcript records generation, if any. */
async function committedGeneration(
	executor: ClickHouseExecutor,
	scope: { organizationId: string; userId: string },
	run: RunKey,
): Promise<SessionGeneration | undefined> {
	const [generation] = await query(
		executor,
		GenerationRowSchema,
		buildCommittedGenerationsStatement(scope, [run.sessionId]),
	);
	return generation;
}

/** Of the next prompt, at most this much is sent with a run. */
export const NEXT_PROMPT_HEAD_CHARS = 600;

const PromptHeadSchema = z.object({ text: z.string() });

/** The opening of the prompt after the run in its stream, or null when none followed. */
async function nextPromptHead(
	executor: ClickHouseExecutor,
	scope: { organizationId: string; userId: string },
	generation: SessionGeneration,
	run: RunKey,
): Promise<string | null> {
	const [row] = await query(
		executor,
		PromptHeadSchema,
		buildPromptHeadStatement(
			{
				scope,
				generation,
				ref: {
					sessionId: run.sessionId,
					agentId: run.agentId,
					turn: run.turn + 1,
				},
			},
			NEXT_PROMPT_HEAD_CHARS,
		),
	);
	return row ? row.text : null;
}

/** Tool calls of the run in the generation, by tool name, most used first. */
async function toolCounts(
	executor: ClickHouseExecutor,
	scope: { organizationId: string; userId: string },
	generation: SessionGeneration,
	run: RunKey,
): Promise<z.infer<typeof ToolCountSchema>[]> {
	return query(executor, ToolCountSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT tool_name, count() AS calls FROM ${records()}
			WHERE ${pinnedFilter()} AND agent_id = {agentId:String} AND turn_idx = {turn:UInt32}
				AND kind = 'tool_call' AND tool_name != ''
			GROUP BY tool_name ORDER BY calls DESC, tool_name LIMIT ${TOOL_NAMES}`,
		query_params: {
			...pinnedParams(scope, [generation]),
			agentId: run.agentId,
			turn: run.turn,
		},
	});
}

const FactRowSchema = z.object({
	session_id: z.string(),
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	user_id: z.string(),
	prompt_head: z.string().nullable(),
	revision: z.string(),
});

const ToolCountSchema = z.object({
	tool_name: z.string(),
	calls: z.coerce.number(),
});
