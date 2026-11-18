import { MODEL_REGISTRY } from "../../../../packages/api-routes/src/model-registry";
import type {
	TrendsHarness,
	TrendsHarnessDay,
	TrendsModel,
	TrendsModelMetrics,
	TrendsSnapshot,
	TrendsWeek,
} from "./trends-snapshot";

export interface RunDistribution {
	readonly count: number;
	readonly developerId: string;
	readonly workspaceId: string;
	readonly seconds: number;
	readonly outputTokens: number;
	readonly costUsd: number;
}

export interface DailyUsage {
	readonly day: string;
	readonly harness: TrendsHarness;
	readonly familyId: string;
	readonly runs: number;
	readonly repliedRuns: number;
	readonly reactions: {
		readonly negative: number;
		readonly mixed: number;
		readonly neutral: number;
		readonly positive: number;
	};
	readonly apologies: number;
	readonly apologyPhrases: Readonly<Record<string, number>>;
	readonly prompts: number;
	readonly swears: number;
	readonly toolCalls: number;
	readonly toolFailures: number;
	readonly outputTokens: number;
	readonly costUsd: number;
	readonly distribution: readonly RunDistribution[];
}

export function deriveUsageSnapshot(
	population: readonly DailyUsage[],
	periodStart: string,
	periodEndExclusive: string,
	efforts: Readonly<Record<string, TrendsModel["benchmarkEffort"]>>,
	thresholds: TrendsSnapshot["thresholds"] = {
		minRuns: 1000,
		minDevelopers: 100,
		minWorkspaces: 10,
	},
) {
	const current = population.filter(
		(row) => row.day >= periodStart && row.day < periodEndExclusive,
	);
	const priorStart = new Date(periodStart);
	priorStart.setUTCMonth(priorStart.getUTCMonth() - 1);
	const previous = population.filter(
		(row) => row.day >= isoDay(priorStart) && row.day < periodStart,
	);
	const totalRuns = sum(current, "runs");
	const ids = [...new Set(current.map((row) => row.familyId))].filter(
		(familyId) => {
			const rows = current.filter((row) => row.familyId === familyId);
			const runs = sum(rows, "runs");
			return (
				runs >= thresholds.minRuns &&
				distinctIds(rows, "developerId").size >= thresholds.minDevelopers &&
				distinctIds(rows, "workspaceId").size >= thresholds.minWorkspaces &&
				totalRuns > 0 &&
				runs / totalRuns >= 0.01
			);
		},
	);
	const models = ids.map((familyId): TrendsModel => {
		const family = MODEL_REGISTRY[familyId];
		if (!family) throw new Error(`Usage references unknown family ${familyId}`);
		const rows = current.filter((row) => row.familyId === familyId);
		const before = previous.filter((row) => row.familyId === familyId);
		const history = population.filter(
			(row) => row.familyId === familyId && row.runs > 0,
		);
		const firstUsedAt = history.map((row) => row.day).sort()[0] ?? periodStart;
		const developers = distinctIds(rows, "developerId");
		return {
			id: familyId,
			familyId,
			name: family.displayName,
			provider: family.lab,
			runs: sum(rows, "runs"),
			developers: roundDevelopers(developers.size),
			workspaces: distinctIds(rows, "workspaceId").size,
			topApology: topApology(rows),
			replyRate: sum(rows, "repliedRuns") / sum(rows, "runs"),
			benchmarkEffort: efforts[familyId] ?? family.defaultEffort,
			effortPolicy: efforts[familyId] ? "predominant" : "vendor_default",
			firstUsedAt,
			isNew: firstUsedAt >= periodStart,
			totalOutputTokens: sum(rows, "outputTokens"),
			totalCostUsd: sum(rows, "costUsd"),
			...deriveMetrics(rows),
			...(before.length > 0 ? { previous: deriveMetrics(before) } : {}),
		};
	});
	const end = new Date(periodEndExclusive);
	end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7));
	const start = new Date(end);
	start.setUTCDate(start.getUTCDate() - 13 * 7);
	const weeks: TrendsWeek[] = Array.from({ length: 13 }, (_, index) => {
		const weekStart = addDays(isoDay(start), index * 7);
		const weekEnd = addDays(weekStart, 7);
		const rows = population.filter(
			(row) => row.day >= weekStart && row.day < weekEnd,
		);
		return {
			weekStart,
			runsByModel: Object.fromEntries(
				ids.map((familyId) => [
					familyId,
					sum(
						rows.filter((row) => row.familyId === familyId),
						"runs",
					),
				]),
			),
		};
	});
	const harnessDays: TrendsHarnessDay[] = [
		...new Set(current.map((row) => row.day)),
	]
		.sort()
		.map((day) => {
			const rows = current.filter((row) => row.day === day);
			const claude = rows.filter((row) => row.harness === "claude-code");
			const codex = rows.filter((row) => row.harness === "codex");
			return {
				day,
				runs: { "claude-code": sum(claude, "runs"), codex: sum(codex, "runs") },
				outputTokens: {
					"claude-code": sum(claude, "outputTokens"),
					codex: sum(codex, "outputTokens"),
				},
				costUsd: {
					"claude-code": sum(claude, "costUsd"),
					codex: sum(codex, "costUsd"),
				},
			};
		});
	return {
		periodStart,
		periodEndExclusive,
		publishedAt: `${periodEndExclusive}T00:00:00.000Z`,
		totals: {
			runs: sum(current, "runs"),
			developers: roundDevelopers(distinctIds(current, "developerId").size),
		},
		thresholds,
		models: models.sort(
			(first, second) =>
				second.runs - first.runs || first.id.localeCompare(second.id),
		),
		weeks,
		harnessDays,
		shareWindow: {
			start: isoDay(start),
			endExclusive: isoDay(end),
			completeWeeks: 13,
		},
	} satisfies Omit<TrendsSnapshot, "sources" | "benchmarks">;
}

export function deriveMetrics(rows: readonly DailyUsage[]): TrendsModelMetrics {
	const replied = sum(rows, "repliedRuns");
	const distributions = rows.flatMap((row) => row.distribution);
	const reaction = (key: keyof DailyUsage["reactions"]) =>
		rows.reduce((total, row) => total + row.reactions[key], 0) / replied;
	return {
		apologiesPer100Runs: (100 * sum(rows, "apologies")) / sum(rows, "runs"),
		reactions: {
			negative: reaction("negative"),
			mixed: reaction("mixed"),
			neutral: reaction("neutral"),
			positive: reaction("positive"),
		},
		swearsPer1kPrompts: (1000 * sum(rows, "swears")) / sum(rows, "prompts"),
		toolFailureRate: sum(rows, "toolFailures") / sum(rows, "toolCalls"),
		runSeconds: quantiles(distributions, "seconds"),
		outputTokensPerRun: quantiles(distributions, "outputTokens"),
		costPerRunUsd: quantiles(distributions, "costUsd"),
	};
}

export function quantiles(
	distribution: readonly RunDistribution[],
	key: "seconds" | "outputTokens" | "costUsd",
) {
	const ordered = [...distribution].sort(
		(first, second) => first[key] - second[key],
	);
	const count = ordered.reduce((total, sample) => total + sample.count, 0);
	if (count === 0)
		throw new Error("Cannot derive quantiles of an empty population");
	const quantile = (fraction: number) => {
		const target = Math.ceil(count * fraction);
		let cumulative = 0;
		for (const sample of ordered) {
			cumulative += sample.count;
			if (cumulative >= target) return sample[key];
		}
		throw new Error("Invalid run distribution");
	};
	return { p50: quantile(0.5), p90: quantile(0.9), p99: quantile(0.99) };
}

export function addDays(day: string, count: number) {
	const date = new Date(day);
	date.setUTCDate(date.getUTCDate() + count);
	return isoDay(date);
}

function sum(
	rows: readonly DailyUsage[],
	key:
		| "runs"
		| "repliedRuns"
		| "apologies"
		| "prompts"
		| "swears"
		| "toolCalls"
		| "toolFailures"
		| "outputTokens"
		| "costUsd",
) {
	return rows.reduce((total, row) => total + row[key], 0);
}

function distinctIds(
	rows: readonly DailyUsage[],
	key: "developerId" | "workspaceId",
) {
	return new Set(
		rows.flatMap((row) =>
			row.distribution
				.filter((sample) => sample.count > 0)
				.map((sample) => sample[key]),
		),
	);
}

function roundDevelopers(count: number) {
	return Math.round(count / 10) * 10;
}

function topApology(rows: readonly DailyUsage[]) {
	const phrases = new Map<string, number>();
	for (const row of rows)
		for (const [phrase, count] of Object.entries(row.apologyPhrases))
			phrases.set(phrase, (phrases.get(phrase) ?? 0) + count);
	return (
		[...phrases].sort(
			(first, second) =>
				second[1] - first[1] || first[0].localeCompare(second[0]),
		)[0]?.[0] ?? "—"
	);
}
function isoDay(date: Date) {
	return date.toISOString().slice(0, 10);
}
