import { listsWorkspace } from "../analysis-log/config.js";

/**
 * The run question tags in the dashboard (session-answers.ts) are rolled out
 * to a few workspaces first, apart from whose runs are answered: a workspace
 * answered but not listed keeps its answers for the retro tools and sees no
 * tags. `RUN_QUESTION_TAGS_WORKSPACES` lists them (comma-separated ids, or
 * `*` for every workspace); while it is unset or empty, only Opaline's own
 * workspace (`VITE_ADMIN_ORGANIZATION_ID`). `*` mixed with ids is logged and
 * lists nobody.
 */
export function runQuestionTagsEnabled(workspaceId: string): boolean {
	if (!process.env.RUN_QUESTION_TAGS_WORKSPACES?.trim()) {
		const team = process.env.VITE_ADMIN_ORGANIZATION_ID?.trim();
		return Boolean(team) && workspaceId === team;
	}
	return listsWorkspace("RUN_QUESTION_TAGS_WORKSPACES", workspaceId, false);
}
