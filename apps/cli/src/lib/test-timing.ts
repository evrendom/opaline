/**
 * Waits the CLI's end-to-end tests may shorten.
 *
 * Those tests run real hook processes, which take no options, so a test
 * shortens one of these waits with `OPALINE_TEST_<NAME>_MS` in the process
 * environment. An override can only shorten the production value: an unset,
 * malformed or longer value keeps it.
 */
export type TestTimingName =
	| "EVIDENCE_INLINE_DELIVERY_BUDGET"
	| "EVIDENCE_REQUEST_TIMEOUT"
	| "R2_STATUS_POLL_INTERVAL";

export function testTimingMs(
	name: TestTimingName,
	productionMs: number,
): number {
	const value = process.env[`OPALINE_TEST_${name}_MS`];
	if (value === undefined || !/^\d+$/u.test(value)) return productionMs;
	return Math.min(Number(value), productionMs);
}
