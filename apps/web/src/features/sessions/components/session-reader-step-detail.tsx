import { getRawToolInput } from "@rudel/api-routes";
import {
	IconAlertTriangleFilled,
	IconChevronRight,
	IconCircleCheckFilled,
	IconRoute,
} from "@tabler/icons-react";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/app/ui/button";
import { MessageContent } from "@/components/conversation/MessageContent";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { shortStepId } from "@/features/sessions/run-id";
import { CopyButton } from "@/features/shell/components/copy-button";
import { formatCompactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
	SessionReaderStep,
	SessionReaderWaterfall,
} from "./session-reader-model";
import { RunOverview } from "./session-reader-run-overview";
import {
	getToolResultView,
	HighlightedCode,
	ToolArguments,
} from "./session-reader-step-payloads";
import {
	formatDuration,
	formatSpanDuration,
	OpalChip,
	StepIconChip,
} from "./session-reader-waterfall-chips";

// The inspector beside the turn waterfall: the selected step's facts as a
// field grid, then its payloads. The whole turn is the default target.

const clockFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
	second: "2-digit",
});

type FieldSpec = { label: string; value: ReactNode; wide?: boolean };

function Field({ label, value, wide }: FieldSpec) {
	return (
		<div className={cn("flex min-w-0 flex-col gap-1", wide && "col-span-2")}>
			<span className="text-xs text-muted-foreground">{label}</span>
			<span className="text-[13px] tabular-nums [overflow-wrap:anywhere]">
				{value}
			</span>
		</div>
	);
}

function StartedField(atMs: number, turnStartMs: number): FieldSpec {
	return {
		label: "Started",
		value: (
			<span>
				+{formatDuration(atMs - turnStartMs)}{" "}
				<span className="text-muted-foreground">
					{clockFormatter.format(atMs)}
				</span>
			</span>
		),
	};
}

/** The step's own id, short, with the whole id to copy. */
function IdField(step: SessionReaderStep): FieldSpec[] {
	if (!step.nativeId) return [];
	return [
		{
			label: "ID",
			value: (
				<span className="flex items-center gap-1">
					<span title={step.nativeId}>{shortStepId(step.nativeId)}</span>
					<CopyButton value={step.nativeId} title="Copy ID" />
				</span>
			),
		},
	];
}

function stepFields(
	step: SessionReaderStep,
	waterfall: SessionReaderWaterfall,
): FieldSpec[] {
	const durationMs = step.endMs - step.startMs;
	const isTool = step.kind === "agent" || step.kind === "tool";
	const fields: FieldSpec[] = [
		StartedField(step.startMs, waterfall.startMs),
		{
			label: "Duration",
			value: isTool || durationMs > 0 ? formatSpanDuration(durationMs) : "—",
		},
	];
	if (isTool) {
		fields.push(
			{
				label: step.kind === "agent" ? "Subagent" : "Tool",
				value: <span className="font-mono text-xs">{step.name}</span>,
			},
			...(step.kind === "agent"
				? [
						{
							label: "Model",
							value: step.model ? formatModelDisplayLabel(step.model) : "—",
						},
					]
				: []),
			{
				label: "Status",
				value: step.isError
					? "Failed"
					: step.result === null
						? "No result"
						: "Succeeded",
			},
			...IdField(step),
		);
		if (step.detail) {
			fields.push({
				label: step.kind === "agent" ? "Task" : "Target",
				value: step.detail,
				wide: true,
			});
		}
		return fields;
	}
	if (step.kind === "message" && waterfall.model) {
		fields.push({
			label: "Model",
			value: formatModelDisplayLabel(waterfall.model),
		});
	}
	fields.push(
		{
			label: "Length",
			value: `${formatCompactNumber(step.text?.length ?? 0)} chars`,
		},
		...IdField(step),
	);
	return fields;
}

/** Payloads past this render clipped until asked, so a huge tool result
 * doesn't stall the panel. */
const PAYLOAD_PREVIEW_CHARS = 20_000;

function sizeHint(value: string): string {
	return value.length >= 1024
		? `${(value.length / 1024).toFixed(1)} KB`
		: `${value.length} chars`;
}

/** A payload section: a toggle with the payload's size, a copy button beside
 * it, and the text in a scrolling block. JSON pretty-prints; prose wraps. */
type Payload = {
	/** Laid-out content in place of the text box (the text still copies). */
	body?: ReactNode;
	label: string;
	/** Highlight the text as this language. */
	language?: string;
	prose?: boolean;
	/** With `language`, number the lines from here. */
	startLine?: number;
	value: string;
};

function Transcript({
	body,
	className,
	label,
	language,
	prose = false,
	startLine,
	value,
}: Payload & { className?: string }) {
	const [open, setOpen] = useState(true);
	const [full, setFull] = useState(false);
	const clipped = !full && value.length > PAYLOAD_PREVIEW_CHARS;
	return (
		<div className={cn("flex flex-col gap-2 px-5", className)}>
			<div className="flex items-center justify-between">
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen((value) => !value)}
					className="flex min-w-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
				>
					<IconChevronRight
						aria-hidden="true"
						className={cn("size-3 transition-transform", open && "rotate-90")}
					/>
					{label}
					<span className="text-muted-foreground/60 tabular-nums">
						{sizeHint(value)}
					</span>
				</button>
				<CopyButton value={value} title={`Copy ${label.toLowerCase()}`} />
			</div>
			{open && body ? body : null}
			{open && !body && language ? (
				<HighlightedCode
					code={clipped ? value.slice(0, PAYLOAD_PREVIEW_CHARS) : value}
					language={language}
					startLine={startLine}
				/>
			) : null}
			{open && !body && !language ? (
				// No scroll box of its own: the panel is the one scroll area, so
				// the wheel never gets stuck inside a payload.
				<pre
					className={cn(
						"rounded-md bg-muted p-3 whitespace-pre-wrap [overflow-wrap:anywhere]",
						prose ? "font-sans text-[13px] leading-relaxed" : "text-xs",
					)}
				>
					{clipped ? `${value.slice(0, PAYLOAD_PREVIEW_CHARS)}…` : value}
				</pre>
			) : null}
			{open && !body && clipped ? (
				<button
					type="button"
					onClick={() => setFull(true)}
					className="w-fit cursor-pointer text-xs text-muted-foreground hover:text-foreground"
				>
					Show all {sizeHint(value)}
				</button>
			) : null}
		</div>
	);
}

function stepPayloads(step: SessionReaderStep): Payload[] {
	if (step.kind === "thinking") {
		return step.text
			? [{ label: "Thinking", prose: true, value: step.text }]
			: [];
	}
	if (step.kind === "message") {
		return step.text
			? [
					{
						body: (
							<div className="text-[13px] leading-relaxed">
								<MessageContent content={step.text} />
							</div>
						),
						label: "Output",
						value: step.text,
					},
				]
			: [];
	}
	const event = step.toolEvent;
	if (!event) return [];
	const payloads: Payload[] = [];
	const input = getRawToolInput(event.input);
	if (Object.keys(input).length > 0) {
		payloads.push({
			body: <ToolArguments event={event} />,
			label: "Arguments",
			value: JSON.stringify(input, null, 2),
		});
	}
	if (step.result) {
		const view = getToolResultView(event, step.result);
		payloads.push({
			label: "Result",
			language: view.language,
			startLine: view.startLine,
			value: view.text,
		});
	}
	return payloads;
}

export function SessionReaderStepDetail({
	fill = false,
	fit = false,
	run,
	step,
	waterfall,
}: {
	/** Always reach the bottom of the view, wherever the panel sits — not
	 * only beside a run page's waterfall. */
	fill?: boolean;
	/** Fill the box it's placed in, scrolling inside, instead of sticking
	 * beside a waterfall at the view's height. */
	fit?: boolean;
	/** The whole run's view: its summary, what it touched, and the step-kind
	 * filter its list drives. */
	run: Omit<Parameters<typeof RunOverview>[0], "waterfall">;
	/** Null when the whole run is selected. */
	step: SessionReaderStep | null;
	waterfall: SessionReaderWaterfall;
}) {
	// Overview is curated; Raw is the complete step. Keyed on the selection so
	// stepping to another step lands back on Overview.
	const [rawFor, setRawFor] = useState<string | null>(null);
	const selectionKey = step?.id ?? "turn";
	const raw = rawFor === selectionKey;
	const rawValue = useMemo(
		() => JSON.stringify(step ?? waterfall, null, 2),
		[step, waterfall],
	);
	// A subagent's call: its own facts, then what the subagent did, read like
	// the whole run.
	const subagent = step && step.children.length > 0 ? step : undefined;
	const fields = step ? stepFields(step, waterfall) : [];
	const payloads = step ? stepPayloads(step) : [];
	const isTool = step?.kind === "agent" || step?.kind === "tool";

	return (
		<aside
			className={
				fit
					? "flex min-h-0 w-full flex-1 flex-col"
					: "sticky top-4 w-full shrink-0 self-start @3xl/steps:w-[var(--inspector-width,380px)]"
			}
		>
			{/* Stuck, it always reaches down to the reader's bottom edge (its
			    16px top offset mirrored below) and scrolls inside when its
			    content runs longer. Below the waterfall it only grows to fit. */}
			<div
				className={cn(
					"flex flex-col overflow-hidden rounded-lg bg-card shadow-(--custom-shadow) corner-squircle squircle:rounded-3xl dark:bg-muted-foreground/10",
					fit
						? "min-h-0 flex-1"
						: "max-h-[calc(100cqh-2rem)] @3xl/steps:h-[calc(100cqh-2rem)]",
					fill && !fit && "h-[calc(100cqh-2rem)]",
				)}
			>
				<div className="flex shrink-0 items-center gap-2 px-5 pt-5 pb-1">
					<div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
						{step ? (
							<StepIconChip model={waterfall.model} step={step} />
						) : (
							<OpalChip sidebar="active">
								<IconRoute aria-hidden="true" className="size-3" />
							</OpalChip>
						)}
						<span className={cn("truncate", isTool && "font-mono text-[13px]")}>
							{step?.name ?? "Reasoning Trace"}
						</span>
						{isTool ? (
							step?.isError ? (
								<IconAlertTriangleFilled
									aria-label="Failed"
									className="size-3.5 shrink-0 text-rose-500"
								/>
							) : step?.result !== null ? (
								<IconCircleCheckFilled
									aria-label="Succeeded"
									className="size-3.5 shrink-0 text-emerald-500"
								/>
							) : null
						) : null}
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<Button
							type="button"
							size="xs"
							variant="ghost"
							className="text-muted-foreground/60 hover:text-foreground"
							onClick={() => setRawFor(raw ? null : selectionKey)}
						>
							{raw ? "Overview" : "Raw"}
						</Button>
					</div>
				</div>

				{/* Sections keep their full height (shrink-0) and this scrolls,
				    rather than flexbox squeezing them to fit. */}
				<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-5 *:shrink-0">
					{raw ? (
						<Transcript label="Raw" value={rawValue} />
					) : (
						<>
							{step?.isError && step.result ? (
								<div className="mx-5 flex flex-col gap-1 rounded-lg bg-destructive/20 px-3 py-2.5 text-sm text-destructive corner-squircle">
									<span className="flex items-center gap-1.5 font-medium">
										<IconAlertTriangleFilled className="size-3.5 shrink-0" />
										Error
									</span>
									<span className="line-clamp-6 min-w-0 [overflow-wrap:anywhere]">
										{step.result}
									</span>
								</div>
							) : null}
							{step ? (
								<div
									className={cn(
										"grid grid-cols-2 gap-4 px-5",
										(subagent || payloads.length > 0) &&
											"border-b border-border/40 pb-5",
									)}
								>
									{fields.map((field) => (
										<Field key={field.label} {...field} />
									))}
								</div>
							) : null}
							{!step || subagent ? (
								<div
									className={cn(
										"flex flex-col gap-4",
										subagent &&
											payloads.length > 0 &&
											"border-b border-border/40 pb-5",
									)}
								>
									<RunOverview
										{...run}
										scope={subagent}
										waterfall={waterfall}
									/>
								</div>
							) : null}
							{payloads.map((payload, index) => (
								<Transcript
									key={`${selectionKey}:${payload.label}`}
									className={cn(
										index < payloads.length - 1 &&
											"border-b border-border/40 pb-5",
									)}
									{...payload}
								/>
							))}
						</>
					)}
				</div>
			</div>
		</aside>
	);
}

/** What a step detail panel shows, for one held apart from its waterfall. */
export type SessionReaderStepSelection = Pick<
	Parameters<typeof SessionReaderStepDetail>[0],
	"run" | "step" | "waterfall"
>;
