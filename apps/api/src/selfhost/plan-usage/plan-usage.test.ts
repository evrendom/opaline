import { expect, test } from "bun:test";
import { claudeReadings, codexReadings, type PlanSample } from "./readings.js";
import { buildPlanUsageReport, mainWindow } from "./report.js";
import { buildWindowSeries, type CostRow } from "./window-series.js";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-11-17T08:00:00.000Z");

function sample(
	at: number,
	usedPercent: number,
	resetsAt = T0 + 60 * HOUR,
): PlanSample {
	return {
		at: new Date(at).toISOString(),
		provider: "claude",
		window: "seven_day",
		label: "Weekly",
		windowMinutes: 10_080,
		usedPercent,
		resetsAt: new Date(resetsAt).toISOString(),
		plan: "max",
		modelScope: null,
	};
}

test("reads Claude's weekly and per-model limits", () => {
	const readings = claudeReadings({
		rate_limits_available: true,
		subscription_type: "max",
		rate_limits: {
			five_hour: null,
			seven_day: { utilization: 55, resets_at: "2026-11-19T20:00:00Z" },
			limits: [
				{
					kind: "weekly_scoped",
					percent: 37,
					resets_at: "2026-11-19T20:00:00Z",
					scope: { model: { display_name: "Fable" } },
				},
			],
		},
	});
	expect(
		readings?.map((reading) => [reading.window, reading.usedPercent]),
	).toEqual([
		["seven_day", 55],
		["seven_day_fable", 37],
	]);
	expect(readings?.[1]?.modelScope).toBe("fable");
	expect(claudeReadings({ rate_limits_available: false })).toBeNull();
});

test("names Codex windows by their length", () => {
	const readings = codexReadings({
		rateLimits: {
			planType: "free",
			primary: {
				usedPercent: 100,
				windowDurationMins: 43_200,
				resetsAt: 1_795_000_000,
			},
			secondary: null,
		},
	});
	expect(
		readings?.map((reading) => [
			reading.label,
			reading.usedPercent,
			reading.plan,
		]),
	).toEqual([["Monthly", 100, "free"]]);
});

test("splits a rise across the sessions that ran, by cost", () => {
	const rows: CostRow[] = [
		{ sessionId: "a", at: T0 + 5 * 60_000, model: "claude-opus-5-5", cost: 3 },
		{ sessionId: "b", at: T0 + 10 * 60_000, model: "claude-opus-5-5", cost: 1 },
	];
	const series = buildWindowSeries({
		samples: [sample(T0, 40), sample(T0 + 30 * 60_000, 44)],
		rows,
		from: T0,
		to: T0 + HOUR,
		now: T0 + HOUR,
	});
	expect(
		series?.sessions.map((entry) => [entry.sessionId, entry.points]),
	).toEqual([
		["a", 3],
		["b", 1],
	]);
	expect(series?.otherPoints).toBe(40);
	expect(series?.bucketMinutes).toBe(15);
	expect(series?.buckets.at(0)).toMatchObject({
		usedPercent: 40,
		kind: "reading",
		usedRange: [40, 40],
	});
	expect(series?.buckets.at(1)).toMatchObject({
		usedPercent: 44,
		kind: "between",
		usedRange: [44, 44],
	});
	expect(series?.buckets.at(2)).toMatchObject({
		usedPercent: 44,
		kind: "reading",
	});
});

test("work between two equal readings shares the next rise", () => {
	const rows: CostRow[] = [
		{ sessionId: "a", at: T0 + 5 * 60_000, model: "claude-opus-5-5", cost: 1 },
		{ sessionId: "b", at: T0 + 35 * 60_000, model: "claude-opus-5-5", cost: 1 },
	];
	const series = buildWindowSeries({
		samples: [
			sample(T0, 40),
			sample(T0 + 30 * 60_000, 40),
			sample(T0 + 60 * 60_000, 42),
		],
		rows,
		from: T0,
		to: T0 + 2 * HOUR,
		now: T0 + 2 * HOUR,
	});
	expect(series?.sessionPoints).toEqual({ a: 1, b: 1 });
});

test("work after the latest reading is estimated at the cycle's rate", () => {
	const rows: CostRow[] = [
		{ sessionId: "a", at: T0 + 5 * 60_000, model: "claude-opus-5-5", cost: 2 },
		{
			sessionId: "b",
			agentId: "sub",
			at: T0 + 40 * 60_000,
			model: "claude-opus-5-5",
			cost: 1,
		},
	];
	const series = buildWindowSeries({
		samples: [sample(T0, 40), sample(T0 + 30 * 60_000, 44)],
		rows,
		from: T0,
		to: T0 + HOUR,
		now: T0 + HOUR,
	});
	expect(series?.sessionPoints).toEqual({ a: 4, b: 2, "b:sub": 2 });
});

test("usage with no local activity, before or between samples, is other devices", () => {
	const series = buildWindowSeries({
		samples: [sample(T0, 40), sample(T0 + 30 * 60_000, 42)],
		rows: [],
		from: T0,
		to: T0 + HOUR,
		now: T0 + HOUR,
	});
	expect(series?.sessions).toEqual([]);
	expect(series?.otherPoints).toBe(42);
});

test("a reset starts a new cycle instead of a negative rise", () => {
	const series = buildWindowSeries({
		samples: [
			sample(T0, 90, T0 + 20 * 60_000),
			sample(T0 + 30 * 60_000, 3, T0 + 20 * 60_000 + 168 * HOUR),
		],
		rows: [],
		from: T0,
		to: T0 + HOUR,
		now: T0 + HOUR,
	});
	expect(series?.buckets.some((bucket) => bucket.reset)).toBe(true);
	expect(series?.resets).toEqual([new Date(T0 + 20 * 60_000).toISOString()]);
	expect(series?.otherPoints).toBe(93);
	expect(series?.buckets.at(-1)?.usedPercent).toBe(3);
});

test("between two readings the bar keeps both readings as its range", () => {
	const series = buildWindowSeries({
		samples: [sample(T0, 40), sample(T0 + 3 * HOUR, 46)],
		rows: [
			{
				sessionId: "a",
				at: T0 + 10 * 60_000,
				model: "claude-opus-5-5",
				cost: 1,
			},
			{
				sessionId: "a",
				at: T0 + 150 * 60_000,
				model: "claude-opus-5-5",
				cost: 1,
			},
		],
		from: T0,
		to: T0 + 4 * HOUR,
		now: T0 + 4 * HOUR,
	});
	expect(series?.buckets.at(4)).toMatchObject({
		kind: "between",
		usedRange: [40, 46],
		usedPercent: 43,
	});
	expect(series?.buckets.at(12)).toMatchObject({
		kind: "reading",
		usedRange: [46, 46],
	});
});

test("before the first sample, bars are estimated from local sessions or left unknown", () => {
	const samples = [sample(T0, 40, T0 + 166 * HOUR)];
	const from = T0 - 2 * HOUR;
	const known = buildWindowSeries({
		samples,
		rows: [
			{ sessionId: "a", at: T0 - HOUR, model: "claude-opus-5-5", cost: 2 },
		],
		from,
		to: T0,
		now: T0,
	});
	expect(known?.buckets.at(0)?.usedPercent).toBe(0);
	expect(known?.buckets.at(4)).toMatchObject({
		usedPercent: 40,
		kind: "estimate",
		usedRange: [0, 40],
	});
	expect(known?.buckets.at(-1)).toMatchObject({
		usedPercent: 40,
		kind: "between",
		usedRange: [40, 40],
	});
	expect(
		known?.sessions.map((entry) => [
			entry.sessionId,
			entry.points,
			entry.estimated,
		]),
	).toEqual([["a", 40, true]]);
	const unknown = buildWindowSeries({
		samples,
		rows: [],
		from,
		to: T0,
		now: T0,
	});
	expect(unknown?.buckets.at(0)?.usedPercent).toBeNull();
});

test("the report shows Claude's overall weekly limit and keeps an error when Codex has none", async () => {
	const fable: PlanSample = {
		...sample(T0, 37),
		window: "seven_day_fable",
		label: "Weekly · Fable",
		modelScope: "fable",
	};
	const report = await buildPlanUsageReport({
		samples: [sample(T0, 40), fable],
		errors: { codex: "Codex is not installed" },
		checkedAt: new Date(T0).toISOString(),
		from: T0,
		to: T0 + HOUR,
		now: T0 + HOUR,
		loadRows: async () => [],
		loadTitles: async () => ({}),
	});
	expect(
		report.providers.map((provider) => [
			provider.provider,
			provider.window?.window ?? null,
			provider.error,
		]),
	).toEqual([
		["claude", "seven_day", null],
		["codex", null, "Codex is not installed"],
	]);
	expect(report.providers[0]?.window?.buckets[0]?.plan).toBe("max");
});

test("Codex uses its weekly limit, or its longest one on plans without a week", () => {
	const codex = (window: string, windowMinutes: number): PlanSample => ({
		...sample(T0, 10),
		provider: "codex",
		window,
		windowMinutes,
	});
	expect(
		mainWindow("codex", [codex("primary", 300), codex("secondary", 10_080)]),
	).toBe("secondary");
	expect(mainWindow("codex", [codex("primary", 43_200)])).toBe("primary");
});

test("every ask is kept: the full answer when it changes, a short line when not", async () => {
	const { mkdtemp, readFile } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { fileSampleStore } = await import("./sample-store.js");
	const { startPlanUsageRecorder } = await import("./recorder.js");
	const path = join(
		await mkdtemp(join(tmpdir(), "plan-usage-")),
		"plan-usage.jsonl",
	);
	const store = fileSampleStore(path);
	let used = 40;
	let duration = 0;
	const recorder = startPlanUsageRecorder({
		store,
		agentsActive: () => true,
		tickMs: 3_600_000,
		probes: [
			async () => {
				duration += 1;
				const response = {
					session: { total_duration_ms: duration },
					rate_limits_available: true,
					rate_limits: {
						seven_day: { utilization: used, resets_at: "2026-11-19T20:00:00Z" },
					},
				};
				return {
					provider: "claude",
					readings: claudeReadings(response) ?? [],
					response,
				};
			},
			async () => ({ provider: "codex", error: "Codex is not installed" }),
		],
	});
	await recorder.sampleNow();
	await recorder.sampleNow();
	await recorder.sampleNow();
	used = 41;
	await recorder.sampleNow();
	recorder.stop();
	const lines = (await readFile(path, "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	const claudeAsks = lines.filter(
		(line) => line.kind === "ask" && line.provider === "claude",
	);
	expect(
		claudeAsks.map((ask) =>
			ask.unchanged ? "same" : ask.response.rate_limits.seven_day.utilization,
		),
	).toEqual([40, "same", "same", 41]);
	expect(
		lines
			.filter((line) => line.kind === "ask" && line.provider === "codex")
			.map((ask) => ask.error),
	).toEqual([
		"Codex is not installed",
		"Codex is not installed",
		"Codex is not installed",
		"Codex is not installed",
	]);
	expect(
		(await fileSampleStore(path).all()).map((sample) => sample.usedPercent),
	).toEqual([40, 40, 40, 41]);
});

test("shares add up by model and by repository", () => {
	const series = buildWindowSeries({
		samples: [sample(T0, 40), sample(T0 + 30 * 60_000, 46)],
		rows: [
			{
				sessionId: "a",
				at: T0 + 5 * 60_000,
				model: "claude-opus-5-5",
				cost: 3,
			},
			{
				sessionId: "b",
				at: T0 + 10 * 60_000,
				model: "claude-fable-5-2",
				cost: 2,
			},
			{
				sessionId: "c",
				at: T0 + 15 * 60_000,
				model: "claude-opus-5-5",
				cost: 1,
			},
		],
		from: T0,
		to: T0 + HOUR,
		now: T0 + HOUR,
		repositoryOf: new Map([
			["a", "github.com/opalinehq/athena"],
			["b", "github.com/opalinehq/athena"],
		]),
	});
	expect(series?.models.map((entry) => [entry.id, entry.points])).toEqual([
		["claude-opus-5-5", 4],
		["claude-fable-5-2", 2],
	]);
	expect(series?.repositories.map((entry) => [entry.id, entry.points])).toEqual(
		[
			["github.com/opalinehq/athena", 5],
			["", 1],
		],
	);
});

test("earlier cycles are estimated from cost at the measured cycle's rate", () => {
	const reset = T0 + 24 * HOUR;
	const week = 168 * HOUR;
	const series = buildWindowSeries({
		samples: [sample(T0, 20, reset)],
		rows: [
			{
				sessionId: "now",
				at: reset - week + HOUR,
				model: "claude-opus-5-5",
				cost: 10,
			},
			{
				sessionId: "before",
				at: reset - 2 * week + HOUR,
				model: "claude-opus-5-5",
				cost: 5,
			},
		],
		from: reset - 2 * week,
		to: T0,
		now: T0,
		bucketMinutes: 1440,
	});
	expect(
		series?.sessions.map((entry) => [
			entry.sessionId,
			entry.points,
			entry.estimated,
		]),
	).toEqual([
		["now", 20, true],
		["before", 10, true],
	]);
	expect(series?.buckets.at(1)).toMatchObject({
		kind: "estimate",
		usedPercent: 10,
	});
	expect(series?.resets).toContain(new Date(reset - week).toISOString());
});
