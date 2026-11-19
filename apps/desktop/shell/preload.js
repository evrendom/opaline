const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("opalineDesktop", {
	introReady: () => ipcRenderer.send("app:intro-ready"),
	retryStart: () => ipcRenderer.send("app:retry-start"),
	...(process.argv.includes("--opaline-debug") ? { replayOpen: () => ipcRenderer.send("app:replay-open") } : {}),
});

let swatch;

function toHex(color) {
	swatch ??= new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
	swatch.clearRect(0, 0, 1, 1);
	swatch.fillStyle = color;
	swatch.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = swatch.getImageData(0, 0, 1, 1).data;
	if (a === 0) return;
	return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function paintedBackground() {
	for (const element of [document.documentElement, document.body]) {
		if (!element) continue;
		const color = toHex(getComputedStyle(element).backgroundColor);
		if (color) return color;
	}
}

let reported;

function reportBackground() {
	const color = paintedBackground();
	if (!color || color === reported) return;
	reported = color;
	ipcRenderer.send("app:background", color);
}

function quietElement(element) {
	if (element.localName === "title" && element.parentElement instanceof SVGElement) {
		const owner = element.parentElement;
		const text = element.textContent?.trim();
		if (text && !owner.hasAttribute("aria-label")) owner.setAttribute("aria-label", text);
		element.remove();
		return;
	}
	const title = element.getAttribute("title");
	if (title === null) return;
	if (title.trim() && !element.hasAttribute("aria-label") && !element.textContent?.trim()) element.setAttribute("aria-label", title);
	element.removeAttribute("title");
}

function quietTree(node) {
	if (!(node instanceof Element)) return;
	quietElement(node);
	for (const element of node.querySelectorAll("[title], svg title")) quietElement(element);
}

function silenceTooltips() {
	quietTree(document.documentElement);
	new MutationObserver((records) => {
		for (const record of records) {
			if (record.type === "attributes") quietElement(record.target);
			else for (const node of record.addedNodes) quietTree(node);
		}
	}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
}

window.addEventListener("DOMContentLoaded", () => {
	silenceTooltips();
	reportBackground();
	const watch = { attributes: true, attributeFilter: ["class", "style", "data-app-shell", "data-boot"] };
	const observer = new MutationObserver(reportBackground);
	observer.observe(document.documentElement, watch);
	observer.observe(document.body, watch);
	matchMedia("(prefers-color-scheme: dark)").addEventListener("change", reportBackground);
});
