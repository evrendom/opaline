import { createHash } from "node:crypto";
import {
	type AgentFact,
	FACT_AGENTS,
	FACT_CATALOG,
	FACT_VIEWS,
	type FactAgent,
	type FactEntry,
	type FactStatus,
	type FactView,
	LOCAL_CENSUS,
} from "./fact-catalog.js";
import { CENSUS_IGNORED_PATHS } from "./fact-census-ignored.js";
import {
	COMPARABILITY_LABELS,
	evidenceLabel,
	factComparability,
	type MappingConfidence,
	mappingConfidence,
	mappingCorpus,
	mappingMetrics,
	relationLabel,
	withMappingEvidence,
} from "./fact-mapping.js";
import {
	AGENT_NAMES,
	howChecked,
	SOURCE_LEGEND,
	STATUS_LEGEND,
	STATUS_WORDS,
	shortSource,
	VIEW_TITLES,
	versionLabel,
} from "./fact-matrix.js";
import {
	type FactCorpus,
	type FactCorpusData,
	factCorpusData,
	factReviewKey,
} from "./fact-outline.js";
import { FACT_RESEARCH, type FactResearch } from "./fact-review-research.js";
import {
	sourceCensusCoverage,
	sourceOracleCoverage,
} from "./fact-source-coverage.js";

/**
 * The fact review page: one self-contained HTML file (data, CSS and script
 * inline, nothing fetched) with five tabs: the catalog's facts side by side
 * (which Claude Code path connects to which Codex path), the JSON outline of
 * each agent's transcripts from a census of a corpus, the per-fact review
 * where the product owner marks facts reviewed and answers the open
 * decisions, and the competitor research the catalog was checked against.
 * Written by `bun run --cwd packages/api-routes facts:review`; not committed.
 */

export { factReviewKey };

/** Default output, relative to the repo root (gitignored). */
export const FACT_REVIEW_PATH = "packages/api-routes/.fact-review/index.html";

/** A source path as the page shows it, with the census path it stands for. */
export interface ReviewSource {
	readonly short: string;
	readonly path: string;
}

/** One labelled detail line: plain text (Markdown code spans), a list of code, or both. */
export interface ReviewDetail {
	readonly label: string;
	readonly text?: string;
	readonly code?: readonly string[];
	readonly sources?: readonly ReviewSource[];
}

export interface ReviewCell {
	readonly relation: string;
	readonly confidence: MappingConfidence;
	readonly status: FactStatus;
	readonly gap: boolean;
	/** `v6`, `elsewhere`, or empty. */
	readonly version: string;
	/** One plain sentence saying what the status means for this fact. */
	readonly summary: string;
	readonly sources: readonly ReviewSource[];
	readonly details: readonly ReviewDetail[];
}

export interface ReviewFact {
	readonly comparability: string;
	/** Unique across the catalog: view and id. */
	readonly key: string;
	readonly id: string;
	readonly also: readonly string[];
	readonly view: FactView;
	readonly meaning: string;
	readonly decision?: string;
	/** Hash of the catalog entry: a review mark is valid only for this content. */
	readonly hash: string;
	readonly agents: Readonly<Record<FactAgent, ReviewCell>>;
	/** Details about the fact as a whole (other names, run index columns). */
	readonly details: readonly ReviewDetail[];
	/** Lowercase text the search box matches: names, meaning, sources. */
	readonly search: string;
}

export interface FactReviewMeta {
	/** The last commit that changed the catalog file. */
	readonly catalogCommit?: { readonly hash: string; readonly date: string };
	/** Whether the catalog file has uncommitted changes. */
	readonly catalogDirty?: boolean;
	/** ISO time the page was generated. */
	readonly generatedAt: string;
}

export interface FactReviewData {
	readonly sourceOracle: ReturnType<typeof sourceOracleCoverage>;
	readonly sourceCensus: ReturnType<typeof sourceCensusCoverage>;
	readonly metrics: Readonly<
		Record<FactAgent, ReturnType<typeof mappingMetrics>>
	>;
	readonly meta: FactReviewMeta;
	readonly census: string;
	readonly agents: readonly { readonly id: FactAgent; readonly name: string }[];
	readonly views: readonly { readonly id: FactView; readonly title: string }[];
	readonly statusWords: Readonly<Record<FactStatus, string>>;
	readonly statusLegend: Readonly<Record<FactStatus | "gap", string>>;
	readonly sourceLegend: string;
	readonly facts: readonly ReviewFact[];
	/** The census of a corpus: each agent's JSON outline and the side-by-side rows. */
	readonly corpus: FactCorpusData;
	/** The competitor research, for the Research tab. */
	readonly research: FactResearch;
}

function sources(paths: readonly string[]): ReviewSource[] {
	const seen = new Map<string, ReviewSource>();
	for (const path of paths) {
		const short = shortSource(path);
		if (!seen.has(short)) seen.set(short, { short, path });
	}
	return [...seen.values()];
}

function cellSummary(agent: FactAgent, fact: AgentFact): string {
	const name = AGENT_NAMES[agent];
	switch (fact.status) {
		case "stored": {
			const where =
				fact.stores.since !== undefined &&
				(fact.stores.facts ?? fact.stores.record)
					? `Opaline stores it, since transcript parser version ${fact.stores.since}.`
					: "Opaline stores it in another table.";
			return fact.gap === undefined
				? where
				: `${where} ${name} also records it in a place Opaline does not read yet.`;
		}
		case "pending":
			return `${name} records it; Opaline does not store it yet.`;
		case "not_recorded":
			return `Not found in the searched ${name} corpus; writer-level absence is not proved.`;
		case "wrong":
			return "Opaline stores it, but the stored value is known to be wrong.";
	}
}

function storedIn(fact: AgentFact): ReviewDetail[] {
	if (fact.status !== "stored" && fact.status !== "wrong") return [];
	const { stores } = fact;
	const details: ReviewDetail[] = [];
	const columns = [
		...(stores.record ?? []).map((column) => `${column} (record column)`),
		...(stores.facts ?? []).map((field) => `${field} (fact)`),
	];
	if (columns.length > 0) details.push({ label: "Stored in", code: columns });
	if (stores.elsewhere !== undefined)
		details.push({
			label: columns.length > 0 ? "Also stored in" : "Stored in",
			text: stores.elsewhere,
		});
	if (stores.since !== undefined && columns.length > 0)
		details.push({
			label: "First stored by",
			text: `Transcript parser version ${stores.since}.`,
		});
	return details;
}

function cellDetails(fact: AgentFact): ReviewDetail[] {
	const details: ReviewDetail[] = [
		{
			label: "Mapping",
			text: `${relationLabel(fact.relation)} · ${mappingConfidence(fact)}`,
		},
		{ label: "Evidence", code: fact.evidence.map(evidenceLabel) },
	];
	if (fact.justification !== undefined)
		details.push({ label: "Judgement", text: fact.justification });
	if (fact.sourceMappings.length > 0)
		details.push({
			label: "Per-path roles and relations",
			code: fact.sourceMappings.map(
				(source) =>
					`${source.role} · ${relationLabel(source.relation)} · ${source.path}${source.justification === undefined ? "" : ` — ${source.justification}`}`,
			),
		});
	if (fact.legacySources !== undefined)
		details.push({
			label: "Legacy sources (versions in census evidence)",
			code: fact.legacySources,
		});
	if (fact.conflict !== undefined)
		details.push({ label: "Semantic conflict", text: fact.conflict });
	if (fact.status === "wrong")
		details.push({ label: "What is wrong, and the fix", text: fact.plan });
	if (fact.status === "pending")
		details.push({ label: "Plan to store it", text: fact.plan });
	const recorded = sources(fact.sources);
	if (recorded.length > 0)
		details.push({ label: "Recorded at", sources: recorded });
	if (
		(fact.status === "stored" || fact.status === "wrong") &&
		fact.gap !== undefined
	)
		details.push(
			{
				label: "Also recorded at, not read yet",
				sources: sources(fact.gap.sources),
			},
			{ label: "Plan to read it", text: fact.gap.plan },
		);
	details.push(...storedIn(fact));
	if (fact.status === "not_recorded")
		details.push({ label: "How we checked", text: howChecked(fact.searched) });
	if (fact.notes !== undefined)
		details.push({ label: "Note", text: fact.notes });
	if (
		(fact.status === "stored" || fact.status === "wrong") &&
		fact.testedIn !== undefined
	)
		details.push({ label: "Tested in", code: [fact.testedIn] });
	return details;
}

function entryDetails(entry: FactEntry): ReviewDetail[] {
	const details: ReviewDetail[] = [];
	if (entry.also !== undefined)
		details.push({ label: "Also stands for", code: entry.also });
	if (entry.alsoIn !== undefined)
		details.push({
			label: "Also a column of",
			text: `${entry.alsoIn.map((view) => VIEW_TITLES[view].replace(/:.*$/u, "")).join(", ")}.`,
		});
	if (entry.runIndex !== undefined)
		details.push({
			label: "Run index columns read from it",
			code: entry.runIndex,
		});
	return details;
}

/** A short, stable hash of a catalog entry's content. */
export function factEntryHash(entry: FactEntry): string {
	return createHash("sha256")
		.update(JSON.stringify(entry))
		.digest("hex")
		.slice(0, 12);
}

/** Everything the page shows, derived from the catalog and a census. */
export function factReviewData(
	meta: FactReviewMeta,
	corpus: FactCorpus,
): FactReviewData {
	const mappings = withMappingEvidence(
		FACT_CATALOG,
		mappingCorpus(corpus.census, corpus.label),
	);
	const facts = mappings.map((entry, index): ReviewFact => {
		const raw = FACT_CATALOG[index];
		if (raw === undefined) throw new Error("Missing catalog entry");
		const agents = Object.fromEntries(
			FACT_AGENTS.map((agent) => {
				const fact = entry.agents[agent];
				const cell: ReviewCell = {
					relation: relationLabel(fact.relation),
					confidence: mappingConfidence(fact),
					status: fact.status,
					gap:
						(fact.status === "stored" || fact.status === "wrong") &&
						fact.gap !== undefined,
					version: versionLabel(fact),
					summary: cellSummary(agent, fact),
					sources: sources(fact.sources),
					details: cellDetails(fact),
				};
				return [agent, cell];
			}),
		) as Record<FactAgent, ReviewCell>;
		const search = [
			entry.id,
			...(entry.also ?? []),
			entry.meaning,
			...FACT_AGENTS.flatMap((agent) => {
				const fact = entry.agents[agent];
				return fact.sourceMappings.flatMap(({ path }) => [
					path,
					shortSource(path),
				]);
			}),
		]
			.join("\n")
			.toLowerCase();
		return {
			comparability: COMPARABILITY_LABELS[factComparability(entry)],
			key: factReviewKey(entry),
			id: entry.id,
			also: entry.also ?? [],
			view: entry.view,
			meaning: entry.meaning,
			...(entry.decision === undefined ? {} : { decision: entry.decision }),
			hash: factEntryHash(raw),
			agents,
			details: entryDetails(entry),
			search,
		};
	});
	return {
		sourceOracle: sourceOracleCoverage(),
		sourceCensus: sourceCensusCoverage(
			Object.fromEntries(
				[...(corpus.census.paths.get("codex") ?? [])].map(([path, stats]) => [
					path,
					stats.count,
				]),
			),
		),
		metrics: {
			claude_code: mappingMetrics(mappings, "claude_code"),
			codex: mappingMetrics(mappings, "codex"),
		},
		meta,
		census: LOCAL_CENSUS,
		agents: FACT_AGENTS.map((id) => ({ id, name: AGENT_NAMES[id] })),
		views: FACT_VIEWS.map((id) => ({ id, title: VIEW_TITLES[id] })),
		statusWords: STATUS_WORDS,
		statusLegend: STATUS_LEGEND,
		sourceLegend: SOURCE_LEGEND,
		facts,
		corpus: factCorpusData(corpus, CENSUS_IGNORED_PATHS),
		research: FACT_RESEARCH,
	};
}

const PAGE_DIR = new URL("./fact-review-page/", import.meta.url);

/** JSON that is safe inside a `<script>` element. */
export function scriptJson(value: unknown): string {
	return JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll(" ", "\\u2028")
		.replaceAll(" ", "\\u2029");
}

async function clientScript(): Promise<string> {
	const build = await Bun.build({
		entrypoints: [new URL("client.ts", PAGE_DIR).pathname],
		target: "browser",
		format: "iife",
	});
	const output = build.outputs[0];
	if (!build.success || output === undefined)
		throw new Error(
			`fact review client build failed: ${build.logs.map(String).join("\n")}`,
		);
	return (await output.text()).replaceAll("</script", "<\\/script");
}

/** The review page as one self-contained HTML document. */
export async function renderFactReview(
	meta: FactReviewMeta,
	corpus: FactCorpus,
): Promise<string> {
	const [css, script] = await Promise.all([
		Bun.file(new URL("review.css", PAGE_DIR)).text(),
		clientScript(),
	]);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>L1 fact review</title>
<style>
${css.replaceAll("</style", "<\\/style")}
</style>
</head>
<body>
<div id="app" class="app">
<noscript><p class="noscript">This page needs JavaScript to show the catalog.</p></noscript>
</div>
<script type="application/json" id="fact-review-data">${scriptJson(factReviewData(meta, corpus))}</script>
<script>
${script}
</script>
</body>
</html>
`;
}
