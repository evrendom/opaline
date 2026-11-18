import { schema, table } from "@chkit/core";
import {
	TRANSCRIPT_RECORD_COMMAND_COLUMNS,
	TRANSCRIPT_RECORD_COMMANDS_COMMENT,
	TRANSCRIPT_RECORD_COMMANDS_KEY,
} from "../../transcript-record-commands.js";

export const transcriptRecordCommandsTable = table({
	database: "rudel",
	name: "transcript_record_commands",
	engine: "SharedReplacingMergeTree(built_at)",
	columns: [...TRANSCRIPT_RECORD_COMMAND_COLUMNS],
	primaryKey: [...TRANSCRIPT_RECORD_COMMANDS_KEY],
	orderBy: [...TRANSCRIPT_RECORD_COMMANDS_KEY],
	settings: {
		index_granularity: "1024",
		index_granularity_bytes: "1048576",
		non_replicated_deduplication_window: "1000",
		storage_policy: "'s3'",
	},
	comment: TRANSCRIPT_RECORD_COMMANDS_COMMENT,
});

export default schema(transcriptRecordCommandsTable);
