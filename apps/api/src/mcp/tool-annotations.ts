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

/** Writes the caller's own Opaline records (reversibly), never session data. */
export const WRITES_OWN_RECORDS: McpToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	openWorldHint: false,
};
