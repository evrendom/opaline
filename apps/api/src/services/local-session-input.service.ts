import type {
	LocalSessionInputRequest,
	LocalSessionInputWorkerResponse,
	PreparedLocalSession,
} from "./local-session-input.types.js";

interface Pending {
	readonly slot: Slot;
	readonly resolve: (prepared: PreparedLocalSession) => void;
	readonly reject: (error: Error) => void;
}

interface Slot {
	worker: Worker | undefined;
	busy: number;
}

export class LocalSessionInputPool {
	private readonly slots: Slot[];
	private readonly pending = new Map<number, Pending>();
	private nextRequestId = 1;
	private closed = false;

	constructor(
		size: number,
		private readonly createWorker: () => Worker = () =>
			new Worker(
				new URL("./local-session-input.worker.js", import.meta.url).href,
			),
	) {
		this.slots = Array.from({ length: Math.max(1, size) }, () => ({
			worker: undefined,
			busy: 0,
		}));
	}

	prepare(request: LocalSessionInputRequest): Promise<PreparedLocalSession> {
		if (this.closed)
			return Promise.reject(new Error("Local session preparation is closed"));
		const slot = this.slots.reduce((best, candidate) =>
			candidate.busy < best.busy ? candidate : best,
		);
		const requestId = this.nextRequestId++;
		return new Promise((resolve, reject) => {
			slot.busy += 1;
			this.pending.set(requestId, { slot, resolve, reject });
			try {
				this.workerOf(slot).postMessage({ requestId, request });
			} catch (error) {
				this.settle(
					requestId,
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		});
	}

	close(): void {
		this.closed = true;
		for (const slot of this.slots) {
			slot.worker?.terminate();
			slot.worker = undefined;
		}
		for (const requestId of [...this.pending.keys()])
			this.settle(requestId, new Error("Local session preparation is closed"));
	}

	private settle(
		requestId: number,
		outcome: PreparedLocalSession | Error,
	): void {
		const entry = this.pending.get(requestId);
		if (!entry) return;
		this.pending.delete(requestId);
		entry.slot.busy -= 1;
		if (outcome instanceof Error) entry.reject(outcome);
		else entry.resolve(outcome);
	}

	private workerOf(slot: Slot): Worker {
		if (slot.worker) return slot.worker;
		const worker = this.createWorker();
		worker.addEventListener(
			"message",
			(event: MessageEvent<LocalSessionInputWorkerResponse>) => {
				const response = event.data;
				this.settle(
					response.requestId,
					response.status === "ok"
						? response.prepared
						: new Error(response.message),
				);
			},
		);
		const fail = (message: string) => {
			if (slot.worker !== worker) return;
			slot.worker = undefined;
			worker.terminate();
			for (const [requestId, entry] of [...this.pending])
				if (entry.slot === slot) this.settle(requestId, new Error(message));
		};
		worker.addEventListener("error", (event) => fail(event.message));
		worker.addEventListener("close", () =>
			fail("Local session preparation stopped unexpectedly"),
		);
		worker.unref();
		slot.worker = worker;
		return worker;
	}
}
