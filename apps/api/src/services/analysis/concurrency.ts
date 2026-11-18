import { ORPCError } from "@orpc/server";

/**
 * Concurrent `analysis.find` / `analysis.read` calls. One 30-day find can issue
 * dozens of ClickHouse statements on the shared cluster, so neither one user
 * nor a burst of users may fan out without bound. A call waits briefly for a
 * slot, then fails with a retryable message the agent can act on. Every call is
 * bounded by the analysis deadline, so slots always come back.
 */
export const ANALYSIS_CONCURRENCY_LIMITS: AnalysisConcurrencyLimits = {
	perUser: 2,
	perProcess: 4,
	// Longer than a slow find (p90 about 12 s in the load test), so a third parallel call usually gets a slot.
	waitMs: 30_000,
};

export interface AnalysisConcurrencyLimits {
	readonly perUser: number;
	readonly perProcess: number;
	/** How long a call waits for a free slot before failing. */
	readonly waitMs: number;
}

interface Waiter {
	readonly userId: string;
	grant(): void;
}

export function createAnalysisLimiter(limits: AnalysisConcurrencyLimits) {
	const activeByUser = new Map<string, number>();
	let active = 0;
	const waiters: Waiter[] = [];

	async function run<T>(
		userId: string,
		work: () => Promise<T>,
		signal: AbortSignal | undefined,
	): Promise<T> {
		await acquire(userId, signal);
		try {
			return await work();
		} finally {
			release(userId);
		}
	}

	function acquire(userId: string, signal: AbortSignal | undefined) {
		signal?.throwIfAborted();
		if (canStart(userId)) {
			take(userId);
			return Promise.resolve();
		}
		return new Promise<void>((resolve, reject) => {
			const waiter: Waiter = {
				userId,
				grant: () => {
					leave();
					take(userId);
					resolve();
				},
			};
			const onAbort = () => {
				leave();
				reject(signal?.reason);
			};
			const timer = setTimeout(() => {
				leave();
				reject(busyError(userId));
			}, limits.waitMs);
			const leave = () => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				waiters.splice(waiters.indexOf(waiter), 1);
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			waiters.push(waiter);
		});
	}

	function release(userId: string) {
		active -= 1;
		const remaining = (activeByUser.get(userId) ?? 1) - 1;
		if (remaining > 0) activeByUser.set(userId, remaining);
		else activeByUser.delete(userId);
		for (const waiter of [...waiters]) {
			if (canStart(waiter.userId)) waiter.grant();
		}
	}

	function canStart(userId: string) {
		return (
			active < limits.perProcess &&
			(activeByUser.get(userId) ?? 0) < limits.perUser
		);
	}

	function take(userId: string) {
		active += 1;
		activeByUser.set(userId, (activeByUser.get(userId) ?? 0) + 1);
	}

	function busyError(userId: string) {
		const message =
			(activeByUser.get(userId) ?? 0) >= limits.perUser
				? `${limits.perUser} analysis calls (find/read) are already running for you; wait for them to finish, then retry this call.`
				: "Opaline is running too many analysis calls (find/read) right now; wait a few seconds, then retry this call.";
		return new ORPCError("TOO_MANY_REQUESTS", { message });
	}

	return { run };
}

/** The process-wide limiter shared by the oRPC procedures and the MCP tools. */
export const analysisLimiter = createAnalysisLimiter(
	ANALYSIS_CONCURRENCY_LIMITS,
);
