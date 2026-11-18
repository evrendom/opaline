import type { Icon } from "@tabler/icons-react";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { OPALINE_OUTLINE } from "./opaline-outline";

export { OPALINE_OUTLINE } from "./opaline-outline";

/**
 * The Opaline pebble with a 1px inner border: a 2px stroke clipped to the
 * shape, so only its inner half shows and the border follows the outline
 * exactly without spilling past the edge. Colour it with `--opal-fill` and
 * `--opal-ring`; a drop shadow on it follows the shape.
 */
export function OpalineShape({ className }: { className?: string }) {
	const clipId = `opaline-shape-${useId().replace(/[^\w-]/g, "")}`;
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 1049 1042"
			// Sidebar rows size every svg inside them; the shape fills its box.
			className={cn("pointer-events-none size-full!", className)}
		>
			<clipPath id={clipId}>
				<path d={OPALINE_OUTLINE} />
			</clipPath>
			<path d={OPALINE_OUTLINE} className="fill-(--opal-fill)" />
			<path
				d={OPALINE_OUTLINE}
				clipPath={`url(#${clipId})`}
				fill="none"
				strokeWidth={2}
				vectorEffect="non-scaling-stroke"
				className="stroke-(--opal-ring)"
			/>
		</svg>
	);
}

export type ShellNavTone = {
	/** Chip fill and ring colours (--opal-fill, --opal-ring) and its tinted
	 *  drop shadow while the section is active. */
	chip: string;
	/** Glyph colour while the section is active. */
	glyph: string;
};

// Old Opaline's active row: a translucent white pebble (the rail's active
// fill) with a white inner border and a soft drop shadow. Every section sits
// on one at rest; Settings stays a bare glyph.
export const restingChipClassName =
	"[--opal-fill:var(--dashboard-01-rail-active)] [--opal-ring:rgb(255_255_255/0.48)] drop-shadow-[0_1px_2px_rgb(17_24_39/0.08)] dark:[--opal-ring:rgb(255_255_255/0.08)] dark:drop-shadow-[0_1px_2px_rgb(0_0_0/0.24)]";

// muted-foreground at 70% flattened onto the sidebar: the same grey, but
// opaque, so the chip doesn't show through and strokes don't darken where
// they overlap. Alpha blending is a mix in sRGB.
export const restingGlyphClassName =
	"text-[color:color-mix(in_srgb,var(--muted-foreground)_70%,var(--sidebar))]";

// Adapted from the NavIcon: the outline glyph cross-fades
// into its filled variant when the section is active, and the resting chip and
// muted glyph give way to the section colour. The tinted chip fades in over
export function ShellNavIcon({
	icon: OutlineIcon,
	activeIcon: ActiveIcon,
	active,
	tone,
}: {
	icon: Icon;
	activeIcon: Icon;
	active: boolean;
	/** Sections without a tone (Settings) get a muted glyph and no chip. */
	tone?: ShellNavTone;
}) {
	const fade =
		"transition-opacity duration-100 ease-in-out will-change-[opacity]";
	// The sidebar forces `[&_svg]:size-4.5`; the important sizes below win.
	const glyphClassName = tone ? "size-3.5!" : "size-4.5!";
	const glyphCell = cn("relative flex [grid-area:1/1]", fade);

	return (
		<span
			skullet-own=""
			data-nav-icon=""
			className={cn(
				"relative grid size-4.5 shrink-0 place-items-center transition-colors duration-100 ease-in-out",
				active && tone ? tone.glyph : restingGlyphClassName,
			)}
		>
			{tone ? (
				<>
					<OpalineShape
						className={cn("absolute inset-0", restingChipClassName)}
					/>
					<span
						className={cn(
							"absolute inset-0",
							fade,
							active ? "opacity-100" : "opacity-0",
						)}
					>
						<OpalineShape className={cn("absolute inset-0", tone.chip)} />
					</span>
				</>
			) : null}
			<span className={cn(glyphCell, active ? "opacity-0" : "opacity-100")}>
				<OutlineIcon aria-hidden="true" className={glyphClassName} />
			</span>
			<span className={cn(glyphCell, active ? "opacity-100" : "opacity-0")}>
				<ActiveIcon aria-hidden="true" className={glyphClassName} />
			</span>
		</span>
	);
}
