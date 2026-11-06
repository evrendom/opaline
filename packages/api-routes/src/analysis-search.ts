import { z } from "zod";

/**
 * `search` (docs/retro-architecture.md, "Tools"): transcripts searched by
 * meaning (embeddings) and by exact string, merged into one ranking of runs.
 * The server scopes it to the caller's workspace and the sessions they may
 * read, like `sql`.
 */

export const SEARCH_MODES = ["hybrid", "meaning", "exact"] as const;
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
export const SEARCH_RECORD_TEXT_MAX_CHARS = 65_536;
/** Longest window one search reads, in days; the default is the last 30. */
export const SEARCH_MAX_DAYS = 180;
export const SEARCH_DEFAULT_DAYS = 30;

export const AnalysisSearchInputSchema = z
	.object({
		text: z.string().trim().min(2).max(SEARCH_TEXT_MAX_CHARS),
		mode: z.enum(SEARCH_MODES).default("hybrid"),
		filters: z
			.object({
				/** First day searched (UTC), inclusive. Default: 30 days before `until`. */
				since: z.string().date().optional(),
				/** Last day searched (UTC), inclusive. Default: today. */
				until: z.string().date().optional(),
				source: z.enum(["claude_code", "codex"]).optional(),
				kinds: z.array(z.enum(SEARCH_KINDS)).min(1).max(6).optional(),
				userId: z.string().min(1).max(200).optional(),
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
	/** Sessions that ran in the window, those indexed for search, and those with chunks still without a vector. */
	coverage: z.object({
		sessions: z.number().int(),
		indexed: z.number().int(),
		pending: z.number().int(),
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
