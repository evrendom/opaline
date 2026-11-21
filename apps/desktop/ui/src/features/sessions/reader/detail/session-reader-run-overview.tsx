import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { IconChevronRight } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/app/ui/tooltip";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { shortRunId } from "@/features/sessions/run-id";
import { CopyButton } from "@/features/shell/components/copy-button";
import { formatCompactNumber, formatShare } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isAgentStep } from "../ci/session-reader-run-ci";
import { FileTag } from "../files/session-reader-file-tag";
import {
	flattenSteps,
	formatReaderCost,
	getStepMarks,
	type SessionReaderStep,
	type SessionReaderTurnMark,
	type SessionReaderWaterfall,
} from "../model/session-reader-model";
import { formatDateTime } from "../rail/session-reader-turn-lines";
import { TURN_MARKS } from "../rail/session-reader-turn-marks";
import {
	formatDuration,
	formatSpanDuration,
	OpalChip,
	StepIconChip,
} from "./waterfall/session-reader-waterfall-chips";
import {
	getWaterfallFilterOptions,
	type WaterfallFilterOption,
} from "./waterfall/session-reader-waterfall-rows";

// The inspector's whole-run view: what the run touched, the kinds of step it
// took — each kind a toggle that narrows the waterfall — then its facts as a
// field grid with a token split, and where its time went.

function Field({
	className,
	label,
	value,
}: {
	className?: string;
	label: string;
	value: ReactNode;
}) {
	return (
		<div className={cn("flex min-w-0 flex-col gap-xs", className)}>
			<span className="text-body-m text-ink-3">{label}</span>
			<span className="text-body-l tabular-nums">{value}</span>
		</div>
	);
}

type StripSegment = {
	color?: string;
	label: string;
	swatch?: string;
	value: number;
	/** Bar width when it must differ from the legend value. */
	weight?: number;
};

/**
 * A strip-plus-legend for a proportional breakdown. Hovering a segment
 * or its legend entry dims the rest, which is what makes thin slivers
 * findable. Spans only — it renders inside Field values.
 */
function BreakdownStrip({
	format,
	parts,
	total,
}: {
	format: (value: number) => string;
	parts: readonly StripSegment[];
	/** What the shares are of; defaults to the sum of the parts. */
	total?: number;
}) {
	const [hovered, setHovered] = useState<string | null>(null);
	const sum = parts.reduce((acc, part) => acc + part.value, 0);
	const denom = total ?? sum;
	if (parts.length === 0 || sum <= 0 || denom <= 0) return null;
	const share = (value: number) => formatShare(value / denom);
	return (
		<span className="flex flex-col gap-l">
			<span className="flex h-1 w-full gap-xxs overflow-hidden corner-xs">
				<TooltipProvider>
					{parts.map((part) => (
						<Tooltip key={part.label}>
							<TooltipTrigger
								render={
									// biome-ignore lint/a11y/noStaticElementInteractions: hover only dims the other segments; the tooltip carries the value
									<span
										onMouseEnter={() => setHovered(part.label)}
										onMouseLeave={() => setHovered(null)}
										className={cn(
											"h-full cursor-zoom-in transition-opacity",
											part.swatch,
											hovered !== null &&
												hovered !== part.label &&
												"opacity-25",
										)}
										style={{
											backgroundColor: part.color,
											width: `${((part.weight ?? part.value) / denom) * 100}%`,
										}}
									/>
								}
							/>
							<TooltipContent>
								{part.label}: {format(part.value)} · {share(part.value)}
							</TooltipContent>
						</Tooltip>
					))}
				</TooltipProvider>
			</span>
			<span
				className={cn(
					"flex flex-wrap items-center gap-x-l gap-y-xs",
					"text-body-s tabular-nums",
					"text-ink-3",
				)}
			>
				{parts.map((part) => (
					// biome-ignore lint/a11y/noStaticElementInteractions: hover only dims the other segments, to find thin ones
					<span
						key={part.label}
						onMouseEnter={() => setHovered(part.label)}
						onMouseLeave={() => setHovered(null)}
						className={cn(
							"inline-flex cursor-zoom-in items-center gap-s transition-opacity",
							hovered !== null && hovered !== part.label && "opacity-40",
						)}
					>
						<span
							className={cn("size-2 corner-xs", part.swatch)}
							style={{ backgroundColor: part.color }}
						/>
						{part.label} {format(part.value)}
						{/* design-escape-ok(opacity): no role renders this; text-ink-3/60 */}
						<span className="text-ink-3/60">{share(part.value)}</span>
					</span>
				))}
			</span>
		</span>
	);
}

/** Input (fresh and cache writes), cached input and output, from the run's
 * per-call usage, as one token split. */
function TokenSplit({ turn }: { turn: SessionDetailTurnSummary }) {
	let fresh = 0;
	let cached = 0;
	let output = 0;
	for (const call of turn.usageCalls) {
		fresh += call.freshInputTokens + call.cacheCreationInputTokens;
		cached += call.cacheReadInputTokens;
		output += call.outputTokens;
	}
	return (
		<BreakdownStrip
			format={formatCompactNumber}
			parts={[
				{ color: "#F97316", label: "Input", value: fresh },
				{ color: "#FDBA74", label: "Cached input", value: cached },
				{ color: "#0090FD", label: "Output", value: output },
			].filter((part) => part.value > 0)}
		/>
	);
}

export type Interval = [number, number];

export function unionMs(intervals: readonly Interval[]): number {
	const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
	let total = 0;
	let current: Interval | undefined;
	for (const [start, end] of sorted) {
		if (!current || start > current[1]) {
			if (current) total += current[1] - current[0];
			current = [start, end];
		} else {
			current[1] = Math.max(current[1], end);
		}
	}
	return current ? total + (current[1] - current[0]) : total;
}

/**
 * Where the run's wall-clock went: the model thinking and writing, tools
 * running, and waiting on neither. Interval unions keep parallel calls from
 * counting twice; where categories overlap, their widths scale to fit so the
 * strip always spans the run (the legend keeps the exact unions).
 */
function TimeDistribution({
	steps,
	totalMs,
}: {
	steps: readonly SessionReaderStep[];
	totalMs: number;
}) {
	const buckets: Record<
		"compacting" | "thinking" | "tools" | "writing" | "you",
		Interval[]
	> = { compacting: [], thinking: [], tools: [], writing: [], you: [] };
	for (const step of steps) {
		if (step.endMs <= step.startMs) continue;
		const key = step.waitsOnYou
			? "you"
			: step.harness === "compaction"
				? "compacting"
				: step.kind === "thinking"
					? "thinking"
					: step.kind === "message"
						? "writing"
						: "tools";
		const from =
			key === "tools"
				? (step.writtenUntilMs ?? step.queuedUntilMs ?? step.startMs)
				: step.startMs;
		if (step.endMs > from) buckets[key].push([from, step.endMs]);
		if (step.writtenUntilMs !== undefined)
			buckets.writing.push([step.startMs, step.writtenUntilMs]);
	}
	const thinking = unionMs(buckets.thinking);
	const writing = unionMs(buckets.writing);
	const tools = unionMs(buckets.tools);
	const you = unionMs(buckets.you);
	const compacting = unionMs(buckets.compacting);
	const covered = unionMs([
		...buckets.thinking,
		...buckets.writing,
		...buckets.tools,
		...buckets.you,
		...buckets.compacting,
	]);
	const sum = thinking + writing + tools + you + compacting;
	const fit = sum > covered && sum > 0 ? covered / sum : 1;
	return (
		<BreakdownStrip
			format={formatDuration}
			total={totalMs}
			parts={[
				{ label: "Thinking", swatch: "bg-violet-500", value: thinking },
				{ label: "Writing", swatch: "bg-violet-300", value: writing },
				{ label: "Tools", swatch: "bg-blue-500", value: tools },
				{ label: "Waiting on you", swatch: "bg-amber-400", value: you },
				{ label: "Compacting", swatch: "bg-green-500", value: compacting },
				{
					label: "Waiting",
					swatch: "bg-hover-strong",
					value: Math.max(0, totalMs - covered),
				},
			]
				.filter((part) => part.value > 0)
				.map((part) => ({
					...part,
					weight: part.label === "Waiting" ? part.value : part.value * fit,
				}))}
		/>
	);
}

/** Tags shown per group before "+N more". */
const TAG_LIMIT = 12;

/** What the run touched: the skills it used, then the files it added, edited
 * and removed — each group under its mark, every item a tag. */
function Touched({ marks }: { marks: readonly SessionReaderTurnMark[] }) {
	return (
		<div className="flex flex-col gap-xl">
			{marks.map((mark) => {
				const { className, Icon, label, tint } = TURN_MARKS[mark.kind];
				const shown = mark.items.slice(0, TAG_LIMIT);
				const hidden = mark.items.slice(TAG_LIMIT);
				return (
					<div key={mark.kind} className="flex min-w-0 flex-col gap-m">
						<span className="flex items-center gap-s text-body-m text-ink-3">
							<Icon aria-hidden="true" className={cn("size-3.5", className)} />
							{label}
							{/* design-escape-ok(opacity): no role renders this; text-ink-3/60 */}
							<span className="text-ink-3/60 tabular-nums">
								{mark.items.length}
							</span>
						</span>
						<ul className="flex flex-wrap gap-s">
							{shown.map((item) => (
								<li key={item} className="flex min-w-0 max-w-full">
									{mark.kind === "skill" ? (
										<span
											title={item}
											className={cn(
												"inline-flex h-6 max-w-full min-w-0 items-center gap-s",
												"corner-full pr-l pl-xs",
												"bg-canvas shadow-control",
												"dark:bg-card",
											)}
										>
											<OpalChip tint={tint} className={cn("size-4", className)}>
												<Icon aria-hidden="true" className="size-2.5" />
											</OpalChip>
											<span className="truncate text-body-m">{item}</span>
										</span>
									) : (
										<FileTag path={item} />
									)}
								</li>
							))}
							{hidden.length > 0 ? (
								<li
									title={hidden.join("\n")}
									className="flex h-6 items-center px-xs text-body-m text-ink-3 tabular-nums"
								>
									+{hidden.length} more
								</li>
							) : null}
						</ul>
					</div>
				);
			})}
		</div>
	);
}

/**
 * The kinds of step the run took — each tool and subagent, thinking, writing
 * — with how often, most used first. Each
 * is a toggle: picking any narrows the waterfall to those kinds.
 */
function StepKinds({
	filter,
	onToggle,
	options,
}: {
	filter: ReadonlySet<string>;
	onToggle: (key: string) => void;
	options: readonly WaterfallFilterOption[];
}) {
	const [open, setOpen] = useState(true);
	return (
		<div className={cn("flex flex-col", open && "gap-l")}>
			<div className="flex items-center justify-between">
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen((value) => !value)}
					className="flex items-center gap-xs text-body-m text-ink-3 focus-outline hover:text-ink"
				>
					<IconChevronRight
						aria-hidden="true"
						className={cn("size-3.5 transition-transform", open && "rotate-90")}
					/>
					Steps · {options.length} {options.length === 1 ? "kind" : "kinds"}
				</button>
				{filter.size > 0 ? (
					<button
						type="button"
						onClick={() => {
							for (const key of filter) onToggle(key);
						}}
						className="text-body-m text-ink-3 focus-outline hover:text-ink"
					>
						Show all
					</button>
				) : null}
			</div>
			{open ? (
				<div className="-mx-m flex flex-col">
					{options.map((option) => {
						const on = filter.has(option.key);
						const dimmed = filter.size > 0 && !on;
						return (
							<button
								key={option.key}
								type="button"
								aria-pressed={on}
								onClick={() => onToggle(option.key)}
								title={on ? "Show every step" : `Show only ${option.key}`}
								className={cn(
									"flex w-full items-center gap-m",
									"corner-s px-m py-xs",
									"text-left focus-outline",
									// design-escape-ok(opacity): no role renders this; dark:hover:bg-hover/50
									"hover:bg-hover dark:hover:bg-hover/50",
									on && "bg-hover dark:bg-hover",
								)}
							>
								<StepIconChip step={option.sample} />
								<span
									className={cn(
										"min-w-0 truncate text-body-m",
										dimmed && "text-ink-3",
									)}
								>
									{option.key}
								</span>
								<span className="ml-auto shrink-0 text-body-s tabular-nums">
									×{option.count}
								</span>
								{option.errorCount > 0 ? (
									<span className="shrink-0 text-body-s text-rose-ink tabular-nums">
										{option.errorCount} failed
									</span>
								) : null}
							</button>
						);
					})}
				</div>
			) : null}
		</div>
	);
}

/** The whole run's overview: what it touched and the
 * steps it took, then its facts, tokens and time. Scoped to a subagent's
 * call, what that subagent touched, the steps it took and where its time went
 * — its call's own facts show above, and the turn doesn't split cost or
 * tokens by subagent. */
export function RunOverview({
	filter,
	filterOptions,
	marks,
	onToggleFilter,
	scope,
	turn,
	waterfall,
}: {
	filter: ReadonlySet<string>;
	filterOptions: readonly WaterfallFilterOption[];
	marks: readonly SessionReaderTurnMark[];
	onToggleFilter: (key: string) => void;
	/** A subagent's call, to show what it did instead of the whole run. */
	scope?: SessionReaderStep;
	turn: SessionDetailTurnSummary;
	waterfall: SessionReaderWaterfall;
}) {
	const steps = (
		scope ? flattenSteps(scope.children) : waterfall.allSteps
	).filter(isAgentStep);
	const totalMs = scope
		? scope.endMs - scope.startMs
		: waterfall.endMs - waterfall.startMs;
	const options = scope ? getWaterfallFilterOptions(steps) : filterOptions;
	const touched = scope ? getStepMarks(steps) : marks;
	const tokens = (turn.inputTokens ?? 0) + (turn.outputTokens ?? 0);
	return (
		<>
			{touched.length > 0 ? (
				<div className="edge-b-m border-line-soft px-xxl pb-xxl">
					<Touched marks={touched} />
				</div>
			) : null}

			<div className="edge-b-m border-line-soft px-xxl pb-xxl">
				<StepKinds
					filter={filter}
					onToggle={onToggleFilter}
					options={options}
				/>
			</div>

			{/* Evens left, odds right: time down the left, identity and money
			    down the right. A subagent's call has its own facts above. */}
			{scope ? null : (
				<div
					className={cn(
						"grid grid-cols-2 gap-xl px-xxl",
						totalMs > 0 && "edge-b-m border-line-soft pb-xxl",
					)}
				>
					<Field label="Started" value={formatDateTime(turn.startedAt)} />
					<Field
						label="Model"
						value={
							waterfall.model ? formatModelDisplayLabel(waterfall.model) : "—"
						}
					/>
					<Field label="Duration" value={formatSpanDuration(totalMs)} />
					<Field label="Cost" value={formatReaderCost(turn.estimatedCost)} />
					<Field
						label="Run ID"
						className="col-span-2"
						value={
							<span className="flex items-center gap-xs">
								<span title={turn.turnId}>{shortRunId(turn.turnId)}</span>
								<CopyButton value={turn.turnId} title="Copy run ID" />
							</span>
						}
					/>
					<Field
						label="Tokens"
						className="col-span-2 edge-t-m border-line-soft pt-xl"
						value={
							<span className="flex flex-col gap-m">
								{formatCompactNumber(tokens)}
								<TokenSplit turn={turn} />
							</span>
						}
					/>
				</div>
			)}

			{totalMs > 0 ? (
				<div className="flex flex-col gap-l px-xxl">
					<Field
						label="Time distribution"
						value={formatSpanDuration(totalMs)}
					/>
					<TimeDistribution steps={steps} totalMs={totalMs} />
				</div>
			) : null}
		</>
	);
}
