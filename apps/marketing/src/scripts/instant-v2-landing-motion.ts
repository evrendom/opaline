import {
	getInstantV2ScrollContainer,
	getInstantV2ScrollPosition,
} from "./instant-v2-scroll";
import { initializeInstantV2SmoothScroll } from "./instant-v2-smooth-scroll";
import "../styles/instant-v2-landing-motion.css";

const HANDOVER_DISTANCE = 180;
const HERO_START = 20;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** One owner for native motion, its fallback, and the controls hidden by that motion. */
export function initializeInstantV2LandingMotion() {
	initializeInstantV2SmoothScroll();
	const root = document.documentElement;
	const nav = document.querySelector<HTMLElement>("[data-instant-v2-nav]");
	const dashboard = document.querySelector<HTMLElement>(
		"[data-instant-v2-product-window]",
	);
	const hero = document.querySelector<HTMLElement>(
		"[data-instant-v2-hero-content]",
	);
	const gradient = document.querySelector<HTMLElement>(
		".instant-v2-hero-gradient",
	);
	if (!nav || !dashboard || !hero || !gradient) return;
	const controls = nav.querySelectorAll<HTMLElement>(
		".instant-v2-nav-label, .instant-v2-nav-link, [data-instant-v2-install]",
	);
	const phone = matchMedia("(max-width: 540px)");
	const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
	const supportsTimeline =
		CSS.supports("animation-timeline", "scroll()") &&
		CSS.supports("animation-range", "0px 180px");
	let nativeMotion = false;
	let revealEnd = 0;
	let measuredWidth = -1;
	let frame = 0;
	let needsMeasurement = true;

	const measure = () => {
		needsMeasurement = false;
		const wasNative = nativeMotion;
		nativeMotion =
			supportsTimeline &&
			phone.matches &&
			!reducedMotion.matches &&
			!root.hasAttribute("data-instant-v2-demo") &&
			!root.hasAttribute("data-instant-v2-demo-exiting");
		root.toggleAttribute("data-instant-v2-native-motion", nativeMotion);
		if (nativeMotion) {
			revealEnd =
				dashboard.getBoundingClientRect().top +
				getInstantV2ScrollPosition().y -
				nav.getBoundingClientRect().bottom;
			root.style.setProperty(
				"--instant-v2-reveal-start",
				`${revealEnd - HANDOVER_DISTANCE}px`,
			);
			root.style.setProperty("--instant-v2-reveal-end", `${revealEnd}px`);
			// Freeze the accepted surface geometry per width, so a mobile toolbar's
			// height-only changes do not move the gradient or resize its GL buffers.
			if (window.innerWidth !== measuredWidth) {
				root.removeAttribute("data-instant-v2-stable-gradient");
				const style = getComputedStyle(gradient);
				root.style.setProperty(
					"--instant-v2-stable-gradient-height",
					style.height,
				);
				root.style.setProperty("--instant-v2-stable-gradient-top", style.top);
				measuredWidth = window.innerWidth;
				root.setAttribute("data-instant-v2-stable-gradient", "");
			}
			if (!wasNative) {
				hero.style.removeProperty("--instant-v2-hero-recede-progress");
				nav.style.removeProperty("--instant-v2-nav-outgoing-opacity");
				nav.style.removeProperty("--instant-v2-nav-outgoing-scale");
				dashboard.style.removeProperty("--instant-v2-gradient-reveal-progress");
				dashboard.style.removeProperty("--instant-v2-gradient-motion-scale");
			}
		} else {
			root.removeAttribute("data-instant-v2-stable-gradient");
			measuredWidth = -1;
		}
	};

	const update = () => {
		frame = 0;
		if (needsMeasurement) measure();
		const scrollY = getInstantV2ScrollPosition().y;
		const distance = nativeMotion
			? revealEnd - scrollY
			: dashboard.getBoundingClientRect().top -
				nav.getBoundingClientRect().bottom;
		const docked = distance <= 0.5;
		const progress = reducedMotion.matches
			? docked
				? 1
				: 0
			: clamp(1 - distance / HANDOVER_DISTANCE);
		if (!nativeMotion) {
			const heroProgress = reducedMotion.matches
				? 0
				: clamp((scrollY - HERO_START) / HANDOVER_DISTANCE);
			hero.style.setProperty(
				"--instant-v2-hero-recede-progress",
				heroProgress.toFixed(4),
			);
			nav.style.setProperty(
				"--instant-v2-nav-outgoing-opacity",
				(1 - progress).toFixed(4),
			);
			nav.style.setProperty(
				"--instant-v2-nav-outgoing-scale",
				(1 - progress * 0.1).toFixed(4),
			);
			dashboard.style.setProperty(
				"--instant-v2-gradient-reveal-progress",
				progress.toFixed(4),
			);
			dashboard.style.setProperty(
				"--instant-v2-gradient-motion-scale",
				(1 + Math.sin(progress * Math.PI) * 0.12).toFixed(4),
			);
		}
		for (const control of controls) {
			const inert = control.classList.contains("instant-v2-nav-label")
				? progress > 0
				: progress >= 1;
			if (control.inert !== inert) control.inert = inert;
		}
		if (nav.hasAttribute("data-dashboard-docked") !== docked)
			nav.toggleAttribute("data-dashboard-docked", docked);
		if (root.hasAttribute("data-instant-v2-dashboard-docked") !== docked)
			root.toggleAttribute("data-instant-v2-dashboard-docked", docked);
	};
	const schedule = () => {
		if (!frame) frame = requestAnimationFrame(update);
	};
	const scheduleMeasure = () => {
		needsMeasurement = true;
		schedule();
	};
	update();
	(getInstantV2ScrollContainer() ?? window).addEventListener(
		"scroll",
		schedule,
		{ passive: true },
	);
	window.addEventListener("resize", scheduleMeasure, { passive: true });
	window.addEventListener("pageshow", scheduleMeasure, { passive: true });
	window.visualViewport?.addEventListener("resize", scheduleMeasure, {
		passive: true,
	});
	document.fonts.ready.then(scheduleMeasure);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") scheduleMeasure();
	});
	phone.addEventListener("change", scheduleMeasure);
	reducedMotion.addEventListener("change", scheduleMeasure);
	const resize = new ResizeObserver(scheduleMeasure);
	resize.observe(document.querySelector(".instant-v2-hero") ?? dashboard);
	resize.observe(nav);
	new MutationObserver(scheduleMeasure).observe(root, {
		attributes: true,
		attributeFilter: ["data-instant-v2-demo", "data-instant-v2-demo-exiting"],
	});
}
