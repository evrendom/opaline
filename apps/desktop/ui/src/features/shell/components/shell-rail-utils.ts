import { shellPressMotionClassName } from "@/features/shell/components/shell-press-motion";
import { cn } from "@/lib/utils";

const shellMenuButtonBaseClassName = cn(
	// --sidebar-row-radius is undefined, so the radius computes to 0 and beats
	// corner-m on the bottom rail; kept so the rail renders the same.
	// design-escape-ok(radius): no role renders this; an undefined radius var (0)
	"relative flex h-[var(--sidebar-row-height)] w-full items-center justify-start gap-[var(--sidebar-row-gap)] overflow-hidden rounded-[var(--sidebar-row-radius)] pr-[var(--sidebar-collapsed-row-padding-right)] pl-[var(--sidebar-collapsed-row-padding-left)] text-left !bg-[var(--sidebar-row-idle-bg)] text-[color:var(--sidebar-row-fg)] focus-outline hover:!bg-[var(--sidebar-row-hover-bg)] hover:!text-[color:var(--sidebar-row-active-fg)] active:!bg-[var(--sidebar-row-hover-bg)] active:!text-[color:var(--sidebar-row-active-fg)] data-[active=true]:!bg-[var(--sidebar-row-active-bg)] data-[active=true]:!text-[color:var(--sidebar-row-active-fg)]",
	shellPressMotionClassName,
);

export function getUtilityRailItemClassName() {
	return cn(shellMenuButtonBaseClassName, "!w-auto self-start");
}

export function getRailLabelClassName() {
	return "sr-only";
}

export function getUtilityRailLabelClassName() {
	return "sr-only";
}

export function getInitials(name?: string | null, email?: string | null) {
	const source = (name?.trim() || email?.trim() || "R").split(" ");
	return source
		.map((part) => part[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);
}
