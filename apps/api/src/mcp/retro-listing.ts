/**
 * Tools `tools/list` publishes only to a user with a workspace on the retro
 * rollout (`retroToolsEnabled`): the retro tools, which refuse in every other
 * workspace, and `answers`, added with them while the plugin skill still uses
 * its three aliases. Everyone else is listed the tools of the published
 * plugin, so no host shows the model a tool that cannot work for the user and
 * a directory scan sees what the published plugin declares.
 */
export const RETRO_LISTED_TOOLS: ReadonlySet<string> = new Set([
	"answers",
	"estimate_questions",
	"run",
	"run_questions",
	"schema",
	"search",
	"sql",
]);

/** The tools listed to a user, by whether one of their workspaces has the retro tools. */
export function toolsListedFor<T extends { readonly name: string }>(
	tools: readonly T[],
	retro: boolean,
): T[] {
	return retro
		? [...tools]
		: tools.filter((tool) => !RETRO_LISTED_TOOLS.has(tool.name));
}
