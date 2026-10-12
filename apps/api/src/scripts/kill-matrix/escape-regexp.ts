/** `text` as a regular expression matching exactly it. */
export function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
