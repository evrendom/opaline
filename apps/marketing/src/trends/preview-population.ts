import { MODEL_RATE_CARD } from "../../../../packages/api-routes/src/model-rate-card";
import { MODEL_REGISTRY } from "../../../../packages/api-routes/src/model-registry";
import type { TrendsReasoningEffort } from "./trends-snapshot";
import { addDays, type DailyUsage, type RunDistribution } from "./trends-usage";

export const PREVIEW_USAGE_EFFORTS: Readonly<
	Record<string, TrendsReasoningEffort>
> = {
	"claude-opus-5-5": "high",
	"claude-sonnet-5-5": "high",
	"claude-fable-5-1": "high",
	"claude-haiku-4-5-20251001": "none",
	"gpt-6.1-sol": "high",
	"gpt-6-astra": "high",
	"gpt-5.6-sol": "high",
	"gpt-6-luna": "medium",
};

export function createPreviewPopulation(): DailyUsage[] {
	const random = seededRandom(20261001);
	const population: DailyUsage[] = [];
	for (let day = "2026-06-29"; day < "2026-10-01"; day = addDays(day, 1)) {
		for (const [familyIndex, familyId] of Object.keys(
			PREVIEW_USAGE_EFFORTS,
		).entries()) {
			const family = MODEL_REGISTRY[familyId];
			if (
				!family?.harness ||
				family.releasedAt === null ||
				day < family.releasedAt
			)
				continue;
			const rates = MODEL_RATE_CARD.filter(
				(entry) =>
					entry.model === familyId &&
					entry.contextBand === "base" &&
					entry.effectiveFrom <= day,
			).sort((first, second) =>
				second.effectiveFrom.localeCompare(first.effectiveFrom),
			)[0];
			if (!rates)
				throw new Error(`Missing preview pricing: ${familyId} on ${day}`);
			const runs =
				Math.round((2400 + random() * 4300 + familyIndex * 230) / 100) * 100;
			const sampleCount = 180;
			const distribution: RunDistribution[] = Array.from(
				{ length: sampleCount },
				(_, index) => {
					const count =
						Math.floor(runs / sampleCount) +
						(index < runs % sampleCount ? 1 : 0);
					const tail = Math.exp(random() * 3.8 - 1.5);
					const outputTokens = Math.round((900 + familyIndex * 230) * tail);
					const inputTokens = Math.round(outputTokens * (2 + random() * 5));
					const seconds =
						Math.round((12 + familyIndex * 8 + random() * 30) * tail * 10) / 10;
					const costUsd =
						(outputTokens * rates.outputPerMTok +
							inputTokens * rates.inputPerMTok) /
						1e6;
					const developer =
						(index * 13 + familyIndex * 109 + Number(day.slice(-2)) * 31) %
						2400;
					return {
						count,
						seconds,
						outputTokens,
						costUsd,
						developerId: `preview-dev-${developer}`,
						workspaceId: `preview-ws-${developer % 40}`,
					};
				},
			);
			const repliedRuns = Math.round(runs * (0.42 + random() * 0.27));
			const negative = Math.round(
				repliedRuns * (0.035 + familyIndex * 0.008 + random() * 0.03),
			);
			const mixed = Math.round(repliedRuns * (0.04 + random() * 0.07));
			const positive = Math.round(repliedRuns * (0.13 + random() * 0.12));
			const toolCalls = Math.round(runs * (2.5 + random() * 3));
			const apologies = Math.round(
				runs * (0.04 + familyIndex * 0.005 + random() * 0.06),
			);
			const dominantApologies = Math.floor(apologies * 0.57);
			const formalApologies = Math.floor(apologies * 0.27);
			population.push({
				day,
				familyId,
				harness: family.harness === "claude_code" ? "claude-code" : "codex",
				runs,
				repliedRuns,
				reactions: {
					negative,
					mixed,
					positive,
					neutral: repliedRuns - negative - mixed - positive,
				},
				apologies,
				apologyPhrases: {
					[family.lab === "anthropic" ? "You're right" : "Sorry about that"]:
						dominantApologies,
					"I apologize": formalApologies,
					"My mistake": apologies - dominantApologies - formalApologies,
				},
				prompts: runs,
				swears: Math.round(runs * (0.002 + random() * 0.006)),
				toolCalls,
				toolFailures: Math.round(
					toolCalls * (0.015 + familyIndex * 0.003 + random() * 0.02),
				),
				outputTokens: distribution.reduce(
					(total, sample) => total + sample.count * sample.outputTokens,
					0,
				),
				costUsd: distribution.reduce(
					(total, sample) => total + sample.count * sample.costUsd,
					0,
				),
				distribution,
			});
		}
	}
	return population;
}

export function seededRandom(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}
