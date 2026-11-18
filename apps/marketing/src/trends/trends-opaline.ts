import { MODEL_REGISTRY } from "../../../../packages/api-routes/src/model-registry";
import type {
	TrendsUsage,
	TrendsUsageMetrics,
} from "../../../../packages/api-routes/src/trends-usage";
import type {
	TrendsModel,
	TrendsModelMetrics,
	TrendsSnapshot,
} from "./trends-snapshot";

/**
 * Replaces the synthetic In the wild population with Opaline's published
 * aggregate (`GET /api/trends/usage`). Benchmarks are re-selected by the
 * caller, since the In use group follows the usage models.
 */
export function applyOpalineUsage(
	snapshot: TrendsSnapshot,
	usage: TrendsUsage,
	sourceUrl: string,
): TrendsSnapshot {
	const models = usage.models.flatMap((model): TrendsModel[] => {
		const family = MODEL_REGISTRY[model.familyId];
		if (!family) return [];
		return [
			{
				id: model.familyId,
				familyId: model.familyId,
				name: family.displayName,
				provider: family.lab,
				runs: model.runs,
				...(model.sessions === undefined ? {} : { sessions: model.sessions }),
				developers: model.developers,
				workspaces: model.workspaces,
				topApology: model.topApology,
				replyRate: model.current.replyRate,
				// Reasoning effort is not recorded per run yet.
				benchmarkEffort: family.defaultEffort,
				effortPolicy: "vendor_default",
				firstUsedAt: model.firstUsedAt,
				// All time has no "new this period".
				isNew:
					usage.scope !== "all_time" && model.firstUsedAt >= usage.periodStart,
				totalOutputTokens: model.totalOutputTokens,
				totalCostUsd: model.totalCostUsd,
				...metrics(model.current),
				...(model.previous ? { previous: metrics(model.previous) } : {}),
			},
		];
	});
	return {
		...snapshot,
		sources: {
			...snapshot.sources,
			usage: {
				kind: "opaline",
				periodStart: usage.periodStart,
				periodEndExclusive: usage.periodEndExclusive,
			},
			harnesses: {
				kind: "opaline",
				fetchedAt: usage.generatedAt,
				sourceUrl,
			},
		},
		periodStart: usage.periodStart,
		periodEndExclusive: usage.periodEndExclusive,
		...(usage.scope ? { usageScope: usage.scope } : {}),
		...(usage.runTimeMonths ? { runTimeMonths: usage.runTimeMonths } : {}),
		...(usage.toolCallMonths ? { toolCallMonths: usage.toolCallMonths } : {}),
		...(usage.friction ? { friction: usage.friction } : {}),
		publishedAt: usage.generatedAt,
		totals: usage.totals,
		thresholds: {
			minRuns: usage.thresholds.minRuns,
			minDevelopers: usage.thresholds.minDevelopers,
			minWorkspaces: usage.thresholds.minWorkspaces,
		},
		models,
		weeks: usage.weeks,
		...(usage.modelDays
			? {
					opalineModelDays: usage.modelDays.map((day) => ({
						day: day.day,
						turnsByModel: day.runsByModel,
					})),
				}
			: {}),
		shareWindow: usage.shareWindow,
		harnessDays: usage.harnessDays,
		opalineHarnessDays: usage.harnessDays,
	};
}

function metrics(source: TrendsUsageMetrics): TrendsModelMetrics {
	return {
		apologiesPer100Runs: source.apologiesPer100Runs,
		reactions: source.reactions,
		swearsPer1kPrompts: source.swearsPer1kPrompts,
		toolFailureRate: source.toolFailureRate,
		runSeconds: source.runSeconds,
		outputTokensPerRun: source.outputTokensPerRun,
		costPerRunUsd: source.costPerRunUsd,
	};
}
