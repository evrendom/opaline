import { useId } from "react";
import { ContextUtilizationGradients } from "./context-utilization-gradients";
import "./chart-loading-wave.css";

// A fixed illustrative wave, independent of session data. One moving window
// reveals the line and fill together, keeping their fading edges aligned.
const CHART_LOADING_LINE =
	"M 10 47 C 80 47 80 28 150 28 C 220 28 220 10 290 10 C 360 10 360 39 430 39 C 500 39 500 5 570 5 C 640 5 640 32 710 32 C 780 32 780 16 850 16 C 920 16 920 44 990 44";

/**
 * The window is an HTML layer moved by `transform`, with the wave inside it
 * moved the opposite way so the wave itself stays put. Both are compositor
 * animations, so the flow keeps going while the main thread is busy (such as
 * when the data it stands in for arrives), unlike an animated SVG mask.
 */
export function ChartLoadingWave({
	className,
	viewBoxHeight = 76,
	color,
	linePath = CHART_LOADING_LINE,
	strokeWidth = 2.5,
	guides = true,
}: {
	className: string;
	viewBoxHeight?: number;
	color?: string;
	linePath?: string;
	strokeWidth?: number;
	/** The faint horizontal grid lines behind the wave. */
	guides?: boolean;
}) {
	const fillId = useId();
	const viewBox = `0 0 1000 ${viewBoxHeight}`;
	return (
		<div aria-hidden="true" className={`chart-loading-wave ${className}`}>
			{guides ? (
				<svg
					aria-hidden="true"
					className="chart-loading-wave-layer"
					preserveAspectRatio="none"
					viewBox={viewBox}
				>
					{[16, 27, 39].map((y) => (
						<path
							key={y}
							className="stroke-[color-mix(in_srgb,var(--ink,var(--ink))_6%,transparent)]"
							d={`M 10 ${y} H 990`}
							vectorEffect="non-scaling-stroke"
						/>
					))}
				</svg>
			) : null}
			<div
				className="chart-loading-wave-window"
				data-session-chart-loading-flow
			>
				<div className="chart-loading-wave-track">
					<svg
						aria-hidden="true"
						className="chart-loading-wave-layer"
						preserveAspectRatio="none"
						viewBox={viewBox}
					>
						<defs>
							{color ? (
								<linearGradient
									id={fillId}
									gradientUnits="userSpaceOnUse"
									x1="0"
									x2="0"
									y1="5"
									y2="50"
								>
									<stop offset="0%" stopColor={color} stopOpacity={0.16} />
									<stop offset="100%" stopColor={color} stopOpacity={0.015} />
								</linearGradient>
							) : (
								<ContextUtilizationGradients
									gradientId={fillId}
									baselineY={50}
									topY={5}
								/>
							)}
						</defs>
						<path
							d={`${linePath} L 990 50 L 10 50 Z`}
							fill={`url(#${fillId})`}
						/>
						<path
							className="fill-none"
							d={linePath}
							stroke={color ?? `url(#${fillId}-stroke)`}
							strokeLinecap="round"
							strokeWidth={strokeWidth}
							vectorEffect="non-scaling-stroke"
						/>
					</svg>
				</div>
			</div>
		</div>
	);
}
