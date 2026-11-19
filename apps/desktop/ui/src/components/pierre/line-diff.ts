// Adapted from pierre (github.com/pierrecomputer/pierre, Apache-2.0): the
// hunk shape and the word-level emphasis rules ("word-alt") follow its diffs
// package; the line diff itself is a dependency-free Myers implementation
// because pierre leans on the `diff` package, which we cannot add.

export type DiffLineKind = "context" | "added" | "removed";
export type DiffLine = {
	kind: DiffLineKind;
	oldNumber: number | null;
	newNumber: number | null;
	text: string;
	marks?: readonly (readonly [number, number])[];
};
export type DiffHunk = {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: DiffLine[];
};

const EQUAL = 0;
const DELETE = 1;
const INSERT = 2;
type EditOp = typeof EQUAL | typeof DELETE | typeof INSERT;

const MAX_LINE_EDIT_DISTANCE = 1_500;
const MAX_LINE_WORK = 40_000_000;
const MAX_TOKEN_EDIT_DISTANCE = 200;
const MAX_MARKED_LINE_LENGTH = 1_000;

function shortestEdit(
	a: ArrayLike<number>,
	b: ArrayLike<number>,
	maxDistance: number,
	maxWork: number,
): EditOp[] | null {
	const n = a.length;
	const m = b.length;
	const max = n + m;
	const limit = Math.min(max, maxDistance, Math.floor(maxWork / (max || 1)));
	const offset = max + 1;
	const v = new Int32Array(2 * max + 3);
	const trace: Int32Array[] = [];
	let found = -1;
	for (let d = 0; d <= limit && found < 0; d++) {
		trace.push(v.slice(offset - d, offset + d + 1));
		for (let k = -d; k <= d; k += 2) {
			let x =
				k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
					? v[offset + k + 1]
					: v[offset + k - 1] + 1;
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x++;
				y++;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) {
				found = d;
				break;
			}
		}
	}
	if (found < 0) return null;

	const ops: EditOp[] = [];
	let x = n;
	let y = m;
	for (let d = found; d > 0; d--) {
		const frontier = trace[d];
		const at = (k: number) => frontier[k + d];
		const k = x - y;
		const prevK =
			k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
		const prevX = at(prevK);
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) {
			ops.push(EQUAL);
			x--;
			y--;
		}
		ops.push(x === prevX ? INSERT : DELETE);
		x = prevX;
		y = prevY;
	}
	while (x > 0 && y > 0) {
		ops.push(EQUAL);
		x--;
		y--;
	}
	return ops.reverse();
}

function intern(
	aItems: readonly string[],
	bItems: readonly string[],
): [Int32Array, Int32Array] {
	const ids = new Map<string, number>();
	const toIds = (items: readonly string[]) => {
		const out = new Int32Array(items.length);
		for (let i = 0; i < items.length; i++) {
			let id = ids.get(items[i]);
			if (id === undefined) {
				id = ids.size;
				ids.set(items[i], id);
			}
			out[i] = id;
		}
		return out;
	};
	return [toIds(aItems), toIds(bItems)];
}

function diffSequences(
	aItems: readonly string[],
	bItems: readonly string[],
	maxDistance: number,
	maxWork: number,
): EditOp[] {
	const [a, b] = intern(aItems, bItems);
	let prefix = 0;
	while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
		prefix++;
	}
	let suffix = 0;
	while (
		suffix < a.length - prefix &&
		suffix < b.length - prefix &&
		a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
	) {
		suffix++;
	}
	const aMid = a.subarray(prefix, a.length - suffix);
	const bMid = b.subarray(prefix, b.length - suffix);
	const middle = shortestEdit(aMid, bMid, maxDistance, maxWork) ?? [
		...new Array<EditOp>(aMid.length).fill(DELETE),
		...new Array<EditOp>(bMid.length).fill(INSERT),
	];
	const ops = new Array<EditOp>(prefix).fill(EQUAL);
	for (const op of middle) ops.push(op);
	for (let i = 0; i < suffix; i++) ops.push(EQUAL);
	return ops;
}

function splitLines(text: string): string[] {
	if (text === "") return [];
	const lines = text.split(/\r?\n/);
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

const TOKEN_PATTERN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

type Segment = { changed: boolean; start: number; end: number };

function sideSegments(
	tokens: readonly string[],
	ops: readonly EditOp[],
	changeOp: EditOp,
): Segment[] {
	const runs: Segment[] = [];
	let tokenIndex = 0;
	let offset = 0;
	for (const op of ops) {
		if (op !== EQUAL && op !== changeOp) continue;
		const length = tokens[tokenIndex++].length;
		const changed = op === changeOp;
		const last = runs.at(-1);
		if (last && last.changed === changed) last.end += length;
		else runs.push({ changed, start: offset, end: offset + length });
		offset += length;
	}
	const joined: Segment[] = [];
	for (let i = 0; i < runs.length; i++) {
		const run = runs[i];
		const last = joined.at(-1);
		const isLast = i === runs.length - 1;
		const absorbs =
			last?.changed && !isLast && (run.changed || run.end - run.start === 1);
		if (last && absorbs) last.end = run.end;
		else joined.push({ ...run });
	}
	return joined;
}

function wordMarks(
	oldText: string,
	newText: string,
): [[number, number][], [number, number][]] | null {
	if (
		oldText.length > MAX_MARKED_LINE_LENGTH ||
		newText.length > MAX_MARKED_LINE_LENGTH
	) {
		return null;
	}
	const oldTokens = oldText.match(TOKEN_PATTERN) ?? [];
	const newTokens = newText.match(TOKEN_PATTERN) ?? [];
	const ops = diffSequences(
		oldTokens,
		newTokens,
		MAX_TOKEN_EDIT_DISTANCE,
		Number.POSITIVE_INFINITY,
	);
	let sharesWord = false;
	let tokenIndex = 0;
	for (const op of ops) {
		if (op === INSERT) continue;
		if (op === EQUAL && /\S/.test(oldTokens[tokenIndex])) sharesWord = true;
		tokenIndex++;
	}
	if (!sharesWord) return null;
	const toMarks = (segments: Segment[]) =>
		segments
			.filter((segment) => segment.changed && segment.end > segment.start)
			.map((segment): [number, number] => [segment.start, segment.end]);
	return [
		toMarks(sideSegments(oldTokens, ops, DELETE)),
		toMarks(sideSegments(newTokens, ops, INSERT)),
	];
}

function allLines(
	oldLines: readonly string[],
	newLines: readonly string[],
	lineOffset: number,
): DiffLine[] {
	const ops = diffSequences(
		oldLines,
		newLines,
		MAX_LINE_EDIT_DISTANCE,
		MAX_LINE_WORK,
	);
	const lines: DiffLine[] = [];
	let oldIndex = 0;
	let newIndex = 0;
	let removed: DiffLine[] = [];
	let added: DiffLine[] = [];
	const flush = () => {
		const pairs = Math.min(removed.length, added.length);
		for (let i = 0; i < pairs; i++) {
			const marks = wordMarks(removed[i].text, added[i].text);
			if (!marks) continue;
			removed[i].marks = marks[0];
			added[i].marks = marks[1];
		}
		for (const line of removed) lines.push(line);
		for (const line of added) lines.push(line);
		removed = [];
		added = [];
	};
	for (const op of ops) {
		if (op === EQUAL) {
			flush();
			lines.push({
				kind: "context",
				oldNumber: oldIndex + lineOffset,
				newNumber: newIndex + lineOffset,
				text: newLines[newIndex],
			});
			oldIndex++;
			newIndex++;
		} else if (op === DELETE) {
			removed.push({
				kind: "removed",
				oldNumber: oldIndex + lineOffset,
				newNumber: null,
				text: oldLines[oldIndex],
			});
			oldIndex++;
		} else {
			added.push({
				kind: "added",
				oldNumber: null,
				newNumber: newIndex + lineOffset,
				text: newLines[newIndex],
			});
			newIndex++;
		}
	}
	flush();
	return lines;
}

function toHunk(
	lines: readonly DiffLine[],
	start: number,
	end: number,
	lineOffset: number,
): DiffHunk {
	const slice = lines.slice(start, end);
	const before = (side: "oldNumber" | "newNumber") => {
		let count = 0;
		for (let i = 0; i < start; i++) if (lines[i][side] !== null) count++;
		return count + lineOffset - 1;
	};
	const oldNumbers = slice.filter((line) => line.oldNumber !== null);
	const newNumbers = slice.filter((line) => line.newNumber !== null);
	return {
		oldStart: oldNumbers[0]?.oldNumber ?? before("oldNumber"),
		oldLines: oldNumbers.length,
		newStart: newNumbers[0]?.newNumber ?? before("newNumber"),
		newLines: newNumbers.length,
		lines: slice,
	};
}

export function diffLines(
	oldText: string,
	newText: string,
	options?: { context?: number; lineOffset?: number },
): DiffHunk[] {
	const context = Math.max(0, options?.context ?? 3);
	const lineOffset = options?.lineOffset ?? 1;
	const lines = allLines(splitLines(oldText), splitLines(newText), lineOffset);
	const hunks: DiffHunk[] = [];
	let hunkStart = -1;
	let lastChange = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].kind === "context") continue;
		if (hunkStart >= 0 && i - lastChange - 1 > 2 * context) {
			hunks.push(
				toHunk(lines, hunkStart, lastChange + context + 1, lineOffset),
			);
			hunkStart = -1;
		}
		if (hunkStart < 0) hunkStart = Math.max(0, i - context);
		lastChange = i;
	}
	if (hunkStart >= 0) {
		hunks.push(
			toHunk(
				lines,
				hunkStart,
				Math.min(lines.length, lastChange + context + 1),
				lineOffset,
			),
		);
	}
	return hunks;
}

export function countChanges(hunks: readonly DiffHunk[]): {
	added: number;
	removed: number;
} {
	let added = 0;
	let removed = 0;
	for (const hunk of hunks) {
		for (const line of hunk.lines) {
			if (line.kind === "added") added++;
			else if (line.kind === "removed") removed++;
		}
	}
	return { added, removed };
}
