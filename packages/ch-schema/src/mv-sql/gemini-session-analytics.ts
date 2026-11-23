import { CLAUDE_SESSION_ANALYTICS_MV_SQL } from "./claude-session-analytics.js";

/**
 * Gemini sessions (Gemini CLI and Antigravity) are stored in Claude Code's
 * transcript shape, so their analytics are Claude Code's under their own
 * source. Kept outside `src/db/schema/**` like the other view sources.
 */
export const GEMINI_SESSION_ANALYTICS_MV_SQL =
	CLAUDE_SESSION_ANALYTICS_MV_SQL.replace(
		"'claude_code' as source",
		"'gemini' as source",
	).replace(
		"FROM rudel.claude_sessions AS cs",
		"FROM rudel.gemini_sessions AS cs",
	);

if (
	!GEMINI_SESSION_ANALYTICS_MV_SQL.includes("'gemini' as source") ||
	!GEMINI_SESSION_ANALYTICS_MV_SQL.includes("FROM rudel.gemini_sessions AS cs")
)
	throw new Error("The Gemini session analytics view lost its source");
