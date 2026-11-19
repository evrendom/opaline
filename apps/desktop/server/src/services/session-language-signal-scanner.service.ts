import { ingestWorkRunsInline } from "../lib/inline-work.js";
import { recyclesWorkerAfter } from "../lib/worker-memory.js";
import { SessionLanguageSignalScannerOperationalError } from "./ingest-worker-operational.error.js";
import type { SessionLanguageSignalScannerWorkerResponse } from "./session-language-signal-scanner.types.js";
import {
	captureSessionLanguageSignalsWithRuns,
	type SessionLanguageSignalScan,
} from "./session-language-signal-summary.js";

interface PendingLanguageSignalScan {
	readonly reject: (error: Error) => void;
	readonly resolve: (summary: SessionLanguageSignalScan) => void;
	readonly timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_SCAN_TIMEOUT_MS = 60_000;

export class SessionLanguageSignalScanner {
	private closed = false;
	private readonly createWorker: () => Worker;
	private nextRequestId = 1;
	private readonly pending = new Map<number, PendingLanguageSignalScan>();
	private readonly scanTimeoutMs: number;
	private worker: Worker | undefined;
	private recycleWhenIdle = false;

	constructor(input?: {
		readonly createWorker?: () => Worker;
		readonly scanTimeoutMs?: number;
	}) {
		this.createWorker = input?.createWorker ?? createScannerWorker;
		this.scanTimeoutMs = input?.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
	}

	scan(content: string): Promise<SessionLanguageSignalScan> {
		if (this.closed) {
			return Promise.reject(
				new SessionLanguageSignalScannerOperationalError(
					"Language-signal scanner is shutting down",
				),
			);
		}
		const requestId = this.nextRequestId;
		this.nextRequestId += 1;

		return new Promise((resolve, reject) => {
			try {
				const worker = this.getWorker();
				const timeout = setTimeout(() => {
					this.handleWorkerFailure(
						worker,
						new SessionLanguageSignalScannerOperationalError(
							`Language-signal scan exceeded ${this.scanTimeoutMs}ms deadline`,
						),
					);
				}, this.scanTimeoutMs);
				timeout.unref();
				this.pending.set(requestId, { reject, resolve, timeout });
				worker.postMessage({ content, requestId });
				if (recyclesWorkerAfter(content.length)) this.recycleWhenIdle = true;
			} catch (error) {
				const pending = this.pending.get(requestId);
				if (pending) clearTimeout(pending.timeout);
				this.pending.delete(requestId);
				reject(toOperationalError(error));
			}
		});
	}

	close(): void {
		this.closed = true;
		this.failAll(
			new SessionLanguageSignalScannerOperationalError(
				"Language-signal scanner is shutting down",
			),
		);
	}

	private getWorker(): Worker {
		if (this.worker) return this.worker;
		const worker = this.createWorker();
		worker.addEventListener(
			"message",
			(event: MessageEvent<SessionLanguageSignalScannerWorkerResponse>) => {
				this.handleMessage(worker, event.data);
			},
		);
		worker.addEventListener("error", (event) => {
			this.handleWorkerFailure(
				worker,
				new SessionLanguageSignalScannerOperationalError(event.message),
			);
		});
		worker.addEventListener("close", () => {
			this.handleWorkerFailure(
				worker,
				new SessionLanguageSignalScannerOperationalError(
					"Language-signal scanner stopped unexpectedly",
				),
			);
		});
		worker.unref();
		this.worker = worker;
		return worker;
	}

	private handleMessage(
		worker: Worker,
		response: SessionLanguageSignalScannerWorkerResponse,
	): void {
		if (worker !== this.worker) return;
		const pending = this.pending.get(response.requestId);
		if (!pending) return;
		this.pending.delete(response.requestId);
		clearTimeout(pending.timeout);
		if (this.recycleWhenIdle && this.pending.size === 0) {
			this.recycleWhenIdle = false;
			this.worker = undefined;
			worker.terminate();
		}

		if (response.status === "error") {
			pending.reject(
				new SessionLanguageSignalScannerOperationalError(response.message),
			);
			return;
		}
		pending.resolve(response.summary);
	}

	private handleWorkerFailure(
		worker: Worker,
		error: SessionLanguageSignalScannerOperationalError,
	): void {
		if (worker !== this.worker) return;
		this.failAll(error);
	}

	private failAll(error: SessionLanguageSignalScannerOperationalError): void {
		const worker = this.worker;
		this.worker = undefined;
		worker?.terminate();
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
		this.pending.clear();
	}
}

function createScannerWorker(): Worker {
	return new Worker(
		new URL("./session-language-signal-scanner.worker.js", import.meta.url)
			.href,
	);
}

const scanner = new SessionLanguageSignalScanner();

export function scanSessionLanguageSignalsOffThread(
	content: string,
): Promise<SessionLanguageSignalScan> {
	if (ingestWorkRunsInline())
		return Promise.resolve().then(() => {
			try {
				return captureSessionLanguageSignalsWithRuns(content);
			} catch (error) {
				throw new SessionLanguageSignalScannerOperationalError(
					error instanceof Error
						? error.message
						: "Language-signal scan failed",
				);
			}
		});
	return scanner.scan(content);
}

export function shutdownSessionLanguageSignalScanner(): void {
	scanner.close();
}

function toOperationalError(
	error: unknown,
): SessionLanguageSignalScannerOperationalError {
	if (error instanceof SessionLanguageSignalScannerOperationalError) {
		return error;
	}
	return new SessionLanguageSignalScannerOperationalError(
		error instanceof Error ? error.message : "Language-signal scanner failed",
		error,
	);
}
