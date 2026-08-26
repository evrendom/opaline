import { describe, expect, test } from "bun:test";
import {
	assertCompatibleRunModes,
	assertRunPayloadBudget,
	MAX_CONCURRENCY_CEILING,
	MAX_IN_FLIGHT_CEILING,
	MAX_PART_CONCURRENCY_CEILING,
	MAX_TOTAL_PLANNED_BYTES,
	parseArguments,
	parseRunConcurrencyOptions,
} from "../src/cli.ts";

const MEBIBYTE = 1024 * 1024;

function runArguments(values: readonly string[]) {
	return parseArguments(values, [
		"--allow-remote",
		"--barrier-before-commit",
		"--help",
		"--same-session-hash",
	]);
}

describe("run mode compatibility", () => {
	test("rejects pacing combined with a barrier mode", () => {
		expect(() =>
			assertCompatibleRunModes({ barrierMode: true, ratePerSecond: 10 }),
		).toThrow(
			"--rate-per-second cannot be combined with --barrier-before-commit or --same-session-hash",
		);
	});

	test("allows barrier runs without pacing and paced runs without a barrier", () => {
		expect(() =>
			assertCompatibleRunModes({ barrierMode: true, ratePerSecond: null }),
		).not.toThrow();
		expect(() =>
			assertCompatibleRunModes({ barrierMode: false, ratePerSecond: 10 }),
		).not.toThrow();
	});
});

describe("run concurrency ceilings", () => {
	test("rejects --max-in-flight above the ceiling and accepts the ceiling", () => {
		expect(() =>
			parseRunConcurrencyOptions(
				runArguments(["--max-in-flight", `${MAX_IN_FLIGHT_CEILING + 1}`]),
			),
		).toThrow("--max-in-flight");
		expect(
			parseRunConcurrencyOptions(
				runArguments(["--max-in-flight", `${MAX_IN_FLIGHT_CEILING}`]),
			).maxInFlight,
		).toBe(MAX_IN_FLIGHT_CEILING);
	});

	test("rejects --concurrency above the ceiling and accepts the ceiling", () => {
		expect(() =>
			parseRunConcurrencyOptions(
				runArguments(["--concurrency", `${MAX_CONCURRENCY_CEILING + 1}`]),
			),
		).toThrow("--concurrency");
		expect(
			parseRunConcurrencyOptions(
				runArguments(["--concurrency", `${MAX_CONCURRENCY_CEILING}`]),
			).concurrency,
		).toBe(MAX_CONCURRENCY_CEILING);
	});

	test("rejects --part-concurrency above the ceiling and accepts the ceiling", () => {
		expect(() =>
			parseRunConcurrencyOptions(
				runArguments([
					"--part-concurrency",
					`${MAX_PART_CONCURRENCY_CEILING + 1}`,
				]),
			),
		).toThrow("--part-concurrency");
		expect(
			parseRunConcurrencyOptions(
				runArguments(["--part-concurrency", `${MAX_PART_CONCURRENCY_CEILING}`]),
			).partConcurrency,
		).toBe(MAX_PART_CONCURRENCY_CEILING);
	});
});

describe("run payload budget", () => {
	test("rejects a run staging more than the total-byte ceiling", () => {
		expect(() =>
			assertRunPayloadBudget({
				manifestTotalBytes: 128 * MEBIBYTE,
				uploads: 10_000,
			}),
		).toThrow("ceiling");
	});

	test("accepts a run exactly at the total-byte ceiling", () => {
		expect(() =>
			assertRunPayloadBudget({
				manifestTotalBytes: MAX_TOTAL_PLANNED_BYTES / 512,
				uploads: 512,
			}),
		).not.toThrow();
	});
});
