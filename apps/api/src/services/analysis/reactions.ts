import type { AnalysisEvent, RunRef } from "@rudel/api-routes";
import {
	type LanguageSignalMatch,
	mayContainLanguageSignal,
	scanMemberLanguageSignals,
	scanModelLanguageSignals,
} from "@rudel/language-signals";
import type { TextRow } from "./scan-queries.js";

type Reaction = AnalysisEvent["type"];
export interface TimedEvent extends AnalysisEvent {
	at: string;
}

const QUOTE_CHARS = 200;
const QUOTE_LEAD = 60;

/**
 * Lexicon events of one record: negative and swearing words in a genuine
 * prompt, apologies in an assistant message. `@rudel/language-signals` is the
 * only matcher. Each event points at its origin run (see `originRef`).
 */
export function reactionEvents(row: TextRow): TimedEvent[] {
	const ref = rowRef(row);
	const all = matchesOf(row);
	return (["negative", "swear", "apology"] as const).flatMap((type) => {
		const matches = all.filter((match) => match.category === type);
		const first = matches[0];
		if (!first) return [];
		const start = Math.max(0, first.start - QUOTE_LEAD);
		return [
			{
				at: new Date(row.started_ms).toISOString(),
				type,
				terms: [...new Set(matches.map((match) => match.matchedText))],
				eventRef: { ...ref, record: row.record_idx },
				quote: row.text.slice(start, start + QUOTE_CHARS),
				partial: row.partial,
				originRef: originRef(ref, type),
				originMinutes: null,
				originCostUsd: null,
			},
		];
	});
}

/** The strongest member reaction in a prompt: swearing over plain negativity. */
export function promptReaction(row: TextRow): "swear" | "negative" | null {
	const categories = new Set(matchesOf(row).map((match) => match.category));
	if (categories.has("swear")) return "swear";
	return categories.has("negative") ? "negative" : null;
}

/**
 * A reaction answers the run before it in the same stream. A first-turn
 * prompt has no earlier run; a first-turn apology is about its own run.
 */
export function originRef(ref: RunRef, type: Reaction): RunRef | null {
	if (ref.turn > 1) return { ...ref, turn: ref.turn - 1 };
	return type === "apology" ? { ...ref } : null;
}

export function runKey(ref: RunRef): string {
	return JSON.stringify([ref.sessionId, ref.agentId, ref.turn]);
}

function matchesOf(row: TextRow): readonly LanguageSignalMatch[] {
	if (row.kind === "user_prompt" && row.subtype !== "delegation")
		return scanMemberLanguageSignals(row.text);
	// Most assistant messages contain no apology; the full scan is the costly part.
	if (
		row.kind === "assistant_text" &&
		mayContainLanguageSignal(row.text, "apology")
	)
		return scanModelLanguageSignals(row.text).filter(
			(match) => match.category === "apology",
		);
	return [];
}

function rowRef(row: TextRow): RunRef {
	return {
		sessionId: row.session_id,
		agentId: row.agent_id,
		turn: row.turn_idx,
	};
}
