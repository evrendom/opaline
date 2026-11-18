import type { NumberedLine } from "./session-reader-output";

export type PrintRange = { start?: number; length?: number };

function address(
	text: string,
): { at: number } | { name: string; plus: number } | null {
	if (/^\d+$/u.test(text)) return { at: Number(text) };
	const name = /^\$\{?(\w+)\}?$/u.exec(text);
	if (name?.[1]) return { name: name[1], plus: 0 };
	const sum = /^\$\(\(\s*\$?(\w+)\s*\+\s*(\d+)\s*\)\)$/u.exec(text);
	if (sum?.[1] && sum[2]) return { name: sum[1], plus: Number(sum[2]) };
	return null;
}

export function printRange(step: {
	program: string;
	raw: string;
	stages?: unknown;
}): PrintRange {
	if (step.stages) return {};
	const { program, raw } = step;
	if (program === "cat") return { start: 1 };
	if (program === "head") {
		const count = /\s-n\s*(\d+)|\s-(\d+)\b/u.exec(raw);
		return { length: Number(count?.[1] ?? count?.[2] ?? 10), start: 1 };
	}
	if (program === "tail") {
		const from = /(?:-n\s*)?\+(\d+)/u.exec(raw);
		if (from) return { start: Number(from[1]) };
		const count = /\s-n\s*(\d+)|\s-(\d+)\b/u.exec(raw);
		return count ? { length: Number(count[1] ?? count[2]) } : {};
	}
	if (program !== "sed") return {};
	const script = /\s-n\s+(?:"([^"]+)"|'([^']+)'|(\S+))/u.exec(raw);
	const range = /^([^,]+?)(?:,(.+?))?p$/u.exec(
		script?.[1] ?? script?.[2] ?? script?.[3] ?? "",
	);
	if (!range?.[1]) return {};
	const from = address(range[1]);
	const to = range[2] ? address(range[2]) : from;
	if (!from || !to) return {};
	const start = "at" in from ? from.at : undefined;
	if ("at" in from && "at" in to) return { length: to.at - from.at + 1, start };
	if ("name" in from && "name" in to && from.name === to.name)
		return { length: to.plus - from.plus + 1, start };
	return { start };
}

const PLACES = 8;

function placed(
	block: readonly string[],
	byText: ReadonlyMap<string, number | null>,
): number | undefined {
	const votes = new Map<number, number>();
	block.forEach((text, index) => {
		const number = byText.get(text);
		if (number === undefined || number === null) return;
		votes.set(number - index, (votes.get(number - index) ?? 0) + 1);
	});
	let best: number | undefined;
	for (const [start, count] of votes)
		if (best === undefined || count > (votes.get(best) ?? 0)) best = start;
	return best !== undefined && best > 0 ? best : undefined;
}

export type PrintedBlock = { length: number; start?: number };

export function printedBlocks(
	lines: readonly string[],
	prints: readonly PrintRange[],
	numbered: readonly NumberedLine[],
): PrintedBlock[] | null {
	if (prints.length === 0) return null;
	const total = prints.reduce(
		(sum, print) => sum + (print.length ?? Number.NaN),
		0,
	);
	if (prints.length > 1 && total !== lines.length) return null;
	const byText = new Map<string, number | null>();
	for (const line of numbered) {
		if (!line || line.text.trim().length < PLACES) continue;
		byText.set(line.text, byText.has(line.text) ? null : line.number);
	}
	let from = 0;
	return prints.map((print) => {
		const block = lines.slice(
			from,
			prints.length > 1 ? from + (print.length ?? 0) : undefined,
		);
		from += block.length;
		return {
			length: block.length,
			start: print.start ?? placed(block, byText),
		};
	});
}
