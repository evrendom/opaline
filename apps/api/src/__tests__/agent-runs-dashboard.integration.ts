import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import assert from "node:assert/strict";
import { getAdapter } from "@rudel/agent-adapters";
import {
	type CostDashboardInput,
	CostDashboardSchema,
} from "@rudel/api-routes";
import { z } from "zod";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { persistSessionLanguageSignalsWithExecutor } from "../services/session-language-signal-persistence.service.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

setDefaultTimeout(60_000);
let server: ApiTestServer;
let eventServer: ApiTestServer;
const users: { id: string; token: string }[] = [];
const run = crypto.randomUUID();
const day = new Date().toISOString().slice(0, 10);
const start = Date.parse(`${day}T00:00:00Z`);
let revision = Date.now();
const ch = getClickhouse();

beforeAll(async () => {
	server = await startApiTestServer({
		USAGE_EVENT_ANALYTICS_CUTOVER_MODE: "off",
	});
	eventServer = await startApiTestServer({
		USAGE_EVENT_ANALYTICS_CUTOVER_MODE: "all",
	});
	for (const name of ["owner", "outsider"]) {
		const response = await fetch(`${server.baseUrl}/api/auth/sign-up/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name,
				email: `${name}-${run}@example.test`,
				password: `test-${run}`,
			}),
		});
		expect(response.status, server.readOutput()).toBe(200);
		const result = z
			.object({ token: z.string(), user: z.object({ id: z.string() }) })
			.parse(await response.json());
		users.push({ id: result.user.id, token: result.token });
	}
});
afterAll(async () => {
	await server?.stop();
	await eventServer?.stop();
	for (const user of users) {
		for (const table of [
			"claude_sessions",
			"session_analytics",
			"session_language_signals",
		])
			await ch.execute({
				query: `ALTER TABLE rudel.${table} DELETE WHERE organization_id = {org:String}`,
				query_params: { org: user.id },
			});
		await sqlClient`DELETE FROM organization WHERE id = ${user.id}`;
		await sqlClient`DELETE FROM "user" WHERE id = ${user.id}`;
	}
});

function transcript(
	duration: number,
	feedback?: string,
	skills = false,
	begin = start,
) {
	const lines: unknown[] = [
		{
			type: "user",
			uuid: "u1",
			sessionId: "runs",
			timestamp: new Date(begin).toISOString(),
			message: { role: "user", content: "Implement the task" },
		},
	];
	if (skills)
		lines.push({
			type: "assistant",
			uuid: "skill",
			sessionId: "runs",
			timestamp: new Date(begin + 1000).toISOString(),
			message: {
				role: "assistant",
				model: "claude-sonnet-4-5",
				content: [
					{
						type: "tool_use",
						id: "skill1",
						name: "Skill",
						input: { skill: "design" },
					},
				],
			},
		});
	lines.push({
		type: "assistant",
		uuid: "a1",
		sessionId: "runs",
		timestamp: new Date(begin + duration * 1000).toISOString(),
		message: {
			role: "assistant",
			id: "m1",
			model: "claude-sonnet-4-5",
			usage: { input_tokens: 10, output_tokens: 5 },
			content: [{ type: "text", text: "Done" }],
		},
	});
	if (feedback !== undefined)
		lines.push({
			type: "user",
			uuid: "u2",
			sessionId: "runs",
			timestamp: new Date(begin + duration * 1000 + 1000).toISOString(),
			message: { role: "user", content: feedback },
		});
	return lines.map((line) => JSON.stringify(line)).join("\n");
}
async function ingest(
	sessionId: string,
	content: string,
	userIndex = 0,
	indexed = true,
) {
	const user = users[userIndex];
	assert(user);
	const adapter = getAdapter("claude_code");
	const timestamps = adapter.extractTimestamps(content);
	assert(timestamps);
	const ingestedAt = new Date(++revision);
	const rawRevision = (BigInt(ingestedAt.getTime()) << 16n).toString();
	const input = {
		content,
		sessionId,
		projectPath: "/test/agent-runs",
		source: "claude_code" as const,
	};
	await adapter.ingest(ch, input, {
		ingestedAt,
		organizationId: user.id,
		revision: rawRevision,
		timestamps,
		userId: user.id,
	});
	if (indexed)
		await persistSessionLanguageSignalsWithExecutor(
			{
				content,
				organizationId: user.id,
				rawIngestedAt: ingestedAt,
				rawRevision,
				sessionDate: timestamps.sessionDate,
				sessionId,
				source: "claude_code",
				userId: user.id,
			},
			ch,
		);
}
async function dashboard(
	filters: Partial<CostDashboardInput> = {},
	userIndex = 0,
	endpoint = server,
) {
	const user = users[userIndex];
	assert(user);
	const response = await fetch(
		`${endpoint.baseUrl}/rpc/analytics/overview/costs`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${user.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				json: { startDate: day, endDate: day, ...filters },
			}),
		},
	);
	expect(response.status, await response.clone().text()).toBe(200);
	return z.object({ json: CostDashboardSchema }).parse(await response.json())
		.json;
}

test("HTTP dashboard counts runs once across all fixed buckets, filters and tenants", async () => {
	for (const [i, duration] of [
		0, 60, 300, 900, 1800, 3600, 10800, 43200,
	].entries())
		await ingest(
			`buckets-${run}-${i}`,
			transcript(
				duration,
				i === 0 ? "Great" : i === 1 ? "Please continue" : undefined,
				i === 1,
			),
		);
	await ingest(`other-${run}`, transcript(60, "Great"), 1);
	const result = await dashboard({ splitBy: "durations" });
	assert(result.metrics.agentRuns);
	expect(result.metrics.agentRuns.total).toBe(8);
	expect(
		(await dashboard({ splitBy: "durations" }, 0, eventServer)).metrics
			.agentRuns,
	).toEqual(result.metrics.agentRuns);
	expect(
		result.metrics.agentRuns.breakdowns.durations.map((entry) => entry.value),
	).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0]);
	expect(result.metrics.agentRuns.series).toHaveLength(9);
	const filtered = await dashboard({
		skillsUsed: ["yes"],
		runSignals: ["none"],
		durations: ["1to5m"],
	});
	expect(filtered.metrics.agentRuns?.total).toBe(1);
	expect(filtered.metrics.agentRuns?.breakdowns.durations).toHaveLength(9);
	expect((await dashboard({}, 1)).metrics.agentRuns?.total).toBe(1);
});

test("later revisions replace no-reply feedback without duplicating the run", async () => {
	const id = `revision-${run}`;
	await ingest(id, transcript(60));
	expect(
		(await dashboard({ runSignals: ["negative"] })).metrics.agentRuns?.total,
	).toBe(0);
	await ingest(id, transcript(60, "It didn’t work"));
	expect(
		(await dashboard({ runSignals: ["negative"] })).metrics.agentRuns?.total,
	).toBe(1);
});

test("includes today's runs from a session opened before the date range", async () => {
	const content =
		transcript(60, undefined, false, start - 86400000) +
		"\n" +
		transcript(3600, "Great", false, start + 7200000)
			.replaceAll('"u1"', '"u3"')
			.replaceAll('"a1"', '"a3"')
			.replaceAll('"u2"', '"u4"')
			.replaceAll('"m1"', '"m3"');
	await ingest(`cross-day-${run}`, content);
	const result = await dashboard({
		runSignals: ["positive"],
		durations: ["1to3h"],
	});
	expect(result.metrics.agentRuns?.total).toBe(1);
});

test("preserves unrecognized model identities for run filters", async () => {
	await ingest(
		`unknown-model-${run}`,
		transcript(60).replaceAll("claude-sonnet-4-5", "local-research-model"),
	);
	const result = await dashboard({ models: ["local-research-model"] });
	expect(result.metrics.agentRuns?.total).toBe(1);
	expect(
		result.metrics.agentRuns?.breakdowns.models.some(
			(entry) => entry.id === "local-research-model",
		),
	).toBe(true);
});

test("unindexed revisions remain unknown even under run filters", async () => {
	await ingest(`stale-${run}`, transcript(300), 0, false);
	expect(
		(await dashboard({ runSignals: ["mixed"], skillsUsed: ["yes"] })).metrics
			.agentRuns,
	).toBeNull();
});
