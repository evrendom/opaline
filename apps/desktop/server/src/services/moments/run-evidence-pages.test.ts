import { describe, expect, test } from "bun:test";
import { createRunEvidencePages } from "./run-evidence-pages.js";

function pages(now: { at: number }) {
	return createRunEvidencePages({
		reuseMs: 1_000,
		maxEntries: 2,
		now: () => now.at,
	});
}

describe("run evidence pages", () => {
	test("later pages reuse the first page's evidence", async () => {
		const now = { at: 0 };
		const cache = pages(now);
		let loads = 0;
		const load = async () => ++loads;
		expect(await cache.read("range", 0, load)).toBe(1);
		now.at = 500;
		expect(await cache.read("range", 50, load)).toBe(1);
		expect(await cache.read("range", 100, load)).toBe(1);
		expect(loads).toBe(1);
	});

	test("the first page always loads fresh evidence", async () => {
		const cache = pages({ at: 0 });
		let loads = 0;
		const load = async () => ++loads;
		await cache.read("range", 0, load);
		expect(await cache.read("range", 0, load)).toBe(2);
		expect(await cache.read("range", 50, load)).toBe(2);
	});

	test("evidence older than the reuse window loads again", async () => {
		const now = { at: 0 };
		const cache = pages(now);
		let loads = 0;
		const load = async () => ++loads;
		await cache.read("range", 0, load);
		now.at = 1_000;
		expect(await cache.read("range", 50, load)).toBe(2);
	});

	test("ranges and failures are never shared", async () => {
		const cache = pages({ at: 0 });
		let loads = 0;
		await cache.read("a", 0, async () => ++loads);
		expect(await cache.read("b", 50, async () => ++loads)).toBe(2);
		await expect(
			cache.read("c", 0, async () => {
				throw new Error("down");
			}),
		).rejects.toThrow("down");
		await Promise.resolve();
		expect(await cache.read("c", 50, async () => ++loads)).toBe(3);
	});

	test("keeps at most the newest entries", async () => {
		const cache = pages({ at: 0 });
		let loads = 0;
		const load = async () => ++loads;
		await cache.read("a", 0, load);
		await cache.read("b", 0, load);
		await cache.read("c", 0, load);
		expect(await cache.read("a", 50, load)).toBe(4);
		expect(await cache.read("c", 50, load)).toBe(3);
	});
});
