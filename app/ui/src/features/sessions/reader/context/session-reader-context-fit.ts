import { squarify } from "../summary/session-reader-breakdown";

export function fitting<T>(
	items: readonly T[],
	value: (item: T) => number,
	w: number,
	h: number,
	side: number,
	first?: (item: T) => boolean,
): T[] {
	const order = first
		? [...items.filter(first), ...items.filter((item) => !first(item))]
		: [...items];
	const fits = (count: number) =>
		count <= 1 ||
		squarify(
			order.slice(0, count).map((item, index) => ({
				color: "",
				label: String(index),
				value: value(item),
			})),
			w,
			h,
		).every((cell) => cell.width >= side && cell.height >= side);
	let low = Math.min(1, order.length);
	let high = order.length;
	if (!fits(high))
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if (fits(middle)) low = middle;
			else high = middle - 1;
		}
	else low = high;
	const chosen = new Set(order.slice(0, low));
	return items.filter((item) => chosen.has(item));
}
