import type { DashboardMetric } from "@rudel/api-routes";
import { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { formatMetricRatio, METRIC_LABELS } from "@/features/costs/cost-format";
import {
	getHostState,
	type HostState,
	onHostState,
	requestHost,
} from "./host-bridge";
import "./plugin.css";

const PluginRoot = lazy(() =>
	import("./plugin-root").then((module) => ({ default: module.PluginRoot })),
);

// The web app's loading mark; it appears only if loading takes a moment.
const loading = (
	<output className="plugin-loading" aria-label="Loading Opaline" />
);

function Plugin() {
	const [host, setHost] = useState<HostState>(getHostState);
	const [error, setError] = useState("");
	useEffect(() => onHostState(setHost), []);
	const seed = host.toolOutput;
	if (!seed) return loading;
	if (host.displayMode === "fullscreen")
		return (
			<Suspense fallback={loading}>
				<PluginRoot
					key={seed.bootstrap.organization.id}
					host={host}
					seed={seed}
				/>
			</Suspense>
		);
	// The metric get_dashboard was asked for, as the web dashboard shows it.
	const requested = seed.query.metric as DashboardMetric;
	const name = seed.dashboard.data.metrics[requested] ? requested : "cost";
	const metric =
		seed.dashboard.data.metrics[name] ?? seed.dashboard.data.metrics.cost;
	if (!metric) return loading;
	const values = metric.trend.map((point) => point.total);
	const maximum = Math.max(...values, 1);
	return (
		<section className="plugin-card">
			<p>
				{METRIC_LABELS[name]} · {seed.query.startDate} – {seed.query.endDate}
			</p>
			<strong>
				{formatMetricRatio(metric.total, name, metric.denominator)}
			</strong>
			<svg
				viewBox="0 0 300 48"
				preserveAspectRatio="none"
				role="img"
				aria-label="Daily cost trend"
			>
				<polyline
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					points={values
						.map(
							(value, index) =>
								`${(index * 300) / Math.max(values.length - 1, 1)},${46 - (value * 44) / maximum}`,
						)
						.join(" ")}
				/>
			</svg>
			<button
				type="button"
				onClick={() =>
					void requestHost("ui/request-display-mode", {
						mode: "fullscreen",
					}).catch((error) => setError(error.message))
				}
			>
				Open
			</button>
			{error ? <p role="alert">{error}</p> : null}
		</section>
	);
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Plugin />);
