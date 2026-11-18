export type DashboardDeltaTone = "positive" | "negative" | "neutral";

export interface DashboardHeadlineMetric {
	id: "sessions" | "avgDuration";
	label: string;
	valueLabel: string;
	deltaLabel: string;
	deltaTone: DashboardDeltaTone;
	description: string;
}
