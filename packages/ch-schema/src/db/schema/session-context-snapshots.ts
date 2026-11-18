import { schema, table } from "@chkit/core";
import {
	SESSION_CONTEXT_SNAPSHOT_COLUMNS,
	SESSION_CONTEXT_SNAPSHOTS_COMMENT,
	SESSION_CONTEXT_SNAPSHOTS_KEY,
} from "../../session-context-snapshots.js";

export const sessionContextSnapshotsTable = table({
	database: "rudel",
	name: "session_context_snapshots",
	engine: "SharedReplacingMergeTree(built_at)",
	columns: [...SESSION_CONTEXT_SNAPSHOT_COLUMNS],
	primaryKey: SESSION_CONTEXT_SNAPSHOTS_KEY,
	orderBy: SESSION_CONTEXT_SNAPSHOTS_KEY,
	settings: {
		index_granularity: "1024",
		non_replicated_deduplication_window: "1000",
		storage_policy: "'s3'",
	},
	comment: SESSION_CONTEXT_SNAPSHOTS_COMMENT,
});

export default schema(sessionContextSnapshotsTable);
