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
	clearUsageRollupReadiness,
	refreshUsageSessionRollups,
} from "../services/usage-session-rollup.service.js";

setDefaultTimeout(30_000);

const runId = crypto.randomUUID();
const organizationId = `subagent_rows_org_${runId}`;
const userId = `subagent_rows_user_${runId}`;
const parentId = `subagent_rows_parent_${runId}`;
const plainId = `subagent_rows_plain_${runId}`;
const day = "2026-09-21";
const range = { end_date: day, start_date: day };
const executor = createClickHouseExecutor({
	database: "default",
	password: process.env.CLICKHOUSE_PASSWORD || "",
	url: process.env.CLICKHOUSE_URL || "http://localhost:8123",
	username:
		process.env.CLICKHOUSE_USERNAME || process.env.CLICKHOUSE_USER || "default",
});
const environment = [
	"SKILL_ANALYTICS_CUTOVER_MODE",
	"USAGE_EVENT_ANALYTICS_CUTOVER_MODE",
	"USAGE_ROLLUP_ORG_IDS",
] as const;
const previous = Object.fromEntries(
	environment.map((key) => [key, process.env[key]]),
);

let eventCount = 0;
function event(
	sessionId: string,
	generation: string,
	agentId: string,
	occurredAt: string,
	model: string,
): RudelUsageEventsRow {
	eventCount += 1;
	return {
		agent_id: agentId,
		cache_read_input_tokens: "1000",
		cache_write_1h_input_tokens: "0",
		cache_write_5m_input_tokens: "0",
		recorded_cache_write_5m_input_tokens: null,
		recorded_cache_write_1h_input_tokens: null,
		cache_write_input_tokens: null,
		content_sha256: "c".repeat(64),
		context_input_tokens: "3000",
		duplicate_observation_count: 0,
		event_id: eventCount.toString(16).padStart(64, "0"),
		event_identity_version: 1,
		event_version: generation,
		extraction_version: 1,
		filter_version: 1,
		first_observed_line: eventCount,
		has_valid_timestamp: 1,
		identity_kind: "message_id",
		inference_geo: "",
		inference_speed: "",
		ingested_at: `${day} 09:0${generation}:00.000`,
		is_deleted: 0,
		lineage_id: agentId,
		model_rate_card_version: "2026-08-05",
		model_status: "resolved",
		model_provider: "anthropic",
		occurred_at: `${day} ${occurredAt}:00.000`,
		organization_id: organizationId,
		output_tokens: "500",
		parent_lineage_id: "",
		quality_flags: [],
		raw_model: model,
		reasoning_output_tokens: "0",
		receipt_checksum: "0".repeat(64),
		receipt_event_count: 0,
		receipt_is_complete: 0,
		record_kind: "event",
		resolved_model: model,
		service_tier: "standard",
		session_id: sessionId,
		source: "claude_code",
		token_source: "provider_increment",
		uncached_input_tokens: "2000",
		usage_date: day,
		user_id: userId,
	};
}

function receipt(
	sessionId: string,
	generation: string,
	events: number,
): RudelUsageEventsRow {
	return {
		...event(sessionId, generation, "main", "00:00", ""),
		cache_read_input_tokens: "0",
		context_input_tokens: "0",
		event_id: "f".repeat(64),
		output_tokens: "0",
		uncached_input_tokens: "0",
		has_valid_timestamp: 0,
		identity_kind: "receipt",
		model_status: "missing",
		occurred_at: "1970-01-01 00:00:00.000",
		receipt_checksum: "d".repeat(64),
		receipt_event_count: events,
		receipt_is_complete: 1,
		record_kind: "receipt",
	};
}

function session(
	sessionId: string,
	sessionDate: string,
	overrides: Partial<RudelSessionAnalyticsRow> = {},
): RudelSessionAnalyticsRow {
	return {
		actual_duration_min: 25,
		avg_period_sec: 1,
		cache_creation_input_tokens: "0",
		cache_read_input_tokens: "0",
		error_count: 2,
		filter_version: 1,
		git_branch: "main",
		git_remote: "https://github.com/rudel/test.git",
		git_sha: null,
		has_commit: 0,
		human_duration_sec: 0,
		inference_duration_sec: 0,
		ingested_at: `${day} 09:00:00.000`,
		input_tokens: "0",
		last_interaction_date: `${day} 08:30:00.000`,
		long_pauses: 0,
		median_period_sec: 1,
		model_used: "claude-sonnet-4-5",
		native_subagents: [],
		normal_responses: 1,
		organization_id: organizationId,
		output_tokens: "0",
		package_name: "rudel",
		package_type: "bun",
		project_path: "/workspace/rudel",
		quick_responses: 0,
		revision: "1",
		session_date: `${day} ${sessionDate}:00.000`,
		session_id: sessionId,
		skills: [],
		slash_commands: [],
		source: "claude_code",
		subagent_count: 0,
		subagent_types: [],
		success_score: 80,
		tag: null,
		total_interactions: 3,
		total_tokens: "0",
		used_plan_mode: 0,
		user_id: userId,
		...overrides,
	};
}

beforeAll(async () => {
	process.env.SKILL_ANALYTICS_CUTOVER_MODE = "off";
	process.env.USAGE_EVENT_ANALYTICS_CUTOVER_MODE = "all";
	process.env.USAGE_ROLLUP_ORG_IDS = "none";
	await ingestRudelSessionAnalytics(
		executor,
		[
			session(parentId, "08:00", {
				native_subagents: [
					["explorer", "claude-haiku-4-5"],
					["reviewer", ""],
				],
				skills: ["release"],
				subagent_count: 2,
				subagent_types: ["Explore", "general-purpose"],
			}),
			session(plainId, "07:00"),
		],
		{ validate: true },
	);
	await ingestRudelUsageEvents(
		executor,
		[
			event(parentId, "1", "main", "08:00", "claude-sonnet-4-5"),
			event(parentId, "1", "superseded", "08:01", "claude-sonnet-4-5"),
			receipt(parentId, "1", 2),
			event(parentId, "2", "main", "08:00", "claude-sonnet-4-5"),
			event(parentId, "2", "explorer", "08:05", "claude-haiku-4-5"),
			event(parentId, "2", "explorer", "08:12", "claude-haiku-4-5"),
			event(parentId, "2", "reviewer", "08:20", "claude-sonnet-4-5"),
			receipt(parentId, "2", 4),
			event(plainId, "1", "main", "07:00", "claude-sonnet-4-5"),
			receipt(plainId, "1", 1),
		],
		{ validate: true },
	);
});

afterAll(async () => {
	for (const key of environment) {
		if (previous[key] === undefined) delete process.env[key];
		else process.env[key] = previous[key];
	}
	clearUsageRollupReadiness();
	for (const table of [
		"rudel.usage_events",
		"rudel.session_analytics",
		"rudel.usage_session_rollups",
	])
		await executor
			.execute({
				query: `DELETE FROM ${table} WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
				query_params: { organizationId },
			})
			.catch(() => {});
	await executor.close();
});

async function listed() {
	const rows = await getSessionAnalytics(organizationId, {
		...range,
		limit: 50,
	});
	return rows.map((row) => ({
		agent: row.subagent_of?.agent_id ?? null,
		cost: row.estimated_cost,
		date: row.session_date,
		duration: row.duration_min,
		errors: row.error_count,
		id: row.session_id,
		kind: row.subagent_of?.kind ?? null,
		model: row.model_used,
		parent: row.subagent_of?.session_id ?? null,
		tokens: row.total_tokens,
	}));
}

describe("subagent rows in the sessions list", () => {
	test("lists each subagent inside a transcript as its own row from the latest generation", async () => {
		const rows = await listed();
		expect(
			rows.map(({ cost, ...row }) => ({ ...row, priced: cost !== null })),
		).toEqual([
			{
				agent: "reviewer",
				date: `${day}T08:20:00Z`,
				duration: 0,
				errors: undefined,
				id: parentId,
				kind: "agent",
				model: "claude-sonnet-4-5",
				parent: parentId,
				priced: true,
				tokens: 3500,
			},
			{
				agent: "explorer",
				date: `${day}T08:05:00Z`,
				duration: 7,
				errors: undefined,
				id: parentId,
				kind: "agent",
				model: "claude-haiku-4-5",
				parent: parentId,
				priced: true,
				tokens: 7000,
			},
			{
				agent: null,
				date: `${day}T08:00:00Z`,
				duration: 25,
				errors: 2,
				id: parentId,
				kind: null,
				model: "claude-sonnet-4-5",
				parent: null,
				priced: true,
				tokens: 14000,
			},
			{
				agent: null,
				date: `${day}T07:00:00Z`,
				duration: 25,
				errors: 2,
				id: plainId,
				kind: null,
				model: "claude-sonnet-4-5",
				parent: null,
				priced: true,
				tokens: 3500,
			},
		]);
		const [reviewer, explorer, parent] = rows;
		expect((reviewer?.cost ?? 0) + (explorer?.cost ?? 0)).toBeLessThan(
			parent?.cost ?? 0,
		);
	});

	test("prices subagents the same from the rollups as from the events", async () => {
		const fromEvents = await listed();
		await refreshUsageSessionRollups(
			executor,
			[parentId, plainId].map((sessionId) => ({
				organizationId,
				sessionId,
				source: "claude_code",
				userId,
			})),
		);
		process.env.USAGE_ROLLUP_ORG_IDS = organizationId;
		clearUsageRollupReadiness();
		try {
			expect(await listed()).toEqual(fromEvents);
		} finally {
			process.env.USAGE_ROLLUP_ORG_IDS = "none";
			clearUsageRollupReadiness();
		}
	});

	test("keeps subagents out of a skill's sessions and pages over every row", async () => {
		expect(
			(
				await getSessionAnalytics(organizationId, {
					...range,
					skill_name: "release",
				})
			).map((row) => [row.session_id, row.subagent_of?.kind ?? null]),
		).toEqual([[parentId, null]]);
		const page = await getSessionAnalytics(organizationId, {
			...range,
			limit: 2,
			offset: 1,
		});
		expect(page.map((row) => row.subagent_of?.agent_id ?? null)).toEqual([
			"explorer",
			null,
		]);
	});
});
