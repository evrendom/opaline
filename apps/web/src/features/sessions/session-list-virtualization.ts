import { defaultRangeExtractor, type Range } from "@tanstack/react-virtual";

export function getSessionRenderIndexes(range: Range, focusedIndex: number) {
	const indexes = defaultRangeExtractor(range);
	if (
		focusedIndex >= 0 &&
		focusedIndex < range.count &&
		!indexes.includes(focusedIndex)
	) {
		indexes.push(focusedIndex);
		indexes.sort((left, right) => left - right);
	}
	return indexes;
}
