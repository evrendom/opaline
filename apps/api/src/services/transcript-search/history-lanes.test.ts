import { expect, test } from "bun:test";
import type { PostgresLeaseOutcome } from "../postgres-lease.service.js";
import {
	indexSearchHistory,
	type LaneResult,
	SEARCH_HISTORY_LANES,
	type SearchHistoryLanes,
} from "./history-lanes.js";

const NOTHING: LaneResult = {
	indexed: 0,
	incomplete: 0,
	failed: 0,
	embeddedChunks: 0,
	costUsd: 0,
	hasMore: false,
	stopped: null,
	message: null,
};

function lanes(
	options: { resting?: number[]; busy?: number[]; result?: LaneResult } = {},
) {
	const runs: number[] = [];
	const rested: number[] = [];
	const fake: SearchHistoryLanes = {
		resting: async () => new Set(options.resting ?? []),
		rest: async (lane) => {
			rested.push(lane);
		},
		run: async (lane): Promise<PostgresLeaseOutcome<LaneResult>> => {
			runs.push(lane);
			return options.busy?.includes(lane)
				? { status: "busy" }
				: { status: "completed", result: options.result ?? NOTHING };
		},
	};
	return { fake, runs, rested };
}

const signal = new AbortController().signal;

test("a lane whose run indexed nothing rests, so the next invocations skip it without reading ClickHouse", async () => {
	const world = lanes({
		result: { ...NOTHING, stopped: "quota", hasMore: true },
	});

	const outcome = await indexSearchHistory(signal, world.fake, () => 0.3);

	expect(outcome).toMatchObject({
		status: "indexed",
		lane: 2,
		stopped: "quota",
	});
	expect(world.runs).toEqual([2]);
	expect(world.rested).toEqual([2]);
});

test("a lane that indexed or embedded something keeps going without resting", async () => {
	for (const result of [
		{ ...NOTHING, indexed: 3, hasMore: true },
		{ ...NOTHING, incomplete: 1, embeddedChunks: 40 },
	]) {
		const world = lanes({ result });

		await indexSearchHistory(signal, world.fake, () => 0);

		expect(world.rested).toEqual([]);
	}
});

test("resting and held lanes are passed over; the first free lane runs", async () => {
	const world = lanes({ resting: [5, 6], busy: [7] });

	const outcome = await indexSearchHistory(signal, world.fake, () => 0.9);

	expect(world.runs).toEqual([7, 0]);
	expect(outcome).toMatchObject({ status: "indexed", lane: 0 });
});

test("when every lane rests, nothing runs", async () => {
	const world = lanes({
		resting: Array.from({ length: SEARCH_HISTORY_LANES }, (_, lane) => lane),
	});

	expect(await indexSearchHistory(signal, world.fake)).toEqual({
		status: "resting",
	});
	expect(world.runs).toEqual([]);
});

test("when every free lane is held, the invocation is busy", async () => {
	const world = lanes({
		resting: [0, 1, 2, 3],
		busy: [4, 5, 6, 7],
	});

	expect(await indexSearchHistory(signal, world.fake, () => 0)).toEqual({
		status: "busy",
	});
	expect(world.runs).toEqual([4, 5, 6, 7]);
	expect(world.rested).toEqual([]);
});
