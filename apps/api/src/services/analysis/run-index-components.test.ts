import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { splitSessionTranscript } from "@rudel/api-routes/transcript-records";
import { MODEL_RATE_CARD_VERSION } from "../pricing.service.js";
import { buildPricedUsageEventsCte } from "../usage-event-analytics.service.js";
import {
	RUN_INDEX_PR_URL_PATTERN,
	readRunIndexComponentValues,
} from "./run-index-components.js";
import {
	buildRunIndexStatement,
	RUN_INDEX_PRICING_VERSION,
	RUN_INDEX_VERSION,
	runFactsCtes,
} from "./run-index-sql.js";

function parse(source: "codex" | "claude_code", records: unknown[]) {
	return [
		...splitSessionTranscript({
			source,
			sessionDate: "2026-10-10T00:00:00Z",
			content: records.map((record) => JSON.stringify(record)).join("\n"),
		}),
	];
}

describe("semantic run-index component projections", () => {
	test("Codex skills use explicit names and SKILL.md directory names, not ordinary reads", () => {
		const rows = parse("codex", [
			{
				type: "event_msg",
				payload: {
					type: "item_completed",
					item: {
						type: "UserMessage",
						content: [
							{
								type: "skill",
								name: "design:review",
								path: "/skills/review/SKILL.md",
							},
						],
					},
				},
			},
			{
				type: "event_msg",
				payload: {
					type: "item_completed",
					item: {
						type: "CommandExecution",
						id: "read",
						status: "completed",
						command: "cat /skills/testing/SKILL.md",
						parsed_cmd: [
							{ type: "read", path: "/skills/testing/SKILL.md" },
							{ type: "read", path: "/src/ordinary.ts" },
							{ type: "search", path: "/skills/not-read/SKILL.md" },
						],
					},
				},
			},
		]);
		const skills = rows.flatMap(
			(row) => readRunIndexComponentValues(row.facts.extra).skills,
		);
		expect([...new Set(skills)].sort()).toEqual(["design:review", "testing"]);
		const sql = runFactsCtes({ literal: true });
		expect(sql).toContain("facts['skill_components'] AS f_skill_components");
		expect(sql).toContain("JSONExtractArrayRaw(f_skill_components)");
		expect(sql).toContain("CAST(attribution_skill, 'String')");
		expect(sql).toContain("f_skill");
	});

	test("delegations project only agent_type, not requested model or effort", () => {
		const rows = parse("codex", [
			{
				type: "response_item",
				payload: {
					type: "function_call",
					name: "spawn_agent",
					call_id: "spawn",
					arguments: JSON.stringify({
						agent_type: "explorer",
						model: "gpt-5",
						reasoning_effort: "high",
					}),
				},
			},
		]);
		expect(
			rows.flatMap(
				(row) => readRunIndexComponentValues(row.facts.extra).subagentTypes,
			),
		).toEqual(["explorer"]);
		const statement = buildRunIndexStatement(
			{ organizationId: "org", userId: "user" },
			{
				sessionId: "session",
				revision: "1",
				parserVersion: 9,
				usageGeneration: "1",
			},
		);
		expect(statement.query).toContain("facts['subagent_type_components']");
		expect(statement.query).toContain("[.]arguments[.]agent_type$");
		expect(statement.query).toContain("facts['fork_replayed'] != 'true'");
	});

	test("terminal provider errors keep HTTP status units and exclude policy or other errors", () => {
		for (const [info, expected] of [
			["server_overloaded", "server_overloaded"],
			["usage_limit_exceeded", "usage_limit_exceeded"],
			[
				{ http_connection_failed: { http_status_code: 429 } },
				"http_connection_failed",
			],
			["cyber_policy", ""],
			["misalignment_policy_violation", ""],
			["other", ""],
		] as const) {
			const rows = parse("codex", [
				{
					type: "event_msg",
					payload: {
						type: "task_complete",
						error: { codex_error_info: info, message: "terminal error" },
					},
				},
			]);
			const projected = readRunIndexComponentValues(rows[0]?.facts.extra ?? {});
			expect(projected.apiError).toBe(expected);
			expect(projected.apiErrorStatuses).toEqual(
				typeof info === "object" ? ["429"] : [],
			);
		}
		const sql = runFactsCtes({ literal: true });
		expect(sql).toContain("facts['api_errors_components']");
		expect(sql).toContain("provider_error_kind");
		expect(sql).toContain("^[1-5][0-9]{2}$");
		expect(sql).not.toContain("'cyber_policy'");
	});

	test("Claude interruption components give the literal abort reason", () => {
		const rows = parse("claude_code", [
			{ type: "user", message: { content: "[Request interrupted by user]" } },
		]);
		expect(
			readRunIndexComponentValues(rows[0]?.facts.extra ?? {}).abortReason,
		).toBe("[Request interrupted by user]");
		expect(runFactsCtes({ literal: true })).toContain("AS l_abort_reason");
	});

	test("PR URLs read full pinned result text, not just heads or unpinned git observations", () => {
		const pattern = new RegExp(RUN_INDEX_PR_URL_PATTERN, "gu");
		const text = `${"output ".repeat(100)}https://github.com/owner/repo/pull/42\nhttps://github.com/owner/repo/pull/42abc`;
		expect(text.match(pattern)).toEqual([
			"https://github.com/owner/repo/pull/42",
		]);
		const sql = runFactsCtes({ literal: true });
		expect(sql).toContain("kind = 'tool_result', extractAll(text,");
		expect(sql).toContain("arrayFlatten(groupArray(result_pr_urls))");
		expect(sql).not.toContain("session_git_observations");
	});

	test("index 9 (each session's context snapshot after its build; 8 a Codex run's directory from its turn and workdir; 7 runs end at their last activity record, 6 is received setup, OPL-391, 5 requests, 4 the measure facts) with a SQL-and-gates fingerprint", () => {
		const pricingOnly = `${MODEL_RATE_CARD_VERSION}+${createHash("sha256").update(buildPricedUsageEventsCte("")).digest("hex").slice(0, 12)}`;
		expect(RUN_INDEX_VERSION).toBe(9);
		expect(RUN_INDEX_PRICING_VERSION).toMatch(/\+[a-f0-9]{12}$/u);
		expect(RUN_INDEX_PRICING_VERSION).not.toBe(pricingOnly);
	});
});
