import type { Format } from "@number-flow/react";
import type { Icon } from "@tabler/icons-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { FlowNumber } from "@/app/ui/flow-number";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/ui/tooltip";
import { Card, CardHeader, CardTitle } from "@/components/dashboard/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/dashboard/empty";
import { Skeleton } from "@/components/dashboard/skeleton";
import { TableCell, TableRow } from "@/components/dashboard/table";
import {
	OpalineShape,
	restingChipClassName,
} from "@/features/shell/components/shell-nav-icon";
import { cn } from "@/lib/utils";

export function EmptyState({
	icon: Icon,
	title,
	description,
	children,
	className,
	iconClassName,
}: {
	icon: React.ComponentType<{ className?: string }>;
	title?: string;
	description?: string;
	children?: React.ReactNode;
	className?: string;
	iconClassName?: string;
}) {
	return (
		<Empty className={cn("border border-dashed", className)}>
			<EmptyHeader>
				<EmptyMedia
					variant="icon"
					className={title || description || children ? undefined : "mb-0"}
				>
					<OpalineShape
						className={cn(
							"absolute inset-0",
							restingChipClassName,
							"[--opal-ring:rgb(17_24_39/0.08)]",
						)}
					/>
					<Icon className={cn("relative", iconClassName)} />
				</EmptyMedia>
				{title || description || children ? (
					<EmptyContent>
						{title ? <EmptyTitle>{title}</EmptyTitle> : null}
						{description && <EmptyDescription>{description}</EmptyDescription>}
						{children}
					</EmptyContent>
				) : null}
			</EmptyHeader>
		</Empty>
	);
}

/** One column of a `TableRowsSkeleton` row. Omit `w` for an empty cell.
 * `icon` adds a small square blob before the text blob. */
export type SkeletonCol = {
	w?: string;
	align?: "left" | "right";
	icon?: boolean;
};

/**
 * Placeholder body rows for a list table while its query is in flight. The
 * page's chrome (toolbar, column headers) renders immediately; only these
 * rows shimmer, one blob per column, mirroring the real cells' alignment.
 * Pair with a `table-fixed` Table so the skeleton→data swap can't shift
 * column widths.
 */
export function TableRowsSkeleton({
	rows = 3,
	cols,
}: {
	rows?: number;
	cols: readonly SkeletonCol[];
}) {
	return (
		<>
			{Array.from({ length: rows }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
				<TableRow key={i}>
					{cols.map((c, j) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static placeholder cells
						<TableCell key={j} align={c.align} className="h-12">
							{c.w && (
								<div
									className={cn(
										"flex items-center gap-2",
										c.align === "right" && "justify-end",
									)}
								>
									{c.icon && (
										<Skeleton className="size-4 shrink-0 rounded-md" />
									)}
									<Skeleton className={cn("h-4", c.w)} />
								</div>
							)}
						</TableCell>
					))}
				</TableRow>
			))}
		</>
	);
}

const WHOLE: Format = { maximumFractionDigits: 0 };

/**
 * A single metric tile for a stat strip: icon + label on the left, the value on
 * the right. Order a strip Volume → Health → Performance → Cost. A `number`
 * value ticks to new values; anything else renders as given. While `loading`
 * the shell stays put and the value slot holds its height (shimmering once
 * `skeleton` flips), so the data drops in without shifting the card.
 */
export function StatCard({
	accent,
	label,
	shortLabel,
	badge,
	note,
	noteBelow = false,
	valueTip,
	onSelect,
	selected = false,
	value,
	icon: StatIcon,
	iconClassName,
	valueFormat,
	title,
	loading = false,
	skeleton = false,
}: {
	accent?: string;
	label: string;
	shortLabel?: string;
	badge?: React.ReactNode;
	note?: React.ReactNode;
	noteBelow?: boolean;
	valueTip?: React.ReactNode;
	onSelect?: () => void;
	selected?: boolean;
	value: React.ReactNode;
	icon?: Icon | React.ComponentType<{ className?: string }>;
	iconClassName?: string;
	valueFormat?: Format;
	/** Native tooltip for the value (e.g. the hint the card no longer shows). */
	title?: string;
	loading?: boolean;
	skeleton?: boolean;
}) {
	return (
		<Card
			size="sm"
			skullet-block={onSelect ? "" : undefined}
			className={cn(
				"data-[size=sm]:py-3.5",
				onSelect &&
					"relative transition-shadow hover:shadow-(--custom-shadow-secondary)",
			)}
			style={
				selected && accent
					? {
							boxShadow: `var(--custom-shadow), 0 1.5px 2px color-mix(in oklch, ${accent} 25%, transparent), inset 0 0 0 1px color-mix(in oklch, ${accent} 20%, transparent)`,
						}
					: undefined
			}
		>
			{onSelect ? (
				<button
					type="button"
					aria-label={label}
					aria-pressed={selected}
					onClick={onSelect}
					className={cn("absolute inset-0 z-10 rounded-[inherit] outline-none")}
				/>
			) : null}
			<CardHeader className="gap-1.5 group-data-[size=sm]/card:px-4">
				<div className="flex min-w-0 items-center justify-between gap-2">
					<div
						className={cn(
							"flex items-center gap-1.75",
							note ? "shrink-0" : "min-w-0",
						)}
					>
						{StatIcon && (
							<StatIcon
								className={cn(
									"size-3.5 shrink-0 text-muted-foreground",
									iconClassName,
								)}
							/>
						)}
						{shortLabel ? (
							<span className="truncate text-sm text-foreground">
								<span className="hidden @[15rem]/card-header:inline">
									{label}
								</span>
								<span className="@[15rem]/card-header:hidden">
									{shortLabel}
								</span>
							</span>
						) : (
							<span className="truncate text-sm text-foreground">{label}</span>
						)}
						{badge ? <span className="flex shrink-0">{badge}</span> : null}
					</div>
					<div
						className={cn(
							"flex items-center gap-2.5",
							note ? "min-w-0 gap-2" : "shrink-0",
						)}
					>
						{note && !noteBelow && !loading ? (
							<CardTitle className="inline-flex min-w-0 items-center gap-1 overflow-hidden tracking-tight whitespace-nowrap tabular-nums opacity-45">
								{note}
							</CardTitle>
						) : null}
						<StatValue
							onSelect={onSelect}
							tip={loading ? undefined : valueTip}
							title={title}
						>
							{loading ? (
								// Zero-width text keeps the title's line box so the row
								// height matches the loaded card exactly.
								<span className="inline-flex items-center">
									{"\u200b"}
									<Skeleton
										className={cn("h-3 w-20", !skeleton && "invisible")}
									/>
								</span>
							) : typeof value === "number" ? (
								<FlowNumber value={value} format={valueFormat ?? WHOLE} />
							) : (
								value
							)}
						</StatValue>
					</div>
				</div>
				{note && noteBelow && !loading ? (
					<CardTitle className="min-w-0 tracking-tight text-pretty tabular-nums opacity-45">
						{note}
					</CardTitle>
				) : null}
			</CardHeader>
		</Card>
	);
}

function StatValue({
	children,
	onSelect,
	tip,
	title,
}: {
	children: React.ReactNode;
	onSelect?: () => void;
	tip?: React.ReactNode;
	title?: string;
}) {
	if (!tip)
		return (
			<CardTitle className="shrink-0 tracking-tight tabular-nums" title={title}>
				{children}
			</CardTitle>
		);
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<CardTitle
						className="relative z-20 shrink-0 cursor-default tracking-tight tabular-nums"
						onClick={onSelect}
					/>
				}
			>
				{children}
			</TooltipTrigger>
			<TooltipContent side="top" className="tabular-nums">
				{tip}
			</TooltipContent>
		</Tooltip>
	);
}

/** A scroll viewport whose top/bottom edges fade into the card while there is
 * more content past them. */
export function ScrollFade({
	children,
	className,
	containerClassName,
	fromClassName = "from-card",
}: {
	children: React.ReactNode;
	/** Classes for the scroll viewport (e.g. `max-h-72`, padding). */
	className?: string;
	/** Classes for the outer wrapper. */
	containerClassName?: string;
	fromClassName?: string;
}) {
	const viewport = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const [edges, setEdges] = useState({ top: false, bottom: false });
	const update = useCallback(() => {
		const el = viewport.current;
		if (!el) return;
		setEdges({
			top: el.scrollTop > 1,
			bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
		});
	}, []);
	useLayoutEffect(() => {
		update();
		const el = content.current;
		if (!el) return;
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => ro.disconnect();
	}, [update]);
	return (
		<div className={cn("relative no-scrollbar", containerClassName)}>
			<div
				ref={viewport}
				onScroll={update}
				className={cn("overflow-y-auto no-scrollbar", className)}
			>
				<div ref={content}>{children}</div>
			</div>
			<div
				className={cn(
					"pointer-events-none absolute inset-x-0 top-0 h-10 bg-linear-to-b to-transparent transition-opacity duration-150",
					fromClassName,
					edges.top ? "opacity-100" : "opacity-0",
				)}
			/>
			<div
				className={cn(
					"pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t to-transparent transition-opacity duration-150",
					fromClassName,
					edges.bottom ? "opacity-75" : "opacity-0",
				)}
			/>
		</div>
	);
}
