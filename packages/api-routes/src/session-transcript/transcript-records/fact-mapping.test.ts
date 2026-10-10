import { describe, expect, test } from "bun:test";
import { catalogSources, FACT_AGENTS, FACT_CATALOG } from "./fact-catalog.js";
import {
	type FactMapping,
	factComparability,
	mappingConfidence,
	mappingMetrics,
	withMappingEvidence,
} from "./fact-mapping.js";

describe("mapping evidence", () => {
	test("catalog and runtime barrel do not load tooling evidence", async () => {
		const runtime = await Bun.file(
			new URL("./index.ts", import.meta.url),
		).text();
		expect(runtime).not.toContain("fact-catalog");
		expect(runtime).not.toContain("fact-mapping");
		for (const entry of FACT_CATALOG)
			for (const agent of FACT_AGENTS)
				for (const item of entry.agents[agent].evidence)
					expect([
						"writer_source",
						"published_types",
						"paired_run",
						"llm_audit",
					]).toContain(item.kind);
	});
	test("every mapping is classified, transforms are named and writer absences are proved", () => {
		for (const entry of withMappingEvidence(FACT_CATALOG))
			for (const agent of FACT_AGENTS) {
				const mapping = entry.agents[agent];
				const gap =
					mapping.status === "stored" || mapping.status === "wrong"
						? (mapping.gap?.sources ?? [])
						: [];
				expect(mapping.sources).toEqual(
					mapping.sourceMappings
						.filter(
							(source) =>
								source.role === "primary" &&
								(!gap.includes(source.path) ||
									mapping.sources.includes(source.path)),
						)
						.map((source) => source.path),
				);
				expect(
					new Set(mapping.sourceMappings.map((source) => source.path)).size,
				).toBe(mapping.sourceMappings.length);
				for (const source of mapping.sourceMappings) {
					if (source.relation.kind !== "unreviewed")
						expect(source.justification?.trim().length).toBeGreaterThan(0);
					if (source.relation.kind === "transform")
						expect(source.relation.transform.trim().length).toBeGreaterThan(0);
				}
				if (mapping.relation.kind === "derived") {
					expect(mapping.relation.from.length).toBeGreaterThan(0);
					for (const dependency of mapping.relation.from)
						expect(
							FACT_CATALOG.some(
								(fact) => `${fact.view}/${fact.id}` === dependency,
							),
						).toBe(true);
				}
				expect(mapping.relation.kind).toBeString();
				expect(mapping.evidence.length).toBeGreaterThan(0);
				if (mapping.relation.kind !== "unreviewed")
					expect(mapping.justification?.trim().length).toBeGreaterThan(0);
				if (mapping.relation.kind === "transform")
					expect(mapping.relation.transform.trim().length).toBeGreaterThan(0);
				if (mapping.relation.kind === "not_emitted")
					expect(
						mapping.evidence.some(
							(item) => item.kind === "writer_source" && item.supportsMeaning,
						),
					).toBe(true);
				if (mapping.status === "not_recorded")
					expect(["not_found", "not_emitted"]).toContain(mapping.relation.kind);
			}
	});
	test("LLM agreement and writer path existence cannot verify semantics", () => {
		const mapping: FactMapping = {
			relation: { kind: "exact" },
			evidence: [
				{ kind: "llm_audit", reference: "test", explanation: "assertion" },
			],
		};
		expect(mappingConfidence(mapping)).toBe("asserted");
		const census = {
			kind: "census",
			path: "field",
			count: 1,
			corpus: "synthetic",
		} as const;
		const writer = {
			kind: "writer_source",
			path: "field",
			file: "test.rs",
			line: 1,
			version: "test",
			supportsMeaning: false,
			explanation: "existence only",
		} as const;
		expect(mappingConfidence({ ...mapping, evidence: [census] })).toBe(
			"observed",
		);
		expect(mappingConfidence({ ...mapping, evidence: [census, writer] })).toBe(
			"observed",
		);
		expect(
			mappingConfidence({
				...mapping,
				evidence: [{ ...writer, supportsMeaning: true }],
			}),
		).toBe("asserted");
		expect(
			mappingConfidence({
				...mapping,
				evidence: [census, { ...writer, supportsMeaning: true }],
			}),
		).toBe("verified");
	});
	test("context paths do not supply source coverage or semantic confidence", () => {
		const entry = FACT_CATALOG.find(
			(entry) => entry.view === "runs" && entry.id === "message_phase",
		);
		expect(entry).toBeDefined();
		if (entry === undefined) throw new Error("Missing message phase");
		expect(
			entry.agents.codex.sourceMappings.find(
				(source) =>
					source.path === "event_msg/task_complete.last_agent_message",
			)?.role,
		).toBe("context");
		expect(entry.agents.codex.sources).not.toContain(
			"event_msg/task_complete.last_agent_message",
		);
		expect(catalogSources("codex")).not.toContain(
			"event_msg/task_complete.last_agent_message",
		);
		const mapping: FactMapping = {
			relation: { kind: "exact" },
			sourceMappings: [
				{
					path: "sample/.value",
					role: "primary",
					relation: { kind: "exact" },
					justification: "Value field.",
				},
				{
					path: "sample/.id",
					role: "context",
					relation: { kind: "unreviewed" },
				},
			],
			evidence: [
				{ kind: "census", path: "sample/.id", count: 5, corpus: "synthetic" },
				{
					kind: "writer_source",
					path: "sample/.id",
					file: "sample.rs",
					line: 1,
					version: "synthetic",
					supportsMeaning: true,
					explanation: "Only the identity is proved.",
				},
			],
		};
		expect(mappingConfidence(mapping)).toBe("asserted");
	});
	test("derived/provenance are N/A and unwitnessed Claude compaction remains unreviewed", () => {
		for (const entry of withMappingEvidence(FACT_CATALOG))
			for (const agent of FACT_AGENTS)
				if (
					entry.agents[agent].relation.kind === "derived" ||
					entry.agents[agent].relation.kind === "provenance"
				)
					expect(mappingConfidence(entry.agents[agent])).toBe("not_applicable");
		for (const id of ["compacted"])
			expect(
				FACT_CATALOG.find((entry) => entry.view === "runs" && entry.id === id)
					?.agents.claude_code.relation.kind,
			).toBe("unreviewed");
	});
	test("failure predicates are conflicts, not equivalent booleans", () => {
		for (const key of ["calls/is_error", "runs/failed_calls"]) {
			const entry = FACT_CATALOG.find(
				(entry) => `${entry.view}/${entry.id}` === key,
			);
			expect(entry).toBeDefined();
			if (entry === undefined) throw new Error(key);
			expect(factComparability(entry)).toBe("conflict");
		}
	});
	test("confidence and relation totals partition the catalog", () => {
		for (const agent of FACT_AGENTS) {
			const metrics = mappingMetrics(withMappingEvidence(FACT_CATALOG), agent);
			expect(metrics.relations.unreviewed).toBeGreaterThanOrEqual(0);
			expect(metrics.relations.derived).toBeGreaterThan(0);
			expect(metrics.relations.provenance).toBeGreaterThan(0);
			expect(metrics.literal + metrics.confidence.not_applicable).toBe(
				metrics.total,
			);
			expect(
				Object.values(metrics.confidence).reduce(
					(sum, total) => sum + total,
					0,
				),
			).toBe(FACT_CATALOG.length);
			expect(
				Object.values(metrics.relations).reduce((sum, total) => sum + total, 0),
			).toBe(FACT_CATALOG.length);
		}
	});

	test("published types support only their named source, not every primary source", () => {
		const mapping: FactMapping = {
			relation: { kind: "exact" },
			sourceMappings: [
				{
					path: "user.toolUseResult.stdout",
					role: "primary",
					relation: { kind: "exact" },
				},
				{
					path: "user.toolUseResult.other",
					role: "primary",
					relation: { kind: "exact" },
				},
			],
			evidence: [
				{
					kind: "census",
					path: "user.toolUseResult.stdout",
					count: 1,
					corpus: "synthetic",
				},
				{
					kind: "published_types",
					path: "user.toolUseResult.stdout",
					reference: "sdk-tools.d.ts:3259",
					version: "synthetic",
					supportsMeaning: true,
					explanation: "Only stdout is documented as standard output.",
				},
			],
		};
		expect(mappingConfidence(mapping)).toBe("observed");
	});
});
