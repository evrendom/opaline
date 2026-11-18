import { isSelfHosted } from "../lib/self-hosted.js";

export interface IngestPhaseTotal {
	readonly count: number;
	readonly totalMs: number;
	readonly maxMs: number;
}

const totals = new Map<string, IngestPhaseTotal>();
const MAX_PHASES = 64;

export function recordIngestPhase(phase: string, ms: number): void {
	if (!isSelfHosted()) return;
	const current = totals.get(phase);
	if (!current && totals.size >= MAX_PHASES) return;
	totals.set(phase, {
		count: (current?.count ?? 0) + 1,
		totalMs: (current?.totalMs ?? 0) + ms,
		maxMs: Math.max(current?.maxMs ?? 0, ms),
	});
}

export async function timedIngestPhase<T>(
	phase: string,
	work: () => Promise<T>,
): Promise<T> {
	if (!isSelfHosted()) return work();
	const startedAt = performance.now();
	try {
		return await work();
	} finally {
		recordIngestPhase(phase, performance.now() - startedAt);
	}
}

export function readIngestPhaseTotals(): Record<string, IngestPhaseTotal> {
	return Object.fromEntries(
		[...totals.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([phase, total]) => [
				phase,
				{
					count: total.count,
					totalMs: Math.round(total.totalMs),
					maxMs: Math.round(total.maxMs),
				},
			]),
	);
}

export function resetIngestPhaseTotals(): void {
	totals.clear();
}

export function mergeIngestPhaseTotals(
	measured: Readonly<Record<string, IngestPhaseTotal>>,
): void {
	if (!isSelfHosted()) return;
	for (const [phase, total] of Object.entries(measured)) {
		const current = totals.get(phase);
		if (!current && totals.size >= MAX_PHASES) continue;
		totals.set(phase, {
			count: (current?.count ?? 0) + total.count,
			totalMs: (current?.totalMs ?? 0) + total.totalMs,
			maxMs: Math.max(current?.maxMs ?? 0, total.maxMs),
		});
	}
}
