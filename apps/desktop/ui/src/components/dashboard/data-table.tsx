import type { Format } from "@number-flow/react";
import {
	IconArrowDown,
	IconArrowsSort,
	IconArrowUp,
	IconChevronLeft,
	IconChevronRight,
	IconSearch,
	IconX,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/app/ui/button";
import { FlowNumber } from "@/app/ui/flow-number";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@/app/ui/input-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@/app/ui/select";
import { TableHead } from "@/app/ui/table";
import { PLAIN_NUMBER } from "@/lib/figure";
import { cn } from "@/lib/utils";

// List-table toolkit, so Opaline's list pages share the same chrome.

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

/**
 * Keeps a list view's filter/search/sort/page state in the URL query string so
 * it survives reload and back-navigation and can be shared as a link.
 *
 * `defaults` declares the managed keys; a key at its default value is dropped
 * from the URL. `patch` merges updates via history replace (no history spam),
 * skips writes that change nothing, and — because changing a filter
 * invalidates the current page — clears `page` on every patch that doesn't set
 * it explicitly. Same-tick patches accumulate in a ref so they don't clobber
 * each other (searchParams only update after navigation).
 */
export function useUrlFilters<K extends string>(
	defaults: Record<K, string>,
): [Record<K, string>, (updates: Partial<Record<K, string>>) => void] {
	const [searchParams, setSearchParams] = useSearchParams();

	const values = {} as Record<K, string>;
	for (const key of Object.keys(defaults) as K[]) {
		values[key] = searchParams.get(key) ?? defaults[key];
	}

	// Same-tick accumulator, keyed to the searchParams snapshot it started from.
	const pendingRef = useRef<{ base: string; params: URLSearchParams } | null>(
		null,
	);
	const defaultsRef = useRef(defaults);
	defaultsRef.current = defaults;

	const patch = useCallback(
		(updates: Partial<Record<K, string>>) => {
			const base = searchParams.toString();
			const params =
				pendingRef.current?.base === base
					? pendingRef.current.params
					: new URLSearchParams(base);

			const changed = Object.entries(updates).some(
				([k, v]) => (params.get(k) ?? defaultsRef.current[k as K]) !== v,
			);
			if (!changed) return;

			for (const [k, v] of Object.entries(updates) as [K, string][]) {
				if (v === defaultsRef.current[k]) params.delete(k);
				else params.set(k, v);
			}
			if (!("page" in updates)) params.delete("page");

			pendingRef.current = { base, params };
			setSearchParams(new URLSearchParams(params), {
				replace: true,
				preventScrollReset: true,
			});
		},
		[searchParams, setSearchParams],
	);

	return [values, patch];
}

/** Parse a `key:dir` sort param ("cost:desc") back into a SortState; unknown
 * keys/dirs yield null (the table's natural order). */
export function parseSortParam<K extends string>(
	value: string,
	validKeys: readonly K[],
): SortState<K> | null {
	const [key, dir] = value.split(":");
	if (!validKeys.includes(key as K)) return null;
	if (dir !== "asc" && dir !== "desc") return null;
	return { key: key as K, dir };
}

/** The next sort param in the tri-state cycle (desc → asc → off), serialized
 * for the URL. */
export function cycleSortParam<K extends string>(
	sort: SortState<K> | null,
	key: K,
): string {
	if (!sort || sort.key !== key) return `${key}:desc`;
	if (sort.dir === "desc") return `${key}:asc`;
	return "";
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };

/** Stable client-side sort: nulls always sort last, numbers numerically, and
 * everything else lexicographically. A `null` sort leaves the rows in their
 * original order. Use for full-list tables. */
export function sortRows<T, K extends string>(
	rows: readonly T[],
	sort: SortState<K> | null,
	accessors: Record<K, (row: T) => string | number | null | undefined>,
): T[] {
	if (!sort) return [...rows];
	const get = accessors[sort.key];
	const sign = sort.dir === "asc" ? 1 : -1;
	return [...rows].sort((a, b) => {
		const av = get(a);
		const bv = get(b);
		if (av == null && bv == null) return 0;
		if (av == null) return 1;
		if (bv == null) return -1;
		if (typeof av === "number" && typeof bv === "number")
			return (av - bv) * sign;
		return String(av).localeCompare(String(bv)) * sign;
	});
}

/** A header cell that cycles its column's sort on click (desc → asc → off),
 * with a direction arrow that brightens while the column is active. */
export function SortableHead<K extends string>({
	sortKey,
	sort,
	onSort,
	align = "left",
	className,
	children,
}: {
	sortKey: K;
	sort: SortState<K> | null;
	onSort: (key: K) => void;
	align?: "left" | "right" | "center";
	className?: string;
	children: React.ReactNode;
}) {
	const active = sort?.key === sortKey;
	const Arrow = active
		? sort.dir === "asc"
			? IconArrowUp
			: IconArrowDown
		: IconArrowsSort;
	// The whole header cell is the click/hover target (not just the label), so
	// sorting is easy to hit anywhere in the column header. Keyboard-operable via
	// tabIndex + Enter/Space.
	return (
		<TableHead
			align={align}
			aria-sort={
				active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
			}
			tabIndex={0}
			onClick={() => onSort(sortKey)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSort(sortKey);
				}
			}}
			className={cn("group select-none outline-none", className)}
		>
			{/* The arrow sits after the label but takes no layout space on
			    right-aligned columns (-mr-5 = its size-3.5 + gap-s footprint,
			    hanging into the cell's right padding), so the label's right edge
			    lines up exactly with the numbers below. It only appears on hover
			    or when the column is actively sorted. */}
			<span
				className={cn(
					"inline-flex flex-row-reverse items-center gap-s text-ink",
					align === "right" && "-mr-[calc(var(--space-xl)+var(--space-xs))]",
				)}
			>
				<Arrow
					className={cn(
						"size-3.5 shrink-0 transition-[color,opacity]",
						active
							? "text-ink"
							: "text-ink-3 opacity-0 group-hover:opacity-100",
						"group-hover:text-primary",
					)}
					stroke={active ? 2 : 1.5}
				/>
				<span>{children}</span>
			</span>
		</TableHead>
	);
}

// ---------------------------------------------------------------------------
// Filter toolbar
// ---------------------------------------------------------------------------

/** A horizontal bar of filter controls, sitting above a table. Wraps on narrow
 * widths. */
export function Toolbar({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-m pl-xxl pr-xxl",
				className,
			)}
		>
			{children}
		</div>
	);
}

/** A compact search field with a leading icon and a clear button. */
export function SearchInput({
	value,
	onChange,
	placeholder = "Search…",
	label,
	className,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	/** Accessible name; defaults to the placeholder. */
	label?: string;
	className?: string;
}) {
	return (
		<InputGroup variant="toolbar" className={cn("w-56", className)}>
			<InputGroupAddon>
				<IconSearch className="size-3.5 text-ink-4" />
			</InputGroupAddon>
			<InputGroupInput
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				aria-label={label ?? placeholder}
				className="h-8"
			/>
			{value && (
				<InputGroupAddon align="inline-end">
					<InputGroupButton
						size="icon-sm"
						aria-label="Clear search"
						onClick={() => onChange("")}
						className="corner-full text-ink-4 hover:text-ink"
					>
						<IconX className="size-3.5" />
					</InputGroupButton>
				</InputGroupAddon>
			)}
		</InputGroup>
	);
}

/** A boolean filter toggle (e.g. "Errors only"): the outline Button variant at
 * rest, the destructive one while active. */
export function ToggleChip({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<Button
			variant={active ? "danger" : "primary"}
			aria-pressed={active}
			onClick={onClick}
			className={cn(
				// transition-[color,box-shadow] (not the base transition-all) matches
				// the SearchInput surface: background hover flips instantly,
				// text/shadow still ease. The inactive label/icon dims to muted
				// (outline would pin the icon to neutral, hence the svg override).
				"font-regular transition-[color,box-shadow] active:scale-100",
				!active &&
					"text-ink-4 hover:text-ink-4 bg-surface hover:bg-hover aria-expanded:bg-hover dark:hover:bg-hover dark:aria-expanded:bg-hover [&_svg:not([class*='text-'])]:text-ink-4 dark:[&_svg:not([class*='text-'])]:text-ink-4",
			)}
		>
			{children}
		</Button>
	);
}

/** A ghost button that clears all active filters. Render at the end of a
 * Toolbar; visible only when `show` is true (a filter is active), fading and
 * sliding in and out via AnimatePresence. */
export function ClearFiltersButton({
	show,
	onClick,
}: {
	show: boolean;
	onClick: () => void;
}) {
	return (
		<AnimatePresence>
			{show && (
				<motion.div
					initial={{ opacity: 0, scale: 0.98, x: -4 }}
					animate={{ opacity: 1, scale: 1, x: 0 }}
					transition={{ duration: 0.13, ease: "easeOut" }}
					className="inline-flex"
				>
					<Button
						variant="primary"
						onClick={onClick}
						className="text-ink-3 gap-xs bg-surface hover:bg-hover aria-expanded:bg-hover dark:hover:bg-hover dark:aria-expanded:bg-hover"
					>
						<IconX />
						Clear
					</Button>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

const COMPACT_COUNT: Format = { notation: "compact" };

/** Minimal pagination footer: "1,240 repos / 1 to 25" in muted text plus two
 * chevrons, right-aligned. The range doubles as a rows-per-page picker when
 * `onPageSizeChange` is provided. No page numbers — lists here are browsed
 * sequentially or narrowed via filters, never jumped into. */
export function PaginationFooter({
	page,
	pageSize,
	total,
	shown,
	noun,
	onPageChange,
	onPageSizeChange,
	pageSizes = [25, 50, 100],
	isFetching = false,
}: {
	/** 0-based page index. */
	page: number;
	pageSize: number;
	/** Total row count across all pages. */
	total: number;
	/** Row count on the current page. */
	shown: number;
	/** Singular/plural label, e.g. ["repo", "repos"]. */
	noun: [string, string];
	onPageChange: (page: number) => void;
	/** Enables the rows-per-page picker on the range text. */
	onPageSizeChange?: (size: number) => void;
	pageSizes?: number[];
	isFetching?: boolean;
}) {
	const totalPages = Math.max(page + 1, Math.ceil(total / pageSize) || 1);
	const range =
		shown === 0 ? (
			"0"
		) : (
			<>
				<FlowNumber value={page * pageSize + 1} format={PLAIN_NUMBER} /> to{" "}
				<FlowNumber value={page * pageSize + shown} format={PLAIN_NUMBER} />
			</>
		);
	const count = Math.round(total);
	return (
		<div
			className={cn(
				"flex items-center justify-end gap-xs",
				"edge-t-m px-xxl pt-xl",
				"border-line-soft",
			)}
		>
			<span className="text-body-m text-ink-4 tabular-nums">
				<FlowNumber
					value={count}
					format={count >= 1000 ? COMPACT_COUNT : undefined}
				/>{" "}
				{total === 1 ? noun[0] : noun[1]}
			</span>
			<span className="text-body-m text-ink-4 mx-l">/</span>
			{onPageSizeChange ? (
				<Select<string, false>
					value={String(pageSize)}
					onValueChange={(v) => v && onPageSizeChange(Number(v))}
				>
					<SelectTrigger
						title="Rows per page"
						// Strip the trigger surface down to bare text so it reads as part
						// of the count line, only revealing itself as a control on hover.
						className={cn(
							"h-auto gap-s",
							"corner-s edge-none p-zero",
							"text-body-m tabular-nums",
							"bg-transparent text-ink-4 shadow-none transition-[color,box-shadow]",
							"data-[size=md]:h-auto",
							"squircle:corner-s",
							"hover:text-ink",
							"dark:edge-none dark:bg-transparent dark:shadow-none dark:hover:bg-transparent",
						)}
					>
						{range}
					</SelectTrigger>
					<SelectContent
						className="w-auto min-w-28"
						align="end"
						alignItemWithTrigger={false}
						sideOffset={6}
					>
						{pageSizes.map((s) => (
							<SelectItem key={s} value={String(s)}>
								{s} per page
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : (
				<span className="text-body-m text-ink-4 tabular-nums">{range}</span>
			)}
			<div className="ml-s flex items-center gap-xs">
				<Button
					variant={page === 0 || isFetching ? "secondary" : "primary"}
					size="icon"
					aria-label="Previous page"
					disabled={page === 0 || isFetching}
					onClick={() => onPageChange(page - 1)}
				>
					<IconChevronLeft />
				</Button>
				<Button
					variant={
						page + 1 >= totalPages || isFetching ? "secondary" : "primary"
					}
					size="icon"
					aria-label="Next page"
					disabled={page + 1 >= totalPages || isFetching}
					onClick={() => onPageChange(page + 1)}
				>
					<IconChevronRight />
				</Button>
			</div>
		</div>
	);
}
