import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertCompatibleRunModes,
	assertRunPayloadBudget,
	main,
	parseArguments,
	parseRunConcurrencyOptions,
} from "../src/cli.ts";

// The ceilings are asserted as literals on purpose: a test derived from the
// exported constants would keep passing if a ceiling were quietly raised.

const temporaryDirectories: string[] = [];

afterAll(async () => {
	for (const directory of temporaryDirectories) {
		await rm(directory, { force: true, recursive: true });
	}
});

async function generateManifest(sizeBytes: number): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "opaline-loadtest-safety-"));
	temporaryDirectories.push(directory);
	const corpusDirectory = join(directory, "corpus");
	await main([
		"generate",
		"--output",
		corpusDirectory,
		"--seed",
		"cli-safety",
		"--size-bytes",
		String(sizeBytes),
	]);
	return join(corpusDirectory, "manifest.json");
}

function runArguments(values: readonly string[]) {
	return parseArguments(values, [
		"--allow-remote",
		"--barrier-before-commit",
		"--help",
		"--same-session-hash",
	]);
}

describe("run entrypoint safety wiring", () => {
	test("the run command rejects pacing combined with a barrier mode", async () => {
		const manifest = await generateManifest(1024);
		await expect(
			main([
				"run",
				"--manifest",
				manifest,
				"--barrier-before-commit",
				"--rate-per-second",
				"10",
			]),
		).rejects.toThrow(
			"--rate-per-second cannot be combined with --barrier-before-commit or --same-session-hash",
		);
	});

	test("the run command rejects --max-in-flight above 512", async () => {
		const manifest = await generateManifest(1024);
		await expect(
			main(["run", "--manifest", manifest, "--max-in-flight", "513"]),
		).rejects.toThrow("--max-in-flight must be an integer from 1 to 512");
	});

	test("the run command rejects --concurrency above 64", async () => {
		const manifest = await generateManifest(1024);
		await expect(
			main(["run", "--manifest", manifest, "--concurrency", "65"]),
		).rejects.toThrow("--concurrency must be an integer from 1 to 64");
	});

	test("the run command rejects staging more than 64 GiB in total", async () => {
		const manifest = await generateManifest(8 * 1024 * 1024);
		await expect(
			main(["run", "--manifest", manifest, "--uploads", "10000"]),
		).rejects.toThrow("ceiling");
	});
});

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
	test("caps --max-in-flight at literal 512", () => {
		expect(() =>
			parseRunConcurrencyOptions(runArguments(["--max-in-flight", "513"])),
		).toThrow("--max-in-flight must be an integer from 1 to 512");
		expect(
			parseRunConcurrencyOptions(runArguments(["--max-in-flight", "512"]))
				.maxInFlight,
		).toBe(512);
	});

	test("caps --concurrency at literal 64", () => {
		expect(() =>
			parseRunConcurrencyOptions(runArguments(["--concurrency", "65"])),
		).toThrow("--concurrency must be an integer from 1 to 64");
		expect(
			parseRunConcurrencyOptions(runArguments(["--concurrency", "64"]))
				.concurrency,
		).toBe(64);
	});

	test("caps --part-concurrency at literal 64", () => {
		expect(() =>
			parseRunConcurrencyOptions(runArguments(["--part-concurrency", "65"])),
		).toThrow("--part-concurrency must be an integer from 1 to 64");
		expect(
			parseRunConcurrencyOptions(runArguments(["--part-concurrency", "64"]))
				.partConcurrency,
		).toBe(64);
	});
});

describe("run payload budget", () => {
	test("rejects one byte past the literal 64 GiB ceiling", () => {
		expect(() =>
			assertRunPayloadBudget({
				manifestTotalBytes: 134_217_729,
				uploads: 512,
			}),
		).toThrow("ceiling");
	});

	test("accepts a run exactly at the literal 64 GiB ceiling", () => {
		expect(() =>
			assertRunPayloadBudget({
				manifestTotalBytes: 134_217_728,
				uploads: 512,
			}),
		).not.toThrow();
	});
});
