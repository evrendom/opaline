import { resolveAaReleaseIdentity } from "../../../../packages/api-routes/src/model-registry";
import {
	CODING_MODEL_LINES,
	FRONTIER_FAMILY_IDS,
} from "../../../../packages/api-routes/src/model-registry-aa";
import type { AaRelease } from "../../../../packages/api-routes/src/trends-aa-release";
import type {
	TrendsBenchmarkModel,
	TrendsBenchmarkPoint,
	TrendsModelGroup,
	TrendsSnapshot,
} from "./trends-snapshot";

export function applyAaRelease(
	snapshot: TrendsSnapshot,
	release: AaRelease,
): TrendsSnapshot {
	const models = new Map<string, TrendsBenchmarkModel>();
	for (const record of release.records) {
		const { family, variant: mapping } = resolveAaReleaseIdentity(record);
		const { effort } = mapping;
		const existing = models.get(family.id);
		const url = `https://artificialanalysis.ai/models/${record.releaseSlug}`;
		const point: TrendsBenchmarkPoint = {
			sourceId: record.id,
			sourceSlug: record.slug,
			sourceUrl: url,
			effort,
			effortOrder: mapping.effortOrder,
			effortLabel:
				record.effortLabel === "default" && effort !== "default"
					? `${effort} (AA default)`
					: (record.effortLabel ??
						(effort === "default" && record.isReasoning
							? "reasoning (default)"
							: effort)),
			estimated: record.estimated,
			intelligenceIndex: record.intelligence,
			costPerTaskUsd: record.costPerTaskUsd,
			totalCostUsd: record.totalCostUsd,
			outputTokensPerTask: record.outputTokensPerTask,
			totalOutputTokens: record.totalOutputTokens,
			timePerTaskSeconds: record.timePerTaskSeconds,
		};
		if (existing) {
			const duplicate = existing.points.find(
				(candidate) => candidate.effort === effort,
			);
			if (duplicate && compareAaPoints(duplicate, point) <= 0) continue;
			models.set(family.id, {
				...existing,
				outputPricePerMTok: maxPrice(
					existing.outputPricePerMTok,
					record.outputPrice,
				),
				inputPricePerMTok: maxPrice(
					existing.inputPricePerMTok,
					record.inputPrice,
				),
				points: [
					...existing.points.filter((candidate) => candidate.effort !== effort),
					point,
				],
			});
		} else {
			models.set(family.id, {
				id: family.id,
				name: family.displayName,
				provider: family.lab,
				creator: record.creatorName,
				group: "frontier",
				line: family.line,
				releasedAt: family.releasedAt,
				url,
				points: [point],
				outputPricePerMTok: record.outputPrice,
				inputPricePerMTok: record.inputPrice,
			});
		}
	}
	return {
		...snapshot,
		sources: {
			...snapshot.sources,
			benchmarks: {
				kind: "artificial_analysis",
				fetchedAt: release.fetchedAt,
				sourceUrl: release.sourceUrl,
				sourceSha256: release.sourceSha256,
				indexVersion: release.indexVersion,
			},
		},
		benchmarks: selectBenchmarkModels(snapshot, [...models.values()]),
	};
}

function maxPrice(
	current: number | null | undefined,
	next: number | null,
): number | null {
	if (current == null) return next;
	if (next === null) return current;
	return Math.max(current, next);
}

export function selectBenchmarkModels(
	snapshot: Pick<TrendsSnapshot, "models">,
	models: readonly TrendsBenchmarkModel[],
): TrendsBenchmarkModel[] {
	const inUse = snapshot.models.flatMap((usage) => {
		const benchmark = models.find((model) => model.id === usage.familyId);
		return benchmark ? [{ ...benchmark, group: "in_use" as const }] : [];
	});
	const usageIds = new Set(snapshot.models.map((model) => model.familyId));
	const eligible = models.filter((model) =>
		model.points.some((point) => point.costPerTaskUsd !== null),
	);
	const top20 = new Set(
		topIntelligenceFamilies(eligible).map((model) => model.id),
	);
	const frontier = eligible
		.filter(
			(model) => FRONTIER_FAMILY_IDS.includes(model.id) || top20.has(model.id),
		)
		.sort(byIntelligence);
	const coding = CODING_MODEL_LINES.flatMap(({ line }) => {
		const newest = eligible
			.filter((model) => model.line === line && model.releasedAt !== null)
			.sort(newestFirst)[0];
		return newest ? [newest] : [];
	});
	const lines = new Map<string, TrendsBenchmarkModel>();
	for (const model of inUse) {
		if (!model.line || !model.releasedAt) continue;
		const current = lines.get(model.line);
		if (!current || newestFirst(model, current) < 0)
			lines.set(model.line, model);
	}
	const earlier = [...lines.values()]
		.flatMap((current) =>
			eligible
				.filter(
					(model) =>
						!usageIds.has(model.id) &&
						model.line === current.line &&
						model.provider === current.provider &&
						model.releasedAt !== null &&
						model.releasedAt < (current.releasedAt ?? ""),
				)
				.sort(newestFirst)
				.slice(0, 2),
		)
		.sort(newestFirst);
	const claimed = new Set(usageIds);
	const claim = (
		candidates: readonly TrendsBenchmarkModel[],
		group: TrendsModelGroup,
		limit = Infinity,
	) =>
		candidates
			.filter((model) => {
				if (claimed.has(model.id) || limit <= 0) return false;
				claimed.add(model.id);
				limit -= 1;
				return true;
			})
			.map((model) => ({ ...model, group }));
	return [
		...inUse,
		...claim(frontier, "frontier"),
		...claim(coding, "coding_tools", 15),
		...claim(earlier, "earlier_versions"),
	].map((model) => ({
		...model,
		points: [...model.points].sort(
			(first, second) => first.effortOrder - second.effortOrder,
		),
	}));
}

export function topIntelligenceFamilies(
	models: readonly TrendsBenchmarkModel[],
) {
	return models
		.filter((model) => Number.isFinite(bestCostObservedIntelligence(model)))
		.sort(byIntelligence)
		.slice(0, 20);
}

export function bestCostObservedIntelligence(model: TrendsBenchmarkModel) {
	return Math.max(
		...model.points
			.filter(
				(point) =>
					point.costPerTaskUsd !== null && point.intelligenceIndex !== null,
			)
			.map((point) => point.intelligenceIndex ?? -Infinity),
	);
}

function byIntelligence(
	first: TrendsBenchmarkModel,
	second: TrendsBenchmarkModel,
) {
	return (
		bestCostObservedIntelligence(second) -
			bestCostObservedIntelligence(first) || first.id.localeCompare(second.id)
	);
}

function newestFirst(
	first: TrendsBenchmarkModel,
	second: TrendsBenchmarkModel,
) {
	return (
		(second.releasedAt ?? "").localeCompare(first.releasedAt ?? "") ||
		first.id.localeCompare(second.id)
	);
}

function compareAaPoints(
	first: TrendsBenchmarkPoint,
	second: TrendsBenchmarkPoint,
) {
	return (
		Number(second.costPerTaskUsd !== null) -
			Number(first.costPerTaskUsd !== null) ||
		(second.intelligenceIndex ?? -Infinity) -
			(first.intelligenceIndex ?? -Infinity) ||
		(first.sourceId ?? "").localeCompare(second.sourceId ?? "")
	);
}
