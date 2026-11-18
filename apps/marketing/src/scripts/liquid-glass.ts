export interface GlassOptions {
	radius: number;
	depth: number;
	curvature: number;
	scale: number;
	chroma: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";
let filterHost: SVGSVGElement | null = null;
let filterCount = 0;

function host() {
	if (filterHost) return filterHost;
	filterHost = document.createElementNS(SVG_NS, "svg");
	filterHost.setAttribute("aria-hidden", "true");
	filterHost.setAttribute("width", "0");
	filterHost.setAttribute("height", "0");
	filterHost.style.position = "absolute";
	filterHost.style.pointerEvents = "none";
	document.body.append(filterHost);
	return filterHost;
}

function lensMap(
	width: number,
	height: number,
	density: number,
	options: GlassOptions,
) {
	const canvas = document.createElement("canvas");
	const pixelWidth = Math.round(width * density);
	const pixelHeight = Math.round(height * density);
	canvas.width = pixelWidth;
	canvas.height = pixelHeight;
	const context = canvas.getContext("2d");
	if (!context) return null;
	const image = context.createImageData(pixelWidth, pixelHeight);
	const data = image.data;
	data.fill(128);
	const halfWidth = width / 2;
	const halfHeight = height / 2;
	const radius = Math.min(options.radius, halfWidth, halfHeight);
	const exponent = 1 + options.curvature / 20;
	const write = (x: number, y: number, dx: number, dy: number) => {
		const index = (y * pixelWidth + x) * 4;
		data[index] = Math.round(128 + dx * 127);
		data[index + 1] = Math.round(128 + dy * 127);
		data[index + 2] = 128;
		data[index + 3] = 255;
	};
	for (let y = 0; y < Math.ceil(pixelHeight / 2); y++) {
		for (let x = 0; x < Math.ceil(pixelWidth / 2); x++) {
			const fromCenterX = halfWidth - (x + 0.5) / density;
			const fromCenterY = halfHeight - (y + 0.5) / density;
			const qx = fromCenterX - (halfWidth - radius);
			const qy = fromCenterY - (halfHeight - radius);
			const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
			const inset = -(outside + Math.min(Math.max(qx, qy), 0) - radius);
			let dx = 0;
			let dy = 0;
			if (inset >= 0 && inset < options.depth) {
				const strength = (1 - inset / options.depth) ** exponent;
				if (qx > 0 && qy > 0) {
					const length = Math.hypot(qx, qy) || 1;
					dx = (qx / length) * strength;
					dy = (qy / length) * strength;
				} else if (qx > qy) {
					dx = strength;
				} else {
					dy = strength;
				}
			}
			const right = pixelWidth - 1 - x;
			const bottom = pixelHeight - 1 - y;
			write(x, y, dx, dy);
			write(right, y, -dx, dy);
			write(x, bottom, dx, -dy);
			write(right, bottom, -dx, -dy);
		}
	}
	context.putImageData(image, 0, 0);
	return canvas.toDataURL("image/png");
}

function channelDisplacement(
	scale: number,
	channel: 0 | 1 | 2,
	result: string,
) {
	const rows = ["0 0 0 0 0", "0 0 0 0 0", "0 0 0 0 0", "0 0 0 1 0"];
	rows[channel] = ["1 0 0 0 0", "0 1 0 0 0", "0 0 1 0 0"][channel];
	return `<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale.toFixed(2)}" xChannelSelector="R" yChannelSelector="G" result="${result}-shift"/><feColorMatrix in="${result}-shift" type="matrix" values="${rows.join("  ")}" result="${result}"/>`;
}

export function applyGlass(element: HTMLElement, options: GlassOptions) {
	let filter: SVGFilterElement | null = null;
	const update = () => {
		const width = Math.round(element.offsetWidth);
		const height = Math.round(element.offsetHeight);
		if (!width || !height) return;
		const density = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
		const map = lensMap(width, height, density, options);
		if (!map) return;
		const scale = options.scale * Math.min(width, height) * 2;
		const id = `liquid-glass-${++filterCount}`;
		const next = document.createElementNS(SVG_NS, "filter");
		next.id = id;
		next.setAttribute("x", "0");
		next.setAttribute("y", "0");
		next.setAttribute("width", String(width));
		next.setAttribute("height", String(height));
		next.setAttribute("filterUnits", "userSpaceOnUse");
		next.setAttribute("color-interpolation-filters", "sRGB");
		next.innerHTML = `<feImage href="${map}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="map"/>${channelDisplacement(scale * (1 + options.chroma), 0, "red")}${channelDisplacement(scale, 1, "green")}${channelDisplacement(scale * (1 - options.chroma), 2, "blue")}<feComposite in="red" in2="green" operator="arithmetic" k2="1" k3="1" result="red-green"/><feComposite in="red-green" in2="blue" operator="arithmetic" k2="1" k3="1" result="refracted"/><feComposite in="refracted" in2="SourceAlpha" operator="in"/>`;
		host().append(next);
		element.style.filter = `url(#${id})`;
		filter?.remove();
		filter = next;
	};
	update();
	const observer = new ResizeObserver(update);
	observer.observe(element);
	return () => {
		observer.disconnect();
		filter?.remove();
		element.style.filter = "";
	};
}
