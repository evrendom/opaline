import { z } from "zod";

export const AgentRunSignalSchema = z.enum([
	"positive",
	"negative",
	"mixed",
	"none",
	"noReply",
]);
export const AgentRunDurationSchema = z.enum([
	"under1m",
	"1to5m",
	"5to15m",
	"15to30m",
	"30to60m",
	"1to3h",
	"3to12h",
	"12hPlus",
	"unknown",
]);
export type AgentRunSignal = z.infer<typeof AgentRunSignalSchema>;
export type AgentRunDuration = z.infer<typeof AgentRunDurationSchema>;

export const AGENT_RUN_SIGNALS: readonly {
	id: AgentRunSignal;
	label: string;
}[] = [
	{ id: "positive", label: "Positive" },
	{ id: "negative", label: "Negative" },
	{ id: "mixed", label: "Mixed" },
	{ id: "none", label: "No signal" },
	{ id: "noReply", label: "No reply" },
];
export const AGENT_RUN_DURATIONS: readonly {
	id: AgentRunDuration;
	label: string;
	upperSeconds: number;
}[] = [
	{ id: "under1m", label: "Under 1 minute", upperSeconds: 60 },
	{ id: "1to5m", label: "1–5 minutes", upperSeconds: 300 },
	{ id: "5to15m", label: "5–15 minutes", upperSeconds: 900 },
	{ id: "15to30m", label: "15–30 minutes", upperSeconds: 1800 },
	{ id: "30to60m", label: "30–60 minutes", upperSeconds: 3600 },
	{ id: "1to3h", label: "1–3 hours", upperSeconds: 10800 },
	{ id: "3to12h", label: "3–12 hours", upperSeconds: 43200 },
	{ id: "12hPlus", label: "12 hours+", upperSeconds: Infinity },
	{ id: "unknown", label: "Unknown duration", upperSeconds: Infinity },
];

export function getAgentRunDuration(
	seconds: number | undefined,
): AgentRunDuration {
	if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0)
		return "unknown";
	return (
		AGENT_RUN_DURATIONS.find((bucket) => seconds < bucket.upperSeconds)?.id ??
		"unknown"
	);
}
