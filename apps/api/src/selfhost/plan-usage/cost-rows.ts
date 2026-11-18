import type { ClickHouseExecutor } from "../../clickhouse.js";
import { repositorySql } from "../../services/repository-key-sql.js";
import { buildPricedUsageEventsCte } from "../../services/usage-event-analytics.service.js";
import type { PlanProvider } from "./readings.js";
import type { CostRow } from "./window-series.js";

const SOURCES: Readonly<Record<PlanProvider, string>> = {
	claude: "claude_code",
	codex: "codex",
};

export async function readCostRows(
	clickhouse: Pick<ClickHouseExecutor, "query">,
	provider: PlanProvider,
	from: number,
	to: number,
): Promise<CostRow[]> {
	const rows = await clickhouse.query<{
		sessionId: string;
		agentId: string;
		at: string;
		model: string;
		cost: number;
	}>({
		query: `WITH ${buildPricedUsageEventsCte(
			"e.source = {source:String} AND e.occurred_at >= fromUnixTimestamp64Milli({from:Int64}) AND e.occurred_at < fromUnixTimestamp64Milli({to:Int64})",
		)}
			SELECT session_id AS sessionId,
				if(agent_id IN ('', 'main'), '', agent_id) AS agentId,
				toString(toUnixTimestamp(toStartOfFiveMinutes(occurred_at)) * 1000) AS at,
				toString(pricing_model) AS model,
				sum(ifNull(estimated_cost, 0)) AS cost
			FROM analysis_priced_events
			GROUP BY sessionId, agentId, at, model
			HAVING cost > 0
			ORDER BY at`,
		query_params: { source: SOURCES[provider], from, to },
		format: "JSONEachRow",
	});
	return rows.map((row) => ({
		sessionId: row.sessionId,
		agentId: row.agentId || undefined,
		at: Number(row.at),
		model: row.model,
		cost: Number(row.cost),
	}));
}

export interface LimitHit {
	readonly id: string;
	readonly provider: PlanProvider;
	readonly at: string;
}

export async function readLimitHits(
	clickhouse: Pick<ClickHouseExecutor, "query">,
	from: number,
	to: number,
): Promise<LimitHit[]> {
	const rows = await clickhouse.query<{
		sessionId: string;
		agentId: string;
		source: string;
		at: string;
	}>({
		query: `SELECT session_id AS sessionId, agent_id AS agentId, toString(source) AS source,
				formatDateTime(max(ifNull(ended_at, started_at)), '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS at
			FROM rudel.run_index
			WHERE rate_limited = 1
				AND started_at < fromUnixTimestamp64Milli({to:Int64})
				AND ifNull(ended_at, started_at) >= fromUnixTimestamp64Milli({from:Int64})
			GROUP BY sessionId, agentId, source`,
		query_params: { from, to },
		format: "JSONEachRow",
	});
	return rows.flatMap((row) => {
		const provider = (Object.keys(SOURCES) as PlanProvider[]).find(
			(key) => SOURCES[key] === row.source,
		);
		return provider
			? [
					{
						id: row.agentId ? `${row.sessionId}:${row.agentId}` : row.sessionId,
						provider,
						at: row.at,
					},
				]
			: [];
	});
}

export async function readSessionTitles(
	clickhouse: Pick<ClickHouseExecutor, "query">,
	sessionIds: readonly string[],
): Promise<Record<string, string>> {
	if (sessionIds.length === 0) return {};
	const rows = await clickhouse.query<{ sessionId: string; name: string }>({
		query: `SELECT session_id AS sessionId, argMax(title, started_at) AS name
			FROM rudel.run_index
			WHERE session_id IN {sessionIds:Array(String)} AND title IS NOT NULL AND title != ''
			GROUP BY session_id`,
		query_params: { sessionIds: [...sessionIds] },
		format: "JSONEachRow",
	});
	return Object.fromEntries(rows.map((row) => [row.sessionId, row.name]));
}

export async function readSessionRepositories(
	clickhouse: Pick<ClickHouseExecutor, "query">,
	sessionIds: readonly string[],
): Promise<Map<string, string>> {
	if (sessionIds.length === 0) return new Map();
	const rows = await clickhouse.query<{
		sessionId: string;
		repository: string;
	}>({
		query: `SELECT session_id AS sessionId, any(${repositorySql("s")}) AS repository
			FROM rudel.session_analytics AS s
			WHERE session_id IN {sessionIds:Array(String)}
			GROUP BY session_id`,
		query_params: { sessionIds: [...sessionIds] },
		format: "JSONEachRow",
	});
	return new Map(rows.map((row) => [row.sessionId, row.repository]));
}
