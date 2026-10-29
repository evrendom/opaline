export type DiffLine = { kind: "same" | "deletion" | "addition"; text: string };

const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
	const a = before.split("\n");
	const b = after.split("\n");
	if (a.length * b.length > MAX_CELLS)
		return [
			...a.map((text): DiffLine => ({ kind: "deletion", text })),
			...b.map((text): DiffLine => ({ kind: "addition", text })),
		];
	const lengths = Array.from(
		{ length: a.length + 1 },
		() => new Uint32Array(b.length + 1),
	);
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			(lengths[i] as Uint32Array)[j] =
				a[i] === b[j]
					? ((lengths[i + 1] as Uint32Array)[j + 1] ?? 0) + 1
					: Math.max(
							(lengths[i + 1] as Uint32Array)[j] ?? 0,
							(lengths[i] as Uint32Array)[j + 1] ?? 0,
						);
	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			out.push({ kind: "same", text: a[i] ?? "" });
			i++;
			j++;
		} else if (
			((lengths[i + 1] as Uint32Array)[j] ?? 0) >=
			((lengths[i] as Uint32Array)[j + 1] ?? 0)
		) {
			out.push({ kind: "deletion", text: a[i] ?? "" });
			i++;
		} else {
			out.push({ kind: "addition", text: b[j] ?? "" });
			j++;
		}
	}
	for (; i < a.length; i++) out.push({ kind: "deletion", text: a[i] ?? "" });
	for (; j < b.length; j++) out.push({ kind: "addition", text: b[j] ?? "" });
	return out;
}

export function changedHunks(
	lines: readonly DiffLine[],
	context = 1,
): (DiffLine | null)[] {
	const keep = lines.map((line) => line.kind !== "same");
	const near = lines.map((_, index) => {
		for (
			let k = Math.max(0, index - context);
			k <= Math.min(lines.length - 1, index + context);
			k++
		)
			if (keep[k]) return true;
		return false;
	});
	const out: (DiffLine | null)[] = [];
	for (const [index, line] of lines.entries()) {
		if (near[index]) out.push(line);
		else if (out.at(-1) !== null) out.push(null);
	}
	return out;
}
