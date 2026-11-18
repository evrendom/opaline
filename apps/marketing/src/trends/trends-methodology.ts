import { formatFullDay, formatInteger } from "./trends-format";
import type { TrendsSnapshot } from "./trends-snapshot";

export interface TrendsDefinition {
	readonly term: string;
	readonly detail: string;
}

export function trendsMethodology(
	snapshot: TrendsSnapshot,
): readonly TrendsDefinition[] {
	const { minRuns, minDevelopers, minWorkspaces } = snapshot.thresholds;
	return [
		...(snapshot.sources.usage.kind === "preview"
			? [
					{
						term: "Preview data",
						detail:
							"In-the-wild values come from one seeded synthetic daily population, not observed Opaline sessions. Benchmark provenance is independent.",
					},
				]
			: []),
		{
			term: "Counting",
			detail:
				snapshot.sources.usage.kind === "preview"
					? "Usage totals, rates and empirical quantiles are derived from the same synthetic population."
					: "Every usage number is counted, not generated. No model reads the sessions.",
		},
		{
			term: "Model set",
			detail: `In use includes families with at least ${formatInteger(minRuns)} runs, ${formatInteger(minDevelopers)} developers and ${formatInteger(minWorkspaces)} workspaces, and at least 1% of all agent runs in the usage period, ordered by run share. Compare with adds up to three curated challengers from other labs, ranked by AA intelligence where cost is available; they are off by default and have benchmark data only.`,
		},
		{
			term: "Agent run",
			detail:
				"One developer prompt and the agent's work until it hands control back. Unanswered prompts and copied history are excluded.",
		},
		{
			term: "Apologies",
			detail:
				"A fixed lexicon of 79 phrasings in the model's visible replies. Code and tool output are excluded.",
		},
		{
			term: "Pushback",
			detail:
				"The developer's next message read as negative, mixed or positive by a fixed English lexicon. A proxy for frustration, not a verdict.",
		},
		{
			term: "Swearing",
			detail:
				"Profanity, minced forms and abbreviations in developer prompts. Never counted as pushback.",
		},
		{
			term: "Tool failures",
			detail:
				"Tool results flagged as errors, or non-zero exit codes read from transport framing.",
		},
		{
			term: "Run time",
			detail:
				"Prompt to the agent's final message. Interrupted or unfinished runs are excluded.",
		},
		{
			term: "Tokens and cost",
			detail:
				"Output tokens including reasoning; API list prices applied to every request. A run owns its requests, its subagents' included, until the next run starts. Runs with an unpriced request are left out of cost. Subscription plans bill differently.",
		},
		{
			term: "Benchmarks",
			detail:
				snapshot.sources.benchmarks.kind === "preview"
					? "Benchmark values are illustrative fixtures, not published measurements."
					: `Artificial Analysis public website, scraped ${formatFullDay(snapshot.sources.benchmarks.fetchedAt)}; Intelligence Index v${snapshot.sources.benchmarks.indexVersion ?? "unknown"}. Per-task and full-index totals are separate published observations. Missing observations are omitted, never zero.`,
		},
		{
			term: "Benchmark join",
			detail:
				"Usage models join the same family and declared predominant effort, or vendor default when unknown. Unmeasured efforts are left missing.",
		},
		{
			term: "Reasoning and ranges",
			detail:
				"Benchmark lines connect every tested reasoning effort in effort order, not dates, the non-reasoning point included. Known AA defaults use their mapped effort; unspecified defaults stay in tables but not lines or ranges when named efforts exist. Benchmark ranges span selected tested efforts; full-index totals are independent observations. In-the-wild ranges show empirical p50/p90/p99, not reasoning variants. Pareto highlights non-dominated selected variants, not a universal recommendation.",
		},
		{
			term: "Claude Code vs Codex",
			detail: harnessDetail(snapshot.sources.harnesses),
		},
		{
			term: "Insight mode",
			detail:
				"Insight mode splits each scatter at the visual middle of both axes (the geometric midpoint on a log scale) and names each quadrant. The axes fit the plotted data with an even number of equal cells, so the split is always a gridline. Numbers are hidden in that mode; the table and comparison panel keep them.",
		},
		{
			term: "Attribution",
			detail:
				"Each run counts toward the model of its last request; tool calls go to the run in progress. Apologies, swears and prompts are counted per session and go to the session's most-used model. A chart leaves out a model without data for it rather than show zero.",
		},
		{
			term: "Privacy",
			detail: `Model-level aggregates across every Opaline workspace; no user, workspace, session or repository is published. A model appears once it has ${formatInteger(minRuns)} runs from ${formatInteger(minDevelopers)} developers across ${formatInteger(minWorkspaces)} workspaces, and run counts are rounded to the nearest ten.`,
		},
	];
}

function harnessDetail(source: TrendsSnapshot["sources"]["harnesses"]) {
	const balance =
		"Daily share difference of the chosen measure, Claude Code minus Codex. Even is 50/50; +20 pp means 60/40.";
	if (source.kind !== "t3_code")
		return `${balance} Counts ${source.kind === "preview" ? "synthetic" : "Opaline"} sessions from both harnesses. Spend uses API list prices.`;
	return `${balance} Usage data from T3 Code as published by Slopalytics, shown unchanged; refreshed ${formatFullDay(source.fetchedAt)}. Prompts are sent turns, including automated sends; tokens are input plus output; spend is Slopalytics' estimate at API prices and leaves out unpriced models. Days without a report from both harnesses are blank. These are T3 Code users, not Opaline sessions or market-wide shares.`;
}
