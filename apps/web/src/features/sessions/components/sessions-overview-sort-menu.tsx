import { Menu } from "@base-ui/react/menu";
import {
	IconCheck,
	IconChevronDown,
	IconChevronUp,
	IconSortDescending,
} from "@tabler/icons-react";
import { useRef } from "react";
import { SessionMenuPopup } from "./session-menu-popup";
import "./session-menu.css";
import {
	getInitialSortDirection,
	SESSION_OVERVIEW_MENU_TRIGGER_CLASS_NAME,
	SESSION_OVERVIEW_SORT_OPTIONS,
	type SessionSortState,
} from "./sessions-overview-table-utils";

export function SessionsOverviewSortMenu({
	activeSortLabel,
	onSortChange,
	sort,
}: {
	activeSortLabel: string;
	onSortChange: (sort: SessionSortState) => void;
	sort: SessionSortState;
}) {
	return (
		<ToolbarSortMenu
			noun="sessions"
			options={SESSION_OVERVIEW_SORT_OPTIONS}
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
				className={SESSION_OVERVIEW_MENU_TRIGGER_CLASS_NAME}
			>
				<IconSortDescending
					aria-hidden="true"
					className="size-4 h-lh shrink-0 text-[#5d5d5d] dark:text-[#acaeb2]"
				/>
				<span className="text-(--session-overview-muted)">Sorted by</span>
				<span>{activeSortLabel}</span>
				{sort.direction === "asc" ? (
					<IconChevronUp
						aria-hidden="true"
						className="size-4 shrink-0 text-[#5d5d5d] dark:text-[#acaeb2]"
					/>
				) : (
					<IconChevronDown
						aria-hidden="true"
						className="size-4 shrink-0 text-[#5d5d5d] dark:text-[#acaeb2]"
					/>
				)}
				<span
					aria-hidden="true"
					className="pointer-fine:hidden absolute top-1/2 left-1/2 size-12 -translate-1/2"
				/>
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
							className="session-menu-row"
						>
							<SortCheck />
							{option.label}
						</Menu.RadioItem>
					))}
				</Menu.RadioGroup>
				<Menu.Separator className="session-menu-separator" />
				<Menu.RadioGroup
					aria-label="Sort direction"
					value={sort.direction}
					onValueChange={(value: unknown) => {
						if (value === "asc" || value === "desc")
							onSortChange({ ...sort, direction: value });
					}}
				>
					<Menu.RadioItem value="asc" closeOnClick className="session-menu-row">
						<SortCheck />
						Ascending
					</Menu.RadioItem>
					<Menu.RadioItem
						value="desc"
						closeOnClick
						className="session-menu-row"
					>
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
		<Menu.RadioItemIndicator className="session-menu-sort-check">
			<IconCheck aria-hidden="true" className="size-3.5" />
		</Menu.RadioItemIndicator>
	);
}
