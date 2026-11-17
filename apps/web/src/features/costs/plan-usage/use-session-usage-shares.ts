import { useMemo } from "react";
import { useOptionalDateRange } from "@/features/analytics/date-range/DateRangeProvider";
import { useLocalDesktopApp } from "@/features/desktop/local-app";
import { sessionUsageShares, usePlanUsage } from "./use-plan-usage";

export function useSessionUsageShares(): ReadonlyMap<string, number> | null {
	const desktop = useLocalDesktopApp();
	const range = useOptionalDateRange()?.state;
	const query = usePlanUsage(desktop && range !== undefined, {
		startDate: range?.startDate ?? "",
		endDate: range?.endDate ?? "",
	});
	return useMemo(
		() => (desktop ? sessionUsageShares(query.data) : null),
		[desktop, query.data],
	);
}
