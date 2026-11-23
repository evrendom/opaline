import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One area of the app (Shell, Settings …): its title and its specimens. */
export function Group({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-xxl">
			<h2 className="text-body-xxl font-medium text-ink">{title}</h2>
			{children}
		</section>
	);
}

/**
 * One real component: what it is, the file it comes from and where the app
 * shows it, then the component itself in each state the app uses.
 */
export function Specimen({
	name,
	source,
	where,
	children,
	className,
}: {
	name: string;
	/** The file the app imports it from, under src/. */
	source: string;
	/** The screens that show it. */
	where: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-l">
			<div className="flex flex-col gap-xxs">
				<span className="text-body-l font-medium text-ink">{name}</span>
				<span className="font-data text-body-s text-ink-3">{source}</span>
				<span className="text-body-s text-ink-3">{where}</span>
			</div>
			<div
				className={cn("flex min-w-0 flex-wrap items-start gap-xl", className)}
			>
				{children}
			</div>
		</div>
	);
}

/** One state of a specimen, captioned with the state's name. */
export function State({
	label,
	children,
	className,
}: {
	label: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex min-w-0 flex-col items-start gap-s", className)}>
			{children}
			<span className="text-body-xs text-ink-3">{label}</span>
		</div>
	);
}

/** A canvas-coloured stage, for specimens that sit on the page's canvas. */
export function Stage({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn("min-w-0 corner-s bg-canvas p-xl shadow-inset", className)}
		>
			{children}
		</div>
	);
}
