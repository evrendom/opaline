import { getLogger } from "@logtape/logtape";
import {
	INGEST_AGGREGATE_CONTENT_MAX_BYTES,
	INGEST_DIRECT_CONTENT_MAX_BYTES,
} from "@rudel/api-routes";

const logger = getLogger(["rudel", "api", "r2-ingest-materialization-gate"]);

export type R2IngestMaterializationGateErrorCode =
	| "R2_INGEST_GATE_ABORTED"
	| "R2_INGEST_GATE_FULL"
	| "R2_INGEST_GATE_OPERATION_TIMEOUT"
	| "R2_INGEST_GATE_QUEUE_TIMEOUT";

export class R2IngestMaterializationGateError extends Error {
	readonly code: R2IngestMaterializationGateErrorCode;

	constructor(code: R2IngestMaterializationGateErrorCode, message: string) {
		super(message);
		this.code = code;
		this.name = "R2IngestMaterializationGateError";
	}
}

export interface R2IngestMaterializationGateStats {
	readonly activeBytes: number;
	readonly activeJobs: number;
	readonly queuedBytes: number;
	readonly queuedJobs: number;
}

export interface R2IngestMaterializationGate {
	getStats: () => R2IngestMaterializationGateStats;
	/** The largest job this gate admits; recovery selects only jobs up to it. */
	readonly maxJobBytes: number;
	run: <TResult>(
		bytes: number,
		operation: (signal: AbortSignal) => Promise<TResult>,
		signal?: AbortSignal,
	) => Promise<TResult>;
}

interface PendingOperation {
	readonly bytes: number;
	readonly cancelWhileQueued: (error: Error) => void;
	readonly start: () => void;
}

/**
 * Admission for materializing R2 jobs in one process. Jobs up to `maxBytes`
 * share the byte and job budgets. When `largeJobMaxBytes` is set, a job above
 * `maxBytes` (up to that size) is also admitted but runs alone: it starts only
 * when nothing else is active, and nothing starts beside it because its bytes
 * fill the shared budget. Without it, larger jobs are rejected, so processes
 * without the memory for them never start one.
 */
export function createR2IngestMaterializationGate(input: {
	readonly largeJobMaxBytes?: number;
	readonly maxBytes: number;
	readonly maxJobs: number;
	readonly maxQueuedJobs: number;
	readonly operationTimeoutMs: number;
	readonly queueTimeoutMs: number;
	readonly recycleUnsettledOperation?: (error: Error) => void;
	readonly unsettledOperationTimeoutMs?: number;
}): R2IngestMaterializationGate {
	assertPositiveInteger(input.maxBytes, "maxBytes");
	if (input.largeJobMaxBytes !== undefined) {
		assertPositiveInteger(input.largeJobMaxBytes, "largeJobMaxBytes");
	}
	assertPositiveInteger(input.maxJobs, "maxJobs");
	assertPositiveInteger(input.maxQueuedJobs, "maxQueuedJobs");
	assertPositiveInteger(input.operationTimeoutMs, "operationTimeoutMs");
	assertPositiveInteger(input.queueTimeoutMs, "queueTimeoutMs");
	if (input.recycleUnsettledOperation) {
		assertPositiveInteger(
			input.unsettledOperationTimeoutMs ?? 0,
			"unsettledOperationTimeoutMs",
		);
	} else if (input.unsettledOperationTimeoutMs !== undefined) {
		throw new Error(
			"R2 materialization recycleUnsettledOperation is required with unsettledOperationTimeoutMs",
		);
	}

	const maxJobBytes = Math.max(input.maxBytes, input.largeJobMaxBytes ?? 0);
	let activeBytes = 0;
	let activeJobs = 0;
	let queuedBytes = 0;
	const pending: PendingOperation[] = [];

	function canStart(bytes: number): boolean {
		if (bytes > input.maxBytes) return activeJobs === 0;
		return activeJobs < input.maxJobs && activeBytes + bytes <= input.maxBytes;
	}

	function removePending(candidate: PendingOperation): boolean {
		const index = pending.indexOf(candidate);
		if (index === -1) return false;
		pending.splice(index, 1);
		queuedBytes -= candidate.bytes;
		return true;
	}

	function dispatch(): void {
		while (activeJobs < input.maxJobs) {
			// Jobs queued behind a waiting large job do not overtake it; otherwise
			// a steady stream of small jobs could keep it from ever running alone.
			const firstLargeIndex = pending.findIndex(
				(candidate) => candidate.bytes > input.maxBytes,
			);
			const eligible =
				firstLargeIndex === -1
					? pending
					: pending.slice(0, firstLargeIndex + 1);
			const nextIndex = eligible.findIndex((candidate) =>
				canStart(candidate.bytes),
			);
			if (nextIndex === -1) return;
			const [next] = pending.splice(nextIndex, 1);
			if (!next) return;
			queuedBytes -= next.bytes;
			activeBytes += next.bytes;
			activeJobs += 1;
			next.start();
		}
	}

	return {
		getStats() {
			return {
				activeBytes,
				activeJobs,
				queuedBytes,
				queuedJobs: pending.length,
			};
		},
		maxJobBytes,
		run<TResult>(
			bytes: number,
			operation: (signal: AbortSignal) => Promise<TResult>,
			externalSignal?: AbortSignal,
		) {
			if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > maxJobBytes) {
				return Promise.reject(
					new R2IngestMaterializationGateError(
						"R2_INGEST_GATE_FULL",
						"R2 materialization bytes exceed the process-wide budget",
					),
				);
			}
			if (externalSignal?.aborted) {
				return Promise.reject(
					new R2IngestMaterializationGateError(
						"R2_INGEST_GATE_ABORTED",
						"R2 materialization was cancelled before admission",
					),
				);
			}
			if (!canStart(bytes) && pending.length >= input.maxQueuedJobs) {
				return Promise.reject(
					new R2IngestMaterializationGateError(
						"R2_INGEST_GATE_FULL",
						"R2 materialization queue is full",
					),
				);
			}

			return new Promise<TResult>((resolve, reject) => {
				let queueTimer: ReturnType<typeof setTimeout> | undefined;
				let started = false;
				const abortWhileQueued = (): void => {
					candidate.cancelWhileQueued(
						new R2IngestMaterializationGateError(
							"R2_INGEST_GATE_ABORTED",
							"R2 materialization was cancelled while queued",
						),
					);
				};

				function clearQueueWait(): void {
					if (queueTimer) clearTimeout(queueTimer);
					queueTimer = undefined;
					externalSignal?.removeEventListener("abort", abortWhileQueued);
				}

				const candidate: PendingOperation = {
					bytes,
					cancelWhileQueued(error) {
						if (started || !removePending(candidate)) return;
						clearQueueWait();
						reject(error);
						dispatch();
					},
					start() {
						started = true;
						clearQueueWait();
						const controller = new AbortController();
						const abortActive = (): void =>
							controller.abort(externalSignal?.reason);
						externalSignal?.addEventListener("abort", abortActive, {
							once: true,
						});
						const timeoutError = new R2IngestMaterializationGateError(
							"R2_INGEST_GATE_OPERATION_TIMEOUT",
							"R2 materialization exceeded its operation timeout",
						);
						let operationTimer: ReturnType<typeof setTimeout> | undefined;
						let recycleTimer: ReturnType<typeof setTimeout> | undefined;
						let callerSettled = false;
						let operationSettled = false;
						const resolveCaller = (result: TResult): void => {
							if (callerSettled) return;
							callerSettled = true;
							resolve(result);
						};
						const rejectCaller = (error: unknown): void => {
							if (callerSettled) return;
							callerSettled = true;
							reject(error);
						};
						operationTimer = setTimeout(() => {
							controller.abort(timeoutError);
							rejectCaller(timeoutError);
							if (
								input.recycleUnsettledOperation &&
								input.unsettledOperationTimeoutMs
							) {
								recycleTimer = setTimeout(() => {
									if (!operationSettled) {
										input.recycleUnsettledOperation?.(timeoutError);
									}
								}, input.unsettledOperationTimeoutMs);
								recycleTimer.unref();
							}
						}, input.operationTimeoutMs);
						operationTimer.unref();
						const activeOperation = Promise.resolve().then(() =>
							operation(controller.signal),
						);
						void activeOperation.then(
							(result) => {
								resolveCaller(result);
								operationSettled = true;
								if (operationTimer) clearTimeout(operationTimer);
								if (recycleTimer) clearTimeout(recycleTimer);
								externalSignal?.removeEventListener("abort", abortActive);
								activeBytes -= bytes;
								activeJobs -= 1;
								dispatch();
							},
							(error) => {
								rejectCaller(error);
								operationSettled = true;
								if (operationTimer) clearTimeout(operationTimer);
								if (recycleTimer) clearTimeout(recycleTimer);
								externalSignal?.removeEventListener("abort", abortActive);
								activeBytes -= bytes;
								activeJobs -= 1;
								dispatch();
							},
						);
					},
				};

				pending.push(candidate);
				queuedBytes += bytes;
				queueTimer = setTimeout(() => {
					candidate.cancelWhileQueued(
						new R2IngestMaterializationGateError(
							"R2_INGEST_GATE_QUEUE_TIMEOUT",
							"R2 materialization timed out while queued",
						),
					);
				}, input.queueTimeoutMs);
				queueTimer.unref();
				externalSignal?.addEventListener("abort", abortWhileQueued, {
					once: true,
				});
				dispatch();
			});
		},
	};
}

const r2IngestMaterializationGate = createR2IngestMaterializationGate({
	largeJobMaxBytes: INGEST_AGGREGATE_CONTENT_MAX_BYTES,
	maxBytes: INGEST_DIRECT_CONTENT_MAX_BYTES,
	maxJobs: 1,
	maxQueuedJobs: 8,
	operationTimeoutMs: 20 * 60_000,
	queueTimeoutMs: 30_000,
	recycleUnsettledOperation(error) {
		logger.error(
			"R2 materialization did not settle after cancellation; recycling the process (error={error})",
			{ error: error.message },
		);
		process.exit(1);
	},
	unsettledOperationTimeoutMs: 30_000,
});

export function getR2IngestMaterializationGate(): R2IngestMaterializationGate {
	return r2IngestMaterializationGate;
}

function assertPositiveInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`R2 materialization ${name} must be a positive integer`);
	}
}
