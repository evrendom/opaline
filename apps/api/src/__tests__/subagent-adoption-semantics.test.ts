import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function source(relativePath: string): Promise<string> {
	return readFile(resolve(import.meta.dir, "..", relativePath), "utf8");
}

describe("uniform successful-subagent adoption semantics", () => {
	test("session analytics and events metadata use the combined metric", async () => {
		const [sessions, events, lineage] = await Promise.all([
			source("services/session-analytics.service.ts"),
			source("services/usage-event-analytics.service.ts"),
			source("services/session-lineage-analytics.service.ts"),
		]);
		const aliasedPredicateToken =
			"${" + 'buildSessionHasSubagentsSql("sa")' + "}";
		const prefixToken = "${" + "prefix}";

		expect(lineage).toContain(
			`OR length(${prefixToken}native_child_sessions) > 0)`,
		);
		// Both summary periods count top-level sessions with the combined metric.
		expect(sessions).toContain(
			"const inPeriod = `sa.is_top_level_session = 1 AND (" +
				"${" +
				"periods[period]})`;",
		);
		expect(
			sessions.match(
				/countIf\(\$\{inPeriod\} AND \$\{buildSessionHasSubagentsSql\("sa"\)\}\)/gu,
			),
		).toHaveLength(1);
		expect(sessions).toContain(
			`used_subagents: \`if(${aliasedPredicateToken}, 1, 0)\``,
		);
		expect(events).toContain(
			"sa.linked_subagent_count AS linked_subagent_count",
		);
		expect(events).toContain("sa.linked_subagents AS linked_subagents");

		for (const implementation of [sessions, events]) {
			expect(implementation).not.toContain("subagent_count > 0");
			expect(implementation).not.toContain(
				"countIf(length(subagent_types) > 0) as subagents_sessions",
			);
		}
	});
});
