export class IngestShuttingDownError extends Error {
	constructor() {
		super("Session ingestion is shutting down");
		this.name = "IngestShuttingDownError";
	}
}

export interface IngestLifecycle {
	readonly activeCount: () => number;
	readonly beginShutdown: () => void;
	readonly isShuttingDown: () => boolean;
	readonly run: <Value>(
		operation: () => Value | PromiseLike<Value>,
	) => Promise<Value>;
	readonly waitForIdle: () => Promise<void>;
}

export function createIngestLifecycle(): IngestLifecycle {
	const activeIngests = new Set<Promise<unknown>>();
	let shuttingDown = false;

	return {
		activeCount: () => activeIngests.size,
		beginShutdown: () => {
			shuttingDown = true;
		},
		isShuttingDown: () => shuttingDown,
		run: <Value>(operation: () => Value | PromiseLike<Value>) => {
			if (shuttingDown) {
				return Promise.reject<Value>(new IngestShuttingDownError());
			}

			// Defer the operation by one microtask so the promise is registered before
			// the handler begins and reaches its first await.
			const tracked = new Promise<Value>((resolve, reject) => {
				queueMicrotask(() => {
					try {
						resolve(operation());
					} catch (error) {
						reject(error);
					}
				});
			});
			activeIngests.add(tracked);
			const remove = () => activeIngests.delete(tracked);
			void tracked.then(remove, remove);
			return tracked;
		},
		waitForIdle: async () => {
			while (activeIngests.size > 0) {
				await Promise.allSettled([...activeIngests]);
			}
		},
	};
}

export const ingestLifecycle = createIngestLifecycle();
