import type { SweepHandle } from "glimm";
import { usesSafariDemoMotion } from "../scripts/demo-browser";
import {
	animateSafariContentLayout,
	captureSafariContentLayout,
	type SafariContentLayout,
} from "./instant-v2-safari-content-motion";

const activeReleases = new WeakMap<HTMLElement, () => void>();

export interface SafariDemoLayout {
	frame: HTMLIFrameElement;
	content: SafariContentLayout[];
}

export function captureSafariDemoLayout(
	window: HTMLElement | null,
): SafariDemoLayout | null {
	if (!window || !usesSafariDemoMotion(navigator.userAgent)) return null;
	if (window.getBoundingClientRect().width < 768) return null;
	const frame = window.querySelector<HTMLIFrameElement>(
		"[data-instant-v2-product-iframe]",
	);
	if (!frame?.contentDocument) return null;
	return { frame, content: captureSafariContentLayout(frame.contentDocument) };
}

export function animateSafariDemoWindow(
	element: HTMLElement,
	first: DOMRect,
	last: DOMRect,
	layout: SafariDemoLayout,
	timing: KeyframeAnimationOptions,
): Animation {
	activeReleases.get(element)?.();
	const { frame, content } = layout;
	const documentRoot = frame.contentDocument?.documentElement;
	// A quick exit may overlap the first app-chunk download. Hydration must
	// wait until the temporary presentation tree has been restored.
	documentRoot?.setAttribute("data-safari-demo-motion", "");
	const windowStyles = saveInlineStyles(element, [
		"width",
		"height",
		"left",
		"top",
		"transform-origin",
	]);
	const frameStyles = saveInlineStyles(frame, [
		"width",
		"height",
		"transform-origin",
	]);
	Object.assign(element.style, {
		width: `${last.width}px`,
		height: `${last.height}px`,
		left: `${last.left}px`,
		top: `${last.top}px`,
		transformOrigin: "0 0",
	});
	Object.assign(frame.style, {
		width: `${last.width}px`,
		height: `${last.height}px`,
		transformOrigin: "0 0",
	});
	// The iframe must fill the transformed window on exit too. Counter-scaling
	// the iframe itself would shrink its paint viewport to the destination and
	// cut off the right/bottom edges before the window has finished shrinking.
	// Account for the outer scale inside the app's content projections instead.
	const innerMotion = animateSafariContentLayout(content, timing, {
		first: new DOMRect(0, 0, first.width, first.height),
		last: new DOMRect(0, 0, last.width, last.height),
	});
	const scaleX = first.width / last.width;
	const scaleY = first.height / last.height;
	const animation = element.animate(
		[
			{
				transform: `translate(${first.left - last.left}px, ${first.top - last.top}px) scale(${scaleX}, ${scaleY})`,
			},
			{ transform: "translate(0, 0) scale(1, 1)" },
		],
		timing,
	);
	// Documents have different time origins. Give the window, iframe and every
	// content animation one physical start instant, before the lead-in ends.
	void animation.ready.then(
		() => {
			if (
				animation.playState !== "running" ||
				typeof animation.startTime !== "number" ||
				!frame.contentWindow
			)
				return;
			const contentStart =
				animation.startTime +
				performance.timeOrigin -
				frame.contentWindow.performance.timeOrigin;
			for (const item of innerMotion.animations) item.startTime = contentStart;
		},
		() => undefined,
	);
	const release = () => {
		if (activeReleases.get(element) !== release) return;
		innerMotion.release();
		restoreInlineStyles(element, windowStyles);
		restoreInlineStyles(frame, frameStyles);
		documentRoot?.removeAttribute("data-safari-demo-motion");
		activeReleases.delete(element);
	};
	activeReleases.set(element, release);
	void animation.finished.then(release, release);
	return animation;
}

export function startSafariDemoSweep(
	direction: "ltr" | "rtl",
	layoutAnimation: Animation | null = null,
): SweepHandle {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		return {
			midpoint: Promise.resolve(),
			done: Promise.resolve(),
			cancel() {},
		};
	}
	const band = document.createElement("div");
	band.setAttribute("aria-hidden", "true");
	band.setAttribute("data-instant-v2-safari-sweep", "");
	Object.assign(band.style, {
		position: "fixed",
		top: "0",
		left: "-70vw",
		width: "70vw",
		height: "100%",
		pointerEvents: "none",
		zIndex: "100000",
		background:
			"linear-gradient(90deg, transparent, #95b6ff33 20%, #aaa6f866 40%, #cda3f78f 52%, #efb1dc55 72%, transparent)",
		willChange: "transform, opacity",
	});
	document.body.append(band);
	const travel = window.innerWidth * 1.7;
	const motion = band.animate(
		Array.from({ length: 61 }, (_, index) => {
			const offset = index / 60;
			const eased =
				offset < 0.5 ? 4 * offset ** 3 : 1 - (-2 * offset + 2) ** 3 / 2;
			return {
				offset,
				transform: `translateX(${travel * (direction === "ltr" ? eased : 1 - eased)}px)`,
			};
		}),
		{ duration: 800, fill: "forwards" },
	);
	const fade = band.animate(
		[
			{ opacity: 0.6, offset: 0 },
			{ opacity: 0.6, offset: 800 / 1150 },
			{ opacity: 0, offset: 1 },
		],
		{ duration: 1150, fill: "forwards" },
	);
	if (layoutAnimation) {
		void layoutAnimation.ready.then(
			() => {
				if (
					layoutAnimation.playState !== "running" ||
					typeof layoutAnimation.startTime !== "number" ||
					!band.isConnected
				)
					return;
				const start = layoutAnimation.startTime;
				motion.startTime = start;
				fade.startTime = start;
				// React commits the bar before this rendering opportunity. Keep its
				// fades and the existing CTA transitions on the resize clock too.
				for (const element of document.querySelectorAll(
					".instant-v2-demo-bar > *, .instant-v2-dashboard-fade, .instant-v2-dashboard-demo-cta",
				)) {
					for (const animation of element.getAnimations()) {
						if (animation.playState === "running") animation.startTime = start;
					}
				}
			},
			() => undefined,
		);
	}
	let resolveMidpoint: () => void = () => {};
	const midpoint = new Promise<void>((resolve) => {
		resolveMidpoint = resolve;
	});
	const timer = window.setTimeout(resolveMidpoint, 400);
	const finish = () => {
		window.clearTimeout(timer);
		resolveMidpoint();
		motion.cancel();
		band.remove();
	};
	const done = fade.finished.then(finish, finish);
	return { midpoint, done, cancel: () => fade.cancel() };
}

function saveInlineStyles(element: HTMLElement, properties: string[]) {
	return properties.map((name) => ({
		name,
		value: element.style.getPropertyValue(name),
		priority: element.style.getPropertyPriority(name),
	}));
}

function restoreInlineStyles(
	element: HTMLElement,
	styles: ReturnType<typeof saveInlineStyles>,
) {
	for (const { name, value, priority } of styles) {
		if (value) element.style.setProperty(name, value, priority);
		else element.style.removeProperty(name);
	}
}
