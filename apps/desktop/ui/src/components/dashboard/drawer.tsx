import { IconChevronRight } from "@tabler/icons-react";
import { TableCell, TableRow } from "@/components/dashboard/table";
import { cn } from "@/lib/utils";

// Expandable-row drawer: a labelled-fields overview on the left and the row's detail on the right,
// opened under a table row.

/** Secondary button surface for buttons inside a drawer. */
export const DRAWER_BUTTON_CLASS =
	"bg-background shadow-(--custom-outline-shadow) hover:bg-muted hover:text-foreground [&_svg:not([class*='text-'])]:text-neutral-500 dark:bg-secondary dark:shadow-[var(--custom-shadow-secondary)] dark:hover:bg-muted-foreground/25 dark:hover:text-secondary-foreground dark:[&_svg:not([class*='text-'])]:text-neutral-300";

/** Expand affordance for a table's first cell: a muted chevron that brightens
 * on row hover (the row needs `group`) and turns when open. */
export function ExpandChevron({ open }: { open: boolean }) {
	return (
		<IconChevronRight
			aria-hidden="true"
			className={cn(
				"size-3.5 shrink-0 text-muted-foreground/50 transition-[rotate,color] duration-300 ease-out group-hover:text-muted-foreground",
				open && "rotate-90 text-muted-foreground",
			)}
		/>
	);
}

/** Row classes for an open row: it loses its divider and shares the drawer's
 * tint so the two read as one unit. */
export const OPEN_ROW_CLASS =
	"border-b-transparent bg-neutral-100 dark:bg-card";

/** The drawer row itself. `px-8` matches the row cells' inset so the content
 * lines up with the row text. */
export function DrawerRow({
	colSpan,
	children,
	className,
}: {
	colSpan: number;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<TableRow className="hover:bg-transparent">
			<TableCell
				colSpan={colSpan}
				className={cn(
					"whitespace-normal bg-neutral-100 px-8 pt-2 pb-8 dark:bg-card",
					className,
				)}
			>
				{children}
			</TableCell>
		</TableRow>
	);
}

/** Two-column drawer layout: the overview on the left, the detail filling the
 * rest. */
export function DrawerColumns({
	overview,
	children,
	stretch = false,
}: {
	overview: React.ReactNode;
	children: React.ReactNode;
	/** Give the detail column the overview's height when it's taller, for
	 * detail that fills the drawer. */
	stretch?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex flex-col gap-6 lg:flex-row lg:gap-8",
				stretch ? "lg:items-stretch" : "lg:items-start",
			)}
		>
			{/* w-88 + the 2rem column gap = a w-96 first column. */}
			<div className="flex shrink-0 flex-col gap-4 lg:w-88">{overview}</div>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}

/** A labelled section in the drawer's detail column. */
export function DrawerSection({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<span className="text-xs text-muted-foreground">{label}</span>
			{children}
		</div>
	);
}

/** A labelled field in the drawer's overview column. */
export function Meta({
	label,
	value,
	className,
}: {
	label: string;
	value: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex min-w-0 flex-col gap-1", className)}>
			<span className="text-xs text-muted-foreground">{label}</span>
			<span className="min-w-0 text-[13px] tabular-nums">{value}</span>
		</div>
	);
}

/** Placeholder for a field with no value. */
export function MetaEmpty() {
	return <span className="text-muted-foreground/40">—</span>;
}
