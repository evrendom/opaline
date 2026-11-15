const SVG = "http://www.w3.org/2000/svg";
const tooltip = document.querySelector(".tooltip");
let gradientCount = 0;

function node(tag, attributes, parent) {
	const element = document.createElementNS(SVG, tag);
	for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
	parent?.appendChild(element);
	return element;
}

function niceStep(value) {
	const power = 10 ** Math.floor(Math.log10(value));
	for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
	return 10 * power;
}

function shortDate(iso) {
	return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function gradient(svg, from, to) {
	const id = `fill-${++gradientCount}`;
	const defs = node("defs", {}, svg);
	const linear = node("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
	node("stop", { offset: "0%", style: from }, linear);
	node("stop", { offset: "100%", style: to }, linear);
	return `url(#${id})`;
}

function sparkline(svg, values) {
	const max = Math.max(1, ...values);
	const step = 100 / Math.max(1, values.length - 1);
	const points = values.map((value, index) => `${(index * step).toFixed(2)} ${(2 + 28 * (1 - value / max)).toFixed(2)}`);
	const line = `M${points.join(" L")}`;
	const fill = gradient(svg, "stop-color:currentColor;stop-opacity:0.4", "stop-color:currentColor;stop-opacity:0.1");
	node("path", { d: `${line} L100 32 L0 32 Z`, fill }, svg);
	node("path", {
		d: line,
		fill: "none",
		class: "metric-trend-line",
		"stroke-width": 1.2,
		"stroke-linecap": "round",
		"stroke-linejoin": "round",
		"vector-effect": "non-scaling-stroke",
	}, svg);
}

function areaChart(container, points, { color, label, format, parts, onHover, tooltip: withTooltip = true }) {
	const { width, height } = container.getBoundingClientRect();
	const svg = node("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": label }, container);
	const left = 44;
	const top = 8;
	const bottom = 40;
	const right = 8;
	const plotWidth = width - left - right;
	const plotHeight = height - top - bottom;
	const step = niceStep(Math.max(3, ...points.map((point) => point.value)) / 3);
	const max = step * 3;
	const x = (index) => left + (plotWidth * index) / Math.max(1, points.length - 1);
	const y = (value) => top + plotHeight * (1 - value / max);
	for (let tick = 0; tick <= 3; tick += 1) {
		const value = step * tick;
		node("line", { class: "grid", x1: left, x2: width - right, y1: y(value), y2: y(value) }, svg);
		const text = node("text", { x: left - 10, y: y(value) + 4, "text-anchor": "end" }, svg);
		text.textContent = format(value, true);
	}
	const every = Math.max(1, Math.ceil(65 / (plotWidth / Math.max(1, points.length - 1))));
	points.forEach((point, index) => {
		if ((points.length - 1 - index) % every) return;
		const text = node("text", { x: x(index), y: height - bottom + 14 + 12, "text-anchor": "middle" }, svg);
		text.textContent = shortDate(point.date);
	});
	const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join("");
	const fill = gradient(svg, `stop-color:${color};stop-opacity:var(--cost-chart-fill-opacity)`, `stop-color:${color};stop-opacity:0`);
	node("path", { d: `${line}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`, fill }, svg);
	node("path", { d: line, fill: "none", style: `stroke:${color}`, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
	const cursor = node("line", { class: "cursor", y1: top, y2: top + plotHeight, visibility: "hidden" }, svg);
	const dot = node("circle", { r: 4, class: "active-dot", style: `fill:${color}`, visibility: "hidden" }, svg);
	const hit = node("rect", { class: "hit", x: left, y: top, width: plotWidth, height: plotHeight }, svg);
	const show = (index) => {
		const box = svg.getBoundingClientRect();
		const point = points[index];
		for (const element of [cursor, dot]) element.setAttribute("visibility", "visible");
		cursor.setAttribute("x1", x(index));
		cursor.setAttribute("x2", x(index));
		dot.setAttribute("cx", x(index));
		dot.setAttribute("cy", y(point.value));
		if (!withTooltip) return;
		const rows = parts
			.map((part) => `<div><span>${part.icon}${part.label}</span><strong>${format(point[part.key])}</strong></div>`)
			.join("");
		tooltip.innerHTML = `<p>${shortDate(point.date)}</p><div><span><i style="background:${color}"></i>${label}</span><strong>${format(point.value)}</strong></div>${rows}`;
		tooltip.hidden = false;
		const tip = tooltip.getBoundingClientRect();
		const left0 = box.left + x(index) + 16;
		tooltip.style.left = `${left0 + tip.width > window.innerWidth - 8 ? box.left + x(index) - tip.width - 16 : left0}px`;
		tooltip.style.top = `${box.top + 48}px`;
	};
	const hide = () => {
		for (const element of [cursor, dot]) element.setAttribute("visibility", "hidden");
		tooltip.hidden = true;
	};
	hit.addEventListener("mousemove", (event) => {
		const box = svg.getBoundingClientRect();
		const index = Math.max(0, Math.min(points.length - 1, Math.round(((event.clientX - box.left - left) / plotWidth) * (points.length - 1))));
		show(index);
		onHover?.(points[index].date);
	});
	hit.addEventListener("mouseleave", () => {
		hide();
		onHover?.(null);
	});
	return {
		show: (date) => {
			const index = points.findIndex((point) => point.date === date);
			if (index >= 0) show(index);
			else hide();
		},
		hide,
	};
}

const MORPH_MS = 1300;
const ease = (t) => t * t * (3 - 2 * t);

function lineChart(container, initial) {
	const { width, height } = container.getBoundingClientRect();
	const svg = node("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", class: "line-chart" }, container);
	const left = 44;
	const top = 8;
	const bottom = 30;
	const right = 8;
	const plotWidth = width - left - right;
	const plotHeight = height - top - bottom;
	const id = `line-${++gradientCount}`;
	const defs = node("defs", {}, svg);
	const fade = node("linearGradient", { id, gradientUnits: "userSpaceOnUse", x1: left, y1: 0, x2: left + plotWidth, y2: 0 }, defs);
	for (const [offset, opacity] of [[0, 0], [0.14, 1], [0.86, 1], [1, 0]]) node("stop", { offset, style: `stop-color:var(--line-color);stop-opacity:${opacity}` }, fade);
	const beam = node("linearGradient", { id: `${id}-cursor`, gradientUnits: "userSpaceOnUse", x1: 0, y1: top, x2: 0, y2: top + plotHeight }, defs);
	for (const [offset, opacity] of [[0, 0], [0.3, 1], [0.7, 1], [1, 0]]) node("stop", { offset, style: `stop-color:var(--muted);stop-opacity:${opacity}` }, beam);
	const grid = [0, 1, 2, 3].map(() => node("line", { class: "grid", x1: left, x2: width - right }, svg));
	const ticks = [0, 1, 2, 3].map(() => node("text", { x: left - 10, "text-anchor": "end", class: "tick" }, svg));
	const path = node("path", { fill: "none", stroke: `url(#${id})`, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
	const cursor = node("line", { class: "beam", y1: top, y2: top + plotHeight, stroke: `url(#${id}-cursor)` }, svg);
	const dot = node("circle", { r: 4, class: "active-dot" }, svg);
	const first = node("text", { y: height - 11, "text-anchor": "start", class: "edge-date edge-first" }, svg);
	const last = node("text", { y: height - 11, "text-anchor": "end", class: "edge-date edge-last" }, svg);
	const hovered = node("text", { y: height - 11, "text-anchor": "middle", class: "hover-date" }, svg);
	const hit = node("rect", { class: "hit", x: left, y: top, width: plotWidth, height: plotHeight }, svg);
	const x = (index, count) => left + (plotWidth * index) / Math.max(1, count - 1);
	let state = { points: initial.points, values: initial.points.map((point) => point.value), max: 1, format: initial.format, onHover: initial.onHover };
	let shownIndex = null;
	let frame = 0;

	const scale = (values) => {
		const step = niceStep(Math.max(3, ...values) / 3);
		return { step, max: step * 3 };
	};
	const draw = (values, max) => {
		const y = (value) => top + plotHeight * (1 - value / max);
		path.setAttribute("d", values.map((value, index) => `${index ? "L" : "M"}${x(index, values.length).toFixed(1)},${y(value).toFixed(1)}`).join(""));
		grid.forEach((line, tick) => {
			line.setAttribute("y1", y((max / 3) * tick));
			line.setAttribute("y2", y((max / 3) * tick));
		});
		if (shownIndex !== null) {
			dot.setAttribute("cx", x(shownIndex, values.length));
			dot.setAttribute("cy", y(values[shownIndex]));
		}
	};
	const label = (max, step, animate) => {
		const y = (value) => top + plotHeight * (1 - value / max);
		ticks.forEach((text, tick) => {
			const value = state.format(step * tick, true);
			if (text.textContent === value) return;
			if (!animate || !text.textContent) {
				text.setAttribute("y", y(step * tick) + 4);
				text.textContent = value;
				return;
			}
			const next = node("text", { x: left - 10, y: y(step * tick) + 4, "text-anchor": "end", class: "tick tick-in" }, svg);
			next.textContent = value;
			text.classList.remove("tick-in");
			text.classList.add("tick-out");
			setTimeout(() => text.remove(), 650);
			ticks[tick] = next;
		});
	};
	const dates = () => {
		first.setAttribute("x", left);
		first.textContent = shortDate(state.points[0].date);
		last.setAttribute("x", left + plotWidth);
		last.textContent = shortDate(state.points.at(-1).date);
	};

	const set = ({ points, color, format, onHover }, animate) => {
		const from = state.values;
		const fromMax = state.max;
		const to = points.map((point) => point.value);
		const { step, max } = scale(to);
		state = { ...state, points, format, onHover, values: to, max };
		svg.style.setProperty("--line-color", color);
		dates();
		cancelAnimationFrame(frame);
		if (!animate || from.length !== to.length) {
			draw(to, max);
			label(max, step, false);
			return;
		}
		svg.classList.add("morphing");
		const start = performance.now();
		const tick = (now) => {
			const t = ease(Math.min(1, (now - start) / MORPH_MS));
			const current = Math.max(1e-9, fromMax + (max - fromMax) * t);
			draw(from.map((value, index) => value + (to[index] - value) * t), current);
			if (t < 1) frame = requestAnimationFrame(tick);
			else svg.classList.remove("morphing");
		};
		frame = requestAnimationFrame(tick);
		label(max, step, true);
	};

	const show = (index) => {
		shownIndex = index;
		const y = top + plotHeight * (1 - state.values[index] / state.max);
		cursor.setAttribute("x1", x(index, state.values.length));
		cursor.setAttribute("x2", x(index, state.values.length));
		dot.setAttribute("cx", x(index, state.values.length));
		dot.setAttribute("cy", y);
		hovered.setAttribute("x", Math.min(left + plotWidth - 24, Math.max(left + 24, x(index, state.values.length))));
		hovered.textContent = shortDate(state.points[index].date);
		svg.dataset.edge = index === 0 ? "first" : index === state.values.length - 1 ? "last" : "";
		svg.classList.add("hovering");
	};
	const hide = () => {
		shownIndex = null;
		svg.dataset.edge = "";
		svg.classList.remove("hovering");
	};
	hit.addEventListener("mousemove", (event) => {
		const box = svg.getBoundingClientRect();
		const index = Math.max(0, Math.min(state.points.length - 1, Math.round(((event.clientX - box.left - left) / plotWidth) * (state.points.length - 1))));
		show(index);
		state.onHover?.(state.points[index].date);
	});
	hit.addEventListener("mouseleave", () => {
		hide();
		state.onHover?.(null);
	});
	set(initial, false);
	return {
		update: (next) => set(next, true),
		show: (date) => {
			const index = state.points.findIndex((point) => point.date === date);
			if (index >= 0) show(index);
			else hide();
		},
		hide,
	};
}

function hideTooltip() {
	tooltip.hidden = true;
}

window.charts = { sparkline, areaChart, lineChart, hideTooltip, node };
