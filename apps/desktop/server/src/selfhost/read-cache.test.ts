import { expect, test } from "bun:test";
import { createReadCache, selfHostedRead } from "./read-cache.js";

function counter() {
	let calls = 0;
	return {
		get calls() {
			return calls;
		},
		compute: async () => {
			calls++;
			return { rows: calls };
		},
	};
}

test("a read is computed once per data version and input", async () => {
	let version = "a";
	let clock = 0;
	const cache = createReadCache({
		version: async () => version,
		now: () => clock,
	});
	const reads = counter();
	expect(await cache.read("list", [1, { days: 30 }], reads.compute)).toEqual({
		rows: 1,
	});
	clock += 1_000;
	expect(await cache.read("list", [1, { days: 30 }], reads.compute)).toEqual({
		rows: 1,
	});
	expect(await cache.read("list", [1, { days: 7 }], reads.compute)).toEqual({
		rows: 2,
	});
	expect(await cache.read("other", [1, { days: 30 }], reads.compute)).toEqual({
		rows: 3,
	});
	version = "b";
	clock += 1_000;
	expect(await cache.read("list", [1, { days: 30 }], reads.compute)).toEqual({
		rows: 4,
	});
	expect(reads.calls).toBe(4);
});

test("an entry expires after its longest age even when nothing changed", async () => {
	let clock = 0;
	const cache = createReadCache({
		version: async () => "same",
		now: () => clock,
		maxAgeMs: 10_000,
	});
	const reads = counter();
	await cache.read("list", 1, reads.compute);
	clock = 9_999;
	await cache.read("list", 1, reads.compute);
	clock = 10_000;
	await cache.read("list", 1, reads.compute);
	expect(reads.calls).toBe(2);
});

test("concurrent reads share one computation and one version probe", async () => {
	let probes = 0;
	const cache = createReadCache({
		version: async () => {
			probes++;
			return "v";
		},
	});
	const reads = counter();
	const [a, b] = await Promise.all([
		cache.read("list", 1, reads.compute),
		cache.read("list", 1, reads.compute),
	]);
	expect(a).toBe(b);
	expect(reads.calls).toBe(1);
	expect(probes).toBe(1);
});

test("failures are not kept, and a failing version probe reads directly", async () => {
	let failVersion = false;
	let clock = 0;
	const cache = createReadCache({
		version: async () => {
			if (failVersion) throw new Error("ClickHouse is down");
			return "v";
		},
		now: () => clock,
	});
	let attempts = 0;
	const flaky = async () => {
		attempts++;
		if (attempts === 1) throw new Error("timeout");
		return attempts;
	};
	await expect(cache.read("list", 1, flaky)).rejects.toThrow("timeout");
	expect(await cache.read("list", 1, flaky)).toBe(2);
	expect(await cache.read("list", 1, flaky)).toBe(2);
	failVersion = true;
	clock += 1_000;
	expect(await cache.read("list", 1, flaky)).toBe(3);
	expect(await cache.read("list", 1, flaky)).toBe(4);
});

test("the least recently used entries leave first", async () => {
	const cache = createReadCache({ version: async () => "v", maxEntries: 2 });
	const reads = counter();
	await cache.read("list", "a", reads.compute);
	await cache.read("list", "b", reads.compute);
	await cache.read("list", "a", reads.compute);
	await cache.read("list", "c", reads.compute);
	expect(reads.calls).toBe(3);
	await cache.read("list", "a", reads.compute);
	expect(reads.calls).toBe(3);
	await cache.read("list", "b", reads.compute);
	expect(reads.calls).toBe(4);
});

test("outside a self-hosted server every read is computed", async () => {
	const previous = process.env.OPALINE_SELF_HOSTED;
	delete process.env.OPALINE_SELF_HOSTED;
	try {
		const reads = counter();
		await selfHostedRead("list", 1, reads.compute);
		await selfHostedRead("list", 1, reads.compute);
		expect(reads.calls).toBe(2);
	} finally {
		if (previous !== undefined) process.env.OPALINE_SELF_HOSTED = previous;
	}
});
