import type { RepositoryRunFigures } from "@rudel/api-routes";
import { createContext, type ReactNode } from "react";

export const MetricOverrideContext = createContext<ReadonlyMap<
	string,
	string
> | null>(null);

export const RangeLeadContext = createContext<ReactNode>(null);

export const MetricLoadingContext = createContext(false);

export const MetricEmptyContext = createContext<ReadonlySet<string> | null>(
	null,
);

export type MetricBreakdowns = NonNullable<RepositoryRunFigures["breakdowns"]>;

export const MetricBreakdownContext = createContext<
	MetricBreakdowns | null | undefined
>(undefined);
