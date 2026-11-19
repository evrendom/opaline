function resolveNonnegativeInteger(
	value: number | null | undefined,
	fallback: number,
) {
	return Number.isInteger(value) &&
		value !== undefined &&
		value !== null &&
		value >= 0
		? value
		: fallback;
}

export function resolveSessionSubagentCount(
	subagentCount: number | null | undefined,
	subagentTypes: readonly string[] | undefined,
	linkedSubagentCount?: number | null,
	linkedSubagents?: readonly unknown[],
) {
	return (
		resolveSessionNativeSubagentCount(subagentCount, subagentTypes) +
		resolveNonnegativeInteger(linkedSubagentCount, linkedSubagents?.length ?? 0)
	);
}

export function resolveSessionNativeSubagentCount(
	subagentCount: number | null | undefined,
	subagentTypes: readonly string[] | undefined,
) {
	return resolveNonnegativeInteger(subagentCount, subagentTypes?.length ?? 0);
}

export function resolveSessionErrorCount(
	errorCount: number | null | undefined,
) {
	const count = resolveNonnegativeInteger(errorCount, -1);
	return count === -1 ? null : count;
}
