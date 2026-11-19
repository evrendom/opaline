import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { CHART_INTERVALS, type ChartInterval } from "./chart-interval";

export function readChartInterval(params: URLSearchParams): ChartInterval {
	return (
		CHART_INTERVALS.find((option) => option.value === params.get("interval"))
			?.value ?? "daily"
	);
}

/** The dashboard chart's interval, kept in the URL. */
export function useChartInterval() {
	const [params, setParams] = useSearchParams();
	const setInterval = useCallback(
		(value: ChartInterval) =>
			setParams((current) => {
				const next = new URLSearchParams(current);
				if (value === "daily") next.delete("interval");
				else next.set("interval", value);
				return next;
			}),
		[setParams],
	);
	return [readChartInterval(params), setInterval] as const;
}
