/**
 * The read-only procedures the Opaline plugin app may call, each served as
 * an app-only MCP tool under a plain name. The API (`plugin-tools.ts`) and
 * the plugin app (`apps/ui/src/widget/plugin-transport.ts`) both read this
 * map, so a name is defined in one place. Never add a procedure that writes.
 */
export const PLUGIN_TOOL_NAMES = {
	"analytics.overview.costs": "app_dashboard_metrics",
	"analytics.overview.kpis": "app_dashboard_totals",
	"analytics.overview.usersDailyTrend": "app_dashboard_daily_activity",
	"analytics.sessions.filterCatalog": "app_sessions_filters",
	"analytics.sessions.list": "app_sessions_list",
	"analytics.sessions.summaryComparison": "app_sessions_summary",
	"analytics.sessions.dimensionAnalysis": "app_sessions_breakdown",
	"analytics.sessions.uploadFailures": "app_sessions_upload_problems",
	"analytics.sessions.detailInitial": "app_session_overview",
	"analytics.sessions.detailOverview": "app_session_turns",
	"analytics.sessions.detailWindow": "app_session_window",
	"analytics.sessions.detailSpine": "app_session_outline",
	"analytics.sessions.detailBodyChunk": "app_session_text",
	"analytics.sessions.detailRelationships": "app_session_links",
	"analytics.sessions.detailSubagent": "app_session_subagent",
	"analytics.sessions.detailTurn": "app_session_turn",
	"analytics.skills.list": "app_skills_list",
	"analytics.skills.detail": "app_skill",
	"analytics.repositories.list": "app_repositories_list",
	"analytics.repositories.detail": "app_repository",
	"analytics.repositories.overview": "app_repository_overview",
	"analytics.developers.list": "app_team_members",
	"analytics.developers.teamCards": "app_team_cards",
} as const;

export type PluginProcedure = keyof typeof PLUGIN_TOOL_NAMES;

/** The app-only tool serving a procedure path, or undefined if the app may not call it. */
export function pluginToolName(path: string): string | undefined {
	return Object.hasOwn(PLUGIN_TOOL_NAMES, path)
		? PLUGIN_TOOL_NAMES[path as PluginProcedure]
		: undefined;
}
