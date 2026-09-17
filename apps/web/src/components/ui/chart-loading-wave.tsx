import { useId } from "react";
import { ContextUtilizationGradients } from "./context-utilization-gradients";
import "./chart-loading-wave.css";

// A fixed illustrative wave, independent of session data. One moving mask
// reveals the line and fill together, keeping their fading edges aligned.
const CHART_LOADING_LINE =
	"M 10 47 C 80 47 80 28 150 28 C 220 28 220 10 290 10 C 360 10 360 39 430 39 C 500 39 500 5 570 5 C 640 5 640 32 710 32 C 780 32 780 16 850 16 C 920 16 920 44 990 44";

export function ChartLoadingWave({
	className,
	viewBoxHeight = 76,
	color,
	linePath = CHART_LOADING_LINE,
	strokeWidth = 2.5,
}: {
	className: string;
	viewBoxHeight?: number;
	color?: string;
	linePath?: string;
	strokeWidth?: number;
}) {
	const fillId = useId();
	return (
		<svg
			aria-hidden="true"
			className={className}
			preserveAspectRatio="none"
			viewBox={`0 0 1000 ${viewBoxHeight}`}
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
				<linearGradient id={`${fillId}-fade`} x1="0%" x2="100%">
					<stop offset="0%" stopColor="white" stopOpacity="0" />
					<stop offset="35%" stopColor="white" />
					<stop offset="65%" stopColor="white" />
					<stop offset="100%" stopColor="white" stopOpacity="0" />
				</linearGradient>
				<mask
					id={`${fillId}-flow`}
					maskUnits="userSpaceOnUse"
					x="0"
					y="0"
					width="1000"
					height="76"
				>
					<rect
						className="chart-loading-wave-mask"
						width="300"
						height="76"
						fill={`url(#${fillId}-fade)`}
						data-session-chart-loading-mask
					/>
				</mask>
			</defs>
			{[16, 27, 39].map((y) => (
				<path
					key={y}
					className="stroke-[color-mix(in_srgb,var(--session-overview-text,var(--cost-foreground))_6%,transparent)]"
					d={`M 10 ${y} H 990`}
					vectorEffect="non-scaling-stroke"
				/>
			))}
			<g mask={`url(#${fillId}-flow)`} data-session-chart-loading-flow>
				<path d={`${linePath} L 990 50 L 10 50 Z`} fill={`url(#${fillId})`} />
				<path
					className="fill-none"
					d={linePath}
					stroke={color ?? `url(#${fillId}-stroke)`}
					strokeLinecap="round"
					strokeWidth={strokeWidth}
					vectorEffect="non-scaling-stroke"
				/>
			</g>
		</svg>
	);
}
