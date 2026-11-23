import type { CSSProperties } from "react";
import { Button } from "@/app/ui/button";
import { TouchTarget } from "@/app/ui/touch-target";
import {
	getSessionOverviewCallActivityCounts,
	hasSessionOverviewActivity,
	type SessionOverviewActivityCounts,
} from "./session-thread-overview-call-activity";
import type { SessionThreadOverviewChart } from "./session-thread-overview-chart";
import type { SessionThreadOverviewStripConfig } from "./session-thread-overview-config";
import { getSessionOverviewContextUtilizationColor } from "./session-thread-overview-context-colors";
import { getSessionOverviewEventDotColorClassName } from "./session-thread-overview-event-dots";
import type {
	SessionThreadOverviewTimelineEvent,
	SessionThreadOverviewTimelineEventKind,
} from "./session-thread-overview-events";
import type { SessionOverviewCallSeries } from "./session-thread-overview-model";
import { formatTimelineMomentWithSeconds } from "./session-thread-overview-model";
import {
	getPulseCallInputUtilization,
	type SessionOverviewPulseCallHit,
} from "./session-thread-overview-pulse-geometry";
import type { SessionOverviewHover } from "./session-thread-overview-strip-utils";
import {
	formatCompactNumber,
	formatCost,
	getChartX,
} from "./session-thread-overview-strip-utils";
import type { SessionOverviewZoomWindow } from "./session-thread-overview-zoom";

const SESSION_OVERVIEW_HOVER_CARD_SURFACE_CLASSES =
	"absolute top-0 z-50 w-80 max-w-[calc(100%-1.5rem)] corner-s bg-canvas font-body text-body-m text-ink shadow-float ring-1 ring-line";

interface SessionContextUtilizationRingStyle extends CSSProperties {
	"--session-context-ring-color-dark": string;
	"--session-context-ring-color-light": string;
}

function getPreviousInputTotal(
	hit: SessionOverviewPulseCallHit,
	series: SessionOverviewCallSeries,
) {
	const turnPosition = series.turns.findIndex(
		(turn) => turn.index === hit.turnIndex,
	);
	if (turnPosition < 0) {
		return undefined;
	}

	const previousCallInTurn =
		series.turns[turnPosition]?.calls[hit.callIndex - 1];
	if (previousCallInTurn) {
		return previousCallInTurn.inputTotal;
	}

	for (let index = turnPosition - 1; index >= 0; index -= 1) {
		const previousCall = series.turns[index]?.calls.at(-1);
		if (previousCall) {
			return previousCall.inputTotal;
		}
	}
	return undefined;
}

function formatSignedCompactNumber(value: number) {
	const sign = value >= 0 ? "+" : "−";
	return `${sign}${formatCompactNumber(Math.abs(value))}`;
}

function SessionContextUtilizationRing({
	maximum,
	percentage,
}: {
	maximum: number;
	percentage: number;
}) {
	const boundedPercentage = Math.min(100, Math.max(0, percentage));
	const roundedPercentage = Math.round(boundedPercentage);
	const plottedPercentage = Number(boundedPercentage.toFixed(2));
	const valueText = `${roundedPercentage}% of ${formatCompactNumber(maximum)} input context`;
	const style: SessionContextUtilizationRingStyle = {
		"--session-context-ring-color-dark":
			getSessionOverviewContextUtilizationColor(boundedPercentage, "dark"),
		"--session-context-ring-color-light":
			getSessionOverviewContextUtilizationColor(boundedPercentage, "light"),
	};

	return (
		<div
			aria-label="Input context utilization"
			aria-valuemax={100}
			aria-valuemin={0}
			aria-valuenow={roundedPercentage}
			aria-valuetext={valueText}
			// design-escape-ok(dark): data paint; the context ring's hue for each mode
			className="relative flex size-4 shrink-0 items-center justify-center [--session-context-ring-color:var(--session-context-ring-color-light)] dark:[--session-context-ring-color:var(--session-context-ring-color-dark)]"
			data-session-overview-context-utilization
			role="progressbar"
			style={style}
			title={valueText}
		>
			<svg
				aria-hidden="true"
				className="size-4 shrink-0 overflow-visible fill-none"
				viewBox="0 0 16 16"
			>
				<circle
					className="stroke-line"
					cx="8"
					cy="8"
					r="6.25"
					strokeWidth="2.5"
				/>
				{plottedPercentage > 0 ? (
					<circle
						className="stroke-(--session-context-ring-color)"
						cx="8"
						cy="8"
						pathLength="100"
						r="6.25"
						strokeDasharray={`${plottedPercentage} ${100 - plottedPercentage}`}
						strokeLinecap="round"
						strokeWidth="2.5"
						transform="rotate(-90 8 8)"
					/>
				) : null}
			</svg>
		</div>
	);
}

function getCardStyle(
	xRatio: number,
	config: SessionThreadOverviewStripConfig,
): CSSProperties {
	const xPercent = (getChartX(xRatio, config) / config.chartWidth) * 100;
	return xPercent <= 50
		? { left: `${xPercent}%` }
		: { right: `${100 - xPercent}%` };
}

function getCardPlacement(
	xRatio: number,
	config: SessionThreadOverviewStripConfig,
) {
	return (getChartX(xRatio, config) / config.chartWidth) * 100 <= 50
		? "right"
		: "left";
}

function formatTime(timestamp: number) {
	return new Date(timestamp).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatRange(startTimestamp: number, endTimestamp: number) {
	return `${formatTime(startTimestamp)} – ${formatTime(endTimestamp)}`;
}

function sumRecordedValues(values: readonly (number | undefined)[]) {
	const recordedValues = values.filter(
		(value): value is number => value !== undefined,
	);
	return recordedValues.length > 0
		? recordedValues.reduce((total, value) => total + value, 0)
		: undefined;
}

function formatCount(value: number, singular: string, plural = `${singular}s`) {
	return `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
}

function SessionOverviewActivityTag({
	count,
	kind,
	label,
	title,
}: {
	count: number;
	kind: SessionThreadOverviewTimelineEventKind;
	label: string;
	title: string;
}) {
	return (
		<div
			className="flex h-4 shrink-0 items-center gap-xxs corner-m bg-hover-strong pr-xs pl-xxs"
			data-session-overview-activity-tag={kind}
			title={title}
		>
			<span
				aria-hidden="true"
				className={`size-1.5 shrink-0 corner-s ${getSessionOverviewEventDotColorClassName(kind)}`}
			/>
			<span>{`${label} ${count.toLocaleString()}`}</span>
		</div>
	);
}

function countEvents(
	events: readonly SessionThreadOverviewTimelineEvent[],
	kind: SessionThreadOverviewTimelineEventKind,
) {
	return events.reduce(
		(total, event) => (event.kind === kind ? total + event.count : total),
		0,
	);
}

function getZoomSelectionSummary(
	chart: SessionThreadOverviewChart,
	events: readonly SessionThreadOverviewTimelineEvent[],
	series: SessionOverviewCallSeries,
	selection: SessionOverviewZoomWindow,
) {
	const selectedRows = chart.rows.filter(
		(row) =>
			row.xEndRatio >= selection.xStartRatio &&
			row.xStartRatio <= selection.xEndRatio,
	);
	const callCount = series.turns.reduce(
		(total, turn) =>
			total +
			turn.calls.filter(
				(call) =>
					call.xRatio >= selection.xStartRatio &&
					call.xRatio <= selection.xEndRatio,
			).length,
		0,
	);
	const selectedEvents = events.filter(
		(event) =>
			event.xRatio >= selection.xStartRatio &&
			event.xRatio <= selection.xEndRatio,
	);

	return {
		callCount,
		estimatedCost: sumRecordedValues(selectedRows.map((row) => row.cost)),
		eventCounts: {
			edits: countEvents(selectedEvents, "file-edit"),
			errors: countEvents(selectedEvents, "error"),
			reads: countEvents(selectedEvents, "file-read"),
			skills: countEvents(selectedEvents, "skill"),
			subagents: countEvents(selectedEvents, "subagent"),
			writes: countEvents(selectedEvents, "file-write"),
		},
		inputTokens: sumRecordedValues(selectedRows.map((row) => row.inputTokens)),
		turnCount: selectedRows.length,
	};
}

function SessionOverviewEventCounts({
	counts,
	layout,
}: {
	counts: SessionOverviewActivityCounts;
	layout: "full-row" | "inline";
}) {
	const definitions: readonly {
		accessibleLabel: string;
		count: number;
		kind: SessionThreadOverviewTimelineEventKind;
		label: string;
	}[] = [
		{
			accessibleLabel: "errors",
			count: counts.errors,
			kind: "error",
			label: "Errors",
		},
		{
			accessibleLabel: "skill uses",
			count: counts.skills,
			kind: "skill",
			label: "Skills",
		},
		{
			accessibleLabel: "file reads",
			count: counts.reads,
			kind: "file-read",
			label: "Reads",
		},
		{
			accessibleLabel: "file writes",
			count: counts.writes,
			kind: "file-write",
			label: "Writes",
		},
		{
			accessibleLabel: "file edits",
			count: counts.edits,
			kind: "file-edit",
			label: "Edits",
		},
		{
			accessibleLabel: "subagents",
			count: counts.subagents,
			kind: "subagent",
			label: "Subagents",
		},
	];
	const visibleDefinitions = definitions.filter(
		(definition) => definition.count > 0,
	);
	if (visibleDefinitions.length === 0) {
		return null;
	}

	return (
		<div
			aria-label={visibleDefinitions
				.map(
					(definition) =>
						`${definition.count.toLocaleString()} ${definition.accessibleLabel}`,
				)
				.join(", ")}
			className={`flex min-w-0 items-center gap-xs overflow-hidden ${layout === "full-row" ? "w-full justify-start" : ""}`}
			role="img"
		>
			{visibleDefinitions.map((definition) => (
				<SessionOverviewActivityTag
					key={definition.kind}
					count={definition.count}
					kind={definition.kind}
					label={definition.label}
					title={`${definition.count.toLocaleString()} ${definition.accessibleLabel}`}
				/>
			))}
		</div>
	);
}

function SessionZoomSelectionCard({
	chart,
	config,
	events,
	onConfirm,
	readoutId,
	selection,
	series,
}: {
	chart: SessionThreadOverviewChart;
	config: SessionThreadOverviewStripConfig;
	events: readonly SessionThreadOverviewTimelineEvent[];
	onConfirm: () => void;
	readoutId: string;
	selection: SessionOverviewZoomWindow;
	series: SessionOverviewCallSeries;
}) {
	const startTimestamp = chart.unprojectRatio(selection.xStartRatio);
	const endTimestamp = chart.unprojectRatio(selection.xEndRatio);
	const xRatio = (selection.xStartRatio + selection.xEndRatio) / 2;
	const placement = getCardPlacement(xRatio, config);
	const summary = getZoomSelectionSummary(chart, events, series, selection);
	const metricParts = [
		summary.inputTokens === undefined
			? undefined
			: `${formatCompactNumber(summary.inputTokens)} input`,
		summary.estimatedCost === undefined
			? undefined
			: formatCost(summary.estimatedCost),
	].filter((part): part is string => part !== undefined);

	return (
		<div
			id={readoutId}
			aria-label="Zoom selected time frame"
			className={`${SESSION_OVERVIEW_HOVER_CARD_SURFACE_CLASSES} pointer-events-auto grid h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-m px-l py-s ${placement === "right" ? "translate-x-3" : "-translate-x-3"}`}
			data-session-overview-hover-card
			data-session-overview-hover-card-mode="zoom"
			data-session-overview-hover-card-placement={placement}
			role="dialog"
			style={getCardStyle(xRatio, config)}
		>
			<div className="min-w-0">
				<p className="truncate tabular-nums">
					<span className="font-medium">
						{startTimestamp !== undefined && endTimestamp !== undefined
							? formatRange(startTimestamp, endTimestamp)
							: "Selected time frame"}
					</span>
					<span className="text-ink-3">
						{" · "}
						{formatCount(summary.turnCount, "turn")} ·{" "}
						{formatCount(summary.callCount, "call")}
					</span>
				</p>
				<div className="flex min-w-0 items-center gap-s text-ink-3 tabular-nums">
					{metricParts.length > 0 ? (
						<p className="min-w-0 truncate">{metricParts.join(" · ")}</p>
					) : null}
					{config.showActivity ? (
						<SessionOverviewEventCounts
							counts={summary.eventCounts}
							layout="inline"
						/>
					) : null}
				</div>
			</div>
			<Button
				variant="secondary"
				className="relative self-center"
				onClick={onConfirm}
				size="sm"
				type="button"
			>
				<TouchTarget />
				Zoom In
			</Button>
		</div>
	);
}

export function SessionThreadOverviewHoverCard({
	chart,
	config,
	events = [],
	hit,
	onZoomSelectionConfirm,
	readout,
	readoutId,
	series,
	timestamp,
	zoomSelection,
}: {
	chart?: SessionThreadOverviewChart;
	config: SessionThreadOverviewStripConfig;
	events?: readonly SessionThreadOverviewTimelineEvent[];
	hit: SessionOverviewPulseCallHit | undefined;
	onZoomSelectionConfirm?: () => void;
	readout: SessionOverviewHover | undefined;
	readoutId: string;
	series: SessionOverviewCallSeries;
	timestamp: number | undefined;
	zoomSelection?: SessionOverviewZoomWindow;
}) {
	if (zoomSelection && chart && onZoomSelectionConfirm) {
		return (
			<SessionZoomSelectionCard
				chart={chart}
				config={config}
				events={events}
				onConfirm={onZoomSelectionConfirm}
				readoutId={readoutId}
				selection={zoomSelection}
				series={series}
			/>
		);
	}
	if (!readout) {
		return null;
	}

	const placement = getCardPlacement(readout.xRatio, config);
	const previousInputTotal = hit
		? getPreviousInputTotal(hit, series)
		: undefined;
	const inputDelta =
		hit && previousInputTotal !== undefined
			? hit.call.inputTotal - previousInputTotal
			: undefined;
	const activityCounts = getSessionOverviewCallActivityCounts(
		events,
		series,
		hit
			? {
					callIndex: hit.callIndex,
					kind: "call",
					turnIndex: readout.index,
				}
			: readout.kind === "activity"
				? {
						eventXRatio: readout.activityXRatio,
						kind: "event",
						turnIndex: readout.index,
					}
				: { kind: "none", turnIndex: readout.index },
	);
	const hasActivity = hasSessionOverviewActivity(activityCounts);
	const inputUtilization = hit
		? getPulseCallInputUtilization(series, hit.call)
		: undefined;
	if (timestamp === undefined && !hit && !hasActivity) {
		return null;
	}
	// Without activity, the card is the moment and the call's input alone.
	const { showActivity } = config;

	return (
		<output
			id={readoutId}
			aria-live="off"
			className={`${SESSION_OVERVIEW_HOVER_CARD_SURFACE_CLASSES} pointer-events-none ${showActivity ? "h-14" : "h-8"} ${placement === "right" ? "translate-x-3" : "-translate-x-3"}`}
			data-session-overview-hover-card
			data-session-overview-hover-card-placement={placement}
			style={getCardStyle(readout.xRatio, config)}
		>
			<div className="flex h-full min-w-0 flex-col justify-center gap-xs px-l py-s">
				<div className="flex min-w-0 items-center justify-between gap-m tabular-nums">
					<p className="min-w-0 truncate font-medium text-ink">
						{timestamp === undefined
							? "Time unavailable"
							: formatTimelineMomentWithSeconds(timestamp)}
					</p>
					{hit ? (
						<div className="flex shrink-0 items-center gap-xs">
							<p
								className="text-ink-3"
								data-session-overview-input-tokens
								title="Input tokens"
							>
								IN-TOK{" "}
								<span className="font-medium text-ink">
									{formatCompactNumber(hit.call.inputTotal)}
									{inputDelta === undefined
										? ""
										: ` ${formatSignedCompactNumber(inputDelta)}`}
								</span>
							</p>
							{inputUtilization ? (
								<SessionContextUtilizationRing {...inputUtilization} />
							) : null}
						</div>
					) : null}
				</div>

				{!showActivity ? null : hasActivity ? (
					<div className="flex min-w-0 items-center tabular-nums">
						<SessionOverviewEventCounts
							counts={activityCounts}
							layout="full-row"
						/>
					</div>
				) : (
					<p className="text-ink-3">
						{hit
							? "No recorded actions for this call."
							: "No model call or recorded action at this point."}
					</p>
				)}
			</div>
		</output>
	);
}
