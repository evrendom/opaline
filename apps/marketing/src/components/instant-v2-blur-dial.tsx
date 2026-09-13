import { DialRoot, DialStore, type DialValue, useDialKit } from "dialkit";
import { useEffect } from "react";
import "dialkit/styles.css";

const BLUR_DIAL_CHANGE_EVENT = "instant-v2:blur-dial-change";
const BLUR_PAUSE_CHANGE_EVENT = "instant-v2:blur-pause-change";
const BLUR_DIAL_PANEL_NAME = "Instant V2 Blur Reveal";
const BLUR_DIAL_DEFAULTS: Readonly<Record<string, DialValue>> = {
	"filter.radiusPx": 10,
	"filter.saturationPercent": 300,
	"filter.enabled": true,
	"geometry.leadInPx": 100,
	"geometry.rootGutterPx": 32,
	"geometry.topExtensionPx": 8,
	"geometry.bottomExtensionPx": 108,
	"geometry.verticalAlignment": "top",
	"mask.enabled": true,
	"mask.topFeatherPx": 8,
	"mask.bottomFeatherPx": 0,
	"mask.horizontalSolidPercent": 90,
	"compositing.clipAtRoot": false,
	"compositing.layerOpacity": 1,
	"compositing.layerZIndex": 1,
	"compositing.debugOverlayOpacity": 0,
	"motion.revealDurationMs": 3_000,
	"motion.textClipDurationMs": 2_000,
	"motion.autoReplay": true,
};

interface BlurRevealElements {
	blur: HTMLElement;
	banner: HTMLElement;
	effects: HTMLElement;
	host: HTMLElement;
	root: HTMLElement;
}

export function InstantV2BlurDial() {
	const values = useDialKit(
		BLUR_DIAL_PANEL_NAME,
		{
			paused: false,
			filter: {
				radiusPx: [10, 0, 48, 0.5],
				saturationPercent: [300, 0, 600, 10],
				enabled: true,
			},
			geometry: {
				leadInPx: [100, 0, 240, 1],
				rootGutterPx: [32, 0, 96, 1],
				topExtensionPx: [8, 0, 160, 1],
				bottomExtensionPx: [108, 0, 320, 1],
				verticalAlignment: {
					type: "select",
					options: ["top", "center"],
					default: "top",
				},
			},
			mask: {
				enabled: true,
				topFeatherPx: [8, 0, 120, 1],
				bottomFeatherPx: [0, 0, 120, 1],
				horizontalSolidPercent: [90, 0, 100, 1],
			},
			compositing: {
				clipAtRoot: false,
				layerOpacity: [1, 0, 1, 0.01],
				layerZIndex: [1, -2, 10, 1],
				debugOverlayOpacity: [0, 0, 0.3, 0.01],
			},
			motion: {
				revealDurationMs: [3_000, 100, 8_000, 50],
				textClipDurationMs: [2_000, 100, 8_000, 50],
				autoReplay: true,
			},
			replay: { type: "action", label: "Replay reveal" },
			resetValues: { type: "action", label: "Reset values" },
		},
		{
			onAction: (path) => {
				if (path === "replay") replayBlurReveal();
				if (path === "resetValues") resetBlurDialValues();
			},
		},
	);

	useEffect(() => {
		const elements = getBlurRevealElements();
		if (!elements) return;

		clearLegacyBlurInlineOverrides(elements);
		const { host } = elements;
		host.style.setProperty("--blur", `${values.filter.radiusPx}px`);
		host.style.setProperty(
			"--blur-saturation",
			`${values.filter.saturationPercent}%`,
		);
		host.style.setProperty("--blur-lead-in", `${values.geometry.leadInPx}px`);
		host.style.setProperty(
			"--blur-root-gutter",
			`${values.geometry.rootGutterPx}px`,
		);
		host.style.setProperty(
			"--blur-top-extension",
			`${values.geometry.topExtensionPx}px`,
		);
		host.style.setProperty(
			"--blur-bottom-extension",
			`${values.geometry.bottomExtensionPx}px`,
		);
		host.style.setProperty(
			"--blur-top-feather",
			`${values.mask.topFeatherPx}px`,
		);
		host.style.setProperty(
			"--blur-bottom-feather",
			`${values.mask.bottomFeatherPx}px`,
		);
		host.style.setProperty(
			"--blur-horizontal-solid",
			`${values.mask.horizontalSolidPercent}%`,
		);
		host.style.setProperty(
			"--blur-layer-opacity",
			String(values.compositing.layerOpacity),
		);
		host.style.setProperty(
			"--blur-layer-z",
			String(values.compositing.layerZIndex),
		);
		host.style.setProperty(
			"--blur-debug-opacity",
			String(values.compositing.debugOverlayOpacity),
		);
		host.style.setProperty(
			"--blur-vertical-alignment",
			values.geometry.verticalAlignment === "top" ? "start" : "center",
		);
		host.style.setProperty("--duration", `${values.motion.revealDurationMs}ms`);
		host.style.setProperty(
			"--duration-clip",
			`${values.motion.textClipDurationMs}ms`,
		);
		host.toggleAttribute("data-blur-filter-disabled", !values.filter.enabled);
		host.toggleAttribute("data-blur-mask-disabled", !values.mask.enabled);
		host.toggleAttribute(
			"data-blur-root-clipped",
			values.compositing.clipAtRoot,
		);
		window.dispatchEvent(
			new CustomEvent(BLUR_DIAL_CHANGE_EVENT, {
				detail: {
					bottomExtension: String(values.geometry.bottomExtensionPx),
					leadIn: String(values.geometry.leadInPx),
					radius: String(values.filter.radiusPx),
				},
			}),
		);
		document.documentElement.toggleAttribute(
			"data-instant-v2-blur-paused",
			values.paused,
		);
		window.dispatchEvent(new Event(BLUR_PAUSE_CHANGE_EVENT));

		if (values.paused) {
			pauseBlurReveal();
			return;
		}

		resumeBlurReveal();

		if (!values.motion.autoReplay) return;

		const frameId = window.requestAnimationFrame(replayBlurReveal);
		return () => window.cancelAnimationFrame(frameId);
	}, [
		values.compositing.clipAtRoot,
		values.compositing.debugOverlayOpacity,
		values.compositing.layerOpacity,
		values.compositing.layerZIndex,
		values.filter.enabled,
		values.filter.radiusPx,
		values.filter.saturationPercent,
		values.geometry.bottomExtensionPx,
		values.geometry.leadInPx,
		values.geometry.rootGutterPx,
		values.geometry.topExtensionPx,
		values.geometry.verticalAlignment,
		values.mask.bottomFeatherPx,
		values.mask.enabled,
		values.mask.horizontalSolidPercent,
		values.mask.topFeatherPx,
		values.motion.autoReplay,
		values.motion.revealDurationMs,
		values.motion.textClipDurationMs,
		values.paused,
	]);

	return <DialRoot defaultOpen position="top-right" />;
}

function getBlurRevealElements(): BlurRevealElements | null {
	const banner = document.querySelector<HTMLElement>("[data-agent-phrase]");
	const blur = document.querySelector<HTMLElement>("[data-agent-morph-blur]");
	const effects = document.querySelector<HTMLElement>(
		"[data-agent-morph-effects]",
	);
	const root = banner?.parentElement;
	const host = root?.parentElement;
	if (!banner || !blur || !effects || !host || !root) return null;

	return { banner, blur, effects, host, root };
}

function replayBlurReveal() {
	const elements = getBlurRevealElements();
	if (!elements) return;

	const { banner, blur, root } = elements;
	banner.style.animation = "none";
	blur.style.animation = "none";
	void root.offsetWidth;
	banner.style.removeProperty("animation");
	blur.style.removeProperty("animation");

	if (document.documentElement.hasAttribute("data-instant-v2-blur-paused")) {
		window.requestAnimationFrame(pauseBlurReveal);
	}
}

function resetBlurDialValues() {
	const panel = DialStore.getPanels().find(
		(candidate) => candidate.name === BLUR_DIAL_PANEL_NAME,
	);
	if (!panel) return;

	const elements = getBlurRevealElements();
	if (elements) clearLegacyBlurInlineOverrides(elements);

	DialStore.clearActivePreset(panel.id);
	for (const [path, value] of Object.entries(BLUR_DIAL_DEFAULTS)) {
		DialStore.updateValue(panel.id, path, value);
	}
}

function clearLegacyBlurInlineOverrides(elements: BlurRevealElements) {
	const { blur, effects, root } = elements;
	const legacyRootProperties = [
		"--blur",
		"--blur-saturation",
		"--blur-lead-in",
		"--blur-root-gutter",
		"--blur-top-extension",
		"--blur-bottom-extension",
		"--blur-top-feather",
		"--blur-bottom-feather",
		"--blur-horizontal-solid",
		"--blur-layer-opacity",
		"--blur-layer-z",
		"--blur-debug-opacity",
		"--blur-vertical-alignment",
		"--duration",
		"--duration-clip",
		"overflow-x",
	] as const;
	const legacyBlurProperties = [
		"align-self",
		"backdrop-filter",
		"-webkit-backdrop-filter",
		"background",
		"height",
		"margin-top",
		"mask-image",
		"-webkit-mask-image",
		"opacity",
	] as const;

	for (const property of legacyRootProperties) {
		root.style.removeProperty(property);
	}
	for (const property of legacyBlurProperties) {
		blur.style.removeProperty(property);
	}
	effects.style.removeProperty("margin-left");
	effects.style.removeProperty("z-index");
}

function pauseBlurReveal() {
	const elements = getBlurRevealElements();
	if (!elements) return;

	elements.root.getAnimations({ subtree: true }).forEach((animation) => {
		animation.pause();
	});
}

function resumeBlurReveal() {
	const elements = getBlurRevealElements();
	if (!elements) return;

	elements.root.getAnimations({ subtree: true }).forEach((animation) => {
		animation.play();
	});
}
