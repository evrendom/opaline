import type { CSSProperties } from "react";
import { OPALINE_OUTLINE } from "@/features/shell/components/shell-nav-icon";

const WIDTH = 1049;
const HEIGHT = 1042;

const asUrl = (svg: string) =>
	`url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

export function pebbleMasks(size: number): CSSProperties {
	const hairline = WIDTH / Math.max(size, 1);
	const pad = hairline;
	const box = `${-pad} ${-pad} ${WIDTH + 2 * pad} ${HEIGHT + 2 * pad}`;
	const fill = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none"><path d="${OPALINE_OUTLINE}"/></svg>`;
	const ring = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none"><clipPath id="c"><path d="${OPALINE_OUTLINE}"/></clipPath><path d="${OPALINE_OUTLINE}" fill="none" stroke="black" stroke-width="${(2 * hairline).toFixed(1)}" clip-path="url(#c)"/></svg>`;
	const dotted = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" preserveAspectRatio="none"><path d="${OPALINE_OUTLINE}" fill="none" stroke="black" stroke-width="${hairline.toFixed(1)}" stroke-linecap="round" stroke-dasharray="0 ${(2.6 * hairline).toFixed(1)}"/></svg>`;
	return {
		"--pebble-fill": asUrl(fill),
		"--pebble-ring": asUrl(ring),
		"--pebble-dotted": asUrl(dotted),
	} as CSSProperties;
}
