// skullet starts an endless shimmer with element.animate() on every bar and
// rect it draws and never cancels it when it removes them. A Web Animation on
// a detached element keeps running, and once detached getAnimations() no
// longer returns it, so the animations are recorded while the elements are
// attached and cancelled when skullet removes them or the skeleton unmounts.
const DRAWN = "[skullet-rect], [skullet-bar], [skullet-layer]";

function endless(animation: Animation): boolean {
	return animation.effect?.getTiming().iterations === Number.POSITIVE_INFINITY;
}

// Each bar's shimmer starts when skullet draws it, so bars redrawn later
// (a live clock's text) run out of phase. Their sweep is laid out across the
// viewport, so one start time for all of them makes one wave.
function onSharedClock(animation: Animation) {
	const align = () => {
		if (animation.startTime !== 0 && animation.playState === "running")
			animation.startTime = 0;
	};
	if (animation.pending) void animation.ready.then(align, () => {});
	else align();
}

export function cancelSkulletAnimations(host: Element): () => void {
	const recorded = new Map<Element, Animation[]>();
	const watched = new WeakSet<Node>();

	const elementsIn = (node: Node): Element[] => {
		if (!(node instanceof Element)) return [];
		const found = node.matches(DRAWN) ? [node] : [];
		found.push(...node.querySelectorAll(DRAWN));
		for (const layer of [...found])
			if (layer.shadowRoot)
				found.push(...layer.shadowRoot.querySelectorAll(DRAWN));
		return found;
	};

	const record = (element: Element) => {
		const running =
			typeof element.getAnimations === "function"
				? element.getAnimations().filter(endless)
				: [];
		for (const animation of running) onSharedClock(animation);
		if (running.length > 0) recorded.set(element, running);
		if (element.shadowRoot && !watched.has(element.shadowRoot)) {
			watched.add(element.shadowRoot);
			observer.observe(element.shadowRoot, observed);
			for (const drawn of element.shadowRoot.querySelectorAll(DRAWN))
				record(drawn);
		}
	};

	const cancel = (element: Element) => {
		for (const animation of recorded.get(element) ?? []) animation.cancel();
		recorded.delete(element);
	};

	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			if (mutation.type === "attributes") {
				if (
					mutation.target instanceof Element &&
					mutation.target.isConnected &&
					mutation.target.matches(DRAWN)
				)
					record(mutation.target);
				continue;
			}
			for (const node of mutation.removedNodes)
				if (!node.isConnected)
					for (const element of elementsIn(node)) cancel(element);
			for (const node of mutation.addedNodes)
				for (const element of elementsIn(node)) record(element);
		}
	});
	const observed: MutationObserverInit = {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["style"],
	};
	observer.observe(host, observed);
	for (const element of elementsIn(host)) record(element);

	return () => {
		observer.disconnect();
		for (const element of [...recorded.keys()]) cancel(element);
	};
}
