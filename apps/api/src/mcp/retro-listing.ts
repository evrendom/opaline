import {
	type RetroWorkspace,
	retroToolsEnabled,
} from "../services/analysis/retro-tools.js";
import { isAdminWorkspace } from "./self-analytics-tools.js";

/**
 * Tools `tools/list` publishes only to a user with a workspace on the retro
 * rollout (`retroToolsEnabled`): the retro tools, which refuse in every other
 * workspace, `answers`, added with them while the plugin skill still uses
 * its three aliases, and `agent_feedback` and `mcp_stats`, kept out of the
 * published plugin while its review is pending. Everyone else is listed the
 * tools of the published plugin, so no host shows the model a tool that
 * cannot work for the user and a directory scan sees what the published
 * plugin declares.
 */
export const RETRO_LISTED_TOOLS: ReadonlySet<string> = new Set([
	"agent_feedback",
	"answers",
	"checks",
	"estimate_questions",
	"mcp_stats",
	"measures",
	"patterns",
	"run",
	"run_questions",
	"schema",
	"search",
	"sql",
]);

export const ADMIN_LISTED_TOOLS: ReadonlySet<string> = new Set(["mcp_stats"]);

export function workspacesListing(workspaces: readonly RetroWorkspace[]): {
	retro: boolean;
	admin: boolean;
} {
	return {
		retro: workspaces.some((workspace) => retroToolsEnabled(workspace)),
		admin: workspaces.some((workspace) => isAdminWorkspace(workspace.id)),
	};
}

/** The tools listed to a user, by whether one of their workspaces has the retro tools. */
export function toolsListedFor<
	T extends { readonly name: string; readonly retroDescription?: string },
>(tools: readonly T[], retro: boolean, admin = false): T[] {
	const shown = tools.filter(
		(tool) =>
			(retro || !RETRO_LISTED_TOOLS.has(tool.name)) &&
			(admin || !ADMIN_LISTED_TOOLS.has(tool.name)),
	);
	return retro
		? shown.map((tool) =>
				tool.retroDescription
					? { ...tool, description: tool.retroDescription }
					: tool,
			)
		: shown;
}
