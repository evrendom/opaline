/**
 * What every tab of the fact review page shares: the embedded data, and the
 * markup helpers (escaping, badges, source lists, controls).
 */

import type { OutlineAgent } from "../fact-outline.js";
import type {
	FactReviewData,
	ReviewCell,
	ReviewDetail,
	ReviewSource,
} from "../fact-review.js";

export type Agent = FactReviewData["agents"][number]["id"];
export type View = FactReviewData["views"][number]["id"];
export type Status = ReviewCell["status"];

const dataElement = document.getElementById("fact-review-data");
if (dataElement === null) throw new Error("fact review: page data missing");
export const data = JSON.parse(dataElement.textContent ?? "") as FactReviewData;
export const facts = data.facts;
export const factByKey = new Map(facts.map((fact) => [fact.key, fact]));
export const agentIds = data.agents.map((agent) => agent.id);
export const agentName = Object.fromEntries(
	data.agents.map((agent) => [agent.id, agent.name]),
) as Record<Agent, string>;

/** The page's tabs, in the order of the tab bar. */
export type TabId = "side" | "claude_code" | "codex" | "review" | "research";

/** What a tab may ask of the page that hosts it. */
export interface TabHost {
	/** Replace the URL hash with this tab and its filters. */
	replaceHash(params: URLSearchParams): void;
	/** Switch to a tab with these filters, as a new history entry, and reveal its target. */
	go(tab: TabId, params: URLSearchParams): void;
}

/** A mounted tab: its filters come from and go to the URL hash. */
export interface TabView {
	/** Apply the filters a URL hash names. */
	load(params: URLSearchParams): void;
	/** The current filters, for the URL hash. */
	params(): URLSearchParams;
	focusSearch(): void;
	/** Scroll to the row or key the filters point at, after a jump from another tab. */
	reveal(): void;
}

export function oneOf<T extends string>(
	value: string | null,
	allowed: readonly T[],
	fallback: T,
): T {
	return allowed.find((option) => option === value) ?? fallback;
}

export function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A whole number with thousands separators. */
export function count(value: number): string {
	return value.toLocaleString("en-US");
}

// --- markup helpers -------------------------------------------------------------

export function esc(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

/** Escaped text with Markdown code spans as `<code>`. */
export function md(text: string): string {
	return esc(text).replace(/`([^`]+)`/gu, "<code>$1</code>");
}

export function domId(prefix: string, key: string): string {
	return `${prefix}-${key.replace(/[^a-zA-Z0-9_-]/gu, "-")}`;
}

export const STATUS_LABEL: Record<Status, string> = {
	stored: "Stored",
	pending: "Pending",
	not_recorded: "Not recorded",
	wrong: "Wrong",
};

export function badge(kind: Status | "gap", label?: string): string {
	return `<span class="badge badge-${kind}">${esc(label ?? (kind === "gap" ? "Gap" : STATUS_LABEL[kind]))}</span>`;
}

export function cellBadges(cell: ReviewCell): string {
	const version =
		cell.version === ""
			? ""
			: `<span class="version">${esc(cell.version)}</span>`;
	return `<span class="badges">${badge(cell.status)}${version}${cell.gap ? badge("gap") : ""}<span class="version" title="${esc(cell.relation)}">${esc(cell.relation.split(":")[0] ?? cell.relation)} · ${esc(cell.confidence)}</span></span>`;
}

export function sourceCode(source: ReviewSource): string {
	return `<code title="${esc(source.path)}">${esc(source.short)}</code>`;
}

export function sourceList(sources: readonly ReviewSource[]): string {
	return `<ul role="list" class="code-list">${sources.map((source) => `<li>${sourceCode(source)}</li>`).join("")}</ul>`;
}

export function detailList(details: readonly ReviewDetail[]): string {
	if (details.length === 0) return "";
	return `<dl class="details">${details
		.map((detail) => {
			const parts = [
				detail.text === undefined ? "" : `<p>${md(detail.text)}</p>`,
				detail.code === undefined
					? ""
					: `<ul role="list" class="code-list">${detail.code.map((code) => `<li><code>${esc(code)}</code></li>`).join("")}</ul>`,
				detail.sources === undefined ? "" : sourceList(detail.sources),
			];
			return `<div><dt>${esc(detail.label)}</dt><dd>${parts.join("")}</dd></div>`;
		})
		.join("")}</dl>`;
}

export function viewTag(view: View): string {
	return `<span class="view-tag">${esc(view)}</span>`;
}

export const CHEVRON = `<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd"/></svg>`;

export const CHECK = `<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 8L6 11L11 3.5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function selectControl(
	name: string,
	label: string,
	options: readonly (readonly [string, string])[],
	idPrefix = "filter",
): string {
	return `<span class="select"><select name="${name}" id="${idPrefix}-${name}" aria-label="${esc(label)}">${options
		.map(([value, text]) => `<option value="${value}">${esc(text)}</option>`)
		.join(
			"",
		)}</select><svg viewBox="0 0 8 5" width="8" height="5" fill="none" aria-hidden="true"><path d="M.5.5 4 4 7.5.5" stroke="currentcolor"/></svg></span>`;
}

/** An agent's outline: its census paths, ignore rules and JSON tree. */
export function outlineOf(agent: Agent): OutlineAgent {
	const outline = data.corpus.agents.find((entry) => entry.agent === agent);
	if (outline === undefined)
		throw new Error(`fact review: no ${agent} outline`);
	return outline;
}

/** Escaped text that may break before `.`, `[`, `@`, `~` and after `/`, `:`. */
function breakable(text: string): string {
	return esc(text)
		.replace(/([.[@~])/gu, "<wbr>$1")
		.replace(/([/:])/gu, "$1<wbr>");
}

/** A census path, its record kind muted and the field path after it. */
export function pathHtml(path: string): string {
	const head = /^[^.@[~]*/u.exec(path)?.[0] ?? "";
	return `<span class="path-head">${breakable(head)}</span>${breakable(path.slice(head.length))}`;
}
