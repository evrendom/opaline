/**
 * The "Fact review" tab: the catalog per fact, where the product owner marks
 * facts reviewed and answers the open decisions. Its filters live in the URL
 * hash (through the tab host) so a filtered view can be shared; marks,
 * answers and notes stay in localStorage.
 */
import type { ReviewCell, ReviewFact } from "../fact-review.js";
import {
	type Agent,
	agentIds,
	agentName,
	badge,
	CHECK,
	CHEVRON,
	capitalize,
	cellBadges,
	data,
	detailList,
	domId,
	esc,
	factByKey,
	facts,
	md,
	oneOf,
	type Status,
	selectControl,
	sourceCode,
	type TabHost,
	type TabView,
	type View,
	viewTag,
} from "./shared.js";

type StatusFilter = "attention" | "all" | "gap" | Status;
type AgentFilter = "both" | Agent;
type ViewFilter = "all" | View;
type ReviewFilter = "all" | "unreviewed" | "reviewed";

interface Filters {
	q: string;
	status: StatusFilter;
	agent: AgentFilter;
	view: ViewFilter;
	review: ReviewFilter;
	open: Set<string>;
}

interface Store {
	/** Fact key to the content hash it was reviewed at. */
	reviewed: Record<string, string>;
	/** Fact key to the reviewer's answer to its decision. */
	answers: Record<string, string>;
	/** Fact key to the reviewer's note. */
	notes: Record<string, string>;
}

const STORE_KEY = "opaline.l1-fact-review.v1";
const DEFAULTS = {
	q: "",
	status: "attention",
	agent: "both",
	view: "all",
	review: "all",
} as const;

// --- storage -------------------------------------------------------------------

function loadStore(): Store {
	const empty: Store = { reviewed: {}, answers: {}, notes: {} };
	try {
		const raw = localStorage.getItem(STORE_KEY);
		if (raw === null) return empty;
		const parsed = JSON.parse(raw) as Partial<Store>;
		return {
			reviewed: parsed.reviewed ?? {},
			answers: parsed.answers ?? {},
			notes: parsed.notes ?? {},
		};
	} catch {
		return empty;
	}
}

const store = loadStore();

function saveStore(): void {
	try {
		localStorage.setItem(STORE_KEY, JSON.stringify(store));
	} catch {
		// Storage can be unavailable (private mode); marks then last for the visit.
	}
}

function isReviewed(fact: ReviewFact): boolean {
	return store.reviewed[fact.key] === fact.hash;
}

function changedSinceReview(fact: ReviewFact): boolean {
	const hash = store.reviewed[fact.key];
	return hash !== undefined && hash !== fact.hash;
}

// --- filters and the URL hash ----------------------------------------------------

const STATUS_FILTERS: readonly StatusFilter[] = [
	"attention",
	"all",
	"wrong",
	"pending",
	"gap",
	"stored",
	"not_recorded",
];
const AGENT_FILTERS: readonly AgentFilter[] = ["both", ...agentIds];
const VIEW_FILTERS: readonly ViewFilter[] = [
	"all",
	...data.views.map((view) => view.id),
];
const REVIEW_FILTERS: readonly ReviewFilter[] = [
	"all",
	"unreviewed",
	"reviewed",
];

function readParams(params: URLSearchParams): Filters {
	return {
		q: params.get("q") ?? DEFAULTS.q,
		status: oneOf(params.get("status"), STATUS_FILTERS, DEFAULTS.status),
		agent: oneOf(params.get("agent"), AGENT_FILTERS, DEFAULTS.agent),
		view: oneOf(params.get("view"), VIEW_FILTERS, DEFAULTS.view),
		review: oneOf(params.get("review"), REVIEW_FILTERS, DEFAULTS.review),
		open: new Set(
			(params.get("open") ?? "").split(",").filter((key) => factByKey.has(key)),
		),
	};
}

let filters = readParams(new URLSearchParams());
let host: TabHost | undefined;

function hashParams(): URLSearchParams {
	const params = new URLSearchParams();
	if (filters.q !== DEFAULTS.q) params.set("q", filters.q);
	if (filters.status !== DEFAULTS.status) params.set("status", filters.status);
	if (filters.agent !== DEFAULTS.agent) params.set("agent", filters.agent);
	if (filters.view !== DEFAULTS.view) params.set("view", filters.view);
	if (filters.review !== DEFAULTS.review) params.set("review", filters.review);
	if (filters.open.size > 0) params.set("open", [...filters.open].join(","));
	return params;
}

function writeHash(): void {
	host?.replaceHash(hashParams());
}

function isDefaultFilters(): boolean {
	return (
		filters.q === DEFAULTS.q &&
		filters.status === DEFAULTS.status &&
		filters.agent === DEFAULTS.agent &&
		filters.view === DEFAULTS.view &&
		filters.review === DEFAULTS.review
	);
}

// --- ranking -------------------------------------------------------------------

/** Lower is more urgent: wrong, pending, gap, then the rest. */
function cellRank(cell: ReviewCell): number {
	if (cell.status === "wrong") return 0;
	if (cell.status === "pending") return 1;
	if (cell.gap) return 2;
	return cell.status === "not_recorded" ? 4 : 5;
}

function selectedAgents(): readonly Agent[] {
	return filters.agent === "both" ? agentIds : [filters.agent];
}

/** A fact's urgency for the selected agents; a decision counts as attention. */
function factRank(fact: ReviewFact, agents: readonly Agent[]): number {
	const rank = Math.min(...agents.map((agent) => cellRank(fact.agents[agent])));
	return fact.decision !== undefined && rank > 2 ? 3 : rank;
}

function needsAttention(fact: ReviewFact, agents: readonly Agent[]): boolean {
	return factRank(fact, agents) <= 3;
}

function cellMatches(cell: ReviewCell, status: StatusFilter): boolean {
	if (status === "all" || status === "attention") return true;
	if (status === "gap") return cell.gap;
	return cell.status === status;
}

/** Whether a fact passes every filter except, optionally, the view. */
function matches(fact: ReviewFact, ignoreView = false): boolean {
	const agents = selectedAgents();
	if (!ignoreView && filters.view !== "all" && fact.view !== filters.view)
		return false;
	if (filters.status === "attention" && !needsAttention(fact, agents))
		return false;
	if (!agents.some((agent) => cellMatches(fact.agents[agent], filters.status)))
		return false;
	if (filters.review === "reviewed" && !isReviewed(fact)) return false;
	if (filters.review === "unreviewed" && isReviewed(fact)) return false;
	const terms = filters.q.toLowerCase().split(/\s+/u).filter(Boolean);
	return terms.every((term) => fact.search.includes(term));
}

function visibleFacts(): ReviewFact[] {
	const agents = selectedAgents();
	return facts
		.map((fact, index) => ({ fact, index, rank: factRank(fact, agents) }))
		.filter(({ fact }) => matches(fact))
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map(({ fact }) => fact);
}

// --- static sections ------------------------------------------------------------

function header(): string {
	const { meta } = data;
	const commit =
		meta.catalogCommit === undefined
			? "not committed yet"
			: `commit <code>${esc(meta.catalogCommit.hash.slice(0, 8))}</code>, ${esc(meta.catalogCommit.date.slice(0, 10))}${meta.catalogDirty ? ", plus uncommitted changes" : ""}`;
	const generated = `${meta.generatedAt.slice(0, 10)} ${meta.generatedAt.slice(11, 16)} UTC`;
	const legend = (
		[
			["stored", "Opaline keeps it"],
			["gap", "stored, but also recorded where Opaline does not read yet"],
			["pending", "recorded, not stored yet"],
			["not_recorded", "the agent does not write it"],
			["wrong", "stored, but incorrect"],
		] as const
	)
		.map(([kind, text]) => `<li>${badge(kind)} ${esc(text)}</li>`)
		.join("");
	const longLegend = (
		["stored", "gap", "pending", "not_recorded", "wrong"] as const
	)
		.map(
			(kind) =>
				`<div><dt>${badge(kind)}</dt><dd><p>${md(capitalize(data.statusLegend[kind]))}</p></dd></div>`,
		)
		.join("");
	return `<header class="page-header review-header">
<p class="lede">For each L1 fact: what Claude Code and Codex record, and what Opaline stores. Check a fact once you have reviewed it. Your checks, answers and notes stay in this browser.</p>
<dl class="meta">
<div><dt>Catalog</dt><dd>${commit}</dd></div>
<div><dt>Facts</dt><dd class="num">${facts.length}</dd></div>
<div><dt>Page generated</dt><dd>${esc(generated)}</dd></div>
</dl>
<nav class="jump" aria-label="On this page"><a class="link" href="#summary-title">Summary</a><a class="link" href="#decisions-title">Decisions needed</a><a class="link" href="#facts">Facts</a></nav>
<p class="census">${esc(data.census)}.</p>
<ul role="list" class="legend" aria-label="Legend">${legend}</ul>
<details class="howto">
<summary>How to read this page</summary>
<dl class="details legend-details">${longLegend}
<div><dt>Sources</dt><dd><p>Under each status is where the agent records the fact, shortened: ${md(data.sourceLegend)} Hover a source to see its full path.</p></dd></div>
<div><dt>Order</dt><dd><p>Facts that need attention come first: wrong, then pending, then stored with a gap, then facts with an open decision. The summary counts filter the table.</p></dd></div>
</dl>
</details>
</header>`;
}

const SUMMARY_ROWS: readonly (readonly [StatusFilter, string])[] = [
	["stored", "Stored"],
	["gap", "with a gap"],
	["pending", "Pending"],
	["not_recorded", "Not recorded"],
	["wrong", "Wrong"],
];

function summary(): string {
	const head = data.agents
		.map((agent) => `<th scope="col">${esc(agent.name)}</th>`)
		.join("");
	const rows = SUMMARY_ROWS.map(([status, label]) => {
		const kind = status as Status | "gap";
		const cells = agentIds
			.map((agent) => {
				const count = facts.filter((fact) =>
					cellMatches(fact.agents[agent], status),
				).length;
				return `<td><button type="button" class="count" data-status="${status}" data-agent="${agent}" aria-pressed="false" aria-label="${esc(`Show ${agentName[agent]} facts: ${label.toLowerCase()} (${count})`)}">${count}</button></td>`;
			})
			.join("");
		const name =
			status === "gap" ? `<span class="sub">${esc(label)}</span>` : badge(kind);
		return `<tr${status === "gap" ? ' class="sub-row"' : ""}><th scope="row">${name}</th>${cells}</tr>`;
	}).join("");
	return `<section class="summary" aria-labelledby="summary-title">
<h2 id="summary-title">Summary</h2>
<table class="summary-table">
<thead><tr><th scope="col"><span class="sr-only">Status</span></th>${head}</tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><th scope="row">Facts</th>${agentIds.map(() => `<td class="num">${facts.length}</td>`).join("")}</tr></tfoot>
</table>
<div class="progress">
<p><span class="num" id="reviewed-count"></span></p>
<div class="actions">
<button type="button" class="button" id="show-unreviewed">Show unreviewed</button>
<button type="button" class="button" id="copy-notes">Copy my notes</button>
</div>
<p class="status-line" id="copy-status" role="status"></p>
</div>
</section>`;
}

function decisionAgent(fact: ReviewFact, agent: Agent): string {
	const cell = fact.agents[agent];
	const note = cell.details.find((detail) => detail.label === "Note");
	const sources = cell.sources.slice(0, 3);
	const more =
		cell.sources.length > 3
			? `<li class="more">+${cell.sources.length - 3} more</li>`
			: "";
	return `<div class="decision-agent">
<p class="agent-name">${esc(agentName[agent])}</p>
<p>${cellBadges(cell)}</p>
<p class="muted">${esc(cell.summary)}</p>
${sources.length === 0 ? "" : `<ul role="list" class="code-list">${sources.map((source) => `<li>${sourceCode(source)}</li>`).join("")}${more}</ul>`}
${note?.text === undefined ? "" : `<p class="muted">${md(note.text)}</p>`}
</div>`;
}

function decisions(): string {
	const open = facts.filter((fact) => fact.decision !== undefined);
	const items = open
		.map((fact) => {
			const answerId = domId("answer", fact.key);
			return `<li class="decision" id="${domId("decision", fact.key)}">
<p class="question">${md(fact.decision ?? "")}</p>
<p class="decision-fact"><code class="fact-id">${esc(fact.id)}</code> ${viewTag(fact.view)} <span class="muted">${md(fact.meaning)}</span></p>
<div class="decision-agents">${agentIds.map((agent) => decisionAgent(fact, agent)).join("")}</div>
<div class="field">
<label for="${answerId}">Your answer</label>
<textarea id="${answerId}" name="answer" rows="2" data-answer="${esc(fact.key)}" placeholder="Write your decision and why"></textarea>
</div>
<p><button type="button" class="link" data-show="${esc(fact.key)}">Show this fact in the table</button></p>
</li>`;
		})
		.join("");
	return `<section class="decisions" aria-labelledby="decisions-title">
<h2 id="decisions-title">Decisions needed <span class="count-tag num">${open.length}</span></h2>
<p class="section-lede">Questions only you can answer. Each shows its fact and what both agents record.</p>
${open.length === 0 ? '<p class="muted">None right now.</p>' : `<ol role="list" class="decision-list">${items}</ol>`}
</section>`;
}

function toolbar(): string {
	const views = [
		["all", "All views"],
		...data.views.map((view) => [view.id, capitalize(view.id)]),
	];
	return `<div class="toolbar" role="search">
<div class="search">
<input type="search" name="q" id="filter-q" aria-label="Search facts by id, meaning or source" placeholder="Search id, meaning or source" autocomplete="off" spellcheck="false">
<kbd class="hint" aria-hidden="true">/</kbd>
</div>
<div class="filters">
${selectControl("status", "Status", [
	["attention", "Needs attention"],
	["all", "Any status"],
	["wrong", "Wrong"],
	["pending", "Pending"],
	["gap", "Stored, with a gap"],
	["stored", "Stored"],
	["not_recorded", "Not recorded"],
])}
${selectControl("agent", "Agent", [
	["both", "Either agent"],
	...data.agents.map((agent) => [agent.id, agent.name] as const),
])}
${selectControl("review", "Review", [
	["all", "Reviewed or not"],
	["unreviewed", "Unreviewed"],
	["reviewed", "Reviewed"],
])}
</div>
<div class="tabs" role="group" aria-label="View">${views
		.map(
			([id, label]) =>
				`<button type="button" class="tab" data-view="${id}" aria-pressed="false">${esc(label ?? "")} <span class="num tab-count" data-view-count="${id}"></span></button>`,
		)
		.join("")}</div>
</div>`;
}

function factsSection(): string {
	const head = data.agents
		.map((agent) => `<th scope="col" class="c-agent">${esc(agent.name)}</th>`)
		.join("");
	return `<section class="facts" id="facts" aria-labelledby="facts-title">
<div class="facts-head">
<h2 id="facts-title">Facts</h2>
<p class="shown"><span class="muted" id="shown-line" aria-live="polite"></span> <button type="button" class="link" id="clear-filters" data-reset hidden>Clear filters</button></p>
</div>
${toolbar()}
<table class="fact-table" role="table">
<colgroup><col class="col-check"><col class="col-fact">${agentIds.map(() => '<col class="col-agent">').join("")}</colgroup>
<thead role="rowgroup"><tr role="row"><th scope="col" class="c-check" role="columnheader"><span class="sr-only">Reviewed</span></th><th scope="col" class="c-fact" role="columnheader">Fact</th>${head.replaceAll("<th ", '<th role="columnheader" ')}</tr></thead>
<tbody role="rowgroup" id="fact-rows"></tbody>
</table>
<div class="empty" id="empty" hidden>
<p>No facts match these filters.</p>
<button type="button" class="button" data-reset>Clear filters</button>
</div>
<p class="show-all" id="show-all" hidden></p>
</section>`;
}

// --- the fact table -------------------------------------------------------------

function agentCell(fact: ReviewFact, agent: Agent): string {
	const cell = fact.agents[agent];
	const first = cell.sources[0];
	const more =
		cell.sources.length > 1
			? ` <span class="more">+${cell.sources.length - 1}</span>`
			: "";
	return `<td class="c-agent" role="cell"><span class="cell-agent">${esc(agentName[agent])}</span>${cellBadges(cell)}${
		first === undefined
			? ""
			: `<span class="source-line">${sourceCode(first)}${more}</span>`
	}</td>`;
}

function rowHtml(fact: ReviewFact): string {
	const reviewed = isReviewed(fact);
	const changed = changedSinceReview(fact);
	const open = filters.open.has(fact.key);
	const detailId = domId("detail", fact.key);
	const also =
		fact.also.length === 0
			? ""
			: `<span class="also">also ${fact.also.map((name) => `<code>${esc(name)}</code>`).join(", ")}</span>`;
	const tags = [
		viewTag(fact.view),
		fact.decision === undefined
			? ""
			: '<span class="tag tag-decision">decision needed</span>',
		changed
			? '<span class="tag tag-changed">changed since your review</span>'
			: "",
	].join("");
	const row = `<tr class="fact-row${reviewed ? " is-reviewed" : ""}${open ? " is-open" : ""}" role="row" data-key="${esc(fact.key)}">
<td class="c-check" role="cell"><span class="check-wrap"><span class="check"><input type="checkbox" name="reviewed" data-review="${esc(fact.key)}" aria-label="${esc(`Reviewed ${fact.id}`)}"${reviewed ? " checked" : ""}>${CHECK}</span></span></td>
<td class="c-fact" role="cell">
<span class="fact-line"><button type="button" class="fact-toggle" aria-expanded="${open}" aria-controls="${detailId}">${CHEVRON}<code class="fact-id">${esc(fact.id)}</code></button>${tags}</span>
<p class="meaning">${md(fact.meaning)}</p>${also}
</td>
${agentIds.map((agent) => agentCell(fact, agent)).join("")}
</tr>`;
	return open ? row + detailRowHtml(fact) : row;
}

function detailRowHtml(fact: ReviewFact): string {
	const noteId = domId("note", fact.key);
	const agents = agentIds
		.map((agent) => {
			const cell = fact.agents[agent];
			return `<section class="detail-agent" aria-label="${esc(agentName[agent])}">
<h3>${esc(agentName[agent])} ${cellBadges(cell)}</h3>
<p class="muted">${esc(cell.summary)}</p>
${detailList(cell.details)}
</section>`;
		})
		.join("");
	const decision =
		fact.decision === undefined
			? ""
			: `<div class="detail-decision"><p><span class="label">Decision needed.</span> ${md(fact.decision)}</p><p><a class="link" href="#${domId("decision", fact.key)}" data-to-decision>Answer it above</a></p></div>`;
	return `<tr class="detail-row" role="row" id="${domId("detail", fact.key)}" data-detail="${esc(fact.key)}">
<td class="c-check" role="cell"></td>
<td colspan="${1 + agentIds.length}" role="cell">
<div class="detail">
${decision}
<div class="detail-agents">${agents}</div>
${fact.details.length === 0 ? "" : `<div class="detail-entry">${detailList(fact.details)}</div>`}
<div class="field">
<label for="${noteId}">Your note on <code>${esc(fact.id)}</code></label>
<textarea id="${noteId}" name="note" rows="2" data-note="${esc(fact.key)}" placeholder="What is wrong or missing?">${esc(store.notes[fact.key] ?? "")}</textarea>
</div>
</div>
</td>
</tr>`;
}

// --- export ---------------------------------------------------------------------

function notesText(): string {
	const { meta } = data;
	const commit =
		meta.catalogCommit === undefined
			? "uncommitted"
			: `${meta.catalogCommit.hash.slice(0, 8)}${meta.catalogDirty ? " plus uncommitted changes" : ""}`;
	const lines = [
		`L1 fact review notes (catalog ${commit})`,
		`${facts.filter(isReviewed).length} of ${facts.length} facts reviewed.`,
	];
	const open = facts.filter((fact) => fact.decision !== undefined);
	if (open.length > 0) {
		lines.push("", "Decisions");
		open.forEach((fact, index) => {
			lines.push(
				`${index + 1}. ${fact.id} (${fact.view}): ${fact.decision}`,
				`   Answer: ${store.answers[fact.key]?.trim() || "no answer yet"}`,
			);
		});
	}
	const noted = facts.filter((fact) => store.notes[fact.key] !== undefined);
	if (noted.length > 0) {
		lines.push("", "Notes on facts");
		for (const fact of noted)
			lines.push(
				`- ${fact.id} (${fact.view}): ${store.notes[fact.key]?.trim()}`,
			);
	}
	return `${lines.join("\n")}\n`;
}

// --- mounting --------------------------------------------------------------------

/** Render the tab into its panel; the host owns the URL hash. */
export function mountReview(panel: HTMLElement, tabHost: TabHost): TabView {
	host = tabHost;
	panel.innerHTML = `${header()}<div class="overview">${summary()}${decisions()}</div>${factsSection()}`;

	function query<T extends Element = HTMLElement>(selector: string): T {
		const element = panel.querySelector<T>(selector);
		if (element === null || element === undefined)
			throw new Error(`fact review: ${selector} missing`);
		return element;
	}

	const rows = query<HTMLTableSectionElement>("#fact-rows");
	const searchInput = query<HTMLInputElement>("#filter-q");
	const statusSelect = query<HTMLSelectElement>("#filter-status");
	const agentSelect = query<HTMLSelectElement>("#filter-agent");
	const reviewSelect = query<HTMLSelectElement>("#filter-review");

	for (const textarea of panel.querySelectorAll<HTMLTextAreaElement>(
		"textarea[data-answer]",
	))
		textarea.value = store.answers[textarea.dataset.answer ?? ""] ?? "";

	function renderProgress(): void {
		const reviewed = facts.filter(isReviewed).length;
		const changed = facts.filter(changedSinceReview).length;
		query("#reviewed-count").textContent =
			`${reviewed} of ${facts.length} facts reviewed${changed > 0 ? `, ${changed} changed since your review` : ""}.`;
	}

	function renderControls(): void {
		if (searchInput.value !== filters.q) searchInput.value = filters.q;
		statusSelect.value = filters.status;
		agentSelect.value = filters.agent;
		reviewSelect.value = filters.review;
		for (const button of panel.querySelectorAll<HTMLButtonElement>(
			"button.count",
		))
			button.setAttribute(
				"aria-pressed",
				String(
					button.dataset.status === filters.status &&
						button.dataset.agent === filters.agent,
				),
			);
		for (const tab of panel.querySelectorAll<HTMLButtonElement>("button.tab"))
			tab.setAttribute(
				"aria-pressed",
				String(tab.dataset.view === filters.view),
			);
		for (const count of panel.querySelectorAll<HTMLElement>(
			"[data-view-count]",
		)) {
			const view = count.dataset.viewCount;
			count.textContent = String(
				facts.filter(
					(fact) =>
						matches(fact, true) && (view === "all" || fact.view === view),
				).length,
			);
		}
	}

	function renderTable(): void {
		const visible = visibleFacts();
		rows.innerHTML = visible.map(rowHtml).join("");
		query("#empty").hidden = visible.length > 0;
		query("#clear-filters").hidden = isDefaultFilters();
		query("#shown-line").textContent =
			`${visible.length} of ${facts.length} facts shown.`;
		const showAll = query<HTMLElement>("#show-all");
		showAll.hidden = filters.status !== "attention";
		showAll.innerHTML = `Only facts that need attention are shown. <button type="button" class="link" id="show-all-button">Show all ${facts.length} facts</button>`;
	}

	function render(): void {
		renderControls();
		renderTable();
		renderProgress();
	}

	function update(change: Partial<Filters>): void {
		filters = { ...filters, ...change };
		writeHash();
		render();
	}

	render();

	// --- interaction ----------------------------------------------------------------

	function toggleOpen(key: string): void {
		const fact = factByKey.get(key);
		const row = rows.querySelector<HTMLTableRowElement>(
			`tr.fact-row[data-key="${CSS.escape(key)}"]`,
		);
		if (fact === undefined || row === null) return;
		const open = !filters.open.has(key);
		if (open) filters.open.add(key);
		else filters.open.delete(key);
		row.classList.toggle("is-open", open);
		row
			.querySelector(".fact-toggle")
			?.setAttribute("aria-expanded", String(open));
		if (open) row.insertAdjacentHTML("afterend", detailRowHtml(fact));
		else rows.querySelector(`tr[data-detail="${CSS.escape(key)}"]`)?.remove();
		writeHash();
	}

	function showFact(key: string): void {
		const fact = factByKey.get(key);
		if (fact === undefined) return;
		filters = {
			q: fact.id,
			status: "all",
			agent: "both",
			view: fact.view,
			review: "all",
			open: new Set([key]),
		};
		writeHash();
		render();
		const toggle = rows.querySelector<HTMLButtonElement>(
			`tr.fact-row[data-key="${CSS.escape(key)}"] .fact-toggle`,
		);
		toggle?.scrollIntoView({ block: "start" });
		toggle?.focus({ preventScroll: true });
	}

	panel.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		// In-page links scroll; the URL hash belongs to the filters.
		const jump = target.closest<HTMLAnchorElement>('a[href^="#"]');
		if (jump !== null) {
			event.preventDefault();
			const destination = document.getElementById(
				jump.getAttribute("href")?.slice(1) ?? "",
			);
			destination?.scrollIntoView({ block: "start" });
			destination?.querySelector<HTMLElement>("textarea")?.focus({
				preventScroll: true,
			});
			return;
		}
		const count = target.closest<HTMLButtonElement>("button.count");
		if (count !== null) {
			const status = count.dataset.status as StatusFilter;
			const agent = count.dataset.agent as Agent;
			const pressed = count.getAttribute("aria-pressed") === "true";
			update(
				pressed
					? { status: DEFAULTS.status, agent: DEFAULTS.agent }
					: { status, agent, view: "all" },
			);
			return;
		}
		const tab = target.closest<HTMLButtonElement>("button.tab");
		if (tab !== null) {
			update({ view: tab.dataset.view as ViewFilter });
			return;
		}
		if (target.closest("[data-reset]") !== null) {
			update({ ...DEFAULTS, open: new Set() });
			return;
		}
		if (target.closest("#show-all-button") !== null) {
			update({ status: "all" });
			return;
		}
		if (target.closest("#show-unreviewed") !== null) {
			update({ review: "unreviewed", status: "all" });
			query("#facts").scrollIntoView({ block: "start" });
			return;
		}
		if (target.closest("#copy-notes") !== null) {
			void copyNotes();
			return;
		}
		const show = target.closest<HTMLElement>("[data-show]");
		if (show !== null) {
			showFact(show.dataset.show ?? "");
			return;
		}
		const row = target.closest<HTMLTableRowElement>("tr.fact-row");
		if (row === null) return;
		// The checkbox and links do their own thing; anything else on the row expands it.
		if (target.closest("input, a, textarea, .c-check") !== null) return;
		if (
			target.closest(".fact-toggle") === null &&
			(window.getSelection()?.toString() ?? "") !== ""
		)
			return;
		toggleOpen(row.dataset.key ?? "");
	});

	panel.addEventListener("change", (event) => {
		const target = event.target as HTMLElement;
		if (
			target instanceof HTMLInputElement &&
			target.dataset.review !== undefined
		) {
			const fact = factByKey.get(target.dataset.review);
			if (fact === undefined) return;
			if (target.checked) store.reviewed[fact.key] = fact.hash;
			else delete store.reviewed[fact.key];
			saveStore();
			const row = target.closest("tr");
			row?.classList.toggle("is-reviewed", target.checked);
			row?.querySelector(".tag-changed")?.remove();
			renderProgress();
			return;
		}
		if (target === statusSelect)
			update({ status: statusSelect.value as StatusFilter });
		else if (target === agentSelect)
			update({ agent: agentSelect.value as AgentFilter });
		else if (target === reviewSelect)
			update({ review: reviewSelect.value as ReviewFilter });
	});

	panel.addEventListener("input", (event) => {
		const target = event.target as HTMLElement;
		if (target === searchInput) {
			update({ q: searchInput.value });
			return;
		}
		if (!(target instanceof HTMLTextAreaElement)) return;
		const key = target.dataset.answer ?? target.dataset.note;
		if (key === undefined) return;
		const bucket =
			target.dataset.answer === undefined ? store.notes : store.answers;
		if (target.value.trim() === "") delete bucket[key];
		else bucket[key] = target.value;
		saveStore();
	});

	panel.addEventListener("keydown", (event) => {
		if (
			event.key === "Escape" &&
			event.target === searchInput &&
			filters.q !== ""
		)
			update({ q: "" });
	});

	async function copyNotes(): Promise<void> {
		const status = query("#copy-status");
		const text = notesText();
		try {
			await navigator.clipboard.writeText(text);
			status.textContent =
				"Copied. Paste it into the conversation or an issue.";
		} catch {
			const area = document.createElement("textarea");
			area.value = text;
			area.setAttribute("readonly", "");
			area.className = "sr-only";
			document.body.append(area);
			area.select();
			const copied = document.execCommand("copy");
			area.remove();
			status.textContent = copied
				? "Copied. Paste it into the conversation or an issue."
				: "Copying is blocked here; open the page from a local server and try again.";
		}
	}

	return {
		load(params) {
			filters = readParams(params);
			render();
		},
		params: hashParams,
		focusSearch() {
			searchInput.focus();
			searchInput.select();
		},
		reveal() {
			const [key] = filters.open;
			if (filters.open.size !== 1 || key === undefined) return;
			const toggle = rows.querySelector<HTMLButtonElement>(
				`tr.fact-row[data-key="${CSS.escape(key)}"] .fact-toggle`,
			);
			toggle?.scrollIntoView({ block: "start" });
			toggle?.focus({ preventScroll: true });
		},
	};
}
