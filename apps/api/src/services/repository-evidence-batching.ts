export const EVIDENCE_SQL_BATCH_SIZE = 1_000;
export const EVIDENCE_R2_CONCURRENCY = 32;
export const EVIDENCE_R2_CREATION_TIMEOUT_MS = 60_000;

export function evidenceSqlBatches<TItem>(items: readonly TItem[]): TItem[][] {
	const batches: TItem[][] = [];
	for (
		let offset = 0;
		offset < items.length;
		offset += EVIDENCE_SQL_BATCH_SIZE
	) {
		batches.push(items.slice(offset, offset + EVIDENCE_SQL_BATCH_SIZE));
	}
	return batches;
}

export async function mapEvidenceStorage<TItem, TResult>(
	items: readonly TItem[],
	operation: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
	const results: TResult[] = [];
	for (
		let offset = 0;
		offset < items.length;
		offset += EVIDENCE_R2_CONCURRENCY
	) {
		const settled = await Promise.allSettled(
			items.slice(offset, offset + EVIDENCE_R2_CONCURRENCY).map(operation),
		);
		const failure = settled.find((result) => result.status === "rejected");
		if (failure?.status === "rejected") throw failure.reason;
		for (const result of settled) {
			if (result.status === "fulfilled") results.push(result.value);
		}
	}
	return results;
}
