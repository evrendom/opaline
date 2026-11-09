import { isVercelRuntime } from "../lib/api-runtime.js";
import { isSelfHosted } from "../lib/self-hosted.js";

export function shouldStartBestEffortLanguageSignals(input: {
	awaitLanguageSignals: boolean;
	durableProcessing: boolean;
}): boolean {
	// Durable uploads rely on the reconciliation worker. Starting the scanner
	// inline would compete with the bounded usage worker while the job is leased.
	return !input.awaitLanguageSignals && !input.durableProcessing;
}

export function shouldAwaitBestEffortLanguageSignals(input: {
	awaitBestEffortLanguageSignals: boolean;
	awaitLanguageSignals: boolean;
	durableProcessing: boolean;
}): boolean {
	// Vercel has no resident reconciliation worker, and Hobby cron jobs can run
	// only daily. Run durable-upload signals after the other derived facts while
	// keeping scanner failure outside the upload's success contract.
	return (
		input.awaitBestEffortLanguageSignals &&
		!input.awaitLanguageSignals &&
		input.durableProcessing
	);
}

export function shouldPersistUsageExtractionFailureReceipt(input: {
	durableProcessing: boolean;
	extractionAllowsReceipt: boolean;
}): boolean {
	// A durable target receipt and deduplication token are final for that ledger.
	// Diagnostic/incomplete output must not consume them before a retry succeeds.
	return input.extractionAllowsReceipt && !input.durableProcessing;
}

export function awaitsDurableLanguageSignals(
	environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	return isVercelRuntime(environment) || isSelfHosted(environment);
}
