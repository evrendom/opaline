const api = window.opalineOnboarding;
const card = document.querySelector(".card");
const body = document.querySelector(".card-body");
const dots = document.querySelector(".dots");
const button = document.querySelector(".primary");
const close = document.querySelector(".close");
const STEPS = ["story", "reading", "numbers", "stuck", "ready"];
const state = { step: -1, icons: {}, scan: null, result: null, analysis: null };

const escape = (value) =>
	String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const number = (value) => Math.round(value).toLocaleString("en-US");

function icon(agent, className = "app-icon") {
	const source = state.icons[agent];
	return source ? `<img class="${className}" src="${source}" alt="" />` : "";
}

function countUp(element, target, duration = 1200) {
	const start = performance.now();
	const from = Number(element.dataset.value ?? 0);
	element.dataset.value = String(target);
	const frame = (now) => {
		const progress = Math.min(1, (now - start) / duration);
		const eased = 1 - (1 - progress) ** 4;
		element.textContent = number(from + (target - from) * eased);
		if (progress < 1) requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);
}

function totals() {
	const claude = state.result?.claude && !state.result.claude.error ? state.result.claude : null;
	const codex = state.result?.codex && !state.result.codex.error ? state.result.codex : null;
	const parts = [claude, codex].filter(Boolean);
	const sum = (key) => parts.reduce((total, part) => total + Number(part[key] ?? 0), 0);
	const firstSeen = parts
		.map((part) => part.first_seen)
		.filter(Boolean)
		.sort()[0];
	const stuck = [
		...(claude?.stuck_on ?? []).map(([label, count]) => ({ agent: "claude", label, count })),
		...(codex?.stuck_on ?? []).map(([label, count]) => ({ agent: "codex", label, count })),
	]
		.filter((item) => item.label)
		.sort((a, b) => b.count - a.count)
		.slice(0, 4);
	return {
		ok: parts.length > 0,
		sessions: sum("sessions"),
		prompts: sum("prompts"),
		failed: sum("failed_calls"),
		hours: sum("agent_hours"),
		firstSeen: firstSeen ? new Date(`${firstSeen.replace(" ", "T")}Z`) : null,
		stuck,
		error: state.result?.error ?? claude?.error ?? codex?.error,
	};
}

function readableLabel(label) {
	if (label.startsWith("mcp__")) return label.slice(5).split("__").join(" · ");
	return label;
}

const views = {
	story: () => `
		<h1>Opaline shows where your ${icon("claude")}Claude Code and ${icon("codex")}Codex get stuck</h1>
		<p class="lede">It reads the sessions already on this Mac and finds the loops, failures and lost time behind them.</p>
		<div class="flow" aria-hidden="true">
			<div class="flow-sources">${icon("claude", "")}${icon("codex", "")}</div>
			<div class="flow-lane">${Array.from({ length: 9 }, (_, index) => `<span style="top:${10 + ((index * 37) % 100)}px;animation-delay:${-index * 0.21}s"></span>`).join("")}</div>
			<div class="flow-target"><img src="mark.svg" alt="" /></div>
		</div>
		<p class="privacy">Nothing leaves this Mac until you choose to share it.</p>`,
	reading: () => `
		<h1>Reading your sessions</h1>
		<p class="lede">Straight from the files on this Mac, with ClickHouse built in.</p>
		<div class="reading">
			<div class="count" data-count>0</div>
			<div class="label">sessions from the last month</div>
			<div class="shimmer"><i></i></div>
		</div>`,
	numbers: () => {
		const result = totals();
		if (!result.ok)
			return `<h1>We couldn't read your sessions</h1><p class="lede">${escape(result.error ?? "No Claude Code or Codex sessions were found on this Mac.")}</p>`;
		const since = result.firstSeen
			? result.firstSeen.toLocaleDateString("en-US", { month: "short", day: "numeric" })
			: "last month";
		return `
			<h1>Your agents worked <span data-count="${result.hours}">0</span> hours since ${escape(since)}</h1>
			<p class="lede">That's about ${number(result.hours / 8)} workdays of agent time, running side by side on this Mac.</p>
			<div class="stats">
				<div class="stat"><b data-count="${result.sessions}">0</b><span>sessions</span></div>
				<div class="stat"><b data-count="${result.prompts}">0</b><span>prompts you wrote</span></div>
				<div class="stat"><b data-count="${result.failed}">0</b><span>tool calls that failed</span></div>
			</div>
			<p class="footnote">Read in ${(state.result.ms / 1000).toFixed(1)} s on this Mac · nothing was uploaded</p>`;
	},
	stuck: () => {
		const result = totals();
		const items = result.stuck
			.map(
				(item, index) => `
				<li style="animation-delay:${index * 110}ms">
					${icon(item.agent, "")}
					<code>${escape(readableLabel(item.label))}</code>
					<b>${number(item.count)}×</b>
				</li>`,
			)
			.join("");
		return `
			<h1>What they get stuck on most</h1>
			<p class="lede">Each of these failed again and again. Most come from a missing instruction, script or permission.</p>
			<ul class="stuck">${items || "<li><code>No repeated failures yet</code></li>"}</ul>
			<p class="footnote">Opaline finds the why behind each one, and what to change.</p>`;
	},
	ready: () => `
		<img class="ready-mark" src="mark.svg" alt="" />
		<h1>Your Mac is ready</h1>
		<p class="lede">Next, choose which repositories Opaline keeps learning from.</p>`,
};

function renderDots() {
	dots.hidden = state.step < 0;
	dots.innerHTML = STEPS.map((_, index) => `<i ${index === state.step ? "data-active" : ""}></i>`).join("");
}

function render() {
	const name = STEPS[state.step];
	card.hidden = false;
	body.innerHTML = views[name]();
	body.style.animation = "none";
	void body.offsetWidth;
	body.style.animation = "";
	for (const element of body.querySelectorAll("[data-count]"))
		countUp(element, Number(element.dataset.count || 0));
	if (name === "reading" && state.scan)
		countUp(body.querySelector("[data-count]"), state.scan.claude + state.scan.codex, 900);
	button.classList.toggle("glow", name === "ready");
	button.disabled = name === "reading";
	button.textContent = name === "reading" ? "Reading…" : name === "ready" ? "Open Opaline" : "Continue";
	renderDots();
	if (name === "reading") waitForAnalysis();
}

async function waitForAnalysis() {
	const shownAt = performance.now();
	await state.analysis;
	const wait = Math.max(0, 1400 - (performance.now() - shownAt));
	setTimeout(() => {
		if (STEPS[state.step] === "reading") go(state.step + 1);
	}, wait);
}

function go(step) {
	state.step = step;
	render();
}

function start() {
	state.analysis = (async () => {
		state.scan = await api.scan();
		const counter = body.querySelector(".reading [data-count]");
		if (counter) countUp(counter, state.scan.claude + state.scan.codex, 900);
		state.result = await api.analyze();
	})();
	go(0);
}

button.addEventListener("click", () => {
	if (state.step < 0) return start();
	if (STEPS[state.step] === "ready") return api.finish();
	go(state.step + 1);
});

close.addEventListener("click", () => api.finish());
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") api.finish();
	if (event.key === "Enter" && !button.disabled) button.click();
});

api.icons().then((icons) => {
	state.icons = icons;
});
