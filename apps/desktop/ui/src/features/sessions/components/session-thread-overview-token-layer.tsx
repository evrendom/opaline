import { useMemo } from "react";
import { ContextUtilizationGradients } from "@/app/ui/context-utilization-gradients";
import type { SessionThreadOverviewStripConfig } from "./session-thread-overview-config";
import type { SessionOverviewCallSeries } from "./session-thread-overview-model";
import {
	buildPulseSignal,
	type SessionOverviewPulseSignal,
} from "./session-thread-overview-pulse-geometry";
import {
	getChartX,
	getPlotBounds,
} from "./session-thread-overview-strip-utils";
import type { SessionThreadOverviewBreak } from "./session-thread-overview-timeline";

type PulseTone = "accent" | "context";

type PulseSeriesLayer = {
	gradientId: string;
	signal: SessionOverviewPulseSignal;
	tone: PulseTone;
};

function PulseGradient({ gradientId, signal, tone }: PulseSeriesLayer) {
	if (tone === "context") {
		return (
			<ContextUtilizationGradients
				gradientId={gradientId}
				baselineY={signal.baselineY}
				topY={signal.topY}
			/>
		);
	}

	return (
		<linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
			<stop
				className="[stop-color:var(--accent)] [stop-opacity:0.08] dark:[stop-opacity:0.12]"
				offset="0%"
			/>
			<stop
				className="[stop-color:var(--accent)]"
				offset="100%"
				stopOpacity="0"
			/>
		</linearGradient>
	);
}

function PulseCurve({ gradientId, signal, tone }: PulseSeriesLayer) {
	return (
		<>
			{signal.areaPath ? (
				<path d={signal.areaPath} fill={`url(#${gradientId})`} />
			) : null}
			{signal.linePath ? (
				<path
					className={tone === "accent" ? "stroke-accent" : undefined}
					d={signal.linePath}
					fill="none"
					stroke={tone === "context" ? `url(#${gradientId}-stroke)` : undefined}
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth="2.5"
					vectorEffect="non-scaling-stroke"
				/>
			) : null}
		</>
	);
}

function PulseBreakBridges({
	breaks,
	config,
	layer,
}: {
	breaks: readonly SessionThreadOverviewBreak[];
	config: SessionThreadOverviewStripConfig;
	layer: PulseSeriesLayer;
}) {
	const { plotLeft, plotRight } = getPlotBounds(config);
	return breaks.flatMap((gap) => {
		const visibleStartRatio = Math.max(
			gap.xStartRatio,
			config.xDomainStartRatio,
		);
		const visibleEndRatio = Math.min(gap.xEndRatio, config.xDomainEndRatio);
		if (visibleEndRatio <= visibleStartRatio) {
			return [];
		}

		const rawStartX = getChartX(visibleStartRatio, config);
		const rawEndX = getChartX(visibleEndRatio, config);
		const centerX = (rawStartX + rawEndX) / 2;
		const halfWidth = Math.max((rawEndX - rawStartX) / 2, 6);
		const startX = Math.max(centerX - halfWidth, plotLeft);
		const endX = Math.min(centerX + halfWidth, plotRight);
		if (endX <= startX) {
			return [];
		}
		const path = `M ${startX} ${layer.signal.baselineY} H ${endX}`;

		return [
			<g key={`${layer.gradientId}-${gap.key}`} data-pulse-break-bridge>
				<path
					d={path}
					stroke="var(--canvas)"
					strokeLinecap="round"
					strokeWidth="5"
					vectorEffect="non-scaling-stroke"
				/>
				<path
					className={layer.tone === "accent" ? "stroke-accent" : undefined}
					d={path}
					fill="none"
					stroke={
						layer.tone === "context"
							? `url(#${layer.gradientId}-stroke)`
							: undefined
					}
					strokeDasharray="2 3"
					strokeLinecap="round"
					strokeWidth="2.5"
					vectorEffect="non-scaling-stroke"
				/>
			</g>,
		];
	});
}

export function SessionThreadOverviewTokenLayer({
	breaks,
	config,
	gradientId,
	plotLeft,
	plotRight,
	series,
}: {
	breaks: readonly SessionThreadOverviewBreak[];
	config: SessionThreadOverviewStripConfig;
	gradientId: string;
	plotLeft: number;
	plotRight: number;
	series: SessionOverviewCallSeries;
}) {
	const signals = useMemo(
		(): readonly PulseSeriesLayer[] => [
			{
				gradientId: `${gradientId}-input`,
				signal: buildPulseSignal(series, config),
				tone: "context",
			},
		],
		[config, gradientId, series],
	);
	const gridYs =
		signals[0]?.signal.gridYs ??
		[0.25, 0.5, 0.75].map((ratio) => config.axisY - (config.axisY - 5) * ratio);

	return (
		<g>
			<defs>
				{signals.map((layer) => (
					<PulseGradient key={layer.gradientId} {...layer} />
				))}
			</defs>
			{gridYs.map((y) => (
				<path
					key={y}
					className="stroke-line-soft"
					d={`M ${plotLeft} ${y} H ${plotRight}`}
					strokeWidth="1"
					vectorEffect="non-scaling-stroke"
				/>
			))}
			{signals.map((layer) => (
				<PulseCurve key={layer.gradientId} {...layer} />
			))}
			{signals.map((layer) => (
				<PulseBreakBridges
					key={`${layer.gradientId}-breaks`}
					breaks={breaks}
					config={config}
					layer={layer}
				/>
			))}
		</g>
	);
}
