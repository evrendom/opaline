import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge, mergeConfigs } from "tailwind-merge";
import { systemClasses } from "./tailwind-merge-config";

// The Layer 2 role shadows registered in src/app/tokens.css, so `shadow-card`
// reads as a shadow (not a shadow colour) and overrides `shadow-none`.
const ROLE_SHADOWS = [
	"card",
	"control",
	"raised",
	"chip",
	"inset",
	"label",
	"float",
];

// tailwind-merge with the system's classes, so text styles, weights,
// `corner-*` and `edge-*` override each other the way their CSS does, plus
// the role shadows, the derived corners and the line and tracking utilities
// in src/app/tokens.css.
const twMerge = extendTailwindMerge(systemClasses, (config) =>
	mergeConfigs(config, {
		extend: {
			theme: { shadow: ROLE_SHADOWS },
			classGroups: {
				corner: [{ corner: ["s-inset", "xl-inset", "xl-inner", "xl-outer"] }],
				leading: ["line-solid", "line-tight"],
			},
		},
	}),
);

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
