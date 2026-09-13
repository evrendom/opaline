import { splitDisplayTextParts } from "./display-boundaries.js";
import {
	scanMemberLanguageSignals,
	scanModelLanguageSignals,
} from "./scanner.js";
import type {
	LanguageSignalCounts,
	LanguageSignalMatch,
	LanguageSignalSummary,
	LanguageSignalSummaryInput,
	ModelLanguageSignalMatch,
} from "./types.js";

const MAX_PERSISTED_MATCHES_PER_CATEGORY = 25;

export function summarize(
	input: LanguageSignalSummaryInput,
): LanguageSignalCounts {
	const summary = summarizeWithMatches(input);

	return {
		member_swears: summary.member_swears,
		member_apologies: summary.member_apologies,
		member_positive: summary.member_positive,
		model_swears: summary.model_swears,
		model_apologies: summary.model_apologies,
		model_positive: summary.model_positive,
	};
}

export function summarizeWithMatches(
	input: LanguageSignalSummaryInput,
): LanguageSignalSummary {
	const memberMatches = scanDisplayTextSegments(
		input.memberText,
		scanMemberLanguageSignals,
	);
	const modelMatches = scanDisplayTextSegments(
		input.modelText,
		scanModelLanguageSignals,
	);
	const memberCounts = countSignals(memberMatches);
	const modelCounts = countSignals(modelMatches);

	return {
		member_swears: memberCounts.swears,
		member_apologies: memberCounts.apologies,
		member_positive: memberCounts.positive,
		model_swears: modelCounts.swears,
		model_apologies: modelCounts.apologies,
		model_positive: modelCounts.positive,
		member_swear_matches: collectDistinctMatchedText(memberMatches, "swear"),
		member_apology_matches: collectDistinctMatchedText(
			memberMatches,
			"apology",
		),
		member_positive_matches: collectDistinctMatchedText(
			memberMatches,
			"positive",
		),
		model_swear_matches: collectDistinctMatchedText(modelMatches, "swear"),
		model_apology_matches: collectDistinctMatchedText(modelMatches, "apology"),
		model_positive_matches: collectDistinctMatchedText(
			modelMatches,
			"positive",
		),
	};
}

export function scanModelLanguageSignalSegments(
	segments: readonly string[],
): ReadonlyArray<ModelLanguageSignalMatch> {
	return scanDisplayTextSegments(segments, scanModelLanguageSignals);
}

function scanDisplayTextSegments<TMatch extends LanguageSignalMatch>(
	segments: readonly string[],
	scan: (text: string) => readonly TMatch[],
): TMatch[] {
	const matches: TMatch[] = [];

	for (const segment of segments) {
		for (const part of splitDisplayTextParts(segment)) {
			if (part.type !== "text" && part.type !== "strong") continue;
			matches.push(...scan(part.content));
		}
	}

	return matches;
}

function countSignals(signals: readonly LanguageSignalMatch[]) {
	let swears = 0;
	let apologies = 0;
	let positive = 0;

	for (const signal of signals) {
		switch (signal.category) {
			case "swear":
				swears += 1;
				break;
			case "apology":
				apologies += 1;
				break;
			case "positive":
				positive += 1;
				break;
			case "negative":
				break;
		}
	}

	return { apologies, positive, swears };
}

function collectDistinctMatchedText(
	signals: readonly LanguageSignalMatch[],
	category: "apology" | "positive" | "swear",
): string[] {
	const capturedText: string[] = [];
	const normalizedText = new Set<string>();

	for (const signal of signals) {
		if (signal.category !== category) continue;
		const normalized = signal.matchedText.toLocaleLowerCase("en-US");
		if (normalizedText.has(normalized)) continue;
		normalizedText.add(normalized);
		capturedText.push(signal.matchedText);
		if (capturedText.length >= MAX_PERSISTED_MATCHES_PER_CATEGORY) break;
	}

	return capturedText;
}
