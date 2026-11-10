import { scanMemberLanguageSignals } from "@rudel/language-signals";
import { z } from "zod";
import type { ClickHouseStatement } from "../../clickhouse.js";
import type {
	SessionGeneration,
	TranscriptReadScope,
} from "../transcript-records-queries.js";
import { SCAN_TEXT_CHARS } from "./scan-queries.js";
import {
	ANALYSIS_QUERY_SETTINGS,
	GENUINE_PROMPT_SQL,
	pinnedFilter,
	pinnedParams,
	records,
} from "./sql.js";

/**
 * What a run's messages literally say, for the run index (index 4): the
 * word-list categories of the prompt that opened the run, the message the
 * agent ended it with and whether that was kept whole, and whether its stream
 * had recorded the system prompt by then. The approved measures
 * (`sql-measures.ts`) read frustration, re-asks and coverage from them;
 * interpreting them stays in the views, so a change of rule needs no rebuild.
 */

/** As much of the final message as the run index keeps. */
export const FINAL_MESSAGE_CHARS = 2_000;

/** Records that carry the system prompt a stream received. */
const SYSTEM_PROMPT_SQL = `kind = 'meta' AND facts['instruction_text_components'] != ''
	AND ((source = 'claude_code' AND subtype = 'attachment:prompt_snapshot') OR (source = 'codex' AND subtype = 'session_meta'))`;

export const RunMessagesRowSchema = z.object({
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	opening_prompt: z.string().nullable(),
	final_message: z.string().nullable(),
	final_message_cut: z.coerce.number(),
	system_prompt: z.coerce.number(),
});
export type RunMessagesRow = z.infer<typeof RunMessagesRowSchema>;

/** A run's message columns. */
export interface RunMessageColumns {
	prompt_reactions: string[];
	final_message: string | null;
	final_message_cut: boolean;
	system_prompt_recorded: boolean;
}

/**
 * Per run of one committed generation: its first genuine prompt, and its last
 * assistant text when no tool call follows it in the run (the run ended on
 * what the agent said), with whether that text was cut. Records a forked
 * Codex session replays from its parent are left out, as in the run facts.
 * Per stream and run, also whether a record there carries the system prompt
 * (turn 0 is before the first prompt); those are read as recorded, replayed
 * or not.
 */
export function buildRunMessagesStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: runMessagesSql(""),
		query_params: pinnedParams(scope, [generation]),
	};
}

export function buildRunMessagesBatchStatement(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
	settings: Record<string, string | number> = {},
): ClickHouseStatement {
	return {
		clickhouse_settings: { ...ANALYSIS_QUERY_SETTINGS, ...settings },
		query: runMessagesSql("session_id, "),
		query_params: pinnedParams(scope, generations),
	};
}

function runMessagesSql(session: string): string {
	const at = "tuple(record_idx, block_idx)";
	const said = "kind = 'assistant_text'";
	return `SELECT ${session}agent_id, turn_idx,
				if(countIf(${GENUINE_PROMPT_SQL}) = 0, NULL,
					argMinIf(${textSql(SCAN_TEXT_CHARS)}, ${at}, ${GENUINE_PROMPT_SQL})) AS opening_prompt,
				countIf(${said}) > 0 AND maxIf(${at}, ${said}) > maxIf(${at}, kind = 'tool_call') AS ended_saying,
				if(ended_saying, argMaxIf(${textSql(FINAL_MESSAGE_CHARS)}, ${at}, ${said}), NULL) AS final_message,
				toUInt8(ended_saying AND argMaxIf(text_chars > ${FINAL_MESSAGE_CHARS} OR lengthUTF8(text) < text_chars, ${at}, ${said})) AS final_message_cut,
				toUInt8(countIf(${SYSTEM_PROMPT_SQL}) > 0) AS system_prompt
			FROM ${records()}
			WHERE ${pinnedFilter()} AND (
				(turn_idx >= 1 AND facts['fork_replayed'] != 'true'
					AND ((${GENUINE_PROMPT_SQL}) OR kind IN ('assistant_text', 'tool_call')))
				OR (${SYSTEM_PROMPT_SQL}))
			GROUP BY ${session}agent_id, turn_idx`;
}

/**
 * Each run's message columns, by stream and run: a run with no row of its own
 * has none of its messages, but still the system prompt its stream recorded
 * before it.
 */
export function runMessageColumns(
	rows: readonly RunMessagesRow[],
): (agentId: string, turn: number) => RunMessageColumns {
	const runs = new Map(
		rows.map((row) => [runKey(row.agent_id, row.turn_idx), row]),
	);
	const firstSystemPrompt = new Map<string, number>();
	for (const row of rows)
		if (row.system_prompt > 0)
			firstSystemPrompt.set(
				row.agent_id,
				Math.min(
					firstSystemPrompt.get(row.agent_id) ?? row.turn_idx,
					row.turn_idx,
				),
			);
	return (agentId, turn) => {
		const row = runs.get(runKey(agentId, turn));
		const since = firstSystemPrompt.get(agentId);
		return {
			prompt_reactions: reactionsOf(row?.opening_prompt ?? null),
			final_message: row?.final_message ?? null,
			final_message_cut: (row?.final_message_cut ?? 0) > 0,
			system_prompt_recorded: since !== undefined && since <= turn,
		};
	};
}

function runKey(agentId: string, turn: number): string {
	return JSON.stringify([agentId, turn]);
}

/** The word-list categories found in a member's prompt, sorted. */
function reactionsOf(prompt: string | null): string[] {
	if (prompt === null) return [];
	return [
		...new Set(scanMemberLanguageSignals(prompt).map((m) => m.category)),
	].sort();
}

/** A record's text as stored, or its head and tail when the text was cut. */
function textSql(chars: number): string {
	return `substringUTF8(if(empty(text), concat(head, '\\n', tail), text), 1, ${chars})`;
}
