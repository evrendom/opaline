import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { ingestRudelGeminiSessions } from "../generated/chkit-ingest.js";
import type { RudelSessionAnalyticsRow } from "../generated/chkit-types.js";
import { createTestExecutor, waitForQuery } from "./helpers/executor.js";

setDefaultTimeout(120_000);

const testPrefix = `gemini_mv_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const orgId = `org_${testPrefix}`;
const executor = createTestExecutor();

afterAll(async () => {
	for (const table of ["rudel.gemini_sessions", "rudel.session_analytics"]) {
		await executor
			.execute(
				`DELETE FROM ${table} WHERE organization_id = '${orgId}' SETTINGS lightweight_deletes_sync = 0`,
			)
			.catch(() => {});
	}
});

// A Gemini session as the Mac app stores it: translated into Claude Code's
// transcript shape (see @rudel/agent-adapters gemini).
const content = [
	{
		type: "user",
		timestamp: "2026-11-21T17:00:00.000Z",
		message: { role: "user", content: "Fix the test" },
	},
	{
		type: "assistant",
		timestamp: "2026-11-21T17:03:00.000Z",
		message: {
			id: "gemini-s1-g1",
			model: "gemini-4-neon",
			usage: {
				input_tokens: 4000,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 8000,
				output_tokens: 500,
			},
			content: [
				{
					type: "tool_use",
					id: "c1",
					name: "Bash",
					input: { command: "bun test" },
				},
			],
		},
	},
	{
		type: "user",
		timestamp: "2026-11-21T17:03:05.000Z",
		message: {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "c1",
					content: "1 fail",
					is_error: true,
				},
			],
		},
	},
]
	.map((line) => JSON.stringify(line))
	.join("\n");

test("a Gemini session lands in session_analytics under its own source, read as Claude Code's shape", async () => {
	const now = new Date().toISOString().replace("Z", "");
	const sessionId = `${testPrefix}_s1`;
	await ingestRudelGeminiSessions(executor, [
		{
			content,
			filter_version: 0,
			git_branch: null,
			git_remote: "github.com/testorg/app",
			git_sha: null,
			ingested_at: now,
			revision: (BigInt(Date.now()) << 16n).toString(),
			last_interaction_date: now,
			organization_id: orgId,
			package_name: "",
			package_type: "",
			project_path: "/workspace/app",
			session_date: now,
			session_id: sessionId,
			subagents: {},
			tag: null,
			user_id: "user_gemini",
		},
	]);
	const [row] = await waitForQuery<RudelSessionAnalyticsRow>(
		executor,
		`SELECT * FROM rudel.session_analytics FINAL WHERE organization_id = '${orgId}' AND session_id = '${sessionId}'`,
	);
	expect(row).toMatchObject({
		source: "gemini",
		model_used: "gemini-4-neon",
		input_tokens: 12000,
		cache_read_input_tokens: 8000,
		output_tokens: 500,
		error_count: 1,
		actual_duration_min: 3,
	});
});
