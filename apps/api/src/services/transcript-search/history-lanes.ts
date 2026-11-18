import type { PostgresLeaseOutcome } from "../postgres-lease.service.js";
import type { TranscriptSearchBackfillExecuted } from "./history-backfill.service.js";

/**
 * Search lanes: sessions split by a hash of their id. Each lane is held by one
 * invocation at a time, so lanes run side by side and never take the same
 * session.
 */
export const SEARCH_HISTORY_LANES = 8;
export const SEARCH_HISTORY_REST_MS = 15 * 60_000;

export type LaneResult = Pick<
	TranscriptSearchBackfillExecuted,
	| "indexed"
	| "incomplete"
	| "failed"
	| "embeddedChunks"
	| "costUsd"
	| "hasMore"
	| "stopped"
	| "message"
>;

export interface HistoryMaintenanceResult {
	readonly search:
		| { readonly status: "busy" | "off" | "resting" }
		| ({ readonly status: "indexed"; readonly lane: number } & LaneResult);
}

export interface SearchHistoryLanes {
	resting(): Promise<ReadonlySet<number>>;
	rest(lane: number): Promise<void>;
	run(
		lane: number,
		signal: AbortSignal,
	): Promise<PostgresLeaseOutcome<LaneResult>>;
}

export async function indexSearchHistory(
	signal: AbortSignal,
	lanes: SearchHistoryLanes,
	random: () => number = Math.random,
): Promise<HistoryMaintenanceResult["search"]> {
	const resting = await lanes.resting();
	if (resting.size >= SEARCH_HISTORY_LANES) return { status: "resting" };
	const first = Math.floor(random() * SEARCH_HISTORY_LANES);
	for (let step = 0; step < SEARCH_HISTORY_LANES; step++) {
		if (signal.aborted) break;
		const lane = (first + step) % SEARCH_HISTORY_LANES;
		if (resting.has(lane)) continue;
		const outcome = await lanes.run(lane, signal);
		if (outcome.status === "busy") continue;
		const result = outcome.result;
		if (result.indexed === 0 && result.embeddedChunks === 0)
			await lanes.rest(lane);
		return {
			status: "indexed",
			lane,
			indexed: result.indexed,
			incomplete: result.incomplete,
			failed: result.failed,
			embeddedChunks: result.embeddedChunks,
			costUsd: result.costUsd,
			hasMore: result.hasMore,
			stopped: result.stopped,
			message: result.message,
		};
	}
	return { status: "busy" };
}
