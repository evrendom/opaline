import type {
	TrendsModel,
	TrendsModelMetrics,
} from "../../trends/trends-snapshot";
import type { TrendsSection } from "./trends-sections";

export interface RankMovement {
	/** 1-based position among the selected models this period. */
	readonly rank: number;
	/** Places gained (positive) or lost since the previous period; null when the model is new. */
	readonly delta: number | null;
	readonly isNew: boolean;
}

/** The figure a section ranks models by, descending; null for charts without a ranking. */
export function sectionRank(
	section: TrendsSection,
): ((metrics: TrendsModelMetrics) => number | null) | null {
	switch (section.kind) {
		case "ranked":
			return section.value;
		case "range":
			return (metrics) => section.quantiles(metrics)?.p50 ?? null;
		case "share":
		case "scatter":
		case "harness":
		case "timeline":
			return null;
	}
}

/**
 * Rank movement for every selected model, computed among the selected models
 * only, so hiding a model re-ranks the rest the way the chart shows them.
 */
export function rankMovements(
	section: TrendsSection,
	models: readonly TrendsModel[],
): ReadonlyMap<string, RankMovement> {
	const rank = sectionRank(section);
	const movements = new Map<string, RankMovement>();
	if (!rank) return movements;
	// Unmeasured models are not ranked; a model unmeasured before is new to it.
	const current = models
		.flatMap((model) => {
			const value = rank(model);
			return value === null ? [] : [{ model, value }];
		})
		.sort((a, b) => b.value - a.value)
		.map(({ model }) => model);
	const previous = models
		.flatMap((model) => {
			const value = model.previous ? rank(model.previous) : null;
			return value === null ? [] : [{ id: model.id, value }];
		})
		.sort((a, b) => b.value - a.value);
	const previousRank = new Map(
		previous.map((entry, index) => [entry.id, index + 1]),
	);
	current.forEach((model, index) => {
		const before = previousRank.get(model.id);
		movements.set(model.id, {
			rank: index + 1,
			delta: before === undefined ? null : before - (index + 1),
			isNew: model.isNew,
		});
	});
	return movements;
}
