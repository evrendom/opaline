/**
 * MCP tool annotations. Every tool declares its own; the OpenAI plugin review
 * checks them against what the tool does (docs/plugin-directory-review.md).
 */
export interface McpToolAnnotations {
	readonly readOnlyHint: boolean;
	readonly destructiveHint: boolean;
	readonly openWorldHint: boolean;
}

/** Reads the caller's Opaline workspace data and changes nothing in it. */
export const READ_ONLY: McpToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	openWorldHint: false,
};

/**
 * Adds only the caller's own Opaline records (an analysis draft, a saved or
 * shared analysis), never session or workspace data, and never deletes,
 * overwrites or revokes anything.
 */
export const WRITES_OWN_RECORDS: McpToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	openWorldHint: false,
};

/**
 * Replaces one of the caller's own preferences (the default workspace). It
 * deletes no data, but the old value is overwritten, so it is not additive.
 */
export const REPLACES_OWN_SETTING: McpToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	openWorldHint: false,
};

/**
 * Shares one of the caller's saved analyses with the other members of their
 * workspace. Additive (nothing is deleted or revoked), but it makes content
 * visible to other people, so it is marked open-world.
 */
export const SHARES_WITH_WORKSPACE: McpToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	openWorldHint: true,
};

/**
 * Publishes the caller's saved answer in their workspace. Additive, but the
 * title and topics are sent to OpenAI to build the search index, so it is
 * marked open-world.
 */
export const SAVES_AND_INDEXES: McpToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	openWorldHint: true,
};
