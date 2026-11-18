import type { AnalysisSearchOutput } from "@rudel/api-routes";
import { cell } from "../services/analysis/read-output.js";

export function renderSearch(output: AnalysisSearchOutput): string {
	const lastDay = new Date(Date.parse(output.until) - 1)
		.toISOString()
		.slice(0, 10);
	const asked =
		output.requestedMode === output.mode
			? ""
			: ` (asked ${output.requestedMode})`;
	const { coverage, quota, exactMatches, hiddenInjected } = output;
	return [
		`search "${cell(output.text)}" mode=${output.mode}${asked} ${output.since.slice(0, 10)}..${lastDay} results=${output.results.length}`,
		...(output.results.length === 0
			? ["(no runs matched)"]
			: [
					row([
						"run_id",
						"session_id",
						"agent_id",
						"turn",
						"started_at",
						"score",
						"why",
						"snippet",
					]),
					...output.results.map((result) =>
						row([
							result.runId,
							result.sessionId,
							result.agentId,
							result.turn,
							result.startedAt,
							result.score,
							result.why,
							result.snippet,
						]),
					),
				]),
		...(output.suggestion ? [`suggestion: ${cell(output.suggestion)}`] : []),
		...(output.mode === "meaning"
			? []
			: [
					`coverage: ${coverage.searched} of ${coverage.sessions} sessions in the window searched by ${output.mode === "regex" ? "regex" : "exact string"} over every stored record${
						coverage.partial > 0 ? `, ${coverage.partial} partly` : ""
					}; ${exactMatches.runs} runs in ${exactMatches.sessions} sessions match`,
				]),
		...(output.mode === "meaning" || output.mode === "hybrid"
			? [
					`coverage: ${coverage.indexed} of ${coverage.sessions} sessions in the window are indexed for meaning${
						coverage.pending > 0
							? `; ${coverage.pending} have chunks without a vector`
							: ""
					}`,
				]
			: []),
		...(hiddenInjected.matches > 0
			? [
					`hidden: ${hiddenInjected.matches} matches in injected context (reminders, task notifications, instructions, compaction summaries), ${hiddenInjected.runs} runs with no other match; filters.includeInjected=true searches them`,
				]
			: []),
		...(quota
			? [
					`quota: ${quota.usedTokens.toLocaleString("en-US")} of ${quota.limitTokens.toLocaleString("en-US")} OpenAI tokens used; resets ${quota.resetsAt}`,
				]
			: []),
		...output.notices.map((notice) => `note: ${cell(notice)}`),
	].join("\n");
}

function row(values: readonly unknown[]): string {
	return values.map((value) => cell(value).replaceAll("|", "\\|")).join(" | ");
}
