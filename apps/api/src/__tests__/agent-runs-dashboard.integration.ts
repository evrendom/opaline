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
	projectPath = "/test/agent-runs",
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
		projectPath,
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
				json: {
					startDate: day,
					endDate: day,
					requestedMetric: "agentRuns",
					...filters,
				},
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

test("requested detail metric does not change filtered headline totals", async () => {
	const filters = {
		models: ["claude-sonnet-4-5"],
		signalTypes: ["userPositive" as const],
		runSignals: ["positive" as const],
	};
	const results = await Promise.all(
		(["cost", "sessions", "signals", "agentRuns"] as const).map(
			(requestedMetric) => dashboard({ ...filters, requestedMetric }),
		),
	);
	const legacy = await dashboard({ ...filters, requestedMetric: undefined });
	const totals = results.map((result) => ({
		cost: result.metrics.cost.total,
		sessions: result.metrics.sessions.total,
		signals: result.metrics.signals?.total,
		agentRuns: result.metrics.agentRuns?.total,
	}));
	const expectedTotals = totals[0];
	assert(expectedTotals);
	for (const total of totals) {
		expect(total.cost).toBeCloseTo(expectedTotals.cost, 12);
		expect({
			sessions: total.sessions,
			signals: total.signals,
			agentRuns: total.agentRuns,
		}).toEqual({
			sessions: expectedTotals.sessions,
			signals: expectedTotals.signals,
			agentRuns: expectedTotals.agentRuns,
		});
	}
	expect(legacy.metrics.cost.total).toBeCloseTo(expectedTotals.cost, 12);
	expect({
		sessions: legacy.metrics.sessions.total,
		signals: legacy.metrics.signals?.total,
		agentRuns: legacy.metrics.agentRuns?.total,
	}).toEqual({
		sessions: expectedTotals.sessions,
		signals: expectedTotals.signals,
		agentRuns: expectedTotals.agentRuns,
	});
	expect(results[0]?.metrics.cost.breakdowns.members).not.toHaveLength(0);
	expect(results[0]?.metrics.agentRuns?.breakdowns.members).toHaveLength(0);
	expect(results[2]?.metrics.signals?.breakdowns.signalTypes).not.toHaveLength(
		0,
	);
	expect(results[3]?.metrics.agentRuns?.breakdowns.runSignals).not.toHaveLength(
		0,
	);
	expect(legacy.metrics.cost.breakdowns.members).not.toHaveLength(0);
	expect(legacy.metrics.signals?.breakdowns.signalTypes).not.toHaveLength(0);
	expect(legacy.metrics.agentRuns?.breakdowns.runSignals).not.toHaveLength(0);
});

test("returns matched indexed runs while another selected session is indexing", async () => {
	const repository = `/test/partial-coverage-${run}`;
	await ingest(
		`partial-indexed-${run}`,
		transcript(60, "Great", true),
		0,
		true,
		repository,
	);
	await ingest(
		`partial-stale-${run}`,
		transcript(60, "Great", true),
		0,
		false,
		repository,
	);
	const runs = (
		await dashboard({
			repositories: [repository],
			runSignals: ["positive"],
			skillsUsed: ["yes"],
		})
	).metrics.agentRuns;
	expect(runs?.total).toBe(1);
	expect(runs?.incomplete).toBe(true);
	expect(runs?.coverage).toEqual({
		indexedSessions: 1,
		indexingSessions: 1,
		unavailableSessions: 0,
	});
});

test("counts a multi-run session once in coverage under run filters", async () => {
	const repository = `/test/session-coverage-${run}`;
	const content =
		transcript(60) +
		"\n" +
		transcript(300, "Great", false, start + 120_000)
			.replaceAll('"u1"', '"u3"')
			.replaceAll('"a1"', '"a3"')
			.replaceAll('"u2"', '"u4"')
			.replaceAll('"m1"', '"m3"');
	await ingest(`coverage-once-${run}`, content, 0, true, repository);
	const runs = (
		await dashboard({
			repositories: [repository],
			runSignals: ["positive"],
			durations: ["5to15m"],
		})
	).metrics.agentRuns;
	expect(runs?.total).toBe(1);
	expect(runs?.coverage).toEqual({
		indexedSessions: 1,
		indexingSessions: 0,
		unavailableSessions: 0,
	});
});

test("reports a stale session without its current raw revision as unavailable", async () => {
	const repository = `/test/unavailable-coverage-${run}`;
	const sessionId = `coverage-unavailable-${run}`;
	await ingest(sessionId, transcript(60, "Great"), 0, true, repository);
	await ingest(sessionId, transcript(300, "Great"), 0, false, repository);
	const user = users[0];
	assert(user);
	await ch.execute({
		query: `ALTER TABLE rudel.claude_sessions DELETE WHERE organization_id = {org:String} AND session_id = {sessionId:String} SETTINGS mutations_sync = 2`,
		query_params: { org: user.id, sessionId },
	});
	const runs = (
		await dashboard({ repositories: [repository], runSignals: ["positive"] })
	).metrics.agentRuns;
	expect(runs?.total).toBe(0);
	expect(runs?.incomplete).toBe(true);
	expect(runs?.coverage).toEqual({
		indexedSessions: 0,
		indexingSessions: 0,
		unavailableSessions: 1,
	});
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

test("unindexed revisions keep valid runs visible and report coverage", async () => {
	const repository = `/test/stale-coverage-${run}`;
	await ingest(`stale-${run}`, transcript(300), 0, false, repository);
	const runs = (
		await dashboard({
			repositories: [repository],
			runSignals: ["mixed"],
			skillsUsed: ["yes"],
		})
	).metrics.agentRuns;
	expect(runs).not.toBeNull();
	expect(runs?.incomplete).toBe(true);
	expect(runs?.coverage?.indexingSessions).toBeGreaterThanOrEqual(1);
	expect(runs?.coverage?.unavailableSessions).toBe(0);
});
