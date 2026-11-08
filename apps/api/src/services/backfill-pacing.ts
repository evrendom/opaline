import { getLogger } from "@logtape/logtape";
import { z } from "zod";
import type { ClickHouseExecutor } from "../clickhouse.js";

/**
 * Pacing shared by the paced history backfills (`backfill:transcript-search`,
 * `backfill:run-questions`): a clock tests can replace, and ClickHouse's
 * `LoadAverage1`, which they pause on.
 */

export interface BackfillClock {
	now(): number;
	/** Resolves early when `signal` aborts. */
	sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const REAL_BACKFILL_CLOCK: BackfillClock = {
	now: () => Date.now(),
	sleep: (ms, signal) =>
		new Promise((resolve) => {
			if (signal?.aborted) return resolve();
			const timer = setTimeout(done, ms);
			function done() {
				clearTimeout(timer);
				signal?.removeEventListener("abort", done);
				resolve();
			}
			signal?.addEventListener("abort", done, { once: true });
		}),
};

const logger = getLogger(["rudel", "api", "backfill-pacing"]);
const LoadRowSchema = z.object({ value: z.coerce.number() });

export async function readClickHouseLoadAverage(
	executor: ClickHouseExecutor,
): Promise<number> {
	const [row] = z.array(LoadRowSchema).parse(
		await executor.query<unknown>({
			query:
				"SELECT value FROM system.asynchronous_metrics WHERE metric = 'LoadAverage1'",
		}),
	);
	if (!row) {
		if (!reportedMissingLoad) {
			reportedMissingLoad = true;
			logger.warn(
				"ClickHouse reports no LoadAverage1 in system.asynchronous_metrics (macOS servers do not); pacing treats its load as 0",
			);
		}
		return 0;
	}
	return row.value;
}

let reportedMissingLoad = false;
