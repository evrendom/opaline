import { describe, expect, test } from "bun:test";
import {
	createMonotonicIngestedAt,
	readIngestedAtFloorMs,
} from "../services/ingest-timestamp.service.js";

describe("createMonotonicIngestedAt", () => {
	test("allocates distinct millisecond versions when the clock does not advance", () => {
		const getIngestedAt = createMonotonicIngestedAt(() => 1_000);

		expect([
			getIngestedAt().getTime(),
			getIngestedAt().getTime(),
			getIngestedAt().getTime(),
		]).toEqual([1_000, 1_001, 1_002]);
	});

	test("clamps the first allocation to the configured floor", () => {
		const getIngestedAt = createMonotonicIngestedAt(() => 1_000, 5_000);

		expect([getIngestedAt().getTime(), getIngestedAt().getTime()]).toEqual([
			5_000, 5_001,
		]);
	});
});

describe("readIngestedAtFloorMs", () => {
	test("allows the floor to be unset", () => {
		expect(readIngestedAtFloorMs({}, () => 1_000)).toBeUndefined();
	});

	test("accepts a non-negative millisecond epoch within the rollout window", () => {
		expect(
			readIngestedAtFloorMs({ INGESTED_AT_FLOOR_MS: "61000" }, () => 1_000),
		).toBe(61_000);
	});

	test.each([
		"",
		"-1",
		"1.5",
		"not-a-number",
	])("rejects invalid floor %p", (value) => {
		expect(() =>
			readIngestedAtFloorMs({ INGESTED_AT_FLOOR_MS: value }, () => 1_000),
		).toThrow("INGESTED_AT_FLOOR_MS");
	});

	test("rejects a floor more than 60 seconds in the future", () => {
		expect(() =>
			readIngestedAtFloorMs({ INGESTED_AT_FLOOR_MS: "61001" }, () => 1_000),
		).toThrow("more than 60 seconds in the future");
	});
});
