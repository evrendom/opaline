import { schema, table } from "@chkit/core";
import { RUN_REQUEST_COLUMNS } from "../../run-index.js";

/**
 * `run_requests` (docs/l1-literal-schema.md, "Scale"): the requests of each
 * run index build, one row per model response and the calls it made, with
 * its time and the usage on its lines. A build writes them after its runs and
 * before its receipt, so the receipt that commits the runs commits the
 * requests too, and readers read only the committed build's rows. The key
 * repeats the run index key, with the request's first record in place of the
 * run's; superseded and uncommitted builds are retired with the run index's.
 */
export const RUN_REQUESTS_KEY = [
	"organization_id",
	"user_id",
	"session_id",
	"revision",
	"parser_version",
	"index_version",
	"build_revision",
	"agent_id",
	"start_record",
];

export const runRequestsTable = table({
	database: "rudel",
	name: "run_requests",
	engine: "SharedReplacingMergeTree(build_revision)",
	columns: [...RUN_REQUEST_COLUMNS],
	primaryKey: RUN_REQUESTS_KEY,
	orderBy: RUN_REQUESTS_KEY,
	settings: {
		index_granularity: "1024",
		index_granularity_bytes: "1048576",
		non_replicated_deduplication_window: "1000",
		storage_policy: "'s3'",
	},
	comment:
		"L1 requests (one model response and its calls) of each run index build, committed by the build's run index receipt; written only by the reconciliation worker.",
});

export default schema(runRequestsTable);
