export function literalPatchHunks(diff: string): {
	hunks: Record<string, string | null>[];
	more: number;
} {
	const hunks: Record<string, string | null>[] = [];
	let more = 0;
	let start = 0;
	while (start < diff.length) {
		const newline = diff.indexOf("\n", start);
		const end = newline === -1 ? diff.length : newline;
		const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(
			diff.slice(start, end),
		);
		if (match !== null) {
			if (hunks.length >= 1_024) more++;
			else
				hunks.push({
					old_start: match[1] ?? null,
					old_count: match[2] ?? null,
					new_start: match[3] ?? null,
					new_count: match[4] ?? null,
				});
		}
		start = end + 1;
	}
	return { hunks, more };
}
