import {
	afterAll,
	afterEach,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import {
	ingestRudelSessionAnalytics,
	type RudelSessionAnalyticsRow,
} from "@rudel/ch-schema/generated";
import { USAGE_SESSION_ROLLUPS_TABLE } from "@rudel/ch-schema/usage-session-rollups";
import {
	USAGE_EVENT_EXTRACTION_VERSION,
	USAGE_EVENT_IDENTITY_VERSION,
	USAGE_EVENT_MODEL_RATE_CARD_VERSION,
	type UsageEvent,
	type UsageEventSource,
} from "@rudel/usage-events";
import { createClickHouseExecutor } from "../clickhouse.js";
import {
	getClickHouseSessionPurgePlans,
	purgeClickHouseRows,
} from "../services/org-session.service.js";
import {
	buildUsageEventAnalyticsCte,
	getUsageAnalyticsQueryContext,
	type UsageSource,
} from "../services/usage-event-analytics.service.js";
import { writeUsageExtraction } from "../services/usage-event-ingest.service.js";
import {
	backOffUsageSessionRollups,
	clearUsageRollupReadiness,
	refreshUsageSessionRollups,
	USAGE_ROLLUP_BUILD_VERSION,
} from "../services/usage-session-rollup.service.js";
import {
	backfillUsageSessionRollups,
	buildUsageRollupCandidatesStatement,
} from "../services/usage-session-rollup-backfill.service.js";

setDefaultTimeout(60_000);

const runId = crypto.randomUUID();
const organizationId = `usage_rollup_org_${runId}`;
const skippedOrganizationId = `usage_rollup_skipped_${runId}`;
const userId = `usage_rollup_user_${runId}`;
const executor = createClickHouseExecutor({
	database: "default",
	password: process.env.CLICKHOUSE_PASSWORD || "",
	url: process.env.CLICKHOUSE_URL || "http://localhost:8123",
	username:
		process.env.CLICKHOUSE_USERNAME || process.env.CLICKHOUSE_USER || "default",
});
const noTombstones = {
	unsafe: async () => [],
} as unknown as Parameters<typeof backfillUsageSessionRollups>[0]["sql"];
const environment = { ...process.env };

afterEach(() => {
	for (const name of [
		"USAGE_EVENT_ANALYTICS_CUTOVER_MODE",
		"USAGE_ROLLUP_ORG_IDS",
		"USAGE_ROLLUP_WRITES_ENABLED",
	]) {
		if (environment[name] === undefined) delete process.env[name];
		else process.env[name] = environment[name];
	}
});

afterAll(async () => {
	for (const table of [
		"rudel.usage_events",
		"rudel.session_analytics",
		USAGE_SESSION_ROLLUPS_TABLE,
	])
		await executor
			.execute({
				query: `DELETE FROM ${table} WHERE organization_id IN ({organizationId:String}, {skippedOrganizationId:String}) SETTINGS lightweight_deletes_sync = 3`,
				query_params: { organizationId, skippedOrganizationId },
			})
			.catch(() => {});
	await executor.close();
});

describe("usage session rollups", () => {
	test("an upload writes its session's rollup and a re-upload replaces it whole", async () => {
		const sessionId = `replace_${runId}`;
		await upload(sessionId, "10", [
			usageEvent(sessionId, "1", { usageDate: "2026-09-01" }),
			usageEvent(sessionId, "2", {
				rawModel: "claude-opus-4-1-20250805",
				resolvedModel: "claude-opus-4-1-20250805",
				usageDate: "2026-09-02",
			}),
		]);
		const first = await readRollups(sessionId);
		expect(first).toHaveLength(1);
		expect(first[0]).toMatchObject({
			is_consistent: 1,
			latest_main_model: "claude-opus-4-1-20250805",
			receipt_generation: 10,
			record_kinds: ["event", "event", "receipt"],
			usage_dates: ["2026-09-01", "2026-09-02", "2026-09-01"],
		});

		await upload(
			sessionId,
			"11",
			[
				usageEvent(sessionId, "2", {
					outputTokens: 50,
					rawModel: "claude-opus-4-1-20250805",
					resolvedModel: "claude-opus-4-1-20250805",
					usageDate: "2026-09-02",
				}),
			],
			true,
		);
		const replaced = await readRollups(sessionId);
		expect(replaced).toHaveLength(1);
		expect(replaced[0]).toMatchObject({
			is_consistent: 1,
			output_tokens: [50, 0],
			receipt_generation: 11,
			record_kinds: ["event", "receipt"],
			usage_dates: ["2026-09-02", "2026-09-01"],
		});

		await refreshUsageSessionRollups(executor, [rollupKey(sessionId)]);
		const withoutBuildTime = (row: Record<string, unknown> | undefined) => ({
			...row,
			built_at: undefined,
		});
		expect(withoutBuildTime((await readRollups(sessionId))[0])).toEqual(
			withoutBuildTime(replaced[0]),
		);
		expect(await countRows(sessionId)).toBe(1);

		await executor.insert({
			table: USAGE_SESSION_ROLLUPS_TABLE,
			values: [
				{
					...replaced[0],
					built_at: "2030-01-01 00:00:00.000",
					output_tokens: [999, 0],
					receipt_generation: 10,
				},
			],
		});
		expect((await readRollups(sessionId))[0]?.output_tokens).toEqual([50, 0]);
	});

	test("a session whose receipt does not match its events is stored as not priced", async () => {
		const sessionId = `inconsistent_${runId}`;
		await upload(sessionId, "20", [usageEvent(sessionId, "1")]);
		expect((await readRollups(sessionId))[0]?.is_consistent).toBe(1);
		await executor.execute({
			query: `DELETE FROM rudel.usage_events WHERE organization_id = {organizationId:String} AND session_id = {sessionId:String} AND record_kind = 'event' SETTINGS lightweight_deletes_sync = 3`,
			query_params: { organizationId, sessionId },
		});
		await refreshUsageSessionRollups(executor, [rollupKey(sessionId)]);
		expect((await readRollups(sessionId))[0]).toMatchObject({
			is_consistent: 0,
			receipt_generation: 20,
			record_kinds: [],
		});
	});

	test("rollups price, list and date the sessions exactly as the events do", async () => {
		const codex = `codex_${runId}`;
		await upload(
			codex,
			"30",
			[
				usageEvent(codex, "1", {
					modelProvider: "openai",
					rawModel: "gpt-5.4",
					resolvedModel: "gpt-5.4",
					serviceTier: "priority",
					source: "codex",
				}),
				usageEvent(codex, "2", {
					contextInputTokens: 300_000,
					modelProvider: "openai",
					rawModel: "gpt-5.4",
					resolvedModel: "gpt-5.4",
					source: "codex",
					uncachedInputTokens: 300_000,
					usageDate: "2026-09-03",
				}),
			],
			false,
			"codex",
		);
		const unresolved = `unresolved_${runId}`;
		await upload(unresolved, "31", [
			usageEvent(unresolved, "1", {
				modelStatus: "unresolved",
				rawModel: "claude-sonnet-4-5-20990101",
				resolvedModel: "",
			}),
			usageEvent(unresolved, "2", {
				inferenceGeo: "",
				qualityFlags: ["inference_geo_not_available"],
			}),
		]);
		for (const query of [
			"SELECT * FROM usage_analytics_sessions ORDER BY session_id",
			"SELECT * FROM usage_analytics_daily_sessions ORDER BY session_id, usage_date",
			"SELECT * EXCEPT (receipt_generation, latest_receipt_event_count, latest_receipt_is_complete, latest_receipt_is_deleted, active_event_count) FROM priced_usage_groups ORDER BY ALL",
		]) {
			const read = (source: UsageSource) =>
				executor.query<Record<string, unknown>>({
					query: `WITH ${buildUsageEventAnalyticsCte({}, false, source)} ${query}`,
					query_params: { orgId: organizationId },
				});
			const events = await read("events");
			expect(events.length).toBeGreaterThan(0);
			expect(await read("rollups")).toEqual(events);
		}
	});

	test("the switch prices enabled workspaces from the rollups and the rest from the events", async () => {
		clearUsageRollupReadiness();
		process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE = "all";
		const events = await getUsageAnalyticsQueryContext(organizationId);
		expect(events.cteDefinitions).not.toContain(USAGE_SESSION_ROLLUPS_TABLE);
		process.env.USAGE_ROLLUP_ORG_IDS = organizationId;
		const rollups = await getUsageAnalyticsQueryContext(organizationId);
		expect(rollups.mode).toBe("events");
		expect(rollups.cteDefinitions).toContain(
			`FROM ${USAGE_SESSION_ROLLUPS_TABLE} FINAL`,
		);
		const read = (cte: string) =>
			executor.query({
				query: `WITH ${cte} SELECT session_id, estimated_cost, total_tokens, model_used FROM usage_analytics_sessions ORDER BY session_id`,
				query_params: { orgId: organizationId },
			});
		expect(await read(rollups.cteDefinitions)).toEqual(
			await read(events.cteDefinitions),
		);
		process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE = "off";
		const legacy = await getUsageAnalyticsQueryContext(organizationId);
		expect(legacy.mode).toBe("legacy");
		expect(legacy.cteDefinitions).not.toContain(USAGE_SESSION_ROLLUPS_TABLE);
	});

	test("the backfill builds missing and stale rollups outside skipped workspaces, then finds none", async () => {
		process.env.USAGE_ROLLUP_WRITES_ENABLED = "false";
		const fresh = `backfill_fresh_${runId}`;
		const missing = `backfill_missing_${runId}`;
		const skipped = `backfill_skipped_${runId}`;
		await upload(fresh, "40", [usageEvent(fresh, "1")]);
		await upload(missing, "41", [usageEvent(missing, "1")]);
		await upload(
			skipped,
			"42",
			[usageEvent(skipped, "1")],
			false,
			"claude_code",
			skippedOrganizationId,
		);
		await refreshUsageSessionRollups(executor, [rollupKey(fresh)]);
		const ours = (rows: { session_id: string }[]) =>
			rows
				.map((row) => row.session_id)
				.filter((id) => [fresh, missing, skipped].includes(id))
				.sort();
		const candidates = () =>
			executor.query<{ session_id: string }>(
				buildUsageRollupCandidatesStatement({
					limit: 1_000_000,
					skippedOrganizationIds: [skippedOrganizationId],
				}),
			);
		expect(ours(await candidates())).toEqual([missing]);

		await Bun.sleep(5);
		await ingestRudelSessionAnalytics(executor, [
			sessionAnalyticsRow(
				fresh,
				organizationId,
				"claude_code",
				new Date().toISOString().replace("T", " ").replace("Z", ""),
			),
		]);
		expect(ours(await candidates())).toEqual([fresh, missing].sort());

		const built: string[] = [];
		await backfillUsageSessionRollups({
			executor,
			limit: 1_000_000,
			refresh: async (target, sessions) => {
				const mine = sessions.filter(
					(session) => session.organizationId === organizationId,
				);
				built.push(...mine.map((session) => session.sessionId));
				await refreshUsageSessionRollups(target, mine);
			},
			skippedOrganizationIds: [skippedOrganizationId],
			sql: noTombstones,
		});
		expect(built.sort()).toEqual([fresh, missing].sort());
		expect(await countRows(skipped, skippedOrganizationId)).toBe(0);
		expect((await readRollups(missing))[0]?.is_consistent).toBe(1);
		expect(ours(await candidates())).toEqual([]);
	});

	test("a workspace holding rows of another build prices from the events until they are rebuilt", async () => {
		const sessionId = `stale_build_${runId}`;
		await upload(sessionId, "60", [usageEvent(sessionId, "1")]);
		const [row] = await readRollups(sessionId);
		await executor.insert({
			table: USAGE_SESSION_ROLLUPS_TABLE,
			values: [{ ...row, build_version: 1 }],
		});
		process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE = "all";
		process.env.USAGE_ROLLUP_ORG_IDS = organizationId;
		clearUsageRollupReadiness();
		expect(
			(await getUsageAnalyticsQueryContext(organizationId)).cteDefinitions,
		).not.toContain(USAGE_SESSION_ROLLUPS_TABLE);
		await refreshUsageSessionRollups(executor, [rollupKey(sessionId)]);
		clearUsageRollupReadiness();
		expect(
			(await getUsageAnalyticsQueryContext(organizationId)).cteDefinitions,
		).toContain(USAGE_SESSION_ROLLUPS_TABLE);
	});

	test("the backfill rechecks rows built before their receipt or right after an upload, and waits out a back-off", async () => {
		const noReceipt = `no_receipt_${runId}`;
		const unsettled = `unsettled_${runId}`;
		const settled = `settled_${runId}`;
		const ghost = `ghost_${runId}`;
		const kept = `kept_${runId}`;
		await upload(kept, "70", [usageEvent(kept, "1")]);
		await ingestRudelSessionAnalytics(
			executor,
			[noReceipt, unsettled, settled, ghost].map((sessionId) =>
				sessionAnalyticsRow(
					sessionId,
					organizationId,
					"claude_code",
					clickHouseTime(30 * 60_000),
				),
			),
		);
		const row = (
			sessionId: string,
			builtAgoMs: number,
			consistent: number,
		) => ({
			build_version: USAGE_ROLLUP_BUILD_VERSION,
			built_at: clickHouseTime(builtAgoMs),
			is_consistent: consistent,
			organization_id: organizationId,
			receipt_generation: 0,
			session_id: sessionId,
			source: "claude_code",
			user_id: userId,
		});
		await executor.insert({
			table: USAGE_SESSION_ROLLUPS_TABLE,
			values: [
				row(noReceipt, 2 * 60 * 60_000, 0),
				row(unsettled, 25 * 60_000, 1),
				row(settled, 15 * 60_000, 1),
			],
		});
		const ours = async () =>
			(
				await executor.query<{ session_id: string }>(
					buildUsageRollupCandidatesStatement({
						limit: 1_000_000,
						skippedOrganizationIds: [],
					}),
				)
			)
				.map((candidate) => candidate.session_id)
				.filter((id) =>
					[noReceipt, unsettled, settled, ghost, kept].includes(id),
				)
				.sort();
		expect(await ours()).toEqual([ghost, noReceipt, unsettled].sort());

		const before = (await readRollups(kept))[0];
		await backOffUsageSessionRollups(executor, [
			rollupKey(noReceipt),
			rollupKey(ghost),
			rollupKey(kept),
		]);
		expect(await ours()).toEqual([unsettled]);
		const after = (await readRollups(kept))[0];
		expect({ ...after, retry_after: undefined }).toEqual({
			...before,
			retry_after: undefined,
		});
		expect(String(after?.retry_after) > clickHouseTime(-50 * 60_000)).toBe(
			true,
		);
		expect((await readRollups(ghost))[0]).toMatchObject({
			build_version: USAGE_ROLLUP_BUILD_VERSION,
			is_consistent: 0,
			record_kinds: [],
		});
		await refreshUsageSessionRollups(executor, [rollupKey(kept)]);
		expect((await readRollups(kept))[0]?.retry_after).toBe(
			"1970-01-01 00:00:00.000",
		);
	});

	test("deleting a workspace purges its rollups", async () => {
		const sessionId = `purge_${runId}`;
		await upload(sessionId, "50", [usageEvent(sessionId, "1")]);
		expect(await countRows(sessionId)).toBe(1);
		const plan = getClickHouseSessionPurgePlans("organization_id").find(
			(entry) => entry.table === USAGE_SESSION_ROLLUPS_TABLE,
		);
		expect(plan?.column).toBe("organization_id");
		await purgeClickHouseRows(
			USAGE_SESSION_ROLLUPS_TABLE,
			"organization_id = {targetId:String}",
			{ targetId: organizationId },
		);
		expect(await countRows(sessionId)).toBe(0);
	});
});

function clickHouseTime(agoMs: number): string {
	return new Date(Date.now() - agoMs)
		.toISOString()
		.replace("T", " ")
		.replace("Z", "");
}

function rollupKey(sessionId: string, source: string = "claude_code") {
	return { organizationId, sessionId, source, userId };
}

async function upload(
	sessionId: string,
	generation: string,
	events: UsageEvent[],
	replaceAbsentEvents = false,
	source: UsageEventSource = "claude_code",
	organization = organizationId,
): Promise<void> {
	await ingestRudelSessionAnalytics(executor, [
		sessionAnalyticsRow(
			sessionId,
			organization,
			source,
			"2026-09-04 08:00:00.000",
		),
	]);
	const owned = events.map((event) => ({
		...event,
		organizationId: organization,
	}));
	await writeUsageExtraction(executor, {
		contentSha256: "a".repeat(64),
		extraction: {
			diagnostics: [],
			events: owned,
			receipt: {
				checksum: "d".repeat(64),
				complete: true,
				eventCount: owned.length,
				eventIdentityVersion: USAGE_EVENT_IDENTITY_VERSION,
				extractionVersion: USAGE_EVENT_EXTRACTION_VERSION,
				modelRateCardVersion: USAGE_EVENT_MODEL_RATE_CARD_VERSION,
			},
			status: "complete",
		},
		filterVersion: 1,
		generation,
		ingestedAt: new Date("2026-09-04T08:00:00.000Z"),
		organizationId: organization,
		replaceAbsentEvents,
		sessionDate: new Date("2026-09-01T08:00:00.000Z"),
		sessionId,
		source,
		userId,
	});
}

async function readRollups(sessionId: string) {
	return executor.query<Record<string, unknown>>({
		query: `SELECT * FROM ${USAGE_SESSION_ROLLUPS_TABLE} FINAL WHERE organization_id = {organizationId:String} AND session_id = {sessionId:String}`,
		query_params: { organizationId, sessionId },
	});
}

async function countRows(
	sessionId: string,
	organization = organizationId,
): Promise<number> {
	const [row] = await executor.query<{ rows: number }>({
		query: `SELECT count() AS rows FROM ${USAGE_SESSION_ROLLUPS_TABLE} FINAL WHERE organization_id = {organization:String} AND session_id = {sessionId:String}`,
		query_params: { organization, sessionId },
	});
	return Number(row?.rows ?? 0);
}

function usageEvent(
	sessionId: string,
	index: string,
	overrides: Partial<UsageEvent> = {},
): UsageEvent {
	return {
		agentId: "main",
		cacheReadInputTokens: 2,
		cacheWrite1hInputTokens: 3,
		cacheWriteInputTokens: 7,
		cacheWrite5mInputTokens: 4,
		contextInputTokens: 19,
		duplicateObservationCount: 0,
		eventId: index.padStart(64, "e"),
		firstObservedLine: Number(index),
		identityKind: "message_id",
		inferenceGeo: "",
		inferenceSpeed: "",
		lineageId: "main",
		modelProvider: "anthropic",
		modelStatus: "resolved",
		occurredAt: `2026-09-01T08:0${index}:00.000Z`,
		organizationId,
		outputTokens: 5,
		parentLineageId: "",
		qualityFlags: [],
		rawModel: "claude-sonnet-4-5-20250929",
		reasoningOutputTokens: 0,
		resolvedModel: "claude-sonnet-4-5-20250929",
		serviceTier: "standard",
		sessionId,
		source: "claude_code",
		tokenSource: "provider_increment",
		uncachedInputTokens: 10,
		usageDate: "2026-09-01",
		userId,
		...overrides,
	};
}

function sessionAnalyticsRow(
	sessionId: string,
	organization: string,
	source: string,
	ingestedAt: string,
): RudelSessionAnalyticsRow {
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
		ingested_at: ingestedAt,
		input_tokens: "0",
		last_interaction_date: "2026-09-04 08:00:00.000",
		long_pauses: 0,
		median_period_sec: 1,
		model_used: "",
		normal_responses: 1,
		organization_id: organization,
		output_tokens: "0",
		package_name: "rudel",
		package_type: "bun",
		project_path: "/workspace/rudel",
		quick_responses: 0,
		revision: ingestedAt.startsWith("2026-09") ? "1" : "2",
		session_archetype: "standard",
		session_date: "2026-09-01 08:00:00.000",
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
	};
}
