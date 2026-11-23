import { Menu } from "@base-ui/react/menu";
import {
	IconCheck,
	IconChevronDown,
	IconChevronUp,
	IconSortDescending,
} from "@tabler/icons-react";
import { useRef } from "react";
import { Button } from "@/app/ui/button";
import { TouchTarget } from "@/app/ui/touch-target";
import { SessionMenuPopup } from "./session-menu-popup";
import {
	getInitialSortDirection,
	SESSION_OVERVIEW_SORT_OPTIONS,
	type SessionOverviewSortKey,
	type SessionSortState,
} from "./sessions-overview-table-utils";

export function SessionsOverviewSortMenu({
	activeSortLabel,
	onSortChange,
	options = SESSION_OVERVIEW_SORT_OPTIONS,
	sort,
}: {
	activeSortLabel: string;
	onSortChange: (sort: SessionSortState) => void;
	options?: readonly { key: SessionOverviewSortKey; label: string }[];
	sort: SessionSortState;
}) {
	return (
		<ToolbarSortMenu
			noun="sessions"
			options={options}
			activeSortLabel={activeSortLabel}
			getInitialDirection={getInitialSortDirection}
			onSortChange={onSortChange}
			sort={sort}
		/>
	);
}

/** The toolbar's "Sorted by" menu: a key, then a direction. Picking a key
 * starts it at `getInitialDirection`. */
export function ToolbarSortMenu<K extends string>({
	noun,
	options,
	activeSortLabel,
	getInitialDirection,
	onSortChange,
	sort,
}: {
	/** What the list holds, for the menu's accessible names ("sessions"). */
	noun: string;
	options: readonly { key: K; label: string }[];
	activeSortLabel: string;
	getInitialDirection: (key: K) => "asc" | "desc";
	onSortChange: (sort: { key: K; direction: "asc" | "desc" }) => void;
	sort: { key: K; direction: "asc" | "desc" };
}) {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const restoreKeyboardFocusRef = useRef(false);
	return (
		<Menu.Root
			onOpenChange={(open, details) => {
				if (open) restoreKeyboardFocusRef.current = false;
				else if (details.event instanceof KeyboardEvent) {
					// A hover-close can follow Escape; retain the keyboard intent.
					restoreKeyboardFocusRef.current = true;
				}
			}}
			onOpenChangeComplete={(open) => {
				// Restore focus after the portal has released the demo toolbar.
				if (!open && restoreKeyboardFocusRef.current) {
					triggerRef.current?.focus({ preventScroll: true });
					restoreKeyboardFocusRef.current = false;
				}
			}}
		>
			<Menu.Trigger
				ref={triggerRef}
				aria-label={`Sort ${noun}, ${activeSortLabel}, ${sort.direction === "asc" ? "ascending" : "descending"}`}
				render={<Button variant="primary" />}
			>
				<IconSortDescending
					aria-hidden="true"
					className="size-4 h-lh shrink-0 text-ink-3"
				/>
				<span className="text-ink-2">Sorted by</span>
				<span>{activeSortLabel}</span>
				{sort.direction === "asc" ? (
					<IconChevronUp
						aria-hidden="true"
						className="size-4 shrink-0 text-ink-3"
					/>
				) : (
					<IconChevronDown
						aria-hidden="true"
						className="size-4 shrink-0 text-ink-3"
					/>
				)}
				<TouchTarget className="size-12" />
			</Menu.Trigger>
			<SessionMenuPopup aria-label={`Sort ${noun}`}>
				<Menu.RadioGroup
					aria-label="Sort by"
					value={sort.key}
					onValueChange={(value: unknown) => {
						const option = options.find((item) => item.key === value);
						if (option) {
							onSortChange({
								key: option.key,
								direction: getInitialDirection(option.key),
							});
						}
					}}
				>
					{options.map((option) => (
						<Menu.RadioItem
							key={option.key}
							value={option.key}
							closeOnClick
							className="menu-row"
						>
							<SortCheck />
							{option.label}
						</Menu.RadioItem>
					))}
				</Menu.RadioGroup>
				<Menu.Separator className="menu-separator" />
				<Menu.RadioGroup
					aria-label="Sort direction"
					value={sort.direction}
					onValueChange={(value: unknown) => {
						if (value === "asc" || value === "desc")
							onSortChange({ ...sort, direction: value });
					}}
				>
					<Menu.RadioItem value="asc" closeOnClick className="menu-row">
						<SortCheck />
						Ascending
					</Menu.RadioItem>
					<Menu.RadioItem value="desc" closeOnClick className="menu-row">
						<SortCheck />
						Descending
					</Menu.RadioItem>
				</Menu.RadioGroup>
			</SessionMenuPopup>
		</Menu.Root>
	);
}

function SortCheck() {
	return (
		<Menu.RadioItemIndicator className="menu-sort-check">
			<IconCheck aria-hidden="true" className="size-3.5" />
		</Menu.RadioItemIndicator>
	);
}
