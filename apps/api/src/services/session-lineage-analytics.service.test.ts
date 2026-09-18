import { describe, expect, test } from "bun:test";
import {
	buildLineageEnrichedMetadataCte,
	buildSessionHasSubagentsSql,
	buildSessionLineageCteDefinitions,
	SESSION_HAS_SUBAGENTS_SQL,
} from "./session-lineage-analytics.service.js";

describe("session-lineage analytics selector", () => {
	test("pins countable edges to the current derivation and tenant prefix", () => {
		const sql = buildSessionLineageCteDefinitions(true);

		expect(sql).toContain("FROM rudel.session_lineage");
		expect(sql).toContain("WHERE organization_id = {orgId:String}");
		expect(sql).toContain("AND derivation_version = 1");
		expect(sql).toContain("outcome = 'successful'");
		expect(sql).toContain(
			"confidence IN ('id_echo', 'prompt_echo', 'attested_temporal')",
		);
		expect(sql).not.toContain("FINAL");
	});

	test("keeps explicit native lineage while heuristic consumers are off", () => {
		const sql = buildSessionLineageCteDefinitions(false);

		expect(sql).toContain("rudel.session_lineage");
		expect(sql).toContain("confidence = 'native_parent_id'");
		expect(sql).toContain("0 AND");
	});

	test("adds typed children to metadata and exposes one combined predicate", () => {
		const sql = buildLineageEnrichedMetadataCte({
			baseRelation: "metadata_base",
			outputRelation: "metadata",
		});

		expect(sql).toContain("ifNull(lineage.linked_subagent_count, 0)");
		expect(sql).toContain("lineage.linked_subagents");
		expect(sql).toContain("sa.* EXCEPT (organization_id, user_id)");
		expect(SESSION_HAS_SUBAGENTS_SQL).toBe(
			"((subagent_count + linked_subagent_count) > 0 OR length(native_child_sessions) > 0)",
		);
		expect(buildSessionHasSubagentsSql("sa")).toBe(
			"((sa.subagent_count + sa.linked_subagent_count) > 0 OR length(sa.native_child_sessions) > 0)",
		);
	});
});
