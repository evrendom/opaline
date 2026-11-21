import {
	IconBrain,
	IconFileText,
	IconHistory,
	IconMessage,
	IconPlug,
	IconRobot,
	IconSquareDashed,
	IconTools,
} from "@tabler/icons-react";
import type { ComponentType, CSSProperties } from "react";
import { getModelIconComponent } from "@/components/conversation/conversation-trace-model-icon";
import { MOMENT_KINDS_APPEARANCE } from "@/features/compass/moment-labels";
import { cn } from "@/lib/utils";
import {
	LANE_LOOK,
	LANES,
	type LaneKey,
} from "../model/session-reader-step-lanes";
import { filterKind, ownKey } from "./session-reader-context-groups";
import type {
	ContextKind,
	ContextMap,
	ContextPart,
} from "./session-reader-context-map";
import {
	type ContextMeasure,
	MEASURE_LOOK,
	useMeasure,
} from "./session-reader-context-measure";

export const TINT: Record<ContextKind, string> = {
	...Object.fromEntries(
		Object.entries(LANE_LOOK).map(([key, look]) => [key, look.tint]),
	),
	earlier: "var(--color-zinc-400)",
	summary: "var(--color-zinc-400)",
} as Record<ContextKind, string>;

export const LANE_LABEL = Object.fromEntries(
	LANES.map((lane) => [lane.key, lane.label]),
) as Record<LaneKey, string>;

export function kindWord(kind: ContextKind | "free"): string {
	if (kind === "free") return "Free";
	if (kind === "context") return "System prompt";
	if (kind === "you") return "You";
	if (kind === "model") return "Agent";
	if (kind === "earlier") return "Earlier";
	if (kind === "summary") return "Summary";
	return LANE_LABEL[kind];
}

export function tileGlyph(part: ContextPart | null): TileGlyph {
	if (!part) return IconSquareDashed;
	if (part.run)
		return part.run.subagent
			? LANE_LOOK.agent.glyph
			: (getModelIconComponent(part.run.model ?? undefined) ?? IconRobot);
	const key = ownKey(part.key);
	if (key.startsWith("setup:")) {
		const scope = key.slice("setup:".length).split(":")[0];
		return scope === "mcp"
			? IconPlug
			: scope === "harness"
				? IconRobot
				: IconFileText;
	}
	if (key === "mcp") return IconPlug;
	if (key === "system") return IconTools;
	if (key === "model:thinking") return IconBrain;
	if (key === "model:messages") return IconMessage;
	if (part.kind === "earlier") return IconHistory;
	if (part.kind === "summary") return MOMENT_KINDS_APPEARANCE.compaction.icon;
	return LANE_LOOK[part.kind].glyph;
}

export type TileGlyph = ComponentType<{ className?: string }>;

export function tileLook(
	kind: ContextKind | "free",
	strong = false,
): {
	className: string;
	style?: CSSProperties;
} {
	if (kind === "free")
		return {
			className:
				// design-escape-ok(opacity): no role renders this; dark:border-ink/16
				"border-dashed border-line-soft text-ink-3 bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_srgb,var(--ink)_3.5%,transparent)_6px_7px)] dark:border-ink/16 dark:bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_srgb,var(--ink)_5%,transparent)_6px_7px)]",
		};
	if (strong)
		return {
			className:
				"border-[color-mix(in_oklab,var(--tint)_55%,transparent)] bg-[color-mix(in_oklab,var(--tint)_22%,transparent)] text-[color-mix(in_oklab,var(--tint)_55%,black)] dark:bg-[color-mix(in_oklab,var(--tint)_28%,transparent)] dark:text-[color-mix(in_oklab,var(--tint)_75%,white)]",
			style: { "--tint": TINT[kind] } as CSSProperties,
		};
	return {
		className:
			"border-[color-mix(in_oklab,var(--tint)_32%,transparent)] bg-[color-mix(in_oklab,var(--tint)_10%,transparent)] text-[color-mix(in_oklab,var(--tint)_62%,black)] dark:bg-[color-mix(in_oklab,var(--tint)_15%,transparent)] dark:text-[color-mix(in_oklab,var(--tint)_70%,white)]",
		style: { "--tint": TINT[kind] } as CSSProperties,
	};
}

export function ContextMark({ className }: { className?: string }) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			aria-hidden="true"
			className={cn("shrink-0 text-accent-line dark:text-accent", className)}
		>
			<rect
				x="1.8"
				y="1.8"
				width="7"
				height="12.4"
				rx="1.6"
				fill="currentColor"
			/>
			<rect
				x="10"
				y="1.8"
				width="4.2"
				height="6"
				rx="1.4"
				fill="currentColor"
				opacity="0.6"
			/>
			<rect
				x="10"
				y="9"
				width="4.2"
				height="5.2"
				rx="1.4"
				fill="currentColor"
				opacity="0.3"
			/>
		</svg>
	);
}

export const PILL_SHADOW = "shadow-chip";

export const CONTEXT_WARN = 70;
export const CONTEXT_FULL = 90;

export function ContextBar({
	caption,
	map,
	measure = "context",
	offMeasures,
	onMeasure,
	titleId,
	excluded = NONE,
}: {
	caption?: string;
	map: ContextMap | null;
	measure?: ContextMeasure;
	offMeasures?: ReadonlySet<ContextMeasure>;
	onMeasure?: (measure: ContextMeasure) => void;
	titleId: string | undefined;
	excluded?: readonly { label: string; tokens: number | null }[];
}) {
	const look = useMeasure();
	const share =
		map && look.windowed ? Math.round((map.used / map.window) * 100) : null;
	const warns = measure === "context";
	const picked = !onMeasure;
	if (picked && !caption)
		return (
			<span id={titleId} className="sr-only">
				{MEASURE_LOOK[measure].label}
			</span>
		);
	return (
		<header className="flex min-w-0 items-center gap-l text-body-l">
			{onMeasure ? (
				<>
					<ContextMark />
					<span id={titleId} className="sr-only">
						{MEASURE_LOOK[measure].label}
					</span>
					<MeasureToggle
						measure={measure}
						off={offMeasures}
						onMeasure={onMeasure}
					/>
				</>
			) : (
				<span id={titleId} className="sr-only">
					{MEASURE_LOOK[measure].label}
				</span>
			)}
			{caption ? (
				<span className="shrink-0 text-body-m text-ink-3">{caption}</span>
			) : null}
			{map ? (
				<>
					{excluded.length > 0 && !picked ? (
						<span
							title={`Not in the map or its total: ${excludedWords(excluded, look.format)}`}
							className="ml-auto min-w-0 truncate text-body-m text-ink-3 tabular-nums"
						>
							without {excludedWords(excluded, look.format)}
						</span>
					) : null}
					<span
						className={cn(
							"flex shrink-0 items-center gap-m tabular-nums",
							excluded.length === 0 && "ml-auto",
							picked && "hidden",
						)}
					>
						<span className="text-ink-3">
							<b className="font-medium text-ink-3">{look.format(map.used)}</b>
							{look.windowed ? ` / ${look.format(map.window)}` : null}
						</span>
						{share !== null ? (
							<span
								className={cn(
									"corner-s corner-squircle squircle:corner-l px-s text-body-m font-medium",
									warns && share >= CONTEXT_FULL
										? "bg-error-tint text-error"
										: warns && share >= CONTEXT_WARN
											? "bg-warning-tint text-warning"
											: // design-escape-ok(opacity): no role renders this; dark:bg-ink/8
												"bg-wash text-ink-3 dark:bg-ink/8",
								)}
							>
								{share}%
							</span>
						) : null}
					</span>
				</>
			) : null}
		</header>
	);
}

const NONE: readonly { label: string; tokens: number | null }[] = [];

function excludedWords(
	excluded: readonly { label: string; tokens: number | null }[],
	format: (value: number) => string,
) {
	return excluded
		.map(({ label, tokens }) =>
			tokens === null ? label : `${label} ${format(tokens)}`,
		)
		.join(" · ");
}

export function excludedOf(
	map: ContextMap,
	hidden: ReadonlySet<ContextKind | "free">,
	freeWord = "Free",
): { label: string; tokens: number | null }[] {
	const byKind = new Map<ContextKind, number>();
	for (const part of map.parts) {
		const kind = filterKind(part);
		if (hidden.has(kind))
			byKind.set(kind, (byKind.get(kind) ?? 0) + part.tokens);
	}
	const named = [...byKind]
		.sort((a, b) => b[1] - a[1])
		.map(([kind, tokens]) => ({
			label: EXCLUDED_LABEL[kind] ?? kindWord(kind),
			tokens,
		}));
	return hidden.has("free")
		? [...named, { label: freeWord, tokens: null }]
		: named;
}

const EXCLUDED_LABEL: Partial<Record<ContextKind, string>> = {
	context: "System prompt & tools",
	model: "Agent messages",
	you: "Your prompt",
};

function MeasureToggle({
	measure,
	off,
	onMeasure,
}: {
	measure: ContextMeasure;
	off?: ReadonlySet<ContextMeasure>;
	onMeasure: (measure: ContextMeasure) => void;
}) {
	return (
		// design-escape-ok(opacity): no role renders this; dark:bg-ink/6
		<fieldset className="m-zero flex shrink-0 items-center gap-xxs corner-m edge-none bg-wash p-xxs corner-squircle squircle:corner-xl dark:bg-ink/6">
			<legend className="sr-only">Measure the map by</legend>
			{MEASURES.map((each) => {
				const pressed = each === measure;
				const disabled = off?.has(each) ?? false;
				return (
					<button
						key={each}
						type="button"
						aria-pressed={pressed}
						disabled={disabled}
						title={
							disabled
								? "Not known for a subagent: its calls aren't"
								: undefined
						}
						onClick={() => onMeasure(each)}
						className={cn(
							"h-6",
							"corner-s px-l corner-squircle",
							"text-body-l",
							"outline-none",
							"disabled:cursor-default disabled:opacity-40 squircle:corner-l",
							pressed
								? cn("bg-card font-medium", PILL_SHADOW)
								: // design-escape-ok(opacity): no role renders this; hover:text-ink/88
									"text-ink-3 hover:text-ink/88 dark:hover:text-ink",
						)}
					>
						{MEASURE_LOOK[each].label}
					</button>
				);
			})}
		</fieldset>
	);
}

const MEASURES: readonly ContextMeasure[] = ["context", "cost", "time"];
