export const DASHBOARD_WIDGET_URI = "ui://opaline/dashboard.html";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

/** The Opaline mark as a monochrome 20px sidebar icon (`currentColor`). */
export const OPALINE_ICON = {
	src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgdmlld0JveD0iLTYwIC02MCAxMTY5IDExNjIiPjxwYXRoIGZpbGw9ImN1cnJlbnRDb2xvciIgZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNNTI0LjUzMiAwQzY2MS43MjUgNC41MjQyNSA3OTMuOTU2IDIwLjM4OTIgODkwLjE5IDEwMy40OTRDOTg2Ljc0NiAxODMuMzEzIDEwNDcuMjQgMzMwLjMyOSAxMDQ5IDUyMC42NUMxMDQ3LjI0IDcxMC45MTMgOTg2Ljc0NiA4NTcuOTkgODkwLjE5IDkzNy44MTdDNzkzLjk1NiAxMDIwLjkyIDY2MS43OSAxMDM2Ljc5IDUyNC41MzIgMTA0MS4zQzM4Ny4yNzQgMTAzNi43OSAyNTUuMSAxMDIwLjkyIDE1OC44NjYgOTM3LjgxN0M2Mi4zMTgyIDg1Ny45OSAxLjc2NzE2IDcxMS4wMDYgMCA1MjAuNjg0TDAuMDY0MDI1OSA1MjAuNjE2QzEuNzU4NzYgMzMwLjI0NSA2Mi4zMTg1IDE4My4yNDUgMTU4Ljg2NiAxMDMuNDk0QzI1NS4xIDIwLjM4OTIgMzg3LjI3NCA0LjUyNDI2IDUyNC41MzIgMFpNNTI0LjUxOCAyMjkuNDY5QzQ0Ny44NDcgMjMxLjk5NyAzNzQuMDE1IDI0MC44NjIgMzIwLjI1OSAyODcuM0MyNjYuMzI4IDMzMS44NjQgMjMyLjUgNDE0LjAwNyAyMzEuNTU0IDUyMC4zODRMMjMxLjUxOCA1MjAuNDJDMjMyLjUwNSA2MjYuNzcgMjY2LjMyOCA3MDguOTA0IDMyMC4yNTkgNzUzLjUxMUMzNzQuMDE1IDc5OS45NDggNDQ3Ljg0NyA4MDguODEzIDUyNC41MTggODExLjMzNkM2MDEuMTg5IDgwOC44MTMgNjc1LjAxNyA3OTkuOTQ4IDcyOC43NzMgNzUzLjUxMUM3ODIuNzA4IDcwOC45MDQgODE2LjUgNjI2LjcxOSA4MTcuNDgyIDUyMC40MDJDODE2LjUgNDE0LjA1MyA3ODIuNzA4IDMzMS45MDIgNzI4Ljc3MyAyODcuM0M2NzUuMDE3IDI0MC44NjIgNjAxLjE1MyAyMzEuOTk3IDUyNC41MTggMjI5LjQ2OVoiLz48L3N2Zz4=",
	mimeType: "image/svg+xml",
	sizes: ["20x20"],
};

// Rendered by MCP Apps hosts (ChatGPT, Codex Desktop) next to get_dashboard
// results. It reads the tool's structuredContent through the MCP Apps bridge
// or the window.openai compatibility global; text-only hosts never load it.
// Neutrals mirror the web cost dashboard (features/costs/cost-dashboard.css);
// accents are the glimm chain of the marketing hero canvas.
export const DASHBOARD_WIDGET_HTML = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
:root { color-scheme: light dark; --fg: #292a2f; --muted: #828387; --border: rgb(0 0 0 / 7%); --soft: rgb(0 0 0 / 3%); --surface: #fff; --fill: 0.14; --glimm: linear-gradient(90deg, #2e70ff, #7b4fff, #d33cff, #ff3dc0); }
@media (prefers-color-scheme: dark) { :root { --fg: #e6e6e9; --muted: #919299; --border: rgb(255 255 255 / 9%); --soft: rgb(255 255 255 / 4%); --surface: #191a1c; --fill: 0.22; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 8px; font: 13px/1.4 "Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif; font-variant-numeric: tabular-nums; color: var(--fg); background: transparent; }
.card { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); overflow: hidden; }
.head { display: flex; justify-content: space-between; gap: 16px; padding: 16px 20px 0; }
.muted { color: var(--muted); }
.value { margin-top: 2px; font-size: 22px; font-weight: 500; letter-spacing: -0.01em; }
.chips { display: none; flex-wrap: wrap; gap: 6px; padding: 12px 20px 0; }
.fullscreen .chips { display: flex; }
.fullscreen .plot { height: 320px; }
.loading .card { opacity: 0.6; transition: opacity 0.2s; }
.chips button { padding: 3px 10px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--muted); font: inherit; font-size: 12px; cursor: pointer; }
.chips button[aria-pressed="true"] { background: var(--soft); color: var(--fg); }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 12px 20px 0; font-size: 12px; }
.legend i { display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; }
.plot { position: relative; height: 150px; margin: 18px 20px 0 56px; }
.plot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.tick { position: absolute; left: -48px; width: 40px; text-align: right; font-size: 11px; transform: translateY(-50%); }
.axis { display: flex; justify-content: space-between; margin: 8px 20px 16px 56px; font-size: 11px; }
.rows { padding: 8px; border-top: 1px solid var(--border); }
.rows h2 { display: flex; justify-content: space-between; margin: 6px 12px; font-size: 13px; font-weight: 500; }
.rows h2 span { font-size: 11px; font-weight: 400; }
.row { position: relative; display: flex; gap: 12px; padding: 7px 12px 9px; border-radius: 8px; }
.row:hover { background: var(--soft); }
.row b { flex: 1; overflow: hidden; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
.share { position: absolute; left: 12px; bottom: 3px; height: 2px; border-radius: 1px; background: var(--glimm); opacity: 0.85; }
</style></head>
<body><div class="card" id="card" hidden>
<div class="head"><div><div class="muted" id="metric"></div><div class="value" id="total"></div></div><div class="muted" id="range"></div></div>
<div class="chips" id="chips"></div>
<div class="legend muted" id="error"></div>
<div class="legend" id="legend"></div>
<div class="plot" id="plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" id="chart"></svg></div>
<div class="axis muted" id="axis"></div>
<div class="rows" id="rows"></div>
</div>
<script>
const GLIMM = ["#2e70ff", "#7b4fff", "#d33cff", "#ff3dc0"];
const SERIES = ["#2e70ff", "#d33cff", "#00c48a", "#ff7a1a", "#7b4fff", "#ff3dc0", "#1fc8ff", "#e0b400"];
const METRICS = { cost: "API Cost", sessions: "Sessions", agentRuns: "Agent runs", signals: "Language signals", mergedPullRequests: "Merged PRs", ciFailuresPerPullRequest: "CI failures per PR" };
const DIMENSIONS = { members: "Members", repositories: "Repositories", models: "Models", signalTypes: "Signals", phrases: "Phrases", runSignals: "Run signals", durations: "Durations", skillsUsed: "Skills used" };
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const day = (date, year) => new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: year ? "numeric" : undefined, timeZone: "UTC" });
function niceMax(value) {
	const step = value / 3, power = 10 ** Math.floor(Math.log10(step || 1));
	return 3 * power * ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= step) || 10);
}
function render(data) {
	if (!data || !Array.isArray(data.trend) || data.trend.length === 0) return;
	const cost = data.metric === "cost";
	const format = (value, compact) => value === null ? "—" : new Intl.NumberFormat("en-US", cost ? { style: "currency", currency: "USD", maximumFractionDigits: compact ? 0 : 2 } : { maximumFractionDigits: 2 }).format(value);
	const split = data.splitBy !== "none" && data.series.length > 0;
	let trend = data.trend;
	if (trend.length > 45 && data.metric !== "ciFailuresPerPullRequest") {
		// Monday-to-Sunday UTC weeks, like the web dashboard.
		const weeks = new Map();
		for (const point of data.trend) {
			const monday = new Date(point.date + "T00:00:00Z");
			monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
			const key = monday.toISOString().slice(0, 10);
			const week = weeks.get(key) || { date: key, total: 0, values: {} };
			week.total += point.total;
			for (const [series, value] of Object.entries(point.values || {})) week.values[series] = (week.values[series] || 0) + value;
			weeks.set(key, week);
		}
		trend = [...weeks.values()];
	}
	const series = split
		? data.series.map((entry, index) => ({ ...entry, color: SERIES[index % SERIES.length], value: (point) => (point.values || {})[entry.id] ?? 0 }))
		: [{ id: "total", color: "url(#glimm)", value: (point) => point.total }];
	const max = niceMax(Math.max(...trend.flatMap((point) => series.map((entry) => entry.value(point)))) || 1);
	document.getElementById("metric").textContent = METRICS[data.metric] || data.metric;
	document.getElementById("total").textContent = format(data.total);
	const first = data.trend[0].date, last = data.trend[data.trend.length - 1].date;
	document.getElementById("range").textContent = day(first) + " – " + day(last, true) + (trend === data.trend ? " · Daily" : " · Weekly");
	document.getElementById("legend").replaceChildren(...(split ? series : []).map((entry) => { const item = el("span", "muted", entry.label); const dot = el("i"); dot.style.background = entry.color; item.prepend(dot); return item; }));
	const x = (index) => (trend.length < 2 ? 50 : (index / (trend.length - 1)) * 100);
	const y = (value) => 100 - (value / max) * 100;
	const stops = GLIMM.map((color, index) => '<stop offset="' + index / 3 + '" stop-color="' + color + '"/>').join("");
	let svg = '<defs><linearGradient id="glimm" gradientUnits="userSpaceOnUse" x1="0" x2="100" y1="0" y2="0">' + stops + '</linearGradient><linearGradient id="fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="area"><rect width="100" height="100" fill="url(#fade)"/></mask></defs>';
	for (const step of [0, 1, 2, 3]) svg += '<line x1="0" x2="100" y1="' + y((max * step) / 3) + '" y2="' + y((max * step) / 3) + '" stroke="var(--border)" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>';
	for (const entry of series) {
		// Undefined ratios (no pull requests that day) leave a gap.
		const line = trend.map((point, index) => (entry.value(point) === null ? "" : (index && entry.value(trend[index - 1]) !== null ? "L" : "M") + x(index) + " " + y(entry.value(point)))).join(" ");
		if (!split && data.metric !== "ciFailuresPerPullRequest") svg += '<path d="' + line + " L " + x(trend.length - 1) + " 100 L " + x(0) + ' 100 Z" fill="url(#glimm)" mask="url(#area)" style="opacity: var(--fill)"/>';
		svg += '<path d="' + line + '" fill="none" stroke="' + entry.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>';
	}
	document.getElementById("chart").innerHTML = svg;
	const plot = document.getElementById("plot");
	plot.querySelectorAll(".tick").forEach((tick) => tick.remove());
	for (const step of [0, 1, 2, 3]) { const tick = el("span", "tick muted", format((max * step) / 3, true)); tick.style.top = y((max * step) / 3) + "%"; plot.append(tick); }
	const marks = [...new Set([0, 1, 2, 3, 4].map((step) => Math.round((step * (trend.length - 1)) / 4)))];
	document.getElementById("axis").replaceChildren(...marks.map((index) => el("span", "", day(trend[index].date))));
	const top = data.top || {};
	const dimension = top[data.splitBy] ? data.splitBy : Object.keys(top)[0];
	const rows = (top[dimension] || []).slice(0, 5);
	const largest = Math.max(...rows.map((row) => row.value)) || 1;
	const heading = el("h2", "", DIMENSIONS[dimension] || dimension || "");
	heading.append(el("span", "muted", (METRICS[data.metric] || data.metric) + (cost ? " · USD" : "")));
	document.getElementById("rows").replaceChildren(...(rows.length ? [heading] : []), ...rows.map((row) => {
		const item = el("div", "row"), share = el("span", "share");
		const ratio = row.value / largest, color = split && series.find((entry) => entry.label === row.label)?.color;
		share.style.width = "calc((100% - 24px) * " + ratio + ")";
		if (color) share.style.background = color;
		else share.style.backgroundSize = 100 / Math.max(ratio, 0.01) + "% 100%";
		item.append(el("b", "", row.label), el("span", "", format(row.value)), share);
		return item;
	}));
	const days = Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1;
	const chip = (label, pressed, change) => { const button = el("button", "", label); button.setAttribute("aria-pressed", pressed); button.onclick = () => load({ ...data.query, ...change }); return button; };
	const startFor = (range) => new Date(Date.parse(last) - (range - 1) * 86400000).toISOString().slice(0, 10);
	document.getElementById("chips").replaceChildren(
		...[7, 30, 90].map((range) => chip(range + "D", range === days, { startDate: startFor(range), endDate: last })),
		...data.availableMetrics.map((metric) => chip(METRICS[metric] || metric, metric === data.metric, { metric })),
	);
	document.getElementById("card").hidden = false;
	document.getElementById("error").textContent = "";
	request("ui/update-model-context", { content: [{ type: "text", text: "The user is looking at Opaline " + (METRICS[data.metric] || data.metric) + " for " + day(first) + " – " + day(last, true) + ": " + format(data.total) + "." }] });
}
// Fullscreen (the sidebar app) gets range and metric controls that re-run
// get_dashboard through the host and keep the chat's context in step.
let nextId = 2;
const pending = new Map();
function request(method, params) {
	if (method === "tools/call" && window.openai && window.openai.callTool) return window.openai.callTool(params.name, params.arguments);
	return new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*"); });
}
let loadId = 0;
async function load(args) {
	const id = ++loadId;
	document.body.classList.add("loading");
	try {
		const result = await request("tools/call", { name: "get_dashboard", arguments: args });
		if (id !== loadId) return;
		if (!result || result.isError || !result.structuredContent) throw new Error((result && result.content && result.content[0] && result.content[0].text) || "Opaline could not load this view.");
		render(result.structuredContent);
	} catch (error) {
		if (id === loadId) document.getElementById("error").textContent = error.message + " Try again.";
	} finally {
		if (id === loadId) document.body.classList.remove("loading");
	}
}
const setDisplayMode = (mode) => mode && document.body.classList.toggle("fullscreen", mode === "fullscreen");
setDisplayMode(window.openai && window.openai.displayMode);
render(window.openai && window.openai.toolOutput);
window.addEventListener("openai:set_globals", () => { setDisplayMode(window.openai.displayMode); render(window.openai.toolOutput); });
window.addEventListener("message", (event) => {
	const message = event.data;
	if (!message) return;
	if (message.id === 1 && message.result) {
		setDisplayMode(message.result.hostContext && message.result.hostContext.displayMode);
		window.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, "*");
	}
	if (pending.has(message.id)) {
		const settle = pending.get(message.id);
		pending.delete(message.id);
		if (message.error) settle.reject(new Error(message.error.message));
		else settle.resolve(message.result);
	}
	if (message.method === "ui/notifications/host-context-changed") setDisplayMode(message.params && message.params.displayMode);
	if (message.method === "ui/notifications/tool-result") render(message.params && message.params.structuredContent);
});
window.parent.postMessage({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: { protocolVersion: "2026-01-26", appInfo: { name: "opaline-dashboard", version: "1.0.0" }, appCapabilities: {} } }, "*");
</script></body></html>`;
