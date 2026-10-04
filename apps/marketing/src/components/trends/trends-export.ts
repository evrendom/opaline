import interLatinUrl from "../../assets/fonts/inter-variable-latin.woff2?url";
import wordmarkUrl from "../../assets/opaline-wordmark-nav-small.svg?url";
import wordmarkDarkUrl from "../../assets/opaline-wordmark-nav-small-dark.svg?url";

/*
 * Exports the scatter as a PNG card: the Opaline brand, the chart's title
 * and view, the plot with its model list exactly as drawn, and a footer
 * with the source and opaline.so/trends. The plot is cloned from the page
 * with every computed style inlined, so it keeps the current colours (light
 * or dark) without the page's stylesheet; Inter is embedded, since an SVG
 * drawn as an image can't load fonts of its own.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const PAD = 40;
const SCALE = 2;

// What the page's CSS decides on SVG marks, carried over as inline style.
const STYLE_PROPS = [
	"fill",
	"fill-opacity",
	"fill-rule",
	"stroke",
	"stroke-opacity",
	"stroke-width",
	"stroke-dasharray",
	"stroke-dashoffset",
	"stroke-linecap",
	"stroke-linejoin",
	"opacity",
	"stop-color",
	"stop-opacity",
	"font-family",
	"font-size",
	"font-weight",
	"font-variant-numeric",
	"letter-spacing",
	"text-anchor",
	"dominant-baseline",
	"paint-order",
	"r",
	"cx",
	"cy",
	"rx",
	"ry",
] as const;

const COLOR_PROPS = new Set(["fill", "stroke", "stop-color"]);

export interface ChartExport {
	/** The chart's container: the scatter's (holding its plot's SVG), or the
	 * bars', drawn as HTML and carried over whole. */
	readonly container: HTMLElement;
	readonly title: string;
	/** The view, e.g. "Log scale · Pareto frontier". */
	readonly subtitle: string;
	readonly source: string;
	readonly updated: string;
	readonly fileName: string;
}

export async function exportChartPng(chart: ChartExport) {
	const plot = chart.container.querySelector<SVGSVGElement>(":scope > svg");
	await settled(4000);
	const box = (plot ?? chart.container).getBoundingClientRect();
	const app = chart.container.closest<HTMLElement>(".trends-app");
	const appStyle = getComputedStyle(app ?? document.body);
	const surface = appStyle.backgroundColor;
	const ink = colorOf("--color-ink-strong", app);
	const muted = colorOf("--color-ink-muted", app);
	const line = colorOf("--color-line", app);
	const dark = matchMedia("(prefers-color-scheme: dark)").matches;

	const [fontData, wordmark] = await Promise.all([
		dataUrl(interLatinUrl, "font/woff2"),
		dataUrl(dark ? wordmarkDarkUrl : wordmarkUrl, "image/svg+xml"),
	]);

	const legend = legendRows(box);
	const axisTitle = chart.container.querySelector<HTMLElement>(
		".trends-plot-axis-title",
	);
	const axisBox = axisTitle?.getBoundingClientRect();
	const contentWidth = Math.max(
		box.width,
		...legend.map((row) => row.right),
		axisBox ? axisBox.right - box.left : 0,
	);
	const plotHeight = Math.max(
		box.height,
		axisBox ? axisBox.bottom - box.top : 0,
	);
	const headerHeight = 112;
	const footerHeight = 64;
	// The plot leaves room above its box for the page's title, which the
	// header takes over here.
	const plotTop = headerHeight - 8;
	const width = Math.ceil(contentWidth + PAD * 2);
	const height = Math.ceil(plotTop + plotHeight + footerHeight);

	const svg = element("svg", {
		xmlns: SVG_NS,
		width,
		height,
		viewBox: `0 0 ${width} ${height}`,
	});
	const style = element("style");
	style.textContent = `@font-face{font-family:"Inter Variable";font-weight:100 900;src:url(${fontData}) format("woff2");}text{font-feature-settings:"cv02","cv03","cv04","cv11","ss01","ss03";}`;
	svg.append(style);
	svg.append(
		element("rect", { width, height, fill: srgb(surface) }),
		// Brand, as in the app's top bar: the wordmark, a divider, "Trends".
		element("image", {
			href: wordmark,
			x: PAD,
			y: PAD - 4,
			width: 80,
			height: 20,
		}),
		element("rect", {
			x: PAD + 92,
			y: PAD - 2,
			width: 1,
			height: 16,
			fill: srgb(line),
		}),
		text("Trends", {
			x: PAD + 105,
			y: PAD + 6,
			size: 15,
			weight: 550,
			fill: ink,
		}),
		text(chart.title, {
			x: PAD,
			y: PAD + 44,
			size: 20,
			weight: 600,
			fill: ink,
		}),
		text(chart.subtitle, {
			x: PAD,
			y: PAD + 68,
			size: 13,
			weight: 450,
			fill: muted,
		}),
	);

	const content = element("g", { transform: `translate(${PAD} ${plotTop})` });
	if (plot) {
		const clone = plot.cloneNode(true) as SVGSVGElement;
		inlineStyles(plot, clone);
		clone.setAttribute("x", "0");
		clone.setAttribute("y", "0");
		clone.setAttribute("overflow", "visible");
		clone.removeAttribute("class");
		content.append(clone);
	}
	// The bars, their axis title and comparison panel included; their
	// columns are buttons, so they stay.
	else content.append(htmlLayer(chart.container, box, true));
	if (plot && axisTitle && axisBox) {
		const axisStyle = getComputedStyle(axisTitle);
		content.append(
			text(axisTitle.dataset.label ?? axisTitle.textContent ?? "", {
				x: axisBox.left + axisBox.width / 2 - box.left,
				y: axisBox.top + axisBox.height / 2 - box.top,
				size: Number.parseFloat(axisStyle.fontSize),
				weight: 400,
				fill: axisStyle.color,
				anchor: "middle",
			}),
		);
	}
	for (const row of legend) content.append(row.node);
	// The comparison panel, when points are compared: HTML, carried over
	// whole with its computed styles.
	const compare = chart.container.querySelector<HTMLElement>(
		'.trends-compare[data-open="true"]',
	);
	if (plot && compare && Number(getComputedStyle(compare).opacity) > 0)
		content.append(htmlLayer(compare, box));
	svg.append(content);

	const footerY = height - footerHeight + 8;
	svg.append(
		element("rect", {
			x: PAD,
			y: footerY,
			width: width - PAD * 2,
			height: 1,
			fill: srgb(line),
		}),
		text(`Source: ${chart.source} · ${chart.updated}`, {
			x: PAD,
			y: footerY + 28,
			size: 12,
			weight: 450,
			fill: muted,
		}),
		text("opaline.so/trends", {
			x: width - PAD,
			y: footerY + 28,
			size: 12,
			weight: 500,
			fill: ink,
			anchor: "end",
		}),
	);

	const blob = await rasterize(svg, width, height);
	const link = document.createElement("a");
	link.href = URL.createObjectURL(blob);
	link.download = chart.fileName;
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/**
 * Waits until nothing is animating, endless animations aside: the chart
 * draws in stages (dots, then lines, then leaders), so new animations can
 * start as earlier ones end. Gives up after `limit` milliseconds.
 */
async function settled(limit: number) {
	const deadline = performance.now() + limit;
	const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
	const running = () =>
		document
			.getAnimations()
			.filter(
				(animation) =>
					animation.playState !== "finished" &&
					animation.effect?.getTiming().iterations !== Infinity,
			);
	while (performance.now() < deadline) {
		const now = running();
		if (now.length === 0) {
			await frame();
			await frame();
			if (running().length === 0) return;
			continue;
		}
		await Promise.race([
			Promise.all(now.map((animation) => animation.finished.catch(() => {}))),
			new Promise((resolve) =>
				setTimeout(resolve, Math.max(0, deadline - performance.now())),
			),
		]);
	}
}

/** The model list beside the plot, as SVG in the plot's coordinates. */
function legendRows(box: DOMRect) {
	const rows = document.querySelectorAll<HTMLElement>(
		".trends-models-legend .trends-picker-group .trends-picker-model",
	);
	return [...rows].flatMap((row) => {
		const rowStyle = getComputedStyle(row);
		const alpha = Number(rowStyle.opacity) * filterOpacity(rowStyle.filter);
		const dot = row.querySelector<HTMLInputElement>(".trends-picker-dot");
		const name = row.querySelector<HTMLElement>(".trends-picker-name");
		if (alpha < 0.02 || !dot || !name) return [];
		const group = element("g", { opacity: alpha.toFixed(3) });
		const dotBox = dot.getBoundingClientRect();
		const dotStyle = getComputedStyle(dot);
		const cx = dotBox.left + dotBox.width / 2 - box.left;
		const cy = dotBox.top + dotBox.height / 2 - box.top;
		const radius = dotBox.width / 2;
		const key = srgb(dotStyle.borderTopColor);
		group.append(
			element("circle", {
				cx,
				cy,
				r: radius - 0.75,
				fill: "none",
				stroke: key,
				"stroke-width": 1.5,
				opacity: dotStyle.opacity,
			}),
		);
		if (dot.checked)
			group.append(element("circle", { cx, cy, r: radius - 3, fill: key }));
		const mark = row.querySelector<SVGSVGElement>("svg.trends-mark");
		if (mark) {
			const markBox = mark.getBoundingClientRect();
			const markClone = mark.cloneNode(true) as SVGSVGElement;
			inlineStyles(mark, markClone);
			markClone.setAttribute("x", String(markBox.left - box.left));
			markClone.setAttribute("y", String(markBox.top - box.top));
			markClone.setAttribute("width", String(markBox.width));
			markClone.setAttribute("height", String(markBox.height));
			markClone.removeAttribute("class");
			group.append(markClone);
		}
		const nameBox = name.getBoundingClientRect();
		const nameStyle = getComputedStyle(name);
		group.append(
			text(name.textContent ?? "", {
				x: nameBox.left - box.left,
				y: nameBox.top + nameBox.height / 2 - box.top,
				size: Number.parseFloat(nameStyle.fontSize),
				weight: Number.parseFloat(nameStyle.fontWeight),
				fill: nameStyle.color,
			}),
		);
		return [{ node: group, right: nameBox.right - box.left }];
	});
}

// Colour properties of HTML elements, clipped to sRGB like the marks'.
const HTML_COLOR_PROPS = new Set([
	"color",
	"background-color",
	"border-top-color",
	"border-right-color",
	"border-bottom-color",
	"border-left-color",
	"outline-color",
	"text-decoration-color",
	"fill",
	"stroke",
	"stop-color",
	"caret-color",
	"column-rule-color",
]);

/**
 * An HTML element as a foreignObject at its place over the plot: a deep
 * clone with every computed style inlined, set in place of its own
 * positioning. Backdrop blur doesn't survive; the panel's fill is nearly
 * opaque anyway.
 */
function htmlLayer(source: HTMLElement, box: DOMRect, keepButtons = false) {
	const rect = source.getBoundingClientRect();
	// Room around it, so its ring and shadow aren't clipped at the edge.
	const bleed = 24;
	const layer = element("foreignObject", {
		x: rect.left - box.left - bleed,
		y: rect.top - box.top - bleed,
		width: Math.ceil(rect.width) + bleed * 2,
		height: Math.ceil(rect.height) + bleed * 2,
	});
	const clone = source.cloneNode(true) as HTMLElement;
	copyComputed(source, clone);
	// Controls don't belong in a picture (a chart drawn as buttons keeps
	// them).
	if (!keepButtons)
		for (const control of clone.querySelectorAll("button")) control.remove();
	clone.removeAttribute("id");
	clone.style.position = "static";
	clone.style.inset = "auto";
	clone.style.margin = "0";
	clone.style.transform = "none";
	clone.style.opacity = "1";
	clone.style.width = `${rect.width}px`;
	clone.style.height = `${rect.height}px`;
	clone.style.maxWidth = "none";
	const wrapper = document.createElementNS(
		"http://www.w3.org/1999/xhtml",
		"div",
	);
	wrapper.setAttribute("style", `padding:${bleed}px`);
	wrapper.append(clone);
	layer.append(wrapper);
	return layer;
}

function copyComputed(source: Element, target: Element) {
	const style = getComputedStyle(source);
	const declarations: string[] = [];
	for (const property of style) {
		if (property.startsWith("animation") || property.startsWith("transition"))
			continue;
		const value = style.getPropertyValue(property);
		declarations.push(
			`${property}:${HTML_COLOR_PROPS.has(property) ? srgb(value) : value}`,
		);
	}
	target.setAttribute("style", declarations.join(";"));
	const sources = [...source.children];
	const targets = [...target.children];
	sources.forEach((child, index) => {
		const twin = targets[index];
		if (twin) copyComputed(child, twin);
	});
}

/** Copies each mark's computed style onto its clone; drops what isn't shown. */
function inlineStyles(source: Element, target: Element) {
	const style = getComputedStyle(source);
	if (style.display === "none" || style.visibility === "hidden") {
		target.remove();
		return;
	}
	if (Number(style.opacity) === 0) {
		target.remove();
		return;
	}
	const declarations = STYLE_PROPS.map((property) => {
		const value = style.getPropertyValue(property);
		return `${property}:${COLOR_PROPS.has(property) ? srgb(value) : value}`;
	});
	if (style.transform !== "none")
		declarations.push(
			`transform:${style.transform}`,
			`transform-origin:${style.transformOrigin}`,
			`transform-box:${style.getPropertyValue("transform-box")}`,
		);
	target.setAttribute("style", declarations.join(";"));
	const sources = [...source.children];
	const targets = [...target.children];
	sources.forEach((child, index) => {
		const twin = targets[index];
		if (twin) inlineStyles(child, twin);
	});
}

/*
 * Model colours are oklch, some outside sRGB. Chrome clips those on the page
 * but wraps them when the SVG is drawn as an image (a pale orange turns
 * cyan), so every colour goes through a canvas pixel, which clips, first.
 */
const srgbCache = new Map<string, string>();
let srgbContext: CanvasRenderingContext2D | null = null;

function srgb(color: string) {
	if (!color || color === "none" || color.startsWith("url(")) return color;
	const cached = srgbCache.get(color);
	if (cached) return cached;
	srgbContext ??= document
		.createElement("canvas")
		.getContext("2d", { willReadFrequently: true });
	if (!srgbContext) return color;
	srgbContext.clearRect(0, 0, 1, 1);
	srgbContext.fillStyle = "#000";
	srgbContext.fillStyle = color;
	srgbContext.fillRect(0, 0, 1, 1);
	const [red, green, blue, alpha] = srgbContext.getImageData(0, 0, 1, 1).data;
	const result = `rgb(${red} ${green} ${blue} / ${((alpha ?? 255) / 255).toFixed(3)})`;
	srgbCache.set(color, result);
	return result;
}

function filterOpacity(filter: string) {
	const match = /opacity\(([\d.]+)(%?)\)/.exec(filter);
	if (!match) return 1;
	const value = Number(match[1]);
	return match[2] === "%" ? value / 100 : value;
}

function colorOf(variable: string, scope: Element | null) {
	const probe = document.createElement("span");
	probe.style.color = `var(${variable})`;
	(scope ?? document.body).append(probe);
	const color = getComputedStyle(probe).color;
	probe.remove();
	return color;
}

function element(
	name: string,
	attributes: Record<string, string | number> = {},
) {
	const node = document.createElementNS(SVG_NS, name);
	for (const [key, value] of Object.entries(attributes))
		node.setAttribute(key, String(value));
	return node;
}

function text(
	content: string,
	options: {
		x: number;
		y: number;
		size: number;
		weight: number;
		fill: string;
		anchor?: "start" | "middle" | "end";
	},
) {
	const node = element("text", {
		x: options.x,
		y: options.y,
		fill: srgb(options.fill),
		"font-family": '"Inter Variable", Inter, system-ui, sans-serif',
		"font-size": options.size,
		"font-weight": options.weight,
		"dominant-baseline": "central",
		"text-anchor": options.anchor ?? "start",
	});
	node.textContent = content;
	return node;
}

async function dataUrl(url: string, type: string) {
	const buffer = await (await fetch(url)).arrayBuffer();
	let binary = "";
	const bytes = new Uint8Array(buffer);
	for (let index = 0; index < bytes.length; index += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	return `data:${type};base64,${btoa(binary)}`;
}

async function rasterize(svg: SVGElement, width: number, height: number) {
	const source = new XMLSerializer().serializeToString(svg);
	const image = new Image();
	// A data URL: with the comparison panel's HTML (a foreignObject) inside,
	// it draws to the canvas without tainting it.
	image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
	await image.decode();
	const canvas = document.createElement("canvas");
	canvas.width = width * SCALE;
	canvas.height = height * SCALE;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("No 2D canvas");
	context.scale(SCALE, SCALE);
	context.drawImage(image, 0, 0, width, height);
	return new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))),
			"image/png",
		),
	);
}
