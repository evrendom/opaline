import { useState } from "react";
import { useLocalDesktopApp } from "@/features/desktop/local-app";
import { type ChartInterval, chartPeriodDates } from "../chart-interval";
import type { UsageTab } from "../cost-chart";
import { formatPoints, PlanUsageChart, periodsOf } from "./plan-usage-chart";
import { UsageBreakdowns } from "./usage-breakdowns";
import { useUsageSelection } from "./usage-selection";
import {
	leftPercent,
	type PlanProvider,
	type UsageRange,
	usePlanUsage,
} from "./use-plan-usage";

function usedChip(points: number): string {
	return `\u2193${Math.round(points)}`;
}

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
	const { selected, setSelected } = useUsageSelection();
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
				pending: query.isPending,
				breakdowns: () => null,
				chart: (dots, pending) => (
					<PlanUsageChart
						dots={dots}
						repository
						report={query.data}
						provider={provider}
						onProviderChange={setProvider}
						interval={interval}
						pending={pending || query.isPending}
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
	const latest = [...periods].reverse().find((period) => period.solid !== null);
	const flatDates =
		firstKnown === null && periods.length === 0
			? chartPeriodDates(range.startDate, range.endDate, interval)
			: periods.map((period) => period.date);
	return {
		deselect,
		tab: {
			value: query.isPending
				? undefined
				: window
					? `${Math.round(leftPercent(window.usedPercent))}%`
					: "—",
			chip: latest ? usedChip(latest.usedPoints) : undefined,
			chipAt: (index) => {
				const period = periods[index];
				return period && period.solid !== null
					? usedChip(period.usedPoints)
					: "";
			},
			trend: query.isPending
				? undefined
				: firstKnown === null
					? flatDates.map(() => 0)
					: trend,
			dates: flatDates,
			textAt: (index) => {
				const period = periods[index];
				if (!period || period.solid === null) return "—";
				return `${Math.round(period.solid)}%`;
			},
			selected,
			onSelect: () => setSelected(true),
			pending: query.isPending,
			breakdowns: (pending) => (
				<UsageBreakdowns
					pending={pending || query.isPending}
					window={window}
					titles={query.data?.titles ?? {}}
				/>
			),
			chart: (dots, pending) => (
				<PlanUsageChart
					dots={dots}
					report={query.data}
					provider={provider}
					onProviderChange={setProvider}
					interval={interval}
					pending={pending || query.isPending}
					failed={query.isError}
				/>
			),
		},
	};
}
