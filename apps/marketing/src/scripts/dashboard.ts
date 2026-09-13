const shell = document.querySelector<HTMLElement>(
	'[data-opaline-dashboard-part="crm-window-shell"]',
);
const sceneButtons = Array.from(
	document.querySelectorAll<HTMLButtonElement>("[data-opaline-use-case]"),
);
let pendingSceneChange = 0;
// Median measured from the settled 4180 composition's selected-state to panel
// replacement transition (three rAF-observed runs: 32.7, 36.3, 38.6 ms).
const panelSwapDelayMs = 36;

const fitInstantV2Panel = (
	panel: HTMLElement,
	scaleWrapper: HTMLElement,
	scale: number,
) => {
	if (!panel.closest("[data-instant-v2-product-window]")) return;

	const viewport = panel.parentElement;
	const grid = scaleWrapper.firstElementChild;
	if (!(viewport instanceof HTMLElement) || !(grid instanceof HTMLElement))
		return;
	const frame = panel.closest<HTMLElement>("[data-instant-v2-window]");
	if (!frame) return;

	viewport.style.removeProperty("height");

	const contentHeight = Array.from(grid.children).reduce((maxHeight, child) => {
		if (!(child instanceof HTMLElement)) return maxHeight;
		return Math.max(maxHeight, child.offsetTop + child.scrollHeight);
	}, grid.scrollHeight);
	const frameStyle = getComputedStyle(frame);
	const frameInsets =
		Number.parseFloat(frameStyle.paddingTop) +
		Number.parseFloat(frameStyle.paddingBottom);
	const navHeight =
		document
			.querySelector<HTMLElement>(".instant-v2-nav")
			?.getBoundingClientRect().height ?? 42;
	const showcase = panel.closest<HTMLElement>(".instant-v2-showcase");
	const bottomInset = showcase
		? Math.max(
				0,
				(document.documentElement.clientWidth -
					showcase.getBoundingClientRect().width) /
					2,
			)
		: 0;
	const availableHeight = Math.max(
		0,
		document.documentElement.clientHeight -
			navHeight -
			frameInsets -
			bottomInset,
	);
	const viewportHeight = Math.max(
		Math.ceil(contentHeight * scale),
		availableHeight,
	);

	if (scale < 1) {
		scaleWrapper.style.height = `${Math.ceil(viewportHeight / scale)}px`;
	}
	viewport.style.height = `${viewportHeight}px`;
};

const normalizePanelViewport = (panel: HTMLElement | null) => {
	const scaleWrapper =
		panel?.firstElementChild?.firstElementChild?.firstElementChild;
	if (!(scaleWrapper instanceof HTMLElement) || !panel) return;

	const shouldFillPanel = window.innerWidth < 992 || panel.clientWidth >= 1152;
	if (shouldFillPanel) {
		scaleWrapper.className = "h-full w-full";
		scaleWrapper.removeAttribute("style");
		fitInstantV2Panel(panel, scaleWrapper, 1);
		return;
	}

	scaleWrapper.className = "";
	const scale = panel.clientWidth / 1152;
	scaleWrapper.style.cssText = [
		"height: 625.928px",
		`transform: scale(${scale.toFixed(6)})`,
		"transform-origin: left top",
		"width: 1152px",
	].join("; ");
	fitInstantV2Panel(panel, scaleWrapper, scale);
};

const normalizeCurrentPanelViewport = () => {
	normalizePanelViewport(
		shell?.querySelector<HTMLElement>("[data-opaline-dashboard-panel]") ?? null,
	);
};

const selectScene = (scene: string, focus = false) => {
	if (!shell) return;
	const template = document.querySelector<HTMLTemplateElement>(
		`template[data-opaline-dashboard-panel-template="${CSS.escape(scene)}"]`,
	);
	for (const button of sceneButtons) {
		const selected = button.dataset.opalineUseCase === scene;
		button.setAttribute("aria-selected", String(selected));
		button.tabIndex = selected ? 0 : -1;
	}
	if (focus) {
		sceneButtons
			.find((button) => button.dataset.opalineUseCase === scene)
			?.focus();
	}
	const sceneChange = ++pendingSceneChange;
	setTimeout(() => {
		if (sceneChange !== pendingSceneChange) return;
		const currentPanel = shell.querySelector<HTMLElement>(
			"[data-opaline-dashboard-panel]",
		);
		const nextPanel = template?.content.firstElementChild?.cloneNode(true);
		if (
			!(currentPanel instanceof HTMLElement) ||
			!(nextPanel instanceof HTMLElement)
		)
			return;
		currentPanel.replaceWith(nextPanel);
		normalizePanelViewport(nextPanel);
	}, panelSwapDelayMs);
};

normalizeCurrentPanelViewport();
let observedShellWidth = shell?.clientWidth ?? 0;
const panelResizeObserver = new ResizeObserver(([entry]) => {
	const nextWidth = entry?.contentRect.width ?? shell?.clientWidth ?? 0;
	if (Math.abs(nextWidth - observedShellWidth) < 0.5) return;
	observedShellWidth = nextWidth;
	requestAnimationFrame(normalizeCurrentPanelViewport);
});
if (shell) panelResizeObserver.observe(shell);

let pendingViewportResize = 0;
const handleViewportResize = () => {
	cancelAnimationFrame(pendingViewportResize);
	pendingViewportResize = requestAnimationFrame(normalizeCurrentPanelViewport);
};
window.addEventListener("resize", handleViewportResize, { passive: true });
window.visualViewport?.addEventListener("resize", handleViewportResize, {
	passive: true,
});

for (const button of sceneButtons) {
	button.addEventListener("click", () => {
		if (button.dataset.opalineUseCase) {
			selectScene(button.dataset.opalineUseCase);
		}
	});
	button.addEventListener("keydown", (event) => {
		if (!new Set(["ArrowLeft", "ArrowRight", "Home", "End"]).has(event.key)) {
			return;
		}
		event.preventDefault();
		const currentIndex = sceneButtons.findIndex(
			(candidate) => candidate.getAttribute("aria-selected") === "true",
		);
		const nextIndex =
			event.key === "Home"
				? 0
				: event.key === "End"
					? sceneButtons.length - 1
					: (currentIndex +
							(event.key === "ArrowRight" ? 1 : -1) +
							sceneButtons.length) %
						sceneButtons.length;
		const scene = sceneButtons[nextIndex]?.dataset.opalineUseCase;
		if (scene) selectScene(scene, true);
	});
}
