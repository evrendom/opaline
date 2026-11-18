const api = window.opalineOnboarding;
if (api.nativeShadow) document.documentElement.dataset.nativeShadow = "";
const DEVICE = /^Mac/i.test(navigator.platform) ? "Mac" : "PC";
const content = document.querySelector(".content");
const dots = document.querySelector(".dots");
const button = document.querySelector(".primary");
const STEPS = ["count", "number", "days", "connect", "theme"];
const BOX_MEASURES = { count: "sessions", number: "sessions", metrics: "sessions" };
const COUNT_STEPS = new Set(["count", "number", "metrics"]);
const PARTS = { count: "welcome", number: "number", metrics: "metrics" };
const FLIP_EASE = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const FLIP_MS = 950;
const COLORS = [
	"oklch(0.623 0.188 259.815)",
	"oklch(0.637 0.208 25.331)",
	"oklch(0.723 0.192 149.579)",
	"oklch(0.769 0.165 70.08)",
	"oklch(0.606 0.219 292.717)",
	"oklch(0.656 0.212 354.308)",
	"oklch(0.715 0.126 215.221)",
	"oklch(0.705 0.187 47.604)",
];
const AGENTS = [
	{ key: "claude", label: "Claude Code", short: "Claude", color: "#D97757" },
	{ key: "codex", label: "Codex", short: "Codex", color: "#10A37F" },
];
const money = (value) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METRICS = [
	{
		key: "cost",
		label: "Cost",
		color: COLORS[3],
		outline: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M14.8 9a2 2 0 0 0 -1.8 -1h-2a2 2 0 1 0 0 4h2a2 2 0 1 1 0 4h-2a2 2 0 0 1 -1.8 -1"/><path d="M12 7v10"/>',
		filled: '<path d="M17 3.34a10 10 0 1 1 -15 8.66l.005 -.324a10 10 0 0 1 14.995 -8.336zm-5 2.66a1 1 0 0 0 -1 1a3 3 0 1 0 0 6v2a1.024 1.024 0 0 1 -.866 -.398l-.068 -.101a1 1 0 0 0 -1.732 .998a3 3 0 0 0 2.505 1.5h.161a1 1 0 0 0 .883 .994l.117 .007a1 1 0 0 0 1 -1l.176 -.005a3 3 0 0 0 -.176 -5.995v-2c.358 -.012 .671 .14 .866 .398l.068 .101a1 1 0 0 0 1.732 -.998a3 3 0 0 0 -2.505 -1.501h-.161a1 1 0 0 0 -1 -1zm1 7a1 1 0 0 1 0 2v-2zm-2 -4v2a1 1 0 0 1 0 -2z"/>',
		format: (value, axis) => (axis ? `$${Math.round(value).toLocaleString("en-US")}` : money(value)),
	},
	{
		key: "hours",
		label: "Hours",
		color: COLORS[6],
		outline: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 7v5l3 3"/>',
		filled: '<path d="M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-5 2.66a1 1 0 0 0 -.993 .883l-.007 .117v5l.009 .131a1 1 0 0 0 .197 .477l.087 .1l3 3l.094 .082a1 1 0 0 0 1.226 0l.094 -.083l.083 -.094a1 1 0 0 0 0 -1.226l-.083 -.094l-2.707 -2.708v-4.585l-.007 -.117a1 1 0 0 0 -.993 -.883z"/>',
		format: (value, axis) => (axis ? `${Math.round(value)}h` : `${value.toFixed(1)} h`),
	},
	{
		key: "sessions",
		label: "Sessions",
		color: COLORS[0],
		outline: '<path d="M21 14l-3 -3h-7a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1h9a1 1 0 0 1 1 1v10"/><path d="M14 15v2a1 1 0 0 1 -1 1h-7l-3 3v-10a1 1 0 0 1 1 -1h2"/>',
		filled: '<path d="M20.901 14.995a1 1 0 0 1 -.698 -.288l-2.707 -2.707h-6.586a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2h9a2 2 0 0 1 2 2v10a1 1 0 0 1 -1.009 .995"/><path d="M7 8.999v1.001a4 4 0 0 0 4 4h4v3a2 2 0 0 1 -2 2h-6.586l-2.707 2.707c-.63 .63 -1.707 .184 -1.707 -.707v-10a2 2 0 0 1 2 -2z"/>',
	},
	{
		key: "prompts",
		label: "Prompts",
		color: COLORS[4],
		outline: '<path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"/>',
		filled: '<path d="M13 2a1 1 0 0 1 1 1v6h5a1 1 0 0 1 .868 1.497l-.06 .091l-8 11c-.568 .783 -1.808 .38 -1.808 -.588v-6h-5a1 1 0 0 1 -.868 -1.497l.06 -.091l8 -11a1 1 0 0 1 .808 -.412z"/>',
	},
	{
		key: "failed",
		label: "Failures",
		color: COLORS[5],
		outline: '<path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0"/><path d="M12 16h.01"/>',
		filled: '<path d="M12 1.67c.955 0 1.845 .467 2.39 1.247l.105 .16l8.114 13.548a2.914 2.914 0 0 1 -2.307 4.363l-.195 .008h-16.225a2.914 2.914 0 0 1 -2.582 -4.2l.099 -.185l8.11 -13.538a2.914 2.914 0 0 1 2.491 -1.403zm.01 13.33l-.127 .007a1 1 0 0 0 0 1.986l.117 .007l.127 -.007a1 1 0 0 0 0 -1.986l-.117 -.007zm-.01 -7a1 1 0 0 0 -.993 .883l-.007 .117v4l.007 .117a1 1 0 0 0 1.986 0l.007 -.117v-4l-.007 -.117a1 1 0 0 0 -.993 -.883z"/>',
	},
];
METRICS.splice(1, 0, METRICS.splice(2, 1)[0]);
const DAILY = { cost: "daily_cost", hours: "daily_hours", sessions: "daily_sessions", prompts: "daily_prompts", failed: "daily_failed" };
const TOTAL = { cost: "cost", hours: "agent_hours", sessions: "sessions", prompts: "prompts", failed: "failed_calls" };

function formatMetric(metric, value, axis = false) {
	return metric.format ? metric.format(value, axis) : number(value);
}

function metricCard(metric, result) {
	const primary = metric.key === state.metric;
	const value = result.totals[metric.key];
	return `<button type="button" class="metric" data-metric="${metric.key}" data-primary="${primary}" style="--metric-color:${metric.color}">
		<span class="metric-header">
			<span class="metric-label"><svg class="metric-icon" viewBox="0 0 24 24" data-filled="${primary}" aria-hidden="true">${primary ? metric.filled : metric.outline}</svg>${metric.label}</span>
			<span class="metric-value" data-metric-value="${metric.key}" data-value="${value}">${formatMetric(metric, value)}</span>
		</span>
		<svg class="metric-sparkline" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true" data-spark="${metric.key}"></svg>
	</button>`;
}

let boxes = null;
let glass = null;
const BOX_DIALS = { count: [20, 2, 40, 1], gap: [12, 0, 16, 1], morph: [0.8, 0.2, 2, 0.05] };
let tuning = { boxes: Object.fromEntries(Object.entries(BOX_DIALS).map(([key, value]) => [key, value[0]])) };
const AGENT_PREVIEWS = {
	checking: null,
	missing: { installed: false },
	ready: { installed: true, connected: false },
	connecting: { installed: true, connecting: true },
	connected: { installed: true, connected: true, version: "1.4.0" },
	error: { installed: true, connected: false, error: "Couldn't add the plugin" },
};
const AGENT_DIAL = {
	type: "select",
	default: "live",
	options: [
		{ value: "live", label: "Live" },
		{ value: "checking", label: "Checking" },
		{ value: "missing", label: "Not found" },
		{ value: "ready", label: "Ready" },
		{ value: "connecting", label: "Connecting" },
		{ value: "connected", label: "Connected" },
		{ value: "error", label: "Error" },
	],
};
const tuningPanel = window.DialKit.createDialKit(
	"Onboarding",
	{ replay: { type: "action", label: "Replay intro" }, agents: { claude: AGENT_DIAL, codex: AGENT_DIAL }, boxes: BOX_DIALS },
	{ persist: { key: "opaline-onboarding-v7" }, onAction: (action) => action === "replay" && replayIntro() },
);
tuningPanel.subscribe((values) => {
	tuning = values;
	document.documentElement.style.setProperty("--morph", `${values.boxes.morph}s`);
	boxes?.update();
	queueMicrotask(previewAgents);
});
const frame = document.querySelector(".frame");
if (api.debug) {
	window.DialKit.createDialRoot({ position: "top-right", theme: "dark", defaultOpen: false });
	const dialRoot = [...document.body.children].find((element) => element.className.includes?.("dialkit"));
	if (dialRoot) frame.append(dialRoot);
}
let passing = true;
window.addEventListener("mousemove", (event) => {
	const through = !event.target.closest?.(".frame, [class*='dialkit']");
	if (through === passing) return;
	passing = through;
	api.passThrough(through);
});
const state = { step: 0, icons: {}, scan: null, result: null, analysis: null, metric: "cost", theme: "dark", agents: null };

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const number = (value) => Math.round(value).toLocaleString("en-US");

function icon(agent, className = "app-icon") {
	const source = state.icons[agent];
	return source ? `<img class="${className}" src="${source}" alt="" />` : "";
}

const FLOW_FORMAT = {
	cost: { format: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 } },
	hours: { format: { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }, numberSuffix: " h" },
};
const flows = new WeakMap();

function flowFor(element) {
	if (flows.has(element)) return flows.get(element);
	const flow = Object.assign(document.createElement("number-flow"), { locales: "en-US", ...(FLOW_FORMAT[element.dataset.metricValue] ?? { format: { maximumFractionDigits: 0 } }) });
	element.replaceChildren(flow);
	flows.set(element, flow);
	return flow;
}

const COUNT_TIMING = { duration: 1100, easing: "cubic-bezier(0.25, 1, 0.5, 1)" };

function integerDigits(value, format) {
	return new Intl.NumberFormat("en-US", format)
		.formatToParts(value)
		.filter((part) => part.type === "integer")
		.reduce((sum, part) => sum + part.value.length, 0);
}

function countUp(element) {
	const flow = flowFor(element);
	const target = Number(element.dataset.value);
	const format = flow.format;
	flow.format = { ...format, minimumIntegerDigits: integerDigits(target, format) };
	flow.update(0);
	requestAnimationFrame(() => {
		flow.spinTiming = COUNT_TIMING;
		flow.update(target);
		setTimeout(() => {
			flow.spinTiming = undefined;
			flow.format = format;
		}, COUNT_TIMING.duration + 100);
	});
}

function data() {
	const ok = (part) => (part && !part.error ? part : null);
	const parts = { claude: ok(state.result?.claude), codex: ok(state.result?.codex) };
	const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	const days = [];
	for (let index = 29; index >= 0; index -= 1) {
		const day = new Date();
		day.setHours(12, 0, 0, 0);
		day.setDate(day.getDate() - index);
		days.push(iso(day));
	}
	const series = {};
	const totals = {};
	for (const metric of METRICS) {
		const byDate = new Map(days.map((date) => [date, { date, value: 0, claude: 0, codex: 0 }]));
		for (const agent of AGENTS)
			for (const [date, value] of parts[agent.key]?.[DAILY[metric.key]] ?? []) {
				const point = byDate.get(date);
				if (!point) continue;
				point[agent.key] += Number(value);
				point.value += Number(value);
			}
		series[metric.key] = [...byDate.values()];
		totals[metric.key] = AGENTS.reduce((sum, agent) => sum + Number(parts[agent.key]?.[TOTAL[metric.key]] ?? 0), 0);
	}
	const error = state.result?.error ?? state.result?.claude?.error ?? state.result?.codex?.error;
	return {
		ok: Boolean(state.result) && (Boolean(parts.claude || parts.codex) || !error),
		error,
		series,
		totals,
		days,
	};
}

function table(caption, head, rows) {
	return `<table class="sr-only"><caption>${escape(caption)}</caption><tr>${head.map((cell) => `<th>${escape(cell)}</th>`).join("")}</tr>${rows
		.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`)
		.join("")}</table>`;
}

const SEARCH = '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true" data-icon="search"><path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6 -6"/></svg>';
const CHECK_FILLED = '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true" data-icon="ready"><path d="M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-1.293 5.953a1 1 0 0 0 -1.32 -.083l-.094 .083l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.403 1.403l.083 .094l2 2l.094 .083a1 1 0 0 0 1.226 0l.094 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z"/></svg>';

function agentPhase(status) {
	if (!status) return "checking";
	if (status.connecting) return "connecting";
	if (!status.installed) return "missing";
	if (status.connected) return "connected";
	return status.error ? "error" : "ready";
}

function agentTile(agent, settled = false) {
	const status = state.agents?.[agent.key];
	const phase = agentPhase(status);
	const action = {
		connecting: '<button type="button" class="agent-action" disabled><span class="spinner"></span>Connecting</button>',
		connected: `<span class="agent-action" data-done>${CHECK_FILLED}Connected</span>`,
		error: `<button type="button" class="agent-action" data-connect="${agent.key}">Try again</button>`,
		ready: `<button type="button" class="agent-action" data-connect="${agent.key}">Connect</button>`,
		checking: `<button type="button" class="agent-action" data-connect="${agent.key}">Connect</button>`,
	}[phase] ?? '<button type="button" class="agent-action" disabled>Connect</button>';
	return `<article class="agent" data-agent="${agent.key}" data-phase="${phase}"${settled ? " data-settled" : ""} style="--agent-color:${agent.color}">
		${icon(agent.key, "agent-icon") || `<span class="agent-icon" data-blank>${agent.label[0]}</span>`}
		<h3>${agent.label}</h3>
		${action}
	</article>`;
}

function connectLabel() {
	const open = AGENTS.filter((agent) => !state.agents?.[agent.key]?.connected);
	if (!open.length) return "Continue";
	if (open.length === AGENTS.length) return "Skip";
	return `Skip ${open[0].short}`;
}

function showAgent(key) {
	if (STEPS[state.step] !== "connect") return;
	const tile = content.querySelector(`[data-agent="${key}"]`);
	if (!tile) return;
	const holder = document.createElement("div");
	holder.innerHTML = agentTile(AGENTS.find((entry) => entry.key === key), true);
	const next = holder.firstElementChild;
	const changed = next.dataset.phase !== tile.dataset.phase;
	const before = tile.querySelector(".agent-action").getBoundingClientRect().width;
	tile.replaceWith(next);
	if (changed) {
		const action = next.querySelector(".agent-action");
		action.innerHTML = `<span class="action-content appear">${action.innerHTML}</span>`;
		const after = action.getBoundingClientRect().width;
		if (before && Math.abs(before - after) > 0.5) action.animate([{ width: `${before}px` }, { width: `${after}px` }], { duration: 480, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
	}
	footer(STEPS[state.step]);
}

const liveAgents = {};

function previewAgents() {
	const picks = tuning.agents ?? {};
	state.agents = Object.fromEntries(AGENTS.map((agent) => {
		const pick = picks[agent.key] ?? "live";
		return [agent.key, pick === "live" || !(pick in AGENT_PREVIEWS) ? liveAgents[agent.key] : AGENT_PREVIEWS[pick] ?? undefined];
	}));
	for (const agent of AGENTS) showAgent(agent.key);
}

async function connect(key) {
	liveAgents[key] = { ...liveAgents[key], connecting: true, error: null, detail: null };
	previewAgents();
	liveAgents[key] = await api.connect(key);
	previewAgents();
}

const views = {
	reading: () => `
		<section class="view reading">
			<div class="glass-scene" data-glass-scene aria-hidden="true"></div>
			<div class="count-top">
				<div class="header-row"><h2 data-month-title></h2><p data-month-note></p></div>
				<div class="metrics count-strip" data-strip></div>
			</div>
			<div class="count-stage">
				<p class="count-kicker" data-count-kicker>Welcome to Opaline</p>
				<div class="glass-host" data-glass></div>
				<p class="count-note" data-count-note>Pulling back the curtains<br />on your agent sessions</p>
			</div>
			<div class="boxes-area" data-boxes></div>
			<div class="reading-center">
				<h1 class="reading-title" data-reading-title><span data-title-figure></span><span data-title-unit></span></h1>
				<p class="lede" data-reading-note></p>
			</div>
		</section>`,
	days: () => {
		const result = data();
		if (!result.ok)
			return `<section class="view center"><h2>We couldn't read your sessions</h2><p class="lede">${escape(result.error ?? `No Claude Code or Codex sessions were found on this ${DEVICE}.`)}</p></section>`;
		const metric = METRICS.find((entry) => entry.key === state.metric);
		return `
			<section class="view">
				<div class="header-row"><h2>Your month with agents</h2><p>Last 30 days</p></div>
				<div class="metrics">${METRICS.map((entry) => metricCard(entry, result)).join("")}</div>
				<div class="dots-box"><div class="dots-area" data-chart="dots"></div></div>
				<section class="chart-card">
					<div class="chart-key"><span class="chart-title">${metric.label} over time</span>
					</div>
					<div class="chart-canvas" data-chart="trend"></div>
					${table(`${metric.label} per day`, ["Day", ...AGENTS.map((agent) => agent.label)], result.series[metric.key].map((point) => [point.date, ...AGENTS.map((agent) => formatMetric(metric, point[agent.key]))]))}
				</section>
			</section>`;
	},
	connect: () => `
		<section class="view stage connect">
			<div class="stage-frame">
				<h2 class="stage-title" data-stage-title>Connect your agents</h2>
				<div class="stage-host"><div class="agents">${AGENTS.map((agent) => agentTile(agent)).join("")}</div></div>
			</div>
		</section>`,
	theme: () => `
		<section class="view stage theme-pick">
			<div class="stage-frame">
			<h2 class="stage-title" data-stage-title>Choose your look</h2>
			<div class="stage-host"><div class="themes" role="radiogroup" aria-label="Appearance">
				${["dark", "light", "auto"]
					.map(
						(theme) => `<button type="button" class="theme" role="radio" data-theme-choice="${theme}" aria-checked="${state.theme === theme}">
							${theme === "auto" ? `<span class="theme-preview theme-split">${["dark", "light"].map((half) => `<span class="theme-preview theme-half" data-preview="${half}"><img class="theme-shot" src="previews/${half}.png" alt="" /></span>`).join("")}</span>` : `<span class="theme-preview" data-preview="${theme}"><img class="theme-shot" src="previews/${theme}.png" alt="" /></span>`}
							<span class="theme-name">${{ dark: "Dark", light: "Light", auto: "Auto" }[theme]}</span>
						</button>`,
					)
					.join("")}
			</div></div>
			</div>
		</section>`,
};

let dotChart = null;

function dotProps(result) {
	const metric = METRICS.find((entry) => entry.key === state.metric);
	return {
		color: metric.color,
		fit: true,
		format: (value) => formatMetric(metric, value),
		interval: "daily",
		label: metric.label,
		points: result.series[metric.key].map((point) => ({ date: point.date, startDate: point.date, endDate: point.date, total: point.value, values: {} })),
	};
}

function shortDay(iso) {
	return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

let trendChart = null;

const boxFeed = {
	sessions: [],
	done: false,
	get count() {
		return tuning.boxes.count;
	},
	get gap() {
		return tuning.boxes.gap;
	},
};

const isoDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function readSessions() {
	return AGENTS.flatMap((agent) => {
		const part = state.result?.[agent.key];
		const sessions = (part?.session_models ?? []).map(([model, start, events, folder, tokens, seconds, prompts, failed]) => ({
			agent: agent.key,
			model,
			start: Number(start) || null,
			day: start ? isoDay(new Date(Number(start) * 1000)) : null,
			events: Number(events) || 0,
			folder,
			tokens: Number(tokens) || 0,
			seconds: Number(seconds) || 0,
			prompts: Number(prompts) || 0,
			failed: Number(failed) || 0,
		}));
		const dayCost = new Map((part?.daily_cost ?? []).map(([date, cost]) => [date, Number(cost)]));
		const dayTokens = new Map();
		for (const session of sessions) dayTokens.set(session.day, (dayTokens.get(session.day) ?? 0) + session.tokens);
		for (const session of sessions) session.cost = (dayCost.get(session.day) ?? 0) * (session.tokens / (dayTokens.get(session.day) || 1));
		return sessions;
	});
}

const SESSION_VALUE = {
	sessions: () => 1,
	cost: (session) => session.cost,
	hours: (session) => session.seconds,
	prompts: (session) => session.prompts,
	failed: (session) => session.failed,
};

function sessionsByDay(key) {
	const days = data().days;
	const index = new Map(days.map((date, position) => [date, position]));
	const values = boxFeed.sessions.map((session) => SESSION_VALUE[key](session));
	const peak = Math.max(...values, 0);
	const perDay = days.map(() => []);
	boxFeed.sessions.forEach((session, position) => {
		const day = index.get(session.day);
		if (day === undefined) return;
		const share = peak > 0 ? Math.sqrt(values[position] / peak) : 0;
		perDay[day].push(key === "failed" && values[position] > 0 ? 0.3 + share * 0.7 : share);
	});
	return perDay;
}

const swatch = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

function rgbOf(color) {
	swatch.clearRect(0, 0, 1, 1);
	swatch.fillStyle = color;
	swatch.fillRect(0, 0, 1, 1);
	const [r, g, b] = swatch.getImageData(0, 0, 1, 1).data;
	return [r / 255, g / 255, b / 255];
}

function metricSpec(key) {
	const metric = METRICS.find((entry) => entry.key === key);
	return { days: dailyCurve(key), tone: rgbOf(metric.color), sessions: sessionsByDay(key) };
}

function fillStrip(view) {
	const strip = view.querySelector("[data-strip]");
	const result = data();
	if (strip.dataset.filled !== undefined || !result.ok) return;
	strip.dataset.filled = "";
	strip.innerHTML = METRICS.map((metric) => metricCard(metric, result)).join("");
	for (const element of strip.querySelectorAll("[data-metric-value]")) countUp(element);
	for (const svg of strip.querySelectorAll("[data-spark]")) window.charts.sparkline(svg, result.series[svg.dataset.spark].map((point) => point.value));
}

function showReading() {
	const view = content.querySelector(".view.reading");
	if (!view || !state.result || view.dataset.done !== undefined) return;
	view.dataset.done = "";
	const result = data();
	if (result.ok) {
		boxFeed.sessions = readSessions();
		boxFeed.done = true;
		boxes?.update();
		glass.set(boxFeed.sessions.length.toLocaleString("en-US"));
		countText(view);
	} else {
		view.querySelector("[data-count-kicker]").textContent = "We couldn't read your sessions";
		view.querySelector("[data-reading-title]").textContent = "We couldn't read your sessions";
		view.querySelector("[data-reading-note]").textContent = result.error ?? `No Claude Code or Codex sessions were found on this ${DEVICE}.`;
	}
	if (result.ok) glass.curve(dailyCurve());
	glass.finish().then(() => {
		if (content.querySelector(".view.reading") !== view) return;
		introReady = true;
		footer(STEPS[state.step]);
	});
}

function dailyCurve(key = "sessions") {
	const values = data().series[key].map((point) => point.value);
	const smooth = values.map((_, index) => {
		let sum = 0;
		let weight = 0;
		for (let offset = -3; offset <= 3; offset += 1) {
			const value = values[index + offset];
			if (value === undefined) continue;
			const w = Math.exp(-(offset * offset) / 4.5);
			sum += value * w;
			weight += w;
		}
		return sum / weight;
	});
	const peak = Math.max(...smooth);
	return smooth.map((value) => (peak > 0 ? value / peak : 0));
}

function appear(element, html, { delay = 0, words = false, still = false } = {}) {
	if (element.dataset.text === html) return;
	element.dataset.text = html;
	const hold = still ? " data-still" : "";
	if (!words) element.innerHTML = `<span class="appear"${hold} style="--at:${delay}ms">${html}</span>`;
	else
		element.innerHTML = html
			.split(" ")
			.map((word, index, list) => `<span class="appear"${hold} style="--at:${delay + index * 40}ms">${escape(word)}${index < list.length - 1 ? " " : ""}</span>`)
			.join("");
	spanLight(element);
}

const SVG_NS = "http://www.w3.org/2000/svg";
const glyphDefs = document.querySelector("svg.defs");
const glyphClips = new WeakMap();
const glyphMetrics = document.createElement("canvas").getContext("2d");
let glyphCount = 0;

function spanLight(element) {
	for (const clip of glyphClips.get(element) ?? []) clip.remove();
	if (!element.matches(".count-kicker, .count-note")) return;
	const clips = [];
	for (const span of element.children) {
		const style = getComputedStyle(span);
		glyphMetrics.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
		const ascent = glyphMetrics.measureText("Hg").fontBoundingBoxAscent;
		const box = span.getBoundingClientRect();
		const clip = document.createElementNS(SVG_NS, "clipPath");
		clip.id = `glyphs-${++glyphCount}`;
		for (const node of span.childNodes) {
			if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
			const range = document.createRange();
			range.selectNodeContents(node);
			const rect = range.getClientRects()[0];
			if (!rect) continue;
			const text = document.createElementNS(SVG_NS, "text");
			text.setAttribute("x", (rect.left - box.left).toFixed(2));
			text.setAttribute("y", (rect.top - box.top + ascent).toFixed(2));
			text.setAttribute("style", `font-family:${style.fontFamily};font-size:${style.fontSize};font-weight:${style.fontWeight};font-stretch:${style.fontStretch};font-optical-sizing:${style.fontOpticalSizing};font-feature-settings:${style.fontFeatureSettings};font-variation-settings:${style.fontVariationSettings};font-kerning:${style.fontKerning};letter-spacing:${style.letterSpacing};white-space:pre`);
			text.textContent = node.textContent;
			clip.append(text);
		}
		glyphDefs.append(clip);
		clips.push(clip);
		span.style.setProperty("--glyphs", `url(#${clip.id})`);
	}
	glyphClips.set(element, clips);
	shine();
}

document.fonts.ready.then(() => document.querySelectorAll(".count-kicker, .count-note").forEach(spanLight));
new ResizeObserver(shine).observe(document.querySelector(".footer-pill"));

function handover(element, text) {
	const before = element.dataset.text ?? element.textContent;
	if (before === text) return;
	element.dataset.text = text;
	const from = before.split(" ");
	const to = text.split(" ");
	let shared = 0;
	while (shared < Math.min(from.length, to.length) - 1 && from.at(-1 - shared) === to.at(-1 - shared)) shared += 1;
	const tail = to.slice(to.length - shared).join(" ");
	const outgoing = from.slice(0, from.length - shared).join(" ");
	const incoming = to.slice(0, to.length - shared).join(" ");
	element.innerHTML = `<span class="swap"><span class="swap-out">${escape(outgoing)}</span><span class="swap-in">${escape(incoming)}</span></span>${tail ? ` ${escape(tail)}` : ""}`;
	const swap = element.querySelector(".swap");
	const width = (node) => node.getBoundingClientRect().width;
	const start = width(swap.firstElementChild);
	const end = width(swap.lastElementChild);
	swap.style.width = `${start}px`;
	swap.getBoundingClientRect();
	swap.style.width = `${end}px`;
	setTimeout(() => {
		swap.firstElementChild?.classList.contains("swap-out") && swap.firstElementChild.remove();
		swap.style.width = "";
	}, 720);
}

function countText(view) {
	const welcome = view.dataset.part === "welcome";
	const intro = view.dataset.appeared === undefined;
	view.dataset.appeared = "";
	const still = welcome && intro;
	appear(view.querySelector("[data-count-kicker]"), welcome ? "Welcome to Opaline" : `Sessions on this ${DEVICE}.`, { words: true, delay: intro ? 400 : 0, still });
	appear(view.querySelector("[data-count-note]"), welcome ? "Pulling back the curtains<br />on your agent sessions" : "The last 30 days, read locally.", { delay: intro ? 640 : 240, still });
}

let swapping = 0;

async function showPart(view, part) {
	const turn = ++swapping;
	introReady = false;
	footer(STEPS[state.step]);
	const texts = (view.dataset.part === "welcome") !== (part === "welcome") || part === "number";
	if (texts) view.dataset.swapping = "";
	glass.badge(part === "welcome");
	const shown = glass.appear(part === "number");
	if (part === "metrics") {
		fillStrip(view);
		monthHeader(view.querySelector("[data-month-title]"), view.querySelector("[data-month-note]"), 80);
	}
	glass.metric(part === "metrics" && data().ok ? metricSpec(state.metric) : null);
	if (part === "metrics") view.dataset.part = part;
	await new Promise((done) => setTimeout(done, part === "number" ? 1000 : 450));
	if (turn !== swapping || content.querySelector(".view.reading") !== view) return;
	view.dataset.part = part;
	countText(view);
	delete view.dataset.swapping;
	await shown;
	if (turn !== swapping) return;
	introReady = true;
	footer(STEPS[state.step]);
}

function replayIntro() {
	glass?.destroy();
	glass = null;
	boxes?.destroy();
	boxes = null;
	content.replaceChildren();
	state.step = 0;
	state.scan = null;
	state.result = null;
	state.analysis = null;
	boxFeed.sessions = [];
	boxFeed.done = false;
	render();
	startAnalysis();
}

function trendProps(result) {
	const metric = METRICS.find((entry) => entry.key === state.metric);
	return {
		points: result.series[metric.key],
		color: metric.color,
		format: (value, axis) => formatMetric(metric, value, axis),
		onHover: (date) => {
			dotChart?.focus(date);
			showDay(date);
		},
	};
}

function drawTrend(result) {
	const trend = content.querySelector('[data-chart="trend"]');
	if (!trend) return;
	if (trendChart && trend.firstElementChild) return trendChart.update(trendProps(result));
	trend.replaceChildren();
	trendChart = window.charts.lineChart(trend, trendProps(result));
}

function showDay(date) {
	const result = data();
	if (!result.ok) return;
	for (const card of content.querySelectorAll(".metric")) {
		const metric = METRICS.find((entry) => entry.key === card.dataset.metric);
		const point = date ? result.series[metric.key].find((each) => each.date === date) : null;
		flowFor(card.querySelector(".metric-value")).update(point ? point.value : result.totals[metric.key]);
	}
}

function drawCharts() {
	const result = data();
	const area = content.querySelector('[data-chart="dots"]');
	if (area && result.ok) {
		dotChart = window.opalineDots.mount(area, dotProps(result), (date) => {
			if (date) trendChart?.show(date);
			else trendChart?.hide();
			showDay(date);
		});
		area.dotChart = dotChart;
	}
	for (const svg of content.querySelectorAll("[data-spark]"))
		window.charts.sparkline(svg, result.series[svg.dataset.spark].map((point) => point.value));
	drawTrend(result);
	if (area && result.ok) setTimeout(() => showDay(null), 1150);
}

function selectMetric(key) {
	if (key === state.metric) return;
	state.metric = key;
	tint("1300ms cubic-bezier(0.45, 0, 0.55, 1)");
	const metric = METRICS.find((entry) => entry.key === key);
	for (const card of content.querySelectorAll(".metric")) {
		const entry = METRICS.find((item) => item.key === card.dataset.metric);
		const primary = entry.key === key;
		card.dataset.primary = String(primary);
		const glyph = card.querySelector(".metric-icon");
		glyph.dataset.filled = String(primary);
		glyph.innerHTML = primary ? entry.filled : entry.outline;
	}
	const result = data();
	if (content.querySelector(".view.reading")?.dataset.part === "metrics") glass?.metric(metricSpec(key));
	dotChart?.update(dotProps(result));
	if (!content.querySelector('[data-chart="trend"]')) return;
	handover(content.querySelector(".chart-title"), `${metric.label} over time`);
	drawTrend(result);
}

content.addEventListener("click", (event) => {
	const card = event.target.closest(".metric");
	if (card) selectMetric(card.dataset.metric);
	const choice = event.target.closest("[data-theme-choice]");
	if (choice) pickTheme(choice.dataset.themeChoice);
	const agent = event.target.closest("[data-connect]");
	if (agent) connect(agent.dataset.connect);
});

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function resolvedTheme() {
	return state.theme === "auto" ? (systemDark.matches ? "dark" : "light") : state.theme;
}

function applyTheme() {
	const theme = resolvedTheme();
	document.documentElement.dataset.theme = theme;
	document.documentElement.classList.toggle("dark", theme === "dark");
	glass?.theme(theme === "light");
}

systemDark.addEventListener("change", () => state.theme === "auto" && applyTheme());

function pickTheme(theme) {
	state.theme = theme;
	applyTheme();
	for (const element of content.querySelectorAll("[data-theme-choice]"))
		element.setAttribute("aria-checked", String(element.dataset.themeChoice === theme));
	api.theme(theme === "auto" ? "system" : theme);
}

const DASH = 10;
const DASH_ACTIVE = 36;
const DASH_GAP = 4;

function tint(motion = "560ms cubic-bezier(0.65, 0, 0.35, 1)") {
	const metric = STEPS[state.step] === "days" ? METRICS.find((entry) => entry.key === state.metric) : null;
	const color = metric?.color ?? "oklch(1 0 0)";
	if (getComputedStyle(document.documentElement).getPropertyValue("--tint-to").trim() === color) return;
	document.documentElement.style.setProperty("--tint-motion", motion);
	document.documentElement.style.setProperty("--tint", color);
	document.documentElement.style.setProperty("--tint-to", color);
	dots.toggleAttribute("data-tint", Boolean(metric));
}

function footer(name) {
	tint();
	const ready = Boolean(state.result) && introReady;
	button.disabled = (COUNT_STEPS.has(name) && !ready) || building;
	const analyzing = COUNT_STEPS.has(name) && !state.result;
	const label = { connect: connectLabel(), theme: "Open Opaline" }[name] ?? (analyzing ? "Analyzing sessions…" : "Continue");
	const glyph = analyzing ? SEARCH : name === "count" ? CHECK_FILLED : "";
	if (button.dataset.label !== label + glyph) {
		button.dataset.label = label + glyph;
		const before = button.getBoundingClientRect().width;
		button.style.width = "";
		const first = !button.querySelector(".button-wipe");
		if (first) {
			button.dataset.instant = "";
			requestAnimationFrame(() => requestAnimationFrame(() => delete button.dataset.instant));
		}
		button.innerHTML = `<span class="button-wipe" style="animation:none"></span><span class="button-content${first ? "" : " appear"}">${glyph}<span>${label}</span></span>`;
		const after = button.getBoundingClientRect().width;
		if (!first && before && Math.abs(before - after) > 0.5) {
			button.style.width = `${before}px`;
			button.getBoundingClientRect();
			button.style.width = `${after}px`;
			clearTimeout(button.settle);
			button.settle = setTimeout(() => (button.style.width = ""), 520);
		}
	}
	if (dots.childElementCount !== STEPS.length) {
		dots.dataset.instant = "";
		dots.innerHTML = STEPS.map((_, index) => `<button type="button" data-step="${index}" aria-label="Back to step ${index + 1}"><i></i></button>`).join("");
		requestAnimationFrame(() => requestAnimationFrame(() => delete dots.dataset.instant));
	}
	const total = DASH_ACTIVE + (STEPS.length - 1) * DASH + (STEPS.length - 1) * DASH_GAP;
	dots.style.setProperty("--dots-width", `${total}px`);
	let offset = 0;
	[...dots.children].forEach((dot, index) => {
		dot.firstElementChild.style.setProperty("--dash-x", `${-offset}px`);
		offset += (index === state.step ? DASH_ACTIVE : DASH) + DASH_GAP;
	});
	const at = (state.step / Math.max(1, STEPS.length - 1)) * 4;
	const low = Math.min(3, Math.floor(at));
	dots.style.setProperty("--step-color", `color-mix(in oklch, var(--opal-${low + 1}) ${Math.round((1 - (at - low)) * 100)}%, var(--opal-${low + 2}))`);
	[...dots.children].forEach((dot, index) => {
		dot.disabled = index >= state.step;
		dot.firstElementChild.toggleAttribute("data-active", index === state.step);
		dot.firstElementChild.toggleAttribute("data-done", index < state.step);
	});
}

let introReady = false;

const light = { level: 1, glint: 0, x: -1.4, y: -1.9 };
const LIT = ".count-kicker > .appear, .count-note > .appear, .pill-light";

function lightUp(level, glint, point) {
	const dawn = light.level === 0 && level > 0;
	light.level = level;
	light.glint = glint;
	light.x = point.x / window.innerWidth;
	light.y = point.y / window.innerHeight;
	shine();
	if (dawn && state.result && content.querySelector(".view.reading")) {
		introReady = true;
		footer(STEPS[state.step]);
	}
}

function shine() {
	const root = document.documentElement;
	const x = light.x * window.innerWidth;
	const y = light.y * window.innerHeight;
	const card = document.querySelector(".card").getBoundingClientRect();
	const near = Math.hypot(Math.max(card.left - x, 0, x - card.right), Math.max(card.top - y, 0, y - card.bottom));
	const far = Math.max(...[[card.left, card.top], [card.right, card.top], [card.left, card.bottom], [card.right, card.bottom]].map(([cx, cy]) => Math.hypot(cx - x, cy - y)));
	root.style.setProperty("--reveal", light.level.toFixed(4));
	root.style.setProperty("--glint", light.glint.toFixed(4));
	root.style.setProperty("--light-near", `${near.toFixed(1)}px`);
	root.style.setProperty("--light-far", `${far.toFixed(1)}px`);
	for (const element of document.querySelectorAll(LIT)) {
		const box = element.getBoundingClientRect();
		element.style.setProperty("--lx", `${(x - box.left).toFixed(1)}px`);
		element.style.setProperty("--ly", `${(y - box.top).toFixed(1)}px`);
		element.style.setProperty("--gx", `${(x - box.left).toFixed(1)}px`);
	}
}

window.addEventListener("resize", shine);

function baselineOf(element) {
	const probe = document.createElement("span");
	probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
	element.append(probe);
	const y = probe.getBoundingClientRect().top;
	probe.remove();
	return y;
}

async function flip(view, toBoxes) {
	const scene = view.querySelector("[data-glass-scene]");
	const figure = view.querySelector("[data-title-figure]");
	delete scene.dataset.paused;
	view.dataset.flying = "";
	view.dataset.stage = toBoxes ? "boxes" : "count";
	const box = figure.getBoundingClientRect();
	const target = { left: box.left, baseline: baselineOf(figure), capHeight: parseFloat(getComputedStyle(figure).fontSize) * glass.capRatio };
	if (toBoxes) boxes.enter();
	else glass.settle(1);
	await glass.fly(target, { duration: FLIP_MS, ease: FLIP_EASE, reverse: !toBoxes });
	if (view.dataset.stage === (toBoxes ? "boxes" : "count")) {
		delete view.dataset.flying;
		if (toBoxes) scene.dataset.paused = "";
	}
}

function render() {
	const name = STEPS[state.step];
	const reading = content.querySelector(".view.reading");
	const month = content.querySelector(".view[data-handoff]:not([data-leaving])");
	const stage = content.querySelector(".view.stage[data-over-scene]:not([data-leaving])");
	const handedOff = reading?.dataset.handedOff !== undefined;
	if (glass && reading && handedOff) {
		const overlays = [month, stage].filter(Boolean);
		if (COUNT_STEPS.has(name)) return rewind(reading, overlays, name);
		if (name === "days") return month ? footer(name) : backToMonth(reading, overlays);
		if (month) return leaveMonth(month, name);
		if (stage?.dataset.stage === name) return footer(name);
		if (stage) return swapStage(stage, name);
		return enterStage(name);
	}
	const view = reading && !handedOff ? reading : null;
	if (name === "days" && view && glass && data().ok) {
		if (view.dataset.part === "metrics") return handoff(view);
		if (view.dataset.stage === "count") return buildUp(view);
	}
	if (BOX_MEASURES[name] && boxes && view) {
		const wasCount = view.dataset.stage === "count";
		const toCount = COUNT_STEPS.has(name);
		if (toCount && wasCount) showPart(view, PARTS[name]);
		else if (toCount && !wasCount) {
			if (name !== "metrics") glass.metric(null);
			for (const element of view.querySelectorAll("[data-count-kicker], [data-count-note]")) delete element.dataset.text;
			countText(view);
			flip(view, false).then(() => name !== "number" && showPart(view, PARTS[name]));
		}
		else if (!toCount && wasCount) {
			if (view.dataset.part === "metrics") {
				glass.appear(true);
				view.dataset.part = "number";
			}
			flip(view, true);
		}
		boxes.show(BOX_MEASURES[name]);
		return footer(name);
	}
	glass?.destroy();
	glass = null;
	window.charts.hideTooltip();
	dotChart?.unmount();
	dotChart = null;
	boxes?.destroy();
	boxes = null;
	trendChart = null;
	content.innerHTML = (views[name] ?? views.reading)();
	const stageTitle = content.querySelector("[data-stage-title]");
	if (stageTitle) appear(stageTitle, stageTitle.textContent, { words: true });
	for (const element of content.querySelectorAll("[data-metric-value]")) countUp(element);
	requestAnimationFrame(drawCharts);
	footer(name);
	if (BOX_MEASURES[name]) {
		const reading = content.querySelector(".view.reading");
		reading.dataset.stage = COUNT_STEPS.has(name) ? "count" : "boxes";
		reading.dataset.part = name === "count" ? "welcome" : "number";
		const scene = reading.querySelector("[data-glass-scene]");
		countText(reading);
		introReady = false;
		glass = window.glass3d.mount(scene, reading.querySelector("[data-glass]"), { number: name !== "count", badge: name === "count", onLight: lightUp, light: resolvedTheme() === "light", lit: Boolean(state.result), days: state.result && data().ok ? dailyCurve() : null });
		if (!COUNT_STEPS.has(name)) {
			glass.settle(1);
			scene.dataset.paused = "";
		}
		boxes = window.repoBoxes.mount(reading, () => boxFeed, BOX_MEASURES[name]);
		showReading();
		if (name === "metrics") showPart(reading, "metrics");
		footer(name);
	}
}

let building = false;
let navTurn = 0;
const METRICS_BEAT_MS = 1000;

async function buildUp(view) {
	const turn = navTurn;
	building = true;
	footer("days");
	showPart(view, "metrics");
	await new Promise((done) => setTimeout(done, METRICS_BEAT_MS));
	if (turn !== navTurn) return;
	building = false;
	if (STEPS[state.step] !== "days" || content.querySelector(".view.reading") !== view || view.dataset.part !== "metrics") return footer(STEPS[state.step]);
	handoff(view);
}

const AGENT_TINTS = {
	claude: ["oklch(0.76 0.11 39.2)", "oklch(0.659 0.146 39.2)", "oklch(0.6 0.14 39.2)"],
	codex: ["oklch(0.774 0.128 295.5)", "oklch(0.679 0.167 268.4)", "oklch(0.498 0.283 271.2)"],
};

function oklchToHex(value) {
	const [l, c, h] = value.match(/[\d.]+/g).map(Number);
	const a = c * Math.cos((h * Math.PI) / 180);
	const b = c * Math.sin((h * Math.PI) / 180);
	const lms = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map((x) => x ** 3);
	const linear = [
		4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
		-1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
		-0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
	];
	return `#${linear
		.map((x) => {
			const v = Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
			return Math.round(v * 255).toString(16).padStart(2, "0");
		})
		.join("")}`;
}
const LEAVE_MS = 520;
const LEAVE_GAP_MS = 70;

function later(ms, run) {
	const turn = navTurn;
	setTimeout(() => turn === navTurn && run(), ms);
}

function fadeOut(parts) {
	parts.forEach((part, index) =>
		part.animate([{ opacity: 1, filter: "blur(0px)", transform: "none" }, { opacity: 0, filter: "blur(10px)", transform: "translateY(12px)" }], { duration: LEAVE_MS, delay: index * LEAVE_GAP_MS, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)", fill: "forwards" }),
	);
	return parts.length ? LEAVE_MS + LEAVE_GAP_MS * (parts.length - 1) : 0;
}

function partsOf(view) {
	const selectors = view.dataset.handoff !== undefined ? [".chart-card", ".dots-box", ".metrics", ".header-row"] : [".stage-host", ".stage-title"];
	return selectors.map((selector) => view.querySelector(selector)).filter(Boolean);
}

function retire(overlays) {
	window.charts.hideTooltip();
	let wait = 0;
	for (const view of overlays) {
		view.dataset.leaving = "";
		const done = fadeOut(partsOf(view));
		wait = Math.max(wait, done);
		setTimeout(() => {
			const chart = view.querySelector('[data-chart="dots"]')?.dotChart;
			chart?.unmount();
			if (chart && chart === dotChart) {
				dotChart = null;
				trendChart = null;
			}
			view.remove();
		}, done);
	}
	return wait;
}

function enterStage(name) {
	const holder = document.createElement("div");
	holder.innerHTML = views[name]();
	const view = holder.firstElementChild;
	view.dataset.overScene = "";
	view.dataset.stage = name;
	view.style.cssText = "position:relative;z-index:1";
	content.append(view);
	const title = view.querySelector("[data-stage-title]");
	appear(title, title.textContent, { words: true });
	footer(name);
}

function leaveMonth(month, name) {
	footer(name);
	glass.metric(null);
	glass.handoff(1.1, 0);
	later(retire([month]), () => enterStage(name));
}

function swapStage(stage, name) {
	footer(name);
	glass.tint(null);
	later(retire([stage]), () => enterStage(name));
}

function backToMonth(reading, overlays) {
	footer("days");
	glass.tint(null);
	later(retire(overlays), () => {
		glass.metric(metricSpec(state.metric));
		handoff(reading);
	});
}

function rewind(reading, overlays, name) {
	introReady = false;
	footer(name);
	glass.tint(null);
	glass.metric(null);
	glass.handoff(1.1, 0);
	later(retire(overlays), () => {
		delete reading.dataset.handedOff;
		reading.style.cssText = "";
		reading.dataset.part = "number";
		reading.querySelector(".count-top").style.display = "";
		reading.querySelector("[data-strip]").style.visibility = "";
		for (const element of reading.querySelectorAll("[data-count-kicker], [data-count-note]")) delete element.dataset.text;
		showPart(reading, PARTS[name]);
	});
}

content.addEventListener("pointerover", (event) => {
	const tile = event.target.closest("[data-agent]");
	if (tile && !tile.contains(event.relatedTarget)) glass?.tint(AGENT_TINTS[tile.dataset.agent]?.map(oklchToHex));
});

content.addEventListener("pointerout", (event) => {
	const tile = event.target.closest("[data-agent]");
	if (tile && !tile.contains(event.relatedTarget) && !event.relatedTarget?.closest?.("[data-agent]")) glass?.tint(null);
});

const APPEAR = [
	{ opacity: 0, filter: "blur(10px)", transform: "translateY(20%)" },
	{ opacity: 1, filter: "blur(0px)", transform: "none" },
];
const APPEAR_EASE = "cubic-bezier(0.25, 0.1, 0.25, 1)";

function monthHeader(title, note, delay) {
	delete title.dataset.text;
	delete note.dataset.text;
	appear(title, "Your month with agents", { words: true, delay });
	appear(note, "Last 30 days", { delay: delay + 180 });
}

const SHELL_MS = 750;

function closeOut() {
	navTurn += 1;
	button.disabled = true;
	window.charts.hideTooltip();
	let wait = 0;
	for (const view of content.querySelectorAll(":scope > .view:not(.reading):not([data-leaving])")) {
		view.dataset.leaving = "";
		wait = Math.max(wait, fadeOut(partsOf(view).length ? partsOf(view) : [view]));
	}
	const reading = content.querySelector(".view.reading");
	if (reading) reading.animate([{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(10px)" }], { duration: LEAVE_MS, easing: APPEAR_EASE, fill: "forwards" });
	wait = Math.max(wait, fadeOut([dots, document.querySelector(".footer-pill")]));
	setTimeout(async () => {
		glass?.destroy();
		glass = null;
		boxes?.destroy();
		boxes = null;
		dotChart?.unmount();
		dotChart = null;
		trendChart = null;
		content.replaceChildren();
		await growWindow();
		document.body.dataset.morph = "";
		api.finish(SHELL_MS);
	}, wait);
}

async function growWindow() {
	const target = await api.expand?.();
	if (!target) return;
	const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
	for (let tries = 0; tries < 30 && (innerWidth !== target.width || innerHeight !== target.height); tries++) await frame();
	delete document.documentElement.dataset.nativeShadow;
	await frame();
}

function handoff(reading) {
	const fromStrip = reading.querySelector("[data-strip]").getBoundingClientRect();
	reading.dataset.handedOff = "";
	reading.style.cssText = "position:absolute;inset:0;margin:0;z-index:0";
	reading.querySelector(".count-top").style.display = "none";
	const holder = document.createElement("div");
	holder.innerHTML = views.days();
	const days = holder.firstElementChild;
	days.dataset.handoff = "";
	days.dataset.overScene = "";
	days.style.cssText = "position:relative;z-index:1";
	content.append(days);
	for (const element of days.querySelectorAll("[data-metric-value]")) flowFor(element).update(Number(element.dataset.value));
	const strip = days.querySelector(".metrics");
	const toStrip = strip.getBoundingClientRect();
	if (fromStrip.width) strip.animate([{ transform: `translate(${fromStrip.left - toStrip.left}px, ${fromStrip.top - toStrip.top}px)` }, { transform: "none" }], { duration: 900, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" });
	else {
		monthHeader(days.querySelector(".header-row h2"), days.querySelector(".header-row p"), 0);
		strip.animate(APPEAR, { duration: 800, delay: 120, easing: APPEAR_EASE, fill: "backwards" });
	}
	footer("days");
	requestAnimationFrame(drawCharts);
	glass.handoff(1.1, 0.35);
}

function go(step) {
	navTurn += 1;
	building = false;
	state.step = step;
	render();
}

function startAnalysis() {
	if (state.analysis) return;
	const run = (async () => {
		const scan = await api.scan();
		if (state.analysis !== run) return;
		state.scan = scan;
		const result = await api.analyze();
		if (state.analysis !== run) return;
		state.result = result;
		showReading();
	})();
	state.analysis = run;
}

button.addEventListener("click", () => {
	const name = STEPS[state.step];
	if (name === "theme") return closeOut();
	go(state.step + 1);
});

dots.addEventListener("click", (event) => {
	const target = event.target.closest("[data-step]");
	if (target) go(Number(target.dataset.step));
});

document.addEventListener("keydown", (event) => {
	const origin = event.composedPath()[0];
	if (event.target.closest?.('[class*="dialkit"]') || origin?.matches?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]') || origin?.isContentEditable) return;
	if (event.key === "Tab") return event.preventDefault();
	if (event.key === "Enter" && !button.disabled && !event.target.closest("[data-connect]")) button.click();
});

function untitle(node) {
	if (node.nodeType !== Node.ELEMENT_NODE) return;
	for (const element of [node, ...node.querySelectorAll("[title], svg title")]) {
		if (element.localName === "title" && element.closest("svg")) element.remove();
		else element.removeAttribute("title");
	}
}

new MutationObserver((records) => {
	for (const record of records) {
		if (record.type === "attributes") untitle(record.target);
		else record.addedNodes.forEach(untitle);
	}
}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
untitle(document.body);

document.querySelector("[data-device]").textContent = DEVICE;

api.agents().then((list) => {
	for (const status of list) if (!liveAgents[status.key]) liveAgents[status.key] = status;
	previewAgents();
});

api.icons().then((icons) => {
	state.icons = icons;
});

if (location.hash === "#replay") {
	state.step = STEPS.indexOf("theme");
	render();
	setTimeout(closeOut, 900);
} else {
	startAnalysis();
	render();
}

