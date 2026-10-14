import type { AgentRunsFilter } from "@rudel/api-routes";
import {
	isRangeFilterActive,
	type RangeBound,
} from "@/components/overview-list";
import type { SessionOverviewRangeFilter } from "@/features/sessions/components/sessions-overview-table-utils";

/** Confidence (a run question answer's probability of yes) in whole percent. */
export const CONFIDENCE_BOUND: RangeBound = {
	minimum: 0,
	maximum: 100,
	step: 1,
};

/** A confidence range per question id, in percent; null ends are open. */
export type ConfidenceFilters = Record<string, SessionOverviewRangeFilter>;

/** The filters the API takes: each active range, as probabilities of yes. */
export function toAgentRunsFilters(
	filters: ConfidenceFilters,
): AgentRunsFilter[] {
	return Object.entries(filters)
		.filter(([, range]) => isRangeFilterActive(range))
		.map(([questionId, range]) => ({
			questionId,
			min: (range.minimum ?? CONFIDENCE_BOUND.minimum) / 100,
			max: (range.maximum ?? CONFIDENCE_BOUND.maximum) / 100,
		}))
		.sort((a, b) => a.questionId.localeCompare(b.questionId));
}
