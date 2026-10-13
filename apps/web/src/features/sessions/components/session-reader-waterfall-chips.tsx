import { agentColor } from "@rudel/api-routes/skill-icon";
import {
	IconBrain,
	IconChevronRight,
	IconGhost,
	IconSparkles,
} from "@tabler/icons-react";
import type { CSSProperties, ReactNode } from "react";
import { getModelIconComponent } from "@/components/conversation/conversation-trace-model-icon";
import { CONVERSATION_TOOL_ICONS } from "@/components/conversation/conversation-trace-tool-icons";
import { getSkillMarkLook } from "@/components/skill-mark-look";
import { getModelBadgeTone } from "@/features/dashboard/components/dashboard-model-brand";
import {
	OpalineShape,
	restingChipClassName,
	restingGlyphClassName,
} from "@/features/shell/components/shell-nav-icon";
import { sessionsTone } from "@/features/shell/config/shell-routes";
import { cn } from "@/lib/utils";
import type { SessionReaderStep } from "./session-reader-model";

// Step identity chips, bar colors and duration formatting for the turn
// waterfall: agents get a per-name color,
// written output the model's brand color, thinking violet, tools blue.

/** The model's brand color, for its step chip and bar. Codex's is black on
 * light and white on dark: the foreground, so it turns with the theme. */
function modelAccent(model: string | null): string | null {
	const icon = model ? getModelBadgeTone(model).icon : null;
	if (icon === "claude") return "#CC7D5E";
	if (icon === "codex") return "var(--foreground)";
	return null;
}

/**
 * An icon chip on the Opaline pebble (the sidebar's OpalineShape), tinted in
 * one color: a 15% fill, a faint inner ring and a tinted drop that follows the
 * shape — the same recipe the square chips had as box shadows.
 */
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
	/** On a row that folds what's beneath it (a `group/toggle`): the glyph
	 * gives way to a chevron while the row is hovered or something in it has
	 * keyboard focus, and the chevron stays, turned down, while it's open.
	 * Unset, the chip is plain. */
	open?: boolean;
	/** Mix the fill into the page background instead of transparency, so the
	 * chip looks the same but hides what's under it — for chips that overlap. */
	/** Wear the sidebar's chip instead of a tint: the Sessions section's while
	 * active, the resting pebble otherwise, cross-fading as they do there. */
	sidebar?: "active" | "resting";
	solid?: boolean;
	/** Any CSS color: a hex, or a theme variable like `var(--color-blue-500)`. */
	tint?: string;
	title?: string;
}) {
	const tone = sessionsTone;
	return (
		<span
			title={title}
			className={cn(
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
								: "group-hover/toggle:scale-50 group-hover/toggle:opacity-0 group-focus-visible/toggle:scale-50 group-focus-visible/toggle:opacity-0 group-has-focus-visible/toggle:scale-50 group-has-focus-visible/toggle:opacity-0",
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
								: "scale-50 opacity-0 group-hover/toggle:scale-100 group-hover/toggle:opacity-100 group-focus-visible/toggle:scale-100 group-focus-visible/toggle:opacity-100 group-has-focus-visible/toggle:scale-100 group-has-focus-visible/toggle:opacity-100",
						)}
					/>
				</span>
			)}
		</span>
	);
}

const SLATE = "var(--color-slate-500)";

/** The model's chip: its icon in its brand color on the Opaline pebble. */
export function ModelChip({
	chip,
	glyph,
	model,
	open,
}: {
	chip?: string;
	glyph: string;
	model: string | null;
	/** On a row that folds what's beneath it: see OpalChip. */
	open?: boolean;
}) {
	const ModelIcon = getModelIconComponent(model ?? undefined);
	const color = modelAccent(model);
	return (
		<OpalChip
			open={open}
			tint={color ?? SLATE}
			title={model ?? "model"}
			// On the chip, so the chevron that stands in for the icon wears its
			// color too.
			className={cn(
				color ? "text-(--opal-tint)" : "text-violet-600 dark:text-violet-400",
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

/** The identity chip for one step, shared by its waterfall row and the
 * inspector header so a step looks the same in both. */
export function StepIconChip({
	model,
	open,
	size = "md",
	step,
}: {
	model: string | null;
	/** The step's row folds what's beneath it: see OpalChip. */
	open?: boolean;
	/** `sm` for dense lists like the turn rail. */
	size?: "md" | "sm";
	step: Pick<SessionReaderStep, "icon" | "kind" | "name" | "skill">;
}) {
	const chip = size === "sm" ? "size-4" : undefined;
	const glyph = size === "sm" ? "size-2.5" : "size-3";
	// A skill loaded wears the skill's own mark, as on the Skills page.
	if (step.skill) {
		const look = getSkillMarkLook(step.skill);
		return (
			<OpalChip
				open={open}
				tint={look.tint}
				title={step.skill}
				className={cn("text-(--opal-tint)", chip)}
			>
				<span
					aria-hidden="true"
					className={cn(
						"leading-none",
						size === "sm" ? "text-[8px]" : "text-[10px]",
					)}
				>
					{look.emoji}
				</span>
			</OpalChip>
		);
	}
	if (step.kind === "message") {
		return <ModelChip chip={chip} glyph={glyph} model={model} />;
	}
	if (step.kind === "agent") {
		const color = agentColor(step.name);
		return (
			<OpalChip
				open={open}
				tint={color}
				title={step.name}
				className={cn("text-(--opal-tint)", chip)}
			>
				<IconGhost
					aria-hidden="true"
					className={cn(glyph, "fill-current/20")}
				/>
			</OpalChip>
		);
	}
	if (step.kind === "thinking") {
		return (
			<OpalChip
				open={open}
				tint="var(--color-violet-500)"
				title="thinking"
				className={cn("text-violet-600 dark:text-violet-400", chip)}
			>
				<IconBrain aria-hidden="true" className={glyph} />
			</OpalChip>
		);
	}
	// The transcript's glyph for the tool — a terminal for shell commands, a
	// file for reads, a pencil for edits — on the tool blue.
	const Glyph = CONVERSATION_TOOL_ICONS[step.icon ?? "wrench"];
	return (
		<OpalChip
			open={open}
			tint="var(--color-blue-500)"
			title={step.name}
			className={cn("text-blue-600 dark:text-blue-400", chip)}
		>
			<Glyph className={glyph} />
		</OpalChip>
	);
}

/**
 * The button on a row's chip that folds what's beneath the row, apart from
 * the row's own button, which selects it (a button can't hold another). It
 * lies over the chip — placed by the same left padding as the row's label
 * cell — and draws nothing itself: the chip under it shows the chevron.
 */
export function ChipToggle({
	className,
	label,
	onToggle,
	open,
	style,
}: {
	/** The row label cell's left padding, so this lands on its chip. */
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
			<button
				type="button"
				aria-expanded={open}
				aria-label={open ? `Fold ${label}` : `Show ${label}`}
				title={open ? "Fold" : "Show"}
				onClick={onToggle}
				className="pointer-events-auto size-4.5 cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-1"
			/>
		</div>
	);
}

/** A step's bar fill: errors rose, agents their own color, written output the
 * model's brand color, thinking violet and tools blue — matching the chip. */
export function stepBar(
	step: Pick<SessionReaderStep, "isError" | "kind" | "name">,
	model: string | null,
): { className?: string; style?: CSSProperties } {
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

/** Milliseconds → human duration. */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms)) return "—";
	if (ms === 0) return "0s";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
	const totalSec = Math.round(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	const parts = [];
	if (h) parts.push(`${h}h`);
	if (m) parts.push(`${m}m`);
	if (s) parts.push(`${s}s`);
	return parts.slice(0, 2).join(" ") || "0s";
}

export function formatSpanDuration(ms: number): string {
	return ms === 0 ? "<1ms" : formatDuration(ms);
}
