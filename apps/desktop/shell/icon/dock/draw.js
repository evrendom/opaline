const WINDOW_PATH =
	"M578.026 999.719L578.016 999.721L578.008 999.727L578.002 999.736L578 999.746C579.42 1152.81 628.089 1271.01 705.689 1335.21C783.037 1402.05 889.272 1414.81 999.593 1418.44C1109.91 1414.81 1216.14 1402.05 1293.49 1335.21C1371.1 1271.01 1419.72 1152.73 1421.13 999.719C1419.72 846.658 1371.1 728.424 1293.49 664.232C1216.14 597.397 1109.86 584.638 999.593 581C889.272 584.638 783.037 597.397 705.689 664.232C628.089 728.369 579.414 846.59 578.052 999.692L578.044 999.711L578.026 999.719Z";
const CENTER = [999.6, 999.7];
const HOLE = 1.25;
const SHEEN = [
	[0.59, 0.223, 262.833],
	[0.583, 0.239, 281.458],
	[0.621, 0.262, 302.391],
	[0.668, 0.273, 323.991],
	[0.691, 0.256, 344.619],
];
const WARN = [
	[0.637, 0.237, 25.3],
	[0.75, 0.183, 55.9],
	[0.852, 0.199, 91.9],
];
const LOW = 0.3;
// Development builds look like Xcode, so they are never mistaken for the
// installed app: a blueprint-blue face with a light grid, white ring and
// digits, and a cyan glow.
const XCODE_SHEEN = [
	[0.86, 0.11, 218],
	[0.8, 0.14, 230],
	[0.74, 0.16, 242],
	[0.82, 0.12, 214],
	[0.92, 0.07, 205],
];
const BLUEPRINT_TOP = [31, 194, 255];
const BLUEPRINT_BOTTOM = [23, 102, 242];
const GRID = "rgba(205, 240, 255, 0.42)";

function mix(stops, t) {
	const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
	const i = Math.floor(x);
	const f = x - i;
	return stops[i].map((value, k) => value + (stops[i + 1][k] - value) * f);
}

function oklch([l, c, h]) {
	return `oklch(${l.toFixed(4)} ${c.toFixed(4)} ${h.toFixed(3)})`;
}

function outline() {
	const tokens = WINDOW_PATH.match(/[MLCZ]|-?\d+\.?\d*/g);
	const points = [];
	let i = 0;
	let command = "";
	let current = [0, 0];
	const next = () => {
		const x = Number(tokens[i++]);
		const y = Number(tokens[i++]);
		return [CENTER[0] + (x - CENTER[0]) * HOLE, CENTER[1] + (y - CENTER[1]) * HOLE];
	};
	while (i < tokens.length) {
		if (/[MLCZ]/.test(tokens[i])) command = tokens[i++];
		if (command === "Z") break;
		if (command === "M" || command === "L") {
			current = next();
			points.push(current);
		} else if (command === "C") {
			const a = next();
			const b = next();
			const end = next();
			for (let step = 1; step <= 24; step++) {
				const t = step / 24;
				const u = 1 - t;
				points.push([0, 1].map((k) => u * u * u * current[k] + 3 * u * u * t * a[k] + 3 * u * t * t * b[k] + t * t * t * end[k]));
			}
			current = end;
		}
	}
	let area = 0;
	for (let j = 0; j < points.length; j++) {
		const [ax, ay] = points[j];
		const [bx, by] = points[(j + 1) % points.length];
		area += ax * by - bx * ay;
	}
	if (area < 0) points.reverse();
	let top = 0;
	points.forEach(([x, y], j) => {
		if (Math.abs(x - CENTER[0]) * 3 + y < Math.abs(points[top][0] - CENTER[0]) * 3 + points[top][1]) top = j;
	});
	const ordered = [...points.slice(top), ...points.slice(0, top), points[top]];
	const lengths = [0];
	for (let j = 1; j < ordered.length; j++) lengths.push(lengths[j - 1] + Math.hypot(ordered[j][0] - ordered[j - 1][0], ordered[j][1] - ordered[j - 1][1]));
	return { points: ordered, at: lengths.map((length) => length / lengths[lengths.length - 1]) };
}

const WINDOW = outline();

function image(src) {
	return new Promise((resolve, reject) => {
		const element = new Image();
		element.onload = () => resolve(element);
		element.onerror = reject;
		element.src = src;
	});
}

function colorAt(left, dark, along, dev) {
	if (left <= 0) return dark ? "#FF5A66" : "#D93A4A";
	if (left < LOW) return oklch(mix(WARN, left / LOW));
	if (dev) return oklch(mix(XCODE_SHEEN, along / left));
	const [l, c, h] = mix(SHEEN, along / left);
	return oklch([Math.min(0.95, l + (dark ? 0.14 : 0)), c, h]);
}

/**
 * The icon's own face, in blueprint blue: every opaque pixel of the base takes
 * the blue of its row, kept as light or dark as the base was there (so the
 * glass window stays lighter), with a grid over the face.
 */
function blueprint(base, size) {
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext("2d");
	context.drawImage(base, 0, 0, size, size);
	const pixels = context.getImageData(0, 0, size, size);
	const data = pixels.data;
	let top = size;
	let bottom = 0;
	let left = size;
	let right = 0;
	for (let y = 0; y < size; y++) {
		const t = y / (size - 1);
		const row = BLUEPRINT_TOP.map((value, k) => value + (BLUEPRINT_BOTTOM[k] - value) * t);
		for (let x = 0; x < size; x++) {
			const i = (y * size + x) * 4;
			if (data[i + 3] < 200) continue;
			top = Math.min(top, y);
			bottom = Math.max(bottom, y);
			left = Math.min(left, x);
			right = Math.max(right, x);
			const light = (data[i] + data[i + 1] + data[i + 2]) / (3 * 255);
			const shade = 0.55 + 0.5 * light;
			for (let k = 0; k < 3; k++) data[i + k] = Math.min(255, row[k] * shade);
		}
	}
	context.putImageData(pixels, 0, 0);
	context.globalCompositeOperation = "source-atop";
	context.strokeStyle = GRID;
	context.lineWidth = Math.max(1, size / 340);
	for (let k = 1; k < 4; k++) {
		const x = Math.round(left + ((right - left) * k) / 4) + 0.5;
		const y = Math.round(top + ((bottom - top) * k) / 4) + 0.5;
		context.beginPath();
		context.moveTo(x, top);
		context.lineTo(x, bottom);
		context.moveTo(left, y);
		context.lineTo(right, y);
		context.stroke();
	}
	return canvas;
}

function strokeGlow(context, left, dark, width, blur, alpha, dev) {
	context.save();
	context.filter = `blur(${blur}px)`;
	context.globalAlpha = alpha;
	context.lineCap = "round";
	context.lineWidth = width;
	const { points, at } = WINDOW;
	for (let j = 1; j < points.length; j++) {
		if (left > 0 && at[j] > left + 1e-6) continue;
		context.strokeStyle = colorAt(left, dark, at[j], dev);
		context.beginPath();
		context.moveTo(...points[j - 1]);
		context.lineTo(...points[j]);
		context.stroke();
	}
	context.restore();
}

async function draw({ left, dark, size, layers, dev = false }) {
	const [base, ring, digits] = await Promise.all([image(layers.base), image(layers.ring), image(layers.number)]);
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext("2d");
	context.drawImage(dev ? blueprint(base, size) : base, 0, 0, size, size);
	const scale = (size / 1024) * 0.9375 * 1.15 * 0.512;
	const offset = (size / 1024) * (32 + 0.9375 * 512 * (1 - 1.15));
	const glow = document.createElement("canvas");
	glow.width = size;
	glow.height = size;
	const glowContext = glow.getContext("2d");
	glowContext.setTransform(scale, 0, 0, scale, offset, offset);
	const windowPath = new Path2D();
	WINDOW.points.forEach(([x, y], j) => (j ? windowPath.lineTo(x, y) : windowPath.moveTo(x, y)));
	windowPath.closePath();
	glowContext.clip(windowPath);
	strokeGlow(glowContext, left, dark, 87, 29 * scale, dark || dev ? 1 : 0.85, dev);
	if (dark || dev) {
		strokeGlow(glowContext, left, dark, 87, 29 * scale, 1, dev);
		strokeGlow(glowContext, left, dark, 30, 9 * scale, 0.9, dev);
	}
	context.drawImage(glow, 0, 0);
	context.drawImage(ring, 0, 0, size, size);
	context.drawImage(digits, 0, 0, size, size);
	return canvas.toDataURL("image/png");
}

window.draw = draw;
