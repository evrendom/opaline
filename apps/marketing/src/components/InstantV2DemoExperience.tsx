import type { SweepHandle } from "glimm";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { cliSetupUrl } from "../../../web/src/features/cli-onboarding/cli-authorization";
import { getCliConnectionTone } from "../../../web/src/features/cli-onboarding/cli-connection-state";
import { CliConnectionStatus } from "../../../web/src/features/cli-onboarding/cli-connection-status";
import { useCliOnboarding } from "../../../web/src/features/cli-onboarding/use-cli-onboarding";
import { ProductBrand } from "../../../web/src/features/shell/components/product-brand";
import { DEMO_VIEWPORT_MESSAGE } from "../scripts/demo-viewport";
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
const COPY_FEEDBACK_MS = 2_000;
const COPY_RESET_MS = 250;
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
	const onboarding = useCliOnboarding(demoBarStage === "visible", {
		mode: "demo",
	});
	useEffect(() => {
		if (demoBarStage !== "visible" || !onboarding.personalView) return;
		const id = onboarding.setupSnapshot?.id;
		if (!id) return;
		window.location.assign(
			cliSetupUrl(
				id,
				window.location.origin,
				onboarding.authorization?.userCode,
			),
		);
	}, [
		demoBarStage,
		onboarding.personalView,
		onboarding.setupSnapshot?.id,
		onboarding.authorization,
	]);
	const [isCopied, setIsCopied] = useState(false);
	const [isCopying, setIsCopying] = useState(false);
	const [copyError, setCopyError] = useState(false);
	const [isCopyResetting, setIsCopyResetting] = useState(false);
	const stageRef = useRef<DemoStage>("landing");
	const activeSweepRef = useRef<SweepHandle | null>(null);
	const domSnapshotRef = useRef<DemoDomSnapshot | null>(null);
	const copyFeedbackTimerRef = useRef<number | null>(null);
	const copyResetTimerRef = useRef<number | null>(null);
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

	const copySetupCommand = useCallback(
		async (copyButton: HTMLButtonElement) => {
			if (isCopying) return;
			setIsCopying(true);
			setIsCopied(false);
			setCopyError(false);
			let success = false;
			try {
				success = await onboarding.copyCommand();
			} finally {
				setIsCopying(false);
				setCopyError(!success);
			}
			if (!success) return;

			copyButton.dispatchEvent(
				new CustomEvent("opaline:install-command-copied", { bubbles: true }),
			);

			if (copyFeedbackTimerRef.current !== null) {
				window.clearTimeout(copyFeedbackTimerRef.current);
			}
			if (copyResetTimerRef.current !== null) {
				window.clearTimeout(copyResetTimerRef.current);
			}
			setIsCopyResetting(false);
			setIsCopied(true);
			copyFeedbackTimerRef.current = window.setTimeout(() => {
				copyFeedbackTimerRef.current = null;
				setIsCopied(false);
				setIsCopyResetting(true);
				copyResetTimerRef.current = window.setTimeout(() => {
					copyResetTimerRef.current = null;
					setIsCopyResetting(false);
				}, COPY_RESET_MS);
			}, COPY_FEEDBACK_MS);
		},
		[isCopying, onboarding.copyCommand],
	);

	const moveCommandGlow = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			const glow = event.currentTarget.querySelector<HTMLElement>(
				"[data-instant-v2-demo-command-glow]",
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
			if (copyFeedbackTimerRef.current !== null) {
				window.clearTimeout(copyFeedbackTimerRef.current);
			}
			if (copyResetTimerRef.current !== null) {
				window.clearTimeout(copyResetTimerRef.current);
			}
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
			{onboarding.setupSnapshot?.repositories.some(
				(repository) => repository.enabled,
			) ? (
				<div className="cli-setup-status" aria-live="polite">
					<CliConnectionStatus
						snapshot={onboarding.setupSnapshot}
						tone={getCliConnectionTone(
							onboarding.setupSnapshot,
							onboarding.setupInactive,
							onboarding.error,
						)}
						opening={onboarding.opening}
					/>
				</div>
			) : (
				<div className="instant-v2-demo-command-group">
					<span className="instant-v2-demo-command-context instant-v2-demo-command-context-before">
						Start with your sessions by pasting
					</span>
					<button
						aria-busy={isCopying}
						aria-label={
							isCopying
								? "Copying setup command…"
								: isCopied
									? "Copied — paste into your terminal"
									: `Copy setup command: ${onboarding.displayCommand}`
						}
						className="instant-v2-demo-command"
						data-marketing-install-source="demo_bar"
						data-copied={isCopied ? "true" : undefined}
						data-copy-resetting={isCopyResetting ? "true" : undefined}
						disabled={
							demoBarStage !== "visible" || !onboarding.ready || isCopying
						}
						onClick={(event) => void copySetupCommand(event.currentTarget)}
						onPointerMove={moveCommandGlow}
						title={
							isCopied
								? "Copied — paste into your terminal"
								: "Copy setup command"
						}
						type="button"
					>
						<span
							aria-hidden="true"
							className="instant-v2-demo-command-opalescence"
							data-instant-v2-demo-command-glow
						/>
						<span
							aria-hidden="true"
							className="instant-v2-demo-command-glass"
						/>
						<span className="instant-v2-demo-copy-content">
							<svg
								aria-hidden="true"
								className="instant-v2-demo-copy-icon"
								fill="none"
								viewBox="0 0 24 24"
								xmlns="http://www.w3.org/2000/svg"
							>
								<rect
									className="instant-v2-demo-copy-icon-lower"
									height="10.5"
									rx="2"
									stroke="currentColor"
									strokeWidth="1.5"
									width="10.5"
									x="4.75"
									y="8.75"
								/>
								<g mask="url(#instant-v2-demo-copy-icon-mask)">
									<rect
										className="instant-v2-demo-copy-icon-upper"
										height="10.5"
										rx="2"
										stroke="currentColor"
										strokeWidth="1.5"
										width="10.5"
										x="8.75"
										y="4.75"
									/>
								</g>
								<path
									className="instant-v2-demo-copy-icon-check"
									d="M9.25 12.25L11 14.25L15 10"
									pathLength="1"
									stroke="currentColor"
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth="1.5"
								/>
								<mask
									id="instant-v2-demo-copy-icon-mask"
									maskUnits="userSpaceOnUse"
								>
									<rect fill="#fff" height="24" width="24" />
									<rect
										className="instant-v2-demo-copy-icon-mask-shape"
										fill="#000"
										height="10.5"
										rx="2"
										stroke="#000"
										strokeWidth="1.5"
										width="10.5"
										x="4.75"
										y="8.75"
									/>
								</mask>
							</svg>
							<span className="instant-v2-demo-copy-full">
								{onboarding.displayCommand}
							</span>
							<span aria-hidden="true" className="instant-v2-demo-copy-short">
								npx…
							</span>
						</span>
					</button>
					<span className="instant-v2-demo-command-context instant-v2-demo-command-context-after">
						into your terminal
					</span>
				</div>
			)}
			{copyError && !onboarding.error ? (
				<p className="instant-v2-demo-connection-error" role="alert">
					Could not copy the command. Allow clipboard access and try again.
				</p>
			) : null}
			{onboarding.error ? (
				<output className="instant-v2-demo-connection-error">
					{onboarding.error}{" "}
					<button type="button" onClick={() => void onboarding.retry()}>
						Retry
					</button>
				</output>
			) : null}
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
