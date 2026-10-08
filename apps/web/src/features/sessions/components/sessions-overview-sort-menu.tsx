import { Menu } from "@base-ui/react/menu";
import {
	IconCheck,
	IconChevronDown,
	IconChevronUp,
	IconSortDescending,
} from "@tabler/icons-react";
import { useRef } from "react";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
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
				aria-label={`Sort sessions, ${activeSortLabel}, ${sort.direction === "asc" ? "ascending" : "descending"}`}
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
			<Menu.Portal>
				<Menu.Positioner align="start" sideOffset={6} className="z-50">
					<Menu.Popup
						aria-label="Sort sessions"
						data-fluid-menu-root=""
						className="session-menu-surface session-menu-sort"
					>
						<FluidMenuHover />
						<Menu.RadioGroup
							aria-label="Sort by"
							value={sort.key}
							onValueChange={(value: unknown) => {
								const option = SESSION_OVERVIEW_SORT_OPTIONS.find(
									(item) => item.key === value,
								);
								if (option) {
									onSortChange({
										key: option.key,
										direction: getInitialSortDirection(option.key),
									});
								}
							}}
						>
							{SESSION_OVERVIEW_SORT_OPTIONS.map((option) => (
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
							<Menu.RadioItem
								value="asc"
								closeOnClick
								className="session-menu-row"
							>
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
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
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
