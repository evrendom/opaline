import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge, mergeConfigs } from "tailwind-merge";
import graphicalClasses from "../../graphical/generated/tailwind-merge.cjs";

// The Layer 2 role shadows registered in src/app/tokens.css, so `shadow-card`
// reads as a shadow (not a shadow colour) and overrides `shadow-none`.
const ROLE_SHADOWS = [
	"card",
	"control",
	"raised",
	"overlay",
	"primary",
	"destructive",
	"chip",
	"selected",
	"inset",
	"label",
	"float",
];

// tailwind-merge with Graphical's classes, so text styles, weights,
// `corner-*` and `edge-*` override each other the way their CSS does, plus
// the role shadows.
const twMerge = extendTailwindMerge(graphicalClasses, (config) =>
	mergeConfigs(config, { extend: { theme: { shadow: ROLE_SHADOWS } } }),
);

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
