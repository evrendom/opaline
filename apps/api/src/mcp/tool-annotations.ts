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
