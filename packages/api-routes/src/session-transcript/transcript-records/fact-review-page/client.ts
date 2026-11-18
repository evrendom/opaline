/**
 * The fact review page's script, bundled into the page by fact-review.ts.
 * It renders the page header and a tab bar, mounts each tab into its panel,
 * and keeps the active tab and its filters in the URL hash
 * (`#tab=codex&show=unmapped`) so every view can be linked.
 */
import { mountOutline } from "./outline-tab.js";
import { mountResearch } from "./research-tab.js";
import { mountReview } from "./review-tab.js";
import {
	agentName,
	data,
	esc,
	oneOf,
	type TabHost,
	type TabId,
	type TabView,
} from "./shared.js";
import { mountSide } from "./side-tab.js";

const app = document.getElementById("app");
if (app === null) throw new Error("fact review: #app missing");

const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
	{ id: "side", label: "Side by side" },
	{ id: "claude_code", label: `${agentName.claude_code} JSON` },
	{ id: "codex", label: `${agentName.codex} JSON` },
	{ id: "review", label: "Fact review" },
	{ id: "research", label: "Research" },
];
const TAB_IDS = TABS.map((tab) => tab.id);
const DEFAULT_TAB: TabId = "side";
/** Filters of the Fact review tab, from links made before it was a tab. */
const REVIEW_PARAMS = ["status", "agent", "review"];

function tabHref(id: TabId): string {
	return id === DEFAULT_TAB ? "#" : `#tab=${id}`;
}

const { meta } = data;
const commit =
	meta.catalogCommit === undefined
		? "catalog not committed yet"
		: `catalog <code>${esc(meta.catalogCommit.hash.slice(0, 8))}</code>${meta.catalogDirty ? " plus uncommitted changes" : ""}`;
app.innerHTML = `<div class="container">
<header class="site-header">
<h1>L1 fact review</h1>
<p class="site-meta">${data.facts.length} facts, ${commit}, page generated ${esc(meta.generatedAt.slice(0, 10))} ${esc(meta.generatedAt.slice(11, 16))} UTC.</p>
<nav class="tabbar" aria-label="Views">${TABS.map(
	(tab) =>
		`<a class="tabbar-link" href="${tabHref(tab.id)}" data-tab="${tab.id}">${esc(tab.label)}</a>`,
).join("")}</nav>
</header>
${TABS.map((tab) => `<div class="panel panel-${tab.id}" id="panel-${tab.id}" data-panel="${tab.id}" hidden></div>`).join("")}
</div>`;

function readLocation(): { tab: TabId; params: URLSearchParams } {
	const params = new URLSearchParams(location.hash.replace(/^#/u, ""));
	const named = params.get("tab");
	params.delete("tab");
	const tab =
		named === null && REVIEW_PARAMS.some((name) => params.has(name))
			? "review"
			: oneOf(named, TAB_IDS, DEFAULT_TAB);
	return { tab, params };
}

function hashOf(tab: TabId, params: URLSearchParams): string {
	const all = new URLSearchParams(tab === DEFAULT_TAB ? [] : [["tab", tab]]);
	for (const [key, value] of params) all.append(key, value);
	const text = all.toString();
	return text === "" ? location.pathname + location.search : `#${text}`;
}

let active: TabId = DEFAULT_TAB;
const views = new Map<TabId, TabView>();
const loaded = new Set<TabId>();

const host: TabHost = {
	replaceHash(params) {
		history.replaceState(null, "", hashOf(active, params));
	},
	go(tab, params) {
		show(tab, params);
		history.pushState(null, "", hashOf(tab, view(tab).params()));
		view(tab).reveal();
	},
};

function panel(tab: TabId): HTMLElement {
	const element = document.getElementById(`panel-${tab}`);
	if (element === null) throw new Error(`fact review: panel ${tab} missing`);
	return element;
}

function view(tab: TabId): TabView {
	let mounted = views.get(tab);
	if (mounted === undefined) {
		const element = panel(tab);
		mounted =
			tab === "side"
				? mountSide(element, host)
				: tab === "review"
					? mountReview(element, host)
					: tab === "research"
						? mountResearch(element, host)
						: mountOutline(element, host, tab);
		views.set(tab, mounted);
	}
	return mounted;
}

/** Show a tab; with params, load them (a tab shown for the first time loads its defaults). */
function show(tab: TabId, params?: URLSearchParams): void {
	active = tab;
	const target = view(tab);
	if (params !== undefined || !loaded.has(tab)) {
		target.load(params ?? new URLSearchParams());
		loaded.add(tab);
	}
	for (const tabId of TAB_IDS) panel(tabId).hidden = tabId !== tab;
	for (const link of app?.querySelectorAll<HTMLAnchorElement>(".tabbar-link") ??
		[]) {
		if (link.dataset.tab === tab) link.setAttribute("aria-current", "page");
		else link.removeAttribute("aria-current");
	}
	document.title = `${TABS.find((entry) => entry.id === tab)?.label ?? ""} · L1 fact review`;
}

function route(): void {
	const { tab, params } = readLocation();
	show(tab, params);
	view(tab).reveal();
}

app.addEventListener("click", (event) => {
	const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
		"a.tabbar-link",
	);
	if (
		link === null ||
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.button !== 0
	)
		return;
	event.preventDefault();
	const tab = oneOf(link.dataset.tab ?? null, TAB_IDS, DEFAULT_TAB);
	if (tab === active) return;
	// A tab keeps its filters while the page is open.
	show(tab);
	history.pushState(null, "", hashOf(tab, view(tab).params()));
	window.scrollTo({ top: 0 });
});

window.addEventListener("popstate", route);

document.addEventListener("keydown", (event) => {
	const focused = document.activeElement;
	const typing =
		focused instanceof HTMLInputElement ||
		focused instanceof HTMLTextAreaElement ||
		focused instanceof HTMLSelectElement;
	if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
		event.preventDefault();
		view(active).focusSearch();
	}
});

route();
