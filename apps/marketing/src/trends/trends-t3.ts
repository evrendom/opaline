import {
	T3_HARNESS_PROVIDERS,
	type T3UsageRelease,
} from "../../../../packages/api-routes/src/trends-t3-usage";
import type {
	TrendsBenchmarkModel,
	TrendsHarness,
	TrendsHarnessDay,
	TrendsModelDay,
	TrendsSnapshot,
} from "./trends-snapshot";
import { addDays } from "./trends-usage";

type HarnessTotals = Record<TrendsHarness, number>;

/**
 * Replaces the Claude Code vs Codex balance and the share by model with
 * Slopalytics' T3 Code usage. Everything else keeps its own source.
 */
export function applyT3Usage(
	snapshot: TrendsSnapshot,
	release: T3UsageRelease,
): TrendsSnapshot {
	return {
		...snapshot,
		harnessDays: addOpalineDays(deriveT3HarnessDays(release), snapshot),
		modelDays: deriveT3ModelDays(release, snapshot.benchmarks ?? []),
		sources: {
			...snapshot.sources,
			harnesses: {
				kind: "t3_code",
				fetchedAt: release.upstream.fetchedAt,
				sourceUrl: release.sourceUrl,
			},
		},
	};
}

/**
 * Slopalytics' own definitions, summed per day and harness: prompts are sent
 * turns, tokens are input plus output, spend is their estimated cost. As on
 * Slopalytics, tokens and spend are blank on a day either harness has no
 * token or priced report, so a missing report never reads as zero.
 */
export function deriveT3HarnessDays(
	release: T3UsageRelease,
): TrendsHarnessDay[] {
	const days: TrendsHarnessDay[] = [];
	for (
		let day = release.upstream.start;
		day < release.upstream.endExclusive;
		day = addDays(day, 1)
	) {
		const prompts = totals();
		const tokens = totals();
		const spend = totals();
		const reports = { prompts: totals(), tokens: totals(), priced: totals() };
		for (const row of release.sent) {
			if (row.day !== day) continue;
			const harness = harnessOf(row.harness);
			prompts[harness] += row.turns;
			reports.prompts[harness] += 1;
		}
		for (const row of release.metrics) {
			if (row.day !== day) continue;
			const harness = harnessOf(row.harness);
			tokens[harness] += row.input + row.output;
			spend[harness] += row.estimatedCost;
			reports.tokens[harness] += row.tokenTurns;
			reports.priced[harness] += row.pricedTurns;
		}
		days.push({
			day,
			runs: bothReported(reports.prompts) ? prompts : null,
			outputTokens: bothReported(reports.tokens) ? tokens : null,
			costUsd: bothReported(reports.priced) ? spend : null,
		});
	}
	return days;
}

/**
 * Opaline's own Claude Code and Codex days added to T3 Code's, by the
 * transcripts they came from (Claude Code's JSONL to Claude Code, Codex's to
 * Codex): runs to prompts (a run is a turn), input plus output tokens to
 * tokens (T3 Code's are input plus output too, cache included), estimated
 * cost to spend. A measure T3 Code left blank that day takes Opaline's
 * figure alone; tokens need a capture with Opaline's input tokens.
 */
export function addOpalineDays(
	days: readonly TrendsHarnessDay[],
	snapshot: TrendsSnapshot,
): TrendsHarnessDay[] {
	const opaline = new Map(
		(snapshot.opalineHarnessDays ?? []).map((day) => [day.day, day]),
	);
	const add = (
		t3: Readonly<Record<TrendsHarness, number>> | null,
		...own: (Readonly<Record<TrendsHarness, number>> | null | undefined)[]
	) => {
		if (!own.every(Boolean)) return t3;
		const sum = (harness: TrendsHarness) =>
			(t3?.[harness] ?? 0) +
			own.reduce((total, entry) => total + (entry?.[harness] ?? 0), 0);
		return { "claude-code": sum("claude-code"), codex: sum("codex") };
	};
	return days.map((day) => {
		const own = opaline.get(day.day);
		if (!own) return day;
		return {
			day: day.day,
			runs: add(day.runs, own.runs),
			outputTokens: add(day.outputTokens, own.inputTokens, own.outputTokens),
			costUsd: add(day.costUsd, own.costUsd),
		};
	});
}

/**
 * Turns per model per day, both harnesses together (T3 Code runs some
 * models through either). A turn counts for a model when T3 reported its
 * model with its tokens; "Unreported model", "Other models" and "Mixed
 * models" name no model, and a model the benchmarks do not list cannot be
 * picked, so neither is kept. The days start at the first with a kept
 * turn (T3's export can begin before its per-model reports do); a later
 * day without one stays empty.
 */
export function deriveT3ModelDays(
	release: T3UsageRelease,
	benchmarks: readonly TrendsBenchmarkModel[],
): TrendsModelDay[] {
	const days: TrendsModelDay[] = [];
	for (
		let day = release.upstream.start;
		day < release.upstream.endExclusive;
		day = addDays(day, 1)
	) {
		const turnsByModel: Record<string, number> = {};
		for (const row of release.metrics) {
			if (row.day !== day || row.tokenTurns === 0) continue;
			const id = t3ModelId(row.model, benchmarks);
			if (id) turnsByModel[id] = (turnsByModel[id] ?? 0) + row.tokenTurns;
		}
		if (days.length > 0 || Object.keys(turnsByModel).length > 0)
			days.push({ day, turnsByModel });
	}
	return days;
}

/** T3 names Claude models without "Claude" ("Opus 5.5") and GPT models in
 * full ("GPT-6 Astra"); the benchmarks name both in full. */
export function t3ModelId(
	name: string,
	benchmarks: readonly TrendsBenchmarkModel[],
) {
	return benchmarks.find(
		(model) => model.name === name || model.name === `Claude ${name}`,
	)?.id;
}

function harnessOf(provider: string): TrendsHarness {
	const harness =
		T3_HARNESS_PROVIDERS[provider as keyof typeof T3_HARNESS_PROVIDERS];
	if (!harness) throw new Error(`Unexpected T3 harness ${provider}`);
	return harness;
}

function totals(): HarnessTotals {
	return { "claude-code": 0, codex: 0 };
}

function bothReported(reports: HarnessTotals) {
	return reports["claude-code"] > 0 && reports.codex > 0;
}
