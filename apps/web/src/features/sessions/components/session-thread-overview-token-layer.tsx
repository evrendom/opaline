import { useMemo } from "react";
import { ContextUtilizationGradients } from "@/components/ui/context-utilization-gradients";
import type { SessionThreadOverviewStripConfig } from "./session-thread-overview-config";
import {
	buildLivelineSignal,
	type SessionOverviewLivelineSignal,
} from "./session-thread-overview-liveline-geometry";
import type { SessionOverviewCallSeries } from "./session-thread-overview-model";
import {
	getChartX,
	getPlotBounds,
} from "./session-thread-overview-strip-utils";
import type { SessionThreadOverviewBreak } from "./session-thread-overview-timeline";

type LivelineTone = "accent" | "context";

type LivelineSeriesLayer = {
	gradientId: string;
	signal: SessionOverviewLivelineSignal;
	tone: LivelineTone;
};

function LivelineGradient({ gradientId, signal, tone }: LivelineSeriesLayer) {
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
				className="[stop-color:var(--session-overview-accent)] [stop-opacity:0.08] dark:[stop-opacity:0.12]"
				offset="0%"
			/>
			<stop
				className="[stop-color:var(--session-overview-accent)]"
				offset="100%"
				stopOpacity="0"
			/>
		</linearGradient>
	);
}

function LivelineCurve({ gradientId, signal, tone }: LivelineSeriesLayer) {
	return (
		<>
			{signal.areaPath ? (
				<path d={signal.areaPath} fill={`url(#${gradientId})`} />
			) : null}
			{signal.linePath ? (
				<path
					className={
						tone === "accent" ? "stroke-(--session-overview-accent)" : undefined
					}
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

function LivelineBreakBridges({
	breaks,
	config,
	layer,
}: {
	breaks: readonly SessionThreadOverviewBreak[];
	config: SessionThreadOverviewStripConfig;
	layer: LivelineSeriesLayer;
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
			<g key={`${layer.gradientId}-${gap.key}`} data-liveline-break-bridge>
				<path
					d={path}
					stroke="var(--session-overview-chart-surface)"
					strokeLinecap="round"
					strokeWidth="5"
					vectorEffect="non-scaling-stroke"
				/>
				<path
					className={
						layer.tone === "accent"
							? "stroke-(--session-overview-accent)"
							: undefined
					}
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
		(): readonly LivelineSeriesLayer[] => [
			{
				gradientId: `${gradientId}-input`,
				signal: buildLivelineSignal(series, config),
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
					<LivelineGradient key={layer.gradientId} {...layer} />
				))}
			</defs>
			{gridYs.map((y) => (
				<path
					key={y}
					className="stroke-[color-mix(in_srgb,var(--session-overview-text)_6%,transparent)]"
					d={`M ${plotLeft} ${y} H ${plotRight}`}
					strokeWidth="1"
					vectorEffect="non-scaling-stroke"
				/>
			))}
			{signals.map((layer) => (
				<LivelineCurve key={layer.gradientId} {...layer} />
			))}
			{signals.map((layer) => (
				<LivelineBreakBridges
					key={`${layer.gradientId}-breaks`}
					breaks={breaks}
					config={config}
					layer={layer}
				/>
			))}
		</g>
	);
}
