import { z } from "zod";
import { SourceSchema } from "./schemas/source.js";

export const SEARCH_MODES = ["hybrid", "meaning", "exact", "regex"] as const;
/** Record kinds whose text is searched. */
export const SEARCH_KINDS = [
	"user_prompt",
	"assistant_text",
	"reasoning",
	"tool_call",
	"tool_result",
	"file_change",
] as const;
export const SEARCH_TEXT_MAX_CHARS = 500;
export const SEARCH_REGEX_MAX_CHARS = 800;
export const SEARCH_RECORD_TEXT_MAX_CHARS = 65_536;
/** Longest window one search reads, in days; the default is the last 30. */
export const SEARCH_MAX_DAYS = 180;
export const SEARCH_DEFAULT_DAYS = 30;

export const AnalysisSearchInputSchema = z
	.object({
		text: z
			.string()
			.trim()
			.min(2)
			.max(
				SEARCH_REGEX_MAX_CHARS,
				`text is at most ${SEARCH_TEXT_MAX_CHARS} characters, or ${SEARCH_REGEX_MAX_CHARS} for mode regex.`,
			),
		mode: z.enum(SEARCH_MODES).default("hybrid"),
		filters: z
			.object({
				/** First day searched (UTC), inclusive. Default: 30 days before `until`. */
				since: z.string().date().optional(),
				/** Last day searched (UTC), inclusive. Default: today. */
				until: z.string().date().optional(),
				source: SourceSchema.optional(),
				kinds: z.array(z.enum(SEARCH_KINDS)).min(1).max(6).optional(),
				userId: z.string().min(1).max(200).optional(),
				includeInjected: z.boolean().optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

const SearchResultSchema = z.object({
	/** L1 run id, as in the runs view. */
	runId: z.string(),
	sessionId: z.string(),
	/** Empty for the main agent. */
	agentId: z.string(),
	/** The run's number in its stream: `read`'s turn. */
	turn: z.number().int(),
	startedAt: z.string(),
	/** Reciprocal-rank fusion of the meaning and exact rankings; higher first. */
	score: z.number(),
	/** Why the run matched: its best meaning similarity and where, exact hits and where. */
	why: z.string(),
	snippet: z.string(),
});

export const AnalysisSearchOutputSchema = z.object({
	text: z.string(),
	/** The mode asked for, and the one that ran (hybrid falls back to exact when meaning is off). */
	requestedMode: z.enum(SEARCH_MODES),
	mode: z.enum(SEARCH_MODES),
	since: z.string(),
	until: z.string(),
	results: z.array(SearchResultSchema),
	coverage: z.object({
		sessions: z.number().int(),
		searched: z.number().int(),
		partial: z.number().int(),
		indexed: z.number().int(),
		pending: z.number().int(),
	}),
	exactMatches: z.object({
		runs: z.number().int(),
		sessions: z.number().int(),
	}),
	hiddenInjected: z.object({
		matches: z.number().int(),
		runs: z.number().int(),
	}),
	/** The workspace's OpenAI quota; null where its text is not embedded. */
	quota: z
		.object({
			usedTokens: z.number(),
			limitTokens: z.number(),
			resetsAt: z.string(),
		})
		.nullable(),
	/** A rewrite to try when nothing matched. */
	suggestion: z.string().nullable(),
	/** What was not searched and why; always the not-evidence notice last. */
	notices: z.array(z.string()),
});

export type AnalysisSearchInput = z.infer<typeof AnalysisSearchInputSchema>;
export type AnalysisSearchOutput = z.infer<typeof AnalysisSearchOutputSchema>;
