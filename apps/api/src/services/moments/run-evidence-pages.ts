export interface RunEvidencePages {
	read<T>(key: string, offset: number, load: () => Promise<T>): Promise<T>;
}

export function createRunEvidencePages(options: {
	readonly reuseMs: number;
	readonly maxEntries: number;
	readonly now?: () => number;
}): RunEvidencePages {
	const now = options.now ?? Date.now;
	const entries = new Map<string, { at: number; value: Promise<unknown> }>();
	return {
		read<T>(key: string, offset: number, load: () => Promise<T>): Promise<T> {
			const at = now();
			for (const [held, entry] of entries)
				if (at - entry.at >= options.reuseMs) entries.delete(held);
			const held = entries.get(key);
			if (offset > 0 && held) return held.value as Promise<T>;
			const value = load();
			entries.delete(key);
			entries.set(key, { at, value });
			for (const oldest of entries.keys()) {
				if (entries.size <= options.maxEntries) break;
				entries.delete(oldest);
			}
			value.catch(() => {
				if (entries.get(key)?.value === value) entries.delete(key);
			});
			return value;
		},
	};
}

export const runEvidencePages = createRunEvidencePages({
	reuseMs: 60_000,
	maxEntries: 8,
});
