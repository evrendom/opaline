import { useState } from "react";
import { useLocalDesktopApp } from "@/features/desktop/local-app";
import type { ChartInterval } from "../chart-interval";
import type { UsageTab } from "../cost-chart";
import { PlanUsageChart, showsChart } from "./plan-usage-chart";
import { UsageBreakdowns } from "./usage-breakdowns";
import {
	leftPercent,
	type PlanProvider,
	type UsageRange,
	usePlanUsage,
} from "./use-plan-usage";

export function useUsageTab(
	range: UsageRange,
	interval: ChartInterval,
): {
	tab: UsageTab | undefined;
	deselect: () => void;
} {
	const desktop = useLocalDesktopApp();
	const [selected, setSelected] = useState(false);
	const [provider, setProvider] = useState<PlanProvider>("claude");
	const [refreshing, setRefreshing] = useState(false);
	const query = usePlanUsage(desktop, range);
	const deselect = () => setSelected(false);
	if (!desktop || query.data === null) return { tab: undefined, deselect };
	const usage = query.data?.providers.find(
		(entry) => entry.provider === provider,
	);
	const window = usage?.window ?? null;
	const refresh = () => {
		setRefreshing(true);
		void fetch("/api/selfhost/plan-usage?refresh=1", { credentials: "include" })
			.then(() => query.refetch())
			.finally(() => setRefreshing(false));
	};
	return {
		deselect,
		tab: {
			value: query.isPending
				? undefined
				: window
					? `${Math.round(leftPercent(window.usedPercent))}% left`
					: "—",
			trend: query.isPending
				? undefined
				: (window?.buckets.flatMap((bucket) =>
						bucket.usedPercent === null
							? []
							: [leftPercent(bucket.usedPercent)],
					) ?? []),
			selected,
			onSelect: () => setSelected(true),
			breakdowns:
				window && showsChart(window) ? (
					<UsageBreakdowns window={window} titles={query.data?.titles ?? {}} />
				) : null,
			chart: (
				<PlanUsageChart
					report={query.data}
					provider={provider}
					onProviderChange={setProvider}
					interval={interval}
					pending={query.isPending}
					failed={query.isError}
					refreshing={refreshing}
					onRefresh={refresh}
				/>
			),
		},
	};
}
