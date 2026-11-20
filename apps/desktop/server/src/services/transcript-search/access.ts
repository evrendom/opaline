import { embedsWorkspace } from "./config.js";

/**
 * Which workspaces' uploads are indexed for search (embedded with OpenAI):
 * every workspace on a self-hosted server, otherwise the workspaces
 * `TRANSCRIPT_EMBEDDINGS_WORKSPACES` lists. What was indexed stays until the
 * account or workspace is deleted. Search says why everywhere else
 * (`notIndexed`).
 */

const SEARCH_NOT_ENABLED =
	"search is not enabled for this workspace yet: its uploads are not indexed for search";

export interface SearchAccess {
	/** Whether the workspace's uploads are indexed for search. */
	indexes(workspaceId: string): Promise<boolean>;
	/** Why a workspace that is not indexed is not, phrased for the agent. */
	readonly notIndexed: string;
}

export function createSearchAccess(): SearchAccess {
	return {
		notIndexed: SEARCH_NOT_ENABLED,
		indexes: async (workspaceId) => embedsWorkspace(workspaceId),
	};
}
