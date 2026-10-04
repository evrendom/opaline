import {
	MODEL_REGISTRY,
	MODEL_VARIANTS,
} from "../../../../packages/api-routes/src/model-registry";
import {
	createPreviewPopulation,
	PREVIEW_USAGE_EFFORTS,
	seededRandom,
} from "./preview-population";
import { selectBenchmarkModels } from "./trends-release";
import type { TrendsBenchmarkModel, TrendsSnapshot } from "./trends-snapshot";
import { deriveUsageSnapshot } from "./trends-usage";

const usage = deriveUsageSnapshot(
	createPreviewPopulation(),
	"2026-09-01",
	"2026-10-01",
	PREVIEW_USAGE_EFFORTS,
);

export const PREVIEW_TRENDS_SNAPSHOT: TrendsSnapshot = {
	...usage,
	sources: {
		benchmarks: {
			kind: "preview",
			fetchedAt: "2026-10-01T00:00:00.000Z",
			sourceUrl: null,
			sourceSha256: null,
			indexVersion: null,
		},
		usage: {
			kind: "preview",
			periodStart: "2026-09-01",
			periodEndExclusive: "2026-10-01",
		},
		harnesses: {
			kind: "preview",
			fetchedAt: "2026-10-01T00:00:00.000Z",
			sourceUrl: null,
		},
	},
	benchmarks: selectBenchmarkModels(usage, previewBenchmarks()),
};

/** Seeded synthetic benchmarks for every registry family, before grouping. */
export function previewBenchmarks(): TrendsBenchmarkModel[] {
	const random = seededRandom(96312);
	return Object.values(MODEL_REGISTRY)
		.filter((family) =>
			MODEL_VARIANTS.some((variant) => variant.familyId === family.id),
		)
		.map((family, familyIndex) => {
			const url = `https://artificialanalysis.ai/models/${family.aaReleaseSlug}`;
			const baseTokens = 1800 + random() * 5000;
			const outputPrice = 0.6 + random() * 18;
			const inputPrice = outputPrice / (3 + random() * 3);
			const points = MODEL_VARIANTS.filter(
				(variant, index, variants) =>
					variant.familyId === family.id &&
					variants.findIndex(
						(candidate) =>
							candidate.familyId === family.id &&
							candidate.effort === variant.effort,
					) === index,
			).map((variant, index) => {
				const evaluations = [120, 200, 300, 150, 230].map(
					(tasks, evaluation) => {
						const tokens =
							baseTokens *
							(1 + index * (0.4 + random() * 0.8)) *
							(0.4 + random() * 1.8);
						const inputTokens = tokens * (1.2 + random() * 3);
						return {
							tasks,
							weight: [0.15, 0.25, 0.3, 0.1, 0.2][evaluation] ?? 0,
							tokens,
							cost: (tokens * outputPrice + inputTokens * inputPrice) / 1e6,
						};
					},
				);
				const tokens = evaluations.reduce(
					(total, row) => total + row.tokens * row.weight,
					0,
				);
				return {
					effort: variant.effort,
					effortOrder: variant.effortOrder,
					effortLabel: variant.effort,
					sourceId: null,
					sourceSlug: null,
					sourceUrl: url,
					estimated: false,
					intelligenceIndex: 28 + random() * 7 + index * (1 + random() * 2),
					costPerTaskUsd: evaluations.reduce(
						(total, row) => total + row.cost * row.weight,
						0,
					),
					totalCostUsd: evaluations.reduce(
						(total, row) => total + row.tasks * row.cost,
						0,
					),
					outputTokensPerTask: tokens,
					totalOutputTokens: evaluations.reduce(
						(total, row) => total + row.tasks * row.tokens,
						0,
					),
					timePerTaskSeconds:
						(familyIndex + index) % 9 === 0
							? null
							: tokens / (30 + random() * 130),
				};
			});
			return {
				id: family.id,
				name: family.displayName,
				provider: family.lab,
				creator: family.creator,
				group: "frontier",
				line: family.line,
				releasedAt: family.releasedAt,
				url,
				points,
			};
		});
}
