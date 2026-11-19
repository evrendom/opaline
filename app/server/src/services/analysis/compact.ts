export const MCP_TOOL_OUTPUT_CHAR_BUDGET = 80_000;
export const MAX_SUMMARY_CHARS = 60_000;
export const PER_VALUE_CHAR_LIMIT = 10_000;

export type Verbosity = "summary" | "full";

const META_RESERVE = 500;
const MIN_ITEM_BUDGET = 256;
const SMALL_BUDGET_RESERVE_RATIO = 0.1;
const SMALL_BUDGET_MIN_ITEM_RATIO = 0.25;
const MAX_FIT_PASSES = 4;
const FIT_HEADROOM = 1.2;

export function responseBudget(verbosity: Verbosity = "full"): number {
	return verbosity === "summary"
		? MAX_SUMMARY_CHARS
		: MCP_TOOL_OUTPUT_CHAR_BUDGET;
}

export function truncatedMarker(dropped: number, total: number): string {
	return `… [truncated ${dropped} of ${total} chars — open it in Opaline for the full value]`;
}

export function omittedMarker(count: number, noun = "rows"): string {
	return `… [${count} more ${noun} omitted to fit the response size limit]`;
}

export function cell(value: unknown): string {
	return value === null || value === undefined
		? "null"
		: String(value)
				.replaceAll("\\", "\\\\")
				.replaceAll("\t", "\\t")
				.replaceAll("\r", "\\r")
				.replaceAll("\n", "\\n");
}

export function encodedLength(value: string): number {
	return cell(value).length;
}

function metaReserveFor(budget: number): number {
	return Math.min(
		META_RESERVE,
		Math.floor(Math.max(0, budget) * SMALL_BUDGET_RESERVE_RATIO),
	);
}

function minItemBudgetFor(budget: number): number {
	return Math.min(
		MIN_ITEM_BUDGET,
		Math.floor(Math.max(0, budget) * SMALL_BUDGET_MIN_ITEM_RATIO),
	);
}

function sliceChars(value: string, end: number): string {
	const kept = value.slice(0, end);
	const last = kept.charCodeAt(kept.length - 1);
	return last >= 0xd800 && last <= 0xdbff ? kept.slice(0, -1) : kept;
}

export function truncateString(
	value: string,
	budget: number = PER_VALUE_CHAR_LIMIT,
): string {
	const cap = Math.max(0, budget);
	if (value.length <= PER_VALUE_CHAR_LIMIT && encodedLength(value) <= cap)
		return value;
	let kept = sliceChars(value, Math.min(PER_VALUE_CHAR_LIMIT, value.length));
	while (kept.length > 0) {
		const encoded = encodedLength(kept);
		if (encoded <= cap) break;
		const shrunkTo =
			cap <= 0 ? 0 : Math.floor(kept.length / ((encoded / cap) * FIT_HEADROOM));
		kept = sliceChars(kept, Math.min(shrunkTo, kept.length - 1));
	}
	if (kept.length >= value.length) return value;
	return `${kept}${truncatedMarker(value.length - kept.length, value.length)}`;
}

export function compactList(
	items: readonly string[],
	budget: number = PER_VALUE_CHAR_LIMIT,
	separator = "; ",
): string {
	const reserve = metaReserveFor(budget);
	const minItemBudget = minItemBudgetFor(budget);
	const out: string[] = [];
	let cost = 0;
	let i = 0;
	for (; i < items.length; i++) {
		if (budget - cost < minItemBudget) break;
		const item = truncateString(items[i] ?? "", budget - cost - reserve);
		out.push(item);
		cost += encodedLength(item) + separator.length;
	}
	if (i < items.length) out.push(omittedMarker(items.length - i, "items"));
	return out.join(separator);
}

export function fitRows(
	rowCosts: readonly number[],
	budget: number,
	baseCost: number,
): number {
	let remaining = budget - baseCost;
	let kept = 0;
	for (const cost of rowCosts) {
		if (kept >= 1 && cost + 1 > remaining) break;
		remaining -= cost + 1;
		kept++;
	}
	return kept;
}

export function fitToBudget<T>(
	budget: number,
	compact: (walkBudget: number) => T,
	fallback: T,
	measure: (value: T) => number,
): T {
	let walkBudget = budget;
	let out = compact(walkBudget);
	for (let pass = 0; pass < MAX_FIT_PASSES; pass++) {
		const encoded = measure(out);
		if (encoded <= budget) return out;
		walkBudget = Math.max(
			MIN_ITEM_BUDGET,
			Math.floor((walkBudget * budget) / encoded / FIT_HEADROOM),
		);
		out = compact(walkBudget);
	}
	return measure(out) <= budget ? out : fallback;
}
