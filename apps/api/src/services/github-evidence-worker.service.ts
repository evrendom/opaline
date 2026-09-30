import { getLogger } from "@logtape/logtape";
import { sqlClient } from "../db.js";
import { readGitHubRepositoryAppConfig } from "./github-app.service.js";
import { runGitHubEvidenceCollectionMaintenance } from "./github-evidence-maintenance.service.js";
import {
	createR2MultipartUploadClient,
	readR2IngestAvailability,
} from "./r2-ingest-storage.service.js";

const logger = getLogger(["opaline", "api", "github-evidence-worker"]);
const POLL_INTERVAL_MS = 5 * 60_000;
const PASS_TIMEOUT_MS = 240_000;
const WORKER_BATCH_SIZE = 5;
const CONTINUE_DELAY_MS = 1_000;

export interface GitHubEvidenceWorker {
	readonly stop: () => Promise<void>;
	readonly wake: () => void;
}

let registeredWorker: GitHubEvidenceWorker | undefined;

/**
 * Wakes the resident worker after a collection was durably enqueued. Without a
 * resident worker (for example on Vercel) the queued request is picked up by
 * the next scheduled maintenance pass.
 */
export function wakeGitHubEvidenceWorker(): void {
	registeredWorker?.wake();
}

export async function runConfiguredGitHubEvidenceMaintenance(
	limit = 1,
	signal?: AbortSignal,
) {
	const config = readGitHubRepositoryAppConfig();
	if (!config) return { enabled: false as const, hasMore: false };
	const storage = readR2IngestAvailability();
	if (!storage.enabled) {
		throw new Error(
			"GitHub evidence collection requires configured object storage.",
		);
	}
	const result = await runGitHubEvidenceCollectionMaintenance({
		config,
		database: sqlClient,
		limit,
		r2: createR2MultipartUploadClient(storage.configuration),
		signal: signal
			? AbortSignal.any([signal, AbortSignal.timeout(PASS_TIMEOUT_MS)])
			: AbortSignal.timeout(PASS_TIMEOUT_MS),
	});
	return { ...result, enabled: true as const };
}

export function startGitHubEvidenceWorker(): GitHubEvidenceWorker {
	let stopped = false;
	let running = false;
	let runAgain = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let active: Promise<void> = Promise.resolve();

	function schedule(delayMs: number): void {
		if (stopped) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(startPass, delayMs);
		timer.unref();
	}

	function startPass(): void {
		if (stopped) return;
		if (running) {
			runAgain = true;
			return;
		}
		running = true;
		let continueSoon = false;
		active = runConfiguredGitHubEvidenceMaintenance(WORKER_BATCH_SIZE)
			.then((result) => {
				if (!result.enabled) return;
				continueSoon = result.hasMore;
				if (result.failed > 0 || result.hasExhaustedFailures) {
					logger.warn(
						"GitHub evidence maintenance has failed attempts (count={count}, exhausted={exhausted})",
						{ count: result.failed, exhausted: result.hasExhaustedFailures },
					);
				}
			})
			.catch(() => {
				logger.error(
					"GitHub evidence maintenance failed; inspect durable collection state.",
				);
			})
			.finally(() => {
				running = false;
				if (stopped) return;
				if (runAgain || continueSoon) {
					runAgain = false;
					schedule(CONTINUE_DELAY_MS);
					return;
				}
				schedule(POLL_INTERVAL_MS);
			});
	}

	startPass();
	const worker: GitHubEvidenceWorker = {
		async stop() {
			stopped = true;
			if (timer) clearTimeout(timer);
			await active;
		},
		wake() {
			if (stopped) return;
			if (running) {
				runAgain = true;
				return;
			}
			schedule(0);
		},
	};
	registeredWorker = worker;
	return worker;
}
