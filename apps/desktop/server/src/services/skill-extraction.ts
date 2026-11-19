import { hashTranscriptContent } from "../lib/transcript-content-hash.js";
import { extractHistoricalClaudeSkills } from "./historical-claude-skill-parser.js";
import { extractHistoricalCodexSkills } from "./historical-codex-skill-parser.js";
import type {
	ExtractedSkillUse,
	SkillAgent,
	SkillExtractionResult,
} from "./skill-extraction.types.js";

export const SKILL_PARSER_VERSION = 1;

export interface SkillExtractionInput {
	readonly content: string;
	readonly parserVersion?: number;
	readonly sessionDate: string;
	readonly source: "claude_code" | "codex";
	/** Bundled subagent transcripts by agent id (Claude Code Task/Agent runs). */
	readonly subagents?: Readonly<Record<string, string>>;
}

/**
 * Skills used anywhere in a session: the main transcript and every bundled
 * subagent transcript, each parsed on its own (an invocation pairs with the
 * body loaded in the same stream). A skill used in several streams is one use
 * at its earliest time, with the first recovered body.
 */
export function extractSessionSkills(
	input: SkillExtractionInput,
): SkillExtractionResult {
	const agent: SkillAgent = input.source === "claude_code" ? "claude" : "codex";
	const subagents = input.subagents ?? {};
	const streams = [
		input.content,
		...Object.keys(subagents)
			.sort()
			.map((agentId) => subagents[agentId] ?? ""),
	];
	const uses = new Map<string, ExtractedSkillUse>();
	for (const stream of streams) {
		const found =
			input.source === "claude_code"
				? extractHistoricalClaudeSkills(stream, input.sessionDate)
				: extractHistoricalCodexSkills(stream, input.sessionDate);
		for (const use of found) {
			const known = uses.get(use.name);
			uses.set(
				use.name,
				known === undefined
					? use
					: {
							content: known.content ?? use.content,
							name: use.name,
							usedAt: use.usedAt < known.usedAt ? use.usedAt : known.usedAt,
						},
			);
		}
	}

	return {
		agent,
		parserVersion: input.parserVersion ?? SKILL_PARSER_VERSION,
		sourceContentSha256: hashSkillSourceContent(input.content, subagents),
		uses: [...uses.values()].sort((left, right) =>
			left.name.localeCompare(right.name),
		),
	};
}

/**
 * Hash of every stream skills are read from. Without subagents it is the hash
 * of the main transcript alone, so receipts of such sessions stay current;
 * with subagents it changes, so their receipts are re-extracted once.
 */
export function hashSkillSourceContent(
	content: string,
	subagents: Readonly<Record<string, string>> = {},
): string {
	return hashTranscriptContent(content, subagents);
}
