import { expect, test } from "bun:test";
import {
	axisTicks,
	directLabelSeries,
	placeDirectLabels,
	type TradeoffSeries,
} from "../../apps/marketing/src/components/trends/trends-benchmark-charts";
import { rankMovements } from "../../apps/marketing/src/components/trends/trends-movement";
import { buildShareSeries } from "../../apps/marketing/src/components/trends/trends-plot-charts";
import { TRENDS_SECTIONS } from "../../apps/marketing/src/components/trends/trends-sections";
import {
	createPreviewPopulation,
	PREVIEW_USAGE_EFFORTS,
} from "../../apps/marketing/src/trends/preview-population";
import { PREVIEW_TRENDS_SNAPSHOT } from "../../apps/marketing/src/trends/preview-snapshot";
import {
	benchmarkObservations,
	REASONING_EFFORTS,
	reasoningLinePoints,
	reasoningLineSegments,
	usageBenchmark,
} from "../../apps/marketing/src/trends/trends-benchmarks";
import { formatUsd } from "../../apps/marketing/src/trends/trends-format";
import {
	applyAaRelease,
	selectBenchmarkModels,
	topIntelligenceFamilies,
} from "../../apps/marketing/src/trends/trends-release";
import {
	TRENDS_MODEL_GROUPS,
	type TrendsBenchmarkModel,
	type TrendsBenchmarkPoint,
} from "../../apps/marketing/src/trends/trends-snapshot";
import {
	addDays,
	type DailyUsage,
	deriveMetrics,
	deriveUsageSnapshot,
} from "../../apps/marketing/src/trends/trends-usage";
import {
	MODEL_REGISTRY,
	MODEL_VARIANTS,
	parseAaEffort,
	resolveAaVariant,
} from "../../packages/api-routes/src/model-registry";
import {
	CODING_MODEL_LINES,
	FRONTIER_FAMILY_IDS,
} from "../../packages/api-routes/src/model-registry-aa";
import {
	type AaRecord,
	aaReleaseSchema,
} from "../../packages/api-routes/src/trends-aa-release";

const population = createPreviewPopulation();
const snapshot = PREVIEW_TRENDS_SNAPSHOT;
const current = population.filter(
	(row) =>
		row.day >= snapshot.periodStart && row.day < snapshot.periodEndExclusive,
);
const sum = (
	rows: readonly DailyUsage[],
	key: "runs" | "outputTokens" | "costUsd",
) => rows.reduce((total, row) => total + row[key], 0);

test("the seed and all server/client snapshot inputs are deterministic", () => {
	expect(createPreviewPopulation()).toEqual(population);
	expect(
		deriveUsageSnapshot(
			population,
			snapshot.periodStart,
			snapshot.periodEndExclusive,
			PREVIEW_USAGE_EFFORTS,
		),
	).toEqual(
		deriveUsageSnapshot(
			createPreviewPopulation(),
			snapshot.periodStart,
			snapshot.periodEndExclusive,
			PREVIEW_USAGE_EFFORTS,
		),
	);
});

test("every daily row reconciles reaction counts and weighted run distributions", () => {
	for (const row of population) {
		expect(
			Object.values(row.apologyPhrases).reduce(
				(total, count) => total + count,
				0,
			),
		).toBe(row.apologies);
		expect(
			row.distribution.reduce((total, sample) => total + sample.count, 0),
		).toBe(row.runs);
		expect(
			row.distribution.reduce(
				(total, sample) => total + sample.count * sample.outputTokens,
				0,
			),
		).toBe(row.outputTokens);
		expect(
			row.distribution.reduce(
				(total, sample) => total + sample.count * sample.costUsd,
				0,
			),
		).toBe(row.costUsd);
		expect(
			Object.values(row.reactions).reduce((total, count) => total + count, 0),
		).toBe(row.repliedRuns);
		expect(row.repliedRuns).toBeLessThanOrEqual(row.runs);
		expect(row.toolFailures).toBeLessThanOrEqual(row.toolCalls);
		expect(row.day >= (MODEL_REGISTRY[row.familyId]?.releasedAt ?? "")).toBe(
			true,
		);
	}
});

test("published models reconcile to eligible rows while harnesses and totals retain the full population", () => {
	const publishedIds = new Set(snapshot.models.map((model) => model.id));
	const published = current.filter((row) => publishedIds.has(row.familyId));
	expect(snapshot.models.reduce((total, model) => total + model.runs, 0)).toBe(
		sum(published, "runs"),
	);
	expect(snapshot.totals.runs).toBe(sum(current, "runs"));
	for (const key of ["runs", "outputTokens", "costUsd"] as const) {
		const harnessTotal = (snapshot.harnessDays ?? []).reduce(
			(total, day) =>
				total + (day[key]?.["claude-code"] ?? 0) + (day[key]?.codex ?? 0),
			0,
		);
		expect(harnessTotal).toBeCloseTo(sum(current, key), 6);
		for (const [lab, harness] of [
			["anthropic", "claude-code"],
			["openai", "codex"],
		] as const) {
			const rows = published.filter((row) => row.harness === harness);
			const models = snapshot.models.filter((model) => model.provider === lab);
			const modelTotal = models.reduce(
				(total, model) =>
					total +
					(key === "runs"
						? model.runs
						: key === "outputTokens"
							? model.totalOutputTokens
							: model.totalCostUsd),
				0,
			);
			expect(modelTotal).toBeCloseTo(sum(rows, key), 6);
		}
	}
});

test("13 complete weeks stay inside the period end and match daily model counts", () => {
	expect(snapshot.weeks).toHaveLength(13);
	expect(snapshot.weeks[0]?.weekStart).toBe(snapshot.shareWindow.start);
	expect(addDays(snapshot.weeks.at(-1)?.weekStart ?? "", 7)).toBe(
		snapshot.shareWindow.endExclusive,
	);
	expect(snapshot.shareWindow.endExclusive <= snapshot.periodEndExclusive).toBe(
		true,
	);
	for (const week of snapshot.weeks) {
		const weekEnd = addDays(week.weekStart, 7);
		expect(new Date(week.weekStart).getUTCDay()).toBe(1);
		for (const model of snapshot.models) {
			const rows = population.filter(
				(row) =>
					row.familyId === model.familyId &&
					row.day >= week.weekStart &&
					row.day < weekEnd,
			);
			expect(week.runsByModel[model.id]).toBe(sum(rows, "runs"));
		}
	}
});

test("metrics, prior periods, quantiles, developers and workspace eligibility derive from rows", () => {
	const globalDevelopers = new Set(
		current.flatMap((row) =>
			row.distribution.map((sample) => sample.developerId),
		),
	);
	expect(snapshot.totals.developers).toBe(
		Math.round(globalDevelopers.size / 10) * 10,
	);
	for (const model of snapshot.models) {
		const rows = current.filter((row) => row.familyId === model.familyId);
		const metrics = deriveMetrics(rows);
		expect(model.runSeconds).toEqual(metrics.runSeconds);
		expect(model.reactions).toEqual(metrics.reactions);
		expect(
			Object.values(model.reactions).reduce((total, share) => total + share, 0),
		).toBeCloseTo(1, 12);
		for (const distribution of [
			model.runSeconds,
			model.outputTokensPerRun,
			model.costPerRunUsd,
		]) {
			expect(distribution.p50).toBeLessThanOrEqual(distribution.p90);
			expect(distribution.p90).toBeLessThanOrEqual(
				distribution.p99 ?? Infinity,
			);
		}
		const prior = population.filter(
			(row) =>
				row.familyId === model.familyId &&
				row.day >= "2026-08-01" &&
				row.day < snapshot.periodStart,
		);
		expect(model.previous).toEqual(
			prior.length ? deriveMetrics(prior) : undefined,
		);
		expect(model.isNew).toBe(
			!population.some(
				(row) =>
					row.familyId === model.familyId && row.day < snapshot.periodStart,
			),
		);
		expect(model.runs).toBeGreaterThanOrEqual(snapshot.thresholds.minRuns);
		expect(model.developers).toBeGreaterThanOrEqual(
			snapshot.thresholds.minDevelopers,
		);
		expect(model.workspaces).toBeGreaterThanOrEqual(
			snapshot.thresholds.minWorkspaces,
		);
		expect(model.name).toBe(MODEL_REGISTRY[model.familyId]?.displayName);
		const point = usageBenchmark(model, snapshot);
		expect(point?.effort).toBe(model.benchmarkEffort);
		expect(
			snapshot.benchmarks?.find((family) => family.id === model.familyId)?.name,
		).toBe(model.name);
	}
	for (const section of TRENDS_SECTIONS) {
		for (const model of snapshot.models)
			expect(
				rankMovements(section, snapshot.models).get(model.id)?.isNew ??
					model.isNew,
			).toBe(model.isNew);
	}
});

test("currency keeps audited values distinct and nonzero values nonzero", () => {
	for (const values of [
		[0.1175, 0.1224],
		[1323, 1253],
		[0.0045, 0.004],
	])
		expect(formatUsd(values[0] ?? 0)).not.toBe(formatUsd(values[1] ?? 0));
	expect(formatUsd(0.0004)).toBe("$0.0004");
	expect(formatUsd(1e-12)).not.toBe("$0");
});

test("single-point logarithmic domains are padded with at least two finite ticks", () => {
	for (const value of [5, 0.0045, 50000]) {
		const ticks = axisTicks([value], true, 7);
		expect(ticks.length).toBeGreaterThanOrEqual(2);
		expect(ticks[0] ?? Infinity).toBeLessThan(value);
		expect(ticks.at(-1) ?? -Infinity).toBeGreaterThan(value);
		expect(ticks.every(Number.isFinite)).toBe(true);
	}
});

test("AA overrides win, unmapped variants are ignored, and joins do not invent scores", () => {
	const record: AaRecord = {
		id: "11111111-1111-4111-8111-111111111111",
		slug: "gpt-6-1-sol-high",
		name: "GPT-6.1 Sol (High)",
		releaseSlug: "gpt-6-1-sol",
		creatorId: "22222222-2222-4222-8222-222222222222",
		creatorSlug: "openai",
		creatorName: "OpenAI",
		releasedAt: "2026-09-29",
		openWeights: false,
		deprecated: false,
		deprecatedTo: null,
		isReasoning: true,
		reasoningSetting: "medium",
		effortLabel: "high",
		effortOrder: 40,
		estimated: false,
		intelligence: 41.234,
		costPerTaskUsd: null,
		totalCostUsd: null,
		outputTokensPerTask: null,
		totalOutputTokens: null,
		timePerTaskSeconds: null,
		outputSpeed: null,
		inputPrice: null,
		outputPrice: null,
		contextWindow: null,
	};
	expect(resolveAaVariant(record)?.effort).toBe("high");
	expect(parseAaEffort("Reasoning", true)).toBe("default");
	expect(parseAaEffort("Qwen3.8 Max (0902)", true)).toBe("default");
	expect(parseAaEffort("Non-reasoning", false)).toBe("none");
	expect(parseAaEffort("Adaptive Reasoning, Max Effort", true)).toBe("max");
	const unknown = {
		...record,
		id: "33333333-3333-4333-8333-333333333333",
		slug: "unregistered-model-high",
		releaseSlug: "unregistered-model",
		name: "Unregistered (High)",
	};
	expect(resolveAaVariant(unknown)).toBeNull();
	const release = aaReleaseSchema.parse({
		source: "artificial_analysis",
		fetchedAt: "2026-10-01T00:00:00.000Z",
		sourceUrl: "https://artificialanalysis.ai/models",
		sourceSha256: "a".repeat(64),
		indexVersion: "example",
		records: [record, unknown],
	});
	const real = applyAaRelease(snapshot, release);
	const sol = real.models.find((model) => model.id === "gpt-6.1-sol");
	expect(sol).toBeDefined();
	if (!sol) throw new Error("Expected Sol fixture");
	expect(usageBenchmark(sol, real)?.intelligenceIndex).toBe(
		record.intelligence,
	);
	expect(usageBenchmark({ ...sol, benchmarkEffort: "max" }, real)).toBeNull();
	expect(
		real.benchmarks?.find((family) => family.id === `aa-${unknown.id}`)?.group,
	).toBeUndefined();
	expect(real.benchmarks?.length).toBe(1);
	expect(real.sources.usage.kind).toBe("preview");
	expect(real.sources.benchmarks.kind).toBe("artificial_analysis");
	expect(
		aaReleaseSchema.safeParse({ ...release, records: [record, record] })
			.success,
	).toBe(false);
});

test("the page set is derived from usage and sorted by run share in both datasets", () => {
	const models = snapshot.models;
	expect(models.length).toBe(8);
	for (const [index, model] of models.entries()) {
		expect(model.runs / snapshot.totals.runs).toBeGreaterThanOrEqual(0.01);
		expect(model.runs).toBeLessThanOrEqual(models[index - 1]?.runs ?? Infinity);
	}
	expect(
		snapshot.benchmarks
			?.filter((model) => model.group === "in_use")
			.map((model) => model.id),
	).toEqual(models.map((model) => model.id));
	const extras =
		snapshot.benchmarks?.filter((model) => model.group !== "in_use") ?? [];
	expect(extras.length).toBeGreaterThan(3);
	for (const model of extras) {
		expect(models.some((usage) => usage.id === model.id)).toBe(false);
		expect(model.points.some((point) => point.costPerTaskUsd !== null)).toBe(
			true,
		);
	}
	const withoutCost = extras.map((model) => ({
		...model,
		points: model.points.map((point) => ({ ...point, costPerTaskUsd: null })),
	}));
	expect(selectBenchmarkModels(snapshot, withoutCost)).toEqual([]);
	const benchmarks = snapshot.benchmarks ?? [];
	expect(new Set(benchmarks.map((model) => model.id)).size).toBe(
		benchmarks.length,
	);
	const order = benchmarks.map((model) =>
		TRENDS_MODEL_GROUPS.findIndex((group) => group.id === model.group),
	);
	expect(order).toEqual([...order].sort((first, second) => first - second));
});

test("Frontier is the cost-observed curated union with a fresh top twenty, not twenty variants", () => {
	const candidates = Array.from({ length: 25 }, (_, index) =>
		benchmarkFixture(`candidate-${index}`, index),
	);
	const first = candidates[0];
	if (!first) throw new Error("Expected fixture");
	const misleading = {
		...first,
		points: [
			...first.points,
			{ ...first.points[0], intelligenceIndex: 1000, costPerTaskUsd: null },
		],
	};
	const curated = FRONTIER_FAMILY_IDS.map((id) => benchmarkFixture(id, -1));
	const models = [...candidates.slice(1), misleading, ...curated];
	const firstRelease = selectBenchmarkModels({ models: [] }, models);
	expect(
		firstRelease
			.filter((model) => model.group === "frontier")
			.map((model) => model.id)
			.sort(),
	).toEqual(
		[
			...candidates.slice(5).map((model) => model.id),
			...FRONTIER_FAMILY_IDS,
		].sort(),
	);
	expect(topIntelligenceFamilies(models)).toHaveLength(20);
	expect(
		topIntelligenceFamilies(models).some((model) => model.id === first.id),
	).toBe(false);
	const improved = {
		...first,
		points: first.points.map((point) => ({ ...point, intelligenceIndex: 100 })),
	};
	const nextRelease = selectBenchmarkModels({ models: [] }, [
		...models.filter((model) => model.id !== first.id),
		improved,
	]);
	expect(nextRelease.some((model) => model.id === first.id)).toBe(true);
	expect(nextRelease.some((model) => model.id === "candidate-5")).toBe(false);
	expect(
		selectBenchmarkModels(
			{ models: [] },
			curated.map((model) => ({
				...model,
				points: model.points.map((point) => ({
					...point,
					costPerTaskUsd: null,
				})),
			})),
		),
	).toEqual([]);
});

test("each release can admit previously unregistered top families by exact source identities", () => {
	const records = Array.from(
		{ length: 24 },
		(_, index): AaRecord => ({
			id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
			slug: `new-family-${index}-high`,
			name: `New Family ${index} (High)`,
			releaseSlug: `new-family-${index}`,
			creatorId: "20000000-0000-4000-8000-000000000000",
			creatorSlug: "new-lab",
			creatorName: "New Lab",
			releasedAt: "2026-09-30",
			openWeights: false,
			deprecated: false,
			deprecatedTo: null,
			isReasoning: true,
			reasoningSetting: "high",
			effortLabel: "high",
			effortOrder: 40,
			estimated: false,
			intelligence: index,
			costPerTaskUsd: 1,
			totalCostUsd: null,
			outputTokensPerTask: null,
			totalOutputTokens: null,
			timePerTaskSeconds: null,
			outputSpeed: null,
			inputPrice: null,
			outputPrice: null,
			contextWindow: null,
		}),
	);
	const release = aaReleaseSchema.parse({
		source: "artificial_analysis",
		fetchedAt: "2026-10-01T00:00:00.000Z",
		sourceUrl: "https://artificialanalysis.ai/models",
		sourceSha256: "a".repeat(64),
		indexVersion: "example",
		records,
	});
	const actual = applyAaRelease(snapshot, release);
	expect(actual.benchmarks).toHaveLength(20);
	for (const model of actual.benchmarks ?? []) {
		const record = records.find(
			(candidate) => candidate.id === model.points[0]?.sourceId,
		);
		if (!record) throw new Error("Missing source record");
		expect(model.id).toBe(`aa-${record.creatorId}-${record.releaseSlug}`);
		expect(model.points[0]?.sourceSlug).toBe(record.slug);
		expect(model.points[0]?.intelligenceIndex).toBe(record.intelligence);
		expect(model.line).toBeNull();
		expect(model.group).toBe("frontier");
	}
	const changed = applyAaRelease(snapshot, {
		...release,
		records: records.map((record, index) =>
			index === 0 ? { ...record, intelligence: 100 } : record,
		),
	});
	expect(
		changed.benchmarks?.some(
			(model) => model.points[0]?.sourceId === records[0]?.id,
		),
	).toBe(true);
	expect(
		changed.benchmarks?.some(
			(model) => model.points[0]?.sourceId === records[4]?.id,
		),
	).toBe(false);
	expect(changed.models).toEqual(snapshot.models);
	const firstRecord = records[0];
	if (!firstRecord) throw new Error("Missing first record");
	const duplicate = {
		...firstRecord,
		id: "30000000-0000-4000-8000-000000000000",
		slug: "new-family-0-high-alternative",
		intelligence: 100,
	};
	const noCost = {
		...firstRecord,
		id: "40000000-0000-4000-8000-000000000000",
		slug: "new-family-0-high-no-cost",
		intelligence: 1000,
		costPerTaskUsd: null,
	};
	const duplicated = { ...release, records: [...records, duplicate, noCost] };
	const duplicateResult = applyAaRelease(snapshot, duplicated);
	expect(
		duplicateResult.benchmarks?.find(
			(model) => model.points[0]?.sourceId === duplicate.id,
		)?.points,
	).toHaveLength(1);
	expect(
		applyAaRelease(snapshot, {
			...duplicated,
			records: [...duplicated.records].reverse(),
		}).benchmarks,
	).toEqual(duplicateResult.benchmarks);
});

test("first match wins and Coding tools picks the newest cost-observed registry line", () => {
	const decoys = Array.from({ length: 20 }, (_, index) =>
		benchmarkFixture(`ranked-${index}`, 100 + index),
	);
	const fixtures = [
		benchmarkFixture("gemini-4-argon", 1),
		benchmarkFixture("kimi-k3", 1),
		benchmarkFixture("mistral-small-4", 1),
		{
			...benchmarkFixture("older-small", 1),
			line: "mistral-small",
			releasedAt: "2025-03-01",
		},
		{
			...benchmarkFixture("newer-no-cost", 1),
			line: "mistral-small",
			releasedAt: "2026-09-01",
			points: [],
		},
	];
	const usage = snapshot.models[0];
	if (!usage) throw new Error("Missing usage fixture");
	const result = selectBenchmarkModels(
		{ models: [{ ...usage, id: "kimi-k3", familyId: "kimi-k3" }] },
		[...decoys, ...fixtures],
	);
	expect(result.find((model) => model.id === "kimi-k3")?.group).toBe("in_use");
	expect(result.find((model) => model.id === "gemini-4-argon")?.group).toBe(
		"frontier",
	);
	expect(
		result
			.filter((model) => model.group === "coding_tools")
			.map((model) => model.id),
	).toEqual(["mistral-small-4"]);
	expect(new Set(result.map((model) => model.id)).size).toBe(result.length);
	for (const entry of CODING_MODEL_LINES) {
		expect(entry.rationale.length).toBeGreaterThan(10);
		expect(entry.sourceUrl).toMatch(/^https:\/\//);
	}
});

test("Earlier versions uses explicit lineage and dates, newest first, at most two non-in-use generations per line", () => {
	const decoys = Array.from({ length: 20 }, (_, index) =>
		benchmarkFixture(`ranked-${index}`, 100 + index),
	);
	const ids = [
		"claude-opus-4-6",
		"claude-opus-4-7",
		"claude-opus-4-8",
		"claude-opus-5",
		"claude-opus-5-5",
	];
	const candidates = [
		...decoys,
		...ids.map((id) => benchmarkFixture(id, 1)),
		{
			...benchmarkFixture("unrelated", 1),
			name: "Claude Opus 5.4",
			line: null,
		},
		{
			...benchmarkFixture("undated", 1),
			line: "claude-opus",
			releasedAt: null,
		},
	];
	const usage = snapshot.models.find((model) => model.id === "claude-opus-5-5");
	if (!usage) throw new Error("Missing Opus usage");
	const derive = (models: readonly TrendsBenchmarkModel[], inUse = [usage]) =>
		selectBenchmarkModels({ models: inUse }, models)
			.filter((model) => model.group === "earlier_versions")
			.map((model) => model.id);
	expect(derive(candidates)).toEqual(["claude-opus-5", "claude-opus-4-8"]);
	expect(
		derive(candidates, [
			usage,
			{ ...usage, id: "claude-opus-4-8", familyId: "claude-opus-4-8" },
		]),
	).toEqual(["claude-opus-5", "claude-opus-4-7"]);
	expect(
		derive(
			candidates.map((model) =>
				model.id === "claude-opus-5" ? { ...model, points: [] } : model,
			),
		),
	).toEqual(["claude-opus-4-8", "claude-opus-4-7"]);
	const upgraded = candidates.map((model) =>
		model.id === "claude-opus-5"
			? {
					...model,
					points: model.points.map((point) => ({
						...point,
						intelligenceIndex: 1000,
					})),
				}
			: model,
	);
	expect(derive(upgraded)).toEqual(["claude-opus-4-8"]);
});

test("a family's line joins every effort in order, the non-reasoning point included", () => {
	const points = [
		{ effort: "none", horizontal: 5, vertical: 20 },
		{ effort: "default", horizontal: 4, vertical: 25 },
		{ effort: "low", horizontal: 1, vertical: 30 },
		{ effort: "medium", horizontal: 2, vertical: 31 },
		{ effort: "high", horizontal: 1.5, vertical: 32 },
		{ effort: "xhigh", horizontal: 3, vertical: 31 },
		{ effort: "max", horizontal: 4, vertical: 34 },
	];
	const segments = reasoningLineSegments(points);
	expect(
		segments.map((segment) => segment.map((point) => point.effort)),
	).toEqual([["none", "low", "medium", "high", "xhigh", "max"]]);
	expect(segments.flat()).toEqual([...reasoningLinePoints(points)]);
});

test("direct labels are capped to leaders plus focused and hovered families, not table observations", () => {
	const series: TradeoffSeries[] = Array.from({ length: 30 }, (_, index) => ({
		id: `series-${index}`,
		name: `Series ${index}`,
		provider: "other",
		points: [
			{
				id: `point-${index}`,
				effort: "high",
				effortIndex: 4,
				horizontal: 1,
				vertical: index,
				rows: [],
			},
		],
	}));
	expect(directLabelSeries(series, 8, new Set(), null)).toHaveLength(8);
	expect(
		directLabelSeries(series, 5, new Set(["series-0"]), "series-1").map(
			(model) => model.id,
		),
	).toEqual([
		"series-0",
		"series-1",
		"series-29",
		"series-28",
		"series-27",
		"series-26",
		"series-25",
	]);
	expect(series).toHaveLength(30);
});

test("crowded label placement prioritizes focus, tries both leader sides, and never forces overlaps", () => {
	const placed = placeDirectLabels(
		[
			{ id: "first", priority: 0, x: 150, y: 100, width: 100 },
			{ id: "focused", priority: 2, x: 150, y: 110, width: 100 },
			{ id: "third", priority: 0, x: 150, y: 120, width: 100 },
		],
		[],
		{ left: 0, top: 0, right: 300, bottom: 250 },
	);
	expect(placed.get("focused")?.leader).toBe(false);
	const boxes = [...placed.values()].map((label) => {
		const left =
			label.anchor === "end"
				? label.x - label.width
				: label.anchor === "middle"
					? label.x - label.width / 2
					: label.x;
		return {
			left,
			right: left + label.width,
			top: label.y - 12,
			bottom: label.y + 4,
		};
	});
	for (const [index, first] of boxes.entries())
		for (const second of boxes.slice(index + 1))
			expect(
				first.left < second.right &&
					first.right > second.left &&
					first.top < second.bottom &&
					first.bottom > second.top,
			).toBe(false);
	expect(
		placeDirectLabels(
			[{ id: "too-wide", priority: 0, x: 100, y: 100, width: 400 }],
			[],
			{ left: 0, top: 0, right: 300, bottom: 250 },
		).size,
	).toBe(0);
});

function benchmarkFixture(
	id: string,
	intelligence: number,
): TrendsBenchmarkModel {
	const family = MODEL_REGISTRY[id];
	const point: TrendsBenchmarkPoint = {
		sourceId: null,
		sourceSlug: null,
		sourceUrl: "https://artificialanalysis.ai/models",
		estimated: false,
		effort: "high",
		effortLabel: "high",
		effortOrder: 40,
		intelligenceIndex: intelligence,
		costPerTaskUsd: 1,
		timePerTaskSeconds: null,
		outputTokensPerTask: null,
		totalOutputTokens: null,
		totalCostUsd: null,
	};
	return {
		id,
		name: family?.displayName ?? id,
		provider: family?.lab ?? "other",
		creator: family?.creator ?? "Example",
		line: family?.line ?? null,
		releasedAt: family?.releasedAt ?? null,
		group: "frontier",
		url: point.sourceUrl,
		points: [point],
	};
}

test("weekly shares name every in-use family without an Other bucket or recoloring on selection", () => {
	const full = buildShareSeries(snapshot, snapshot.models);
	expect(full.map((series) => series.id)).toEqual(
		snapshot.models.map((model) => model.id),
	);
	expect(new Set(full.map((series) => series.color)).size).toBe(full.length);
	const subset = buildShareSeries(snapshot, snapshot.models.slice(1));
	for (const series of subset) {
		const original = full.find((candidate) => candidate.id === series.id);
		if (!original) throw new Error(`Missing share series ${series.id}`);
		expect(series.color).toBe(original.color);
	}
});

test("publication thresholds and the inclusive 1% cutoff use the full population before rounding", () => {
	const example = current[0];
	if (!example) throw new Error("Expected preview population");
	const small = { ...example, familyId: "gpt-6-luna", runs: 1000 };
	const large = { ...example, familyId: "claude-opus-5-5", runs: 99000 };
	const derive = (
		rows: readonly DailyUsage[],
		thresholds = snapshot.thresholds,
	) =>
		deriveUsageSnapshot(
			rows,
			snapshot.periodStart,
			snapshot.periodEndExclusive,
			{},
			thresholds,
		);
	expect(derive([small, large]).models.map((model) => model.id)).toEqual([
		large.familyId,
		small.familyId,
	]);
	const belowShare = derive([
		{ ...small, runs: 9999 },
		{ ...large, runs: 990001 },
	]);
	expect(belowShare.models.map((model) => model.id)).toEqual([large.familyId]);
	expect(belowShare.totals.runs).toBe(1000000);
	expect(
		derive([small, large], {
			...snapshot.thresholds,
			minRuns: 1001,
		}).models.map((model) => model.id),
	).toEqual([large.familyId]);
	const fewDevelopers = {
		...small,
		distribution: small.distribution.slice(0, 95),
	};
	expect(
		derive([fewDevelopers, large], {
			...snapshot.thresholds,
			minDevelopers: 96,
		}).models.map((model) => model.id),
	).toEqual([large.familyId]);
	expect(
		derive([small, large], { ...snapshot.thresholds, minWorkspaces: 41 })
			.models,
	).toEqual([]);
	expect(derive([]).models).toEqual([]);
});

test("every selected family's exact AA override supplies the effort rather than AA default order", () => {
	for (const model of snapshot.benchmarks ?? []) {
		const variants = MODEL_VARIANTS.filter(
			(variant) => variant.familyId === model.id,
		);
		expect(variants.length).toBeGreaterThan(0);
		for (const variant of variants) {
			expect(variant.aaId).not.toBeNull();
			const mapping = resolveAaVariant({
				id: variant.aaId ?? "",
				slug: variant.aaSlug,
				name: "Default",
				releaseSlug: MODEL_REGISTRY[model.id]?.aaReleaseSlug ?? "",
				creatorSlug: model.provider,
				isReasoning: true,
				reasoningSetting: "default",
			});
			expect(mapping?.effort).toBe(variant.effort);
			expect(mapping?.effortOrder).toBe(variant.effortOrder);
		}
	}
});

test("unspecified default stays in tables but never doubles back in connected lines or ranges", () => {
	const efforts = new Set(REASONING_EFFORTS);
	for (const family of snapshot.benchmarks ?? []) {
		const point = family.points[0];
		if (!point) throw new Error("Expected benchmark point");
		const duplicate = { ...point, effort: "default" as const, effortOrder: 35 };
		const model = {
			...family,
			points: [
				...family.points.filter((candidate) => candidate.effort !== "default"),
				duplicate,
			],
		};
		const table = benchmarkObservations([model], "costPerTaskUsd", efforts);
		expect(table.some((row) => row.point.effort === "default")).toBe(true);
		const geometry = benchmarkObservations(
			[model],
			"costPerTaskUsd",
			efforts,
			true,
		);
		const line = reasoningLinePoints(geometry.map((row) => row.point));
		if (
			family.points.some(
				(candidate) =>
					candidate.effort !== "none" && candidate.effort !== "default",
			)
		)
			expect(line.some((candidate) => candidate.effort === "default")).toBe(
				false,
			);
		const hasNamed = family.points.some(
			(candidate) =>
				candidate.effort !== "none" && candidate.effort !== "default",
		);
		expect(geometry.some((row) => row.point.effort === "default")).toBe(
			!hasNamed,
		);
		expect(new Set(geometry.map((row) => row.point.effort)).size).toBe(
			geometry.length,
		);
		for (const [index, row] of geometry.entries())
			expect(row.point.effortOrder).toBeGreaterThan(
				geometry[index - 1]?.point.effortOrder ?? -Infinity,
			);
		expect(
			benchmarkObservations(
				[model],
				"costPerTaskUsd",
				new Set(["default"]),
				true,
			),
		).toHaveLength(hasNamed ? 0 : 1);
		expect(
			benchmarkObservations(
				[{ ...family, points: [duplicate] }],
				"costPerTaskUsd",
				efforts,
				true,
			).length,
		).toBe(1);
	}
});
