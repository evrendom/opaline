export interface MaintenancePassResult {
	readonly hasMore: boolean;
}

export interface MaintenanceDeadline {
	readonly deadlineAt: number;
	readonly now: () => number;
}

export type MaintenanceDrainStopReason =
	| "complete"
	| "deadline"
	| "max-iterations";

export interface MaintenanceDrainResult<TResult extends MaintenancePassResult> {
	readonly hasMore: boolean;
	readonly iterations: number;
	readonly results: readonly TResult[];
	readonly stopReason: MaintenanceDrainStopReason;
}

export function hasMaintenanceTimeRemaining(
	deadline: MaintenanceDeadline | undefined,
): boolean {
	return deadline === undefined || deadline.now() < deadline.deadlineAt;
}

export function createMaintenanceQueueDeadline(
	invocationDeadline: MaintenanceDeadline,
	queueBudgetMs: number,
): MaintenanceDeadline {
	if (!Number.isSafeInteger(queueBudgetMs) || queueBudgetMs < 1) {
		throw new Error("queueBudgetMs must be a positive safe integer");
	}

	return {
		deadlineAt: Math.min(
			invocationDeadline.deadlineAt,
			invocationDeadline.now() + queueBudgetMs,
		),
		now: invocationDeadline.now,
	};
}

export async function drainMaintenancePasses<
	TResult extends MaintenancePassResult,
>(input: {
	readonly deadline: MaintenanceDeadline;
	readonly maxIterations: number;
	readonly onIncomplete?: (result: MaintenanceDrainResult<TResult>) => void;
	readonly runPass: () => Promise<TResult>;
}): Promise<MaintenanceDrainResult<TResult>> {
	if (!Number.isSafeInteger(input.maxIterations) || input.maxIterations < 1) {
		throw new Error("maxIterations must be a positive safe integer");
	}

	const results: TResult[] = [];
	let hasMore = true;
	while (
		hasMore &&
		results.length < input.maxIterations &&
		hasMaintenanceTimeRemaining(input.deadline)
	) {
		const result = await input.runPass();
		results.push(result);
		hasMore = result.hasMore;
	}

	const stopReason: MaintenanceDrainStopReason = !hasMore
		? "complete"
		: results.length >= input.maxIterations
			? "max-iterations"
			: "deadline";

	const drain: MaintenanceDrainResult<TResult> = {
		hasMore,
		iterations: results.length,
		results,
		stopReason,
	};
	if (drain.hasMore) {
		input.onIncomplete?.(drain);
	}
	return drain;
}
