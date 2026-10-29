// Adapted from pierre (github.com/pierrecomputer/pierre, Apache-2.0): the
// tree of its trees package (FileTreeView, rowAttributes) — folded folder
// chains, indent guides, git status — in the app's own list rows, without
// its virtualizer, drag and drop, search, renaming or context menus.
import {
	IconChevronRight,
	IconEyeFilled,
	IconFolderFilled,
	IconFolderOpenFilled,
} from "@tabler/icons-react";
import { type JSX, type KeyboardEvent, useMemo, useRef, useState } from "react";
import { getFileLanguage } from "@/features/sessions/reader/files/session-reader-file-tag";
import { revealInList } from "@/lib/reveal-in-list";
import { cn } from "@/lib/utils";
import {
	buildFileTree,
	type FileTreeItem,
	type FileTreeRow,
	type FileTreeStatus,
	type FileTreeTag,
	visibleRows,
} from "./file-tree-model";

export type { FileTreeItem, FileTreeStatus, FileTreeTag };

const ROW_TAGS = 3;

function RowTags({
	onPick,
	tags,
}: {
	onPick?: (id: string) => void;
	tags: readonly FileTreeTag[];
}) {
	const shown = tags.slice(0, ROW_TAGS);
	const rest = tags.length - shown.length;
	return (
		<span className="flex shrink-0 items-center gap-0.5">
			{shown.map((tag) => (
				<button
					key={tag.id}
					type="button"
					tabIndex={-1}
					title={`${tag.changed ? "Changed" : "Read"} in run ${tag.label}`}
					onClick={(event) => {
						event.stopPropagation();
						onPick?.(tag.id);
					}}
					className={cn(
						"inline-flex cursor-pointer items-center gap-0.5 rounded-[4px] px-1 font-mono text-[10px] leading-4 font-normal tabular-nums transition-colors",
						tag.color
							? ""
							: tag.changed
								? "bg-opal-2-tint text-opal-2 hover:bg-opal-2/20"
								: "bg-muted text-muted-foreground hover:text-foreground",
					)}
					style={
						tag.color
							? {
									backgroundColor: `color-mix(in oklab, ${tag.color} ${tag.changed ? 16 : 8}%, transparent)`,
									color: tag.color,
								}
							: undefined
					}
				>
					{tag.label}
					{tag.dots?.map((dot, index) => (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, never reordered
							key={`${index}:${dot}`}
							aria-hidden="true"
							className="size-1.5 shrink-0 rounded-full"
							style={{ backgroundColor: dot }}
						/>
					))}
				</button>
			))}
			{rest > 0 ? (
				<span
					className="text-[10px] font-normal text-muted-foreground/70 tabular-nums"
					title={tags
						.slice(ROW_TAGS)
						.map((tag) => tag.label)
						.join(", ")}
				>
					+{rest}
				</span>
			) : null}
		</span>
	);
}

const STATUS_LETTER: Record<FileTreeStatus, string | null> = {
	added: "A",
	deleted: "D",
	modified: "M",
	read: null,
};

const STATUS_TITLE: Record<FileTreeStatus, string> = {
	added: "Added",
	deleted: "Deleted",
	modified: "Modified",
	read: "Read",
};

const STATUS_LOOK: Record<FileTreeStatus, string> = {
	added: "text-opal-1",
	deleted: "text-opal-5",
	modified: "text-opal-3",
	read: "",
};

function RowIcon({
	expanded,
	folder,
	name,
	selected,
}: {
	expanded: boolean;
	folder: boolean;
	name: string;
	selected: boolean;
}) {
	if (folder) {
		const Folder = expanded ? IconFolderOpenFilled : IconFolderFilled;
		return (
			<Folder className="size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover/row:text-muted-foreground" />
		);
	}
	const { Icon } = getFileLanguage(name);
	return (
		<Icon
			aria-hidden="true"
			className={cn(
				"size-3.5 shrink-0 transition-colors",
				selected
					? "text-foreground"
					: "text-muted-foreground/50 group-hover/row:text-muted-foreground",
			)}
		/>
	);
}

function rowLabel(row: FileTreeRow) {
	const name = row.segments.join("/");
	const status = row.item?.status;
	return status ? `${name}, ${STATUS_TITLE[status].toLowerCase()}` : name;
}

export function FileTree({
	items,
	selected,
	onSelect,
	onPickTag,
}: {
	items: readonly FileTreeItem[];
	selected: string | null;
	onSelect: (path: string) => void;
	onPickTag?: (id: string) => void;
}): JSX.Element {
	const model = useMemo(() => buildFileTree(items), [items]);
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const rows = useMemo(() => visibleRows(model, collapsed), [model, collapsed]);
	const [focusedKey, setFocusedKey] = useState<string | null>(null);
	const rowElements = useRef(new Map<string, HTMLDivElement>());
	const shownSelection = useRef<string | null>(null);
	const showGitLane = useMemo(
		() => items.some((item) => item.status !== undefined),
		[items],
	);

	const indexOf = (key: string | null) =>
		key === null ? -1 : rows.findIndex((row) => row.key === key);
	let activeIndex = indexOf(focusedKey);
	if (activeIndex < 0) activeIndex = Math.max(0, indexOf(selected));
	const activeRow = rows[activeIndex];
	const activeParentKey = activeRow?.ancestorKeys.at(-1);

	const toggle = (key: string) =>
		setCollapsed((previous) => {
			const next = new Set(previous);
			if (!next.delete(key)) next.add(key);
			return next;
		});

	const focusRow = (row: FileTreeRow | undefined) => {
		if (!row) return;
		setFocusedKey(row.key);
		rowElements.current.get(row.key)?.focus();
	};

	const activate = (row: FileTreeRow) => {
		setFocusedKey(row.key);
		if (row.kind === "directory") toggle(row.key);
		else if (row.item) onSelect(row.item.path);
	};

	const onKeyDown = (event: KeyboardEvent, index: number) => {
		const row = rows[index];
		const isOpenFolder = row.kind === "directory" && row.isExpanded;
		switch (event.key) {
			case "ArrowDown":
				focusRow(rows[index + 1]);
				break;
			case "ArrowUp":
				focusRow(rows[index - 1]);
				break;
			case "Home":
				focusRow(rows[0]);
				break;
			case "End":
				focusRow(rows.at(-1));
				break;
			case "ArrowRight":
				if (row.kind === "directory" && !row.isExpanded) toggle(row.key);
				else if (isOpenFolder && rows[index + 1]?.depth > row.depth) {
					focusRow(rows[index + 1]);
				}
				break;
			case "ArrowLeft": {
				if (isOpenFolder) {
					toggle(row.key);
					break;
				}
				const parentKey = row.ancestorKeys.at(-1);
				focusRow(rows.find((candidate) => candidate.key === parentKey));
				break;
			}
			case "Enter":
			case " ":
				activate(row);
				break;
			default:
				return;
		}
		event.preventDefault();
	};

	return (
		<div className="flex flex-col">
			{model.rootLabel ? (
				<div
					className="truncate px-2.5 pb-1 text-xs text-muted-foreground/70 [direction:rtl] text-left"
					title={model.rootLabel}
				>
					{`‎${model.rootLabel}‎`}
				</div>
			) : null}
			<div role="tree" aria-label={model.rootLabel ?? "Files"}>
				{rows.map((row, index) => {
					const status = row.item?.status;
					const isDirectory = row.kind === "directory";
					const isSelected = !isDirectory && row.key === selected;
					return (
						<div
							key={row.key}
							ref={(element) => {
								if (element) rowElements.current.set(row.key, element);
								else rowElements.current.delete(row.key);
								if (
									element &&
									isSelected &&
									shownSelection.current !== selected
								) {
									shownSelection.current = selected;
									revealInList(element);
								}
							}}
							role="treeitem"
							tabIndex={index === activeIndex ? 0 : -1}
							aria-label={rowLabel(row)}
							aria-level={row.depth + 1}
							aria-posinset={row.posInSet}
							aria-setsize={row.setSize}
							aria-expanded={isDirectory ? row.isExpanded : undefined}
							aria-selected={isSelected}
							title={row.item?.path}
							onClick={() => activate(row)}
							onKeyDown={(event) => onKeyDown(event, index)}
							className={cn(
								"group/row relative isolate flex h-7 cursor-pointer items-center gap-1.5 pr-2.5 pl-1 text-[13px] outline-none select-none",
								"before:absolute before:inset-x-0 before:inset-y-px before:-z-10 before:rounded-md before:transition-colors",
								row.item?.dimmed && !isSelected && "opacity-40",
								isSelected
									? "font-medium text-foreground before:bg-muted"
									: "text-muted-foreground hover:text-foreground hover:before:bg-muted/50",
							)}
						>
							{row.ancestorKeys.map((key) => (
								<span
									key={key}
									aria-hidden="true"
									className={cn(
										"relative h-full w-3 shrink-0 before:absolute before:inset-y-0 before:left-1.5 before:w-px",
										key === activeParentKey
											? "before:bg-muted-foreground/30"
											: "before:bg-border/70",
									)}
								/>
							))}
							{isDirectory ? (
								<IconChevronRight
									aria-hidden="true"
									className={cn(
										"size-3 shrink-0 text-muted-foreground/60 transition-transform",
										row.isExpanded && "rotate-90",
									)}
								/>
							) : (
								<span aria-hidden="true" className="w-3 shrink-0" />
							)}
							<RowIcon
								expanded={row.isExpanded}
								folder={isDirectory}
								name={row.segments.at(-1) ?? ""}
								selected={isSelected}
							/>
							<span className="min-w-0 flex-1 truncate">
								{row.segments.map((segment, part) => (
									<span key={row.segments.slice(0, part + 1).join("/")}>
										{part > 0 ? (
											<span className="text-muted-foreground/50"> / </span>
										) : null}
										{segment}
									</span>
								))}
							</span>
							{row.item?.tags?.length ? (
								<RowTags onPick={onPickTag} tags={row.item.tags} />
							) : null}
							{row.item?.badge ? (
								<span className="shrink-0 text-xs font-normal text-muted-foreground/70 tabular-nums">
									{row.item.badge}
								</span>
							) : null}
							{showGitLane ? (
								<span
									className={cn(
										"flex w-3 shrink-0 justify-center text-[11px] font-medium",
										status && STATUS_LOOK[status],
									)}
									title={status ? STATUS_TITLE[status] : undefined}
								>
									{status === "read" ? (
										<IconEyeFilled
											aria-hidden="true"
											className="size-3 text-muted-foreground/60"
										/>
									) : status ? (
										STATUS_LETTER[status]
									) : row.containsChange ? (
										<span className="size-1.5 rounded-full bg-opal-3/60" />
									) : null}
								</span>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}
