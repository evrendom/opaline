import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import graphicalClasses from "../../graphical/generated/tailwind-merge.cjs";

// tailwind-merge with Graphical's classes, so text styles, weights,
// `corner-*` and `edge-*` override each other the way their CSS does.
const twMerge = extendTailwindMerge(graphicalClasses);

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
