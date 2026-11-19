function along(
	from: readonly number[],
	to: readonly number[],
	at: number,
): number {
	for (let index = 1; index < from.length; index++) {
		const start = from[index - 1] as number;
		const end = from[index] as number;
		if (at > end && index < from.length - 1) continue;
		const share = end > start ? (at - start) / (end - start) : 0;
		const low = to[index - 1] as number;
		const high = to[index] as number;
		return low + Math.min(Math.max(share, 0), 1) * (high - low);
	}
	return to[0] ?? at;
}

export function focusMapping(
	scroller: HTMLElement,
	span: { bottom: number; top: number },
	talks: readonly number[],
) {
	const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
	const messages = [
		...scroller.querySelectorAll<HTMLElement>("[data-exchange]"),
	].map((each) => each.getBoundingClientRect().top - origin);
	const pairs = Math.min(messages.length, talks.length);
	const page = [0, ...messages.slice(0, pairs), scroller.scrollHeight];
	const map = [span.top, ...talks.slice(0, pairs), span.bottom];
	return {
		toMap: (at: number) => along(page, map, at),
		toPage: (at: number) => along(map, page, at),
	};
}
