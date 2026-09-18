import type { DashboardMetricData } from "@rudel/api-routes";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

// Recharts fills its store in effects, so its SVG is absent from server HTML.
// Show the same seeded daily totals until the interactive chart has mounted.
export function DemoTrendPreview({
	trend,
	color,
}: {
	trend: DashboardMetricData["trend"];
	color: string;
}) {
	const hydrated = useSyncExternalStore(
		subscribe,
		getSnapshot,
		getServerSnapshot,
	);
	if (hydrated || trend.length === 0) return null;
	const maximum = Math.max(1, ...trend.map((point) => point.total));
	const points = trend
		.map(
			(point, index) =>
				`${64 + (index / Math.max(1, trend.length - 1)) * 1124},${270 - (point.total / maximum) * 250}`,
		)
		.join(" ");
	return (
		<svg
			aria-hidden="true"
			data-demo-trend-preview
			viewBox="0 0 1200 300"
			preserveAspectRatio="none"
			style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
		>
			{[20, 103, 187, 270].map((y) => (
				<line
					key={y}
					x1={64}
					x2={1188}
					y1={y}
					y2={y}
					stroke="var(--cost-border)"
					strokeDasharray="2 4"
				/>
			))}
			<polygon
				points={`64,270 ${points} 1188,270`}
				fill={color}
				fillOpacity={0.04}
			/>
			<polyline
				points={points}
				fill="none"
				stroke={color}
				strokeWidth={1.5}
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}
