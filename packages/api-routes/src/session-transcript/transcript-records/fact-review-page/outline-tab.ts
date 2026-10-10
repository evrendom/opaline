/**
 * The "Claude Code JSON" and "Codex JSON" tabs: every path the census found
 * in one agent's transcripts, as a collapsible outline that reads like JSON.
 * Each key shows how many records carry it and what it is to the catalog.
 */
import type {
	OutlineNode,
	OutlinePath,
	OutlineStatus,
} from "../fact-outline.js";
import {
	type Agent,
	CHEVRON,
	capitalize,
	count,
	data,
	esc,
	factByKey,
	md,
	oneOf,
	outlineOf,
	selectControl,
	type TabHost,
	type TabView,
} from "./shared.js";

type ShowFilter = "all" | "connected" | OutlineStatus;

const SHOW_FILTERS: readonly ShowFilter[] = [
	"all",
	"connected",
	"stored",
	"pending",
	"wrong",
	"gap",
	"not_recorded",
	"ignored",
	"unmapped",
	"unseen",
];

/** The marker each path status shows (text, never colour alone). */
const MARK_LABEL: Record<OutlineStatus, string> = {
	stored: "stored",
	pending: "pending",
	wrong: "wrong",
	gap: "not read",
	not_recorded: "not recorded",
	ignored: "ignored",
	unmapped: "unmapped",
	unseen: "not seen",
};

const MARK_MEANING: Record<OutlineStatus, string> = {
	stored: "a source of a fact Opaline stores",
	pending: "a source of a fact Opaline does not store yet",
	wrong: "a source of a fact Opaline stores wrongly",
	gap: "a source of a stored fact, but Opaline does not read it here yet",
	not_recorded: "named by a fact the catalog says this agent does not record",
	ignored: "deliberately not a fact, with a reason",
	unmapped: "neither a fact’s source nor ignored: not decided yet",
	unseen: "a catalog source no record of this corpus has",
};

/** Statuses a container's roll-up names when its paths have them. */
const ROLLUP: readonly OutlineStatus[] = [
	"unmapped",
	"wrong",
	"pending",
	"gap",
	"unseen",
];

interface Flat {
	readonly id: number;
	readonly node: OutlineNode;
	readonly parent: number;
	readonly depth: number;
	readonly children: number[];
	readonly path?: OutlinePath;
	/** Lowercase text the search matches. */
	readonly text: string;
	/** Paths at or under the node, per status. */
	readonly rollup: Map<OutlineStatus, number>;
	paths: number;
}

interface Filters {
	q: string;
	show: ShowFilter;
	at: string;
}

const DEFAULTS = { q: "", show: "all", at: "" } as const;

function isConnected(path: OutlinePath): boolean {
	return path.facts.length > 0 && path.status !== "unseen";
}

function showMatches(path: OutlinePath, show: ShowFilter): boolean {
	if (show === "all") return true;
	if (show === "connected") return isConnected(path);
	return path.status === show;
}

function mark(status: OutlineStatus): string {
	return `<span class="mark mark-${status}">${esc(MARK_LABEL[status])}</span>`;
}

export function mountOutline(
	panel: HTMLElement,
	host: TabHost,
	agent: Agent,
): TabView {
	const outline = outlineOf(agent);
	const flat: Flat[] = [];
	const nodeOfPath = new Map<number, number>();

	function add(node: OutlineNode, parent: number, depth: number): number {
		const id = flat.length;
		const path = node.path === undefined ? undefined : outline.paths[node.path];
		const entry: Flat = {
			id,
			node,
			parent,
			depth,
			children: [],
			...(path === undefined ? {} : { path }),
			text: [node.label, node.value ?? "", path?.path ?? ""]
				.join("\n")
				.toLowerCase(),
			rollup: new Map(),
			paths: 0,
		};
		flat.push(entry);
		if (node.path !== undefined) nodeOfPath.set(node.path, id);
		for (const child of node.children ?? [])
			entry.children.push(add(child, id, depth + 1));
		if (path !== undefined) {
			entry.rollup.set(path.status, 1);
			entry.paths = 1;
		}
		for (const child of entry.children) {
			const childFlat = flat[child];
			if (childFlat === undefined) continue;
			entry.paths += childFlat.paths;
			for (const [status, n] of childFlat.rollup)
				entry.rollup.set(status, (entry.rollup.get(status) ?? 0) + n);
		}
		return id;
	}
	const roots = outline.tree.map((node) => add(node, -1, 0));

	const statusCounts = new Map<OutlineStatus, number>();
	for (const path of outline.paths)
		statusCounts.set(path.status, (statusCounts.get(path.status) ?? 0) + 1);
	const seenPaths = outline.paths.filter((path) => path.status !== "unseen");
	const connected = seenPaths.filter(isConnected).length;

	let filters: Filters = { ...DEFAULTS };
	let open = new Set<number>();
	let details = new Set<number>();

	function defaultOpen(): Set<number> {
		return new Set(
			flat
				.filter((entry) => entry.node.kind === "variant")
				.map((entry) => entry.id),
		);
	}

	function containerIds(ids: Iterable<number>): Set<number> {
		return new Set(
			[...ids].filter((id) => (flat[id]?.children.length ?? 0) > 0),
		);
	}

	/** Nodes the filters show (all when none is set). */
	function visibleIds(): Set<number> | undefined {
		const terms = filters.q.toLowerCase().split(/\s+/u).filter(Boolean);
		if (terms.length === 0 && filters.show === "all") return undefined;
		const visible = new Set<number>();
		const visit = (id: number, ancestorMatched: boolean): boolean => {
			const entry = flat[id];
			if (entry === undefined) return false;
			const matched =
				ancestorMatched ||
				(terms.length > 0 && terms.every((term) => entry.text.includes(term)));
			let any = false;
			for (const child of entry.children) if (visit(child, matched)) any = true;
			const self =
				entry.path !== undefined &&
				showMatches(entry.path, filters.show) &&
				(terms.length === 0 || matched);
			if (any || self) visible.add(id);
			return any || self;
		};
		for (const root of roots) visit(root, false);
		return visible;
	}

	// --- markup -------------------------------------------------------------------

	function typesHtml(path: OutlinePath): string {
		if (path.status === "unseen") return '<span class="p">—</span>';
		const values = path.values.filter(([value]) => value !== "");
		if (values.length > 0 && path.types.every((type) => type !== "object")) {
			const shown = values
				.slice(0, 4)
				.map(
					([value]) =>
						`<span class="s">${esc(path.types.includes("boolean") ? value : JSON.stringify(value))}</span>`,
				)
				.join('<span class="p"> | </span>');
			return `${shown}${values.length > 4 ? '<span class="p"> | …</span>' : ""}`;
		}
		return path.types
			.map((type) => `<span class="t">${esc(type)}</span>`)
			.join('<span class="p"> | </span>');
	}

	function brackets(entry: Flat): readonly [string, string] | undefined {
		const kinds = entry.children.map((id) => flat[id]?.node.kind);
		if (kinds.some((kind) => kind === "element" || kind === "block"))
			return ["[", "]"];
		if (kinds.some((kind) => kind === "key" || kind === "outer"))
			return ["{", "}"];
		return undefined;
	}

	function keyHtml(entry: Flat, text: string): string {
		const fact = entry.path?.facts[0];
		if (fact === undefined) return `<span class="k">${text}</span>`;
		return `<a class="k k-link" href="#open=${encodeURIComponent(fact.key)}" data-row="${esc(fact.key)}" title="Show ${esc(factByKey.get(fact.key)?.id ?? fact.key)} side by side">${text}</a>`;
	}

	function jsonHtml(entry: Flat): { text: string; close: string } {
		const { node } = entry;
		const own = entry.path === undefined ? "" : typesHtml(entry.path);
		const pair = brackets(entry);
		const opener =
			pair === undefined ? "" : `<span class="p">${pair[0]}</span>`;
		const folded =
			pair === undefined ? "" : `<span class="folded p"> … ${pair[1]}</span>`;
		const value = [own, opener]
			.filter(Boolean)
			.join('<span class="p"> | </span>');
		switch (node.kind) {
			case "variant": {
				const isRecord = entry.depth === 0;
				const head = `<span class="k">"${esc(node.label)}"</span><span class="p">: </span><span class="s">"${esc(node.value ?? "")}"</span>`;
				return isRecord
					? {
							text: `<span class="p">{ </span>${keyHtml(entry, head)}${own === "" ? "" : `<span class="p"> </span>${own}`}<span class="folded p"> … }</span>`,
							close: "}",
						}
					: {
							text: `${keyHtml(entry, head)}${own === "" ? "" : ` ${own}`}`,
							close: "",
						};
			}
			case "key":
			case "outer": {
				const key = keyHtml(entry, `"${esc(node.label)}"`);
				const outer =
					node.kind === "outer"
						? ' <span class="tag-outer">outside payload</span>'
						: "";
				return {
					text: `${key}<span class="p">: </span>${value}${folded}${outer}`,
					close: pair?.[1] ?? "",
				};
			}
			case "element":
				return {
					text:
						value === ""
							? '<span class="p">…</span>'
							: `${keyHtml(entry, "")}${value}${folded}`,
					close: pair?.[1] ?? "",
				};
			case "block": {
				const name =
					node.value === undefined
						? ""
						: `<span class="p">, </span><span class="k">"name"</span><span class="p">: </span><span class="s">"${esc(node.value)}"</span>`;
				const head = `<span class="k">"type"</span><span class="p">: </span><span class="s">"${esc(node.label)}"</span>${name}`;
				return {
					text: `<span class="p">{ </span>${keyHtml(entry, head)}${own === "" ? "" : ` ${own}`}<span class="folded p"> … }</span>`,
					close: "}",
				};
			}
			case "convention":
				return {
					text: `<span class="p">~ </span>${keyHtml(entry, `<span class="conv">“${esc(node.label)} …”</span>`)}<span class="tag-outer">text convention</span>`,
					close: "",
				};
		}
	}

	function rollupHtml(entry: Flat): string {
		const parts = ROLLUP.flatMap((status) => {
			const n = entry.rollup.get(status) ?? 0;
			return n === 0
				? []
				: [
						`<span class="roll roll-${status}">${count(n)} ${esc(MARK_LABEL[status])}</span>`,
					];
		});
		const records =
			entry.node.records === undefined
				? ""
				: `<span><span class="num">${count(entry.node.records)}</span> ${entry.node.records === 1 ? "record" : "records"}</span>`;
		return `<span class="rollup">${records}<span class="faint">${count(entry.paths)} ${entry.paths === 1 ? "path" : "paths"}</span>${parts.join("")}</span>`;
	}

	function metaHtml(entry: Flat): string {
		const { path } = entry;
		if (path === undefined) return rollupHtml(entry);
		const expanded = details.has(entry.id);
		const records =
			path.status === "unseen"
				? ""
				: `<span class="num">${count(path.count)}</span>`;
		return `<button type="button" class="meta-button" data-detail="${entry.id}" aria-expanded="${expanded}" aria-label="${esc(`Details of ${path.path}`)}">${records}${mark(path.status)}</button>`;
	}

	function detailHtml(entry: Flat): string {
		const { path } = entry;
		if (path === undefined) return "";
		const rows: string[] = [
			`<div><dt>Census path</dt><dd><code>${esc(path.path)}</code></dd></div>`,
		];
		if (path.status !== "unseen") {
			const chars =
				path.maxChars > 0 ? `, up to ${count(path.maxChars)} characters` : "";
			rows.push(
				`<div><dt>Records</dt><dd><span class="num">${count(path.count)}</span></dd></div>`,
				`<div><dt>Values</dt><dd>${esc(path.types.join(" | "))}${chars}</dd></div>`,
			);
			if (path.versions.length > 0)
				rows.push(
					`<div><dt>Versions</dt><dd>${esc(path.versions[0] ?? "")}${path.versions[1] === path.versions[0] ? "" : `–${esc(path.versions[1] ?? "")}`} <span class="faint">(${count(path.versionCount)} ${path.versionCount === 1 ? "version" : "versions"})</span></dd></div>`,
				);
			if (path.values.length > 0)
				rows.push(
					`<div><dt>Seen values</dt><dd>${path.values
						.map(
							([value, n]) =>
								`<code>${esc(JSON.stringify(value))}</code> <span class="num faint">${count(n)}</span>`,
						)
						.join(", ")}</dd></div>`,
				);
		}
		let catalog = `${mark(path.status)} ${esc(capitalize(MARK_MEANING[path.status]))}.`;
		if (path.facts.length > 0)
			catalog += `<ul role="list" class="fact-links">${path.facts
				.map((fact) => {
					const review = factByKey.get(fact.key);
					return `<li><a class="link" href="#open=${encodeURIComponent(fact.key)}" data-row="${esc(fact.key)}"><code>${esc(review?.id ?? fact.key)}</code></a> <span class="faint">${esc(review?.view ?? "")}</span> ${mark(fact.status)}</li>`;
				})
				.join("")}</ul>`;
		if (path.rule !== undefined) {
			const rule = outline.rules[path.rule];
			if (rule !== undefined)
				catalog += ` ${md(capitalize(rule.reason))}. <span class="faint">Rule <code>${esc(rule.path)}</code>.</span>`;
		}
		rows.push(`<div><dt>For the catalog</dt><dd>${catalog}</dd></div>`);
		return `<dl class="node-detail details">${rows.join("")}</dl>`;
	}

	function nodeHtml(id: number, visible: Set<number> | undefined): string {
		const entry = flat[id];
		if (entry === undefined) return "";
		const children = entry.children.filter(
			(child) => visible === undefined || visible.has(child),
		);
		const isOpen = open.has(id) && children.length > 0;
		const { text, close } = jsonHtml(entry);
		const twisty =
			children.length > 0
				? `<button type="button" class="twisty" data-toggle="${id}" aria-expanded="${isOpen}" aria-label="${isOpen ? "Collapse" : "Expand"}">${CHEVRON}</button>`
				: '<span class="twisty" aria-hidden="true"></span>';
		const target = filters.at !== "" && entry.path?.path === filters.at;
		return `<li class="node node-${entry.node.kind}${isOpen ? " is-open" : ""}${children.length > 0 ? " has-children" : ""}" data-id="${id}">
<div class="line${target ? " is-target" : ""}">${twisty}<span class="json">${text}</span>${metaHtml(entry)}</div>${details.has(id) ? detailHtml(entry) : ""}${
			children.length === 0
				? ""
				: `<ul role="list" class="children">${children.map((child) => nodeHtml(child, visible)).join("")}</ul>${close === "" ? "" : `<div class="close p">${close}</div>`}`
		}</li>`;
	}

	// --- the panel ------------------------------------------------------------------

	const legend = (
		[
			"stored",
			"pending",
			"wrong",
			"gap",
			"ignored",
			"unmapped",
			"unseen",
		] as const
	)
		.map(
			(status) =>
				`<li>${mark(status)} <span class="num">${count(statusCounts.get(status) ?? 0)}</span></li>`,
		)
		.join("");
	const versions =
		outline.versions.length === 0
			? ""
			: `, versions ${esc(outline.versions[0] ?? "")}–${esc(outline.versions[1] ?? "")}`;
	const id = (name: string) => `${agent}-${name}`;
	panel.innerHTML = `<div class="tab-intro">
<p class="lede">Every field path in the ${esc(outline.name)} transcripts, as JSON: record kinds at the top, keys nested, <code>[ ]</code> for arrays, <code>{*}</code> for keys that are data (ids, file paths, names), and <code>~ “…”</code> for a text convention at the start of a string. Each path shows how many records carry it and what it is to the catalog; click a connected key to see its fact side by side.</p>
<p class="census">Census of ${esc(data.corpus.label)}: ${count(outline.files)} files, ${count(outline.records)} records${versions}${outline.unparseable > 0 ? `, ${count(outline.unparseable)} unparseable lines` : ""}. ${count(seenPaths.length)} paths, ${count(connected)} connected to a fact.</p>
<ul role="list" class="legend outline-legend" aria-label="Path statuses">${legend}</ul>
</div>
<div class="toolbar outline-toolbar" role="search">
<div class="search">
<input type="search" name="q" id="${id("q")}" aria-label="Search keys and paths" placeholder="Search key or path" autocomplete="off" spellcheck="false">
<kbd class="hint" aria-hidden="true">/</kbd>
</div>
<div class="filters">
${selectControl(
	"show",
	"Status",
	[
		["all", "All paths"],
		["connected", "Connected to a fact"],
		["stored", "Stored"],
		["pending", "Pending"],
		["wrong", "Wrong"],
		["gap", "Not read yet (gap)"],
		["not_recorded", "Not recorded"],
		["ignored", "Ignored"],
		["unmapped", "Unmapped"],
		["unseen", "In catalog, not seen"],
	],
	agent,
)}
<button type="button" class="button" data-all="open">Expand all</button>
<button type="button" class="button" data-all="close">Collapse all</button>
</div>
<p class="shown"><span class="muted" id="${id("shown")}" aria-live="polite"></span> <button type="button" class="link" data-reset hidden>Clear filters</button></p>
</div>
<ul role="list" class="tree" id="${id("tree")}"></ul>
<div class="empty" id="${id("empty")}" hidden>
<p>No paths match these filters.</p>
<button type="button" class="button" data-reset>Clear filters</button>
</div>`;

	const query = <T extends Element = HTMLElement>(selector: string): T => {
		const element = panel.querySelector<T>(selector);
		if (element === null) throw new Error(`outline: ${selector} missing`);
		return element;
	};
	const tree = query<HTMLUListElement>(`#${id("tree")}`);
	const searchInput = query<HTMLInputElement>(`#${id("q")}`);
	const showSelect = query<HTMLSelectElement>(`#${agent}-show`);
	let rendered = false;

	function hashParams(): URLSearchParams {
		const params = new URLSearchParams();
		if (filters.q !== DEFAULTS.q) params.set("q", filters.q);
		if (filters.show !== DEFAULTS.show) params.set("show", filters.show);
		if (filters.at !== DEFAULTS.at) params.set("at", filters.at);
		return params;
	}

	function render(): void {
		rendered = true;
		if (searchInput.value !== filters.q) searchInput.value = filters.q;
		showSelect.value = filters.show;
		const visible = visibleIds();
		const shownRoots = roots.filter(
			(root) => visible === undefined || visible.has(root),
		);
		tree.innerHTML = shownRoots.map((root) => nodeHtml(root, visible)).join("");
		query(`#${id("empty")}`).hidden = shownRoots.length > 0;
		const isDefault =
			filters.q === DEFAULTS.q && filters.show === DEFAULTS.show;
		for (const reset of panel.querySelectorAll<HTMLElement>(
			".shown [data-reset]",
		))
			reset.hidden = isDefault;
		const shownPaths =
			visible === undefined
				? outline.paths.length
				: [...visible].filter((entry) => flat[entry]?.path !== undefined)
						.length;
		query(`#${id("shown")}`).textContent =
			`${count(shownPaths)} of ${count(outline.paths.length)} paths shown.`;
	}

	/** Open the nodes the filters show; default expansion without filters. */
	function resetOpen(): void {
		const visible = visibleIds();
		open = visible === undefined ? defaultOpen() : containerIds(visible);
		details = new Set();
	}

	function update(change: Partial<Filters>): void {
		filters = { ...filters, ...change, at: "" };
		resetOpen();
		host.replaceHash(hashParams());
		render();
	}

	function toggleNode(nodeId: number): void {
		const li = tree.querySelector<HTMLLIElement>(`li[data-id="${nodeId}"]`);
		if (li === null) return;
		const isOpen = !open.has(nodeId);
		if (isOpen) open.add(nodeId);
		else open.delete(nodeId);
		li.classList.toggle("is-open", isOpen);
		const button = li.querySelector(":scope > .line > .twisty");
		button?.setAttribute("aria-expanded", String(isOpen));
		button?.setAttribute("aria-label", isOpen ? "Collapse" : "Expand");
	}

	function toggleDetail(nodeId: number): void {
		const li = tree.querySelector<HTMLLIElement>(`li[data-id="${nodeId}"]`);
		const entry = flat[nodeId];
		if (li === null || entry === undefined) return;
		const line = li.querySelector(":scope > .line");
		const existing = li.querySelector(":scope > .node-detail");
		if (details.has(nodeId)) {
			details.delete(nodeId);
			existing?.remove();
		} else {
			details.add(nodeId);
			line?.insertAdjacentHTML("afterend", detailHtml(entry));
		}
		line
			?.querySelector(".meta-button")
			?.setAttribute("aria-expanded", String(details.has(nodeId)));
	}

	panel.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const row = target.closest<HTMLElement>("[data-row]");
		if (row !== null) {
			event.preventDefault();
			host.go("side", new URLSearchParams({ open: row.dataset.row ?? "" }));
			return;
		}
		const all = target.closest<HTMLElement>("[data-all]");
		if (all !== null) {
			const visible = visibleIds();
			open =
				all.dataset.all === "open"
					? containerIds(visible ?? flat.map((entry) => entry.id))
					: new Set();
			render();
			return;
		}
		if (target.closest("[data-reset]") !== null) {
			update({ ...DEFAULTS });
			return;
		}
		const toggle = target.closest<HTMLElement>("[data-toggle]");
		if (toggle !== null) {
			toggleNode(Number(toggle.dataset.toggle));
			return;
		}
		const detail = target.closest<HTMLElement>("[data-detail]");
		if (detail !== null) {
			toggleDetail(Number(detail.dataset.detail));
			return;
		}
		const line = target.closest(".line");
		const li = line?.parentElement;
		if (line === null || li === null || li === undefined) return;
		if ((window.getSelection()?.toString() ?? "") !== "") return;
		const nodeId = Number(li.dataset.id);
		if (li.classList.contains("has-children")) toggleNode(nodeId);
		else if (flat[nodeId]?.path !== undefined) toggleDetail(nodeId);
	});

	panel.addEventListener("change", (event) => {
		if (event.target === showSelect)
			update({ show: oneOf(showSelect.value, SHOW_FILTERS, "all") });
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

	resetOpen();

	return {
		load(params) {
			const at = params.get("at") ?? "";
			filters = {
				q: params.get("q") ?? DEFAULTS.q,
				show: oneOf(params.get("show"), SHOW_FILTERS, DEFAULTS.show),
				at,
			};
			resetOpen();
			const index = outline.paths.findIndex((path) => path.path === at);
			const nodeId = nodeOfPath.get(index);
			if (nodeId !== undefined) {
				filters = { ...DEFAULTS, at };
				resetOpen();
				for (let parent = flat[nodeId]?.parent ?? -1; parent !== -1; ) {
					open.add(parent);
					parent = flat[parent]?.parent ?? -1;
				}
				details.add(nodeId);
			}
			render();
		},
		params: hashParams,
		focusSearch() {
			if (!rendered) render();
			searchInput.focus();
			searchInput.select();
		},
		reveal() {
			tree
				.querySelector(".line.is-target")
				?.scrollIntoView({ block: "center" });
		},
	};
}
