export const SESSION_DETAIL_DERIVATION_CACHE_DEFAULT_MAX_BYTES =
	256 * 1024 * 1024;
export const SESSION_DETAIL_DERIVATION_CACHE_DEFAULT_MAX_ENTRY_BYTES =
	64 * 1024 * 1024;
// Fetching two large raw snapshots at once doubles peak memory before parsing.
export const SESSION_DETAIL_DERIVATION_MAX_CONCURRENCY = 1;
