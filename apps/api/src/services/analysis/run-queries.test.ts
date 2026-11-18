import { describe, expect, test } from "bun:test";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import { queryRunFacts } from "./run-queries.js";

/** ClickHouse answering the run facts statement with the given runs. */
function executorReturning(
	rows: Record<string, unknown>[],
): ClickHouseExecutor {
	return {
		async close() {},
		async execute() {},
		async insert() {},
		async query<T>() {
			return rows as T[];
		},
	};
}

const run = (overrides: Record<string, unknown>) => ({
	session_id: "s",
	agent_id: "",
	turn_idx: 1,
	first_record: 1,
	started_ms: "1759309200000",
	minutes: 1,
	active_minutes: 1,
	raw_chars: 10,
	genuine_prompt: 1,
	prompt_head: "find the config",
	edits: 0,
	tool_calls: 3,
	failed_calls: 1,
	read_calls: 1,
	search_calls: 2,
	not_found: 2,
	run_source: "claude_code",
	run_parser_version: 9,
	cost: null,
	unpriced_observations: 0,
	usage_model: "",
	model_costs: [],
	session_unattributed: 0,
	session_unattributed_models: [],
	...overrides,
});

describe("runs computed at query time", () => {
	test("not found is unknown where the run index cannot record it, never 0", async () => {
		const rows = await queryRunFacts(
			executorReturning([
				run({}),
				run({ agent_id: "agent-a", not_found: 0 }),
				run({ session_id: "old", run_parser_version: 5, not_found: 0 }),
				run({
					session_id: "codex",
					run_source: "codex",
					run_parser_version: 5,
				}),
			]),
			{ organizationId: "org", userId: "u" },
			[],
		);
		expect(
			rows.map((row) => [row.session_id, row.agent_id, row.not_found]),
		).toEqual([
			["s", "", 2],
			["s", "agent-a", null],
			["old", "", null],
			["codex", "", 2],
		]);
	});
});
