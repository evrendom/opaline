import { schema, table } from "@chkit/core";
import {
	SESSION_SAVED_OUTPUT_COLUMNS,
	SESSION_SAVED_OUTPUTS_COMMENT,
	SESSION_SAVED_OUTPUTS_KEY,
} from "../../session-saved-outputs.js";

/**
 * Saved outputs of a session (`src/session-saved-outputs.ts`): background
 * task outputs and large tool outputs, the latest capture's row per file.
 */
export const sessionSavedOutputsTable = table({
	database: "rudel",
	name: "session_saved_outputs",
	engine: "SharedReplacingMergeTree(version)",
	columns: [...SESSION_SAVED_OUTPUT_COLUMNS],
	primaryKey: SESSION_SAVED_OUTPUTS_KEY,
	orderBy: SESSION_SAVED_OUTPUTS_KEY,
	settings: {
		index_granularity: "1024",
		non_replicated_deduplication_window: "1000",
		storage_policy: "'s3'",
	},
	comment: SESSION_SAVED_OUTPUTS_COMMENT,
});

export default schema(sessionSavedOutputsTable);
