export type PlanProvider = "claude" | "codex";

export interface PlanReading {
	readonly provider: PlanProvider;
	readonly window: string;
	readonly label: string;
	readonly windowMinutes: number | null;
	readonly usedPercent: number;
	readonly resetsAt: string | null;
	readonly plan: string | null;
	readonly modelScope: string | null;
}

export interface PlanSample extends PlanReading {
	readonly at: string;
}

const SESSION_MINUTES = 300;
const WEEK_MINUTES = 10_080;

const CLAUDE_WINDOWS: Readonly<
	Record<string, { label: string; minutes: number; modelScope: string | null }>
> = {
	five_hour: { label: "5-hour", minutes: SESSION_MINUTES, modelScope: null },
	seven_day: { label: "Weekly", minutes: WEEK_MINUTES, modelScope: null },
	seven_day_opus: {
		label: "Weekly · Opus",
		minutes: WEEK_MINUTES,
		modelScope: "opus",
	},
	seven_day_sonnet: {
		label: "Weekly · Sonnet",
		minutes: WEEK_MINUTES,
		modelScope: "sonnet",
	},
};

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function percent(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(100, Math.max(0, value))
		: null;
}

function isoTime(value: unknown): string | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0)
		return new Date(value * 1000).toISOString();
	if (typeof value !== "string" || !value) return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function slug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "_")
		.replace(/^_+|_+$/gu, "");
}

export function claudeReadings(response: unknown): PlanReading[] | null {
	const body = record(response);
	const limits = record(body?.rate_limits);
	if (!body || body.rate_limits_available !== true || !limits) return null;
	const plan = text(body.subscription_type);
	const readings: PlanReading[] = [];
	for (const [window, shape] of Object.entries(CLAUDE_WINDOWS)) {
		const entry = record(limits[window]);
		const usedPercent = percent(entry?.utilization);
		if (!entry || usedPercent === null) continue;
		readings.push({
			provider: "claude",
			window,
			label: shape.label,
			windowMinutes: shape.minutes,
			usedPercent,
			resetsAt: isoTime(entry.resets_at),
			plan,
			modelScope: shape.modelScope,
		});
	}
	const scoped = Array.isArray(limits.limits) ? limits.limits : [];
	for (const raw of scoped) {
		const entry = record(raw);
		const model = text(record(record(entry?.scope)?.model)?.display_name);
		const usedPercent = percent(entry?.percent);
		if (!entry || entry.kind !== "weekly_scoped" || !model) continue;
		if (usedPercent === null) continue;
		const window = `seven_day_${slug(model)}`;
		if (readings.some((reading) => reading.window === window)) continue;
		readings.push({
			provider: "claude",
			window,
			label: `Weekly · ${model}`,
			windowMinutes: WEEK_MINUTES,
			usedPercent,
			resetsAt: isoTime(entry.resets_at),
			plan,
			modelScope: model.toLowerCase(),
		});
	}
	return readings;
}

export function windowLabel(minutes: number | null, fallback: string): string {
	if (minutes === null) return fallback;
	if (minutes === SESSION_MINUTES) return "5-hour";
	if (minutes === WEEK_MINUTES) return "Weekly";
	if (minutes >= 28 * 1440 && minutes <= 31 * 1440) return "Monthly";
	if (minutes % 1440 === 0) return `${minutes / 1440}-day`;
	if (minutes % 60 === 0) return `${minutes / 60}-hour`;
	return `${minutes}-minute`;
}

export function codexReadings(response: unknown): PlanReading[] | null {
	const limits = record(record(response)?.rateLimits);
	if (!limits) return null;
	const plan = text(limits.planType);
	const readings: PlanReading[] = [];
	for (const [window, fallback] of [
		["primary", "Primary"],
		["secondary", "Secondary"],
	] as const) {
		const entry = record(limits[window]);
		const usedPercent = percent(entry?.usedPercent);
		if (!entry || usedPercent === null) continue;
		const minutes =
			typeof entry.windowDurationMins === "number" &&
			entry.windowDurationMins > 0
				? entry.windowDurationMins
				: null;
		readings.push({
			provider: "codex",
			window,
			label: windowLabel(minutes, fallback),
			windowMinutes: minutes,
			usedPercent,
			resetsAt: isoTime(entry.resetsAt),
			plan,
			modelScope: null,
		});
	}
	return readings;
}
