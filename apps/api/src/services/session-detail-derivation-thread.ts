import { SessionDetailTurnSchema } from "@rudel/api-routes";
import { restoreSessionDetailBodyStore } from "./session-detail-body-store.js";
import type {
	SessionDetailDerivation,
	SessionDetailRawSnapshot,
} from "./session-detail-derivation.service.js";
import type { SessionDetailDerivationWorkerResponse } from "./session-detail-derivation.types.js";

export class SessionDetailDerivationWorkerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionDetailDerivationWorkerError";
	}
}

interface PendingDerivation {
	readonly snapshot: SessionDetailRawSnapshot;
	readonly resolve: (derivation: SessionDetailDerivation) => void;
	readonly reject: (error: Error) => void;
}

export class SessionDetailDerivationThread {
	private closed = false;
	private nextRequestId = 1;
	private readonly pending = new Map<number, PendingDerivation>();
	private worker: Worker | undefined;

	constructor(
		private readonly createWorker: () => Worker = createDerivationWorker,
	) {}

	derive(snapshot: SessionDetailRawSnapshot): Promise<SessionDetailDerivation> {
		if (this.closed)
			return Promise.reject(
				new SessionDetailDerivationWorkerError(
					"Session detail derivation is shutting down",
				),
			);
		const requestId = this.nextRequestId++;
		return new Promise((resolve, reject) => {
			try {
				const worker = this.getWorker();
				this.pending.set(requestId, { snapshot, resolve, reject });
				worker.postMessage({ requestId, snapshot });
			} catch (error) {
				this.pending.delete(requestId);
				reject(
					new SessionDetailDerivationWorkerError(
						error instanceof Error ? error.message : String(error),
					),
				);
			}
		});
	}

	close(): void {
		this.closed = true;
		this.failAll(
			new SessionDetailDerivationWorkerError(
				"Session detail derivation is shutting down",
			),
		);
	}

	private getWorker(): Worker {
		if (this.worker) return this.worker;
		const worker = this.createWorker();
		worker.addEventListener(
			"message",
			(event: MessageEvent<SessionDetailDerivationWorkerResponse>) => {
				if (worker === this.worker) this.settle(event.data);
			},
		);
		worker.addEventListener("error", (event) => {
			if (worker === this.worker)
				this.failAll(new SessionDetailDerivationWorkerError(event.message));
		});
		worker.addEventListener("close", () => {
			if (worker === this.worker)
				this.failAll(
					new SessionDetailDerivationWorkerError(
						"Session detail derivation worker stopped unexpectedly",
					),
				);
		});
		worker.unref();
		this.worker = worker;
		return worker;
	}

	private settle(response: SessionDetailDerivationWorkerResponse): void {
		const pending = this.pending.get(response.requestId);
		if (!pending) return;
		this.pending.delete(response.requestId);
		if (response.status === "error") {
			pending.reject(new SessionDetailDerivationWorkerError(response.message));
			return;
		}
		const { turnBodies, ...derivation } = response.derivation;
		pending.resolve({
			...derivation,
			rawSubagents: pending.snapshot.subagents,
			turnBodies: restoreSessionDetailBodyStore(turnBodies, (value) =>
				SessionDetailTurnSchema.parse(value),
			),
		});
	}

	private failAll(error: SessionDetailDerivationWorkerError): void {
		const worker = this.worker;
		this.worker = undefined;
		worker?.terminate();
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}
}

function createDerivationWorker(): Worker {
	return new Worker(
		new URL("./session-detail-derivation.worker.js", import.meta.url).href,
	);
}

let thread: SessionDetailDerivationThread | undefined;

export function deriveSessionDetailOffThread(
	snapshot: SessionDetailRawSnapshot,
): Promise<SessionDetailDerivation> {
	thread ??= new SessionDetailDerivationThread();
	return thread.derive(snapshot);
}

export function shutdownSessionDetailDerivationThread(): void {
	thread?.close();
}
