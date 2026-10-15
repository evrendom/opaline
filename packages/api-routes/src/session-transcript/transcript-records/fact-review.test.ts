import { describe, expect, test } from "bun:test";
import { FACT_AGENTS, FACT_CATALOG } from "./fact-catalog.js";
import { compareCensus, createCensus } from "./fact-census.js";
import { addCensusPaths, FIXTURE_CORPUS_DIR } from "./fact-census-files.js";
import { FACT_CENSUS_CATALOG } from "./fact-census-ignored.js";
import {
	COMPARABILITY_LABELS,
	factComparability,
	mappingConfidence,
	mappingCorpus,
	mappingMetrics,
	relationLabel,
	withMappingEvidence,
} from "./fact-mapping.js";
import type { OutlineNode } from "./fact-outline.js";
import {
	type FactReviewData,
	factEntryHash,
	factReviewKey,
	renderFactReview,
	scriptJson,
} from "./fact-review.js";
import { FACT_RESEARCH } from "./fact-review-research.js";

const META = {
	catalogCommit: {
		hash: "0123456789abcdef",
		date: "2026-10-09T10:00:00+02:00",
	},
	catalogDirty: false,
	generatedAt: "2026-10-09T08:00:00.000Z",
};

function embeddedData(html: string): FactReviewData {
	const match =
		/<script type="application\/json" id="fact-review-data">([\s\S]*?)<\/script>/u.exec(
			html,
		);
	if (match?.[1] === undefined) throw new Error("no embedded data");
	return JSON.parse(match[1]) as FactReviewData;
}

function treePaths(nodes: readonly OutlineNode[]): number[] {
	return nodes.flatMap((node) => [
		...(node.path === undefined ? [] : [node.path]),
		...treePaths(node.children ?? []),
	]);
}

describe("the fact review page", async () => {
	const census = createCensus();
	await addCensusPaths(census, [FIXTURE_CORPUS_DIR]);
	const html = await renderFactReview(META, {
		label: "the parser fixtures",
		census,
	});
	const data = embeddedData(html);

	test("embeds every catalog fact, once, with what each agent has", () => {
		const mappings = withMappingEvidence(
			FACT_CATALOG,
			mappingCorpus(census, data.corpus.label),
		);
		expect(data.facts.map((fact) => fact.key)).toEqual(
			FACT_CATALOG.map(factReviewKey),
		);
		expect(new Set(data.facts.map((fact) => fact.key)).size).toBe(
			FACT_CATALOG.length,
		);
		FACT_CATALOG.forEach((entry, index) => {
			const fact = data.facts[index];
			const mapping = mappings[index];
			if (mapping === undefined) throw new Error("Missing mapping");
			expect(fact?.id).toBe(entry.id);
			expect(fact?.hash).toBe(factEntryHash(entry));
			expect(fact?.decision).toBe(entry.decision);
			for (const agent of FACT_AGENTS) {
				expect(fact?.agents[agent].status).toBe(entry.agents[agent].status);
				expect(fact?.agents[agent].relation).toBe(
					relationLabel(entry.agents[agent].relation),
				);
				expect(fact?.agents[agent].confidence).toBe(
					mappingConfidence(mapping.agents[agent]),
				);
			}
			expect(fact?.comparability).toBe(
				COMPARABILITY_LABELS[factComparability(entry)],
			);
		});
		expect(data.meta).toEqual(META);
		for (const agent of FACT_AGENTS)
			expect(data.metrics[agent]).toEqual(mappingMetrics(mappings, agent));
	});

	test("every census path appears in its agent's outline exactly once", () => {
		expect(data.corpus.agents.map((agent) => agent.agent)).toEqual([
			...FACT_AGENTS,
		]);
		for (const outline of data.corpus.agents) {
			const censusPaths = [...(census.paths.get(outline.agent)?.keys() ?? [])];
			expect(censusPaths.length).toBeGreaterThan(50);
			expect(
				outline.paths
					.filter((path) => path.status !== "unseen")
					.map((path) => path.path),
			).toEqual(censusPaths);
			const inTree = treePaths(outline.tree).sort((a, b) => a - b);
			expect(inTree).toEqual(outline.paths.map((_, index) => index));
			expect(outline.records).toBe(census.records.get(outline.agent) ?? 0);
		}
	});

	test("shows source residue separately from observed corpus residue and unreviewed mappings", () => {
		expect(data.sourceOracle.total).toBe(2087);
		expect(data.sourceOracle.missingSources).toEqual([]);
		expect(data.sourceOracle.residue).toEqual([]);
		expect(data.sourceOracle.pendingReview.length).toBe(0);
		expect(data.sourceOracle.pending.length).toBe(0);
		expect(html).toContain(
			"Codex can write these; we neither map nor ignore them",
		);
		expect(html).toContain("unreviewed");
		expect(data.sourceCensus.total).toBeGreaterThan(0);
		expect(data.sourceCensus.total).toBe(census.paths.get("codex")?.size ?? 0);
		for (const path of data.sourceOracle.residue)
			expect(html).toContain(
				path.path
					.replaceAll("&", "&amp;")
					.replaceAll("<", "&lt;")
					.replaceAll(">", "&gt;")
					.replaceAll('"', "&quot;")
					.replaceAll("'", "&#39;"),
			);
	});

	test("classifies each path as the census comparison does", () => {
		const report = compareCensus(census, FACT_CENSUS_CATALOG);
		for (const outline of data.corpus.agents) {
			const agentReport = report.agents.find(
				(agent) => agent.agent === outline.agent,
			);
			const statuses = outline.paths.map((path) => path.status);
			const unseen = outline.paths.filter((path) => path.status === "unseen");
			expect(statuses.filter((status) => status === "unmapped").length).toBe(
				agentReport?.unmapped.length ?? -1,
			);
			expect(statuses.filter((status) => status === "ignored").length).toBe(
				agentReport?.ignoredPaths ?? -1,
			);
			expect(unseen.map((path) => path.path).sort()).toEqual([
				...(agentReport?.unseenSources ?? []),
			]);
			for (const path of outline.paths) {
				if (path.status === "ignored")
					expect(outline.rules[path.rule ?? -1]?.reason).toBeString();
				else if (path.status !== "unmapped")
					expect(path.facts.length).toBeGreaterThan(0);
			}
		}
	});

	test("every catalog fact is a side-by-side row, its sources resolved to outline paths", () => {
		expect(data.corpus.side.map((row) => row.key)).toEqual(
			FACT_CATALOG.map(factReviewKey),
		);
		FACT_CATALOG.forEach((entry, index) => {
			const row = data.corpus.side[index];
			const has = FACT_AGENTS.filter((agent) =>
				entry.agents[agent].sourceMappings.some(
					(source) => source.role === "primary",
				),
			);
			expect(row?.connection).toBe(
				has.length === 2 ? "both" : (has[0] ?? "neither"),
			);
			for (const [agentIndex, agent] of FACT_AGENTS.entries()) {
				const fact = entry.agents[agent];
				const gap =
					fact.status === "stored" || fact.status === "wrong"
						? (fact.gap?.sources ?? []).filter((path) =>
								fact.sourceMappings.some(
									(source) => source.path === path && source.role === "primary",
								),
							)
						: [];
				expect(row?.agents[agent].map((source) => source.pattern)).toEqual([
					...fact.sources,
					...gap,
				]);
				const outline = data.corpus.agents[agentIndex];
				for (const source of row?.agents[agent] ?? []) {
					expect(source.paths.length).toBeGreaterThan(0);
					for (const pathIndex of source.paths)
						expect(
							outline?.paths[pathIndex]?.facts.map((fact) => fact.key),
						).toContain(factReviewKey(entry));
				}
			}
		});
	});

	test("the research names only catalog facts and findings that exist", () => {
		const keys = new Set(FACT_CATALOG.map(factReviewKey));
		const ids = FACT_RESEARCH.findings.map((finding) => finding.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const finding of FACT_RESEARCH.findings) {
			expect(finding.kinds.length).toBeGreaterThan(0);
			for (const key of finding.facts)
				expect({ finding: finding.id, key, known: keys.has(key) }).toEqual({
					finding: finding.id,
					key,
					known: true,
				});
		}
		for (const action of FACT_RESEARCH.openActions) {
			expect(action.findings.length > 0 || action.references === true).toBe(
				true,
			);
			for (const id of action.findings) expect(ids).toContain(id);
		}
		expect(data.research).toEqual(FACT_RESEARCH);
	});

	test("every fact id appears in the page", () => {
		for (const entry of FACT_CATALOG) expect(html).toContain(entry.id);
	});

	test("is self-contained: no external scripts, styles, fonts or images", () => {
		expect(html).not.toMatch(/<script[^>]+src=/u);
		expect(html).not.toMatch(/<link[^>]+href=/u);
		expect(html).not.toMatch(/@import|url\(\s*["']?https?:/u);
		expect(html).not.toMatch(/<img[^>]+src=["']?https?:/u);
		expect(html).not.toMatch(
			/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/u,
		);
	});

	test("a content change changes the review hash", () => {
		const entry = FACT_CATALOG[0];
		if (entry === undefined) throw new Error("empty catalog");
		expect(factEntryHash({ ...entry, meaning: `${entry.meaning} ` })).not.toBe(
			factEntryHash(entry),
		);
	});

	test("embedded JSON cannot close its script element", () => {
		const json = scriptJson({ text: "</script><script>alert(1)</script>" });
		expect(json).not.toContain("</script");
		expect(JSON.parse(json)).toEqual({
			text: "</script><script>alert(1)</script>",
		});
	});
});
