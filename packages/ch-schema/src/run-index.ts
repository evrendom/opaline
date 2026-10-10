/**
 * Free-text columns of `rudel.run_index`, without the schema toolkit, so the
 * API's builder and readers import it at runtime (`@rudel/ch-schema/run-index`).
 *
 * Nothing in the run index expires: like the raw transcripts and
 * `transcript_records` it is kept until a deletion request (docs/l1-retention.md).
 * These columns once had a 365-day column TTL; the retention migration
 * `20261011120000_l1_retention_removed.sql` removes it, and its runner checks
 * these columns by name.
 */
export const RUN_INDEX_TEXT_COLUMNS = [
	"prompt_head",
	"turn_error",
	"hook_stop_reason",
	"hook_errors",
	"hook_runs",
	"api_error",
	"goal",
	"title",
] as const;
