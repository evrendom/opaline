export interface SchedulerClock {
	readonly now: () => number;
	readonly sleep: (milliseconds: number) => Promise<void>;
}

export interface ScheduledStart {
	readonly actualStartMs: number;
	readonly index: number;
	readonly plannedStartMs: number;
	readonly scheduleDriftMs: number;
}

export interface ScheduledOperationResult<TValue> extends ScheduledStart {
	readonly value: TValue;
}

interface OpenLoopScheduleOptions {
	readonly maxInFlight: number;
	readonly operationCount: number;
	readonly ratePerSecond: number;
}

const REAL_CLOCK: SchedulerClock = {
	now: () => performance.now(),
	sleep: (milliseconds) => Bun.sleep(milliseconds),
};

export async function scheduleOpenLoop<TValue>(
	options: OpenLoopScheduleOptions,
	operation: (start: ScheduledStart) => Promise<TValue>,
	clock: SchedulerClock = REAL_CLOCK,
): Promise<readonly ScheduledOperationResult<TValue>[]> {
	validateScheduleOptions(options);
	const epochMs = clock.now();
	const results: Array<ScheduledOperationResult<TValue> | undefined> =
		Array.from({ length: options.operationCount });
	const failures: Array<{ readonly error: unknown } | undefined> = Array.from({
		length: options.operationCount,
	});
	const inFlight = new Set<Promise<void>>();
	const allOperations: Promise<void>[] = [];

	for (let index = 0; index < options.operationCount; index += 1) {
		const plannedStartMs = calculatePlannedStartMs(
			epochMs,
			index,
			options.ratePerSecond,
		);
		const waitMs = plannedStartMs - clock.now();
		if (waitMs > 0) await clock.sleep(waitMs);
		if (inFlight.size >= options.maxInFlight) {
			await Promise.race(inFlight);
		}

		const actualStartMs = clock.now();
		const start: ScheduledStart = {
			actualStartMs,
			index,
			plannedStartMs,
			scheduleDriftMs: actualStartMs - plannedStartMs,
		};
		let task: Promise<void>;
		task = operation(start)
			.then(
				(value) => {
					results[index] = { ...start, value };
				},
				(error: unknown) => {
					failures[index] = { error };
				},
			)
			.finally(() => inFlight.delete(task));
		inFlight.add(task);
		allOperations.push(task);
	}

	await Promise.all(allOperations);
	const failure = failures.find((item) => item !== undefined);
	if (failure !== undefined) throw failure.error;
	return results.map((result) => {
		if (result === undefined) {
			throw new Error("Scheduled operation result is missing");
		}
		return result;
	});
}

export function calculatePlannedStartMs(
	epochMs: number,
	index: number,
	ratePerSecond: number,
): number {
	if (!Number.isFinite(epochMs)) {
		throw new Error("Schedule epoch must be finite");
	}
	if (!Number.isSafeInteger(index) || index < 0) {
		throw new Error("Schedule index must be a non-negative integer");
	}
	if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) {
		throw new Error("Schedule rate must be positive");
	}
	return epochMs + (index * 1_000) / ratePerSecond;
}

function validateScheduleOptions(options: OpenLoopScheduleOptions): void {
	if (
		!Number.isSafeInteger(options.operationCount) ||
		options.operationCount < 1
	) {
		throw new Error("Operation count must be a positive integer");
	}
	if (!Number.isSafeInteger(options.maxInFlight) || options.maxInFlight < 1) {
		throw new Error("Maximum in-flight operations must be a positive integer");
	}
	calculatePlannedStartMs(0, 0, options.ratePerSecond);
}
