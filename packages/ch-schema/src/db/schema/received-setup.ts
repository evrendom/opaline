import { schema, table } from "@chkit/core";
import {
	RUN_SETUP_COLUMNS,
	RUN_SETUP_COMMENT,
	RUN_SETUP_KEY,
	SETUP_TEXT_COLUMNS,
	SETUP_TEXTS_COMMENT,
	SETUP_TEXTS_KEY,
} from "../../received-setup.js";

/**
 * Received setup (`src/received-setup.ts`): each distinct setup text once
 * per member, and each run's setup file versions per run index build.
 */
export const setupTextsTable = table({
	database: "rudel",
	name: "setup_texts",
	engine: "SharedReplacingMergeTree(written_at)",
	columns: [...SETUP_TEXT_COLUMNS],
	primaryKey: SETUP_TEXTS_KEY,
	orderBy: SETUP_TEXTS_KEY,
	settings: {
		index_granularity: "1024",
		index_granularity_bytes: "1048576",
		non_replicated_deduplication_window: "1000",
		storage_policy: "'s3'",
	},
	comment: SETUP_TEXTS_COMMENT,
});

export const runSetupTable = table({
	database: "rudel",
	name: "run_setup",
	engine: "SharedReplacingMergeTree(build_revision)",
	columns: [...RUN_SETUP_COLUMNS],
	primaryKey: RUN_SETUP_KEY,
	orderBy: RUN_SETUP_KEY,
	settings: {
		index_granularity: "1024",
		index_granularity_bytes: "1048576",
		non_replicated_deduplication_window: "1000",
		storage_policy: "'s3'",
	},
	comment: RUN_SETUP_COMMENT,
});

export default schema(setupTextsTable, runSetupTable);
