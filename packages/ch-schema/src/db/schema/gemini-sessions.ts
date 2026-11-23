import { materializedView, schema, table } from "@chkit/core";
import { GEMINI_SESSION_ANALYTICS_MV_SQL } from "../../mv-sql/gemini-session-analytics.js";
import { baseSessionColumns, baseSessionTableConfig } from "./base-sessions.js";

// Gemini CLI and Antigravity sessions, translated into Claude Code's transcript
// shape when they are imported (see @rudel/agent-adapters gemini).
const rudel_gemini_sessions = table({
	database: "rudel",
	name: "gemini_sessions",
	engine: "SharedReplacingMergeTree(revision)",
	columns: [
		...baseSessionColumns,
		{ name: "subagents", type: "Map(String, String)", default: "fn:map()" },
	],
	...baseSessionTableConfig,
});

const gemini_session_analytics_mv = materializedView({
	database: "rudel",
	name: "gemini_session_analytics_mv",
	to: { database: "rudel", name: "session_analytics" },
	as: GEMINI_SESSION_ANALYTICS_MV_SQL,
});

export default schema(rudel_gemini_sessions, gemini_session_analytics_mv);
