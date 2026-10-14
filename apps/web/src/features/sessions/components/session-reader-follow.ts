// How close to the bottom still counts as following the newest turns.
const FOLLOW_THRESHOLD_PX = 32;

/**
 * Keeps the newest turns in view in a scroll container, for a session read
 * live: on while the reader is at the end of the page, off once they scroll
 * up, and on again at the end. New turns, bodies that finish rendering after
 * them, and a resized pane all move the end. `isFollowing` is asked at each
 * move, so the owner can stop following (the session ended) without
 * re-attaching. Returns the detach function.
 */
export function attachReaderFollower(
	element: HTMLElement,
	options: { isFollowing: () => boolean; startAtEnd: boolean },
): () => void {
	let atEnd = options.startAtEnd;
	// Our own scrolls to the end must not read as the reader leaving it.
	let autoScrolling = false;
	const handleScroll = () => {
		if (autoScrolling) {
			autoScrolling = false;
			return;
		}
		atEnd =
			element.scrollHeight - element.scrollTop - element.clientHeight <=
			FOLLOW_THRESHOLD_PX;
	};
	const follow = () => {
		if (!options.isFollowing() || !atEnd) return;
		const end = element.scrollHeight - element.clientHeight;
		if (Math.abs(element.scrollTop - end) < 1) return;
		autoScrolling = true;
		element.scrollTop = end;
	};
	element.addEventListener("scroll", handleScroll, { passive: true });
	const resize = new ResizeObserver(follow);
	resize.observe(element);
	if (element.firstElementChild) resize.observe(element.firstElementChild);
	return () => {
		element.removeEventListener("scroll", handleScroll);
		resize.disconnect();
	};
}
