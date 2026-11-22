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
import {
	type JSX,
	type KeyboardEvent,
	type RefObject,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	FluidList,
	type FluidListItems,
	useFluidListRegistry,
} from "@/components/fluid-list";
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
		<span className="flex shrink-0 items-center gap-xxs">
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
						"inline-flex items-center gap-xxs focus-outline",
						"corner-xs px-xs font-mono text-body-xs font-regular tabular-nums",
						"transition-colors",
						tag.color
							? ""
							: tag.changed
								? // design-escape-ok(base,opacity): data paint; a changed file's run tag in its opal colour
									"bg-opal-2-tint text-color-3 hover:bg-opal-2/20"
								: "bg-field text-ink-3 hover:text-ink",
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
							className="size-1.5 shrink-0 corner-full"
							style={{ backgroundColor: dot }}
						/>
					))}
				</button>
			))}
			{rest > 0 ? (
				<span
					className="text-body-xs font-regular text-ink-3 tabular-nums"
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
	// design-escape-ok(base): data paint; file status marks in the opal palette
	added: "text-color-1",
	deleted: "text-color-5", // design-escape-ok(base): data paint; file status marks
	modified: "text-color-2",
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
			<Folder className="size-3.5 shrink-0 text-ink-4 transition-colors group-hover/row:text-ink-3" />
		);
	}
	const { Icon } = getFileLanguage(name);
	return (
		<Icon
			aria-hidden="true"
			className={cn(
				"size-3.5 shrink-0 transition-colors",
				selected ? "text-ink" : "text-ink-4 group-hover/row:text-ink-3",
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
	const fluid = useRef<FluidListItems | null>(null);
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
					className="truncate px-[calc(var(--space-m)+var(--space-xxs))] pb-xs text-body-m text-ink-3 [direction:rtl] text-left"
					title={model.rootLabel}
				>
					{`‎${model.rootLabel}‎`}
				</div>
			) : null}
			<FluidList highlightClassName="-z-10 will-change-transform">
				<FluidRows elements={rowElements} fluid={fluid} rows={rows} />
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
								onFocus={() => fluid.current?.setActiveIndex(index)}
								onKeyDown={(event) => onKeyDown(event, index)}
								className={cn(
									"group/row flex h-7 items-center gap-s",
									"corner-s pr-[calc(var(--space-m)+var(--space-xxs))] pl-xs corner-squircle",
									"text-body-l",
									"outline-none select-none",
									"squircle:corner-l",
									row.item?.dimmed && !isSelected && "opacity-40",
									isSelected
										? "bg-field font-medium text-ink"
										: "text-ink-3 hover:text-ink",
								)}
							>
								{row.ancestorKeys.map((key) => (
									<span
										key={key}
										aria-hidden="true"
										skullet-ignore=""
										className={cn(
											"h-full w-3 shrink-0 bg-[linear-gradient(to_right,transparent_6px,var(--guide)_6px,var(--guide)_7px,transparent_7px)]",
											key === activeParentKey
												? "[--guide:var(--ink-4)]"
												: "[--guide:var(--line)]",
										)}
									/>
								))}
								{isDirectory ? (
									<IconChevronRight
										aria-hidden="true"
										className={cn(
											"size-3 shrink-0 text-ink-4 transition-transform",
											row.isExpanded && "rotate-90",
										)}
									/>
								) : (
									<span
										aria-hidden="true"
										skullet-ignore=""
										className="w-3 shrink-0"
									/>
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
												<span className="text-ink-4"> / </span>
											) : null}
											{segment}
										</span>
									))}
								</span>
								{row.item?.tags?.length ? (
									<RowTags onPick={onPickTag} tags={row.item.tags} />
								) : null}
								{row.item?.badge ? (
									<span className="shrink-0 text-body-m font-regular text-ink-3 tabular-nums">
										{row.item.badge}
									</span>
								) : null}
								{showGitLane ? (
									<span
										className={cn(
											"flex w-3 shrink-0 justify-center text-body-s font-medium",
											status && STATUS_LOOK[status],
										)}
										title={status ? STATUS_TITLE[status] : undefined}
									>
										{status === "read" ? (
											<IconEyeFilled
												aria-hidden="true"
												className="size-3 text-ink-4"
											/>
										) : status ? (
											STATUS_LETTER[status]
										) : row.containsChange ? (
											// design-escape-ok(base): data paint; a changed folder's mark in the modified opal
											<span className="size-1.5 corner-full bg-color-2/60" />
										) : null}
									</span>
								) : null}
							</div>
						);
					})}
				</div>
			</FluidList>
		</div>
	);
}

function FluidRows({
	elements,
	fluid,
	rows,
}: {
	elements: RefObject<Map<string, HTMLDivElement>>;
	fluid: RefObject<FluidListItems | null>;
	rows: readonly FileTreeRow[];
}) {
	const registry = useFluidListRegistry();
	useEffect(() => {
		fluid.current = registry;
		if (!registry) return;
		rows.forEach((row, index) => {
			registry.registerItem(index, elements.current.get(row.key) ?? null);
		});
		return () => {
			rows.forEach((_, index) => {
				registry.registerItem(index, null);
			});
		};
	}, [elements, fluid, registry, rows]);
	return null;
}
