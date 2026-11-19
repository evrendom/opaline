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

function colorAt(left, dark, along) {
	if (left <= 0) return dark ? "#FF5A66" : "#D93A4A";
	if (left < LOW) return oklch(mix(WARN, left / LOW));
	const [l, c, h] = mix(SHEEN, along / left);
	return oklch([Math.min(0.95, l + (dark ? 0.14 : 0)), c, h]);
}

function strokeGlow(context, left, dark, width, blur, alpha) {
	context.save();
	context.filter = `blur(${blur}px)`;
	context.globalAlpha = alpha;
	context.lineCap = "round";
	context.lineWidth = width;
	const { points, at } = WINDOW;
	for (let j = 1; j < points.length; j++) {
		if (left > 0 && at[j] > left + 1e-6) continue;
		context.strokeStyle = colorAt(left, dark, at[j]);
		context.beginPath();
		context.moveTo(...points[j - 1]);
		context.lineTo(...points[j]);
		context.stroke();
	}
	context.restore();
}

async function draw({ left, dark, size, layers }) {
	const [base, ring, digits] = await Promise.all([image(layers.base), image(layers.ring), image(layers.number)]);
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext("2d");
	context.drawImage(base, 0, 0, size, size);
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
	strokeGlow(glowContext, left, dark, 87, 29 * scale, dark ? 1 : 0.85);
	if (dark) {
		strokeGlow(glowContext, left, dark, 87, 29 * scale, 1);
		strokeGlow(glowContext, left, dark, 30, 9 * scale, 0.9);
	}
	context.drawImage(glow, 0, 0);
	context.drawImage(ring, 0, 0, size, size);
	context.drawImage(digits, 0, 0, size, size);
	return canvas.toDataURL("image/png");
}

window.draw = draw;
