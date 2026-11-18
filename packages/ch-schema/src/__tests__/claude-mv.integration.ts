import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ingestRudelClaudeSessions } from "../generated/chkit-ingest.js";
import type {
	RudelClaudeSessionsRow,
	RudelSessionAnalyticsRow,
} from "../generated/chkit-types.js";
import { withSessionFilter } from "../mv-session-filter.js";
import { CLAUDE_SESSION_ANALYTICS_MV_SQL } from "../mv-sql/claude-session-analytics.js";
import { createTestExecutor, waitForQuery } from "./helpers/executor.js";

setDefaultTimeout(120_000);

const testPrefix = `claude_mv_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const orgId = `org_${testPrefix}`;
const executor = createTestExecutor();

afterAll(async () => {
	for (const table of ["rudel.claude_sessions", "rudel.session_analytics"]) {
		await executor
			.execute(
				`DELETE FROM ${table} WHERE organization_id = '${orgId}' SETTINGS lightweight_deletes_sync = 0`,
			)
			.catch(() => {});
	}
});

function transcript(includeTask: boolean): string {
	return [
		{
			timestamp: "2026-08-21T10:00:00.000Z",
			type: "user",
			message: { content: "review this" },
		},
		{
			timestamp: "2026-08-21T10:00:01.000Z",
			type: "assistant",
			message: {
				id: "assistant-1",
				model: "claude-opus-4-1",
				usage: {
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
					input_tokens: 10,
					output_tokens: 5,
				},
				content: includeTask
					? [{ type: "tool_use", name: "Task", subagent_type: "Explore" }]
					: [],
			},
		},
	]
		.map((line) => JSON.stringify(line))
		.join("\n");
}

async function derive(input: {
	includeTask: boolean;
	sessionId: string;
	subagents: Record<string, string>;
}): Promise<RudelSessionAnalyticsRow> {
	const now = new Date().toISOString().replace("Z", "");
	const row: RudelClaudeSessionsRow = {
		content: transcript(input.includeTask),
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
		project_path: "/workspace/myapp",
		session_date: now,
		session_id: input.sessionId,
		subagents: input.subagents,
		tag: "claude-subagent-test",
		user_id: "user_claude_subagent",
	};
	await ingestRudelClaudeSessions(executor, [row]);
	const results = await waitForQuery<RudelSessionAnalyticsRow>(
		executor,
		withSessionFilter(CLAUDE_SESSION_ANALYTICS_MV_SQL, {
			organizationId: orgId,
			sessionId: input.sessionId,
		}),
	);
	const analytics = results[0];
	if (!analytics) throw new Error("no Claude analytics row produced");
	return analytics;
}

describe("claude_session_analytics_mv subagent semantics", () => {
	test("counts persisted sidecar entries", async () => {
		const analytics = await derive({
			includeTask: false,
			sessionId: `${testPrefix}_sidecars`,
			subagents: { agentA: "result A", agentB: "result B" },
		});

		expect(analytics.subagent_count).toBe(2);
		expect(analytics.subagent_types).toEqual([]);
		expect(analytics.native_subagents).toEqual([
			["agentA", ""],
			["agentB", ""],
		]);
	});

	test("persists each sidecar's own latest model without inheriting the parent", async () => {
		const analytics = await derive({
			includeTask: false,
			sessionId: `${testPrefix}_models`,
			subagents: {
				z: JSON.stringify({ type: "user", message: { model: "not-a-model" } }),
				a: [
					JSON.stringify({
						type: "assistant",
						message: { model: "claude-haiku-4-5" },
					}),
					JSON.stringify({
						type: "assistant",
						message: { model: "claude-sonnet-4-5" },
					}),
					JSON.stringify({ type: "assistant", message: {} }),
				].join("\n"),
			},
		});
		expect(analytics.native_subagents).toEqual([
			["a", "claude-sonnet-4-5"],
			["z", ""],
		]);
	});

	test("keeps attempt-derived types descriptive when no sidecar persisted", async () => {
		const analytics = await derive({
			includeTask: true,
			sessionId: `${testPrefix}_mapless_task`,
			subagents: {},
		});

		expect(analytics.subagent_count).toBe(0);
		expect(analytics.subagent_types).toEqual(["Explore"]);
	});

	test("reports zero for a session with no delegation", async () => {
		const analytics = await derive({
			includeTask: false,
			sessionId: `${testPrefix}_none`,
			subagents: {},
		});

		expect(analytics.subagent_count).toBe(0);
		expect(analytics.subagent_types).toEqual([]);
	});
});
