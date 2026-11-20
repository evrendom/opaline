import {
	IconAlertTriangle,
	IconCircleCheckFilled,
	IconMessage,
	IconRocket,
} from "@tabler/icons-react";
import { type CSSProperties, memo } from "react";
import { cn } from "@/lib/utils";
import type { SessionReaderStep } from "../../model/session-reader-model";
import { railTagKeysOf } from "../../model/session-reader-step-lanes";
import { subagentTalkedTo } from "../../subagents/session-reader-subagent-done";
import {
	type SubagentRole,
	useSubagentRole,
	useSubagentTint,
} from "../../subagents/session-reader-subagent-tints";
import { SentMessage } from "../session-reader-sent-message";
import {
	ChipToggle,
	formatSpanDuration,
	StepIconChip,
	stepTint,
	toggleFocus,
} from "./session-reader-waterfall-chips";
import {
	barGeometry,
	GRID,
	GRID_UNTIMED,
	INDENT,
	MESSAGE_INDENT,
	ROW,
	rowState,
	solidSpan,
} from "./session-reader-waterfall-layout";
import { isToolStep } from "./session-reader-waterfall-rows";
import {
	ProgressBar,
	RanOnChip,
	RowTotals,
	RunningBar,
	TrackLabel,
} from "./session-reader-waterfall-track";

const DASHED =
	"[mask-image:repeating-linear-gradient(to_right,#000_0_4px,transparent_4px_7px)]";

function SubagentRoleMark({ role }: { role: SubagentRole }) {
	const { Icon, className, label } = {
		finish: {
			className: "text-emerald-500",
			Icon: IconCircleCheckFilled,
			label: "Finished",
		},
		launch: {
			className: "text-ink-3",
			Icon: IconRocket,
			label: "Launched",
		},
		message: {
			className: "text-ink-3",
			Icon: IconMessage,
			label: "Message",
		},
	}[role];
	return (
		<Icon
			role="img"
			aria-label={label}
			className={cn("size-3.5 shrink-0", className)}
		/>
	);
}

export const StepRowView = memo(function StepRowView({
	depth,
	model,
	onSelect,
	onToggleSubtrace: onToggleKey,
	selected,
	startMs,
	step,
	subtraceKey,
	subtraceOpen,
	total,
	totals = true,
}: {
	depth: number;
	model: string | null;
	onSelect: (stepId: string) => void;
	onToggleSubtrace: (key: string) => void;
	selected: boolean;
	startMs: number;
	step: SessionReaderStep;
	subtraceKey?: string;
	subtraceOpen?: boolean;
	total: number;
	totals?: boolean;
}) {
	const onToggleSubtrace =
		subtraceKey === undefined ? undefined : () => onToggleKey(subtraceKey);
	const subagent = step.kind === "agent";
	const durationMs = Math.max(step.endMs - step.startMs, 0);
	const waitedMs =
		step.backgroundFromMs === undefined && step.queuedUntilMs !== undefined
			? Math.max(Math.min(step.queuedUntilMs, step.endMs) - step.startMs, 0)
			: 0;
	const ranMs = durationMs - waitedMs;
	const { offset, width } = barGeometry(
		step.startMs + waitedMs,
		subagent ? (step.backgroundFromMs ?? step.startMs) : step.endMs,
		startMs,
		total,
	);
	const subagentTint = useSubagentTint(step);
	const subagentRole = useSubagentRole(step);
	const bar = step.isError
		? { className: "bg-rose-500" }
		: { style: { backgroundColor: subagentTint ?? stepTint(step) } };
	const timed = isToolStep(step) || step.kind === "ci" || durationMs > 0;
	const running = subagent ? null : solidSpan(step, startMs, total);
	const ranOnMs = step.endMs - (startMs + total);
	const runsOn = ranOnMs >= 1_000;
	const bars = (
		<>
			{onToggleSubtrace && !subagent ? (
				<ProgressBar
					baseClassName={bar.className}
					baseStyle={bar.style}
					fillClassName={bar.className}
					fillStyle={bar.style}
					left={offset}
					width={width}
				/>
			) : (
				<div
					data-left={offset}
					data-mark=""
					data-width={width}
					className={cn(
						"absolute top-1/2 min-w-0.5 -translate-y-1/2 rounded-xs",
						bar.className,
						runsOn && !subagent ? `h-0.5 ${DASHED}` : "h-2",
						running && !runsOn && "opacity-35",
					)}
					style={{
						...bar.style,
						left: `${offset}%`,
						width: `${width}%`,
					}}
				/>
			)}
			{running ? <RunningBar bar={bar} span={running} /> : null}
		</>
	);
	if (depth === 1 && step.toolEvent?.toolName === "SendMessage") {
		return (
			<div
				data-active-row={selected ? "" : undefined}
				data-step-row={step.id}
				data-start-ms={step.startMs}
				data-step-failed={step.isError ? "" : undefined}
				data-talks-to={subagentTalkedTo(step) ?? undefined}
				className={cn(
					"relative -my-0.5 bg-(--dashboard-01-content-background,var(--canvas)) py-0.5",
					MESSAGE_INDENT,
				)}
				style={{ "--depth": depth } as CSSProperties}
			>
				<SentMessage
					model={model}
					onSelect={() => onSelect(step.id)}
					selected={selected}
					step={step}
					tint={subagentTint}
				/>
			</div>
		);
	}
	return (
		<div
			data-active-row={selected ? "" : undefined}
			data-step-row={step.id}
			data-start-ms={step.startMs}
			data-step-failed={step.isError ? "" : undefined}
			data-step-tags={railTagKeysOf(step).join(" ") || undefined}
			data-talks-to={subagentTalkedTo(step) ?? undefined}
			className={cn(
				"relative rounded-md",
				onToggleSubtrace && "group/toggle",
				rowState(selected),
				step.ci?.dimmed && "opacity-60",
			)}
			{...(onToggleSubtrace ? toggleFocus : {})}
		>
			<button
				type="button"
				onClick={() => {
					if (onToggleSubtrace && selected) onToggleSubtrace();
					else onSelect(step.id);
				}}
				className={cn(totals ? GRID : GRID_UNTIMED, ROW, "group/steprow")}
			>
				<div
					className={cn("flex min-w-0 items-center gap-2 pr-3", INDENT)}
					style={{ "--depth": depth } as CSSProperties}
				>
					<StepIconChip
						open={onToggleSubtrace ? subtraceOpen === true : undefined}
						step={step}
						tip={false}
					/>
					<div className="flex min-w-0 items-center gap-1.5">
						<span className="truncate">
							{subagentRole ? "Subagent" : step.name}
						</span>
						{subagentRole ? <SubagentRoleMark role={subagentRole} /> : null}
						{step.isError ? (
							<span
								role="img"
								aria-label="Error"
								className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"
							>
								<IconAlertTriangle aria-hidden="true" className="size-3" />
							</span>
						) : null}
					</div>
				</div>
				<div className="relative h-5">
					{bars}
					{runsOn && !subagent ? <RanOnChip ms={ranOnMs} /> : null}
					{totals && step.command && step.command.chain !== step.name ? (
						<TrackLabel
							offset={offset}
							text={step.command.chain}
							width={width}
						/>
					) : null}
					{!totals && timed ? (
						<TrackLabel
							className={
								selected
									? undefined
									: "opacity-0 group-hover/steprow:opacity-100 group-focus-visible/steprow:opacity-100"
							}
							offset={offset}
							text={formatSpanDuration(ranMs)}
							width={width}
						/>
					) : null}
				</div>
				{totals ? (
					<RowTotals cost={null} durationMs={timed ? ranMs : null} tokens={0} />
				) : null}
			</button>
			{onToggleSubtrace ? (
				<ChipToggle
					className={INDENT}
					label={`${step.name}'s steps`}
					onToggle={onToggleSubtrace}
					open={subtraceOpen === true}
					style={{ "--depth": depth } as CSSProperties}
				/>
			) : null}
		</div>
	);
});
