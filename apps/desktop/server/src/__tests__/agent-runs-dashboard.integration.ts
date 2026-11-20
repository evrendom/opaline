import { expect, setDefaultTimeout, test } from "bun:test";
import assert from "node:assert/strict";
import type { CostDashboardInput } from "@rudel/api-routes";
import { getClickhouse } from "../clickhouse.js";
import {
	setUpAgentRunsDashboard,
	start,
	transcript,
	unknownDurationTranscript,
} from "./helpers/agent-runs-dashboard-fixture.js";

// Agent run headlines, filters, duration statistics and coverage. The pull
// request headlines are in agent-runs-dashboard-pull-requests.integration.ts.
setDefaultTimeout(60_000);
const { run, servers, user, workspace, ingest, dashboard } =
	setUpAgentRunsDashboard(["owner"]);

test("HTTP dashboard counts runs once across all fixed buckets, filters and tenants", async () => {
	const [owner, outsider] = await Promise.all([
		workspace("buckets-owner"),
		workspace("buckets-outsider"),
	]);
	await Promise.all([
		...[0, 60, 300, 900, 1800, 3600, 10800, 43200].map((duration, i) =>
			ingest(
				`buckets-${run}-${i}`,
				transcript(
					duration,
					i === 0 ? "Great" : i === 1 ? "Please continue" : undefined,
					i === 1,
				),
				owner,
			),
		),
		ingest(`other-${run}`, transcript(60, "Great"), outsider),
	]);
	const [result, events, filtered, outsiderView, sessionsView, mergedView] =
		await Promise.all([
			dashboard({ splitBy: "durations" }, owner),
			dashboard({ splitBy: "durations" }, owner, servers().events),
			dashboard(
				{
					skillsUsed: ["yes"],
					runSignals: ["none"],
					durations: ["1to5m"],
				},
				owner,
			),
			dashboard({}, outsider),
			dashboard({ requestedMetric: "sessions" }, owner),
			dashboard({ requestedMetric: "mergedPullRequests" }, owner),
		]);
	assert(result.metrics.agentRuns);
	expect(result.metrics.agentRuns.total).toBe(8);
	expect(events.metrics.agentRuns).toEqual(result.metrics.agentRuns);
	expect(
		result.metrics.agentRuns.breakdowns.durations.map((entry) => entry.value),
	).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0]);
	expect(result.metrics.agentRuns.series).toHaveLength(9);
	expect(filtered.metrics.agentRuns?.total).toBe(1);
	expect(filtered.metrics.agentRuns?.breakdowns.durations).toHaveLength(9);
	expect(outsiderView.metrics.agentRuns?.total).toBe(1);
	expect(mergedView.requestedMetric).toBe("cost");
	expect(mergedView.metrics.agentRuns?.total).toBe(8);
	expect(mergedView.metrics.sessions?.total).toBeGreaterThan(0);
	expect(mergedView.metrics.sessions?.total).toBe(
		sessionsView.metrics.sessions?.total,
	);
	expect(sessionsView.metrics.cost?.total).toBeCloseTo(0.00084, 12);
	expect(mergedView.metrics.cost?.total).toBeCloseTo(
		sessionsView.metrics.cost?.total ?? Number.NaN,
		12,
	);
});

test("returns exact median and P95 durations for filtered runs and UTC periods", async () => {
	const repository = `/test/duration-stats-${run}`;
	const current = new Date(start);
	const monthStart = Date.UTC(
		current.getUTCFullYear(),
		current.getUTCMonth() - 1,
		1,
	);
	const secondTuesday =
		monthStart +
		(((2 - new Date(monthStart).getUTCDay() + 7) % 7) + 7) * 86_400_000;
	const statsStart = secondTuesday;
	const statsPreviousStart = secondTuesday - 86_400_000;
	const statsDay = new Date(statsStart).toISOString().slice(0, 10);
	const statsPreviousDay = new Date(statsPreviousStart)
		.toISOString()
		.slice(0, 10);
	const statsMonth = `${statsDay.slice(0, 7)}-01`;
	await Promise.all([
		ingest(
			`duration-previous-${run}`,
			transcript(40, "Great", false, statsPreviousStart),
			0,
			true,
			repository,
		),
		...[0, 10, 20, 30, 100].map((duration, index) =>
			ingest(
				`duration-${run}-${index}`,
				transcript(
					duration,
					index < 2 ? "Great" : undefined,
					index === 1,
					statsStart,
				),
				0,
				true,
				repository,
			),
		),
		ingest(
			`duration-unknown-${run}`,
			unknownDurationTranscript(50, "Great", true, statsStart),
			0,
			true,
			repository,
		),
	]);

	const durationStats = async (filters: Partial<CostDashboardInput>) =>
		(await dashboard(filters)).metrics.agentRuns?.durationStats;
	const [
		stats,
		filtered,
		underOneMinute,
		underOneMinuteSplit,
		weekly,
		monthly,
		unknownOnly,
		empty,
	] = await Promise.all([
		durationStats({
			startDate: statsPreviousDay,
			endDate: statsDay,
			durationInterval: "daily",
			repositories: [repository],
		}),
		durationStats({
			startDate: statsDay,
			endDate: statsDay,
			repositories: [repository],
			runSignals: ["positive"],
			skillsUsed: ["yes"],
		}),
		durationStats({
			startDate: statsPreviousDay,
			endDate: statsDay,
			repositories: [repository],
			durations: ["under1m"],
		}),
		durationStats({
			startDate: statsPreviousDay,
			endDate: statsDay,
			repositories: [repository],
			durations: ["under1m"],
			splitBy: "durations",
		}),
		durationStats({
			startDate: statsPreviousDay,
			endDate: statsDay,
			durationInterval: "weekly",
			repositories: [repository],
		}),
		durationStats({
			startDate: statsPreviousDay,
			endDate: statsDay,
			durationInterval: "monthly",
			repositories: [repository],
		}),
		durationStats({
			startDate: statsDay,
			endDate: statsDay,
			repositories: [repository],
			durations: ["unknown"],
		}),
		durationStats({
			startDate: statsDay,
			endDate: statsDay,
			repositories: [`/test/absent-${run}`],
		}),
	]);
	expect(stats).toEqual({
		interval: "daily",
		sampleCount: 6,
		unknownCount: 1,
		medianSeconds: 30,
		p95Seconds: 100,
		trend: [
			{
				date: statsPreviousDay,
				startDate: statsPreviousDay,
				endDate: statsPreviousDay,
				sampleCount: 1,
				unknownCount: 0,
				medianSeconds: 40,
				p95Seconds: 40,
			},
			{
				date: statsDay,
				startDate: statsDay,
				endDate: statsDay,
				sampleCount: 5,
				unknownCount: 1,
				medianSeconds: 20,
				p95Seconds: 100,
			},
		],
	});
	expect(filtered).toMatchObject({
		sampleCount: 1,
		unknownCount: 1,
		medianSeconds: 10,
		p95Seconds: 10,
	});
	expect(underOneMinute).toMatchObject({
		sampleCount: 5,
		unknownCount: 0,
		medianSeconds: 20,
		p95Seconds: 40,
	});
	expect(underOneMinuteSplit).toEqual(underOneMinute);
	for (const [durationInterval, date, grouped] of [
		["weekly", statsPreviousDay, weekly],
		["monthly", statsMonth, monthly],
	] as const) {
		expect(grouped).toMatchObject({
			interval: durationInterval,
			sampleCount: 6,
			unknownCount: 1,
			medianSeconds: 30,
			p95Seconds: 100,
			trend: [
				{
					date,
					startDate: statsPreviousDay,
					endDate: statsDay,
					sampleCount: 6,
					unknownCount: 1,
					medianSeconds: 30,
					p95Seconds: 100,
				},
			],
		});
	}
	expect(unknownOnly).toMatchObject({
		sampleCount: 0,
		unknownCount: 1,
		medianSeconds: null,
		p95Seconds: null,
		trend: [
			{
				sampleCount: 0,
				unknownCount: 1,
				medianSeconds: null,
				p95Seconds: null,
			},
		],
	});
	expect(empty).toMatchObject({
		sampleCount: 0,
		unknownCount: 0,
		medianSeconds: null,
		p95Seconds: null,
		trend: [
			{
				sampleCount: 0,
				unknownCount: 0,
				medianSeconds: null,
				p95Seconds: null,
			},
		],
	});
});

test("requested detail metric does not change filtered headline totals", async () => {
	const member = await workspace("detail-owner");
	// Runs each filter keeps and runs each one drops, all indexed: the legacy
	// all-or-nothing contract hides agent runs while any session is indexing.
	await Promise.all([
		ingest(`detail-positive-${run}`, transcript(60, "Great"), member),
		ingest(`detail-skills-${run}`, transcript(300, "Great", true), member),
		ingest(`detail-silent-${run}`, transcript(900), member),
		ingest(
			`detail-other-model-${run}`,
			transcript(60, "Great", false, start, "mystery-model"),
			member,
		),
	]);
	const filters = {
		models: ["claude-sonnet-4-5"],
		signalTypes: ["userPositive" as const],
		runSignals: ["positive" as const],
	};
	const [legacy, ...results] = await Promise.all([
		dashboard({ ...filters, requestedMetric: undefined }, member),
		...(["cost", "sessions", "signals", "agentRuns"] as const).map(
			(requestedMetric) => dashboard({ ...filters, requestedMetric }, member),
		),
	]);
	assert(legacy);
	const totals = results.map((result) => ({
		cost: result.metrics.cost?.total,
		sessions: result.metrics.sessions?.total,
		signals: result.metrics.signals?.total,
		agentRuns: result.metrics.agentRuns?.total,
	}));
	const expectedTotals = totals[0];
	assert(expectedTotals);
	for (const total of totals) {
		expect(total.cost).toBeCloseTo(expectedTotals.cost ?? Number.NaN, 12);
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
	expect(legacy.metrics.cost?.total).toBeCloseTo(
		expectedTotals.cost ?? Number.NaN,
		12,
	);
	expect({
		sessions: legacy.metrics.sessions?.total,
		signals: legacy.metrics.signals?.total,
		agentRuns: legacy.metrics.agentRuns?.total,
	}).toEqual({
		sessions: expectedTotals.sessions,
		signals: expectedTotals.signals,
		agentRuns: expectedTotals.agentRuns,
	});
	expect(results[0]?.metrics.cost?.breakdowns.members).not.toHaveLength(0);
	expect(results[0]?.metrics.agentRuns?.breakdowns.members).toHaveLength(0);
	expect(results[2]?.metrics.signals?.breakdowns.signalTypes).not.toHaveLength(
		0,
	);
	expect(results[3]?.metrics.agentRuns?.breakdowns.runSignals).not.toHaveLength(
		0,
	);
	expect(legacy.metrics.cost?.breakdowns.members).not.toHaveLength(0);
	expect(legacy.metrics.signals?.breakdowns.signalTypes).not.toHaveLength(0);
	expect(legacy.metrics.agentRuns?.breakdowns.runSignals).not.toHaveLength(0);
});

test("returns matched indexed runs while another selected session is indexing", async () => {
	const repository = `/test/partial-coverage-${run}`;
	await Promise.all([
		ingest(
			`partial-indexed-${run}`,
			transcript(60, "Great", true),
			0,
			true,
			repository,
		),
		ingest(
			`partial-stale-${run}`,
			transcript(60, "Great", true),
			0,
			false,
			repository,
		),
	]);
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
	const owner = user(0);
	await getClickhouse().execute({
		query: `ALTER TABLE rudel.claude_sessions DELETE WHERE organization_id = {org:String} AND session_id = {sessionId:String} SETTINGS mutations_sync = 2`,
		query_params: { org: owner.id, sessionId },
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
	const member = await workspace("revision-owner");
	const id = `revision-${run}`;
	await ingest(id, transcript(60), member);
	expect(
		(await dashboard({ runSignals: ["negative"] }, member)).metrics.agentRuns
			?.total,
	).toBe(0);
	await ingest(id, transcript(60, "It didn’t work"), member);
	expect(
		(await dashboard({ runSignals: ["negative"] }, member)).metrics.agentRuns
			?.total,
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
	const member = await workspace("cross-day-owner");
	await ingest(`cross-day-${run}`, content, member);
	const result = await dashboard(
		{
			runSignals: ["positive"],
			durations: ["1to3h"],
		},
		member,
	);
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
