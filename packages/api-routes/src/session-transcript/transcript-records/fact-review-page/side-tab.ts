/**
 * The "Side by side" tab: one row per catalog fact, the Claude Code paths on
 * the left, the Codex paths on the right, and between them whether the two
 * connect. Below the facts, what each agent records that no fact connects.
 */

import type {
	OutlineAgent,
	OutlinePath,
	SideConnection,
	SideFact,
} from "../fact-outline.js";
import type { ReviewDetail, ReviewFact } from "../fact-review.js";
import {
	type Agent,
	agentIds,
	agentName,
	CHEVRON,
	capitalize,
	cellBadges,
	count,
	data,
	detailList,
	domId,
	esc,
	factByKey,
	md,
	oneOf,
	outlineOf,
	pathHtml,
	selectControl,
	type TabHost,
	type TabView,
	type View,
	viewTag,
} from "./shared.js";

type LinkFilter = "all" | "one" | SideConnection;
type ViewFilter = "all" | View;

interface Filters {
	q: string;
	view: ViewFilter;
	link: LinkFilter;
	open: Set<string>;
}

const DEFAULTS = { q: "", view: "all", link: "all" } as const;
const LINK_FILTERS: readonly LinkFilter[] = [
	"all",
	"both",
	"one",
	"claude_code",
	"codex",
	"neither",
];
const VIEW_FILTERS: readonly ViewFilter[] = [
	"all",
	...data.views.map((view) => view.id),
];
const LINK_RANK: Record<SideConnection, number> = {
	both: 0,
	claude_code: 1,
	codex: 2,
	neither: 3,
};
const LINK_LABEL: Record<SideConnection, string> = {
	both: "Both record it",
	claude_code: "Only Claude Code",
	codex: "Only Codex",
	neither: "Neither records it",
};
/** Source lines a collapsed cell shows. */
const CELL_LINES = 3;

interface Row {
	readonly side: SideFact;
	readonly fact: ReviewFact;
	readonly index: number;
	readonly search: string;
}

/** One catalog source of a fact, with what the corpus showed for it. */
interface SourceLine {
	readonly pattern: string;
	readonly gap: boolean;
	readonly paths: readonly OutlinePath[];
	readonly total: number;
	readonly unseen: boolean;
}

function sourceLines(side: SideFact, agent: Agent): SourceLine[] {
	const outline = outlineOf(agent);
	const byPattern = new Map<string, { gap: boolean; paths: Set<number> }>();
	for (const source of side.agents[agent]) {
		const line = byPattern.get(source.pattern) ?? {
			gap: source.gap,
			paths: new Set<number>(),
		};
		line.gap &&= source.gap;
		for (const index of source.paths) line.paths.add(index);
		byPattern.set(source.pattern, line);
	}
	return [...byPattern].map(([pattern, line]) => {
		const paths = [...line.paths]
			.map((index) => outline.paths[index])
			.filter((path): path is OutlinePath => path !== undefined);
		const seen = paths.filter((path) => path.status !== "unseen");
		return {
			pattern,
			gap: line.gap,
			paths: seen,
			total: seen.reduce((sum, path) => sum + path.count, 0),
			unseen: seen.length === 0,
		};
	});
}

const rowsData: Row[] = data.corpus.side.flatMap((side, index) => {
	const fact = factByKey.get(side.key);
	if (fact === undefined) return [];
	const search = [
		fact.search,
		...agentIds.flatMap((agent) =>
			sourceLines(side, agent).flatMap((line) => [
				line.pattern,
				...line.paths.map((path) => path.path),
			]),
		),
	]
		.join("\n")
		.toLowerCase();
	return [{ side, fact, index, search }];
});
const rowByKey = new Map(rowsData.map((row) => [row.side.key, row]));

function readParams(params: URLSearchParams): Filters {
	return {
		q: params.get("q") ?? DEFAULTS.q,
		view: oneOf(params.get("view"), VIEW_FILTERS, DEFAULTS.view),
		link: oneOf(params.get("link"), LINK_FILTERS, DEFAULTS.link),
		open: new Set(
			(params.get("open") ?? "").split(",").filter((key) => rowByKey.has(key)),
		),
	};
}

function linkMatches(connection: SideConnection, link: LinkFilter): boolean {
	if (link === "all") return true;
	if (link === "one")
		return connection === "claude_code" || connection === "codex";
	return connection === link;
}

// --- markup ----------------------------------------------------------------------

const CONNECTOR_ENDS: Record<SideConnection, readonly [boolean, boolean]> = {
	both: [true, true],
	claude_code: [true, false],
	codex: [false, true],
	neither: [false, false],
};

function connector(connection: SideConnection): string {
	const [left, right] = CONNECTOR_ENDS[connection];
	const end = (on: boolean) => `<span class="end${on ? " is-on" : ""}"></span>`;
	const line = (on: boolean) =>
		`<span class="wire${on ? " is-on" : ""}"></span>`;
	return `<span class="connector" aria-hidden="true">${end(left)}${line(left)}${line(right)}${end(right)}</span>`;
}

function countLabel(line: SourceLine): string {
	if (line.unseen) return '<span class="unseen-note">not seen</span>';
	const paths =
		line.paths.length > 1
			? ` <span class="faint">in ${line.paths.length} paths</span>`
			: "";
	return `<span class="num">${count(line.total)}</span>${paths}`;
}

function sourceLineHtml(line: SourceLine, agent: Agent): string {
	const target = line.paths[0]?.path ?? line.pattern;
	const gap = line.gap ? ' <span class="tag-gap">not read yet</span>' : "";
	return `<li class="source${line.unseen ? " is-unseen" : ""}"><a class="path-link" href="#tab=${agent}&amp;at=${encodeURIComponent(target)}" data-outline="${agent}" data-at="${esc(target)}" title="Show in the ${esc(agentName[agent])} JSON">${pathHtml(line.pattern)}</a>${gap}<span class="source-count">${countLabel(line)}</span></li>`;
}

function agentCell(row: Row, agent: Agent, open: boolean): string {
	const cell = row.fact.agents[agent];
	const lines = sourceLines(row.side, agent);
	const label = `<span class="cell-agent">${esc(agentName[agent])}</span>`;
	if (cell.status === "not_recorded")
		return `<td class="s-agent is-empty">${label}<p class="s-status">${cellBadges(cell)}</p></td>`;
	const shown = open ? lines : lines.slice(0, CELL_LINES);
	const more =
		lines.length > shown.length
			? `<li class="more">+${lines.length - shown.length} more</li>`
			: "";
	const body =
		lines.length === 0
			? '<p class="faint">No transcript path: Opaline derives it.</p>'
			: `<ul role="list" class="sources">${shown.map((line) => sourceLineHtml(line, agent)).join("")}${more}</ul>`;
	return `<td class="s-agent">${label}<p class="s-status">${cellBadges(cell)}</p>${body}</td>`;
}

function rowHtml(row: Row, filters: Filters): string {
	const { side, fact } = row;
	const open = filters.open.has(side.key);
	const detailId = domId("side-detail", side.key);
	const html = `<tr class="side-row is-${side.connection}${open ? " is-open" : ""}" data-key="${esc(side.key)}" id="${domId("side", side.key)}">
${agentCell(row, "claude_code", open)}
<td class="s-link">
${connector(side.connection)}
<button type="button" class="fact-toggle" aria-expanded="${open}" aria-controls="${detailId}">${CHEVRON}<code class="fact-id">${esc(fact.id)}</code></button>
<p class="link-label">${esc(LINK_LABEL[side.connection])}</p>
<p class="link-label">${esc(fact.comparability)}</p>
<p class="s-meaning">${md(fact.meaning)}</p>
</td>
${agentCell(row, "codex", open)}
</tr>`;
	return open ? html + detailHtml(row) : html;
}

const SOURCE_LABELS = new Set([
	"Recorded at",
	"Also recorded at, not read yet",
]);

function pathRows(paths: readonly OutlinePath[], pattern: string): string {
	const same = paths.length === 1 && paths[0]?.path === pattern;
	return `<ul role="list" class="matched${same ? " is-same" : ""}">${paths
		.map((path) => {
			const versions =
				path.versions.length === 0
					? ""
					: `${path.versions[0]}${path.versions[1] === path.versions[0] ? "" : `–${path.versions[1]}`}`;
			const values =
				path.values.length === 0
					? ""
					: ` · ${path.values
							.slice(0, 4)
							.map(([value]) => `<code>${esc(JSON.stringify(value))}</code>`)
							.join(" ")}`;
			return `<li>${same ? "" : `<code class="matched-path">${pathHtml(path.path)}</code>`}<span class="faint"><span class="num">${count(path.count)}</span> records · ${esc(path.types.join(" | "))}${versions === "" ? "" : ` · ${esc(versions)}`}${values}</span></li>`;
		})
		.join("")}</ul>`;
}

function detailAgent(row: Row, agent: Agent): string {
	const cell = row.fact.agents[agent];
	const lines = sourceLines(row.side, agent);
	const sources = lines
		.map((line) => {
			const head = `<p class="source-head"><code>${pathHtml(line.pattern)}</code>${line.gap ? ' <span class="tag-gap">not read yet</span>' : ""}</p>`;
			return `<li>${head}${
				line.unseen
					? '<p class="faint">In the catalog, not seen in this corpus.</p>'
					: pathRows(line.paths, line.pattern)
			}</li>`;
		})
		.join("");
	const details: ReviewDetail[] = cell.details.filter(
		(detail) => !SOURCE_LABELS.has(detail.label),
	);
	return `<section class="detail-agent" aria-label="${esc(agentName[agent])}">
<h3>${esc(agentName[agent])} ${cellBadges(cell)}</h3>
<p class="muted">${esc(cell.summary)}</p>
${lines.length === 0 ? "" : `<div class="detail-sources"><p class="detail-label">Paths in this corpus</p><ul role="list" class="source-groups">${sources}</ul></div>`}
${detailList(details)}
</section>`;
}

function detailHtml(row: Row): string {
	const { fact, side } = row;
	const also =
		fact.also.length === 0
			? ""
			: ` <span class="faint">also ${fact.also.map((name) => `<code>${esc(name)}</code>`).join(", ")}</span>`;
	const decision =
		fact.decision === undefined
			? ""
			: `<p><span class="decision-label">Decision needed.</span> ${md(fact.decision)}</p>`;
	return `<tr class="side-detail" id="${domId("side-detail", side.key)}" data-detail="${esc(side.key)}">
<td colspan="3">
<div class="detail">
<div class="detail-fact">
<p><code class="fact-id">${esc(fact.id)}</code> ${viewTag(fact.view)}${also}</p>
<p class="muted">${md(fact.meaning)}</p>
${decision}
<p><button type="button" class="link" data-review="${esc(side.key)}">Open in Fact review</button></p>
</div>
<div class="detail-agents">${agentIds.map((agent) => detailAgent(row, agent)).join("")}</div>
</div>
</td>
</tr>`;
}

// --- not connected ----------------------------------------------------------------

function pathItem(path: OutlinePath, agent: Agent): string {
	return `<li><a class="path-link" href="#tab=${agent}&amp;at=${encodeURIComponent(path.path)}" data-outline="${agent}" data-at="${esc(path.path)}">${pathHtml(path.path)}</a><span class="source-count"><span class="num">${count(path.count)}</span></span></li>`;
}

function notConnectedAgent(outline: OutlineAgent): string {
	const agent = outline.agent;
	const unmapped = outline.paths
		.filter((path) => path.status === "unmapped")
		.sort((a, b) => b.count - a.count);
	const ignored = outline.paths.filter((path) => path.status === "ignored");
	const unseen = outline.paths.filter((path) => path.status === "unseen");
	const groups = outline.rules
		.map((rule, index) => ({
			rule,
			paths: ignored
				.filter((path) => path.rule === index)
				.sort((a, b) => b.count - a.count),
		}))
		.filter((group) => group.paths.length > 0)
		.sort((a, b) => b.paths.length - a.paths.length);
	const unmappedHtml =
		unmapped.length === 0
			? '<p class="muted">None: every path is a fact’s source or ignored.</p>'
			: `<ul role="list" class="path-list">${unmapped.map((path) => pathItem(path, agent)).join("")}</ul>`;
	const ignoredHtml = groups
		.map(
			(group) => `<details class="rule">
<summary>${CHEVRON}<span class="rule-text"><span class="rule-reason">${md(capitalize(group.rule.reason))}</span> <code class="faint">${esc(group.rule.path)}</code></span><span class="num rule-count">${count(group.paths.length)}</span></summary>
<ul role="list" class="path-list">${group.paths.map((path) => pathItem(path, agent)).join("")}</ul>
</details>`,
		)
		.join("");
	const unseenHtml =
		unseen.length === 0
			? ""
			: `<h4>In the catalog, not seen in this corpus <span class="num faint">${count(unseen.length)}</span></h4>
<ul role="list" class="path-list">${unseen
					.map(
						(path) =>
							`<li><code>${pathHtml(path.path)}</code><span class="source-count">${path.facts
								.map(
									(fact) =>
										`<a class="link" href="#open=${encodeURIComponent(fact.key)}" data-row="${esc(fact.key)}">${esc(factByKey.get(fact.key)?.id ?? fact.key)}</a>`,
								)
								.join(", ")}</span></li>`,
					)
					.join("")}</ul>`;
	return `<section class="nc-agent" aria-label="${esc(outline.name)}">
<h3>${esc(outline.name)}</h3>
<h4>Unmapped <span class="num faint">${count(unmapped.length)}</span></h4>
${unmappedHtml}
<h4>Ignored <span class="num faint">${count(ignored.length)} paths, ${count(groups.length)} reasons</span></h4>
<div class="rules">${ignoredHtml}</div>
${unseenHtml}
</section>`;
}

// --- mounting ---------------------------------------------------------------------

export function mountSide(panel: HTMLElement, host: TabHost): TabView {
	let filters = readParams(new URLSearchParams());

	const stat = (label: string, value: number, attrs: string, note: string) =>
		`<div class="stat"><dt>${esc(label)}</dt><dd><button type="button" class="stat-value num" ${attrs}>${count(value)}</button><span class="stat-note">${esc(note)}</span></dd></div>`;
	const stats = [
		`<div class="stat"><dt>Codex writer ${esc(data.sourceOracle.version)}</dt><dd><span class="stat-value num">${count(data.sourceOracle.pending.length)} pending · ${count(data.sourceOracle.residue.length)} unassigned</span><span class="stat-note">${data.sourceOracle.mapped} mapped · ${data.sourceOracle.ignored} ignored · ${data.sourceOracle.context.length} context-only · ${data.sourceOracle.total} writable paths</span><span class="stat-note">Selected corpus: ${data.sourceCensus.declared} declared · ${data.sourceCensus.opaque} open JSON · ${data.sourceCensus.tool_defined} tool-defined · ${data.sourceCensus.legacy} legacy · ${data.sourceCensus.unknown} unknown</span></dd></div>`,
		...agentIds.map((agent) => {
			const metric = data.metrics[agent];
			const tiers = (["verified", "observed", "asserted"] as const)
				.map(
					(tier) =>
						`${((100 * metric.confidence[tier]) / Math.max(1, metric.literal)).toFixed(1)}% ${tier}`,
				)
				.join(" · ");
			const relations = Object.entries(metric.relations)
				.map(([kind, total]) => `${total} ${kind}`)
				.join(" · ");
			const primary = Object.entries(metric.pathRelations)
				.filter(([, total]) => total > 0)
				.map(([kind, total]) => `${total} ${kind}`)
				.join(" · ");
			return `<div class="stat"><dt>${esc(agentName[agent])}</dt><dd><span class="stat-value num">${count(metric.relations.unreviewed)} unreviewed</span><span class="stat-note">${metric.judged} judged · ${metric.confidence.not_applicable} N/A · ${metric.contextPaths} context paths</span><span class="stat-note">${esc(tiers)}</span><span class="stat-note">${esc(relations)}</span><span class="stat-note">Primary paths: ${esc(primary)}</span><span class="stat-note">${metric.conflicts} semantic conflicts · 0 paired runs</span></dd></div>`;
		}),
		...data.corpus.agents.map((outline) =>
			stat(
				"Unmapped paths",
				outline.paths.filter((path) => path.status === "unmapped").length,
				'data-jump="not-connected"',
				`${outline.name}, of ${count(outline.paths.filter((path) => path.status !== "unseen").length)}`,
			),
		),
	].join("");
	const corpus = data.corpus.agents
		.map(
			(outline) =>
				`${esc(outline.name)}: ${count(outline.files)} files, ${count(outline.records)} records${outline.versions.length === 0 ? "" : `, versions ${esc(outline.versions[0] ?? "")}–${esc(outline.versions[1] ?? "")}`}`,
		)
		.join("; ");
	const views = [
		["all", "All views"],
		...data.views.map((view) => [view.id, capitalize(view.id)] as const),
	] as const;

	panel.innerHTML = `<div class="tab-intro">
<p class="lede">Each row is one catalog fact. Left, where Claude Code writes it; right, where Codex writes it; in the middle, whether the two connect. Each side says what Opaline does with it. Click a fact for the full paths, counts and checks; click a path to see it in that agent’s JSON.</p>
<p class="census">Census of ${esc(data.corpus.label)}. ${corpus}.</p>
</div>
<div class="stats-wrap"><dl class="stats">${stats}</dl></div>
<p class="census">Tier shares include searched absences but exclude derived/provenance (N/A per agent). Context paths are not fact sources. Per-path roles and relations appear in each row's details. Verified requires judged primary paths and semantic source/type/paired evidence plus a census or fixture witness. LLM agreement and path existence alone never verify meaning.</p>
<details class="census"><summary>Codex can write these; we neither map nor ignore them (${data.sourceOracle.residue.length} unassigned)</summary><ul>${data.sourceOracle.residue.map((path) => `<li><code>${esc(path.path)}</code> — ${esc(path.source)} (${esc(path.modes)})</li>`).join("")}</ul></details>
<details class="census"><summary>Pending residue review (${data.sourceOracle.pendingReview.length} disagreements; ${data.sourceOracle.pending.length} uncovered writer paths)</summary><ul>${data.sourceOracle.pendingReview.map((review) => `<li><code>${esc(review.path)}</code> (${esc(review.coverage)})<br>Sol: ${esc(review.sol)}<br>Sonnet: ${esc(review.sonnet)}</li>`).join("")}</ul></details>
<div class="toolbar side-toolbar" role="search">
<div class="search">
<input type="search" name="q" id="side-q" aria-label="Search facts and paths" placeholder="Search fact, meaning or path" autocomplete="off" spellcheck="false">
<kbd class="hint" aria-hidden="true">/</kbd>
</div>
<div class="filters">
${selectControl("view", "View", views, "side")}
${selectControl(
	"link",
	"Connection",
	[
		["all", "Any connection"],
		["both", "Connected"],
		["one", "One side only"],
		["claude_code", "Only Claude Code"],
		["codex", "Only Codex"],
		["neither", "Neither"],
	],
	"side",
)}
</div>
<p class="shown"><span class="muted" id="side-shown" aria-live="polite"></span> <button type="button" class="link" id="side-clear" hidden>Clear filters</button></p>
</div>
<table class="side-table">
<colgroup><col class="col-side"><col class="col-link"><col class="col-side"></colgroup>
<thead><tr><th scope="col">Claude Code</th><th scope="col" class="th-link">Fact</th><th scope="col">Codex</th></tr></thead>
<tbody id="side-rows"></tbody>
</table>
<div class="empty" id="side-empty" hidden>
<p>No facts match these filters.</p>
<button type="button" class="button" data-reset>Clear filters</button>
</div>
<section class="not-connected" id="not-connected" aria-labelledby="not-connected-title">
<h2 id="not-connected-title">Recorded but not connected to any fact</h2>
<p class="section-lede">Paths the agents write that no fact uses: ignored on purpose (with the reason), or unmapped (new, not decided yet). Then the catalog’s sources this corpus never showed.</p>
<div class="nc-agents">${data.corpus.agents.map(notConnectedAgent).join("")}</div>
</section>`;

	const query = <T extends Element = HTMLElement>(selector: string): T => {
		const element = panel.querySelector<T>(selector);
		if (element === null) throw new Error(`side: ${selector} missing`);
		return element;
	};
	const tbody = query<HTMLTableSectionElement>("#side-rows");
	const searchInput = query<HTMLInputElement>("#side-q");
	const viewSelect = query<HTMLSelectElement>("#side-view");
	const linkSelect = query<HTMLSelectElement>("#side-link");

	function hashParams(): URLSearchParams {
		const params = new URLSearchParams();
		if (filters.q !== DEFAULTS.q) params.set("q", filters.q);
		if (filters.view !== DEFAULTS.view) params.set("view", filters.view);
		if (filters.link !== DEFAULTS.link) params.set("link", filters.link);
		if (filters.open.size > 0) params.set("open", [...filters.open].join(","));
		return params;
	}

	function visibleRows(): Row[] {
		const terms = filters.q.toLowerCase().split(/\s+/u).filter(Boolean);
		return rowsData
			.filter(
				(row) =>
					(filters.view === "all" || row.fact.view === filters.view) &&
					linkMatches(row.side.connection, filters.link) &&
					terms.every((term) => row.search.includes(term)),
			)
			.sort(
				(a, b) =>
					LINK_RANK[a.side.connection] - LINK_RANK[b.side.connection] ||
					a.index - b.index,
			);
	}

	function render(): void {
		if (searchInput.value !== filters.q) searchInput.value = filters.q;
		viewSelect.value = filters.view;
		linkSelect.value = filters.link;
		for (const button of panel.querySelectorAll<HTMLButtonElement>(
			"button[data-link]",
		))
			button.setAttribute(
				"aria-pressed",
				String(button.dataset.link === filters.link),
			);
		const visible = visibleRows();
		tbody.innerHTML = data.views
			.map((view) => {
				const rows = visible.filter((row) => row.fact.view === view.id);
				if (rows.length === 0) return "";
				const title = view.title.split(": ");
				return `<tr class="group-row"><th colspan="3" scope="colgroup"><span class="group-title">${esc(title[0] ?? view.id)}</span>${title[1] === undefined ? "" : ` <span class="faint">${esc(title[1])}</span>`} <span class="num faint">· ${rows.length}</span></th></tr>${rows.map((row) => rowHtml(row, filters)).join("")}`;
			})
			.join("");
		query("#side-empty").hidden = visible.length > 0;
		const isDefault =
			filters.q === DEFAULTS.q &&
			filters.view === DEFAULTS.view &&
			filters.link === DEFAULTS.link;
		query("#side-clear").hidden = isDefault;
		query("#side-shown").textContent =
			`${visible.length} of ${rowsData.length} facts shown.`;
	}

	function update(change: Partial<Filters>): void {
		filters = { ...filters, ...change };
		host.replaceHash(hashParams());
		render();
	}

	function toggle(key: string): void {
		const open = new Set(filters.open);
		if (open.has(key)) open.delete(key);
		else open.add(key);
		filters = { ...filters, open };
		host.replaceHash(hashParams());
		const row = rowByKey.get(key);
		const tr = tbody.querySelector(
			`tr.side-row[data-key="${CSS.escape(key)}"]`,
		);
		if (row === undefined || tr === null) return;
		tbody.querySelector(`tr[data-detail="${CSS.escape(key)}"]`)?.remove();
		tr.outerHTML = rowHtml(row, filters);
	}

	panel.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const outlineLink = target.closest<HTMLElement>("[data-outline]");
		if (outlineLink !== null) {
			event.preventDefault();
			host.go(
				outlineLink.dataset.outline as Agent,
				new URLSearchParams({ at: outlineLink.dataset.at ?? "" }),
			);
			return;
		}
		const rowLink = target.closest<HTMLElement>("[data-row]");
		if (rowLink !== null) {
			event.preventDefault();
			host.go("side", new URLSearchParams({ open: rowLink.dataset.row ?? "" }));
			return;
		}
		const review = target.closest<HTMLElement>("[data-review]");
		if (review !== null) {
			const fact = factByKey.get(review.dataset.review ?? "");
			if (fact === undefined) return;
			host.go(
				"review",
				new URLSearchParams({
					q: fact.id,
					status: "all",
					view: fact.view,
					open: fact.key,
				}),
			);
			return;
		}
		const linkButton = target.closest<HTMLButtonElement>("button[data-link]");
		if (linkButton !== null) {
			const link = linkButton.dataset.link as LinkFilter;
			update({ link: filters.link === link ? "all" : link });
			return;
		}
		if (target.closest("[data-jump]") !== null) {
			query("#not-connected").scrollIntoView({ block: "start" });
			return;
		}
		if (target.closest("[data-reset], #side-clear") !== null) {
			update({ ...DEFAULTS, open: new Set() });
			return;
		}
		const row = target.closest<HTMLTableRowElement>("tr.side-row");
		if (row === null || target.closest("a") !== null) return;
		if (
			target.closest(".fact-toggle") === null &&
			(window.getSelection()?.toString() ?? "") !== ""
		)
			return;
		toggle(row.dataset.key ?? "");
	});

	panel.addEventListener("change", (event) => {
		if (event.target === viewSelect)
			update({ view: viewSelect.value as ViewFilter });
		else if (event.target === linkSelect)
			update({ link: linkSelect.value as LinkFilter });
	});

	panel.addEventListener("input", (event) => {
		if (event.target === searchInput) update({ q: searchInput.value });
	});

	panel.addEventListener("keydown", (event) => {
		if (
			event.key === "Escape" &&
			event.target === searchInput &&
			filters.q !== ""
		)
			update({ q: "" });
	});

	render();

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
			if (key === undefined) return;
			const toggleButton = tbody.querySelector<HTMLButtonElement>(
				`tr.side-row[data-key="${CSS.escape(key)}"] .fact-toggle`,
			);
			toggleButton?.closest("tr")?.scrollIntoView({ block: "center" });
			toggleButton?.focus({ preventScroll: true });
		},
	};
}
