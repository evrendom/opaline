import type {
	Owner,
	SessionJob,
	SessionOutcome,
} from "../selfhost/local-ingest/service.js";
import { mergeIngestPhaseTotals } from "./ingest-phase-timings.js";
import type {
	LocalIngestThreadRequest,
	LocalIngestThreadResponse,
} from "./local-ingest-thread.types.js";

export class LocalIngestThread {
	private worker: Worker | undefined;
	private readonly pending = new Map<
		number,
		(outcome: SessionOutcome) => void
	>();
	private nextId = 1;
	private closed = false;
	private recycleWhenIdle = false;
	private bytesSinceStart = 0;
	private idleTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * A worker's heap keeps the high-water mark of what it ran. One job of
	 * `recycleAfterBytes`, jobs adding up to `recycleAfterTotalBytes`, or
	 * `idleMs` without work end it; the next job starts a fresh one.
	 */
	constructor(
		private readonly options: {
			readonly recycleAfterBytes?: number;
			readonly recycleAfterTotalBytes?: number;
			readonly idleMs?: number;
			readonly inline?: boolean;
			readonly createWorker?: () => Worker;
		} = {},
	) {}

	ingestSession(job: SessionJob, owner: Owner): Promise<SessionOutcome> {
		if (this.closed)
			return Promise.resolve({
				kind: "retry",
				reason: "The server is stopping",
			});
		const id = this.nextId++;
		clearTimeout(this.idleTimer);
		this.bytesSinceStart += job.bytes ?? 0;
		if (
			(job.bytes ?? 0) >= (this.options.recycleAfterBytes ?? Infinity) ||
			this.bytesSinceStart >= (this.options.recycleAfterTotalBytes ?? Infinity)
		)
			this.recycleWhenIdle = true;
		return new Promise((resolve) => {
			this.pending.set(id, resolve);
			try {
				this.thread().postMessage({
					type: "session",
					id,
					job,
					owner,
				} satisfies LocalIngestThreadRequest);
			} catch (error) {
				this.pending.delete(id);
				resolve({
					kind: "retry",
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}

	get inFlight(): number {
		return this.pending.size;
	}

	close(): void {
		this.closed = true;
		clearTimeout(this.idleTimer);
		this.stop("The server is stopping");
	}

	private thread(): Worker {
		if (this.worker) return this.worker;
		const worker = (this.options.createWorker ?? createIngestWorker)();
		worker.addEventListener(
			"message",
			(event: MessageEvent<LocalIngestThreadResponse>) => {
				mergeIngestPhaseTotals(event.data.timings);
				const resolve = this.pending.get(event.data.id);
				this.pending.delete(event.data.id);
				if (this.pending.size === 0) {
					if (this.recycleWhenIdle) this.end(worker);
					else if (this.options.idleMs !== undefined) {
						clearTimeout(this.idleTimer);
						this.idleTimer = setTimeout(() => {
							if (this.worker === worker && this.pending.size === 0)
								this.end(worker);
						}, this.options.idleMs);
						this.idleTimer.unref?.();
					}
				}
				resolve?.(event.data.outcome);
			},
		);
		worker.addEventListener("error", (event) => {
			if (worker === this.worker)
				this.stop(`The import thread failed: ${event.message}`);
		});
		worker.addEventListener("close", () => {
			if (worker === this.worker) this.stop("The import thread stopped");
		});
		if (this.options.inline)
			worker.postMessage({ type: "inline" } satisfies LocalIngestThreadRequest);
		this.worker = worker;
		return worker;
	}

	private end(worker: Worker): void {
		this.recycleWhenIdle = false;
		this.bytesSinceStart = 0;
		this.worker = undefined;
		worker.terminate();
	}

	private stop(reason: string): void {
		const worker = this.worker;
		this.worker = undefined;
		this.bytesSinceStart = 0;
		this.recycleWhenIdle = false;
		worker?.terminate();
		for (const resolve of this.pending.values())
			resolve({ kind: "retry", reason });
		this.pending.clear();
	}
}

function createIngestWorker(): Worker {
	return new Worker(new URL("./local-ingest.worker.js", import.meta.url).href);
}
