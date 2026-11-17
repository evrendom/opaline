import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLocalDesktopApp } from "@/features/desktop/local-app";
import type { ChartInterval } from "../chart-interval";
import type { UsageTab } from "../cost-chart";
import {
	formatPoints,
	PlanUsageChart,
	periodsOf,
	showsChart,
} from "./plan-usage-chart";
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
	repositories?: readonly string[],
): {
	tab: UsageTab | undefined;
	deselect: () => void;
} {
	const desktop = useLocalDesktopApp() && enabled;
	const [params] = useSearchParams();
	const [selected, setSelected] = useState(() => !params.get("metric"));
	const [provider, setProvider] = useState<PlanProvider>("claude");
	const repository = repositories !== undefined;
	const query = usePlanUsage(
		desktop && (!repository || repositories.length > 0),
		range,
		repositories,
	);
	const deselect = () => setSelected(false);
	if (!desktop || query.data === null) return { tab: undefined, deselect };
	const usage = query.data?.providers.find(
		(entry) => entry.provider === provider,
	);
	const window = usage?.window ?? null;
	const periods = window ? periodsOf(window, interval) : [];
	if (repository) {
		const used = window?.repositoryPoints ?? null;
		return {
			deselect,
			tab: {
				value: query.isPending
					? undefined
					: used === null
						? "—"
						: formatPoints(used),
				trend: query.isPending
					? undefined
					: periods.map((period) => period.repositoryPoints),
				dates: periods.map((period) => period.date),
				textAt: (index) => {
					const period = periods[index];
					return period ? formatPoints(period.repositoryPoints) : "—";
				},
				selected,
				onSelect: () => setSelected(true),
				breakdowns: null,
				chart: (dots) => (
					<PlanUsageChart
						dots={dots}
						repository
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
					? `${Math.round(window.usedPercent)}%/${Math.round(leftPercent(window.usedPercent))}%`
					: "—",
			trend: query.isPending || firstKnown === null ? undefined : trend,
			dates: periods.map((period) => period.date),
			textAt: (index) => {
				const period = periods[index];
				if (!period || period.solid === null) return "—";
				return `${formatPoints(period.usedPoints)}/${Math.round(period.solid)}%`;
			},
			selected,
			onSelect: () => setSelected(true),
			breakdowns:
				window && showsChart(window) ? (
					<UsageBreakdowns window={window} titles={query.data?.titles ?? {}} />
				) : null,
			chart: (dots) => (
				<PlanUsageChart
					dots={dots}
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
