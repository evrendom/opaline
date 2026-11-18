import { cubicBezier } from "glimm";

const CONTENT_ANCHORS =
	'[data-dashboard-grid-row-scope="session"] > *, [data-slot="sessions-overview-header"], [data-slot="sidebar-footer"], button:not([data-dashboard-grid-row-scope]), a:not([data-dashboard-grid-row-scope]), input, textarea';
const CONTENT_PLANES = '[data-slot="sessions-overview-scroll-container"] > *';
// Charts draw their marks for their own size, and Recharts redraws them a frame
// after the window resizes. Project a chart as one box: projecting each mark
// from geometry measured before that redraw slides them inside their card.
const PROJECTION_LEAVES = "svg, .recharts-responsive-container";
// Presentation spans need text layout and padding, not hundreds of computed
// layout/effect properties copied twice for every label on every click.
const TEXT_PRESENTATION_PROPERTIES = [
	"font-family",
	"font-size",
	"font-weight",
	"font-style",
	"font-stretch",
	"font-variation-settings",
	"font-feature-settings",
	"font-kerning",
	"font-optical-sizing",
	"font-synthesis",
	"font-variant",
	"line-height",
	"letter-spacing",
	"word-spacing",
	"white-space",
	"word-break",
	"overflow-wrap",
	"hyphens",
	"tab-size",
	"text-align",
	"text-align-last",
	"text-indent",
	"text-transform",
	"text-overflow",
	"text-decoration",
	"text-shadow",
	"direction",
	"writing-mode",
	"text-orientation",
	"color",
	"-webkit-text-fill-color",
	"-webkit-text-stroke-width",
	"-webkit-text-stroke-color",
	"padding-top",
	"padding-right",
	"padding-bottom",
	"padding-left",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
	"border-style",
	"overflow-x",
	"overflow-y",
];
const ease = cubicBezier(0.22, 1, 0.36, 1);
const STEPS = Array.from({ length: 61 }, (_, index) => ({
	offset: index / 60,
	progress: ease(index / 60),
}));

export interface SafariContentLayout {
	element: HTMLElement;
	first: DOMRect;
	children: SafariContentLayout[];
	preserveSize: boolean;
}

interface Projection {
	first: DOMRect;
	last: DOMRect;
}

interface TransformSample {
	offset: number;
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
}

export function captureSafariContentLayout(document: Document) {
	return captureRoots(
		document,
		`.dashboard-01-preview, ${CONTENT_ANCHORS}`,
		(document.defaultView?.innerHeight ?? 0) + 160,
	);
}

function captureRoots(
	scope: Document | HTMLElement,
	selector: string,
	visibleBottom: number,
) {
	const candidates = new Set(scope.querySelectorAll<HTMLElement>(selector));
	const roots: SafariContentLayout[] = [];
	for (const element of candidates) {
		let parent = element.parentElement;
		while (parent && !candidates.has(parent)) parent = parent.parentElement;
		if (parent) continue;
		roots.push(...captureElement(element, visibleBottom));
	}
	return roots;
}

function captureElement(
	element: HTMLElement,
	visibleBottom: number,
): SafariContentLayout[] {
	const first = element.getBoundingClientRect();
	// Project the shell as well as its content: its background, rounded edges,
	// and every nested overflow clip must follow the window's changing bounds.
	// Cull offscreen subtrees, retaining the rows revealed by the growing window.
	if (
		first.width &&
		first.height &&
		(first.bottom < 0 || first.top > visibleBottom)
	)
		return [];
	// Keep the content behind each moving clip at normal scale. Only its
	// selected anchors need motion; scaling every row would require a layer
	// for every fixed-width cell just to undo its parent's scaling.
	const preserveSize = element.matches(CONTENT_PLANES);
	const children = element.matches(PROJECTION_LEAVES)
		? []
		: preserveSize
			? captureRoots(element, CONTENT_ANCHORS, visibleBottom)
			: Array.from(element.querySelectorAll<HTMLElement>(":scope > *")).flatMap(
					(child) => captureElement(child, visibleBottom),
				);
	// Fixed-position/sidebar descendants can be visible inside a zero-size or
	// display:contents wrapper. Keep them in their nearest projected ancestor.
	if (!first.width || !first.height) return children;
	return [
		{
			element,
			first,
			children,
			preserveSize,
		},
	];
}

export function animateSafariContentLayout(
	roots: SafariContentLayout[],
	timing: KeyframeAnimationOptions,
	viewport: Projection,
) {
	const animations: Animation[] = [];
	const restores: (() => void)[] = [];
	const destinations = new Map<HTMLElement, DOMRect>();
	const preparations: (() => void)[] = [];
	const starts: (() => void)[] = [];
	const linearTiming = { ...timing, easing: "linear" };
	function measure(node: SafariContentLayout) {
		destinations.set(node.element, node.element.getBoundingClientRect());
		node.children.forEach(measure);
	}
	roots.forEach(measure);

	function prepare(node: SafariContentLayout, parent: Projection | null) {
		const last = destinations.get(node.element);
		if (
			!last?.width ||
			!last.height ||
			!node.first.width ||
			!node.first.height ||
			!node.element.isConnected
		)
			return;
		const projection = {
			first: node.preserveSize
				? new DOMRect(node.first.x, node.first.y, last.width, last.height)
				: node.first,
			last,
		};
		// Every box follows the same eased interpolation. If its initial
		// parent-relative transform is identity, it needs no animation at all.
		const initial = project(projection, parent, 0);
		const changed =
			Math.abs(initial.x) > 0.05 ||
			Math.abs(initial.y) > 0.05 ||
			Math.abs(initial.scaleX - 1) > 0.00001 ||
			Math.abs(initial.scaleY - 1) > 0.00001;
		if (changed) {
			const style = node.element.ownerDocument.defaultView?.getComputedStyle(
				node.element,
			);
			if (!style) return;
			const base = readBaseTransform(node.element, style);
			const restore = preserveStyles(node.element, [
				"transform-origin",
				"will-change",
				"translate",
				"scale",
				"rotate",
				"position",
				"-webkit-text-fill-color",
			]);
			const textChanges =
				!node.preserveSize &&
				node.children.length === 0 &&
				node.element.textContent?.trim() &&
				(Math.abs(node.first.width - last.width) > 0.5 ||
					Math.abs(node.first.height - last.height) > 0.5);
			const textStyles = textChanges
				? TEXT_PRESENTATION_PROPERTIES.map((name) => [
						name,
						style.getPropertyValue(name),
					])
				: null;
			const staticPosition = style.position === "static";
			const counterScale =
				parent &&
				(Math.abs(parent.first.width - parent.last.width) > 0.05 ||
					Math.abs(parent.first.height - parent.last.height) > 0.05);
			const samples: TransformSample[] = counterScale
				? STEPS.map(({ offset, progress }) => ({
						offset,
						...project(projection, parent, progress),
					}))
				: [
						{ offset: 0, ...initial },
						{ offset: 1, x: 0, y: 0, scaleX: 1, scaleY: 1 },
					];
			const keyframes = samples.map((sample) => ({
				offset: sample.offset,
				transform: `translate(${sample.x + (1 - sample.scaleX) * base.x}px, ${sample.y + (1 - sample.scaleY) * base.y}px) scale(${sample.scaleX}, ${sample.scaleY}) ${base.matrix}`,
			}));
			// All geometry and computed styles are read before the first write.
			preparations.push(() => {
				restores.push(restore);
				Object.assign(node.element.style, {
					transformOrigin: "0 0",
					willChange: "transform",
					translate: "none",
					scale: "none",
					rotate: "none",
				});
				starts.push(() => {
					animations.push(
						node.element.animate(
							keyframes,
							counterScale ? linearTiming : timing,
						),
					);
				});
				if (textStyles)
					prepareTextCopies(
						node,
						last,
						textStyles,
						staticPosition,
						timing,
						starts,
						animations,
						restores,
					);
			});
		}
		for (const child of node.children)
			prepare(child, changed ? projection : parent);
	}
	for (const root of roots) prepare(root, viewport);
	for (const preparation of preparations) preparation();
	// Element.animate can resolve styles. Finish all DOM/style writes first so
	// creating each effect cannot repeatedly invalidate the next one's layout.
	for (const start of starts) start();
	let released = false;
	return {
		animations,
		release() {
			if (released) return;
			released = true;
			for (const animation of animations) animation.cancel();
			// Remove presentation children before restoring their hosts' styles.
			for (const restore of restores.reverse()) restore();
		},
	};
}

function project(
	node: Projection,
	parent: Projection | null,
	progress: number,
) {
	const scaleX =
		interpolate(node.first.width, node.last.width, progress) / node.last.width;
	const scaleY =
		interpolate(node.first.height, node.last.height, progress) /
		node.last.height;
	const parentScaleX = parent
		? interpolate(parent.first.width, parent.last.width, progress) /
			parent.last.width
		: 1;
	const parentScaleY = parent
		? interpolate(parent.first.height, parent.last.height, progress) /
			parent.last.height
		: 1;
	const parentX = parent
		? interpolate(parent.first.left, parent.last.left, progress)
		: 0;
	const parentY = parent
		? interpolate(parent.first.top, parent.last.top, progress)
		: 0;
	return {
		x:
			(interpolate(node.first.left, node.last.left, progress) - parentX) /
				parentScaleX -
			(node.last.left - (parent?.last.left ?? 0)),
		y:
			(interpolate(node.first.top, node.last.top, progress) - parentY) /
				parentScaleY -
			(node.last.top - (parent?.last.top ?? 0)),
		scaleX: scaleX / parentScaleX,
		scaleY: scaleY / parentScaleY,
	};
}

function interpolate(first: number, last: number, progress: number) {
	return first + (last - first) * progress;
}

function prepareTextCopies(
	node: SafariContentLayout,
	last: DOMRect,
	styles: string[][],
	staticPosition: boolean,
	timing: KeyframeAnimationOptions,
	starts: (() => void)[],
	animations: Animation[],
	restores: (() => void)[],
) {
	// A transform cannot interpolate ellipsis or line wrapping. Only these
	// changing labels get two temporary, unscaled presentations. The real text
	// stays in place for React and accessibility; neither copy receives input.
	const text = node.element.textContent;
	const originalText = node.element.firstChild;
	const restoreColor = preserveStyles(node.element, [
		"-webkit-text-fill-color",
	]);
	const textAnimations: Animation[] = [];
	const copies = [node.first, last].map((bounds, index) => {
		const copy = node.element.ownerDocument.createElement("span");
		for (const [name, value] of styles)
			if (name && value) copy.style.setProperty(name, value);
		copy.textContent = text;
		copy.setAttribute("aria-hidden", "true");
		copy.setAttribute(
			"data-safari-demo-text-copy",
			index === 0 ? "old" : "new",
		);
		Object.assign(copy.style, {
			display: "block",
			position: "absolute",
			left: "0",
			top: "0",
			margin: "0",
			width: `${bounds.width}px`,
			height: `${bounds.height}px`,
			minWidth: "0",
			maxWidth: "none",
			minHeight: "0",
			maxHeight: "none",
			boxSizing: "border-box",
			transformOrigin: "0 0",
			transform: "none",
			translate: "none",
			scale: "none",
			rotate: "none",
			pointerEvents: "none",
			background: "none",
			boxShadow: "none",
			borderColor: "transparent",
			transition: "none",
			animation: "none",
			willChange: "transform, opacity",
		});
		starts.push(() => {
			const animation = copy.animate(
				STEPS.map(({ offset, progress }) => ({
					offset,
					transform: `scale(${last.width / interpolate(node.first.width, last.width, progress)}, ${last.height / interpolate(node.first.height, last.height, progress)})`,
					opacity: index === 0 ? 1 - progress : progress,
				})),
				{ ...timing, easing: "linear" },
			);
			textAnimations.push(animation);
			animations.push(animation);
		});
		return copy;
	});
	node.element.style.setProperty("-webkit-text-fill-color", "transparent");
	if (staticPosition) node.element.style.position = "relative";
	node.element.append(...copies);
	// A live query can resolve during exit. If React updates this label, stop
	// presenting its old text immediately and never leave the real text hidden.
	let released = false;
	const observer = new MutationObserver(() => {
		if (
			node.element.firstChild !== originalText ||
			originalText?.textContent !== text
		)
			release();
	});
	function release() {
		if (released) return;
		released = true;
		observer.disconnect();
		for (const animation of textAnimations) animation.cancel();
		for (const copy of copies) copy.remove();
		restoreColor();
	}
	observer.observe(node.element, {
		childList: true,
		characterData: true,
		subtree: true,
	});
	restores.push(release);
}

function preserveStyles(element: HTMLElement, names: string[]) {
	const values = names.map((name) => ({
		name,
		value: element.style.getPropertyValue(name),
		priority: element.style.getPropertyPriority(name),
	}));
	return () => {
		for (const { name, value, priority } of values) {
			if (value) element.style.setProperty(name, value, priority);
			else element.style.removeProperty(name);
		}
	};
}

function readBaseTransform(element: HTMLElement, style: CSSStyleDeclaration) {
	const width =
		element.clientWidth +
		Number.parseFloat(style.borderLeftWidth) +
		Number.parseFloat(style.borderRightWidth);
	const height =
		element.clientHeight +
		Number.parseFloat(style.borderTopWidth) +
		Number.parseFloat(style.borderBottomWidth);
	const [originX = "0", originY = "0"] = style.transformOrigin.split(" ");
	const [translateX = "0", translateY = "0"] =
		style.translate === "none" ? [] : style.translate.split(" ");
	const [scaleX = "1", scaleY = scaleX] =
		style.scale === "none" ? [] : style.scale.split(" ");
	const angle = style.rotate.split(" ").at(-1) ?? "0";
	const degrees =
		style.rotate === "none"
			? 0
			: Number.parseFloat(angle) *
				(angle.endsWith("rad")
					? 180 / Math.PI
					: angle.endsWith("turn")
						? 360
						: 1);
	const x = length(originX, width),
		y = length(originY, height);
	const matrix = new DOMMatrix()
		.translate(x, y)
		.translate(length(translateX, width), length(translateY, height))
		.rotate(degrees)
		.scale(Number(scaleX), Number(scaleY))
		.multiply(
			new DOMMatrix(style.transform === "none" ? undefined : style.transform),
		)
		.translate(-x, -y);
	const corners = [
		{ x: 0, y: 0 },
		{ x: width, y: 0 },
		{ x: 0, y: height },
		{ x: width, y: height },
	].map((point) => matrix.transformPoint(point));
	return {
		matrix: matrix.toString(),
		x: Math.min(...corners.map((point) => point.x)),
		y: Math.min(...corners.map((point) => point.y)),
	};
}

function length(value: string, basis: number) {
	return Number.parseFloat(value) * (value.endsWith("%") ? basis / 100 : 1);
}
