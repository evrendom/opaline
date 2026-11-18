import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ingestRudelCodexSessions } from "../generated/chkit-ingest.js";
import type {
	RudelCodexSessionsRow,
	RudelSessionAnalyticsRow,
} from "../generated/chkit-types.js";
import { withSessionFilter } from "../mv-session-filter.js";
import { CODEX_SESSION_ANALYTICS_MV_SQL } from "../mv-sql/codex-session-analytics.js";
import { RETIRED_SESSION_ANALYTICS_COLUMNS } from "../session-analytics-mv.js";
import { createTestExecutor, waitForQuery } from "./helpers/executor.js";

setDefaultTimeout(120_000);

const testPrefix = `codex_mv_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const testId = `${testPrefix}_clean`;
const errorTestId = `${testPrefix}_errors`;
const skillTestId = `${testPrefix}_skills`;
const underflowTestId = `${testPrefix}_underflow`;
const identityTestId = `${testPrefix}_identity`;
const modernSubagentTestId = `${testPrefix}_modern_subagents`;
const cappedSubagentTestId = `${testPrefix}_capped_subagents`;
const failedSubagentTestId = `${testPrefix}_failed_subagent`;
// Unique per run. All fixtures share it, so afterAll can clean by organization.
const orgId = `org_${testPrefix}`;

const executor = createTestExecutor();

afterAll(async () => {
	// The incremental MV writes a separate target row on insert; deleting its source
	// row does not propagate. Clean both tables so `test:integration` does not
	// accumulate fixtures in persistent environments.
	// The executor reuses one ClickHouse session, so commands must be sequential;
	// concurrent deletes fail with SESSION_IS_LOCKED.
	// Best-effort like ingest-clickhouse's cleanup: rows are scoped to this run's
	// unique org id, so a delete that times out under shared-cluster mutation
	// pressure leaks only inert fixtures — it must not fail the gate.
	for (const table of ["rudel.codex_sessions", "rudel.session_analytics"]) {
		await executor
			.execute(
				`DELETE FROM ${table} WHERE organization_id = '${orgId}' SETTINGS lightweight_deletes_sync = 0`,
			)
			.catch(() => {});
	}
});

// Runs the deployed MV SELECT directly against the inserted row.
//
// The SQL is imported from the same constant `codex-sessions.ts` passes to
// `materializedView({ as })`, so this test cannot drift from what is deployed. It
// previously held a hand-copied duplicate that had silently diverged five ways
// (LIKE vs ILIKE, no _skills CTE, no exploration archetype branch, no skills term in
// success_score, no `info IS NOT NULL` guard) — it was asserting against SQL that was
// not running anywhere.
//
// Scope: this exercises the MV's *query*, not its wiring. The insert trigger, the
// `TO rudel.session_analytics` target, and ReplacingMergeTree collapse are covered by
// apps/api/src/__tests__/session-analytics-values.integration.ts (real adapter → MV →
// FINAL) and apps/cli/src/__tests__/api-upload.integration.ts (CLI → API → ClickHouse
// with auth).
const MV_QUERY = withSessionFilter(CODEX_SESSION_ANALYTICS_MV_SQL, {
	organizationId: orgId,
	sessionId: testId,
});

function codexUnderflowTranscript(): string {
	const startedAt = "2026-03-02T04:29:38.576Z";
	const errorLines = Array.from({ length: 10 }, (_, index) => ({
		timestamp: `2026-03-02T04:29:${String(40 + index).padStart(2, "0")}.000Z`,
		type: "response_item",
		payload: {
			type: "function_call_output",
			call_id: `call_error_${index}`,
			output: `TypeError: failure ${index}`,
		},
	}));

	return [
		{
			timestamp: startedAt,
			type: "session_meta",
			payload: { model_provider: "openai" },
		},
		...errorLines,
		{
			timestamp: "2026-03-02T04:29:55.000Z",
			type: "event_msg",
			payload: {
				type: "token_count",
				info: {
					total_token_usage: {
						input_tokens: 1_600_000,
						output_tokens: 100,
						cached_input_tokens: 0,
					},
				},
			},
		},
	]
		.map((line) => JSON.stringify(line))
		.join("\n");
}

function codexSubagentTranscript(input: {
	capped?: boolean;
	failedOnly?: boolean;
	modernCount?: number;
}): string {
	const lines: unknown[] = [
		{
			timestamp: "2026-08-21T10:00:00.000Z",
			type: "session_meta",
			payload: { model_provider: "openai" },
		},
	];
	if (input.capped) {
		for (let index = 0; index < 8_005; index += 1) {
			lines.push({ type: "event_msg", payload: { type: "noise", index } });
		}
	}

	const modernCount = input.modernCount ?? 0;
	for (let index = 0; index < modernCount; index += 1) {
		const callId = `modern_spawn_${index}`;
		lines.push({
			timestamp: `2026-08-21T10:00:${String(index + 1).padStart(2, "0")}.000Z`,
			type: "response_item",
			payload: {
				type: "function_call",
				name: "spawn_agent",
				arguments: JSON.stringify({
					task_name: `review_${index}`,
					...(index === 0 ? { model: "gpt-5.6-sol" } : {}),
				}),
				call_id: callId,
			},
		});
		lines.push({
			timestamp: `2026-08-21T10:01:${String(index + 1).padStart(2, "0")}.000Z`,
			type: "response_item",
			payload: {
				type: "function_call_output",
				id: `output_${index}`,
				call_id: callId,
				output: JSON.stringify({ task_name: `/root/review_${index}` }),
			},
		});
	}

	const oldCallId = input.failedOnly ? "failed_explorer" : "old_explorer";
	if (input.capped || input.failedOnly) {
		lines.push({
			timestamp: "2026-08-21T10:02:00.000Z",
			type: "response_item",
			payload: {
				type: "function_call",
				name: "spawn_agent",
				arguments: JSON.stringify({
					agent_type: "explorer",
					message: "inspect",
				}),
				call_id: oldCallId,
			},
		});
		lines.push({
			timestamp: "2026-08-21T10:02:01.000Z",
			type: "response_item",
			payload: {
				type: "function_call_output",
				call_id: oldCallId,
				output: input.failedOnly
					? "Cannot spawn another agent"
					: JSON.stringify({ agent_id: "agent-old" }),
			},
		});
	}

	lines.push(
		{
			timestamp: "2026-08-21T10:03:00.000Z",
			type: "response_item",
			payload: {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: '{"name":"spawn_agent"}' }],
			},
		},
		{
			timestamp: "2026-08-21T10:03:01.000Z",
			type: "response_item",
			payload: {
				type: "function_call_output",
				call_id: "wait_agent_call",
				output: JSON.stringify({ task_name: "/root/not-a-spawn" }),
			},
		},
		{
			timestamp: "2026-08-21T10:03:02.000Z",
			type: "event_msg",
			payload: { type: "sub_agent_activity", agent_id: "decoy" },
		},
	);
	return lines.map((line) => JSON.stringify(line)).join("\n");
}

async function readSubagentAnalytics(
	sessionId: string,
	content: string,
): Promise<RudelSessionAnalyticsRow> {
	const now = new Date().toISOString().replace("Z", "");
	await ingestRudelCodexSessions(executor, [
		{
			content,
			filter_version: 0,
			git_branch: "main",
			git_remote: "github.com/testorg/testproject",
			git_sha: null,
			ingested_at: now,
			revision: (BigInt(Date.now()) << 16n).toString(),
			last_interaction_date: now,
			organization_id: orgId,
			package_name: "myapp",
			package_type: "package.json",
			project_path: "/Users/testuser/projects/myapp",
			session_date: now,
			session_id: sessionId,
			tag: "codex-subagent-test",
			user_id: "user_subagent",
		},
	]);
	const results = await waitForQuery<RudelSessionAnalyticsRow>(
		executor,
		withSessionFilter(CODEX_SESSION_ANALYTICS_MV_SQL, {
			organizationId: orgId,
			sessionId,
		}),
	);
	const analytics = results[0];
	if (!analytics) throw new Error("no subagent analytics row produced");
	return analytics;
}

describe("codex_session_analytics_mv", () => {
	test("counts successful modern spawns and ignores non-spawn task envelopes", async () => {
		const analytics = await readSubagentAnalytics(
			modernSubagentTestId,
			codexSubagentTranscript({ modernCount: 9 }),
		);

		expect(analytics.subagent_count).toBe(9);
		expect(analytics.subagent_types).toEqual([]);
		expect(analytics.native_subagents).toEqual(
			Array.from({ length: 9 }, (_, index) => [
				`call:modern_spawn_${index}`,
				index === 0 ? "gpt-5.6-sol" : "",
			]),
		);
	}, 120_000);

	test("extracts an old successful role beyond the line cap", async () => {
		const analytics = await readSubagentAnalytics(
			cappedSubagentTestId,
			codexSubagentTranscript({ capped: true }),
		);

		expect(analytics.subagent_count).toBe(1);
		expect(analytics.subagent_types).toEqual(["explorer"]);
	}, 120_000);

	test("does not count a failed spawn attempt or expose its requested role", async () => {
		const analytics = await readSubagentAnalytics(
			failedSubagentTestId,
			codexSubagentTranscript({ failedOnly: true }),
		);

		expect(analytics.subagent_count).toBe(0);
		expect(analytics.subagent_types).toEqual([]);
		expect(analytics.native_subagents).toEqual([]);
	}, 120_000);

	test("derives correct token counts from Codex token_count events", async () => {
		const fixtureContent = await readFile(
			resolve(import.meta.dir, "fixtures", "codex-session.jsonl"),
			"utf-8",
		);

		const now = new Date().toISOString().replace("Z", "");

		const row: RudelCodexSessionsRow = {
			session_date: now,
			last_interaction_date: now,
			session_id: testId,
			organization_id: orgId,
			project_path: "/Users/testuser/projects/myapp",
			git_remote: "github.com/testorg/testproject",
			package_name: "myapp",
			package_type: "package.json",
			content: fixtureContent,
			filter_version: 0,
			revision: "1",
			ingested_at: now,
			user_id: "user_test",
			git_branch: "main",
			git_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			tag: "codex-mv-test",
		};

		await ingestRudelCodexSessions(executor, [row]);

		// Run the MV query directly against the inserted row
		const results = await waitForQuery<RudelSessionAnalyticsRow>(
			executor,
			MV_QUERY,
		);

		expect(results).toHaveLength(1);
		const a = results[0];
		if (!a) throw new Error("no clean analytics row produced");

		// Source
		expect(a.source).toBe("codex");

		// Token extraction from last token_count event's total_token_usage:
		// input_tokens=55031, output_tokens=428, cached_input_tokens=34304
		expect(Number(a.input_tokens)).toBe(55031);
		expect(Number(a.output_tokens)).toBe(428);
		expect(Number(a.total_tokens)).toBe(55031 + 428);
		expect(Number(a.cache_read_input_tokens)).toBe(34304);
		expect(Number(a.cache_creation_input_tokens)).toBe(0);

		// Model attribution: turn_context.payload.model = "gpt-5.3-codex"
		// takes precedence over session_meta.payload.model_provider = "openai"
		expect(a.model_used).toBe("gpt-5.3-codex");

		// Repo metadata passes through from the row columns
		expect(a.git_remote).toBe("github.com/testorg/testproject");
		expect(a.package_name).toBe("myapp");
		expect(a.package_type).toBe("package.json");

		expectNoRetiredColumns(a);

		// Fixture has response_item + event_msg lines
		expect(a.total_interactions).toBeGreaterThan(0);

		// Session duration is ~127 minutes (04:29 to 06:36)
		expect(a.actual_duration_min).toBeGreaterThan(100);

		// The codex skills regex looks for "name":"exec_command" ... skills/<x>/SKILL.
		// This fixture invokes no skill, so the array is empty.
		expect(a.skills).toEqual([]);

		// Clean session has no tool errors
		expect(a.error_count).toBe(0);
	}, 120_000);

	test("counts errors from non-zero exit codes and error text in tool output", async () => {
		const fixtureContent = await readFile(
			resolve(import.meta.dir, "fixtures", "codex-session-with-errors.jsonl"),
			"utf-8",
		);

		const now = new Date().toISOString().replace("Z", "");

		const row: RudelCodexSessionsRow = {
			session_date: now,
			last_interaction_date: now,
			session_id: errorTestId,
			organization_id: orgId,
			project_path: "/Users/testuser/projects/myapp",
			git_remote: "github.com/testorg/testproject",
			package_name: "myapp",
			package_type: "package.json",
			content: fixtureContent,
			filter_version: 0,
			revision: "1",
			ingested_at: now,
			user_id: "user_test",
			git_branch: "main",
			git_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			tag: "codex-mv-error-test",
		};

		await ingestRudelCodexSessions(executor, [row]);

		const results = await waitForQuery<RudelSessionAnalyticsRow>(
			executor,
			withSessionFilter(CODEX_SESSION_ANALYTICS_MV_SQL, {
				organizationId: orgId,
				sessionId: errorTestId,
			}),
		);

		expect(results).toHaveLength(1);
		const a = results[0];
		if (!a) throw new Error("no error analytics row produced");

		// Fixture has 3 function_call_output items:
		// 1. exit_code:1 with "error TS2345" text -> counts as 1 (non-zero exit code)
		//    "error TS2345:" doesn't match ILIKE '%Error:%' (no contiguous "Error:" substring)
		// 2. exit_code:0 with "TypeError: ..." text -> counts as 1 (ILIKE '%Error:%' matches "TypeError:")
		// 3. exit_code:0 with clean "Success" text -> counts as 0
		// Total: 2 errors
		expect(a.error_count).toBe(2);
		expectNoRetiredColumns(a);
	}, 120_000);

	test("detects real skill invocations without duplicates or decoys", async () => {
		const fixtureContent = await readFile(
			resolve(import.meta.dir, "fixtures", "codex-session-with-skills.jsonl"),
			"utf-8",
		);

		const now = new Date().toISOString().replace("Z", "");
		const row: RudelCodexSessionsRow = {
			session_date: now,
			last_interaction_date: now,
			session_id: skillTestId,
			organization_id: orgId,
			project_path: "/Users/testuser/projects/myapp",
			git_remote: "github.com/testorg/testproject",
			package_name: "myapp",
			package_type: "package.json",
			content: fixtureContent,
			filter_version: 0,
			revision: "1",
			ingested_at: now,
			user_id: "user_test",
			git_branch: "main",
			git_sha: "cccccccccccccccccccccccccccccccccccccccc",
			tag: "codex-mv-skill-test",
		};

		await ingestRudelCodexSessions(executor, [row]);

		const results = await waitForQuery<RudelSessionAnalyticsRow>(
			executor,
			withSessionFilter(CODEX_SESSION_ANALYTICS_MV_SQL, {
				organizationId: orgId,
				sessionId: skillTestId,
			}),
		);

		expect(results).toHaveLength(1);
		const analytics = results[0];
		if (!analytics) throw new Error("no skill analytics row produced");

		// The fixture invokes testing-bun twice and clickhouse-query once through
		// exec_command. Paths in a read_file call and assistant prose are decoys.
		expect(analytics.skills).toEqual(["testing-bun", "clickhouse-query"]);
		expectNoRetiredColumns(analytics);
	}, 120_000);

	test("clamps a negative success score to zero before the UInt8 cast", async () => {
		const now = new Date().toISOString().replace("Z", "");
		const row: RudelCodexSessionsRow = {
			session_date: now,
			last_interaction_date: now,
			session_id: underflowTestId,
			organization_id: orgId,
			project_path: "/Users/testuser/projects/myapp",
			git_remote: "",
			package_name: "myapp",
			package_type: "package.json",
			content: codexUnderflowTranscript(),
			filter_version: 0,
			revision: "1",
			ingested_at: now,
			user_id: "user_underflow",
			git_branch: "main",
			git_sha: null,
			tag: "codex-mv-underflow-test",
		};

		await ingestRudelCodexSessions(executor, [row]);

		const results = await waitForQuery<RudelSessionAnalyticsRow>(
			executor,
			withSessionFilter(CODEX_SESSION_ANALYTICS_MV_SQL, {
				organizationId: orgId,
				sessionId: underflowTestId,
			}),
		);

		expect(results).toHaveLength(1);
		const analytics = results[0];
		if (!analytics) throw new Error("no underflow analytics row produced");

		expect(analytics.error_count).toBe(10);
		expect(Number(analytics.total_tokens)).toBe(1_600_100);
		expectNoRetiredColumns(analytics);
	}, 120_000);

	test("deduplicates on organization, user, and session identity", async () => {
		const content = await readFile(
			resolve(import.meta.dir, "fixtures", "codex-session.jsonl"),
			"utf-8",
		);
		const now = new Date().toISOString().replace("Z", "");
		const shared = {
			session_date: now,
			last_interaction_date: now,
			session_id: identityTestId,
			organization_id: orgId,
			project_path: "/Users/testuser/projects/myapp",
			git_remote: "github.com/testorg/testproject",
			package_name: "myapp",
			package_type: "package.json",
			content,
			filter_version: 0,
			revision: "1",
			ingested_at: now,
			git_branch: "main",
			git_sha: null,
			tag: "codex-mv-identity-test",
		};
		const rows: RudelCodexSessionsRow[] = [
			{ ...shared, user_id: "user_identity_a" },
			{
				...shared,
				// Keep both raw rows visible despite the source table's older key.
				// The transcript-derived analytics date is still identical.
				session_date: "2026-03-01T04:29:38.576",
				user_id: "user_identity_b",
			},
		];

		await ingestRudelCodexSessions(executor, rows);

		const results = await waitForQuery<RudelSessionAnalyticsRow>(
			executor,
			withSessionFilter(CODEX_SESSION_ANALYTICS_MV_SQL, {
				organizationId: orgId,
				sessionId: identityTestId,
			}),
		);

		expect(results).toHaveLength(2);
		expect(results.map((row) => row.user_id).sort()).toEqual([
			"user_identity_a",
			"user_identity_b",
		]);
	}, 120_000);
});

/** Retirement step 3: the view's query no longer outputs the retired interpretations. */
function expectNoRetiredColumns(row: Record<string, unknown>): void {
	for (const column of RETIRED_SESSION_ANALYTICS_COLUMNS)
		expect(row).not.toHaveProperty(column);
}
