import { readBooleanEnv } from "./lib/env.js";
import { readResendConfig } from "./resend-config.js";
import {
	registerClickHousePurgeWorker,
	startClickHousePurgeWorker,
} from "./services/clickhouse-purge.service.js";
import { startGitHubEvidenceWorker } from "./services/github-evidence-worker.service.js";
import { shutdownIngestFilterQueue } from "./services/ingest-filter.service.js";
import { registerR2IngestCleanupWorker } from "./services/r2-ingest-cleanup.service.js";
import {
	runR2IngestRepairPass,
	startLargeR2IngestWatcher,
} from "./services/r2-ingest-repair.service.js";
import {
	createR2MultipartUploadClient,
	readR2IngestAvailability,
} from "./services/r2-ingest-storage.service.js";
import { startSessionLanguageSignalReconciliationWorker } from "./services/session-language-signal-reconciliation.service.js";
import { shutdownSessionLanguageSignalScanner } from "./services/session-language-signal-scanner.service.js";
import { startSessionLineageReconciliationWorker } from "./services/session-lineage-reconciliation.service.js";
import { shutdownUsageExtractionQueue } from "./services/usage-extraction.service.js";

export interface ServerLifecycle {
	readonly shutdown: () => Promise<void>;
}

export function startServerLifecycle(): ServerLifecycle {
	const r2IngestAvailability = readR2IngestAvailability();
	const r2IngestCleanupClient = r2IngestAvailability.enabled
		? createR2MultipartUploadClient(r2IngestAvailability.configuration)
		: undefined;
	const clickHousePurgeWorker = startClickHousePurgeWorker({
		enabled: readBooleanEnv("CLICKHOUSE_PURGE_WORKER_ENABLED", true),
		...(r2IngestCleanupClient ? { r2: r2IngestCleanupClient } : {}),
		repairR2IngestCleanup: r2IngestCleanupClient
			? () => runR2IngestRepairPass(r2IngestCleanupClient)
			: undefined,
		resend: readResendConfig(),
	});
	registerClickHousePurgeWorker(clickHousePurgeWorker);
	registerR2IngestCleanupWorker(clickHousePurgeWorker);
	const largeR2IngestWatcher = r2IngestCleanupClient
		? startLargeR2IngestWatcher()
		: undefined;
	const sessionLanguageSignalReconciliationWorker =
		process.env.NODE_ENV === "test"
			? undefined
			: startSessionLanguageSignalReconciliationWorker();
	const sessionLineageReconciliationWorker =
		process.env.NODE_ENV === "test"
			? undefined
			: startSessionLineageReconciliationWorker();
	const githubEvidenceWorker =
		process.env.NODE_ENV === "test" ? undefined : startGitHubEvidenceWorker();
	let isShuttingDown = false;

	return {
		async shutdown() {
			if (isShuttingDown) {
				return;
			}
			isShuttingDown = true;

			largeR2IngestWatcher?.stop();
			shutdownIngestFilterQueue();
			shutdownUsageExtractionQueue();
			shutdownSessionLanguageSignalScanner();
			await Promise.all([
				githubEvidenceWorker?.stop(),
				clickHousePurgeWorker.stop(),
				sessionLanguageSignalReconciliationWorker?.stop(),
				sessionLineageReconciliationWorker?.stop(),
			]);
		},
	};
}
