/**
 * The "Research" tab: the competitor survey the catalog was checked against.
 * The verdict, the open actions (each linked to its findings), then every
 * finding with its action kind, whether the local transcripts verified it,
 * and the catalog facts it is about. The survey's text is shown as text.
 */
import type {
	ResearchActionKind,
	ResearchFinding,
} from "../fact-review-research.js";
import {
	data,
	esc,
	factByKey,
	md,
	type TabHost,
	type TabView,
} from "./shared.js";

const KIND_CLASS: Record<ResearchActionKind, string> = {
	none: "kind-none",
	"parser 9": "kind-work",
	"usage extraction": "kind-work",
	check: "kind-check",
	decision: "kind-decision",
};

function kindBadge(kind: ResearchActionKind): string {
	return `<span class="mark ${KIND_CLASS[kind]}">${esc(kind === "none" ? "no action" : kind)}</span>`;
}

function verifiedBadge(finding: ResearchFinding): string {
	return finding.localData === undefined
		? '<span class="mark mark-unverified">unverified on local data</span>'
		: '<span class="mark mark-verified">verified on local data</span>';
}

function findingLink(id: number): string {
	return `<a class="link" href="#tab=research&amp;finding=${id}" data-finding="${id}">${id}</a>`;
}

function factLinks(finding: ResearchFinding): string {
	return finding.facts
		.map((key) => {
			const fact = factByKey.get(key);
			if (fact === undefined) return `<li><code>${esc(key)}</code></li>`;
			return `<li><a class="link" href="#open=${encodeURIComponent(key)}" data-row="${esc(key)}"><code>${esc(fact.id)}</code></a> <span class="faint">${esc(fact.view)}</span> <button type="button" class="link quiet-link" data-review="${esc(key)}">in Fact review</button></li>`;
		})
		.join("");
}

function findingHtml(finding: ResearchFinding): string {
	const rows = [
		finding.localData === undefined
			? ""
			: `<div><dt>Local data showed</dt><dd>${md(finding.localData)}</dd></div>`,
		finding.opaline === undefined
			? ""
			: `<div><dt>Opaline today</dt><dd>${md(finding.opaline)}</dd></div>`,
		`<div><dt>Proposed action</dt><dd>${md(finding.action)}</dd></div>`,
		finding.facts.length === 0
			? ""
			: `<div><dt>Catalog facts</dt><dd><ul role="list" class="fact-links">${factLinks(finding)}</ul></dd></div>`,
	].join("");
	return `<li class="finding${finding.localData === undefined ? "" : " is-verified"}" id="finding-${finding.id}">
<div class="finding-claim">
<p class="finding-num num">${finding.id}</p>
<div>
<p class="claim">${md(finding.claim)}</p>
<p class="finding-badges">${finding.kinds.map(kindBadge).join("")}${verifiedBadge(finding)}</p>
</div>
</div>
<dl class="details finding-details">${rows}</dl>
</li>`;
}

export function mountResearch(panel: HTMLElement, host: TabHost): TabView {
	const { research } = data;
	let target = "";
	const verified = research.findings.filter(
		(finding) => finding.localData !== undefined,
	).length;
	const actions = research.openActions
		.map((action) => {
			const behind = action.references
				? '<a class="link" href="#tab=research&amp;finding=references" data-finding="references">references</a>'
				: `${action.findings.length === 1 ? "finding" : "findings"} ${action.findings.map(findingLink).join(", ")}`;
			return `<li><span class="action-id">${esc(action.id)}</span><p>${md(action.text)} <span class="faint">(${behind})</span></p></li>`;
		})
		.join("");
	const references = research.references
		.map(
			(reference) =>
				`<li><span class="reference-name">${esc(reference.name)}</span>${reference.note === undefined ? "" : ` <span class="faint">${esc(reference.note)}</span>`}<ul role="list" class="code-list">${reference.files.map((file) => `<li><code>${esc(file)}</code></li>`).join("")}</ul></li>`,
		)
		.join("");
	panel.innerHTML = `<div class="tab-intro">
<p class="lede">${esc(research.title)}: how other tools read Claude Code and Codex transcripts, each claim checked against Opaline’s code and, where marked, the local transcripts.</p>
<p class="census">${md(research.source)}</p>
</div>
<section class="research-section verdict" aria-labelledby="verdict-title">
<h2 id="verdict-title">Verdict</h2>
<p>${md(research.verdict)}</p>
</section>
<section class="research-section" aria-labelledby="actions-title">
<h2 id="actions-title">Open actions</h2>
<ol role="list" class="open-actions">${actions}</ol>
</section>
<section class="research-section" aria-labelledby="findings-title">
<h2 id="findings-title">Findings <span class="count-tag num">${research.findings.length}</span></h2>
<p class="section-lede">Claim, what Opaline does today, what the local transcripts showed (${verified} of ${research.findings.length} verified on them), and the proposed action.</p>
<ol role="list" class="findings">${research.findings.map(findingHtml).join("")}</ol>
</section>
<section class="research-section" aria-labelledby="thinner-title">
<h2 id="thinner-title">Where the research is thinner than Opaline</h2>
<p>${md(research.thinner)}</p>
</section>
<section class="research-section" id="finding-references" aria-labelledby="references-title">
<h2 id="references-title">References</h2>
<p class="section-lede">${md(research.referencesNote)}</p>
<ul role="list" class="references">${references}</ul>
</section>`;

	function params(): URLSearchParams {
		return new URLSearchParams(target === "" ? [] : [["finding", target]]);
	}

	function mark(): void {
		for (const element of panel.querySelectorAll(".is-target"))
			element.classList.remove("is-target");
		if (target !== "")
			panel
				.querySelector(`#finding-${CSS.escape(target)}`)
				?.classList.add("is-target");
	}

	function reveal(): void {
		if (target === "") return;
		panel
			.querySelector(`#finding-${CSS.escape(target)}`)
			?.scrollIntoView({ block: "start" });
	}

	panel.addEventListener("click", (event) => {
		const element = event.target as HTMLElement;
		const finding = element.closest<HTMLElement>("[data-finding]");
		if (finding !== null) {
			event.preventDefault();
			target = finding.dataset.finding ?? "";
			host.replaceHash(params());
			mark();
			reveal();
			return;
		}
		const row = element.closest<HTMLElement>("[data-row]");
		if (row !== null) {
			event.preventDefault();
			host.go("side", new URLSearchParams({ open: row.dataset.row ?? "" }));
			return;
		}
		const review = element.closest<HTMLElement>("[data-review]");
		const fact = factByKey.get(review?.dataset.review ?? "");
		if (fact !== undefined)
			host.go(
				"review",
				new URLSearchParams({
					q: fact.id,
					status: "all",
					view: fact.view,
					open: fact.key,
				}),
			);
	});

	return {
		load(next) {
			target = next.get("finding") ?? "";
			mark();
		},
		params,
		focusSearch() {},
		reveal,
	};
}
