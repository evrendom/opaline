import { useQuery } from "@tanstack/react-query";

export type PlanProvider = "claude" | "codex";

export type BucketKind = "reading" | "between" | "estimate";

export interface UsageBucket {
	readonly at: string;
	readonly usedPercent: number | null;
	readonly kind: BucketKind | null;
	readonly usedRange: readonly [number, number] | null;
	readonly readAt: string | null;
	readonly plan: string | null;
	readonly usedPoints: number;
	readonly reset: boolean;
	readonly sessions: readonly { sessionId: string; points: number }[];
	readonly repositoryPoints?: number | null;
}

export interface GroupShare {
	readonly id: string;
	readonly points: number;
	readonly cost: number;
	readonly estimated: boolean;
}

export interface UsageWindow {
	readonly window: string;
	readonly label: string;
	readonly windowMinutes: number | null;
	readonly usedPercent: number;
	readonly resetsAt: string | null;
	readonly checkedAt: string;
	readonly recordedFrom: string;
	readonly bucketMinutes: number;
	readonly resets: readonly string[];
	readonly buckets: readonly UsageBucket[];
	readonly sessions: readonly {
		sessionId: string;
		points: number;
		cost: number;
		estimated: boolean;
	}[];
	readonly sessionPoints?: Readonly<Record<string, number>>;
	readonly limitHitsAt?: readonly string[];
	readonly models: readonly GroupShare[];
	readonly repositories: readonly GroupShare[];
	readonly otherPoints: number;
	readonly totalPoints: number;
	readonly repositoryPoints?: number | null;
}

export interface ProviderUsage {
	readonly provider: PlanProvider;
	readonly plan: string | null;
	readonly error: string | null;
	readonly window: UsageWindow | null;
}

export interface PlanUsageReport {
	readonly from: string;
	readonly to: string;
	readonly checkedAt: string | null;
	readonly providers: readonly ProviderUsage[];
	readonly titles: Readonly<Record<string, string>>;
	readonly limitHits?: readonly string[];
}

export interface UsageRange {
	readonly startDate: string;
	readonly endDate: string;
}

const DAY_MS = 86_400_000;
const POLL_MS = 60_000;

async function readPlanUsage(
	range: UsageRange,
	repositories: readonly string[],
): Promise<PlanUsageReport | null> {
	const from = Date.parse(`${range.startDate}T00:00:00Z`);
	const to = Date.parse(`${range.endDate}T00:00:00Z`) + DAY_MS;
	const params = new URLSearchParams({
		from: new Date(from).toISOString(),
		to: new Date(to).toISOString(),
		buckets: "day",
	});
	for (const repository of repositories)
		params.append("repository", repository);
	const response = await fetch(`/api/selfhost/plan-usage?${params}`, {
		credentials: "include",
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Plan usage failed (${response.status})`);
	return (await response.json()) as PlanUsageReport;
}

export function usePlanUsage(
	enabled: boolean,
	range: UsageRange,
	repositories: readonly string[] = [],
) {
	return useQuery({
		queryKey: [
			"selfhost",
			"plan-usage",
			range.startDate,
			range.endDate,
			...repositories,
		],
		queryFn: () => readPlanUsage(range, repositories),
		enabled,
		refetchInterval: POLL_MS,
		placeholderData: (previous) => previous,
	});
}

export function leftPercent(usedPercent: number): number {
	return Math.max(0, Math.min(100, 100 - usedPercent));
}

export function planLabel(plan: string | null): string | null {
	if (!plan) return null;
	return plan
		.split(/[_\s-]+/u)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

export function sessionUsageShares(
	report: PlanUsageReport | null | undefined,
): ReadonlyMap<string, number> | null {
	if (!report) return null;
	const shares = new Map<string, number>();
	for (const usage of report.providers)
		for (const [sessionId, points] of Object.entries(
			usage.window?.sessionPoints ?? {},
		))
			shares.set(sessionId, (shares.get(sessionId) ?? 0) + points);
	return shares;
}
