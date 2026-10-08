import type { Icon } from "@tabler/icons-react";
import { useId } from "react";
import { cn } from "@/lib/utils";

// The outer outline of the Opaline mark (public/opaline-icon.svg) without its
// counter.
const OPALINE_OUTLINE =
	"M524.532 0C661.725 4.52425 793.956 20.3892 890.19 103.494C986.746 183.313 1047.24 330.329 1049 520.65C1047.24 710.913 986.746 857.99 890.19 937.817C793.956 1020.92 661.79 1036.79 524.532 1041.3C387.274 1036.79 255.1 1020.92 158.866 937.817C62.3182 857.99 1.76716 711.006 0 520.684C1.75876 330.245 62.3185 183.245 158.866 103.494C255.1 20.3892 387.274 4.52426 524.532 0Z";

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
const chipClassName =
	"[--opal-fill:var(--dashboard-01-rail-active)] [--opal-ring:rgb(255_255_255/0.48)] drop-shadow-[0_1px_2px_rgb(17_24_39/0.08)] dark:[--opal-ring:rgb(255_255_255/0.08)] dark:drop-shadow-[0_1px_2px_rgb(0_0_0/0.24)]";

// muted-foreground at 70% flattened onto the sidebar: the same grey, but
// opaque, so the chip doesn't show through and strokes don't darken where
// they overlap. Alpha blending is a mix in sRGB.
const restingGlyphClassName =
	"text-[color:color-mix(in_srgb,var(--muted-foreground)_70%,var(--sidebar))]";

// Adapted from the NavIcon: the outline glyph cross-fades
// into its filled variant when the section is active, and the resting chip and
// muted glyph give way to the section colour. The tinted chip fades in over
// the resting one; both glyphs share one grid cell so only opacities tween.
export function ShellNavIcon({
	icon: OutlineIcon,
	activeIcon: ActiveIcon,
	active,
	filled = active,
	tone,
}: {
	icon: Icon;
	activeIcon: Icon;
	active: boolean;
	/** Swap to the filled glyph. Follows `active`; the page header keeps the
	 *  outline. */
	filled?: boolean;
	/** Sections without a tone (Settings) get a muted glyph and no chip. */
	tone?: ShellNavTone;
}) {
	// The sidebar forces `[&_svg]:size-4.5`; the important sizes below win.
	const glyphClassName = cn(
		"relative [grid-area:1/1] transition-opacity duration-100 ease-in-out",
		tone ? "size-3.5!" : "size-4.5!",
	);

	return (
		<span
			className={cn(
				"relative grid size-4.5 shrink-0 place-items-center transition-colors duration-100 ease-in-out",
				active && tone ? tone.glyph : restingGlyphClassName,
			)}
		>
			{tone ? (
				<>
					<OpalineShape className={cn("absolute inset-0", chipClassName)} />
					<OpalineShape
						className={cn(
							"absolute inset-0 transition-opacity duration-100 ease-in-out",
							tone.chip,
							active ? "opacity-100" : "opacity-0",
						)}
					/>
				</>
			) : null}
			<OutlineIcon
				aria-hidden="true"
				className={cn(glyphClassName, filled ? "opacity-0" : "opacity-100")}
			/>
			<ActiveIcon
				aria-hidden="true"
				className={cn(glyphClassName, filled ? "opacity-100" : "opacity-0")}
			/>
		</span>
	);
}
