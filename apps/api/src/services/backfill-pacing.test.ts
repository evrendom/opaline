import { expect, test } from "bun:test";
import type { ClickHouseExecutor } from "../clickhouse.js";
import { readClickHouseLoadAverage } from "./backfill-pacing.js";

const answering = (rows: unknown[]) =>
	({
		query: async () => rows,
	}) as unknown as ClickHouseExecutor;

test("the load is ClickHouse's LoadAverage1 where the server reports it", async () => {
	expect(await readClickHouseLoadAverage(answering([{ value: 7.5 }]))).toBe(
		7.5,
	);
	expect(await readClickHouseLoadAverage(answering([{ value: "13" }]))).toBe(
		13,
	);
});

test("a server without LoadAverage1 (macOS) reads as idle instead of failing every tick", async () => {
	expect(await readClickHouseLoadAverage(answering([]))).toBe(0);
	expect(await readClickHouseLoadAverage(answering([]))).toBe(0);
});

test("a failing query still fails", async () => {
	const failing = {
		query: async () => {
			throw new Error("Code: 241. MEMORY_LIMIT_EXCEEDED");
		},
	} as unknown as ClickHouseExecutor;
	await expect(readClickHouseLoadAverage(failing)).rejects.toThrow(
		"MEMORY_LIMIT_EXCEEDED",
	);
});
