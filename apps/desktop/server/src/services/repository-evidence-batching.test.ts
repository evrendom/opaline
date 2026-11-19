import { expect, test } from "bun:test";
import {
	EVIDENCE_R2_CONCURRENCY,
	EVIDENCE_SQL_BATCH_SIZE,
	evidenceSqlBatches,
	mapEvidenceStorage,
} from "./repository-evidence-batching.js";

test("SQL batches preserve every item at the contract limit", () => {
	const items = Array.from({ length: 4_096 }, (_, index) => index);
	const batches = evidenceSqlBatches(items);
	expect(batches.map((batch) => batch.length)).toEqual([
		1_000, 1_000, 1_000, 1_000, 96,
	]);
	expect(batches.flat()).toEqual(items);
	expect(
		batches.every((batch) => batch.length <= EVIDENCE_SQL_BATCH_SIZE),
	).toBe(true);
	expect(evidenceSqlBatches([])).toEqual([]);
});

test("storage work preserves order and caps concurrency at 32", async () => {
	let active = 0;
	let peak = 0;
	const items = Array.from({ length: 100 }, (_, index) => index);
	const results = await mapEvidenceStorage(items, async (item) => {
		active += 1;
		peak = Math.max(peak, active);
		await Bun.sleep(1);
		active -= 1;
		return item * 2;
	});
	expect(results).toEqual(items.map((item) => item * 2));
	expect(peak).toBe(EVIDENCE_R2_CONCURRENCY);
	expect(active).toBe(0);
});

test("failed storage work settles its entire window before cleanup", async () => {
	let active = 0;
	let started = 0;
	const failure = new Error("storage failed");
	const work = mapEvidenceStorage(
		Array.from({ length: 100 }, (_, index) => index),
		async (item) => {
			active += 1;
			started += 1;
			await Bun.sleep(item === 0 ? 1 : 5);
			active -= 1;
			if (item === 0) throw failure;
			return item;
		},
	);
	await expect(work).rejects.toBe(failure);
	expect(active).toBe(0);
	expect(started).toBe(EVIDENCE_R2_CONCURRENCY);
});
