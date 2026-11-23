import { IconGhostFilled } from "@tabler/icons-react";
import { shortSubagentId } from "@/features/sessions/run-id";
import { cn } from "@/lib/utils";
import { OpalChip } from "../detail/waterfall/session-reader-waterfall-chips";
import { LANE_LOOK } from "../model/session-reader-step-lanes";
import { useSubagentTintById } from "./session-reader-subagent-tints";

const AgentGlyph = LANE_LOOK.agent.glyph;

export function SubagentChip({
	progress = false,
	ringed = false,
	selected,
	solid = false,
	subagentId,
}: {
	ringed?: boolean;
	solid?: boolean;
	progress?: boolean;
	selected: boolean;
	subagentId: string;
}) {
	const tint = useSubagentTintById()(subagentId);
	const chip = (
		<OpalChip
			tint={tint ?? LANE_LOOK.agent.tint}
			solid={solid}
			className={cn(
				"size-4",
				selected
					? // design-escape-ok(shadow): artwork; the subagent chip's opal drop
						"text-(--opal-tint) [--opal-ring:color-mix(in_oklch,var(--opal-tint)_20%,transparent)] drop-shadow-[0_1.5px_2px_color-mix(in_oklch,var(--opal-tint)_25%,transparent)]"
					: // design-escape-ok(dark): artwork; the resting opal chip darkens its tint in light and fades it in dark
						"text-[color-mix(in_oklab,var(--opal-tint)_80%,black)] drop-shadow-none group-data-[progress=running]/ring:text-(--opal-tint) dark:text-[color-mix(in_oklch,var(--opal-tint)_55%,transparent)]",
				solid &&
					!selected &&
					// design-escape-ok(dark): artwork; the solid opal chip's glyph and ring, a tint in light and a white ring in dark
					"dark:text-[color-mix(in_oklch,var(--opal-tint)_55%,var(--canvas,var(--canvas)))] [--opal-ring:color-mix(in_oklab,var(--opal-tint)_14%,var(--canvas,var(--canvas)))] dark:[--opal-ring:color-mix(in_oklab,#fff_8%,var(--canvas,var(--canvas)))]",
				ringed &&
					"drop-shadow-none [--opal-ring:color-mix(in_oklab,var(--opal-tint)_25%,var(--canvas,var(--canvas)))]",
			)}
		>
			{selected ? (
				<IconGhostFilled aria-hidden="true" className="size-2.5" />
			) : (
				<AgentGlyph aria-hidden="true" className="size-2.5" />
			)}
		</OpalChip>
	);
	if (!progress)
		return (
			<span data-subagent-chip={subagentId} className="contents">
				{chip}
			</span>
		);
	return (
		<span
			data-subagent-chip={subagentId}
			data-progress="waiting"
			className="group/ring relative -m-xxs grid size-5 shrink-0 place-items-center"
			style={{ color: tint ?? LANE_LOOK.agent.tint }}
		>
			<svg
				aria-hidden="true"
				className="absolute inset-0 size-full"
				viewBox="0 0 28 28"
			>
				<path
					d={PEBBLE_PATH}
					fill="none"
					stroke="currentColor"
					strokeOpacity={0.15}
					strokeWidth={2}
				/>
				<path
					data-subagent-progress={subagentId}
					className="[transition:stroke-dasharray_300ms_cubic-bezier(0.32,0.72,0,1),visibility_300ms,opacity_150ms] group-data-[progress=done]/ring:opacity-45 motion-reduce:transition-none"
					d={PEBBLE_PATH}
					fill="none"
					pathLength={100}
					stroke="currentColor"
					strokeDasharray="0 100"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={2}
				/>
			</svg>
			{chip}
		</span>
	);
}

const PEBBLE_PATH =
	"M14 2.08C17.14 2.18 20.16 2.55 22.37 4.45C24.58 6.27 25.96 9.64 26 13.99C25.96 18.35 24.58 21.71 22.37 23.54C20.16 25.44 17.14 25.8 14 25.9C10.86 25.8 7.84 25.44 5.63 23.54C3.43 21.71 2.04 18.35 2 13.99C2.04 9.64 3.43 6.27 5.63 4.45C7.84 2.55 10.86 2.18 14 2.08Z";

export function markSubagentProgress(
	root: ParentNode,
	reading: number,
	spans: readonly { bottom: number; id?: string; top: number }[],
) {
	for (const ring of root.querySelectorAll<SVGPathElement>(
		"[data-subagent-progress]",
	)) {
		const span = spans.find(
			(each) => each.id === ring.dataset.subagentProgress,
		);
		const share = span
			? Math.min(
					Math.max(
						(reading - span.top) / Math.max(span.bottom - span.top, 1),
						0,
					),
					1,
				)
			: 0;
		ring.setAttribute(
			"stroke-dasharray",
			share >= 1 ? "100 0" : `${share * 100} 100`,
		);
		ring.style.visibility = share > 0 ? "visible" : "hidden";
		const state = share <= 0 ? "waiting" : share >= 1 ? "done" : "running";
		const chip = ring.closest<HTMLElement>("[data-progress]");
		if (chip && chip.dataset.progress !== state) chip.dataset.progress = state;
	}
}

export function SubagentTag({
	className,
	selected = false,
	subagentId,
	title,
}: {
	className?: string;
	selected?: boolean;
	subagentId: string;
	title?: string;
}) {
	const tint = useSubagentTintById()(subagentId);
	return (
		<span
			className={cn("flex shrink-0 items-center gap-s", className)}
			title={title}
		>
			<SubagentChip selected={selected} subagentId={subagentId} />
			<span className="font-data" style={tint ? { color: tint } : undefined}>
				{shortSubagentId(subagentId)}
			</span>
		</span>
	);
}
