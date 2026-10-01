import { getLogger } from "@logtape/logtape";
import { sqlClient } from "../db.js";
import { readGitHubRepositoryAppConfig } from "./github-app.service.js";
import { runGitHubEvidenceCollectionMaintenance } from "./github-evidence-maintenance.service.js";
import { runGitHubRepositorySweep } from "./github-repository-sweep.service.js";
import { pruneGitHubWebhookDeliveries } from "./github-webhook-delivery.service.js";
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
	readonly wake: (delayMs?: number) => void;
}

let registeredWorker: GitHubEvidenceWorker | undefined;

/**
 * Wakes the resident worker after a collection was durably enqueued, or at the
 * moment a webhook-requested refresh falls due. Without a resident worker (for
 * example on Vercel) the durable request is picked up by the resident worker
 * of another process or by the next scheduled maintenance pass.
 */
export function wakeGitHubEvidenceWorker(delayMs = 0): void {
	registeredWorker?.wake(delayMs);
}

export async function runConfiguredGitHubRepositorySweep(signal?: AbortSignal) {
	const config = readGitHubRepositoryAppConfig();
	if (!config) return { enabled: false, requests: 0, hasMore: false };
	return runGitHubRepositorySweep({ config, database: sqlClient, signal });
}

export async function runConfiguredGitHubEvidenceMaintenance(
	limit = 1,
	signal?: AbortSignal,
	collectionIds?: readonly string[],
) {
	const config = readGitHubRepositoryAppConfig();
	if (!config) return { enabled: false as const, hasMore: false };
	if (!collectionIds)
		await pruneGitHubWebhookDeliveries({ database: sqlClient });
	const storage = readR2IngestAvailability();
	if (!storage.enabled) {
		const [work] = await sqlClient.unsafe<Array<{ pending: boolean }>>(
			`SELECT EXISTS(SELECT 1 FROM github_evidence_collection WHERE ($1::text[] IS NULL OR id = ANY($1::text[])) AND (status IN ('queued', 'collecting') OR retry_count < 2 AND retry_after <= NOW() OR refresh_due_at <= NOW())) AS pending`,
			[collectionIds ? [...collectionIds] : null],
		);
		if (!work?.pending)
			return {
				enabled: true as const,
				attempted: 0,
				failed: 0,
				hasExhaustedFailures: false,
				hasMore: false,
				succeeded: 0,
			};
		throw new Error(
			"GitHub evidence collection requires configured object storage.",
		);
	}
	const result = await runGitHubEvidenceCollectionMaintenance({
		config,
		collectionIds,
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
	// Earliest wake requested while a pass was running.
	let wakeAt: number | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let scheduledAt: number | undefined;
	let active: Promise<void> = Promise.resolve();

	function schedule(delayMs: number): void {
		if (stopped) return;
		if (timer) clearTimeout(timer);
		scheduledAt = Date.now() + delayMs;
		timer = setTimeout(startPass, delayMs);
		timer.unref();
	}

	function startPass(): void {
		if (stopped) return;
		timer = undefined;
		scheduledAt = undefined;
		if (running) {
			wakeAt = Date.now();
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
			.then(async () => {
				const sweep = await runConfiguredGitHubRepositorySweep();
				continueSoon ||= sweep.requests > 0 && sweep.hasMore;
			})
			.catch(() => {
				logger.error(
					"GitHub repository sweep failed; durable progress resumes on the next pass.",
				);
			})
			.finally(() => {
				running = false;
				if (stopped) return;
				const requestedDelay =
					wakeAt === undefined ? Number.POSITIVE_INFINITY : wakeAt - Date.now();
				wakeAt = undefined;
				schedule(
					Math.max(
						0,
						Math.min(
							continueSoon ? CONTINUE_DELAY_MS : POLL_INTERVAL_MS,
							requestedDelay,
						),
					),
				);
			});
	}

	startPass();
	const worker: GitHubEvidenceWorker = {
		async stop() {
			stopped = true;
			if (timer) clearTimeout(timer);
			await active;
		},
		wake(delayMs = 0) {
			if (stopped) return;
			const at = Date.now() + Math.max(0, delayMs);
			if (running) {
				wakeAt = Math.min(wakeAt ?? at, at);
				return;
			}
			if (scheduledAt !== undefined && scheduledAt <= at) return;
			schedule(at - Date.now());
		},
	};
	registeredWorker = worker;
	return worker;
}
