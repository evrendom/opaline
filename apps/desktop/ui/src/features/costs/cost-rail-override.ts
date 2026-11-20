import type { RepositoryRunFigures } from "@rudel/api-routes";
import { createContext, type ReactNode } from "react";
import type { Figure } from "@/lib/figure";

export const MetricOverrideContext = createContext<ReadonlyMap<
	string,
	Figure
> | null>(null);

export const RangeLeadContext = createContext<ReactNode>(null);

export const MetricLoadingContext = createContext(false);

/** What a rail filter narrows the Usage card to: `undefined` when no filter
 * is set, `null` when the filter's usage is unknown (it picks runs, not whole
 * sessions), else the picked sessions, whose plan points the card sums, and
 * the share of them the filter covers (below 1 for a part of a session). */
export type UsageSessions = {
	readonly sessionIds: readonly string[];
	readonly share: number;
};

export const UsageSessionsContext = createContext<
	UsageSessions | null | undefined
>(undefined);

export const MetricEmptyContext = createContext<ReadonlySet<string> | null>(
	null,
);

export type MetricBreakdowns = NonNullable<RepositoryRunFigures["breakdowns"]>;

export const MetricBreakdownContext = createContext<
	MetricBreakdowns | null | undefined
>(undefined);
