import { listsWorkspace } from "../analysis-log/config.js";

/**
 * The retro tools (schema, sql, search, run, estimate_questions,
 * run_questions; docs/retro-architecture.md) are rolled out to a few
 * workspaces first; every other workspace keeps answering with find and
 * read. Saved answers, dashboards and workspace tools stay open to all.
 */

/** What a workspace without the retro tools is told: fatal, so agents do not retry. */
export const RETRO_TOOLS_OFF =
	"refused, do not retry: The retro tools are not enabled for this workspace yet; use find and read.";

/**
 * Whether a workspace may call the retro tools: those
 * `RETRO_TOOLS_WORKSPACES` lists (comma-separated ids, or `*` for every
 * workspace); while it is unset or empty, only Opaline's own workspace
 * (`VITE_ADMIN_ORGANIZATION_ID`). `*` mixed with ids is logged and lists
 * nobody.
 */
export function retroToolsEnabled(workspaceId: string): boolean {
	if (!process.env.RETRO_TOOLS_WORKSPACES?.trim()) {
		const team = process.env.VITE_ADMIN_ORGANIZATION_ID?.trim();
		return Boolean(team) && workspaceId === team;
	}
	return listsWorkspace("RETRO_TOOLS_WORKSPACES", workspaceId, false);
}
