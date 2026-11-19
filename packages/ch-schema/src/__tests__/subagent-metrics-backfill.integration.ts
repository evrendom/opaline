import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
	backfillCensus,
	type ClickHouseConnection,
	readSourceCensus,
	readSubagentDriftCount,
} from "../../scripts/backfill-subagent-metrics.js";
import { resolveClickHouseUsername } from "../clickhouse-connection.js";
import { ingestRudelCodexSessions } from "../generated/chkit-ingest.js";
import type { RudelCodexSessionsRow } from "../generated/chkit-types.js";
import {
	buildCanonicalRevisionDigestSql,
	canonicalSessionRevisionDigest,
} from "../subagent-metrics-backfill.js";
import { createTestExecutor, waitForQuery } from "./helpers/executor.js";

setDefaultTimeout(120_000);

const testPrefix = `subagent_backfill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const orgId = `org_${testPrefix}`;
const executor = createTestExecutor();
const clickHouseUrl = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const connection: ClickHouseConnection = {
	database: process.env.CLICKHOUSE_DB ?? "default",
	password: process.env.CLICKHOUSE_PASSWORD ?? "",
	url: clickHouseUrl,
	username: resolveClickHouseUsername(process.env, clickHouseUrl),
};

afterAll(async () => {
	for (const table of ["rudel.codex_sessions", "rudel.session_analytics"]) {
		await executor
			.execute(
				`DELETE FROM ${table} WHERE organization_id = '${orgId}' SETTINGS lightweight_deletes_sync = 0`,
			)
			.catch(() => {});
	}
});

// Payload key order mirrors real Codex serialization (`type` first, `call_id`
// after `name`/`id`, `output` last). The MV's success pattern tolerates
// inserted fields between those anchors but not reordering, so alphabetized
// fixtures would silently extract nothing.
function transcript(spawnCount: number): string {
	const lines: unknown[] = [
		{
			timestamp: "2026-08-21T10:00:00.000Z",
			type: "session_meta",
			payload: { model_provider: "openai" },
		},
	];
	for (let index = 0; index < spawnCount; index += 1) {
		const callId = `spawn_${index}`;
		lines.push(
			{
				timestamp: `2026-08-21T10:00:${String(index + 1).padStart(2, "0")}.000Z`,
				type: "response_item",
				payload: {
					type: "function_call",
					name: "spawn_agent",
					arguments: JSON.stringify({
						task_name: `task_${index}`,
						model: "gpt-5.6-sol",
					}),
					call_id: callId,
				},
			},
			{
				timestamp: `2026-08-21T10:01:${String(index + 1).padStart(2, "0")}.000Z`,
				type: "response_item",
				payload: {
					type: "function_call_output",
					id: `fco_${index}`,
					call_id: callId,
					output: JSON.stringify({ task_name: `/root/task_${index}` }),
				},
			},
		);
	}
	return lines.map((line) => JSON.stringify(line)).join("\n");
}

function rawRow(input: {
	content: string;
	ingestedAtMs: number;
	sessionDateMs: number;
	sessionId: string;
	userId: string;
}): RudelCodexSessionsRow {
	return {
		content: input.content,
		filter_version: 0,
		git_branch: null,
		git_remote: "github.com/rudel/rudel",
		git_sha: null,
		ingested_at: clickHouseDate(input.ingestedAtMs),
		revision: (BigInt(input.ingestedAtMs) << 16n).toString(),
		last_interaction_date: clickHouseDate(input.sessionDateMs + 60_000),
		organization_id: orgId,
		package_name: "rudel",
		package_type: "package.json",
		project_path: "/workspace/rudel",
		session_date: clickHouseDate(input.sessionDateMs),
		session_id: input.sessionId,
		tag: null,
		user_id: input.userId,
	};
}

function clickHouseDate(timestampMs: number): string {
	return new Date(timestampMs).toISOString().replace("T", " ").replace("Z", "");
}

async function readAnalytics(sessionId: string, userId: string) {
	const rows = await waitForQuery<{
		ingested_at_ms: string;
		subagent_count: number;
		native_subagents: Array<[string, string]>;
	}>(
		executor,
		`SELECT toString(toUnixTimestamp64Milli(ingested_at)) AS ingested_at_ms, subagent_count, native_subagents
		FROM rudel.session_analytics FINAL
		WHERE organization_id = '${orgId}' AND user_id = '${userId}' AND session_id = '${sessionId}' AND source = 'codex'`,
	);
	const row = rows[0];
	if (!row) throw new Error("analytics row not found");
	return row;
}

describe("subagent metrics correction backfill", () => {
	test("stamps exact identities and a later epoch repairs an old-writer straggler", async () => {
		const initialIngestedAtMs = Date.now() - 20_000;
		const sessionDateMs = Date.parse("2026-07-15T10:00:00.000Z");
		const sessionId = `${testPrefix}_straggler`;
		const userId = "user-straggler";
		const initialContent = transcript(1);
		await ingestRudelCodexSessions(executor, [
			rawRow({
				content: initialContent,
				ingestedAtMs: initialIngestedAtMs,
				sessionDateMs,
				sessionId,
				userId,
			}),
		]);

		const initialCensus = await readSourceCensus(
			connection,
			"codex",
			Date.now() + 60_000,
			orgId,
		);
		expect(initialCensus).toHaveLength(1);
		const firstStamp = Date.now() + 1_000;
		await backfillCensus(connection, initialCensus, firstStamp);
		expect(await readAnalytics(sessionId, userId)).toEqual({
			ingested_at_ms: String(firstStamp),
			subagent_count: 1,
			native_subagents: [["call:spawn_0", "gpt-5.6-sol"]],
		});

		const stragglerIngestedAtMs = initialIngestedAtMs + 1_000;
		await ingestRudelCodexSessions(executor, [
			rawRow({
				content: transcript(2),
				ingestedAtMs: stragglerIngestedAtMs,
				sessionDateMs,
				sessionId,
				userId,
			}),
		]);
		expect((await readAnalytics(sessionId, userId)).subagent_count).toBe(1);

		const terminalCensus = await readSourceCensus(
			connection,
			"codex",
			Date.now() + 60_000,
			orgId,
		);
		expect(terminalCensus[0]?.ingested_at_ms).toBe(
			String(stragglerIngestedAtMs),
		);
		expect(await readSubagentDriftCount(connection, terminalCensus)).toBe(1);
		await backfillCensus(connection, terminalCensus, firstStamp + 1);
		expect(await readAnalytics(sessionId, userId)).toEqual({
			ingested_at_ms: String(firstStamp + 1),
			subagent_count: 2,
			native_subagents: [
				["call:spawn_0", "gpt-5.6-sol"],
				["call:spawn_1", "gpt-5.6-sol"],
			],
		});
		expect(await readSubagentDriftCount(connection, terminalCensus)).toBe(0);
	});

	test("keeps cross-user session ids separate and picks the latest month revision", async () => {
		const sharedSessionId = `${testPrefix}_shared`;
		const firstIngestedAtMs = Date.now() - 15_000;
		const secondIngestedAtMs = firstIngestedAtMs + 1_000;
		await ingestRudelCodexSessions(executor, [
			rawRow({
				content: transcript(3),
				ingestedAtMs: secondIngestedAtMs,
				sessionDateMs: Date.parse("2026-08-01T00:00:00.000Z"),
				sessionId: sharedSessionId,
				userId: "user-a",
			}),
			rawRow({
				content: transcript(1),
				ingestedAtMs: firstIngestedAtMs,
				sessionDateMs: Date.parse("2026-07-01T00:00:00.000Z"),
				sessionId: sharedSessionId,
				userId: "user-a",
			}),
			// user-b's revision must not share (organization_id, session_date,
			// session_id) with user-a's: user_id is not in the raw sorting key, so
			// identical keys with equal versions collapse at insert
			// (optimize_on_insert) into one arbitrary survivor. Production cannot
			// produce that state either — organization_id is the uploader's own
			// user id, so one org never carries two user_ids for a session.
			rawRow({
				content: transcript(2),
				ingestedAtMs: secondIngestedAtMs,
				sessionDateMs: Date.parse("2026-08-02T00:00:00.000Z"),
				sessionId: sharedSessionId,
				userId: "user-b",
			}),
		]);

		const census = (
			await readSourceCensus(connection, "codex", Date.now() + 60_000, orgId)
		).filter((row) => row.session_id === sharedSessionId);
		expect(census).toHaveLength(2);
		expect(census.find((row) => row.user_id === "user-a")?.month).toBe(
			"202608",
		);
		await backfillCensus(connection, census, Date.now() + 2_000);
		expect(
			(await readAnalytics(sharedSessionId, "user-a")).subagent_count,
		).toBe(3);
		expect(
			(await readAnalytics(sharedSessionId, "user-b")).subagent_count,
		).toBe(2);
	});

	test("matches the TypeScript canonical digest for multibyte source fields", async () => {
		const sessionId = `${testPrefix}_digest`;
		const userId = "user-digest";
		const ingestedAtMs = Date.now() - 5_000;
		const sessionDateMs = Date.parse("2026-08-20T00:00:00.123Z");
		const content = `${transcript(1)}\n${JSON.stringify({ note: "héllo 🌍" })}`;
		const row = rawRow({
			content,
			ingestedAtMs,
			sessionDateMs,
			sessionId,
			userId,
		});
		await ingestRudelCodexSessions(executor, [row]);
		const digestRows = await executor.query<{ digest: string }>(
			`SELECT ${buildCanonicalRevisionDigestSql("cs", false)} AS digest
			FROM rudel.codex_sessions AS cs
			WHERE organization_id = '${orgId}' AND user_id = '${userId}' AND session_id = '${sessionId}'
				AND toUnixTimestamp64Milli(ingested_at) = ${ingestedAtMs}`,
		);

		expect(digestRows[0]?.digest).toBe(
			canonicalSessionRevisionDigest({
				content,
				filterVersion: 0,
				gitBranch: null,
				gitRemote: row.git_remote,
				gitSha: null,
				lastInteractionDateMs: sessionDateMs + 60_000,
				packageName: row.package_name,
				packageType: row.package_type,
				projectPath: row.project_path,
				sessionDateMs,
				tag: null,
			}),
		);
	});
});
