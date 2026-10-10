import { describe, expect, test } from "bun:test";
import { strict as assert } from "node:assert";
import round3 from "../../../../../docs/l1-judge-round3-decisions.json" with {
	type: "json",
};
import absence from "./codex-absence-0.162.0.json" with { type: "json" };
import legacySnapshot from "./codex-legacy-paths.json" with { type: "json" };
import { CODEX_RESIDUE_REVIEW } from "./codex-residue-review.js";
import { FACT_CATALOG } from "./fact-catalog.js";
import { compareVersions, ignoreRuleFor, pathMatches } from "./fact-census.js";
import { CENSUS_IGNORED_PATHS } from "./fact-census-ignored.js";
import { mappingConfidence, withMappingEvidence } from "./fact-mapping.js";
import censusSnapshot from "./fact-mapping-census.json" with { type: "json" };
import {
	CODEX_LOCAL_SOURCE_NOTES,
	CODEX_SOURCE_SNAPSHOT,
	type OracleSnapshot,
	sourceCensusCoverage,
	sourceOracleCoverage,
	sourcePathMatch,
	sourceSnapshotDiff,
} from "./fact-source-coverage.js";

describe("Codex writer-source coverage", () => {
	test("every reviewed not_found mapping has a bounded writer/snapshot audit; only explicit exclusions upgrade", () => {
		expect(absence.version).toBe(CODEX_SOURCE_SNAPSHOT.version);
		expect(absence.decisions.length).toBe(35);
		expect(
			absence.decisions
				.filter((row) => row.decision === "not_emitted")
				.map((row) => row.fact),
		).toEqual(["runs/compact_trigger", "prompts/queue_operation"]);
		for (const row of absence.decisions) {
			const entry = FACT_CATALOG.find(
				(entry) => `${entry.view}/${entry.id}` === row.fact,
			);
			assert(entry);
			expect(row.decision).toBe(entry.agents.codex.relation.kind);
			expect(row.writer.length).toBeGreaterThan(0);
			expect(
				row.writer.every(
					(reference) =>
						reference.line > 0 && reference.file.startsWith("codex-rs/"),
				),
			).toBe(true);
			expect(row.writerSearch.references.length).toBeLessThanOrEqual(
				row.writerSearch.limit,
			);
			if (row.decision === "not_emitted")
				expect(
					entry?.agents.codex.evidence.some(
						(item) => item.kind === "writer_source" && item.supportsMeaning,
					),
				).toBe(true);
		}
		for (const entry of FACT_CATALOG)
			if (entry.agents.codex.relation.kind === "not_found")
				expect(
					absence.decisions.some(
						(row) => row.fact === `${entry.view}/${entry.id}`,
					) ||
						round3.mappings.some(
							(row) =>
								row.item === `${entry.view}/${entry.id}/codex` &&
								row.relation === "not_found" &&
								row.justification.includes("complete current corpus"),
						),
				).toBe(true);
	});
	test("every catalog source is declared, open JSON, witnessed legacy, or an explicitly witnessed local exception", () => {
		const coverage = sourceOracleCoverage();
		expect(coverage.missingSources).toEqual([]);
		expect(coverage.legacySources).toBeGreaterThan(0);
		expect(coverage.localSourceNotes).toHaveLength(12);
		for (const note of CODEX_LOCAL_SOURCE_NOTES) {
			expect(note.reason.length).toBeGreaterThan(30);
			expect(
				Object.entries(censusSnapshot.paths.codex).some(
					([path, count]) => pathMatches(note.path, path) && count > 0,
				),
			).toBe(true);
			expect(sourcePathMatch(note.path)).toBeUndefined();
		}
		for (const entry of FACT_CATALOG) {
			const fact = entry.agents.codex;
			for (const pattern of fact.legacySources ?? []) {
				expect(sourcePathMatch(pattern)).toBeUndefined();
				expect(
					fact.sources.concat(
						fact.status === "stored" ? (fact.gap?.sources ?? []) : [],
					),
				).toContain(pattern);
				const witnesses = legacySnapshot.paths.filter((path) =>
					pathMatches(pattern, path.path),
				);
				expect(witnesses.length).toBeGreaterThan(0);
				for (const witness of witnesses) {
					expect(witness.count).toBeGreaterThan(0);
					expect(witness.versions.length).toBeGreaterThan(0);
					expect(
						witness.versions.every(
							(version) =>
								version !== "unknown" &&
								version !== "?" &&
								(compareVersions(
									version.split("-")[0] ?? version,
									CODEX_SOURCE_SNAPSHOT.version,
								) < 0 ||
									version.startsWith(`${CODEX_SOURCE_SNAPSHOT.version}-`)),
						),
					).toBe(true);
				}
			}
		}
	});
	test("writer paths partition into primary, ignored, context, pending and unassigned", () => {
		const coverage = sourceOracleCoverage();
		expect(coverage.total).toBe(2087);
		expect(
			coverage.mapped +
				coverage.ignored +
				coverage.context.length +
				coverage.pending.length +
				coverage.residue.length,
		).toBe(coverage.total);
		expect(coverage.residue).toEqual([]);
		expect(coverage.pending.length).toBe(0);
		expect(coverage.context.length).toBeGreaterThan(0);
		expect(new Set(coverage.residue.map((path) => path.path)).size).toBe(
			coverage.residue.length,
		);
		expect(
			coverage.residue.every(
				(path) => path.source.length > 0 && path.status === "residue",
			),
		).toBe(true);
	});
	test("all 305 original residue decisions are traceable without pretending pending review is mapping", () => {
		expect(CODEX_RESIDUE_REVIEW.agreements.length).toBe(305);
		expect(CODEX_RESIDUE_REVIEW.pending.length).toBe(0);
		expect(
			new Set(
				[
					...CODEX_RESIDUE_REVIEW.agreements,
					...CODEX_RESIDUE_REVIEW.pending,
				].map((review) => review.reviewedPath),
			).size,
		).toBe(305);
		for (const review of CODEX_RESIDUE_REVIEW.agreements) {
			if (review.decision === "ignore") {
				const superseding = round3.ignored.find(
					(decision) =>
						decision.item === `codex:${review.path}` &&
						(decision.disposition === "map" ||
							decision.disposition === "pending"),
				);
				expect(
					ignoreRuleFor(review.path, "codex", CENSUS_IGNORED_PATHS) !==
						undefined || superseding !== undefined,
				).toBe(true);
				if (superseding !== undefined) {
					const entry = FACT_CATALOG.find(
						(entry) => `${entry.view}/${entry.id}` === superseding.fact,
					);
					assert(entry);
					expect(entry.agents.codex.sources).toContain(review.path);
				}
			} else {
				const entry = FACT_CATALOG.find((entry) =>
					review.decision === "map_existing"
						? `${entry.view}/${entry.id}` === review.fact
						: entry.id === review.fact,
				);
				expect(entry).toBeDefined();
				if (entry === undefined)
					throw new Error(`Missing residue fact ${review.fact}`);
				expect(
					entry.agents.codex.sourceMappings.some(
						(source) => source.path === review.path,
					),
				).toBe(true);
				if (review.decision === "new_fact")
					expect(["pending", "stored"]).toContain(entry.agents.codex.status);
			}
		}
		const coverage = sourceOracleCoverage();
		for (const review of coverage.pendingReview) {
			expect(review.status).toBe("pending");
			expect(review.sol.length).toBeGreaterThan(0);
			expect(review.sonnet.length).toBeGreaterThan(0);
		}
		for (const path of coverage.pending)
			expect(
				coverage.residue.some((residue) => residue.path === path.path),
			).toBe(false);
	});
	test("census coverage does not confuse decoded tool arguments with writer declarations", () => {
		const coverage = sourceCensusCoverage(censusSnapshot.paths.codex);
		expect(
			coverage.declared +
				coverage.opaque +
				coverage.tool_defined +
				coverage.legacy +
				coverage.unknown,
		).toBe(coverage.total);
		expect(coverage.unknownPaths).toEqual([]);
		expect(coverage.legacy).toBeGreaterThan(0);
		expect(coverage.tool_defined).toBeGreaterThan(0);
		const open = sourcePathMatch(
			"event_msg/item_completed:McpToolCall.result.structuredContent.untyped_child",
		);
		expect(open?.kind).toBe("opaque");
		expect(
			sourcePathMatch("event_msg/task_complete.invented_child"),
		).toBeUndefined();
	});
	test("structural writer evidence cannot silently verify unreviewed mappings", () => {
		const enriched = withMappingEvidence(FACT_CATALOG);
		for (const entry of enriched) {
			const fact = entry.agents.codex;
			if (fact.relation.kind === "unreviewed") {
				expect(mappingConfidence(fact)).not.toBe("verified");
				expect(
					fact.evidence.some(
						(evidence) =>
							evidence.kind === "writer_source" && evidence.supportsMeaning,
					),
				).toBe(false);
			}
		}
		for (const entry of FACT_CATALOG) {
			for (const evidence of entry.agents.codex.evidence) {
				expect(["writer_source", "llm_audit", "fixture_test"]).toContain(
					evidence.kind,
				);
				if (evidence.kind === "writer_source") {
					expect(evidence.version).toBe(CODEX_SOURCE_SNAPSHOT.version);
					expect(evidence.supportsMeaning).toBe(true);
					expect(evidence.explanation.length).toBeGreaterThan(30);
					expect(entry.agents.codex.justification).toBeDefined();
				}
			}
		}
	});
	test("removing any stored wildcard dependency fails the upgrade gate; additions only report", () => {
		const previous = CODEX_SOURCE_SNAPSHOT;
		const removed = "event_msg/item_completed:CommandExecution.duration.secs";
		expect(previous.paths.some((path) => path.path === removed)).toBe(true);
		const next: OracleSnapshot = {
			...previous,
			version: "0.163.0",
			paths: previous.paths.filter((path) => path.path !== removed),
		};
		const diff = sourceSnapshotDiff(previous, next);
		expect(diff.removed).toEqual([removed]);
		expect(diff.removedStoredDependencies).toContainEqual({
			key: "calls/duration_ms",
			source: "event_msg/item_completed:CommandExecution.duration.*",
			removed,
		});
		const addition = {
			path: "event_msg/task_complete.new_field",
			type: "bool",
			source: "protocol/src/protocol.rs:1",
			modes: "Legacy|Paginated",
			policy: 0,
		};
		const added = sourceSnapshotDiff(previous, {
			...previous,
			paths: [...previous.paths, addition],
		});
		expect(added.added).toEqual([addition.path]);
		expect(added.removedStoredDependencies).toEqual([]);
	});
});
