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
const RELEASE_DELAY_MS = 150;
const MAX_HOLD_MS = 8000;

const listeners = new Set<() => void>();
let requested = false;
let holding = false;
let readySent = false;

function release() {
	delete document.documentElement.dataset.intro;
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

export function useFirstOpenReady() {
	useMountEffect(() => {
		if (!requested || readySent) return;
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => {
				readySent = true;
				window.opalineDesktop?.introReady?.();
				window.setTimeout(release, holding ? RELEASE_DELAY_MS : 0);
			});
		});
		return () => cancelAnimationFrame(frame);
	});
}
