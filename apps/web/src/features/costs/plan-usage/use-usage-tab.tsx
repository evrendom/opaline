import { useState } from "react";
import { useLocalDesktopApp } from "@/features/desktop/local-app";
import type { ChartInterval } from "../chart-interval";
import type { UsageTab } from "../cost-chart";
import { PlanUsageChart, periodsOf, showsChart } from "./plan-usage-chart";
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
	enabled: boolean,
): {
	tab: UsageTab | undefined;
	deselect: () => void;
} {
	const desktop = useLocalDesktopApp() && enabled;
	const [selected, setSelected] = useState(false);
	const [provider, setProvider] = useState<PlanProvider>("claude");
	const query = usePlanUsage(desktop, range);
	const deselect = () => setSelected(false);
	if (!desktop || query.data === null) return { tab: undefined, deselect };
	const usage = query.data?.providers.find(
		(entry) => entry.provider === provider,
	);
	const window = usage?.window ?? null;
	const periods = window ? periodsOf(window, interval) : [];
	const lefts = periods.map((period) => period.solid);
	const firstKnown = lefts.find((left) => left !== null) ?? null;
	let carried = firstKnown;
	const trend = lefts.map((left) => {
		carried = left ?? carried;
		return carried ?? 0;
	});
	return {
		deselect,
		tab: {
			value: query.isPending
				? undefined
				: window
					? `${Math.round(leftPercent(window.usedPercent))}% left`
					: "—",
			trend: query.isPending || firstKnown === null ? undefined : trend,
			dates: periods.map((period) => period.date),
			textAt: (index) => {
				const period = periods[index];
				if (!period || period.solid === null) return "—";
				const estimate = period.last?.kind === "estimate";
				return `${estimate ? "~" : ""}${Math.round(period.solid)}% left`;
			},
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
				/>
			),
		},
	};
}
