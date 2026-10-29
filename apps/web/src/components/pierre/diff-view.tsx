// Adapted from pierre (github.com/pierrecomputer/pierre, Apache-2.0): the
// unified layout of its diffs package (DiffHunksRenderer, FileDiff), drawn in
// the app's own idiom — tinted rows on the card, one line-number column, a
// +/− mark — and highlighted by the app's own shiki worker.
import {
	type CSSProperties,
	type ReactNode,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";
import { useTheme } from "@/app/providers/ThemeProvider";
import { usePreparedCodeHighlight } from "@/components/conversation/code-highlight-cache";
import type {
	PreparedCodeHighlight,
	PreparedCodeToken,
} from "@/components/conversation/code-highlight-types";
import { cn } from "@/lib/utils";
import type { DiffHunk, DiffLine } from "./line-diff";

export const LANGUAGE_BY_EXTENSION: Record<string, string> = {
	bash: "shellscript",
	c: "c",
	cc: "cpp",
	cjs: "javascript",
	cpp: "cpp",
	css: "css",
	cts: "typescript",
	cxx: "cpp",
	go: "go",
	h: "c",
	hpp: "cpp",
	htm: "html",
	html: "html",
	java: "java",
	js: "javascript",
	json: "json",
	jsonc: "jsonc",
	jsonl: "json",
	jsx: "jsx",
	kt: "kotlin",
	kts: "kotlin",
	md: "markdown",
	mjs: "javascript",
	mts: "typescript",
	php: "php",
	py: "python",
	rb: "ruby",
	rs: "rust",
	sh: "shellscript",
	sql: "sql",
	swift: "swift",
	toml: "toml",
	ts: "typescript",
	tsx: "tsx",
	yaml: "yaml",
	yml: "yaml",
	zsh: "shellscript",
};

export function languageForPath(path: string): string | null {
	const name = path.split(/[\\/]/).at(-1) ?? path;
	const dot = name.lastIndexOf(".");
	if (dot <= 0) return null;
	return LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}

function unmodifiedLinesLabel(lines: number) {
	return `${lines} unchanged line${lines === 1 ? "" : "s"}`;
}

function sideSources(hunks: readonly DiffHunk[]) {
	const oldLines: string[] = [];
	const newLines: string[] = [];
	const slots: number[][] = [];
	let maxNumber = 0;
	for (const hunk of hunks) {
		const hunkSlots: number[] = [];
		for (const line of hunk.lines) {
			if (line.kind === "removed") {
				hunkSlots.push(-(oldLines.length + 1));
				oldLines.push(line.text);
			} else {
				if (line.kind === "context") oldLines.push(line.text);
				hunkSlots.push(newLines.length);
				newLines.push(line.text);
			}
			maxNumber = Math.max(maxNumber, line.oldNumber ?? 0, line.newNumber ?? 0);
		}
		slots.push(hunkSlots);
	}
	return {
		oldCode: oldLines.join("\n"),
		newCode: newLines.join("\n"),
		slots,
		digits: String(maxNumber).length,
	};
}

function hiddenLinesBetween(previous: DiffHunk, next: DiffHunk) {
	const previousEnd =
		previous.newLines === 0
			? previous.newStart + 1
			: previous.newStart + previous.newLines;
	const nextStart = next.newLines === 0 ? next.newStart + 1 : next.newStart;
	return nextStart - previousEnd;
}

function tokenStyle(token: PreparedCodeToken): CSSProperties | undefined {
	const fontStyle = token.fontStyle ?? 0;
	const decoration = [
		fontStyle & 4 ? "underline" : undefined,
		fontStyle & 8 ? "line-through" : undefined,
	]
		.filter(Boolean)
		.join(" ");
	if (!token.color && !(fontStyle & 1) && !decoration) return undefined;
	return {
		color: token.color,
		fontStyle: fontStyle & 1 ? "italic" : undefined,
		textDecoration: decoration || undefined,
	};
}

function lineContent(
	text: string,
	tokens: readonly PreparedCodeToken[] | undefined,
	marks: DiffLine["marks"],
	markClass: string,
): ReactNode {
	let tokenLength = 0;
	for (const token of tokens ?? []) tokenLength += token.content.length;
	const pieces =
		tokens && tokenLength === text.length
			? tokens
			: [{ color: undefined, content: text, fontStyle: undefined, offset: 0 }];
	if (!marks?.length && pieces.length === 1 && !pieces[0].color) return text;

	const starts: number[] = [];
	let offset = 0;
	for (const piece of pieces) {
		starts.push(offset);
		offset += piece.content.length;
	}
	let pieceIndex = 0;
	const range = (from: number, to: number) => {
		const out: ReactNode[] = [];
		while (pieceIndex < pieces.length && starts[pieceIndex] < to) {
			const piece = pieces[pieceIndex];
			const start = starts[pieceIndex];
			const end = start + piece.content.length;
			const sliceFrom = Math.max(from, start);
			const sliceTo = Math.min(to, end);
			if (sliceTo > sliceFrom) {
				out.push(
					<span key={sliceFrom} style={tokenStyle(piece)}>
						{piece.content.slice(sliceFrom - start, sliceTo - start)}
					</span>,
				);
			}
			if (end > to) break;
			pieceIndex++;
		}
		return out;
	};

	const out: ReactNode[] = [];
	let position = 0;
	for (const [start, end] of marks ?? []) {
		if (start > position) out.push(...range(position, start));
		out.push(
			<span key={`mark-${start}`} className={markClass}>
				{range(start, end)}
			</span>,
		);
		position = end;
	}
	if (position < text.length) out.push(...range(position, text.length));
	return out;
}

const LINE_LOOK: Record<
	DiffLine["kind"],
	{ mark: string; row: string; sign: string; signColor: string }
> = {
	added: {
		mark: "rounded-[3px] bg-green-500/20 box-decoration-clone",
		row: "bg-green-500/10",
		sign: "+",
		signColor: "text-green-600 dark:text-green-400",
	},
	context: { mark: "", row: "", sign: " ", signColor: "" },
	removed: {
		mark: "rounded-[3px] bg-red-500/20 box-decoration-clone",
		row: "bg-red-500/10",
		sign: "−",
		signColor: "text-red-600 dark:text-red-400",
	},
};

type Row =
	| { hidden: number; hunk: number; kind: "separator" }
	| { hunk: number; kind: "line"; line: number };

const LINE_PX = 17.875;
const SEPARATOR_PX = LINE_PX + 8;

function rowsOf(hunks: readonly DiffHunk[]) {
	const rows: Row[] = [];
	for (let hunk = 0; hunk < hunks.length; hunk++) {
		const previous = hunks[hunk - 1];
		const hidden = previous ? hiddenLinesBetween(previous, hunks[hunk]) : 0;
		if (hidden > 0) rows.push({ hidden, hunk, kind: "separator" });
		for (let line = 0; line < hunks[hunk].lines.length; line++)
			rows.push({ hunk, kind: "line", line });
	}
	const tops: number[] = [];
	let total = 0;
	for (const row of rows) {
		tops.push(total);
		total += row.kind === "separator" ? SEPARATOR_PX : LINE_PX;
	}
	return { rows, tops, total };
}

function renderRow(
	row: Row,
	hunks: readonly DiffHunk[],
	slots: readonly (readonly number[])[],
	oldHighlight: PreparedCodeHighlight | null,
	newHighlight: PreparedCodeHighlight | null,
	numberStyle: CSSProperties,
): ReactNode {
	const hunk = hunks[row.hunk];
	if (row.kind === "separator")
		return (
			<div
				key={`separator-${hunk.oldStart}-${hunk.newStart}`}
				className="flex gap-2 px-1.5 py-1 text-muted-foreground/70 italic"
			>
				<span className="shrink-0" style={numberStyle} />
				<span className="w-2 shrink-0" />
				<span>⋯ {unmodifiedLinesLabel(row.hidden)}</span>
			</div>
		);
	const line = hunk.lines[row.line];
	const slot = slots[row.hunk][row.line];
	const tokens =
		slot < 0 ? oldHighlight?.lines[-slot - 1] : newHighlight?.lines[slot];
	const look = LINE_LOOK[line.kind];
	const changed = line.kind !== "context";
	const opens = changed && hunk.lines[row.line - 1]?.kind !== line.kind;
	const closes = changed && hunk.lines[row.line + 1]?.kind !== line.kind;
	return (
		<div
			key={`${line.oldNumber ?? ""}:${line.newNumber ?? ""}`}
			className={cn(
				"flex min-h-[1.2em] gap-2 px-1.5",
				look.row,
				opens && "rounded-t-md",
				closes && "rounded-b-md",
			)}
		>
			<span
				className="shrink-0 text-right text-muted-foreground/50 tabular-nums select-none"
				style={numberStyle}
			>
				{line.kind === "removed" ? line.oldNumber : line.newNumber}
			</span>
			<span
				className={cn(
					"w-2 shrink-0 text-muted-foreground/70 select-none",
					look.signColor,
				)}
			>
				{look.sign}
			</span>
			<span className="whitespace-pre">
				{lineContent(line.text, tokens, line.marks, look.mark)}
			</span>
		</div>
	);
}

const WINDOWED_ROWS = 300;
const OVERSCAN_ROWS = 80;

function rowAtY(tops: readonly number[], y: number): number {
	let low = 0;
	let high = tops.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if (tops[middle] <= y) low = middle;
		else high = middle - 1;
	}
	return low;
}

function useRowWindow(
	node: HTMLElement | null,
	tops: readonly number[],
): { from: number; to: number } {
	const count = tops.length;
	const windowed = count > WINDOWED_ROWS;
	const [range, setRange] = useState(() => ({
		from: 0,
		to: windowed ? Math.min(count, OVERSCAN_ROWS * 2) : count,
	}));
	useLayoutEffect(() => {
		if (!windowed) {
			setRange({ from: 0, to: count });
			return;
		}
		if (!node) return;
		const root = node.closest<HTMLElement>("[data-lazy-root]");
		const place = () => {
			const top = node.getBoundingClientRect().top;
			const viewTop = root ? root.getBoundingClientRect().top : 0;
			const viewHeight = root ? root.clientHeight : window.innerHeight;
			const first = rowAtY(tops, Math.max(viewTop - top, 0));
			const last = rowAtY(tops, Math.max(viewTop - top + viewHeight, 0));
			const from = Math.max(
				Math.floor((first - OVERSCAN_ROWS) / OVERSCAN_ROWS) * OVERSCAN_ROWS,
				0,
			);
			const to = Math.min(
				Math.ceil((last + OVERSCAN_ROWS) / OVERSCAN_ROWS) * OVERSCAN_ROWS,
				count,
			);
			setRange((current) =>
				current.from === from && current.to === to ? current : { from, to },
			);
		};
		place();
		const target: HTMLElement | Window = root ?? window;
		target.addEventListener("scroll", place, { passive: true });
		const resize = new ResizeObserver(place);
		resize.observe(root ?? document.documentElement);
		return () => {
			target.removeEventListener("scroll", place);
			resize.disconnect();
		};
	}, [node, tops, count, windowed]);
	return range;
}

const focusableScrollRegionProps = { tabIndex: 0 } as const;

export function DiffView({
	hunks,
	language,
	className,
}: {
	hunks: readonly DiffHunk[];
	language: string | null;
	className?: string;
}) {
	const { resolvedTheme } = useTheme();
	const theme = resolvedTheme === "dark" ? "dark" : "light";
	const sources = useMemo(() => sideSources(hunks), [hunks]);
	const oldHighlight = usePreparedCodeHighlight({
		enabled: language !== null && sources.oldCode !== "",
		code: sources.oldCode,
		language: language ?? "text",
		theme,
	});
	const newHighlight = usePreparedCodeHighlight({
		enabled: language !== null && sources.newCode !== "",
		code: sources.newCode,
		language: language ?? "text",
		theme,
	});
	const layout = useMemo(() => rowsOf(hunks), [hunks]);
	const widest = useMemo(() => {
		let most = 0;
		for (const hunk of hunks)
			for (const line of hunk.lines) most = Math.max(most, line.text.length);
		return most;
	}, [hunks]);
	const [node, setNode] = useState<HTMLElement | null>(null);
	const { from, to } = useRowWindow(node, layout.tops);
	const rows = useMemo(() => {
		const numberStyle = { width: `${sources.digits}ch` };
		return layout.rows
			.slice(from, to)
			.map((row) =>
				renderRow(
					row,
					hunks,
					sources.slots,
					oldHighlight,
					newHighlight,
					numberStyle,
				),
			);
	}, [hunks, layout, sources, oldHighlight, newHighlight, from, to]);
	if (hunks.length === 0) return null;
	const windowed = from > 0 || to < layout.rows.length;
	return (
		<section
			ref={setNode}
			{...focusableScrollRegionProps}
			aria-label="Diff"
			className={cn(
				"-mx-1.5 overflow-x-auto font-mono text-[11px] leading-relaxed outline-none",
				className,
			)}
		>
			<div
				className="w-max min-w-full"
				style={
					windowed
						? {
								minWidth: `max(100%, calc(${sources.digits + widest + 3}ch + 1.75rem))`,
								paddingBottom: layout.total - (layout.tops[to] ?? layout.total),
								paddingTop: layout.tops[from] ?? 0,
							}
						: undefined
				}
			>
				{rows}
			</div>
		</section>
	);
}
