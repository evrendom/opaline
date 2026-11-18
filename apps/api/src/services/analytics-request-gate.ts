export interface AnalyticsRequestGateOptions {
	readonly perScope: number;
	readonly total: number;
	readonly reuseMs: number;
	readonly maxEntries: number;
	readonly now?: () => number;
}

export interface AnalyticsRequestGate {
	run<T>(scope: string, key: string, work: () => Promise<T>): Promise<T>;
}

interface Entry {
	readonly promise: Promise<unknown>;
	settledAt: number | null;
}

export function createAnalyticsRequestGate(
	options: AnalyticsRequestGateOptions,
): AnalyticsRequestGate {
	const now = options.now ?? Date.now;
	const entries = new Map<string, Entry>();
	const running = new Map<string, number>();
	const waiting: Array<{ scope: string; start: () => void }> = [];
	let total = 0;

	const canStart = (scope: string) =>
		total < options.total && (running.get(scope) ?? 0) < options.perScope;
	const take = (scope: string) => {
		total++;
		running.set(scope, (running.get(scope) ?? 0) + 1);
	};
	const release = (scope: string) => {
		total--;
		const left = (running.get(scope) ?? 1) - 1;
		if (left > 0) running.set(scope, left);
		else running.delete(scope);
		for (let index = 0; index < waiting.length; ) {
			const next = waiting[index];
			if (next && canStart(next.scope)) {
				waiting.splice(index, 1);
				take(next.scope);
				next.start();
			} else index++;
		}
	};
	const acquire = async (scope: string) => {
		if (canStart(scope)) {
			take(scope);
			return;
		}
		await new Promise<void>((start) => waiting.push({ scope, start }));
	};
	const prune = () => {
		const at = now();
		for (const [key, entry] of entries)
			if (entry.settledAt !== null && at - entry.settledAt >= options.reuseMs)
				entries.delete(key);
		for (const [key, entry] of entries) {
			if (entries.size <= options.maxEntries) break;
			if (entry.settledAt !== null) entries.delete(key);
		}
	};

	return {
		run<T>(scope: string, key: string, work: () => Promise<T>): Promise<T> {
			prune();
			const existing = entries.get(key);
			if (existing) return existing.promise as Promise<T>;
			const promise = (async () => {
				await acquire(scope);
				try {
					return await work();
				} finally {
					release(scope);
				}
			})();
			const entry: Entry = { promise, settledAt: null };
			entries.set(key, entry);
			promise.then(
				() => {
					entry.settledAt = now();
					prune();
				},
				() => {
					if (entries.get(key) === entry) entries.delete(key);
				},
			);
			return promise;
		},
	};
}
