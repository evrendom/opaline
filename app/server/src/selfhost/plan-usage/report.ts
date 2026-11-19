import type { LimitHit } from "./cost-rows.js";
import type { PlanProvider, PlanSample } from "./readings.js";
import {
	buildWindowSeries,
	type CostRow,
	earliestCostTime,
	type WindowSeries,
} from "./window-series.js";

const PROVIDERS: readonly PlanProvider[] = ["claude", "codex"];
const WEEK_MINUTES = 10_080;

export interface ProviderUsage {
	readonly provider: PlanProvider;
	readonly plan: string | null;
	readonly error: string | null;
	readonly window: WindowSeries | null;
}

export interface PlanUsageReport {
	readonly from: string;
	readonly to: string;
	readonly checkedAt: string | null;
	readonly providers: readonly ProviderUsage[];
	readonly titles: Readonly<Record<string, string>>;
	/** Sessions, or session:agent subagents, a usage limit refused in the range. */
	readonly limitHits: readonly string[];
}

export function mainWindow(
	provider: PlanProvider,
	samples: readonly PlanSample[],
): string | null {
	const latest = new Map<string, PlanSample>();
	for (const sample of samples) latest.set(sample.window, sample);
	const windows = [...latest.values()];
	if (provider === "claude")
		return windows.some((sample) => sample.window === "seven_day")
			? "seven_day"
			: null;
	const weekly = windows.find(
		(sample) => sample.windowMinutes === WEEK_MINUTES,
	);
	if (weekly) return weekly.window;
	return (
		windows
			.filter((sample) => sample.modelScope === null)
			.sort((a, b) => (b.windowMinutes ?? 0) - (a.windowMinutes ?? 0))[0]
			?.window ?? null
	);
}

export async function buildPlanUsageReport(input: {
	readonly samples: readonly PlanSample[];
	readonly errors: Readonly<Partial<Record<PlanProvider, string>>>;
	readonly checkedAt: string | null;
	readonly from: number;
	readonly to: number;
	readonly now: number;
	readonly loadRows: (
		provider: PlanProvider,
		from: number,
		to: number,
	) => Promise<CostRow[]>;
	readonly loadTitles: (
		sessionIds: readonly string[],
	) => Promise<Record<string, string>>;
	readonly bucketMinutes?: number;
	readonly loadRepositories?: (
		sessionIds: readonly string[],
	) => Promise<ReadonlyMap<string, string>>;
	readonly repositories?: ReadonlySet<string>;
	readonly loadLimitHits?: (from: number, to: number) => Promise<LimitHit[]>;
}): Promise<PlanUsageReport> {
	const hits = await limitHitsIn(input);
	const providers = await Promise.all(
		PROVIDERS.map(async (provider): Promise<ProviderUsage> => {
			const mine = input.samples.filter(
				(sample) => sample.provider === provider,
			);
			const error = input.errors[provider] ?? null;
			const plan = mine.at(-1)?.plan ?? null;
			const chosen = mainWindow(provider, mine);
			const samples = mine.filter((sample) => sample.window === chosen);
			if (!chosen || samples.length === 0)
				return { provider, plan, error, window: null };
			const latest = samples.at(-1);
			const cycleStart =
				latest?.resetsAt && latest.windowMinutes
					? Date.parse(latest.resetsAt) - latest.windowMinutes * 60_000
					: input.to;
			const rows = await input.loadRows(
				provider,
				Math.min(earliestCostTime(samples, input.from), cycleStart),
				Math.max(input.to, latest ? Date.parse(latest.at) : input.to),
			);
			const repositoryOf = input.loadRepositories
				? await input
						.loadRepositories([...new Set(rows.map((row) => row.sessionId))])
						.catch(() => new Map<string, string>())
				: undefined;
			const series = buildWindowSeries({
				samples,
				rows,
				from: input.from,
				to: input.to,
				now: input.now,
				repositoryOf,
				repositories: input.repositories,
				bucketMinutes: input.bucketMinutes,
			});
			return {
				provider,
				plan,
				error,
				window: series && {
					...series,
					limitHitsAt: hits
						.filter((hit) => hit.provider === provider)
						.map((hit) => hit.at),
				},
			};
		}),
	);
	const sessionIds = new Set<string>();
	for (const { window } of providers) {
		for (const session of window?.sessions ?? [])
			sessionIds.add(session.sessionId);
		for (const bucket of window?.buckets ?? [])
			for (const session of bucket.sessions) sessionIds.add(session.sessionId);
	}
	return {
		from: new Date(input.from).toISOString(),
		to: new Date(input.to).toISOString(),
		checkedAt: input.checkedAt,
		providers,
		titles: await input.loadTitles([...sessionIds]).catch(() => ({})),
		limitHits: hits.map((hit) => hit.id),
	};
}

async function limitHitsIn(input: {
	readonly from: number;
	readonly to: number;
	readonly loadLimitHits?: (from: number, to: number) => Promise<LimitHit[]>;
	readonly loadRepositories?: (
		sessionIds: readonly string[],
	) => Promise<ReadonlyMap<string, string>>;
	readonly repositories?: ReadonlySet<string>;
}): Promise<LimitHit[]> {
	if (!input.loadLimitHits) return [];
	const hits = await input
		.loadLimitHits(input.from, input.to)
		.catch(() => [] as LimitHit[]);
	const repositories = input.repositories;
	if (!repositories || !input.loadRepositories || hits.length === 0)
		return hits;
	const sessionOf = (hit: LimitHit) => hit.id.split(":")[0] ?? hit.id;
	const repositoryOf = await input
		.loadRepositories([...new Set(hits.map(sessionOf))])
		.catch(() => new Map<string, string>());
	return hits.filter((hit) =>
		repositories.has(repositoryOf.get(sessionOf(hit)) ?? ""),
	);
}
