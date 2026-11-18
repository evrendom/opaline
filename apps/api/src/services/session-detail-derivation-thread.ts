import { SessionDetailTurnSchema } from "@rudel/api-routes";
import { WORKER_RECYCLE_BYTES } from "../lib/worker-memory.js";
import { restoreSessionDetailBodyStore } from "./session-detail-body-store.js";
import type {
	SessionDetailDerivation,
	SessionDetailRawSnapshot,
} from "./session-detail-derivation.service.js";
import type {
	LoadedSessionDetailSnapshot,
	SessionDetailDerivationWorkerResponse,
} from "./session-detail-derivation.types.js";
import type { SessionDetailDerivationCacheKey } from "./session-detail-derivation-cache.js";

export class SessionDetailDerivationWorkerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionDetailDerivationWorkerError";
	}
}

interface PendingDerivation {
	readonly snapshot: SessionDetailRawSnapshot | null;
	readonly resolve: (
		derivation: SessionDetailDerivation | null,
		loaded: LoadedSessionDetailSnapshot | undefined,
	) => void;
	readonly reject: (error: Error) => void;
}

export class SessionDetailDerivationThread {
	private closed = false;
	private nextRequestId = 1;
	private readonly pending = new Map<number, PendingDerivation>();
	private worker: Worker | undefined;
	private recycleWhenIdle = false;

	constructor(
		private readonly createWorker: () => Worker = createDerivationWorker,
	) {}

	loadAndDerive(key: SessionDetailDerivationCacheKey): Promise<{
		derivation: SessionDetailDerivation;
		loaded: LoadedSessionDetailSnapshot;
	} | null> {
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
				this.pending.set(requestId, {
					snapshot: null,
					resolve: (derivation, loaded) =>
						resolve(derivation && loaded ? { derivation, loaded } : null),
					reject,
				});
				worker.postMessage({ requestId, load: key });
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
				this.pending.set(requestId, {
					snapshot,
					resolve: (derivation) =>
						derivation
							? resolve(derivation)
							: reject(
									new SessionDetailDerivationWorkerError(
										"Session detail derivation found no snapshot",
									),
								),
					reject,
				});
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
		const rawBytes =
			response.status === "success"
				? (response.loaded?.rawBytes ?? pending.snapshot?.content.length ?? 0)
				: 0;
		if (rawBytes >= WORKER_RECYCLE_BYTES) this.recycleWhenIdle = true;
		if (this.recycleWhenIdle && this.pending.size === 0) {
			this.recycleWhenIdle = false;
			const worker = this.worker;
			this.worker = undefined;
			worker?.terminate();
		}
		if (response.status === "error") {
			pending.reject(new SessionDetailDerivationWorkerError(response.message));
			return;
		}
		if (response.status === "missing") {
			pending.resolve(null, undefined);
			return;
		}
		const { turnBodies, ...derivation } = response.derivation;
		pending.resolve(
			{
				...derivation,
				rawSubagents:
					response.loaded?.subagents ?? pending.snapshot?.subagents ?? {},
				turnBodies: restoreSessionDetailBodyStore(turnBodies, (value) =>
					SessionDetailTurnSchema.parse(value),
				),
			},
			response.loaded,
		);
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

export function loadAndDeriveSessionDetailOffThread(
	key: SessionDetailDerivationCacheKey,
): ReturnType<SessionDetailDerivationThread["loadAndDerive"]> {
	thread ??= new SessionDetailDerivationThread();
	return thread.loadAndDerive(key);
}

export function shutdownSessionDetailDerivationThread(): void {
	thread?.close();
}
