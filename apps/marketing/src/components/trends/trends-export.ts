import interLatinUrl from "../../assets/fonts/inter-variable-latin.woff2?url";
import wordmarkUrl from "../../assets/opaline-trends-wordmark.svg?url";
import wordmarkDarkUrl from "../../assets/opaline-trends-wordmark-dark.svg?url";

/*
 * Exports a chart as a PNG card: the Opaline Trends wordmark, the chart's
 * title, the plot with its model list exactly as drawn, and a footer with
 * the source and opaline.so/trends. The plot is cloned from the page with
 * every computed style inlined, so it keeps the current colours (light or
 * dark) without the page's stylesheet; Inter is embedded, since an SVG
 * drawn as an image can't load fonts of its own.
 *
 * The card is laid out around what the chart draws, not its boxes (the
 * plot keeps room for hidden ticks, the model list's rows are wider than
 * their names): equal margins left and right, the header and footer
 * aligned with the chart's edges.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const PAD_X = 48;
const PAD_TOP = 40;
const PAD_BOTTOM = 36;
const WORDMARK_HEIGHT = 20;
// The wordmark's own proportions (112.191 × 16).
const WORDMARK_WIDTH = (WORDMARK_HEIGHT * 112.191) / 16;
const TITLE_SIZE = 20;
const FOOTER_SIZE = 12;
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

// The marks whose boxes make up what a plot draws.
const SHAPES =
	"path, line, rect, circle, ellipse, polyline, polygon, text, image, use";

export interface ChartExport {
	/** The chart's container: the scatter's (holding its plot's SVG), or the
	 * bars', drawn as HTML and carried over whole. */
	readonly container: HTMLElement;
	/** The title with the view after commas, e.g. "Intelligence index by
	 * cost per task (USD), Pareto frontier". */
	readonly title: string;
	readonly source: string;
	readonly updated: string;
	readonly fileName: string;
}

export async function exportChartPng(chart: ChartExport) {
	const blob = await chartCardPng(await buildChartCard(chart));
	const link = document.createElement("a");
	link.href = URL.createObjectURL(blob);
	link.download = chart.fileName;
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** The card as an SVG, before it is drawn to a PNG. */
export interface ChartCard {
	readonly svg: SVGSVGElement;
	readonly width: number;
	readonly height: number;
}

export function chartCardPng(card: ChartCard) {
	return rasterize(card.svg, card.width, card.height);
}

/** A region in the plot's coordinates (its box's top left is 0, 0). */
interface Ink {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export async function buildChartCard(chart: ChartExport): Promise<ChartCard> {
	const plot = chart.container.querySelector<SVGSVGElement>(":scope > svg");
	await settled(4000);
	const box = (plot ?? chart.container).getBoundingClientRect();
	const app = chart.container.closest<HTMLElement>(".trends-app");
	const appStyle = getComputedStyle(app ?? document.body);
	const surface = appStyle.backgroundColor;
	const ink = colorOf("--color-ink-strong", app);
	const muted = colorOf("--color-ink-muted", app);
	const dark = document.documentElement.classList.contains("dark");

	const [fontData, wordmark] = await Promise.all([
		dataUrl(interLatinUrl, "font/woff2"),
		dataUrl(dark ? wordmarkDarkUrl : wordmarkUrl, "image/svg+xml"),
	]);

	const legend = legendRows(box);
	const axisTitle = chart.container.querySelector<HTMLElement>(
		".trends-plot-axis-title",
	);
	const axisBox = axisTitle?.getBoundingClientRect();
	const compare = chart.container.querySelector<HTMLElement>(
		'.trends-compare[data-open="true"]',
	);
	const compareShown =
		plot !== null &&
		compare !== null &&
		Number(getComputedStyle(compare).opacity) > 0;

	// What the chart draws: the plot's marks (or the HTML chart's bars,
	// figures and labels), the model list's dots and names, the axis title
	// and the comparison panel.
	const drawn = drawnInk(plot ?? chart.container, box, surface);
	for (const row of legend) grow(drawn, row.ink);
	if (plot && axisTitle && axisBox)
		grow(drawn, relative(textBox(axisTitle) ?? axisBox, box));
	if (compareShown && compare)
		grow(drawn, relative(compare.getBoundingClientRect(), box));
	const drawnWidth = drawn.right - drawn.left;
	const drawnHeight = drawn.bottom - drawn.top;

	const title = chart.title;
	const source = `Source: ${chart.source} · ${chart.updated}`;
	const link = "opaline.so/trends";
	// Wide enough for the title and the footer, should the chart be narrow.
	const width = Math.ceil(
		Math.max(
			drawnWidth,
			textWidth(title, TITLE_SIZE, 600),
			textWidth(source, FOOTER_SIZE, 450) +
				32 +
				textWidth(link, FOOTER_SIZE, 500),
		) +
			PAD_X * 2,
	);
	// The chart centred; the header and footer on its edges.
	const left = (width - drawnWidth) / 2;
	const right = left + drawnWidth;
	const titleY = PAD_TOP + WORDMARK_HEIGHT + 30;
	const contentTop = titleY + TITLE_SIZE / 2 + 26;
	const footerY = contentTop + drawnHeight + 36;
	const height = Math.ceil(footerY + FOOTER_SIZE / 2 + PAD_BOTTOM);

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
		element("image", {
			href: wordmark,
			x: left,
			y: PAD_TOP,
			width: WORDMARK_WIDTH,
			height: WORDMARK_HEIGHT,
		}),
		text(title, {
			x: left,
			y: titleY,
			size: TITLE_SIZE,
			weight: 600,
			fill: ink,
		}),
	);

	const content = element("g", {
		transform: `translate(${left - drawn.left} ${contentTop - drawn.top})`,
	});
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
	if (compareShown && compare) content.append(htmlLayer(compare, box));
	svg.append(content);

	svg.append(
		text(source, {
			x: left,
			y: footerY,
			size: FOOTER_SIZE,
			weight: 450,
			fill: muted,
		}),
		text(link, {
			x: right,
			y: footerY,
			size: FOOTER_SIZE,
			weight: 500,
			fill: ink,
			anchor: "end",
		}),
	);

	return { svg: svg as SVGSVGElement, width, height };
}

/**
 * The region a chart's visible marks cover, not its boxes: an SVG plot's
 * painted shapes (not its hidden ticks, nor transparent hit areas), an
 * HTML chart's text and the elements that paint a fill, border or shadow
 * other than the card's surface.
 */
function drawnInk(root: Element, box: DOMRect, surface: string): Ink {
	const ink: Ink = {
		left: Number.POSITIVE_INFINITY,
		top: Number.POSITIVE_INFINITY,
		right: Number.NEGATIVE_INFINITY,
		bottom: Number.NEGATIVE_INFINITY,
	};
	const add = (rect: DOMRect) => {
		if (rect.width > 0 || rect.height > 0) grow(ink, relative(rect, box));
	};
	const visit = (node: Element) => {
		if (
			!node.checkVisibility({ opacityProperty: true, visibilityProperty: true })
		)
			return;
		const style = getComputedStyle(node);
		if (node instanceof SVGElement) {
			if (
				node.matches(SHAPES) &&
				(painted(style.fill) || painted(style.stroke))
			)
				add(node.getBoundingClientRect());
		} else if (surfaced(style, surface)) add(node.getBoundingClientRect());
		for (const child of node.childNodes) {
			if (child instanceof Element) visit(child);
			else if (
				child.nodeType === Node.TEXT_NODE &&
				!(node instanceof SVGElement) &&
				child.textContent?.trim()
			) {
				const range = document.createRange();
				range.selectNodeContents(child);
				add(range.getBoundingClientRect());
			}
		}
	};
	visit(root);
	// Nothing drawn: the chart's box.
	return Number.isFinite(ink.left)
		? ink
		: { left: 0, top: 0, right: box.width, bottom: box.height };
}

/** Whether an HTML element paints anything of its own on the card. */
function surfaced(style: CSSStyleDeclaration, surface: string) {
	const fill = style.backgroundColor;
	if (painted(fill) && srgb(fill) !== srgb(surface)) return true;
	if (style.backgroundImage !== "none" || style.boxShadow !== "none")
		return true;
	return (["Top", "Right", "Bottom", "Left"] as const).some(
		(side) =>
			Number.parseFloat(style[`border${side}Width`]) > 0 &&
			painted(style[`border${side}Color`]),
	);
}

function painted(paint: string) {
	if (!paint || paint === "none") return false;
	if (paint.startsWith("url(")) return true;
	const alpha = /\/\s*([\d.]+)\)$/.exec(srgb(paint));
	return !alpha || Number(alpha[1]) > 0;
}

function grow(ink: Ink, region: Ink) {
	ink.left = Math.min(ink.left, region.left);
	ink.top = Math.min(ink.top, region.top);
	ink.right = Math.max(ink.right, region.right);
	ink.bottom = Math.max(ink.bottom, region.bottom);
}

function relative(rect: DOMRect | Ink, box: DOMRect): Ink {
	return {
		left: rect.left - box.left,
		top: rect.top - box.top,
		right: rect.right - box.left,
		bottom: rect.bottom - box.top,
	};
}

/** The box of an element's text itself, narrower than a block's. */
function textBox(node: Element) {
	const range = document.createRange();
	range.selectNodeContents(node);
	const rect = range.getBoundingClientRect();
	return rect.width > 0 ? rect : null;
}

let measureContext: CanvasRenderingContext2D | null = null;

function textWidth(content: string, size: number, weight: number) {
	measureContext ??= document.createElement("canvas").getContext("2d");
	if (!measureContext) return 0;
	measureContext.font = `${weight} ${size}px "Inter Variable", Inter, system-ui, sans-serif`;
	return measureContext.measureText(content).width;
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

/**
 * The model list beside the plot, as SVG in the plot's coordinates: its
 * rows (a dot when shown, the maker's mark, the name) and its group
 * headings (the harness chart's Claude Code, Codex and other models).
 */
function legendRows(box: DOMRect) {
	const rows = document.querySelectorAll<HTMLElement>(
		".trends-models-legend .trends-picker-group :is(.trends-picker-model, .trends-picker-company-name)",
	);
	return [...rows].flatMap((row) => {
		const rowStyle = getComputedStyle(row);
		const alpha = Number(rowStyle.opacity) * filterOpacity(rowStyle.filter);
		const label = rowLabel(row);
		if (
			alpha < 0.02 ||
			!label ||
			!row.checkVisibility({ opacityProperty: true, visibilityProperty: true })
		)
			return [];
		const group = element("g", { opacity: alpha.toFixed(3) });
		const ink: Ink = relative(label.box, box);
		const dot = row.querySelector<HTMLInputElement>(".trends-picker-dot");
		const dotBox = dot?.getBoundingClientRect();
		const dotStyle = dot ? getComputedStyle(dot) : null;
		if (
			dot &&
			dotBox &&
			dotStyle &&
			dotBox.width > 0 &&
			Number(dotStyle.opacity) > 0
		) {
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
			grow(ink, relative(dotBox, box));
		}
		const mark = row.querySelector<SVGSVGElement>(":scope > svg.trends-mark");
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
			grow(ink, relative(markBox, box));
		}
		group.append(
			text(label.text, {
				x: label.box.left - box.left,
				y: label.box.top + label.box.height / 2 - box.top,
				size: Number.parseFloat(label.style.fontSize),
				weight: Number.parseFloat(label.style.fontWeight),
				fill: label.style.color,
			}),
		);
		return [{ node: group, ink }];
	});
}

/** A legend row's words: a model's name, or a heading's own text. */
function rowLabel(row: HTMLElement) {
	const name = row.querySelector<HTMLElement>(".trends-picker-name");
	if (name) {
		const box = textBox(name) ?? name.getBoundingClientRect();
		return { text: name.textContent ?? "", box, style: getComputedStyle(name) };
	}
	const words = [...row.childNodes].filter(
		(node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
	);
	const first = words[0];
	const last = words.at(-1);
	if (!first || !last) return null;
	const range = document.createRange();
	range.setStartBefore(first);
	range.setEndAfter(last);
	const box = range.getBoundingClientRect();
	if (box.width === 0) return null;
	return {
		text: words.map((node) => node.textContent?.trim()).join(" "),
		box,
		style: getComputedStyle(row),
	};
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
