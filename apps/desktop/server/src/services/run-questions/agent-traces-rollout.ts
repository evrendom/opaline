import { listsWorkspace } from "../analysis-log/config.js";

/**
 * The Agent traces page (agent-runs.ts) is open only to the workspaces
 * `AGENT_TRACES_WORKSPACES` lists (comma-separated ids, or `*` for every
 * workspace). Unset or empty lists nobody, Opaline's own workspace included;
 * `*` mixed with ids is logged and lists nobody.
 */
export function agentTracesEnabled(workspaceId: string): boolean {
	return listsWorkspace("AGENT_TRACES_WORKSPACES", workspaceId, false);
}
