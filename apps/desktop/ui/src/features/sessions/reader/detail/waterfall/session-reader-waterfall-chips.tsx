import { agentColor } from "@rudel/api-routes/skill-icon";
import {
	IconBan,
	IconBrandGithub,
	IconCheck,
	IconChevronRight,
	IconClock,
	IconPlayerSkipForward,
	IconProgress,
	IconSparkles,
	IconX,
} from "@tabler/icons-react";
import type {
	ComponentProps,
	CSSProperties,
	FocusEvent,
	ReactElement,
	ReactNode,
} from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/ui/tooltip";
import { getModelIconComponent } from "@/components/conversation/conversation-trace-model-icon";
import {
	getModelBadgeTone,
	getModelBrandChip,
} from "@/features/dashboard/components/dashboard-model-brand";
import {
	OpalineShape,
	restingChipClassName,
	restingGlyphClassName,
} from "@/features/shell/components/shell-nav-icon";
import { sessionsTone } from "@/features/shell/config/shell-routes";
import { formatHalfHours } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SessionReaderStep } from "../../model/session-reader-model";
import {
	type LaneStep,
	stepLaneLook,
} from "../../model/session-reader-step-lanes";
import { useSubagentTint } from "../../subagents/session-reader-subagent-tints";
import { LayerTip, useTipLayer } from "./session-reader-tips";

const CI_STANDARD = {
	bar: "bg-zinc-400",
	text: "text-zinc-600 dark:text-zinc-400",
	tint: "var(--color-zinc-400)",
};

function ciTone(ci: SessionReaderStep["ci"]): {
	bar: string;
	text: string;
	tint: string;
} {
	const conclusion =
		ci === undefined || ci.kind === "group"
			? undefined
			: ci.kind === "job"
				? ci.job.conclusion
				: ci.run.conclusion;
	if (conclusion === undefined)
		return {
			bar: "bg-muted-foreground/40",
			text: "text-muted-foreground",
			tint: "var(--muted-foreground)",
		};
	if (conclusion === "success" || conclusion === null) return CI_STANDARD;
	if (
		conclusion === "failure" ||
		conclusion === "timed_out" ||
		conclusion === "startup_failure"
	)
		return {
			bar: "bg-rose-500",
			text: "text-rose-600 dark:text-rose-400",
			tint: "var(--color-rose-500)",
		};
	return {
		bar: "bg-neutral-400 dark:bg-neutral-500",
		text: "text-neutral-500 dark:text-neutral-400",
		tint: "var(--color-neutral-400)",
	};
}

function ciJobGlyph(ci: Extract<SessionReaderStep["ci"], { kind: "job" }>) {
	const { conclusion, status } = ci.job;
	if (conclusion === "success") return IconCheck;
	if (conclusion === "skipped") return IconPlayerSkipForward;
	if (conclusion === "cancelled") return IconBan;
	if (conclusion !== null) return IconX;
	return status === "queued" ? IconClock : IconProgress;
}

function modelAccent(model: string | null): string | null {
	const icon = model ? getModelBadgeTone(model).icon : null;
	if (icon === "claude") return "#CC7D5E";
	if (icon === "codex") return "var(--foreground)";
	if (icon === "gemini") return "#3C7BFF";
	return null;
}

export function Tip({
	children,
	label,
	side,
}: {
	children: ReactElement;
	label: ReactNode;
	side?: ComponentProps<typeof TooltipContent>["side"];
}) {
	const labels = useTipLayer();
	if (labels)
		return (
			<LayerTip label={label} labels={labels} side={side}>
				{children}
			</LayerTip>
		);
	return (
		<Tooltip>
			<TooltipTrigger render={children} />
			<TooltipContent side={side}>{label}</TooltipContent>
		</Tooltip>
	);
}

export const toggleFocus = {
	onBlur: (event: FocusEvent<HTMLElement>) =>
		event.currentTarget.removeAttribute("data-toggle-focus"),
	onFocus: (event: FocusEvent<HTMLElement>) =>
		event.currentTarget.toggleAttribute(
			"data-toggle-focus",
			event.target.matches(":focus-visible"),
		),
};

export function OpalChip({
	children,
	className,
	open,
	sidebar,
	solid = false,
	tint,
	title,
}: {
	children: ReactNode;
	className?: string;
	open?: boolean;
	sidebar?: "active" | "resting";
	solid?: boolean;
	tint?: string;
	title?: string;
}) {
	const tone = sessionsTone;
	const chip = (
		<span
			skullet-block=""
			className={cn(
				"rounded-full",
				sidebar
					? cn(
							"relative grid size-4.5 shrink-0 place-items-center transition-colors duration-100 ease-in-out",
							sidebar === "active" ? tone.glyph : restingGlyphClassName,
						)
					: "relative grid size-4.5 shrink-0 place-items-center [--opal-fill:color-mix(in_oklab,var(--opal-tint)_15%,transparent)] [--opal-ring:color-mix(in_oklab,var(--opal-tint)_14%,transparent)] drop-shadow-[0_2px_3px_color-mix(in_oklab,var(--opal-tint)_25%,transparent)] dark:[--opal-ring:rgb(255_255_255/0.08)] dark:drop-shadow-[0_1px_2px_rgb(0_0_0/0.24)]",
				solid &&
					"[--opal-fill:color-mix(in_oklab,var(--opal-tint)_15%,var(--dashboard-01-content-background,var(--background)))]",
				className,
			)}
			style={{ "--opal-tint": tint } as CSSProperties}
		>
			{sidebar ? (
				<>
					<OpalineShape
						className={cn("absolute inset-0", restingChipClassName)}
					/>
					<OpalineShape
						className={cn(
							"absolute inset-0 transition-opacity duration-100 ease-in-out",
							tone.chip,
							sidebar === "active" ? "opacity-100" : "opacity-0",
						)}
					/>
				</>
			) : (
				<OpalineShape className="absolute inset-0" />
			)}
			{open === undefined ? (
				<span className="relative flex">{children}</span>
			) : (
				<span className="relative grid place-items-center *:col-start-1 *:row-start-1 *:transition-[opacity,rotate,scale] *:duration-150 *:ease-out">
					<span
						className={cn(
							"flex",
							open
								? "scale-50 opacity-0"
								: "group-hover/toggle:scale-50 group-hover/toggle:opacity-0 group-focus-visible/toggle:scale-50 group-focus-visible/toggle:opacity-0 group-data-[toggle-focus]/toggle:scale-50 group-data-[toggle-focus]/toggle:opacity-0",
						)}
					>
						{children}
					</span>
					<IconChevronRight
						aria-hidden="true"
						className={cn(
							"size-3",
							open
								? "rotate-90"
								: "scale-50 opacity-0 group-hover/toggle:scale-100 group-hover/toggle:opacity-100 group-focus-visible/toggle:scale-100 group-focus-visible/toggle:opacity-100 group-data-[toggle-focus]/toggle:scale-100 group-data-[toggle-focus]/toggle:opacity-100",
						)}
					/>
				</span>
			)}
		</span>
	);
	return title ? <Tip label={title}>{chip}</Tip> : chip;
}

const SLATE = "var(--color-slate-500)";

export function ModelChip({
	chip,
	glyph = "size-3",
	model,
	open,
	solid,
	tip = true,
}: {
	chip?: string;
	glyph?: string;
	model: string | null | undefined;
	open?: boolean;
	solid?: boolean;
	tip?: boolean;
}) {
	const ModelIcon = getModelIconComponent(model ?? undefined);
	const brand = getModelBrandChip(model ?? undefined);
	return (
		<OpalChip
			open={open}
			solid={solid}
			tint={brand?.tint ?? SLATE}
			title={tip ? (model ?? "model") : undefined}
			className={cn(
				brand?.glyphClassName ?? "text-violet-600 dark:text-violet-400",
				chip,
			)}
		>
			{ModelIcon ? (
				<ModelIcon className={glyph} />
			) : (
				<IconSparkles aria-hidden="true" className={glyph} />
			)}
		</OpalChip>
	);
}

export function StepIconChip({
	open,
	size = "md",
	step,
	tip = true,
}: {
	open?: boolean;
	tip?: boolean;
	size?: "md" | "sm";
	step: LaneStep & Partial<Pick<SessionReaderStep, "ci">>;
}) {
	const subagentTint = useSubagentTint(step);
	const chip = size === "sm" ? "size-4" : undefined;
	const glyph = size === "sm" ? "size-2.5" : "size-3";
	if (step.kind === "ci") {
		const tone = ciTone(step.ci);
		const Glyph =
			step.ci?.kind === "job" ? ciJobGlyph(step.ci) : IconBrandGithub;
		return (
			<OpalChip
				open={open}
				tint={tone.tint}
				title={tip ? step.name : undefined}
				className={cn(tone.text, chip)}
			>
				<Glyph aria-hidden="true" className={glyph} />
			</OpalChip>
		);
	}
	const look = stepLaneLook(step);
	const Glyph = look.glyph;
	return (
		<OpalChip
			open={open}
			tint={subagentTint ?? look.tint}
			title={tip ? (step.skill ?? step.name) : undefined}
			className={cn("text-(--opal-tint)", chip)}
		>
			<Glyph aria-hidden="true" className={glyph} />
		</OpalChip>
	);
}

export function ChipToggle({
	className,
	label,
	onToggle,
	open,
	style,
}: {
	className: string;
	label: string;
	onToggle: () => void;
	open: boolean;
	style?: CSSProperties;
}) {
	return (
		<div
			className={cn(
				"pointer-events-none absolute inset-y-0 left-0 flex items-center",
				className,
			)}
			style={style}
		>
			<Tip label={open ? "Fold" : "Show"}>
				<button
					type="button"
					aria-expanded={open}
					aria-label={open ? `Fold ${label}` : `Show ${label}`}
					onClick={onToggle}
					className="pointer-events-auto size-4.5 rounded-full"
				/>
			</Tip>
		</div>
	);
}

export function stepBar(
	step: Pick<SessionReaderStep, "isError" | "kind" | "name"> &
		Partial<
			Pick<SessionReaderStep, "ci" | "harness" | "notification" | "waitsOnYou">
		>,
	model: string | null,
): { className?: string; style?: CSSProperties } {
	if (step.kind === "ci") return { className: ciTone(step.ci).bar };
	if (step.waitsOnYou) return { className: "bg-amber-400" };
	if (step.harness === "compaction") return { className: "bg-green-500" };
	if (step.harness === "member") return { className: "bg-amber-400" };
	if (step.harness === "hooks")
		return { className: "bg-zinc-400 dark:bg-zinc-500" };
	if (step.harness === "notification" && !step.isError)
		return {
			className: step.notification?.agent ? "bg-pink-500" : "bg-blue-400",
		};
	if (step.isError) return { className: "bg-rose-500" };
	if (step.kind === "agent") {
		return { style: { backgroundColor: agentColor(step.name) } };
	}
	if (step.kind === "message") {
		const accent = modelAccent(model);
		return accent
			? { style: { backgroundColor: accent } }
			: { className: "bg-violet-500" };
	}
	return {
		className: step.kind === "thinking" ? "bg-violet-500" : "bg-blue-500",
	};
}

export function stepTint(
	step: LaneStep & Partial<Pick<SessionReaderStep, "ci">>,
): string {
	return step.kind === "ci" ? ciTone(step.ci).tint : stepLaneLook(step).tint;
}

export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms)) return "—";
	if (ms === 0) return "0s";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
	const totalSec = Math.round(ms / 1000);
	if (totalSec >= 3600) return formatHalfHours(totalSec);
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return s ? `${m}m ${s}s` : `${m}m`;
}

export function formatWholeDuration(ms: number): string {
	const seconds = Math.round(ms / 1000);
	if (seconds < 1) return ms > 0 ? "<1s" : "0s";
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	return formatHalfHours(seconds);
}

export function formatSpanDuration(ms: number): string {
	return ms === 0 ? "<1ms" : formatDuration(ms);
}

const HOUR_MS = 3_600_000;

export function formatRanOn(ms: number): string {
	if (ms < HOUR_MS) return formatSpanDuration(ms);
	return `${Math.round((ms / HOUR_MS) * 2) / 2}h`;
}
