import {
	afterAll,
	beforeAll,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import {
	ingestRudelSessionAnalytics,
	ingestRudelUsageEvents,
	type RudelSessionAnalyticsRow,
	type RudelUsageEventsRow,
} from "@rudel/ch-schema/generated";
import { createClickHouseExecutor } from "../clickhouse.js";
import { getSessionAnalytics } from "../services/session-analytics.service.js";
import {
	buildSessionLanguageSignalRow,
	insertSessionLanguageSignalRows,
} from "../services/session-language-signal-persistence.service.js";
import {
	buildUsageCostSubtotalSql,
	buildUsageEventAnalyticsCte,
} from "../services/usage-event-analytics.service.js";

setDefaultTimeout(30_000);

const runId = crypto.randomUUID();
const organizationId = `usage_analytics_org_${runId}`;
const userId = `usage_analytics_user_${runId}`;
const isolatedOrganizationId = `usage_analytics_other_org_${runId}`;
const isolatedUserId = `usage_analytics_other_user_${runId}`;
const resolvedSessionId = `usage_analytics_resolved_${runId}`;
const unresolvedSessionId = `usage_analytics_unresolved_${runId}`;
const unsupportedTierSessionId = `usage_analytics_unsupported_tier_${runId}`;
const openAiFastSessionId = `usage_analytics_openai_fast_${runId}`;
const claudeFastUsSessionId = `usage_analytics_claude_fast_us_${runId}`;
const unavailableGeoSessionId = `usage_analytics_unavailable_geo_${runId}`;
const longContextSessionId = `usage_analytics_long_${runId}`;
const mismatchedSessionId = `usage_analytics_mismatch_${runId}`;
const partialSessionId = `usage_analytics_partial_${runId}`;
const incompleteSessionId = `usage_analytics_incomplete_${runId}`;
const invalidTimestampSessionId = `usage_analytics_invalid_timestamp_${runId}`;
const deletedReceiptSessionId = `usage_analytics_deleted_receipt_${runId}`;
const tombstonedSessionId = `usage_analytics_tombstone_${runId}`;
const missingMetadataSessionId = `usage_analytics_missing_metadata_${runId}`;
const syntheticTerminalSessionId = `usage_analytics_synthetic_terminal_${runId}`;
const syntheticZeroSessionId = `usage_analytics_synthetic_zero_${runId}`;
const unknownMixedModelSessionId = `usage_analytics_unknown_mixed_${runId}`;
const unknownSingleModelSessionId = `usage_analytics_unknown_single_${runId}`;
const eventId = "a".repeat(64);
const receiptId = "b".repeat(64);
const executor = createClickHouseExecutor({
	database: "default",
	password: process.env.CLICKHOUSE_PASSWORD || "",
	url: process.env.CLICKHOUSE_URL || "http://localhost:8123",
	username:
		process.env.CLICKHOUSE_USERNAME || process.env.CLICKHOUSE_USER || "default",
});

beforeAll(async () => {
	await ingestRudelSessionAnalytics(
		executor,
		[
			...[
				resolvedSessionId,
				unresolvedSessionId,
				unsupportedTierSessionId,
				openAiFastSessionId,
				claudeFastUsSessionId,
				unavailableGeoSessionId,
				longContextSessionId,
				mismatchedSessionId,
				partialSessionId,
				incompleteSessionId,
				invalidTimestampSessionId,
				deletedReceiptSessionId,
				tombstonedSessionId,
			].map(buildSessionAnalyticsRow),
			{
				...buildSessionAnalyticsRow(resolvedSessionId),
				organization_id: isolatedOrganizationId,
				user_id: isolatedUserId,
			},
			{
				...buildSessionAnalyticsRow(unknownMixedModelSessionId),
				model_used: "unknown",
				source: "codex",
			},
			{
				...buildSessionAnalyticsRow(unknownSingleModelSessionId),
				model_used: "unknown",
				source: "codex",
			},
			{
				...buildSessionAnalyticsRow(syntheticTerminalSessionId),
				model_used: "<synthetic>",
			},
			{
				...buildSessionAnalyticsRow(syntheticZeroSessionId),
				model_used: "<synthetic>",
			},
		],
		{ validate: true },
	);

	await ingestRudelUsageEvents(
		executor,
		[
			buildEventRow(resolvedSessionId, "1"),
			buildReceiptRow(resolvedSessionId, "1", 1, true),
			buildEventRow(resolvedSessionId, "2", {
				cache_read_input_tokens: "2000000",
				cache_write_1h_input_tokens: "2000000",
				cache_write_5m_input_tokens: "2000000",
				context_input_tokens: "8000000",
				model_provider: "",
				output_tokens: "2000000",
				uncached_input_tokens: "2000000",
			}),
			buildReceiptRow(resolvedSessionId, "2", 1, true),
			buildEventRow(unresolvedSessionId, "1", {
				model_status: "unresolved",
				raw_model: "mystery-model",
				resolved_model: "",
			}),
			buildReceiptRow(unresolvedSessionId, "1", 1, true),
			buildEventRow(unsupportedTierSessionId, "1", {
				service_tier: "batch",
			}),
			buildReceiptRow(unsupportedTierSessionId, "1", 1, true),
			buildEventRow(openAiFastSessionId, "1", {
				cache_read_input_tokens: "100000",
				cache_write_1h_input_tokens: "0",
				cache_write_5m_input_tokens: "0",
				context_input_tokens: "200000",
				model_provider: "openai",
				output_tokens: "100000",
				raw_model: "gpt-5.4",
				resolved_model: "gpt-5.4",
				service_tier: "fast",
				source: "codex",
				uncached_input_tokens: "100000",
			}),
			buildReceiptRow(openAiFastSessionId, "1", 1, true, "codex"),
			buildEventRow(claudeFastUsSessionId, "1", {
				inference_geo: "us",
				inference_speed: "fast",
				model_provider: "anthropic",
				raw_model: "claude-opus-4-8",
				resolved_model: "claude-opus-4-8",
				service_tier: "priority",
			}),
			buildReceiptRow(claudeFastUsSessionId, "1", 1, true),
			buildEventRow(unavailableGeoSessionId, "1", {
				inference_geo: "",
				model_provider: "anthropic",
				quality_flags: ["inference_geo_not_available"],
				raw_model: "claude-opus-4-8",
				resolved_model: "claude-opus-4-8",
			}),
			buildReceiptRow(unavailableGeoSessionId, "1", 1, true),
			buildEventRow(longContextSessionId, "1", {
				cache_read_input_tokens: "0",
				cache_write_1h_input_tokens: "0",
				cache_write_5m_input_tokens: "0",
				context_input_tokens: "272001",
				model_provider: "openai",
				output_tokens: "1000000",
				raw_model: "gpt-5.6-sol",
				resolved_model: "gpt-5.6-sol",
				service_tier: "auto",
				source: "codex",
				uncached_input_tokens: "1000000",
			}),
			buildReceiptRow(longContextSessionId, "1", 1, true, "codex"),
			buildEventRow(mismatchedSessionId, "1"),
			buildReceiptRow(mismatchedSessionId, "1", 2, true),
			buildEventRow(partialSessionId, "1"),
			buildEventRow(partialSessionId, "1", {
				event_id: "f".repeat(64),
				model_status: "unresolved",
				raw_model: "mystery-model",
				resolved_model: "",
			}),
			buildReceiptRow(partialSessionId, "1", 2, true),
			buildEventRow(incompleteSessionId, "1"),
			buildReceiptRow(incompleteSessionId, "1", 1, true),
			{
				...buildReceiptRow(incompleteSessionId, "2", 0, false),
				event_id: "e".repeat(64),
			},
			buildEventRow(invalidTimestampSessionId, "1", {
				has_valid_timestamp: 0,
				occurred_at: "1970-01-01 00:00:00.000",
				usage_date: "1970-01-01",
			}),
			buildReceiptRow(invalidTimestampSessionId, "1", 1, true),
			buildEventRow(deletedReceiptSessionId, "1"),
			buildReceiptRow(deletedReceiptSessionId, "1", 1, true),
			{
				...buildReceiptRow(deletedReceiptSessionId, "2", 0, false),
				event_id: "9".repeat(64),
				is_deleted: 1,
			},
			buildEventRow(tombstonedSessionId, "1"),
			buildReceiptRow(tombstonedSessionId, "1", 1, true),
			buildEventRow(tombstonedSessionId, "2", { is_deleted: 1 }),
			buildReceiptRow(tombstonedSessionId, "2", 0, true),
			buildEventRow(missingMetadataSessionId, "1"),
			buildReceiptRow(missingMetadataSessionId, "1", 1, true),
			buildEventRow(syntheticTerminalSessionId, "1", {
				event_id: "1".repeat(64),
				first_observed_line: 10,
				occurred_at: "2026-08-04 08:00:00.000",
			}),
			buildEventRow(syntheticTerminalSessionId, "1", {
				agent_id: "worker",
				event_id: "2".repeat(64),
				first_observed_line: 20,
				occurred_at: "2026-08-04 08:01:00.000",
				raw_model: "claude-haiku-4-5",
				resolved_model: "claude-haiku-4-5-20251001",
			}),
			buildSyntheticZeroEvent(syntheticTerminalSessionId, "3".repeat(64)),
			buildReceiptRow(syntheticTerminalSessionId, "1", 3, true),
			buildSyntheticZeroEvent(syntheticZeroSessionId, "4".repeat(64)),
			buildReceiptRow(syntheticZeroSessionId, "1", 1, true),
			buildCodexDisplayEvent(
				unknownMixedModelSessionId,
				eventId,
				"gpt-5.6-sol",
				{
					first_observed_line: 10,
					occurred_at: "2026-08-04 08:00:00.000",
				},
			),
			buildCodexDisplayEvent(
				unknownMixedModelSessionId,
				"f".repeat(64),
				"gpt-5.6-terra",
				{
					first_observed_line: 20,
					occurred_at: "2026-08-04 08:01:00.000",
				},
			),
			buildReceiptRow(unknownMixedModelSessionId, "1", 2, true, "codex"),
			buildCodexDisplayEvent(
				unknownSingleModelSessionId,
				eventId,
				"gpt-5.6-sol",
			),
			buildReceiptRow(unknownSingleModelSessionId, "1", 1, true, "codex"),
			{
				...buildEventRow(resolvedSessionId, "1"),
				organization_id: isolatedOrganizationId,
				user_id: isolatedUserId,
			},
			{
				...buildReceiptRow(resolvedSessionId, "1", 1, true),
				organization_id: isolatedOrganizationId,
				user_id: isolatedUserId,
			},
		],
		{ validate: true },
	);
});

afterAll(async () => {
	await executor
		.execute({
			query: `DELETE FROM rudel.usage_events WHERE organization_id IN ({organizationId:String}, {isolatedOrganizationId:String}) SETTINGS lightweight_deletes_sync = 3`,
			query_params: { isolatedOrganizationId, organizationId },
		})
		.catch(() => {});
	await executor
		.execute({
			query: `DELETE FROM rudel.session_analytics WHERE organization_id IN ({organizationId:String}, {isolatedOrganizationId:String}) SETTINGS lightweight_deletes_sync = 3`,
			query_params: { isolatedOrganizationId, organizationId },
		})
		.catch(() => {});
	await executor.close();
});

describe("usage-event analytics ClickHouse rollups", () => {
	test("lists sessions with interaction metrics when usage-event analytics is enabled", async () => {
		const previousMode = process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE;
		process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE = "all";
		try {
			const rows = await getSessionAnalytics(organizationId, {
				start_date: "2026-08-04",
				end_date: "2026-08-04",
				limit: 30,
				sort_by: "interactions",
			});
			expect(rows.length).toBeGreaterThan(0);
			expect(rows.every((row) => row.total_interactions === 1)).toBe(true);
			expect(
				rows.find((row) => row.session_id === unavailableGeoSessionId),
			).toMatchObject({
				estimated_cost: 46.75,
				cost_uses_default_region: true,
			});
			expect(
				rows.find((row) => row.session_id === claudeFastUsSessionId),
			).toMatchObject({
				estimated_cost: 102.85,
				cost_uses_default_region: false,
			});
			for (const sessionId of [
				unresolvedSessionId,
				partialSessionId,
				unsupportedTierSessionId,
			]) {
				expect(rows.find((row) => row.session_id === sessionId)).toMatchObject({
					estimated_cost: null,
				});
			}
		} finally {
			if (previousMode === undefined)
				delete process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE;
			else process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE = previousMode;
		}
	});

	test("loads all 1,000 sessions and their signals without oversized HTTP URLs", async () => {
		const pageOrganizationId = `usage_analytics_page_${runId}`;
		const pageRows = Array.from({ length: 1_000 }, (_, index) => ({
			...buildSessionAnalyticsRow(
				crypto.randomUUID() +
					(index < 800 ? "" : (index % 2 === 0 ? "界" : "'").repeat(164)),
			),
			organization_id: pageOrganizationId,
			source: index % 2 === 0 ? "claude_code" : "codex",
		}));
		const signalRows = pageRows.map((row, index) =>
			buildSessionLanguageSignalRow(
				{
					organizationId: pageOrganizationId,
					sessionDate: "2026-08-04T08:00:00.000Z",
					sessionId: row.session_id,
					source: index % 2 === 0 ? "claude_code" : "codex",
					userId: index === 0 ? isolatedUserId : userId,
					rawIngestedAt: "2026-08-04T08:01:00.000Z",
					rawRevision: "1",
				},
				{
					member_swears: 0,
					member_apologies: 1,
					member_positive: index % 7,
					model_swears: 0,
					model_apologies: 2,
					model_positive: 0,
				},
				"2026-08-04T08:02:00.000Z",
			),
		);
		const previousMode = process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE;
		const originalFetch = globalThis.fetch;
		const metadataUrlLengths: number[] = [];
		try {
			await ingestRudelSessionAnalytics(executor, pageRows, { validate: true });
			await ingestRudelUsageEvents(
				executor,
				pageRows.flatMap((row, index) => [
					buildEventRow(row.session_id, "1", {
						organization_id: pageOrganizationId,
						source: row.source,
					}),
					{
						...buildReceiptRow(
							row.session_id,
							"1",
							1,
							true,
							index % 2 === 0 ? "claude_code" : "codex",
						),
						organization_id: pageOrganizationId,
					},
				]),
				{ validate: true },
			);
			await insertSessionLanguageSignalRows(executor, signalRows);
			process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE = "all";
			// Observe actual requests to real ClickHouse; no responses are mocked.
			globalThis.fetch = Object.assign(
				async (
					input: Parameters<typeof fetch>[0],
					init?: Parameters<typeof fetch>[1],
				) => {
					const url = new URL(
						input instanceof Request ? input.url : input.toString(),
					);
					if (
						url.searchParams.get("param_orgId") === pageOrganizationId &&
						url.searchParams.has("param_signalKeys")
					) {
						metadataUrlLengths.push(url.toString().length);
					}
					return originalFetch(input, init);
				},
				{ preconnect: originalFetch.preconnect },
			);
			const rows = await getSessionAnalytics(pageOrganizationId, {
				start_date: "2026-08-04",
				end_date: "2026-08-04",
				limit: 1_000,
			});
			expect(rows).toHaveLength(1_000);
			const signalsById = new Map(
				signalRows.map((row) => [row.session_id, row]),
			);
			for (const row of rows) {
				const signals = signalsById.get(row.session_id);
				expect(signals).toBeDefined();
				const matchesUser = signals?.user_id === row.user_id;
				expect(row.member_apologies).toBe(matchesUser ? 1 : 0);
				expect(row.model_apologies).toBe(matchesUser ? 2 : 0);
				expect(row.member_positive).toBe(
					matchesUser ? signals?.member_positive : 0,
				);
			}
			expect(metadataUrlLengths.length).toBeGreaterThan(0);
			expect(Math.max(...metadataUrlLengths)).toBeLessThan(8_192);
		} finally {
			globalThis.fetch = originalFetch;
			if (previousMode === undefined)
				delete process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE;
			else process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE = previousMode;
			await executor.execute({
				query:
					"DELETE FROM rudel.usage_events WHERE organization_id = {orgId:String} SETTINGS lightweight_deletes_sync = 3",
				query_params: { orgId: pageOrganizationId },
			});
			await executor.execute({
				query:
					"DELETE FROM rudel.session_language_signals WHERE organization_id = {orgId:String} SETTINGS lightweight_deletes_sync = 3",
				query_params: { orgId: pageOrganizationId },
			});
			await executor.execute({
				query:
					"DELETE FROM rudel.session_analytics WHERE organization_id = {orgId:String} SETTINGS lightweight_deletes_sync = 3",
				query_params: { orgId: pageOrganizationId },
			});
		}
	});

	test("preserves interaction metrics in daily usage analytics", async () => {
		const rows = await executor.query<{ total_interactions: number }>({
			query: `
				WITH ${buildUsageEventAnalyticsCte()}
				SELECT total_interactions
				FROM usage_analytics_daily_sessions
				WHERE organization_id = {orgId:String}
					AND session_id = {sessionId:String}
					AND usage_date = toDate('2026-08-04')
				LIMIT 1
			`,
			query_params: {
				orgId: organizationId,
				sessionId: resolvedSessionId,
			},
		});
		expect(rows).toEqual([{ total_interactions: 1 }]);
	});

	test("preserves the standard-region estimate and its provenance in daily rollups", async () => {
		const rows = await executor.query<{
			estimated_cost: number;
			cost_is_complete: number;
			cost_uses_default_region: number;
		}>({
			query: `WITH ${buildUsageEventAnalyticsCte()}
				SELECT estimated_cost, cost_is_complete, cost_uses_default_region
				FROM usage_analytics_daily_sessions
				WHERE session_id = {sessionId:String}
					AND usage_date = toDate('2026-08-04')
				LIMIT 1`,
			query_params: {
				orgId: organizationId,
				sessionId: unavailableGeoSessionId,
			},
		});
		expect(rows).toEqual([
			{
				estimated_cost: 46.75,
				cost_is_complete: 1,
				cost_uses_default_region: 1,
			},
		]);
	});

	test("resolves replacement generations, receipt consistency, pricing, and metadata joins", async () => {
		const rows = await readAnalyticsRows();

		expect(rows).toEqual([
			{
				cost_is_complete: 1,
				estimated_cost: 102.85,
				input_tokens: "4000000",
				model_used: "claude-opus-4-8",
				output_tokens: "1000000",
				session_id: claudeFastUsSessionId,
				total_tokens: "5000000",
			},
			{
				cost_is_complete: 0,
				estimated_cost: 0,
				input_tokens: "4000000",
				model_used: "claude-sonnet-4-5",
				output_tokens: "1000000",
				session_id: invalidTimestampSessionId,
				total_tokens: "5000000",
			},
			{
				cost_is_complete: 1,
				estimated_cost: 55,
				input_tokens: "1000000",
				model_used: "gpt-5.6-sol",
				output_tokens: "1000000",
				session_id: longContextSessionId,
				total_tokens: "2000000",
			},
			{
				cost_is_complete: 1,
				estimated_cost: 3.55,
				input_tokens: "200000",
				model_used: "gpt-5.4",
				output_tokens: "100000",
				session_id: openAiFastSessionId,
				total_tokens: "300000",
			},
			{
				cost_is_complete: 0,
				estimated_cost: 28.05,
				input_tokens: "8000000",
				model_used: "claude-sonnet-4-5",
				output_tokens: "2000000",
				session_id: partialSessionId,
				total_tokens: "10000000",
			},
			{
				cost_is_complete: 1,
				estimated_cost: 56.1,
				input_tokens: "8000000",
				model_used: "claude-sonnet-4-5",
				output_tokens: "2000000",
				session_id: resolvedSessionId,
				total_tokens: "10000000",
			},
			{
				cost_is_complete: 1,
				estimated_cost: 37.4,
				input_tokens: "8000000",
				model_used: "claude-sonnet-4-5",
				output_tokens: "2000000",
				session_id: syntheticTerminalSessionId,
				total_tokens: "10000000",
			},
			{
				cost_is_complete: 1,
				estimated_cost: 0,
				input_tokens: "0",
				model_used: "",
				output_tokens: "0",
				session_id: syntheticZeroSessionId,
				total_tokens: "0",
			},
			{
				cost_is_complete: 1,
				estimated_cost: 0,
				input_tokens: "0",
				model_used: "",
				output_tokens: "0",
				session_id: tombstonedSessionId,
				total_tokens: "0",
			},
			{
				cost_is_complete: 1,
				estimated_cost: 46.75,
				input_tokens: "4000000",
				model_used: "claude-opus-4-8",
				output_tokens: "1000000",
				session_id: unavailableGeoSessionId,
				total_tokens: "5000000",
			},
			{
				cost_is_complete: 1,
				estimated_cost: 4.97,
				input_tokens: "400000",
				model_used: "gpt-5.6-terra",
				output_tokens: "200000",
				session_id: unknownMixedModelSessionId,
				total_tokens: "600000",
			},
			{
				cost_is_complete: 1,
				estimated_cost: 3.55,
				input_tokens: "200000",
				model_used: "gpt-5.6-sol",
				output_tokens: "100000",
				session_id: unknownSingleModelSessionId,
				total_tokens: "300000",
			},
			{
				cost_is_complete: 0,
				estimated_cost: 0,
				input_tokens: "4000000",
				model_used: "",
				output_tokens: "1000000",
				session_id: unresolvedSessionId,
				total_tokens: "5000000",
			},
			{
				cost_is_complete: 0,
				estimated_cost: 0,
				input_tokens: "4000000",
				model_used: "claude-sonnet-4-5",
				output_tokens: "1000000",
				session_id: unsupportedTierSessionId,
				total_tokens: "5000000",
			},
		]);
		expect(
			rows.every(
				(row) =>
					row.model_used !== "unknown" && row.model_used !== "<synthetic>",
			),
		).toBe(true);
		expect(
			rows.some((row) => row.session_id === missingMetadataSessionId),
		).toBe(false);
		for (const excludedSessionId of [
			deletedReceiptSessionId,
			incompleteSessionId,
			mismatchedSessionId,
		]) {
			expect(rows.some((row) => row.session_id === excludedSessionId)).toBe(
				false,
			);
		}
	});

	test("returns the known aggregate subtotal without discarding completeness", async () => {
		const rows = await executor.query<{
			cost: number;
			incomplete_sessions: number;
		}>({
			query: `
				WITH ${buildUsageEventAnalyticsCte()}
				SELECT
					${buildUsageCostSubtotalSql("estimated_cost", 4)} AS cost,
					countIf(cost_is_complete = 0) AS incomplete_sessions
				FROM usage_analytics_sessions
			`,
			query_params: { orgId: organizationId },
		});

		expect(rows).toEqual([{ cost: 338.22, incomplete_sessions: 4 }]);
	});

	test("keeps bounded key prefixes visible across the shared query families", async () => {
		const cases = [
			{
				cte: buildUsageEventAnalyticsCte(),
				params: { orgId: organizationId },
				relation: "usage_analytics_sessions",
				where: "session_date >= now64(3) - toIntervalDay(30)",
			},
			{
				cte: buildUsageEventAnalyticsCte({ userIdParam: "userId" }),
				params: { orgId: organizationId, userId },
				relation: "usage_analytics_daily_sessions",
				where: "usage_date >= today() - toIntervalDay(30)",
			},
			{
				cte: buildUsageEventAnalyticsCte({
					sessionIdParam: "sessionId",
					sourceParam: "source",
					userIdParam: "userId",
				}),
				params: {
					orgId: organizationId,
					sessionId: resolvedSessionId,
					source: "claude_code",
					userId,
				},
				relation: "usage_analytics_sessions",
				where: "session_id = {sessionId:String}",
			},
		] as const;

		for (const testCase of cases) {
			const explainRows = await executor.query<{ explain: string }>({
				query: `
					EXPLAIN indexes = 1
					WITH ${testCase.cte}
					SELECT sum(total_tokens)
					FROM ${testCase.relation}
					WHERE organization_id = {orgId:String}
						AND ${testCase.where}
				`,
				query_params: testCase.params,
			});
			const plan = explainRows.map((row) => row.explain).join("\n");

			expect(plan).toContain("PrimaryKey");
			expect(plan).toContain("organization_id");
		}
	});
});

async function readAnalyticsRows() {
	return executor.query<{
		cost_is_complete: number;
		estimated_cost: number | null;
		input_tokens: string;
		model_used: string;
		output_tokens: string;
		session_id: string;
		total_tokens: string;
	}>({
		query: `
			WITH ${buildUsageEventAnalyticsCte()}
			SELECT
				session_id,
				toString(input_tokens) AS input_tokens,
				toString(output_tokens) AS output_tokens,
				toString(total_tokens) AS total_tokens,
				model_used,
				estimated_cost,
				cost_is_complete
			FROM usage_analytics_sessions
			ORDER BY session_id
		`,
		query_params: { orgId: organizationId },
	});
}

function buildSessionAnalyticsRow(sessionId: string): RudelSessionAnalyticsRow {
	return {
		actual_duration_min: 10,
		avg_period_sec: 1,
		cache_creation_input_tokens: "0",
		cache_read_input_tokens: "0",
		error_count: 0,
		error_pattern: "",
		filter_version: 1,
		git_branch: null,
		git_remote: "https://github.com/rudel/test.git",
		git_sha: null,
		has_commit: 0,
		human_duration_sec: 0,
		inference_duration_sec: 0,
		ingested_at: "2026-08-04 08:01:00.000",
		input_tokens: "999999999",
		last_interaction_date: "2026-08-04 08:01:00.000",
		long_pauses: 0,
		median_period_sec: 1,
		model_used: "claude-opus-4-1",
		normal_responses: 1,
		organization_id: organizationId,
		output_tokens: "999999999",
		package_name: "rudel",
		package_type: "bun",
		project_path: "/workspace/rudel",
		quick_responses: 0,
		revision: "1",
		session_archetype: "standard",
		session_date: "2026-08-04 08:00:00.000",
		session_id: sessionId,
		skills: [],
		slash_commands: [],
		source:
			sessionId === longContextSessionId || sessionId === openAiFastSessionId
				? "codex"
				: "claude_code",
		subagent_count: 0,
		native_subagents: [],
		subagent_types: [],
		success_score: 80,
		tag: null,
		total_interactions: 1,
		total_tokens: "1999999998",
		used_plan_mode: 0,
		user_id: userId,
	};
}

function buildEventRow(
	sessionId: string,
	generation: string,
	overrides: Partial<RudelUsageEventsRow> = {},
): RudelUsageEventsRow {
	return {
		agent_id: "main",
		cache_read_input_tokens: "1000000",
		cache_write_1h_input_tokens: "1000000",
		cache_write_5m_input_tokens: "1000000",
		content_sha256: "c".repeat(64),
		context_input_tokens: "4000000",
		duplicate_observation_count: 0,
		event_id: eventId,
		event_identity_version: 1,
		event_version: generation,
		extraction_version: 1,
		filter_version: 1,
		first_observed_line: 1,
		has_valid_timestamp: 1,
		identity_kind: "message_id",
		inference_geo: "",
		inference_speed: "",
		ingested_at: `2026-08-04 08:0${generation}:00.000`,
		is_deleted: 0,
		lineage_id: "main",
		model_rate_card_version: "2026-08-05",
		model_status: "resolved",
		model_provider: "anthropic",
		occurred_at: "2026-08-04 08:00:00.000",
		organization_id: organizationId,
		output_tokens: "1000000",
		parent_lineage_id: "",
		quality_flags: [],
		raw_model: "claude-sonnet-4-5",
		reasoning_output_tokens: "250000",
		receipt_checksum: "0".repeat(64),
		receipt_event_count: 0,
		receipt_is_complete: 0,
		record_kind: "event",
		resolved_model: "claude-sonnet-4-5",
		service_tier: "standard",
		session_id: sessionId,
		source: "claude_code",
		token_source: "provider_increment",
		uncached_input_tokens: "1000000",
		usage_date: "2026-08-04",
		user_id: userId,
		...overrides,
	};
}

function buildReceiptRow(
	sessionId: string,
	generation: string,
	eventCount: number,
	complete: boolean,
	source = "claude_code",
): RudelUsageEventsRow {
	return {
		...buildEventRow(sessionId, generation, {
			cache_read_input_tokens: "0",
			cache_write_1h_input_tokens: "0",
			cache_write_5m_input_tokens: "0",
			context_input_tokens: "0",
			event_id: receiptId,
			first_observed_line: 0,
			has_valid_timestamp: 0,
			identity_kind: "receipt",
			model_status: "missing",
			occurred_at: "1970-01-01 00:00:00.000",
			output_tokens: "0",
			raw_model: "",
			reasoning_output_tokens: "0",
			receipt_checksum: "d".repeat(64),
			receipt_event_count: eventCount,
			receipt_is_complete: complete ? 1 : 0,
			record_kind: "receipt",
			resolved_model: "",
			service_tier: "",
			source,
			uncached_input_tokens: "0",
		}),
	};
}

function buildCodexDisplayEvent(
	sessionId: string,
	rowEventId: string,
	model: string,
	overrides: Partial<RudelUsageEventsRow> = {},
): RudelUsageEventsRow {
	return buildEventRow(sessionId, "1", {
		cache_read_input_tokens: "100000",
		cache_write_1h_input_tokens: "0",
		cache_write_5m_input_tokens: "0",
		context_input_tokens: "200000",
		event_id: rowEventId,
		model_provider: "openai",
		output_tokens: "100000",
		raw_model: model,
		resolved_model: model,
		service_tier: "auto",
		source: "codex",
		uncached_input_tokens: "100000",
		...overrides,
	});
}

function buildSyntheticZeroEvent(
	sessionId: string,
	rowEventId: string,
): RudelUsageEventsRow {
	return buildEventRow(sessionId, "1", {
		cache_read_input_tokens: "0",
		cache_write_1h_input_tokens: "0",
		cache_write_5m_input_tokens: "0",
		context_input_tokens: "0",
		event_id: rowEventId,
		first_observed_line: 30,
		model_status: "synthetic",
		occurred_at: "2026-08-04 08:02:00.000",
		output_tokens: "0",
		quality_flags: ["synthetic_model"],
		raw_model: "",
		resolved_model: "",
		uncached_input_tokens: "0",
	});
}
