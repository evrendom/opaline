import { describe, expect, test } from "bun:test";
import { SessionLanguageSignalScannerOperationalError } from "./ingest-worker-operational.error.js";
import { SessionLanguageSignalScanner } from "./session-language-signal-scanner.service.js";

describe("session language-signal scanner", () => {
	test("terminates a timed-out worker and respawns for the next scan", async () => {
		let workersCreated = 0;
		const scanner = new SessionLanguageSignalScanner({
			createWorker: () => {
				workersCreated += 1;
				return new Worker(
					workersCreated === 1
						? new URL(
								"../__tests__/fixtures/hanging-language-signal-scanner.worker.ts",
								import.meta.url,
							).href
						: new URL(
								"./session-language-signal-scanner.worker.js",
								import.meta.url,
							).href,
				);
			},
			scanTimeoutMs: 1_000,
		});

		try {
			await expect(scanner.scan("ignored")).rejects.toBeInstanceOf(
				SessionLanguageSignalScannerOperationalError,
			);
			await expect(scanner.scan("")).resolves.toEqual({
				member_apologies: 0,
				member_apology_matches: [],
				member_positive: 0,
				member_positive_matches: [],
				member_swears: 0,
				member_swear_matches: [],
				model_apologies: 0,
				model_apology_matches: [],
				model_positive: 0,
				model_positive_matches: [],
				model_swears: 0,
				model_swear_matches: [],
			});
			expect(workersCreated).toBe(2);
		} finally {
			scanner.close();
		}
	});

	test("returns a typed operational error when the worker crashes", async () => {
		const scanner = new SessionLanguageSignalScanner({
			createWorker: () =>
				new Worker(
					new URL(
						"../__tests__/fixtures/crashing-ingest-worker.ts",
						import.meta.url,
					).href,
				),
			scanTimeoutMs: 5_000,
		});

		try {
			await expect(scanner.scan("ignored")).rejects.toBeInstanceOf(
				SessionLanguageSignalScannerOperationalError,
			);
		} finally {
			scanner.close();
		}
	});

	test("stays closed after shutdown", async () => {
		const scanner = new SessionLanguageSignalScanner();
		scanner.close();

		await expect(scanner.scan("ignored")).rejects.toBeInstanceOf(
			SessionLanguageSignalScannerOperationalError,
		);
	});
});
