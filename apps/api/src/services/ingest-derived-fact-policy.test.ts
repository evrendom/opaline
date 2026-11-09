import { describe, expect, test } from "bun:test";
import {
	awaitsDurableLanguageSignals,
	shouldAwaitBestEffortLanguageSignals,
	shouldPersistUsageExtractionFailureReceipt,
	shouldStartBestEffortLanguageSignals,
} from "./ingest-derived-fact-policy.js";

describe("ingest derived-fact policy", () => {
	test("defers language signals during durable processing", () => {
		expect(
			shouldStartBestEffortLanguageSignals({
				awaitLanguageSignals: false,
				durableProcessing: true,
			}),
		).toBe(false);
		expect(
			shouldStartBestEffortLanguageSignals({
				awaitLanguageSignals: false,
				durableProcessing: false,
			}),
		).toBe(true);
	});

	test("awaits best-effort durable signals only on an explicitly enabled host", () => {
		expect(
			shouldAwaitBestEffortLanguageSignals({
				awaitBestEffortLanguageSignals: true,
				awaitLanguageSignals: false,
				durableProcessing: true,
			}),
		).toBe(true);
		expect(
			shouldAwaitBestEffortLanguageSignals({
				awaitBestEffortLanguageSignals: false,
				awaitLanguageSignals: false,
				durableProcessing: true,
			}),
		).toBe(false);
		expect(
			shouldAwaitBestEffortLanguageSignals({
				awaitBestEffortLanguageSignals: true,
				awaitLanguageSignals: true,
				durableProcessing: true,
			}),
		).toBe(false);
		expect(
			shouldAwaitBestEffortLanguageSignals({
				awaitBestEffortLanguageSignals: true,
				awaitLanguageSignals: false,
				durableProcessing: false,
			}),
		).toBe(false);
	});

	test("durable uploads scan their signals where no resident reconciler runs: Vercel and self-hosted servers", () => {
		expect(awaitsDurableLanguageSignals({ VERCEL: "1" })).toBe(true);
		expect(awaitsDurableLanguageSignals({ OPALINE_SELF_HOSTED: "1" })).toBe(
			true,
		);
		expect(awaitsDurableLanguageSignals({})).toBe(false);
		expect(
			awaitsDurableLanguageSignals({ VERCEL: "0", OPALINE_SELF_HOSTED: "0" }),
		).toBe(false);
	});

	test("never consumes a durable target receipt for diagnostic usage output", () => {
		expect(
			shouldPersistUsageExtractionFailureReceipt({
				durableProcessing: true,
				extractionAllowsReceipt: true,
			}),
		).toBe(false);
		expect(
			shouldPersistUsageExtractionFailureReceipt({
				durableProcessing: true,
				extractionAllowsReceipt: false,
			}),
		).toBe(false);
		expect(
			shouldPersistUsageExtractionFailureReceipt({
				durableProcessing: false,
				extractionAllowsReceipt: true,
			}),
		).toBe(true);
		expect(
			shouldPersistUsageExtractionFailureReceipt({
				durableProcessing: false,
				extractionAllowsReceipt: false,
			}),
		).toBe(false);
	});
});
