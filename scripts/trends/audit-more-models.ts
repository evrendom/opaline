import assert from "node:assert/strict";
import { axisTicks } from "../../apps/marketing/src/components/trends/trends-benchmark-charts";
import {
	rankMovements,
	sectionRank,
} from "../../apps/marketing/src/components/trends/trends-movement";
import { TRENDS_SECTIONS } from "../../apps/marketing/src/components/trends/trends-sections";
import { createPreviewPopulation } from "../../apps/marketing/src/trends/preview-population";
import { PREVIEW_TRENDS_SNAPSHOT } from "../../apps/marketing/src/trends/preview-snapshot";
import {
	benchmarkObservations,
	paretoObservations,
	REASONING_EFFORTS,
	reasoningLinePoints,
	reasoningLineSegments,
	usageBenchmark,
} from "../../apps/marketing/src/trends/trends-benchmarks";
import { applyAaRelease } from "../../apps/marketing/src/trends/trends-release";
import { addDays } from "../../apps/marketing/src/trends/trends-usage";
import {
	MODEL_REGISTRY,
	MODEL_VARIANTS,
	resolveAaReleaseIdentity,
	resolveAaVariant,
} from "../../packages/api-routes/src/model-registry";
import {
	CODING_MODEL_LINES,
	FRONTIER_FAMILY_IDS,
} from "../../packages/api-routes/src/model-registry-aa";
import { aaReleaseSchema } from "../../packages/api-routes/src/trends-aa-release";

const release = aaReleaseSchema.parse(
	await Bun.file("apps/marketing/src/trends/generated/aa-release.json").json(),
);
const snapshot = applyAaRelease(PREVIEW_TRENDS_SNAPSHOT, release);
const population = createPreviewPopulation();
const current = population.filter(
	(row) =>
		row.day >= snapshot.periodStart && row.day < snapshot.periodEndExclusive,
);
const sum = (key: "runs" | "outputTokens" | "costUsd", harness?: string) =>
	current
		.filter((row) => !harness || row.harness === harness)
		.reduce((total, row) => total + row[key], 0);
let checks = 0;
const summaries = snapshot.models.map((model) => {
	const rows = current.filter((row) => row.familyId === model.familyId);
	const samples = rows.flatMap((row) => row.distribution);
	const replied = rows.reduce((total, row) => total + row.repliedRuns, 0);
	const prompts = rows.reduce((total, row) => total + row.prompts, 0);
	const calls = rows.reduce((total, row) => total + row.toolCalls, 0);
	assert.equal(
		model.apologiesPer100Runs,
		(100 * rows.reduce((total, row) => total + row.apologies, 0)) / model.runs,
	);
	assert.equal(model.replyRate, replied / model.runs);
	assert.equal(
		model.swearsPer1kPrompts,
		(1000 * rows.reduce((total, row) => total + row.swears, 0)) / prompts,
	);
	assert.equal(
		model.toolFailureRate,
		rows.reduce((total, row) => total + row.toolFailures, 0) / calls,
	);
	for (const reaction of ["negative", "mixed", "neutral", "positive"] as const)
		assert.equal(
			model.reactions[reaction],
			rows.reduce((total, row) => total + row.reactions[reaction], 0) / replied,
		);
	for (const [field, quantiles] of [
		["seconds", model.runSeconds],
		["outputTokens", model.outputTokensPerRun],
		["costUsd", model.costPerRunUsd],
	] as const) {
		for (const [name, fraction] of [
			["p50", 0.5],
			["p90", 0.9],
			["p99", 0.99],
		] as const) {
			const expected = quantiles[name];
			assert(expected !== undefined);
			const below = samples
				.filter((sample) => sample[field] < expected)
				.reduce((total, sample) => total + sample.count, 0);
			const atOrBelow = samples
				.filter((sample) => sample[field] <= expected)
				.reduce((total, sample) => total + sample.count, 0);
			assert(below < Math.ceil(model.runs * fraction));
			assert(atOrBelow >= Math.ceil(model.runs * fraction));
			checks += 2;
		}
	}
	const lowerTokenBound =
		model.runs *
		(0.4 * model.outputTokensPerRun.p50 +
			0.09 * model.outputTokensPerRun.p90 +
			0.01 * (model.outputTokensPerRun.p99 ?? 0));
	const lowerCostBound =
		model.runs *
		(0.4 * model.costPerRunUsd.p50 +
			0.09 * model.costPerRunUsd.p90 +
			0.01 * (model.costPerRunUsd.p99 ?? 0));
	assert(model.totalOutputTokens >= lowerTokenBound);
	assert(model.totalCostUsd >= lowerCostBound);
	assert.equal(
		model.isNew,
		!population.some(
			(row) =>
				row.familyId === model.familyId && row.day < snapshot.periodStart,
		),
	);
	const benchmark = usageBenchmark(model, snapshot);
	assert(benchmark);
	const original = release.records.find(
		(record) => record.id === benchmark.sourceId,
	);
	assert(original);
	assert.equal(benchmark.intelligenceIndex, original.intelligence);
	assert.equal(benchmark.effort, model.benchmarkEffort);
	assert.equal(model.name, MODEL_REGISTRY[model.familyId]?.displayName);
	checks += 16;
	return {
		family: model.id,
		runs: model.runs,
		developers: model.developers,
		workspaces: model.workspaces,
		firstUsedAt: model.firstUsedAt,
		isNew: model.isNew,
		hasPrevious: !!model.previous,
		effort: model.benchmarkEffort,
		sourceId: benchmark.sourceId,
		quantileLowerBounds: "passed",
	};
});
for (const week of snapshot.weeks) {
	const end = addDays(week.weekStart, 7);
	assert(end <= snapshot.periodEndExclusive);
	for (const model of snapshot.models)
		assert.equal(
			week.runsByModel[model.id],
			population
				.filter(
					(row) =>
						row.familyId === model.familyId &&
						row.day >= week.weekStart &&
						row.day < end,
				)
				.reduce((total, row) => total + row.runs, 0),
		);
	checks += 9;
}
for (const section of TRENDS_SECTIONS) {
	const value = sectionRank(section);
	if (value) {
		const current = [...snapshot.models].sort(
			(first, second) => value(second) - value(first),
		);
		const prior = snapshot.models
			.flatMap((model) =>
				model.previous ? [{ id: model.id, value: value(model.previous) }] : [],
			)
			.sort((first, second) => second.value - first.value);
		const movements = rankMovements(section, snapshot.models);
		for (const [index, model] of current.entries()) {
			const before = prior.findIndex((candidate) => candidate.id === model.id);
			assert.equal(
				movements.get(model.id)?.delta,
				before < 0 ? null : before - index,
			);
			checks++;
		}
	}
}
const curated = snapshot.benchmarks ?? [];
assert.deepEqual(
	curated.filter((model) => model.group === "in_use").map((model) => model.id),
	snapshot.models.map((model) => model.id),
);
for (const [index, model] of snapshot.models.entries()) {
	assert(model.runs >= snapshot.thresholds.minRuns);
	assert(model.developers >= snapshot.thresholds.minDevelopers);
	assert(model.workspaces >= snapshot.thresholds.minWorkspaces);
	assert(model.runs / snapshot.totals.runs >= 0.01);
	assert(model.runs <= (snapshot.models[index - 1]?.runs ?? Infinity));
	checks += 5;
}
const extraModels = curated.filter((model) => model.group !== "in_use");
const publishedIds = new Set(snapshot.models.map((model) => model.familyId));
const publishedRuns = snapshot.models.reduce(
	(total, model) => total + model.runs,
	0,
);
const excludedRuns = current
	.filter((row) => !publishedIds.has(row.familyId))
	.reduce((total, row) => total + row.runs, 0);
assert.equal(publishedRuns + excludedRuns, snapshot.totals.runs);
checks++;

assert.equal(new Set(curated.map((model) => model.id)).size, curated.length);
const claimed = new Set(publishedIds);
const rawScores = new Map<string, number>();
const costIds = new Set<string>();
for (const record of release.records) {
	const { family } = resolveAaReleaseIdentity(record);
	if (record.costPerTaskUsd === null) continue;
	costIds.add(family.id);
	if (record.intelligence !== null)
		rawScores.set(
			family.id,
			Math.max(rawScores.get(family.id) ?? -Infinity, record.intelligence),
		);
}
const rawTop20 = [...rawScores]
	.sort(
		(first, second) =>
			second[1] - first[1] || first[0].localeCompare(second[0]),
	)
	.slice(0, 20)
	.map(([id]) => id);
const sourceList = await Bun.file(".context/aa/curated-families.json").json();
const slopalyticsSlugs = [
	...Object.keys(sourceList.frontier),
	...sourceList.notable,
];
assert.deepEqual(
	FRONTIER_FAMILY_IDS.map((id) => MODEL_REGISTRY[id]?.aaReleaseSlug).sort(),
	slopalyticsSlugs.sort(),
);
for (const id of FRONTIER_FAMILY_IDS) {
	const family = MODEL_REGISTRY[id];
	assert(family);
	const records = release.records.filter(
		(record) =>
			record.releaseSlug === family.aaReleaseSlug &&
			record.creatorSlug === family.lab,
	);
	assert(records.length > 0, id);
	assert(
		records.every((record) =>
			MODEL_VARIANTS.some(
				(variant) =>
					variant.familyId === id &&
					variant.aaId === record.id &&
					variant.aaSlug === record.slug,
			),
		),
	);
	checks += 3;
}
const frontierIds = new Set(
	[...rawTop20, ...FRONTIER_FAMILY_IDS.filter((id) => costIds.has(id))].filter(
		(id) => !claimed.has(id),
	),
);
assert.deepEqual(
	curated
		.filter((model) => model.group === "frontier")
		.map((model) => model.id)
		.sort(),
	[...frontierIds].sort(),
);
for (const id of frontierIds) claimed.add(id);
const newest = (
	first: { releasedAt: string | null; id: string },
	second: { releasedAt: string | null; id: string },
) =>
	(second.releasedAt ?? "").localeCompare(first.releasedAt ?? "") ||
	first.id.localeCompare(second.id);
const codingExpected = CODING_MODEL_LINES.flatMap(({ line }) => {
	const family = Object.values(MODEL_REGISTRY)
		.filter(
			(family) =>
				family.line === line && family.releasedAt && costIds.has(family.id),
		)
		.sort(newest)[0];
	return family ? [family.id] : [];
})
	.filter((id) => !claimed.has(id))
	.slice(0, 15);
assert.deepEqual(
	curated
		.filter((model) => model.group === "coding_tools")
		.map((model) => model.id),
	codingExpected,
);
for (const id of codingExpected) claimed.add(id);
const anchors = new Map<string, (typeof MODEL_REGISTRY)[string]>();
for (const usage of snapshot.models) {
	const family = MODEL_REGISTRY[usage.familyId];
	assert(family);
	if (!family.line || !family.releasedAt) continue;
	const current = anchors.get(family.line);
	if (!current || newest(family, current) < 0) anchors.set(family.line, family);
}
const earlierExpected = [...anchors.values()]
	.flatMap((anchor) =>
		Object.values(MODEL_REGISTRY)
			.filter(
				(family) =>
					family.line === anchor.line &&
					family.lab === anchor.lab &&
					family.releasedAt &&
					family.releasedAt < (anchor.releasedAt ?? "") &&
					!publishedIds.has(family.id) &&
					costIds.has(family.id),
			)
			.sort(newest)
			.slice(0, 2),
	)
	.sort(newest)
	.filter((family) => !claimed.has(family.id))
	.map((family) => family.id);
assert.deepEqual(
	curated
		.filter((model) => model.group === "earlier_versions")
		.map((model) => model.id),
	earlierExpected,
);
for (const model of extraModels) {
	assert(costIds.has(model.id));
	assert(!publishedIds.has(model.id));
	checks += 2;
}
checks += 5;
const geometry: unknown[] = [];
for (const model of curated) {
	const records = model.points.map((point) =>
		release.records.find((record) => record.id === point.sourceId),
	);
	assert(
		records.every(
			(record) =>
				record &&
				MODEL_VARIANTS.some(
					(variant) =>
						variant.aaId === record.id && variant.familyId === model.id,
				),
		),
		`${model.id}: missing exact override for ${records
			.filter(
				(record) =>
					record &&
					!MODEL_VARIANTS.some((variant) => variant.aaId === record.id),
			)
			.map((record) => record?.slug)
			.join(", ")}`,
	);
	assert.equal(
		new Set(model.points.map((point) => point.effort)).size,
		model.points.length,
	);
	const geometryPoints = benchmarkObservations(
		[model],
		"costPerTaskUsd",
		new Set(REASONING_EFFORTS),
		true,
	).map((row) => row.point);
	const line = reasoningLinePoints(geometryPoints);
	assert(
		!line.some((point) => point.effort === "default") || line.length === 1,
	);
	for (const [index, point] of line.entries())
		assert(point.effortOrder > (line[index - 1]?.effortOrder ?? -Infinity));
	geometry.push({
		family: model.id,
		connectedEfforts: line.map((point) => point.effort),
		detachedBaselines: model.points
			.filter(
				(point) =>
					!line.includes(point) && ["none", "default"].includes(point.effort),
			)
			.map((point) => ({
				effort: point.effort,
				cost: point.costPerTaskUsd,
				intelligence: point.intelligenceIndex,
			})),
		missingObservations: model.points
			.filter(
				(point) =>
					point.costPerTaskUsd === null || point.intelligenceIndex === null,
			)
			.map((point) => point.effort),
	});
	checks += 3 + line.length;
}

const nonMonotone: unknown[] = [];
for (const model of curated) {
	for (const metric of ["costPerTaskUsd", "timePerTaskSeconds"] as const) {
		const points = benchmarkObservations(
			[model],
			metric,
			new Set(REASONING_EFFORTS),
			true,
		)
			.filter((row) => row.point.intelligenceIndex !== null)
			.map((row) => ({
				effort: row.point.effort,
				horizontal: row.value,
				vertical: row.point.intelligenceIndex ?? 0,
			}));
		const named = reasoningLinePoints(points);
		const segments = reasoningLineSegments(points);
		const reversals = named.flatMap((point, index) => {
			const prior = named[index - 1];
			return prior &&
				(point.horizontal < prior.horizontal || point.vertical < prior.vertical)
				? [
						{
							from: prior.effort,
							to: point.effort,
							horizontal: [prior.horizontal, point.horizontal],
							intelligence: [prior.vertical, point.vertical],
						},
					]
				: [];
		});
		const baselines = points.filter((point) => !named.includes(point));
		if (reversals.length || baselines.length)
			nonMonotone.push({
				family: model.id,
				metric,
				reversals,
				detachedBaselines: baselines,
				segments: segments.map((segment) =>
					segment.map((point) => point.effort),
				),
			});
		for (let mask = 0; mask < 128; mask++) {
			const efforts = new Set(
				REASONING_EFFORTS.filter((_, index) => mask & (1 << index)),
			);
			const selected = points.filter((point) => efforts.has(point.effort));
			const selectedSegments = reasoningLineSegments(selected);
			assert.deepEqual(selectedSegments.flat(), reasoningLinePoints(selected));
			// Lines are unbroken in effort order, reversals included.
			assert(selectedSegments.length <= 1);
			checks++;
		}
	}
}
for (let mask = 0; mask < 128; mask++) {
	const efforts = new Set(
		REASONING_EFFORTS.filter((_, index) => mask & (1 << index)),
	);
	const rows = benchmarkObservations(curated, "costPerTaskUsd", efforts).filter(
		(row) => row.point.intelligenceIndex !== null,
	);
	const grouped = new Map<number, typeof rows>();
	for (const row of rows)
		grouped.set(row.value, [...(grouped.get(row.value) ?? []), row]);
	const frontier: string[] = [];
	let bestLowerCost = -Infinity;
	for (const [, tied] of [...grouped].sort(
		([first], [second]) => first - second,
	)) {
		const best = Math.max(
			...tied.map((row) => row.point.intelligenceIndex ?? -Infinity),
		);
		if (best > bestLowerCost)
			frontier.push(
				...tied
					.filter((row) => row.point.intelligenceIndex === best)
					.map((row) => `${row.model.id}/${row.point.effort}`),
			);
		bestLowerCost = Math.max(bestLowerCost, best);
	}
	assert.deepEqual(
		paretoObservations(rows)
			.map((row) => `${row.model.id}/${row.point.effort}`)
			.sort(),
		frontier.sort(),
	);
	checks++;
}
for (const row of benchmarkObservations(
	curated,
	"costPerTaskUsd",
	new Set(REASONING_EFFORTS),
).filter((row) => row.value > 0)) {
	const ticks = axisTicks([row.value], true, 7);
	const lower = ticks[0];
	const upper = ticks.at(-1);
	assert(
		ticks.length >= 2 &&
			lower !== undefined &&
			upper !== undefined &&
			lower < row.value &&
			upper > row.value,
	);
	checks++;
}
assert.equal(snapshot.totals.runs, sum("runs"));
const harnessTotals = Object.fromEntries(
	["claude-code", "codex"].map((harness) => [
		harness,
		{
			runs: sum("runs", harness),
			outputTokens: sum("outputTokens", harness),
			costUsd: sum("costUsd", harness),
		},
	]),
);
const rawCaptureMatchesHash =
	new Bun.CryptoHasher("sha256")
		.update(await Bun.file(".context/aa/public-payload.bin").arrayBuffer())
		.digest("hex") === release.sourceSha256;
assert(rawCaptureMatchesHash);
const report = {
	checks,
	populationRows: population.length,
	currentRows: current.length,
	period: {
		start: snapshot.periodStart,
		endExclusive: snapshot.periodEndExclusive,
	},
	totals: snapshot.totals,
	harnessTotals,
	sums: {
		runs: sum("runs"),
		outputTokens: sum("outputTokens"),
		costUsd: sum("costUsd"),
	},
	shareWindow: snapshot.shareWindow,
	models: summaries,
	modelSet: {
		inUse: snapshot.models.length,
		publishedRuns,
		excludedRuns,
		shareDenominator: snapshot.totals.runs,
		groups: Object.fromEntries(
			["in_use", "frontier", "coding_tools", "earlier_versions"].map(
				(group) => [
					group,
					curated
						.filter((model) => model.group === group)
						.map((model) => model.id),
				],
			),
		),
		rawTop20,
		geometry,
		nonMonotone,
	},
	coverage: {
		records: release.records.length,
		mapped: release.records.filter((record) => resolveAaVariant(record)).length,
		unmapped: release.records.filter((record) => !resolveAaVariant(record))
			.length,
		registeredFamilies: Object.keys(MODEL_REGISTRY).length,
		pageFamilies: curated.length,
		variantsWithUuidMappings: MODEL_VARIANTS.filter((variant) => variant.aaId)
			.length,
		displayedVariants: curated.reduce(
			(total, model) => total + model.points.length,
			0,
		),
	},
	provenance: {
		fetchedAt: release.fetchedAt,
		version: release.indexVersion,
		sourceSha256: release.sourceSha256,
		rawCaptureMatchesHash,
	},
	results:
		"All counts, rates, quantiles, previous-period/new status, rank movement, benchmark joins, 13 complete weekly windows, exclusive groups, raw top-20 union, registry coding generations, capped explicit predecessors, 10,496 effort/axis geometry cases, 128 Pareto cases and single-point axes passed.",
};
await Bun.write(
	".context/aa/more-models-audit-results.json",
	JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
