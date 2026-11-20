/**
 * Maintenance jobs that can keep the CPU busy for minutes run on a worker
 * thread, so the server's main thread keeps answering the app and the agents
 * meanwhile. On one Mac the l1-edges job held the main thread for 598 s with
 * a backlog of 324 scopes: health checks timed out, and the app gave the
 * server up as not ready.
 */
type CronHandler = (request: Request) => Promise<Response>;

export const OFF_THREAD_JOBS: Readonly<
	Record<string, () => Promise<CronHandler>>
> = {
	"l1-edges": async () =>
		(await import("../handlers/l1-edges-maintenance.js"))
			.handleL1EdgesMaintenanceRequest,
	"run-index-heal": async () =>
		(await import("../handlers/run-index-heal-maintenance.js"))
			.handleRunIndexHealMaintenanceRequest,
};

export interface MaintenanceJobRequest {
	readonly id: number;
	readonly name: string;
	readonly url: string;
	readonly authorization: string;
}

export interface MaintenanceJobResponse {
	readonly id: number;
	readonly status: number;
	readonly body: string;
}

/** A job that has not answered by then has its worker ended. */
export const JOB_TIMEOUT_MS = 15 * 60_000;
/** The worker ends after this long without a job; the next job starts a new one. */
export const JOB_WORKER_IDLE_MS = 3 * 60_000;

export class MaintenanceJobThread {
	private worker: Worker | undefined;
	private nextId = 1;
	private idleTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly pending = new Map<
		number,
		{
			resolve: (response: MaintenanceJobResponse) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();

	constructor(
		private readonly options: {
			readonly createWorker?: () => Worker;
			readonly timeoutMs?: number;
			readonly idleMs?: number;
		} = {},
	) {}

	run(name: string, request: Request): Promise<MaintenanceJobResponse> {
		clearTimeout(this.idleTimer);
		const id = this.nextId++;
		return new Promise((resolve) => {
			const timer = setTimeout(
				() =>
					this.fail(
						`${name} did not finish within ${Math.round((this.options.timeoutMs ?? JOB_TIMEOUT_MS) / 60_000)} min`,
						504,
					),
				this.options.timeoutMs ?? JOB_TIMEOUT_MS,
			);
			timer.unref?.();
			this.pending.set(id, { resolve, timer });
			try {
				this.thread().postMessage({
					id,
					name,
					url: request.url,
					authorization: request.headers.get("authorization") ?? "",
				} satisfies MaintenanceJobRequest);
			} catch (error) {
				this.settle({
					id,
					status: 500,
					body: JSON.stringify({
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					}),
				});
			}
		});
	}

	get inFlight(): number {
		return this.pending.size;
	}

	close(): void {
		clearTimeout(this.idleTimer);
		this.fail("The server is stopping", 503);
	}

	private thread(): Worker {
		if (this.worker) return this.worker;
		const worker = (this.options.createWorker ?? createJobWorker)();
		worker.addEventListener(
			"message",
			(event: MessageEvent<MaintenanceJobResponse>) => this.settle(event.data),
		);
		worker.addEventListener("error", (event) => {
			if (worker === this.worker)
				this.fail(`The maintenance thread failed: ${event.message}`, 500);
		});
		worker.addEventListener("close", () => {
			if (worker === this.worker)
				this.fail("The maintenance thread stopped", 500);
		});
		this.worker = worker;
		return worker;
	}

	private settle(response: MaintenanceJobResponse): void {
		const waiting = this.pending.get(response.id);
		if (!waiting) return;
		clearTimeout(waiting.timer);
		this.pending.delete(response.id);
		waiting.resolve(response);
		if (this.pending.size > 0 || !this.worker) return;
		const worker = this.worker;
		this.idleTimer = setTimeout(() => {
			if (this.worker === worker && this.pending.size === 0) {
				this.worker = undefined;
				worker.terminate();
			}
		}, this.options.idleMs ?? JOB_WORKER_IDLE_MS);
		this.idleTimer.unref?.();
	}

	/** Ends the worker and answers every job still waiting on it. */
	private fail(message: string, status: number): void {
		const worker = this.worker;
		this.worker = undefined;
		worker?.terminate();
		for (const [id, waiting] of this.pending) {
			clearTimeout(waiting.timer);
			waiting.resolve({
				id,
				status,
				body: JSON.stringify({ ok: false, error: message }),
			});
		}
		this.pending.clear();
	}
}

function createJobWorker(): Worker {
	// The server sets its self-hosted defaults (USAGE_ROLLUP_BACKFILL_ENABLED and
	// the like) on process.env at startup; a worker started without them ran the
	// job with other settings than the main thread did.
	return new Worker(
		new URL("./maintenance-job.worker.js", import.meta.url).href,
		{ env: { ...process.env } } as WorkerOptions,
	);
}

let shared: MaintenanceJobThread | undefined;

/** The scheduler's handler for a job in OFF_THREAD_JOBS: runs it on the shared worker. */
export function offThreadHandler(name: string): CronHandler {
	return async (request) => {
		shared ??= new MaintenanceJobThread();
		const { status, body } = await shared.run(name, request);
		return new Response(body, {
			status,
			headers: { "content-type": "application/json" },
		});
	};
}

export function closeMaintenanceJobThread(): void {
	shared?.close();
	shared = undefined;
}
