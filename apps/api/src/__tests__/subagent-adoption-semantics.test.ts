import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function source(relativePath: string): Promise<string> {
	return readFile(resolve(import.meta.dir, "..", relativePath), "utf8");
}

describe("uniform successful-subagent adoption semantics", () => {
	test("all six legacy sites and events metadata use the combined metric", async () => {
		const [sessions, developers, projects, events, lineage] = await Promise.all(
			[
				source("services/session-analytics.service.ts"),
				source("services/developer.service.ts"),
				source("services/project.service.ts"),
				source("services/usage-event-analytics.service.ts"),
				source("services/session-lineage-analytics.service.ts"),
			],
		);
		const predicateToken = "${" + "SESSION_HAS_SUBAGENTS_SQL}";

		expect(lineage).toContain('"(subagent_count + linked_subagent_count) > 0"');
		expect(
			sessions.match(/countIf\(\$\{SESSION_HAS_SUBAGENTS_SQL\}\)/gu),
		).toHaveLength(2);
		expect(sessions).toContain(
			`used_subagents: \`if(${predicateToken}, 1, 0)\``,
		);
		expect(developers).toContain(`${predicateToken} as has_subagents`);
		expect(developers).toContain(
			`countIf(${predicateToken}) as subagents_sessions`,
		);
		expect(projects).toContain(
			`countIf(${predicateToken}) as subagents_sessions`,
		);
		expect(events).toContain(
			"sa.linked_subagent_count AS linked_subagent_count",
		);
		expect(events).toContain("sa.linked_subagents AS linked_subagents");

		for (const implementation of [sessions, developers, projects, events]) {
			expect(implementation).not.toContain("subagent_count > 0");
			expect(implementation).not.toContain(
				"countIf(length(subagent_types) > 0) as subagents_sessions",
			);
		}
	});
});
