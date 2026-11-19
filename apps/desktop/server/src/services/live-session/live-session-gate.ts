/** No database slot for a live session append freed up in time: retry. */
export class LiveSessionBusyError extends Error {
	constructor() {
		super("Live session updates are busy; retry shortly");
		this.name = "LiveSessionBusyError";
	}
}

/** An R2 call of a live session failed or timed out: retry. */
export class LiveSessionStorageError extends Error {
	constructor(cause: unknown) {
		super("Live session storage is unavailable; retry shortly", { cause });
		this.name = "LiveSessionStorageError";
	}
}

export interface LiveSessionGate {
	/** Runs `task` once a slot is free, or throws `LiveSessionBusyError`. */
	readonly run: <T>(task: () => Promise<T>) => Promise<T>;
}

/**
 * Bounds the live session transactions running at once, below the live
 * pool's size so the pool always has a connection for `state` and the
 * ownership reads, and how long an append waits for a turn: past
 * `maxWaitMs` it fails fast with a retryable error instead of queueing
 * behind the pool without limit.
 */
export function createLiveSessionGate(options: {
	readonly maxActive: number;
	readonly maxWaitMs: number;
}): LiveSessionGate {
	let active = 0;
	const waiting: Array<() => void> = [];

	function acquire(): Promise<void> {
		if (active < options.maxActive) {
			active += 1;
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			const grant = () => {
				clearTimeout(timer);
				active += 1;
				resolve();
			};
			const timer = setTimeout(() => {
				const index = waiting.indexOf(grant);
				if (index !== -1) waiting.splice(index, 1);
				reject(new LiveSessionBusyError());
			}, options.maxWaitMs);
			waiting.push(grant);
		});
	}

	function release(): void {
		active -= 1;
		waiting.shift()?.();
	}

	return {
		async run(task) {
			await acquire();
			try {
				return await task();
			} finally {
				release();
			}
		},
	};
}
