export type DashboardDeltaTone = "positive" | "negative" | "neutral";

export interface DashboardHeadlineMetric {
	id: "sessions" | "uncommitted" | "commitRate";
	label: string;
	valueLabel: string;
	deltaLabel: string;
	deltaTone: DashboardDeltaTone;
	description: string;
}
