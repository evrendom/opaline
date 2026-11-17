import { chartPeriodDates } from "../chart-interval";
import { sampleLevels } from "../chart-sample";
import type { UsageBucket, UsageWindow } from "./use-plan-usage";

export function sampleUsageWindow(start: string, end: string): UsageWindow {
	const dates = chartPeriodDates(start, end, "daily");
	const levels = sampleLevels(dates.length);
	const buckets: UsageBucket[] = dates.map((date, index) => {
		const used = (levels[index] ?? 0) * 90;
		return {
			at: `${date}T12:00:00Z`,
			usedPercent: used,
			kind: "reading",
			usedRange: [used, used],
			readAt: null,
			plan: null,
			usedPoints: used / 4,
			reset: false,
			sessions: [],
			repositoryPoints: used / 4,
		};
	});
	return {
		window: "sample",
		label: "Weekly",
		windowMinutes: null,
		usedPercent: 0,
		resetsAt: null,
		checkedAt: `${end}T12:00:00Z`,
		recordedFrom: `${start}T00:00:00Z`,
		bucketMinutes: 1440,
		resets: [],
		buckets,
		sessions: [],
		models: [],
		repositories: [],
		otherPoints: 0,
		totalPoints: 1,
	};
}
