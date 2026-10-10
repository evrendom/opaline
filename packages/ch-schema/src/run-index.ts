/**
 * Retention of `rudel.run_index`, without the schema toolkit, so the API's
 * builder and readers import it at runtime (`@rudel/ch-schema/run-index`).
 */

/** Runs stay comparable over time: three years from the session date. */
export const RUN_INDEX_RETENTION_DAYS = 1_095;
/** Free text never outlives the transcript it was copied from (365 days). */
export const RUN_INDEX_TEXT_RETENTION_DAYS = 365;
/**
 * Free-text columns. Each gets a column TTL of
 * `RUN_INDEX_TEXT_RETENTION_DAYS` by hand in the migration (chkit cannot
 * express column TTLs), and expired text reads as NULL, never as empty.
 * A TTL applies only when parts merge, so writers null expired text before
 * inserting it and readers null it when reading (the API's run index reader).
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
export const RUN_INDEX_TTL = `toDate(session_date) + toIntervalDay(${RUN_INDEX_RETENTION_DAYS})`;
export const RUN_INDEX_TEXT_TTL = `toDate(session_date) + toIntervalDay(${RUN_INDEX_TEXT_RETENTION_DAYS})`;
