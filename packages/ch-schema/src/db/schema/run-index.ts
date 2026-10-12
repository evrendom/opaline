import { schema, table } from "@chkit/core";
import { RUN_INDEX_COLUMNS } from "../../run-index.js";

/**
 * `run_index` (docs/l1-literal-schema.md, "Scale"): the `runs` view
 * materialized per committed transcript-records generation, one row per run
 * (one human prompt and everything until the next) and one `receipt` row per
 * session generation, written last by the L1 reconciliation worker. Facts are
 * copied from the generation's records, never inferred, and a fact the
 * generation's parser version or agent cannot record is NULL (arrays name it
 * in `unrecorded_facts`), so unknown never reads as false or zero.
 *
 * Every build is an immutable snapshot: the generation `(revision,
 * parser_version, index_version)` and the build (`build_revision`, the
 * worker's claimed revision) are both in the key, so a build never replaces
 * or merges away the rows of another. A build writes its runs, then its
 * receipt; the receipt with the newest (generation, build) commits the
 * session's runs, and readers read only that build's rows. Superseded and
 * uncommitted snapshots are retired after a grace, as in
 * `transcript_records`.
 */
export const RUN_INDEX_KEY = [
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

export { RUN_INDEX_TEXT_COLUMNS } from "../../run-index.js";

export const runIndexTable = table({
	database: "rudel",
	name: "run_index",
	engine: "SharedReplacingMergeTree(build_revision)",
	columns: [...RUN_INDEX_COLUMNS],
	primaryKey: RUN_INDEX_KEY,
	orderBy: RUN_INDEX_KEY,
	settings: {
		index_granularity: "1024",
		index_granularity_bytes: "1048576",
		non_replicated_deduplication_window: "1000",
		storage_policy: "'s3'",
	},
	comment:
		"L1 runs per committed transcript generation, with a receipt per session generation written last; written only by the reconciliation worker.",
});

export default schema(runIndexTable);
