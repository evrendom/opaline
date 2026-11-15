import { useSyncExternalStore } from "react";
import { useMountEffect } from "@/app/hooks/useMountEffect";

declare global {
	interface OpalineDesktop {
		introReady?: () => void;
		replayOpen?: () => void;
	}
	interface Window {
		opalineDesktop?: OpalineDesktop;
	}
}

const INTRO_PARAM = "opaline-intro";
const RELEASE_DELAY_MS = 650;
const READY_FALLBACK_MS = 4000;
const MEASURE_MS = 220;
const ROLL_IN_MS = 60;
const STILL_LIMIT_MS = 1500;
const MAX_HOLD_MS = 8000;

const listeners = new Set<() => void>();
let requested = false;
let holding = false;
let readySent = false;
let pageMounted = false;
let contentReady = false;
let settled = false;

function release() {
	delete document.documentElement.dataset.intro;
	delete document.documentElement.dataset.introOn;
	if (!holding) return;
	holding = false;
	for (const listener of listeners) listener();
}

export function takeFirstOpenIntro() {
	const url = new URL(window.location.href);
	if (!url.searchParams.has(INTRO_PARAM)) return;
	url.searchParams.delete(INTRO_PARAM);
	window.history.replaceState(
		window.history.state,
		"",
		`${url.pathname}${url.search}${url.hash}`,
	);
	document.documentElement.dataset.intro = "";
	requested = true;
	holding = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	window.setTimeout(release, MAX_HOLD_MS);
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useIntroHold() {
	return useSyncExternalStore(
		subscribe,
		() => holding,
		() => false,
	);
}

export function introRequested() {
	return requested;
}

function sendReady() {
	if (readySent) return;
	readySent = true;
	window.opalineDesktop?.introReady?.();
	window.setTimeout(release, holding ? RELEASE_DELAY_MS : 0);
}

function moving() {
	return document.getAnimations().some((animation) => {
		const target = (animation.effect as KeyframeEffect | null)?.target;
		return (
			animation.playState === "running" &&
			animation.effect?.getComputedTiming().endTime !==
				Number.POSITIVE_INFINITY &&
			target instanceof Element &&
			target.closest(".intro-region") !== null &&
			target.closest("[skullet-layer]") === null
		);
	});
}

function whenStill(run: () => void) {
	const began = performance.now();
	const check = () => {
		settleMotion();
		if (moving() && performance.now() - began < STILL_LIMIT_MS)
			return requestAnimationFrame(check);
		run();
	};
	check();
}

function settleMotion() {
	for (const animation of document.getAnimations()) {
		const target = (animation.effect as KeyframeEffect | null)?.target;
		if (
			animation.effect?.getComputedTiming().endTime !==
				Number.POSITIVE_INFINITY &&
			target instanceof Element &&
			target.closest(".intro-region") !== null &&
			target.closest("[skullet-layer]") === null
		)
			animation.finish();
	}
}

function afterPaint(run: () => void) {
	let frame = requestAnimationFrame(() => {
		frame = requestAnimationFrame(run);
	});
	return () => cancelAnimationFrame(frame);
}

const SETTLING = ".cost-metric-skeleton";

function readyWhenPainted() {
	if (!pageMounted || !contentReady) return;
	const began = performance.now();
	const settle = () => {
		if (
			document.querySelector(SETTLING) &&
			performance.now() - began < READY_FALLBACK_MS
		)
			return window.setTimeout(settle, 50);
		window.setTimeout(
			() =>
				whenStill(() => {
					settleMotion();
					afterPaint(() => {
						settled = true;
						document.documentElement.dataset.introOn = "";
						for (const listener of listeners) listener();
						afterPaint(() => window.setTimeout(sendReady, MEASURE_MS));
					});
				}),
			ROLL_IN_MS,
		);
	};
	settle();
}

export function useIntroSettled() {
	return useSyncExternalStore(
		subscribe,
		() => settled,
		() => false,
	);
}

export function markIntroContentReady() {
	if (contentReady) return;
	contentReady = true;
	readyWhenPainted();
}

export function useFirstOpenReady() {
	useMountEffect(() => {
		if (!requested || readySent) return;
		const timer = window.setTimeout(sendReady, READY_FALLBACK_MS);
		return () => window.clearTimeout(timer);
	});
}

export function useIntroPageReady() {
	useMountEffect(() => {
		if (!requested || readySent) return;
		pageMounted = true;
		readyWhenPainted();
	});
}
