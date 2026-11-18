import type { SweepHandle } from "glimm";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { ProductBrand } from "../../../web/src/features/shell/components/product-brand";
import { DEMO_VIEWPORT_MESSAGE } from "../scripts/demo-viewport";
import { DOWNLOAD_PAGE_PATH } from "../scripts/desktop-download";
import {
	getInstantV2ScrollContainer,
	getInstantV2ScrollPosition,
} from "../scripts/instant-v2-scroll";
import { scheduleProductDemoPreparation } from "../scripts/prepare-product-demo";
import {
	animateSafariDemoWindow,
	captureSafariDemoLayout,
	type SafariDemoLayout,
	startDemoSweep,
} from "./instant-v2-safari-motion";
import "./InstantV2DemoExperience.css";

/* ─────────────────────────────────────────────────────────
 * DEMO STORYBOARD — compositor sweep, no first-click WebGL setup
 *
 *     0ms   pin the sweep in viewport space; prism band enters
 *   180ms   dashboard opens behind the pinned footer copy; top stays anchored
 *   400ms   sweep midpoint passes while the dashboard continues opening
 *   800ms   dashboard reaches the viewport; only then bottom radii square off
 * 1,150ms   sweep outro finishes on the settled layout
 *
 * Safari uses batched content projections with the same 180ms lead-in and
 * 620ms resize curve. Its sweep shares the window's start instant.
 * ───────────────────────────────────────────────────────── */

const DEMO_ENTER_EVENT = "instant-v2:demo-enter";
const DEMO_SWEEP_MS = 800;
const DEMO_OUTRO_MS = 350;
const DEMO_VISUAL_ENTRY_DELAY_MS = 180;
const DEMO_BAR_HEIGHT_PX = 42;
const DEMO_TOTAL_DURATION_MS = DEMO_SWEEP_MS + DEMO_OUTRO_MS;
const DEMO_LAYOUT_DURATION_MS = DEMO_SWEEP_MS - DEMO_VISUAL_ENTRY_DELAY_MS;
const DEMO_LAYOUT_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const DEMO_LAYOUT_DELAY_CSS_PROPERTY = "--instant-v2-demo-layout-delay";
const DEMO_LAYOUT_DURATION_CSS_PROPERTY = "--instant-v2-demo-layout-duration";
const DEMO_HISTORY_STATE = { instantV2Demo: true } as const;
const DEMO_LAYOUT_SETTLED_ATTRIBUTE = "data-instant-v2-demo-layout-settled";
const DEMO_OVERLAY_SELECTOR = ".instant-v2-dashboard-fade";
const DEMO_OVERLAY_PIN_PROPERTIES = {
	top: "--instant-v2-demo-overlay-top",
	left: "--instant-v2-demo-overlay-left",
	width: "--instant-v2-demo-overlay-width",
	height: "--instant-v2-demo-overlay-height",
} as const;
const DEMO_CTA_SELECTOR = ".instant-v2-dashboard-demo-cta";
const DEMO_CTA_PIN_PROPERTIES = {
	top: "--instant-v2-demo-cta-top",
	left: "--instant-v2-demo-cta-left",
	width: "--instant-v2-demo-cta-width",
	height: "--instant-v2-demo-cta-height",
} as const;
const DEMO_GRADIENT_SELECTOR = ".instant-v2-hero-gradient";
const DEMO_GRADIENT_PIN_PROPERTIES = {
	top: "--instant-v2-demo-gradient-top",
	left: "--instant-v2-demo-gradient-left",
	width: "--instant-v2-demo-gradient-width",
	height: "--instant-v2-demo-gradient-height",
} as const;
const DEMO_COMPANY_STRIP_SELECTOR = ".company-strip";
const DEMO_COMPANY_STRIP_PIN_PROPERTIES = {
	top: "--instant-v2-demo-company-strip-top",
	height: "--instant-v2-demo-company-strip-height",
} as const;
const DEMO_DASHBOARD_SELECTOR = "[data-instant-v2-window]";
const DEMO_DASHBOARD_PIN_PROPERTIES = {
	top: "--instant-v2-demo-dashboard-top",
	height: "--instant-v2-demo-dashboard-height",
} as const;

type DemoStage = "landing" | "entering" | "demo" | "exiting";
type DemoBarStage = "hidden" | "entering" | "visible" | "exiting";

interface DemoDomSnapshot {
	backgroundRegions: Array<{
		element: HTMLElement;
		inert: boolean;
	}>;
	bodyOverflow: string;
	elementPins: DemoElementPinSnapshot[];
	htmlOverflow: string;
	scrollX: number;
	scrollY: number;
}

interface DemoElementPinSnapshot {
	element: HTMLElement;
	previousProperties: Array<{ name: string; value: string }>;
}

interface DemoDomActivation {
	animation: Animation | null;
	snapshot: DemoDomSnapshot;
}

interface DemoDomDeactivation {
	animation: Animation | null;
	done: Promise<void>;
}

export function InstantV2DemoExperience() {
	const [demoBarStage, setDemoBarStage] = useState<DemoBarStage>("hidden");
	const stageRef = useRef<DemoStage>("landing");
	const activeSweepRef = useRef<SweepHandle | null>(null);
	const domSnapshotRef = useRef<DemoDomSnapshot | null>(null);
	const layoutAnimationRef = useRef<Animation | null>(null);
	const exitButtonRef = useRef<HTMLButtonElement>(null);
	const setLayoutAnimation = useCallback((animation: Animation | null) => {
		layoutAnimationRef.current?.cancel();
		layoutAnimationRef.current = animation;
		if (!animation) return;

		void animation.finished
			.catch(() => undefined)
			.then(() => {
				if (layoutAnimationRef.current === animation) {
					layoutAnimationRef.current = null;
				}
			});
	}, []);

	const activateDemo = useCallback(() => {
		if (!domSnapshotRef.current) {
			const activation = activateDemoDom();
			domSnapshotRef.current = activation.snapshot;
			setLayoutAnimation(activation.animation);
			pushDemoHistory();
			return;
		}
		pushDemoHistory();
	}, [setLayoutAnimation]);

	const deactivateDemo = useCallback(() => {
		const snapshot = domSnapshotRef.current;
		const deactivation = deactivateDemoDom(snapshot);
		setLayoutAnimation(deactivation.animation);
		void deactivation.done.then(() => {
			if (domSnapshotRef.current === snapshot) {
				domSnapshotRef.current = null;
			}
			setDemoBarStage("hidden");
		});
	}, [setLayoutAnimation]);

	const enterDemo = useCallback(async () => {
		if (stageRef.current !== "landing") return;

		stageRef.current = "entering";
		setDemoBarStage("entering");
		for (const enterButton of getDemoEnterButtons()) enterButton.inert = true;

		activateDemo();
		const handle = startDemoSweep("ltr", layoutAnimationRef.current);
		activeSweepRef.current = handle;
		setProductDemoActive(true);

		try {
			// The app activates independently. Only the bar's presentation waits
			// for the sweep; product controls can respond during the transition.
			await Promise.all([
				handle.done,
				layoutAnimationRef.current?.finished.catch(() => undefined),
			]);
			if (activeSweepRef.current !== handle) return;
			if (!document.documentElement.hasAttribute("data-instant-v2-demo")) {
				activateDemo();
			}
			stageRef.current = "demo";
			setDemoBarStage("visible");
		} catch (error) {
			if (activeSweepRef.current !== handle) return;
			console.error("Unable to enter the instant-v2 product demo", error);
			if (document.documentElement.hasAttribute("data-instant-v2-demo")) {
				setProductDemoActive(true);
				stageRef.current = "demo";
				setDemoBarStage("visible");
				return;
			}
			stageRef.current = "landing";
			setDemoBarStage("hidden");
			setNavDemoState(false);
		} finally {
			if (activeSweepRef.current === handle) activeSweepRef.current = null;
		}
	}, [activateDemo]);

	const exitDemo = useCallback(async () => {
		if (
			(stageRef.current !== "demo" && stageRef.current !== "exiting") ||
			!document.documentElement.hasAttribute("data-instant-v2-demo")
		) {
			return;
		}

		stageRef.current = "exiting";
		setProductDemoActive(false);
		setDemoEnterDisabled(true);
		setDemoBarStage("exiting");
		setDemoExitBackgroundState(true);
		deactivateDemo();
		const handle = startDemoSweep("rtl", layoutAnimationRef.current);
		activeSweepRef.current = handle;

		try {
			await handle.done;
		} catch (error) {
			console.error("Unable to exit the instant-v2 product demo", error);
			deactivateDemo();
		} finally {
			if (activeSweepRef.current === handle) activeSweepRef.current = null;
			stageRef.current = "landing";
			setDemoEnterDisabled(false);
			getDemoEnterButton()?.focus({ preventScroll: true });
		}
	}, [deactivateDemo]);

	const requestExit = useCallback(() => {
		if (
			stageRef.current !== "demo" ||
			!document.documentElement.hasAttribute("data-instant-v2-demo")
		) {
			return;
		}

		const url = new URL(window.location.href);
		url.searchParams.delete("connect");
		url.searchParams.delete("user_code");
		history.replaceState(history.state, "", url);
		void exitDemo();
	}, [exitDemo]);

	const moveDownloadGlow = useCallback(
		(event: ReactPointerEvent<HTMLAnchorElement>) => {
			const glow = event.currentTarget.querySelector<HTMLElement>(
				"[data-instant-v2-demo-download-glow]",
			);
			if (!glow) return;

			const bounds = event.currentTarget.getBoundingClientRect();
			glow.style.setProperty(
				"--instant-v2-glow-x",
				`${event.clientX - (bounds.left + bounds.width / 2)}px`,
			);
			glow.style.setProperty(
				"--instant-v2-glow-y",
				`${event.clientY - (bounds.top + bounds.height / 2)}px`,
			);
		},
		[],
	);

	useEffect(() => {
		const handleEnterRequest = () => void enterDemo();
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") requestExit();
		};
		const handleFrameMessage = (event: MessageEvent<unknown>) => {
			const frame = document.querySelector<HTMLIFrameElement>(
				"[data-instant-v2-product-iframe]",
			);
			if (
				frame &&
				event.source === frame.contentWindow &&
				event.origin === new URL(frame.src, window.location.href).origin &&
				event.data === "opaline:exit-demo"
			)
				requestExit();
		};
		const handlePopState = (event: PopStateEvent) => {
			if (
				!isDemoHistoryState(event.state) &&
				document.documentElement.hasAttribute("data-instant-v2-demo")
			) {
				void exitDemo();
			}
		};

		window.addEventListener(DEMO_ENTER_EVENT, handleEnterRequest);
		document.addEventListener("keydown", handleKeyDown);
		window.addEventListener("popstate", handlePopState);
		window.addEventListener("message", handleFrameMessage);

		return () => {
			window.removeEventListener(DEMO_ENTER_EVENT, handleEnterRequest);
			document.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("popstate", handlePopState);
			window.removeEventListener("message", handleFrameMessage);
			activeSweepRef.current?.cancel();
			activeSweepRef.current = null;
			layoutAnimationRef.current?.cancel();
			deactivateDemoDom(domSnapshotRef.current, false);
			domSnapshotRef.current = null;
		};
	}, [enterDemo, exitDemo, requestExit]);

	useEffect(() => {
		if (window.location.hash === "#demo") void enterDemo();
	}, [enterDemo]);

	useEffect(() => scheduleProductDemoPreparation(prepareProductDemo), []);

	useEffect(() => {
		const frame = getProductDemoFrame();
		if (!frame) return;
		const postViewport = () =>
			postProductDemoMessage(frame, {
				type: DEMO_VIEWPORT_MESSAGE,
				height: window.innerHeight - DEMO_BAR_HEIGHT_PX,
			});
		postViewport();
		frame.addEventListener("load", postViewport);
		window.addEventListener("resize", postViewport);
		return () => {
			frame.removeEventListener("load", postViewport);
			window.removeEventListener("resize", postViewport);
		};
	}, []);

	if (demoBarStage === "hidden") return null;

	return (
		<div
			aria-hidden={demoBarStage === "visible" ? undefined : true}
			className="instant-v2-demo-bar"
			data-instant-v2-demo-bar
			data-stage={demoBarStage}
		>
			<div className="instant-v2-demo-status-group">
				<ProductBrand />
			</div>
			<div className="instant-v2-demo-download-group">
				<span className="instant-v2-demo-download-context instant-v2-demo-download-context-before">
					Try it on your own sessions
				</span>
				<a
					className="instant-v2-demo-download"
					data-marketing-download-source="demo_bar"
					href={DOWNLOAD_PAGE_PATH}
					onPointerMove={moveDownloadGlow}
					tabIndex={demoBarStage === "visible" ? undefined : -1}
				>
					<span
						aria-hidden="true"
						className="instant-v2-demo-download-opalescence"
						data-instant-v2-demo-download-glow
					/>
					<span aria-hidden="true" className="instant-v2-demo-download-glass" />
					<span className="instant-v2-demo-download-content">
						<svg
							aria-hidden="true"
							className="instant-v2-demo-download-icon"
							fill="currentColor"
							viewBox="0 0 24 24"
						>
							<path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
						</svg>
						Download for Mac
					</span>
				</a>
			</div>
			<button
				className="instant-v2-demo-exit"
				data-instant-v2-demo-exit
				disabled={demoBarStage !== "visible"}
				onClick={requestExit}
				ref={exitButtonRef}
				type="button"
			>
				Exit demo <span aria-hidden="true">✕</span>
			</button>
		</div>
	);
}

function activateDemoDom(): DemoDomActivation {
	const root = document.documentElement;
	setDemoLayoutSettled(false);
	const backgroundRegions = Array.from(
		document.querySelectorAll<HTMLElement>("[data-instant-v2-demo-background]"),
	).map((element) => ({ element, inert: element.inert }));
	const elementPins = [
		pinDemoScrollContent(),
		pinDemoGradient(),
		pinDemoCompanyStrip(),
		pinDemoDashboard(),
		pinDemoViewportBounds(DEMO_OVERLAY_SELECTOR, DEMO_OVERLAY_PIN_PROPERTIES),
		pinDemoViewportBounds(DEMO_CTA_SELECTOR, DEMO_CTA_PIN_PROPERTIES),
	].filter((pin): pin is DemoElementPinSnapshot => pin !== null);
	const scrollPosition = getInstantV2ScrollPosition();
	const snapshot: DemoDomSnapshot = {
		backgroundRegions,
		bodyOverflow: document.body.style.overflow,
		elementPins,
		htmlOverflow: root.style.overflow,
		scrollX: scrollPosition.x,
		scrollY: scrollPosition.y,
	};

	const dashboardWindow = getDemoDashboardWindow();
	const first = dashboardWindow?.getBoundingClientRect();
	const safariLayout = captureSafariDemoLayout(dashboardWindow);
	applyDemoDom(backgroundRegions);
	const last = dashboardWindow?.getBoundingClientRect();
	const animation = animateDashboardBounds(
		dashboardWindow,
		first,
		last,
		safariLayout,
	);
	settleDemoLayoutAfter(animation);

	return { animation, snapshot };
}

function deactivateDemoDom(
	snapshot: DemoDomSnapshot | null,
	animate = true,
): DemoDomDeactivation {
	if (!animate) {
		applyLandingDom(snapshot, true);
		return { animation: null, done: Promise.resolve() };
	}
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		applyLandingDom(snapshot, true);
		return { animation: null, done: Promise.resolve() };
	}

	const dashboardWindow = getDemoDashboardWindow();
	const first = dashboardWindow?.getBoundingClientRect();
	const safariLayout = captureSafariDemoLayout(dashboardWindow);
	applyLandingDom(snapshot, false);
	const last = dashboardWindow?.getBoundingClientRect();
	applyDemoDom(snapshot?.backgroundRegions ?? []);
	const animation = animateDashboardBounds(
		dashboardWindow,
		first,
		last,
		safariLayout,
	);
	if (!animation) {
		applyLandingDom(snapshot, true);
		return { animation: null, done: Promise.resolve() };
	}

	return {
		animation,
		done: animation.finished
			.catch(() => undefined)
			.then(() => applyLandingDom(snapshot, true)),
	};
}

function applyDemoDom(backgroundRegions: DemoDomSnapshot["backgroundRegions"]) {
	const root = document.documentElement;
	root.style.setProperty(
		DEMO_LAYOUT_DELAY_CSS_PROPERTY,
		`${DEMO_VISUAL_ENTRY_DELAY_MS}ms`,
	);
	root.style.setProperty(
		DEMO_LAYOUT_DURATION_CSS_PROPERTY,
		`${DEMO_LAYOUT_DURATION_MS}ms`,
	);
	root.setAttribute("data-instant-v2-demo", "");
	root.setAttribute("data-instant-v2-dashboard-docked", "");
	root.style.overflow = "hidden";
	document.body.style.overflow = "hidden";
	for (const region of backgroundRegions) region.element.inert = true;
	setNavDemoState(true);
}

function applyLandingDom(
	snapshot: DemoDomSnapshot | null,
	removeDemoHash: boolean,
) {
	const root = document.documentElement;
	root.removeAttribute("data-instant-v2-demo");
	setDemoLayoutSettled(false);
	setNavDemoState(false);

	if (snapshot) {
		for (const region of snapshot.backgroundRegions) {
			region.element.inert = region.inert;
		}
		root.style.overflow = snapshot.htmlOverflow;
		document.body.style.overflow = snapshot.bodyOverflow;
		(getInstantV2ScrollContainer() ?? window).scrollTo({
			left: snapshot.scrollX,
			top: snapshot.scrollY,
			behavior: "instant",
		});
	}
	if (removeDemoHash) {
		setDemoExitBackgroundState(false);
		for (const pin of snapshot?.elementPins ?? []) restoreDemoElementPin(pin);
		root.style.removeProperty(DEMO_LAYOUT_DELAY_CSS_PROPERTY);
		root.style.removeProperty(DEMO_LAYOUT_DURATION_CSS_PROPERTY);
		removeStaleDemoHash();
		// Returning to the same offset emits no native scroll event. Refresh
		// landing paint after removing the demo's forced docking state.
		(getInstantV2ScrollContainer() ?? window).dispatchEvent(
			new Event("scroll"),
		);
	}
}

function pinDemoScrollContent(): DemoElementPinSnapshot | null {
	const content = getInstantV2ScrollContainer()?.querySelector<HTMLElement>(
		"[data-instant-v2-scroll-content]",
	);
	if (!content) return null;
	return pinDemoElement(content, {
		"--instant-v2-scroll-content-height": `${content.getBoundingClientRect().height}px`,
	});
}

function pinDemoViewportBounds(
	selector: string,
	properties: {
		top: string;
		left: string;
		width: string;
		height: string;
	},
): DemoElementPinSnapshot | null {
	const element = document.querySelector<HTMLElement>(selector);
	if (!element) return null;

	const rect = element.getBoundingClientRect();
	return pinDemoElement(element, {
		[properties.top]: `${rect.top}px`,
		[properties.left]: `${rect.left}px`,
		[properties.width]: `${rect.width}px`,
		[properties.height]: `${rect.height}px`,
	});
}

function settleDemoLayoutAfter(animation: Animation | null) {
	if (!animation) {
		setDemoLayoutSettled(true);
		return;
	}

	void animation.finished
		.then(() => {
			const root = document.documentElement;
			if (
				root.hasAttribute("data-instant-v2-demo") &&
				!root.hasAttribute("data-instant-v2-demo-exiting")
			) {
				setDemoLayoutSettled(true);
			}
		})
		.catch(() => undefined);
}

function setDemoLayoutSettled(settled: boolean) {
	document.documentElement.toggleAttribute(
		DEMO_LAYOUT_SETTLED_ATTRIBUTE,
		settled,
	);
}

function pinDemoGradient(): DemoElementPinSnapshot | null {
	const element = document.querySelector<HTMLElement>(DEMO_GRADIENT_SELECTOR);
	if (!element) return null;

	const rect = element.getBoundingClientRect();
	return pinDemoElement(element, {
		[DEMO_GRADIENT_PIN_PROPERTIES.top]: `${rect.top}px`,
		[DEMO_GRADIENT_PIN_PROPERTIES.left]: `${rect.left}px`,
		[DEMO_GRADIENT_PIN_PROPERTIES.width]: `${rect.width}px`,
		[DEMO_GRADIENT_PIN_PROPERTIES.height]: `${rect.height}px`,
	});
}

function pinDemoCompanyStrip(): DemoElementPinSnapshot | null {
	const element = document.querySelector<HTMLElement>(
		DEMO_COMPANY_STRIP_SELECTOR,
	);
	if (!element) return null;

	const rect = element.getBoundingClientRect();
	return pinDemoElement(element, {
		[DEMO_COMPANY_STRIP_PIN_PROPERTIES.top]: `${rect.top}px`,
		[DEMO_COMPANY_STRIP_PIN_PROPERTIES.height]: `${rect.height}px`,
	});
}

function pinDemoDashboard(): DemoElementPinSnapshot | null {
	const element = getDemoDashboardWindow();
	if (!element) return null;

	return pinDemoElement(element, {
		[DEMO_DASHBOARD_PIN_PROPERTIES.top]: `${DEMO_BAR_HEIGHT_PX}px`,
		// Keep the frame responsive when the viewport changes in another tab.
		[DEMO_DASHBOARD_PIN_PROPERTIES.height]: `max(0px, calc(100dvh - ${DEMO_BAR_HEIGHT_PX}px))`,
	});
}

function pinDemoElement(
	element: HTMLElement,
	pinnedValues: Record<string, string>,
): DemoElementPinSnapshot {
	const previousProperties = Object.keys(pinnedValues).map((name) => ({
		name,
		value: element.style.getPropertyValue(name),
	}));

	for (const [name, value] of Object.entries(pinnedValues)) {
		element.style.setProperty(name, value);
	}

	return { element, previousProperties };
}

function restoreDemoElementPin(snapshot: DemoElementPinSnapshot) {
	if (!snapshot) return;

	for (const { name, value } of snapshot.previousProperties) {
		if (value) {
			snapshot.element.style.setProperty(name, value);
			continue;
		}
		snapshot.element.style.removeProperty(name);
	}
}

function setDemoExitBackgroundState(active: boolean) {
	const root = document.documentElement;
	root.toggleAttribute("data-instant-v2-demo-exiting", active);
	if (active) {
		setDemoLayoutSettled(false);
		root.style.setProperty(
			"--instant-v2-demo-exit-duration",
			`${DEMO_TOTAL_DURATION_MS}ms`,
		);
		return;
	}
	root.style.removeProperty("--instant-v2-demo-exit-duration");
}

function animateDashboardBounds(
	element: HTMLElement | null | undefined,
	first: DOMRect | undefined,
	last: DOMRect | undefined,
	safariLayout: SafariDemoLayout | null,
): Animation | null {
	if (
		!element ||
		!first ||
		!last ||
		window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
		first.width <= 0 ||
		first.height <= 0 ||
		last.width <= 0 ||
		last.height <= 0
	) {
		return null;
	}
	const timing: KeyframeAnimationOptions = {
		delay: DEMO_VISUAL_ENTRY_DELAY_MS,
		duration: DEMO_LAYOUT_DURATION_MS,
		easing: DEMO_LAYOUT_EASING,
		fill: "backwards",
	};
	if (safariLayout && first.width >= 768 && last.width >= 768) {
		return animateSafariDemoWindow(element, first, last, safariLayout, timing);
	}

	return element.animate(
		[
			{
				height: `${first.height}px`,
				left: `${first.left}px`,
				top: `${first.top}px`,
				width: `${first.width}px`,
			},
			{
				height: `${last.height}px`,
				left: `${last.left}px`,
				top: `${last.top}px`,
				width: `${last.width}px`,
			},
		],
		timing,
	);
}

function getDemoDashboardWindow() {
	return document.querySelector<HTMLElement>(DEMO_DASHBOARD_SELECTOR);
}

function setNavDemoState(active: boolean) {
	const nav = getDemoNav();
	nav?.toggleAttribute("data-demo-active", active);
	for (const enterButton of getDemoEnterButtons()) enterButton.inert = active;
}

function getDemoNav() {
	return document.querySelector<HTMLElement>("[data-instant-v2-nav]");
}

function getDemoEnterButton() {
	return document.querySelector<HTMLButtonElement>(
		"[data-instant-v2-dashboard-demo]",
	);
}

function prepareProductDemo() {
	if (document.documentElement.hasAttribute("data-cli-onboarding")) return;
	const frame = getProductDemoFrame();
	if (!frame || frame.dataset.preparationRequested) return;
	frame.dataset.preparationRequested = "true";
	postProductDemoMessage(frame, "opaline:prepare-demo");
}

function setProductDemoActive(active: boolean) {
	if (document.documentElement.hasAttribute("data-cli-onboarding")) return;
	const frame = getProductDemoFrame();
	if (!frame) return;
	frame.dataset.demoActive = String(active);
	frame.tabIndex = active ? 0 : -1;
	postProductDemoMessage(
		frame,
		active ? "opaline:activate-demo" : "opaline:deactivate-demo",
	);
	if (active) frame.focus({ preventScroll: true });
}

function getProductDemoFrame() {
	const frame = document.querySelector<HTMLIFrameElement>(
		"[data-instant-v2-product-iframe]",
	);
	if (frame && !frame.dataset.bootListener) {
		frame.dataset.bootListener = "true";
		// Preserve the latest intent if entry/exit beats the iframe's load.
		frame.addEventListener("load", () => {
			if (document.documentElement.hasAttribute("data-cli-onboarding")) return;
			if (frame.dataset.demoActive === "true")
				postProductDemoMessage(frame, "opaline:activate-demo");
			else if (frame.dataset.preparationRequested)
				postProductDemoMessage(frame, "opaline:prepare-demo");
		});
	}
	return frame;
}

function postProductDemoMessage(frame: HTMLIFrameElement, message: unknown) {
	if (frame.getAttribute("src") === "about:blank") return;
	frame.contentWindow?.postMessage(
		message,
		new URL(frame.src, window.location.href).origin,
	);
}

function getDemoEnterButtons() {
	return document.querySelectorAll<HTMLElement>(
		"[data-instant-v2-demo-trigger]",
	);
}

function setDemoEnterDisabled(disabled: boolean) {
	// The landing geometry finishes before the sweep outro. Don't accept a
	// re-entry click until the controller is ready to handle it again.
	for (const button of getDemoEnterButtons()) {
		if (button instanceof HTMLButtonElement) button.disabled = disabled;
	}
}

function pushDemoHistory() {
	if (isDemoHistoryState(history.state)) return;
	const demoUrl = new URL(window.location.href);
	demoUrl.hash = "demo";
	history.pushState(DEMO_HISTORY_STATE, "", demoUrl);
}

function removeStaleDemoHash() {
	if (window.location.hash !== "#demo") return;
	const landingUrl = new URL(window.location.href);
	landingUrl.hash = "";
	history.replaceState(null, "", landingUrl);
}

function isDemoHistoryState(value: unknown) {
	return (
		typeof value === "object" &&
		value !== null &&
		Reflect.get(value, "instantV2Demo") === true
	);
}
