import { INGEST_AGGREGATE_CONTENT_MAX_BYTES } from "@rudel/api-routes";

export interface R2IngestMaterializationGateStats {
	readonly activeBytes: number;
	readonly activeJobs: number;
	readonly queuedBytes: number;
	readonly queuedJobs: number;
}

export interface R2IngestMaterializationGate {
	getStats: () => R2IngestMaterializationGateStats;
	run: <TResult>(
		bytes: number,
		operation: () => Promise<TResult>,
	) => Promise<TResult>;
}

interface PendingOperation {
	readonly bytes: number;
	readonly start: () => void;
}

export function createR2IngestMaterializationGate(input: {
	readonly maxBytes: number;
	readonly maxJobs: number;
}): R2IngestMaterializationGate {
	if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) {
		throw new Error("R2 materialization maxBytes must be a positive integer");
	}
	if (!Number.isSafeInteger(input.maxJobs) || input.maxJobs <= 0) {
		throw new Error("R2 materialization maxJobs must be a positive integer");
	}

	let activeBytes = 0;
	let activeJobs = 0;
	let queuedBytes = 0;
	const pending: PendingOperation[] = [];

	function dispatch(): void {
		while (activeJobs < input.maxJobs) {
			const nextIndex = pending.findIndex(
				(candidate) => activeBytes + candidate.bytes <= input.maxBytes,
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
		run<TResult>(bytes: number, operation: () => Promise<TResult>) {
			if (
				!Number.isSafeInteger(bytes) ||
				bytes <= 0 ||
				bytes > input.maxBytes
			) {
				return Promise.reject(
					new Error("R2 materialization bytes exceed the process-wide budget"),
				);
			}

			return new Promise<TResult>((resolve, reject) => {
				pending.push({
					bytes,
					start() {
						operation()
							.then(resolve, reject)
							.finally(() => {
								activeBytes -= bytes;
								activeJobs -= 1;
								dispatch();
							});
					},
				});
				queuedBytes += bytes;
				dispatch();
			});
		},
	};
}

const r2IngestMaterializationGate = createR2IngestMaterializationGate({
	maxBytes: INGEST_AGGREGATE_CONTENT_MAX_BYTES,
	maxJobs: 1,
});

export function runWithR2IngestMaterializationSlot<TResult>(
	bytes: number,
	operation: () => Promise<TResult>,
): Promise<TResult> {
	return r2IngestMaterializationGate.run(bytes, operation);
}
