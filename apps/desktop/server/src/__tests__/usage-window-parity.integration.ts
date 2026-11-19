import {
	afterAll,
	beforeAll,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import { CostDashboardInputSchema } from "@rudel/api-routes";
import {
	ingestRudelSessionAnalytics,
	ingestRudelSessionLineage,
	ingestRudelUsageEvents,
	type RudelSessionAnalyticsRow,
	type RudelUsageEventsRow,
} from "@rudel/ch-schema/generated";
import {
	buildDateFilter,
	buildInclusiveDateRangeFilter,
	createClickHouseExecutor,
} from "../clickhouse.js";
import { getCostDashboard } from "../services/cost-dashboard.service.js";
import {
	getSessionAnalytics,
	getSessionAnalyticsSummaryComparison,
} from "../services/session-analytics.service.js";
import { getLastSessionUpload } from "../services/session-last-upload.service.js";
import { NATIVE_PARENT_EDGE_SQL } from "../services/session-lineage-analytics.service.js";
import { buildNativeSessionLineageRow } from "../services/session-lineage-persistence.service.js";
import { getSessionFilterCatalog } from "../services/session-list-filters.js";
import {
	buildSessionAnalyticsWindowSql,
	buildUsageEventAnalyticsCte,
} from "../services/usage-event-analytics.service.js";

/**
 * The session list, filter catalog, summary and last-upload reads price only
 * the sessions of their date range and those sessions' native descendants.
 * These tests hold them to the organization-wide query shape they replaced:
 * the same rows, costs and counts, with descendants and usage dated outside
 * the range.
 */

setDefaultTimeout(60_000);

const runId = crypto.randomUUID();
const organizationId = `usage_window_org_${runId}`;
const fallbackOrganizationId = `usage_window_fallback_org_${runId}`;
const userId = `usage_window_user_${runId}`;
const otherUserId = `usage_window_other_user_${runId}`;
const id = (role: string) => `usage_window_${role}_${runId}`;
const DAY_MS = 86_400_000;
// 06:00 UTC two days ago: inside every relative window the tests read.
const windowDay = Math.floor((Date.now() - 2 * DAY_MS) / DAY_MS) * DAY_MS;
const at = (offsetMs: number) =>
	new Date(windowDay + 6 * 3_600_000 + offsetMs)
		.toISOString()
		.replace("T", " ")
		.replace("Z", "");
const dayOf = (offsetMs: number) => at(offsetMs).slice(0, 10);
const windowDate = dayOf(0);

interface SessionSeed {
	readonly id: string;
	readonly offsetMs: number;
	readonly source: "claude_code" | "codex";
	readonly user?: string;
	/** Usage dates of its events; none means no usage at all. */
	readonly usageOffsetsMs: readonly number[];
	readonly completeReceipt?: boolean;
}

const sessions: readonly SessionSeed[] = [
	// A Codex family whose descendants started outside the window.
	{ id: id("parent"), offsetMs: 0, source: "codex", usageOffsetsMs: [0] },
	{
		id: id("child"),
		offsetMs: -8 * DAY_MS,
		source: "codex",
		usageOffsetsMs: [-8 * DAY_MS],
	},
	{
		id: id("grandchild"),
		offsetMs: -40 * DAY_MS,
		source: "codex",
		usageOffsetsMs: [-40 * DAY_MS, -39 * DAY_MS],
	},
	// A family whose later child has incomplete usage: its cost is unknown.
	{
		id: id("q_parent"),
		offsetMs: 60_000,
		source: "codex",
		usageOffsetsMs: [0],
	},
	{
		id: id("q_child"),
		offsetMs: DAY_MS,
		source: "codex",
		usageOffsetsMs: [DAY_MS],
		completeReceipt: false,
	},
	// Usage on three dates, only one of them in the window.
	{
		id: id("multi_day"),
		offsetMs: 120_000,
		source: "claude_code",
		usageOffsetsMs: [-DAY_MS, 0, DAY_MS],
	},
	{
		id: id("other_user"),
		offsetMs: 180_000,
		source: "claude_code",
		user: otherUserId,
		usageOffsetsMs: [0],
	},
	// In the window without complete usage: not listed.
	{
		id: id("incomplete"),
		offsetMs: 240_000,
		source: "claude_code",
		usageOffsetsMs: [0],
		completeReceipt: false,
	},
	// Outside the window: priced before, never read now.
	{
		id: id("outside"),
		offsetMs: -8 * DAY_MS,
		source: "claude_code",
		usageOffsetsMs: [-8 * DAY_MS],
	},
	// The newest session, without complete usage: the bar skips it.
	{
		id: id("newest_incomplete"),
		offsetMs: DAY_MS + 3_600_000,
		source: "claude_code",
		usageOffsetsMs: [DAY_MS],
		completeReceipt: false,
	},
];
const edges = [
	[id("parent"), id("child")],
	[id("child"), id("grandchild")],
	[id("q_parent"), id("q_child")],
] as const;

const executor = createClickHouseExecutor({
	database: "default",
	password: process.env.CLICKHOUSE_PASSWORD || "",
	url: process.env.CLICKHOUSE_URL || "http://localhost:8123",
	username:
		process.env.CLICKHOUSE_USERNAME || process.env.CLICKHOUSE_USER || "default",
});
const previousMode = process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE;

beforeAll(async () => {
	process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE = "all";
	await ingestRudelSessionAnalytics(
		executor,
		[
			...sessions.map((seed) =>
				sessionRow(organizationId, seed.id, seed.source, at(seed.offsetMs), {
					user_id: seed.user ?? userId,
				}),
			),
			// The fallback workspace: its 21 newest sessions have no usage.
			...Array.from({ length: 21 }, (_, index) =>
				sessionRow(
					fallbackOrganizationId,
					id(`unpriced_${index}`),
					"claude_code",
					at(index * 60_000),
				),
			),
			sessionRow(
				fallbackOrganizationId,
				id("priced_older"),
				"claude_code",
				at(-3 * DAY_MS),
			),
		],
		{ validate: true },
	);
	await ingestRudelUsageEvents(
		executor,
		[
			...sessions.flatMap((seed) =>
				usageRows(
					organizationId,
					seed.user ?? userId,
					seed.id,
					seed.source,
					seed.usageOffsetsMs,
					seed.completeReceipt ?? true,
				),
			),
			...usageRows(
				fallbackOrganizationId,
				userId,
				id("priced_older"),
				"claude_code",
				[-3 * DAY_MS],
				true,
			),
		],
		{ validate: true },
	);
	await ingestRudelSessionLineage(
		executor,
		edges.map(([parentSessionId, childSessionId], index) => {
			const child = sessions.find((seed) => seed.id === childSessionId);
			const parent = sessions.find((seed) => seed.id === parentSessionId);
			return buildNativeSessionLineageRow({
				childIngestedAt: new Date(`${at(child?.offsetMs ?? 0)}Z`),
				childModel: "gpt-5.6-sol",
				childSessionDate: new Date(`${at(child?.offsetMs ?? 0)}Z`),
				childSessionId,
				countable: true,
				derivedAt: new Date(windowDay + DAY_MS + index * 1_000),
				evidenceAt: new Date(`${at(child?.offsetMs ?? 0)}Z`),
				organizationId,
				parentSessionDate: new Date(`${at(parent?.offsetMs ?? 0)}Z`),
				parentSessionId,
				userId,
			});
		}),
		{ validate: true },
	);
});

afterAll(async () => {
	if (previousMode === undefined)
		delete process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE;
	else process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE = previousMode;
	for (const table of ["session_lineage", "usage_events", "session_analytics"])
		await executor
			.execute({
				query: `DELETE FROM rudel.${table} WHERE organization_id IN ({orgId:String}, {fallbackOrgId:String}) SETTINGS lightweight_deletes_sync = 3`,
				query_params: {
					fallbackOrgId: fallbackOrganizationId,
					orgId: organizationId,
				},
			})
			.catch(() => {});
	await executor.close();
});

describe("usage window pushdown", () => {
	test("leaves every windowed session's usage row unchanged, descendants included", async () => {
		const dateFilter = buildInclusiveDateRangeFilter(
			"startDate",
			"endDate",
			"sa.session_date",
		);
		const read = (cteDefinitions: string) =>
			executor.query<Record<string, unknown>>({
				query: `WITH RECURSIVE ${cteDefinitions}
					SELECT * FROM usage_analytics_sessions
					WHERE session_id IN {sessionIds:Array(String)}
					ORDER BY session_id`,
				query_params: {
					endDate: windowDate,
					orgId: organizationId,
					sessionIds: sessions.map((seed) => seed.id),
					startDate: windowDate,
				},
			});
		const whole = await read(buildUsageEventAnalyticsCte({}, false));
		const windowed = await read(
			buildUsageEventAnalyticsCte(
				{
					window: {
						includeNativeDescendants: true,
						sessionsSql: buildSessionAnalyticsWindowSql(dateFilter),
					},
				},
				false,
			),
		);
		const readSessions = (rows: Record<string, unknown>[]) =>
			rows.map((row) => row.session_id);
		expect(readSessions(windowed)).toContain(id("grandchild"));
		expect(readSessions(windowed)).not.toContain(id("outside"));
		expect(windowed).toEqual(
			whole.filter((row) => row.session_id !== id("outside")),
		);
	});

	test("lists the same sessions, costs and family costs as the organization-wide query", async () => {
		const range = { end_date: windowDate, start_date: windowDate };
		const expected = await readReferenceList(
			buildInclusiveDateRangeFilter("startDate", "endDate", "sa.session_date"),
			{ endDate: windowDate, startDate: windowDate },
		);
		expect(expected.map((row) => row.session_id).sort()).toEqual(
			[id("parent"), id("q_parent"), id("multi_day"), id("other_user")].sort(),
		);
		const familyCost = expected.find(
			(row) => row.session_id === id("parent"),
		)?.estimated_cost;
		expect(familyCost).toBeGreaterThan(0);
		expect(
			expected.find((row) => row.session_id === id("q_parent"))?.estimated_cost,
		).toBeNull();

		const rows = await getSessionAnalytics(organizationId, {
			...range,
			limit: 50,
		});
		expectSameRows(rows, expected);

		const relative = await getSessionAnalytics(organizationId, {
			days: 30,
			limit: 50,
		});
		expectSameRows(
			relative,
			await readReferenceList(buildDateFilter("days", "sa.session_date"), {
				days: 30,
			}),
		);

		const catalog = await getSessionFilterCatalog(organizationId, range);
		const costs = expected
			.map((row) => row.estimated_cost)
			.filter((cost): cost is number => cost !== null);
		expect(catalog.sessionCount).toBe(expected.length);
		expect(catalog.ranges.cost.minimum).toBeLessThanOrEqual(Math.min(...costs));
		expect(catalog.ranges.cost.minimum).toBeGreaterThan(
			Math.min(...costs) - catalog.ranges.cost.step,
		);
		expect(catalog.ranges.cost.maximum).toBeGreaterThanOrEqual(
			Math.max(...costs),
		);
		expect(catalog.ranges.cost.maximum).toBeLessThan(
			Math.max(...costs) + catalog.ranges.cost.step,
		);
	});

	test("computes both summary periods in one query, as the two period queries did", async () => {
		const [reference] = await executor.query<{
			current_sessions: number;
			current_duration: number;
			previous_sessions: number;
			previous_duration: number;
		}>({
			query: `WITH ${buildUsageEventAnalyticsCte({}, false)}
				SELECT
					countIf(is_top_level_session = 1 AND ${buildDateFilter("currentDays")}) AS current_sessions,
					avgIf(actual_duration_min, is_top_level_session = 1 AND ${buildDateFilter("currentDays")}) AS current_duration,
					countIf(is_top_level_session = 1 AND session_date >= now64(3) - toIntervalDay({previousDays:UInt32}) AND session_date < now64(3) - toIntervalDay({currentDays:UInt32})) AS previous_sessions,
					avgIf(actual_duration_min, is_top_level_session = 1 AND session_date >= now64(3) - toIntervalDay({previousDays:UInt32}) AND session_date < now64(3) - toIntervalDay({currentDays:UInt32})) AS previous_duration
				FROM usage_analytics_sessions
				WHERE organization_id = {orgId:String}`,
			query_params: { currentDays: 7, orgId: organizationId, previousDays: 14 },
		});
		const summary = await getSessionAnalyticsSummaryComparison(organizationId, {
			days: 7,
		});
		// parent, q_parent, multi_day, other_user now; outside the week before.
		expect(reference?.current_sessions).toBe(4);
		expect(reference?.previous_sessions).toBe(1);
		expect(summary.current.total_sessions).toBe(4);
		expect(summary.previous.total_sessions).toBe(1);
		expect(summary.current.avg_session_duration_min).toBeCloseTo(
			reference?.current_duration ?? 0,
			2,
		);
		expect(summary.previous.avg_session_duration_min).toBeCloseTo(
			reference?.previous_duration ?? 0,
			2,
		);
	});

	test("finds the first session the year's list shows, past newer sessions without usage", async () => {
		const [first] = await readReferenceList(
			buildDateFilter("days", "sa.session_date"),
			{ days: 365 },
			"ORDER BY sa.session_date DESC, sa.source ASC, sa.session_id ASC LIMIT 1",
		);
		expect(first?.session_id).toBe(id("other_user"));
		expect(await getLastSessionUpload(organizationId)).toEqual({
			duration_min: first?.duration_min ?? -1,
			session_date: first?.session_date ?? "",
			session_id: id("other_user"),
		});
		expect(await getLastSessionUpload(fallbackOrganizationId)).toMatchObject({
			session_id: id("priced_older"),
		});
		expect(await getLastSessionUpload(`${organizationId}_empty`)).toBeNull();
	});
});

interface ReferenceRow {
	cost_uses_default_region: boolean;
	duration_min: number;
	estimated_cost: number | null;
	input_tokens: number;
	model_used: string;
	output_tokens: number;
	session_date: string;
	session_id: string;
	total_tokens: number;
	user_id: string;
}

/** The session list's rows from the organization-wide shape this replaced. */
async function readReferenceList(
	dateFilter: string,
	params: Record<string, unknown>,
	tail = "ORDER BY sa.session_id",
): Promise<ReferenceRow[]> {
	const rows = await executor.query<
		Omit<ReferenceRow, "cost_uses_default_region" | "estimated_cost"> & {
			cost_is_complete: number;
			cost_uses_default_region: number;
			estimated_cost: number | null;
		}
	>({
		clickhouse_settings: { join_use_nulls: 0 },
		query: `WITH RECURSIVE ${buildUsageEventAnalyticsCte({}, false)},
			${REFERENCE_FAMILY_COST_CTE(`sa.is_top_level_session = 1 AND ${dateFilter}`)}
			SELECT
				sa.session_id AS session_id,
				sa.user_id AS user_id,
				formatDateTime(sa.session_date, '%Y-%m-%dT%H:%i:%SZ') AS session_date,
				sa.actual_duration_min AS duration_min,
				sa.total_tokens AS total_tokens,
				sa.input_tokens AS input_tokens,
				sa.output_tokens AS output_tokens,
				sa.model_used AS model_used,
				sa.estimated_cost AS estimated_cost,
				sa.cost_is_complete AS cost_is_complete,
				sa.cost_uses_default_region AS cost_uses_default_region
			FROM reference_list_costs AS sa
			WHERE ${dateFilter}
				AND sa.organization_id = {orgId:String}
				AND sa.is_top_level_session = 1
			${tail}`,
		query_params: { ...params, orgId: organizationId },
	});
	return rows.map(({ cost_is_complete, ...row }) => ({
		...row,
		cost_uses_default_region: row.cost_uses_default_region > 0,
		estimated_cost: cost_is_complete > 0 ? row.estimated_cost : null,
	}));
}

describe("dashboard date-range window", () => {
	test("prices the same cost and counts the same sessions per day as the organization-wide query", async () => {
		const startDate = dayOf(-DAY_MS);
		const endDate = windowDate;
		const dashboard = await getCostDashboard(
			{ tenant: "organization", orgId: organizationId },
			CostDashboardInputSchema.parse({
				startDate,
				endDate,
				requestedMetric: "cost",
			}),
			{ githubEvidenceUiEnabled: false },
		);
		const reference = await executor.query<{
			metric: string;
			date: string;
			value: number;
		}>({
			query: `WITH RECURSIVE ${buildUsageEventAnalyticsCte()}
				SELECT * FROM (
					SELECT 'cost' AS metric, toString(p.usage_date) AS date,
						round(sum(ifNull(p.group_estimated_cost, 0)), 9) AS value
					FROM priced_usage_groups AS p
					WHERE p.record_kind = 'event'
						AND p.usage_date BETWEEN toDate({startDate:String}) AND toDate({endDate:String})
						AND (p.organization_id, p.user_id, p.source, p.session_id) IN (
							SELECT organization_id, user_id, source, session_id
							FROM usage_analytics_metadata
						)
					GROUP BY date
					HAVING value != 0
					UNION ALL
					SELECT 'sessions' AS metric, toString(toDate(session_date)) AS date,
						toFloat64(count()) AS value
					FROM usage_analytics_sessions
					WHERE session_date >= toDateTime({startDate:String}, 'UTC')
						AND session_date < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
					GROUP BY date
				)
				ORDER BY metric, date`,
			query_params: { endDate, orgId: organizationId, startDate },
		});
		const trend = (metric: "cost" | "sessions"): typeof reference =>
			(dashboard.metrics[metric]?.trend ?? [])
				.filter((point) => point.total !== 0)
				.map((point) => ({
					metric,
					date: point.date,
					value: Number(point.total.toFixed(9)),
				}));

		expect(reference.length).toBeGreaterThan(2);
		expect([...trend("cost"), ...trend("sessions")]).toEqual(
			reference.map((row) => ({
				...row,
				value: Number(Number(row.value).toFixed(9)),
			})),
		);
	});
});

function expectSameRows(
	rows: Awaited<ReturnType<typeof getSessionAnalytics>>,
	expected: ReferenceRow[],
) {
	const actual = rows
		.filter((row) => row.subagent_of === undefined)
		.map((row) => ({
			cost_uses_default_region: row.cost_uses_default_region,
			duration_min: row.duration_min,
			estimated_cost: row.estimated_cost ?? null,
			input_tokens: row.input_tokens,
			model_used: row.model_used,
			output_tokens: row.output_tokens,
			session_date: row.session_date,
			session_id: row.session_id,
			total_tokens: row.total_tokens,
			user_id: row.user_id,
		}))
		.sort((a, b) => a.session_id.localeCompare(b.session_id));
	const sorted = [...expected].sort((a, b) =>
		a.session_id.localeCompare(b.session_id),
	);
	expect(actual.map(({ estimated_cost, ...row }) => row)).toEqual(
		sorted.map(({ estimated_cost, ...row }) => row),
	);
	actual.forEach((row, index) => {
		const cost = sorted[index]?.estimated_cost ?? null;
		if (cost === null) expect(row.estimated_cost).toBeNull();
		else expect(row.estimated_cost).toBeCloseTo(cost, 9);
	});
}

/**
 * The family cost as it was built before the window: the walk from and a
 * second join back to the organization-wide usage relation.
 */
const REFERENCE_FAMILY_COST_CTE = (rootFilterSql: string) => `
	reference_native_edges AS (
		SELECT organization_id, user_id, parent_session_id, child_session_id
		FROM session_lineage_current
		WHERE ${NATIVE_PARENT_EDGE_SQL}
	),
	reference_walk AS (
		SELECT
			sa.organization_id AS root_organization_id,
			sa.user_id AS root_user_id,
			toString(sa.source) AS root_source,
			sa.session_id AS root_session_id,
			sa.organization_id AS member_organization_id,
			sa.user_id AS member_user_id,
			toString(sa.source) AS member_source,
			sa.session_id AS member_session_id,
			[sa.session_id] AS visited_session_ids
		FROM usage_analytics_sessions AS sa
		WHERE ${rootFilterSql}

		UNION ALL

		SELECT
			walk.root_organization_id,
			walk.root_user_id,
			walk.root_source,
			walk.root_session_id,
			edge.organization_id AS member_organization_id,
			edge.user_id AS member_user_id,
			'codex' AS member_source,
			edge.child_session_id AS member_session_id,
			arrayPushBack(walk.visited_session_ids, edge.child_session_id)
		FROM reference_walk AS walk
		INNER JOIN reference_native_edges AS edge
			ON edge.organization_id = walk.member_organization_id
			AND edge.user_id = walk.member_user_id
			AND walk.member_source = 'codex'
			AND edge.parent_session_id = walk.member_session_id
		WHERE NOT has(walk.visited_session_ids, edge.child_session_id)
	),
	reference_members AS (
		SELECT DISTINCT
			root_organization_id, root_user_id, root_source, root_session_id,
			member_organization_id, member_user_id, member_source, member_session_id
		FROM reference_walk
	),
	reference_rollups AS (
		SELECT
			members.root_organization_id AS organization_id,
			members.root_user_id AS user_id,
			members.root_source AS source,
			members.root_session_id AS session_id,
			toUInt8(min(ifNull(cost.cost_is_complete, 0))) AS family_cost_is_complete,
			if(
				min(ifNull(cost.cost_is_complete, 0)) = 1,
				toNullable(sum(ifNull(cost.estimated_cost, 0))),
				CAST(NULL, 'Nullable(Float64)')
			) AS family_estimated_cost,
			toUInt8(max(ifNull(cost.cost_uses_default_region, 0))) AS family_cost_uses_default_region
		FROM reference_members AS members
		LEFT ANY JOIN usage_analytics_sessions AS cost
			ON cost.organization_id = members.member_organization_id
			AND cost.user_id = members.member_user_id
			AND cost.source = members.member_source
			AND cost.session_id = members.member_session_id
		GROUP BY organization_id, user_id, source, session_id
	),
	reference_list_costs AS (
		SELECT
			sa.* EXCEPT (estimated_cost, cost_is_complete, cost_uses_default_region),
			rollup.family_estimated_cost AS estimated_cost,
			rollup.family_cost_is_complete AS cost_is_complete,
			rollup.family_cost_uses_default_region AS cost_uses_default_region
		FROM usage_analytics_sessions AS sa
		INNER JOIN reference_rollups AS rollup
			ON rollup.organization_id = sa.organization_id
			AND rollup.user_id = sa.user_id
			AND rollup.source = sa.source
			AND rollup.session_id = sa.session_id
	)`;

function sessionRow(
	orgId: string,
	sessionId: string,
	source: "claude_code" | "codex",
	sessionDate: string,
	overrides: Partial<RudelSessionAnalyticsRow> = {},
): RudelSessionAnalyticsRow {
	return {
		actual_duration_min: 10 + sessionId.length,
		avg_period_sec: 1,
		cache_creation_input_tokens: "0",
		cache_read_input_tokens: "0",
		error_count: 0,
		filter_version: 1,
		git_branch: null,
		git_remote: "https://github.com/rudel/test.git",
		git_sha: null,
		has_commit: 0,
		human_duration_sec: 0,
		inference_duration_sec: 0,
		ingested_at: sessionDate,
		input_tokens: "0",
		last_interaction_date: sessionDate,
		long_pauses: 0,
		median_period_sec: 1,
		model_used: source === "codex" ? "gpt-5.6-sol" : "claude-sonnet-4-5",
		normal_responses: 1,
		organization_id: orgId,
		output_tokens: "0",
		package_name: "rudel",
		package_type: "bun",
		project_path: "/workspace/rudel",
		quick_responses: 0,
		revision: "1",
		session_date: sessionDate,
		session_id: sessionId,
		skills: [],
		slash_commands: [],
		source,
		subagent_count: 0,
		native_subagents: [],
		subagent_types: [],
		success_score: 80,
		tag: null,
		total_interactions: 1,
		total_tokens: "0",
		used_plan_mode: 0,
		user_id: userId,
		...overrides,
	};
}

/** One event per usage date and a receipt counting them (or one too many). */
function usageRows(
	orgId: string,
	owner: string,
	sessionId: string,
	source: "claude_code" | "codex",
	usageOffsetsMs: readonly number[],
	completeReceipt: boolean,
): RudelUsageEventsRow[] {
	const base = {
		agent_id: "main",
		cache_read_input_tokens: "1000",
		cache_write_1h_input_tokens: "0",
		cache_write_5m_input_tokens: source === "codex" ? "0" : "1000",
		recorded_cache_write_5m_input_tokens: null,
		recorded_cache_write_1h_input_tokens: null,
		cache_write_input_tokens: null,
		content_sha256: "c".repeat(64),
		context_input_tokens: "3000",
		duplicate_observation_count: 0,
		event_identity_version: 1,
		event_version: "1",
		extraction_version: 1,
		filter_version: 1,
		has_valid_timestamp: 1,
		identity_kind: "message_id",
		inference_geo: "",
		inference_speed: "",
		is_deleted: 0,
		lineage_id: "main",
		model_rate_card_version: "2026-08-05",
		model_status: "resolved",
		model_provider: source === "codex" ? "openai" : "anthropic",
		organization_id: orgId,
		output_tokens: "500",
		parent_lineage_id: "",
		quality_flags: [],
		raw_model: source === "codex" ? "gpt-5.6-sol" : "claude-sonnet-4-5",
		reasoning_output_tokens: "0",
		receipt_checksum: "0".repeat(64),
		receipt_event_count: 0,
		receipt_is_complete: 0,
		record_kind: "event",
		resolved_model: source === "codex" ? "gpt-5.6-sol" : "claude-sonnet-4-5",
		service_tier: "standard",
		session_id: sessionId,
		source,
		token_source: "provider_increment",
		uncached_input_tokens: "1000",
		user_id: owner,
	} satisfies Omit<
		RudelUsageEventsRow,
		| "event_id"
		| "first_observed_line"
		| "ingested_at"
		| "occurred_at"
		| "usage_date"
	>;
	const events = usageOffsetsMs.map((offsetMs, index) => ({
		...base,
		event_id: (index + 1).toString(16).padStart(64, "0"),
		first_observed_line: index + 1,
		ingested_at: at(offsetMs),
		occurred_at: at(offsetMs),
		usage_date: dayOf(offsetMs),
	}));
	return [
		...events,
		{
			...base,
			cache_read_input_tokens: "0",
			cache_write_5m_input_tokens: "0",
			context_input_tokens: "0",
			event_id: "f".repeat(64),
			first_observed_line: 0,
			has_valid_timestamp: 0,
			identity_kind: "receipt",
			ingested_at: at(0),
			model_status: "missing",
			occurred_at: "1970-01-01 00:00:00.000",
			output_tokens: "0",
			raw_model: "",
			receipt_checksum: "d".repeat(64),
			receipt_event_count: events.length + (completeReceipt ? 0 : 1),
			receipt_is_complete: 1,
			record_kind: "receipt",
			resolved_model: "",
			service_tier: "",
			uncached_input_tokens: "0",
			usage_date: dayOf(0),
		},
	];
}
