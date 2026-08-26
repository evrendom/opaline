const WORKER_RETRY_AFTER_MS = 1_000;

export class IngestFilterWorkerOperationalError extends Error {
	readonly retryAfterMs = WORKER_RETRY_AFTER_MS;

	constructor(message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "IngestFilterWorkerOperationalError";
	}
}

export class SessionLanguageSignalScannerOperationalError extends Error {
	readonly retryAfterMs = WORKER_RETRY_AFTER_MS;

	constructor(message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "SessionLanguageSignalScannerOperationalError";
	}
}
