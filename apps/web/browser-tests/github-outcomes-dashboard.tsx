import {
	CostDashboardInputSchema,
	CostDashboardSchema,
	type CostDimension,
	type DashboardMetric,
} from "@rudel/api-routes";
import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { TooltipProvider } from "../src/app/ui/tooltip";
import { DateRangeProvider } from "../src/features/analytics/date-range/DateRangeProvider";
import type { ChartInterval } from "../src/features/costs/chart-interval";
import { ChartIntervalPicker } from "../src/features/costs/chart-interval-picker";
import { CostDashboardView } from "../src/features/costs/cost-dashboard-page";
import { listDashboardTabs } from "../src/features/costs/cost-format";
import {
	CI_DIMENSIONS,
	PR_DIMENSIONS,
} from "../src/features/costs/use-cost-dashboard";
import "../src/index.css";

function Harness() {
	const [metric, setMetric] = useState<
		"mergedPullRequests" | "ciRuns" | "cost"
	>("mergedPullRequests");
	const [interval, setInterval] = useState<ChartInterval>("daily");
	const [input, setInput] = useState(
		CostDashboardInputSchema.parse({
			startDate: "2026-08-31",
			endDate: "2026-10-01",
			members: ["alice"],
		}),
	);
	const request = {
		...input,
		requestedMetric: metric,
		durationInterval: interval,
	};
	const query = useQuery({
		queryKey: ["github-dashboard", request],
		queryFn: async () => {
			const response = await fetch("/rpc/analytics/overview/costs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ json: request }),
			});
			const result: { json: unknown } = await response.json();
			return CostDashboardSchema.parse(result.json);
		},
	});
	function toggle(dimension: CostDimension, id: string) {
		setInput((previous) =>
			CostDashboardInputSchema.parse({
				...previous,
				[dimension]: previous[dimension].includes(id)
					? previous[dimension].filter((value) => value !== id)
					: [...previous[dimension], id],
			}),
		);
	}
	function selectMetric(value: DashboardMetric) {
		if (
			value === "ciRuns" ||
			value === "mergedPullRequests" ||
			value === "cost"
		)
			setMetric(value);
	}
	return (
		<div style={{ height: "100vh", padding: 32 }}>
			<CostDashboardView
				toolbarStart={
					<ChartIntervalPicker value={interval} onChange={setInterval} />
				}
				dashboard={{
					input: request,
					metric,
					interval,
					setInterval,
					query,
					metrics: listDashboardTabs(query.data?.availableMetrics),
					dimensions: metric === "ciRuns" ? CI_DIMENSIONS : PR_DIMENSIONS,
					toggle,
					clear: (dimension) =>
						setInput((previous) =>
							CostDashboardInputSchema.parse(
								dimension
									? { ...previous, [dimension]: [] }
									: {
											startDate: previous.startDate,
											endDate: previous.endDate,
										},
							),
						),
					setSplit: (splitBy) =>
						setInput((previous) => ({ ...previous, splitBy })),
					setMetric: selectMetric,
				}}
			/>
		</div>
	);
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing harness root");
createRoot(root).render(
	<BrowserRouter>
		<QueryClientProvider client={new QueryClient()}>
			<DateRangeProvider>
				<TooltipProvider>
					<Harness />
				</TooltipProvider>
			</DateRangeProvider>
		</QueryClientProvider>
	</BrowserRouter>,
);
