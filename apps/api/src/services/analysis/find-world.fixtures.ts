import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";

type Row = Record<string, unknown>;

export const DAY = Date.parse("2026-10-28T09:00:00Z");

export function run(sessionId: string, turn: number, cost: number): Row {
	return {
		session_id: sessionId,
		agent_id: "",
		turn_idx: turn,
		first_record: turn * 10,
		started_ms: DAY + turn * 60_000,
		minutes: 1,
		active_minutes: turn,
		raw_chars: 100,
		genuine_prompt: 1,
		prompt_head: `prompt ${turn}`,
		edits: 0,
		tool_calls: 0,
		failed_calls: 0,
		read_calls: 0,
		search_calls: 0,
		not_found: 0,
		run_source: "claude_code",
		run_parser_version: 12,
		cost,
		unpriced_observations: 0,
		usage_model: "model",
		model_costs: [],
		session_unattributed: 0,
		session_unattributed_models: [],
	};
}

export function session(sessionId: string): Row {
	return {
		session_id: sessionId,
		user_id: "u1",
		source: "claude_code",
		model: "model",
		repository: "web",
		session_ms: DAY,
	};
}

export function clickhouse(world: {
	sessions: Row[];
	runs: Row[];
	matching?: (params: Row) => Row[];
	links?: Row[];
	groups?: Row[] | ((params: Row) => Row[]);
	failures?: Row[];
}) {
	const statements: ClickHouseStatement[] = [];
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {},
		insert: async () => {},
		query: async <T>(statement: ClickHouseStatement) => {
			statements.push(statement);
			const sql = statement.query;
			const params = (statement.query_params ?? {}) as Row;
			const ids = (params.sessionIds as string[] | undefined) ?? [];
			let rows: Row[] = [];
			if ("filterSessions" in params) rows = world.matching?.(params) ?? [];
			else if (sql.includes("child_session_id, parent_session_id")) rows = [];
			else if (sql.includes("AS text_runs"))
				rows =
					typeof world.groups === "function"
						? world.groups(params)
						: (world.groups ?? []);
			else if (sql.includes("WITH failures AS ("))
				rows = (world.failures ?? []).filter((row) =>
					ids.includes(String(row.session_id)),
				);
			else if ("exampleSessions" in params) rows = [];
			else if (sql.includes("toString(kind) AS kind")) rows = world.links ?? [];
			else if (sql.includes("{receiptRecordIdx:UInt32}"))
				rows = ids.map((id) => ({
					session_id: id,
					revision_text: "1",
					parser_version: 12,
					source: "claude_code",
					receipt: "",
				}));
			else if (sql.includes("session_unattributed AS ("))
				rows = world.runs.filter((row) => ids.includes(String(row.session_id)));
			else if (sql.includes("{pickSessions:Array(String)}"))
				rows = world.sessions.filter((row) =>
					(params.pickSessions as string[]).includes(String(row.session_id)),
				);
			else if (sql.includes("session_date")) rows = world.sessions;
			return rows as T[];
		},
	};
	return { statements, executor };
}
