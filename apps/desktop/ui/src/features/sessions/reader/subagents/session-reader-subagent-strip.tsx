import { getRawToolInput } from "@rudel/api-routes";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Fragment, type ReactNode } from "react";
import { shortSubagentId } from "@/features/sessions/run-id";
import { formatCompactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import { isAgentStep } from "../ci/session-reader-run-ci";
import { ContextFill } from "../context/session-reader-context-fill";
import { TokenCounts } from "../detail/session-reader-turn-steps";
import { subagentModelLabel } from "../detail/step/session-reader-step-fields";
import { OpalChip } from "../detail/waterfall/session-reader-waterfall-chips";
import {
	formatReaderCost,
	formatReaderDuration,
} from "../model/session-reader-model";
import {
	flattenSteps,
	type SessionReaderStep,
} from "../model/session-reader-run-steps";
import {
	LANE_LOOK,
	LANES,
	type LaneKey,
	type LaneLook,
	laneKeysOf,
} from "../model/session-reader-step-lanes";
import { SubagentChip } from "./session-reader-subagent-chip";

export type SubagentSummary =
	NormalizedSessionDetailOverview["subagents"][number];

export function FactDot() {
	return (
		<span aria-hidden="true" className="text-ink-4">
			·
		</span>
	);
}

function laneCounts(steps: readonly SessionReaderStep[]) {
	const counts = new Map<LaneKey, number>();
	for (const step of steps)
		for (const lane of laneKeysOf(step))
			if (lane !== "model") counts.set(lane, (counts.get(lane) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1]);
}

function changedFiles(steps: readonly SessionReaderStep[]): string[] {
	return [
		...new Set(
			steps.flatMap((step) =>
				(step.files ?? [])
					.filter((file) => file.operation !== "read")
					.map((file) => file.path),
			),
		),
	];
}

export function SubagentStrip({
	className,
	launch,
	named = true,
	purpose,
	subagentId,
	summary,
	work = true,
}: {
	className?: string;
	launch: SessionReaderStep | null;
	named?: boolean;
	purpose: string | null;
	subagentId: string;
	summary: SubagentSummary | undefined;
	work?: boolean;
}) {
	const steps = launch ? flattenSteps(launch.children).filter(isAgentStep) : [];
	const failed = steps.filter((step) => step.isError).length;
	const model = launch
		? subagentModelLabel(launch, summary?.model ?? null)
		: (summary?.model ?? null);
	const input = launch?.toolEvent
		? getRawToolInput(launch.toolEvent.input)
		: {};
	const kind =
		typeof input.subagent_type === "string" && input.subagent_type.trim()
			? input.subagent_type.trim()
			: null;
	const seconds =
		typeof summary?.durationSeconds === "number"
			? summary.durationSeconds
			: launch && launch.endMs > launch.startMs
				? (launch.endMs - launch.startMs) / 1000
				: null;
	const lanes = work ? laneCounts(steps) : [];
	const files = work ? changedFiles(steps) : [];
	const facts: [string, ReactNode][] = [];
	if (model) facts.push(["model", model]);
	if (summary) facts.push(["cost", formatReaderCost(summary.estimatedCost)]);
	if (launch)
		facts.push([
			"steps",
			`${formatCompactNumber(steps.length)} ${steps.length === 1 ? "step" : "steps"}`,
		]);
	if (seconds !== null) facts.push(["time", formatReaderDuration(seconds)]);
	if (summary)
		facts.push([
			"tokens",
			<span key="tokens" className="inline-flex items-center gap-s">
				<TokenCounts turn={summary} />
			</span>,
		]);
	if (summary?.context)
		facts.push([
			"context",
			<ContextFill key="context" use={summary.context} />,
		]);
	if (summary?.mainThread && summary.mainThread.tokens > 0)
		facts.push([
			"report",
			<span
				key="report"
				title="What its report added to the main thread's context"
			>
				Report +{formatCompactNumber(summary.mainThread.tokens)} tokens to main
			</span>,
		]);
	return (
		<ReaderStrip
			aside={
				launch ? (
					<>
						<span
							title={
								launch.backgroundFromMs !== undefined
									? "The main thread went on while it worked"
									: "The main thread waited for its report"
							}
						>
							{launch.backgroundFromMs !== undefined
								? "Background"
								: "Foreground"}
						</span>
						{launch.isError ? (
							<span className="inline-flex items-center gap-xxs text-error">
								<IconAlertTriangle aria-hidden="true" className="size-3" />
								Failed
							</span>
						) : null}
					</>
				) : null
			}
			className={className}
			facts={facts}
			failed={failed > 0 ? `${failed} failed` : null}
			files={files}
			id={shortSubagentId(subagentId)}
			kind={kind ?? "Subagent"}
			lanes={lanes.map(([lane, count]) => ({
				count,
				key: lane,
				label: LANES.find((each) => each.key === lane)?.label ?? lane,
				...LANE_LOOK[lane],
			}))}
			lead={<SubagentChip selected subagentId={subagentId} />}
			named={named}
			title={purpose}
		/>
	);
}

export type StripLane = LaneLook & {
	count: number;
	key: string;
	label: string;
};

export function ReaderStrip({
	aside,
	children,
	className,
	facts,
	failed,
	files,
	id,
	kind,
	lanes,
	lead,
	named = true,
	title,
}: {
	aside?: ReactNode;
	children?: ReactNode;
	className?: string;
	facts: readonly [string, ReactNode][];
	failed?: string | null;
	files: readonly string[];
	id: string;
	kind?: ReactNode;
	lanes: readonly StripLane[];
	lead: ReactNode;
	named?: boolean;
	title?: ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex flex-col gap-m",
				"corner-m px-l py-l corner-squircle",
				"text-body-m",
				"bg-surface shadow-card",
				"squircle:corner-xl",
				className,
			)}
		>
			<div className="flex min-w-0 items-center gap-m">
				{named ? (
					<>
						{lead}
						<span className="flex min-w-0 flex-1 items-baseline gap-xs text-body-xl font-medium">
							{kind ? (
								<span className="shrink-0 text-ink-3">{kind}</span>
							) : null}
							<span className="truncate">{id}</span>
						</span>
					</>
				) : (
					<p className="min-w-0 flex-1 truncate text-body-xl">{title}</p>
				)}
				{aside ? (
					<span className="flex shrink-0 items-center gap-s text-ink-3">
						{aside}
					</span>
				) : null}
			</div>
			{named && title ? <p className="truncate text-body-xl">{title}</p> : null}
			{facts.length > 0 || failed || lanes.length > 0 || files.length > 0 ? (
				<div className="flex flex-wrap items-center gap-x-s gap-y-s text-ink-3 tabular-nums">
					{facts.map(([name, fact], index) => (
						<Fragment key={name}>
							{index > 0 ? <FactDot /> : null}
							<span className="inline-flex items-center">{fact}</span>
						</Fragment>
					))}
					{failed ? (
						<>
							<FactDot />
							<span className="inline-flex items-center gap-xxs text-error">
								<IconAlertTriangle aria-hidden="true" className="size-3" />
								{failed}
							</span>
						</>
					) : null}
					{lanes.length > 0 || files.length > 0 ? (
						<span className="ml-l flex flex-wrap items-center gap-x-l gap-y-s">
							{lanes.map((lane) => {
								const Glyph = lane.glyph;
								return (
									<span
										key={lane.key}
										title={`${lane.label}: ${lane.count}`}
										className="inline-flex items-center gap-xs"
									>
										<OpalChip
											tint={lane.tint}
											className="size-4 text-(--opal-tint)"
										>
											<Glyph aria-hidden="true" className="size-2.5" />
										</OpalChip>
										{lane.count}
									</span>
								);
							})}
							{files.length > 0 ? (
								<span title={files.join("\n")}>
									{files.length} {files.length === 1 ? "file" : "files"} changed
								</span>
							) : null}
						</span>
					) : null}
				</div>
			) : null}
			{children}
		</div>
	);
}
