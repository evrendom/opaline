import { describe, expect, test } from "bun:test";
import decisions from "../../../../../docs/l1-judge-round3-decisions.json" with {
	type: "json",
};
import { FACT_CATALOG, factCatalogIndex } from "./fact-catalog.js";
import { ignoreRuleFor } from "./fact-census.js";
import { CENSUS_IGNORED_PATHS } from "./fact-census-ignored.js";

const catalog = factCatalogIndex();

function mappingFor(item: string) {
	const [view, id, agent] = item.split("/");
	const entry = catalog.get(`${view}.${id}`);
	if (entry === undefined) throw new Error(`Missing fact ${item}`);
	if (agent !== "claude_code" && agent !== "codex")
		throw new Error(`Invalid agent ${item}`);
	return entry.agents[agent];
}

describe("binding judge round 3", () => {
	test("every disputed ignore and agreed map is placed or explicitly pending", () => {
		expect(decisions.ignored).toHaveLength(513);
		for (const decision of decisions.ignored) {
			const separator = decision.item.indexOf(":");
			const agent = decision.item.slice(0, separator);
			const path = decision.item.slice(separator + 1);
			if (agent !== "claude_code" && agent !== "codex")
				throw new Error(`Invalid agent ${decision.item}`);
			const ignored = ignoreRuleFor(path, agent, CENSUS_IGNORED_PATHS);
			if (decision.disposition === "keep_ignore") {
				expect(ignored).toBeDefined();
				expect(decision.rule).toBe(ignored?.rule);
			} else {
				expect(ignored).toBeUndefined();
				const entry = FACT_CATALOG.find(
					(entry) => `${entry.view}/${entry.id}` === decision.fact,
				);
				if (entry === undefined)
					throw new Error(`Missing placement for ${decision.item}`);
				expect(entry.agents[agent].sources).toContain(path);
				if (decision.disposition === "pending") {
					expect(decision.sol?.verdict).toBe("unsure");
					expect(decision.sonnet?.verdict).toBe("keep_ignore");
					expect(
						entry.agents[agent].sourceMappings.find(
							(source) => source.path === path,
						)?.relation.kind,
					).toBe("unreviewed");
				}
			}
		}
	});

	test("input duplicates state truncation limits and execution secrets are never stored", () => {
		for (const decision of decisions.ignored.filter(
			(decision) => decision.ruling === "A",
		)) {
			const separator = decision.item.indexOf(":");
			const path = decision.item.slice(separator + 1);
			const agent = decision.item.startsWith("claude_code:")
				? "claude_code"
				: "codex";
			expect(ignoreRuleFor(path, agent, CENSUS_IGNORED_PATHS)?.reason).toBe(
				"contained in the stored input text unless truncated (65,536 chars / session budget)",
			);
		}
		const secret = "response_item/function_call:exec_command.arguments.env.{*}";
		expect(ignoreRuleFor(secret, "codex", CENSUS_IGNORED_PATHS)?.reason).toBe(
			"may contain secrets; never stored",
		);
		expect(
			FACT_CATALOG.some((entry) => entry.agents.codex.sources.includes(secret)),
		).toBe(false);
	});

	test("pending families have meanings and parser-9 plans; root lineage is not stream identity", () => {
		expect(decisions.newPendingFacts).toHaveLength(42);
		for (const key of decisions.newPendingFacts) {
			const entry = FACT_CATALOG.find(
				(entry) => `${entry.view}/${entry.id}` === key,
			);
			if (entry === undefined) throw new Error(`Missing pending fact ${key}`);
			expect(entry.meaning.length).toBeGreaterThan(20);
			for (const agent of ["claude_code", "codex"] as const) {
				const mapping = entry.agents[agent];
				if (mapping.status === "stored") {
					expect(mapping.stores.since).toBe(9);
					expect(
						mapping.evidence.some((item) => item.kind === "fixture_test"),
					).toBe(true);
				} else if (mapping.status === "pending")
					expect(mapping.plan).toContain("parser 9");
				else throw new Error(`Expected a parser-9 mapping for ${key}/${agent}`);
			}
		}
		const root = "token_usage_record/.session_id";
		expect(mappingFor("session/lineage_session_id/codex").sources).toContain(
			root,
		);
		expect(ignoreRuleFor(root, "codex", CENSUS_IGNORED_PATHS)).toBeUndefined();
	});

	test("ignore-rule totals are explicit and stable", () => {
		const totals: Record<string, number> = {};
		for (const item of CENSUS_IGNORED_PATHS)
			totals[item.rule] = (totals[item.rule] ?? 0) + 1;
		expect(totals).toEqual(decisions.ignoreTotals);
	});

	test("all mapping agreements and disagreements retain their adjudicated relation", () => {
		expect(decisions.mappings).toHaveLength(114);
		expect(
			decisions.mappings.filter((decision) => decision.ruling === "resolved"),
		).toHaveLength(39);
		for (const decision of decisions.mappings)
			expect(decision.relation).toBe(mappingFor(decision.item).relation.kind);
	});

	test("witnessed tool-search names and join IDs are declared sources", () => {
		const tools = mappingFor("runs/offered_tools/codex");
		expect(tools.sources).toContain(
			"response_item/tool_search_output.tools[].tools[].name",
		);
		expect(tools.sources).not.toContain(
			"response_item/tool_search_output.tools[].name",
		);
		const calls = mappingFor("calls/call_id/codex");
		for (const type of ["tool_search_call", "tool_search_output"]) {
			const path = `response_item/${type}.call_id`;
			expect(calls.sources).toContain(path);
			if (calls.status !== "stored") throw new Error("Call IDs are stored");
			expect(calls.gap?.sources ?? []).not.toContain(path);
		}
	});

	test("parser 9 keeps recorded Bash timeout options distinct from result timeouts", () => {
		const timeout = mappingFor("calls/timeout_ms/claude_code");
		if (timeout.status !== "stored") throw new Error("Monitor limit is stored");
		const path = "assistant.message.content[tool_use:Bash].input.timeout";
		expect(timeout.sources).toContain(path);
		expect(timeout.stores.since).toBe(9);
		expect(timeout.stores.facts).toContain("timeout_ms_components");
		expect(timeout.sources).toContain("user.toolUseResult.timeoutMs");
	});

	test("terminal HTTP status and SendMessage recipient use their witnessed carriers", () => {
		expect(mappingFor("runs/turn_error_http_status/codex").sources).toContain(
			"event_msg/task_complete.error.codex_error_info.http_connection_failed.http_status_code",
		);
		const activity = mappingFor("calls/subagent_activity/claude_code");
		expect(
			activity.sourceMappings.some((source) => source.path.includes(".pin.")),
		).toBe(false);
		expect(
			mappingFor("runs/communication_recipient/claude_code").sources,
		).toContain("user.toolUseResult.pin.id");
		expect(
			mappingFor("calls/subagent_thread_ids/claude_code").sources,
		).toContain("user.toolUseResult.pin.id");
		expect(FACT_CATALOG.length).toBeGreaterThan(0);
	});
});
