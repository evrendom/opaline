import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { usesSafariDemoMotion } from "./demo-browser";
import { getInstantV2ScrollContainer } from "./instant-v2-scroll";

const DEMO_ACTIVE_ATTRIBUTE = "data-instant-v2-demo";
const DEMO_EXITING_ATTRIBUTE = "data-instant-v2-demo-exiting";

export function initializeInstantV2SmoothScroll() {
	const root = document.documentElement;
	const scrollContainer = getInstantV2ScrollContainer();
	const scrollContent = scrollContainer?.querySelector<HTMLElement>(
		"[data-instant-v2-scroll-content]",
	);
	const initialScroll = { left: window.scrollX, top: window.scrollY };
	root.toggleAttribute(
		"data-instant-v2-safari-scroll",
		usesSafariDemoMotion(navigator.userAgent),
	);
	if (scrollContainer) {
		window.scrollTo({ left: 0, top: 0, behavior: "instant" });
		scrollContainer.scrollTo({ ...initialScroll, behavior: "instant" });
		scrollContainer.tabIndex = 0;
	}
	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
	let lenis: Lenis | null = null;

	const syncSmoothScroll = () => {
		const productDemoIsActive =
			root.hasAttribute(DEMO_ACTIVE_ATTRIBUTE) ||
			root.hasAttribute(DEMO_EXITING_ATTRIBUTE);

		if (reducedMotion.matches || productDemoIsActive) {
			lenis?.destroy();
			lenis = null;
			return;
		}

		lenis ??= new Lenis({
			wrapper: scrollContainer ?? window,
			content: scrollContent ?? document.documentElement,
			anchors: true,
			autoRaf: true,
			lerp: 0.24,
		});
	};

	const demoStateObserver = new MutationObserver(syncSmoothScroll);
	demoStateObserver.observe(root, {
		attributeFilter: [DEMO_ACTIVE_ATTRIBUTE, DEMO_EXITING_ATTRIBUTE],
		attributes: true,
	});
	reducedMotion.addEventListener("change", syncSmoothScroll);
	syncSmoothScroll();
}
