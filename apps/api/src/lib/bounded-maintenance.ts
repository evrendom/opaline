export interface MaintenancePassResult {
	readonly hasMore: boolean;
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

export async function drainMaintenancePasses<
	TResult extends MaintenancePassResult,
>(input: {
	readonly deadlineAt: number;
	readonly maxIterations: number;
	readonly now: () => number;
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
		input.now() < input.deadlineAt
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

	return {
		hasMore,
		iterations: results.length,
		results,
		stopReason,
	};
}
