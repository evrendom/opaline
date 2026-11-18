import { schema, table } from "@chkit/core";
import {
	CALL_FACTS_COLUMNS,
	CALL_FACTS_COMMENT,
	CALL_FACTS_KEY,
	CALL_FACTS_STARTED_AT_INDEX,
} from "../../call-facts.js";

export const callFactsTable = table({
	database: "rudel",
	name: "call_facts",
	engine: "SharedReplacingMergeTree(build_revision)",
	columns: [...CALL_FACTS_COLUMNS],
	primaryKey: [...CALL_FACTS_KEY],
	orderBy: [...CALL_FACTS_KEY],
	indexes: [{ ...CALL_FACTS_STARTED_AT_INDEX }],
	settings: {
		index_granularity: "1024",
		index_granularity_bytes: "1048576",
		non_replicated_deduplication_window: "1000",
		storage_policy: "'s3'",
	},
	comment: CALL_FACTS_COMMENT,
});

export default schema(callFactsTable);
