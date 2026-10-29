// Adapted from pierre (github.com/pierrecomputer/pierre, Apache-2.0): how its
// trees package orders children (folders first), flattens single-child
// folder chains into one row, and marks folders that hold a change.

export type FileTreeStatus = "added" | "modified" | "deleted" | "read";
export type FileTreeItem = {
	path: string;
	status?: FileTreeStatus;
	badge?: string;
	tags?: readonly FileTreeTag[];
	dimmed?: boolean;
};

export type FileTreeTag = {
	id: string;
	label: string;
	changed: boolean;
	color?: string;
	dots?: readonly string[];
};

type DirectoryNode = {
	kind: "directory";
	key: string;
	segments: string[];
	directories: Map<string, DirectoryNode>;
	files: Map<string, FileNode>;
	containsChange: boolean;
};
type FileNode = { kind: "file"; key: string; name: string; item: FileTreeItem };

export type FileTreeRow = {
	kind: "directory" | "file";
	key: string;
	segments: readonly string[];
	depth: number;
	ancestorKeys: readonly string[];
	posInSet: number;
	setSize: number;
	item: FileTreeItem | null;
	containsChange: boolean;
	isExpanded: boolean;
};

export type FileTreeModel = {
	rootLabel: string | null;
	root: DirectoryNode;
};

const CHANGE_STATUSES = new Set<FileTreeStatus | undefined>([
	"added",
	"modified",
	"deleted",
]);

function newDirectory(key: string, segments: string[]): DirectoryNode {
	return {
		kind: "directory",
		key,
		segments,
		directories: new Map(),
		files: new Map(),
		containsChange: false,
	};
}

function splitPath(path: string) {
	return path.split(/[\\/]+/).filter((part) => part !== "" && part !== ".");
}

export function buildFileTree(items: readonly FileTreeItem[]): FileTreeModel {
	const entries = items.map((item) => ({ item, parts: splitPath(item.path) }));
	let common: string[] | null = null;
	for (const { parts } of entries) {
		const folders = parts.slice(0, -1);
		if (common === null) {
			common = folders;
			continue;
		}
		let shared = 0;
		while (
			shared < common.length &&
			shared < folders.length &&
			common[shared] === folders[shared]
		) {
			shared++;
		}
		common = common.slice(0, shared);
	}
	const prefix = common ?? [];
	const absolute =
		items.length > 0 && items.every((item) => /^[\\/]/.test(item.path));
	const rootLabel =
		prefix.length > 0 ? `${absolute ? "/" : ""}${prefix.join("/")}` : null;

	const root = newDirectory("", []);
	for (const { item, parts } of entries) {
		const relative = parts.slice(prefix.length);
		const name = relative.pop() ?? item.path;
		let directory = root;
		for (const part of relative) {
			let child = directory.directories.get(part);
			if (!child) {
				child = newDirectory(`${directory.key}${part}/`, [part]);
				directory.directories.set(part, child);
			}
			directory = child;
		}
		directory.files.set(name, { kind: "file", key: item.path, name, item });
	}
	markChanges(root);
	flatten(root);
	return { rootLabel, root };
}

function markChanges(directory: DirectoryNode): boolean {
	let contains = false;
	for (const child of directory.directories.values()) {
		if (markChanges(child)) contains = true;
	}
	for (const file of directory.files.values()) {
		if (CHANGE_STATUSES.has(file.item.status)) contains = true;
	}
	directory.containsChange = contains;
	return contains;
}

function flatten(directory: DirectoryNode) {
	for (const [name, child] of directory.directories) {
		let merged = child;
		while (merged.files.size === 0 && merged.directories.size === 1) {
			const [only] = merged.directories.values();
			merged = {
				...only,
				segments: [...merged.segments, ...only.segments],
			};
		}
		directory.directories.set(name, merged);
		flatten(merged);
	}
}

const collator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

function sortedChildren(directory: DirectoryNode) {
	const directories = [...directory.directories.values()].sort((a, b) =>
		collator.compare(a.segments.join("/"), b.segments.join("/")),
	);
	const files = [...directory.files.values()].sort((a, b) =>
		collator.compare(a.name, b.name),
	);
	return [...directories, ...files];
}

export function visibleRows(
	model: FileTreeModel,
	collapsed: ReadonlySet<string>,
): FileTreeRow[] {
	const rows: FileTreeRow[] = [];
	const walk = (
		directory: DirectoryNode,
		depth: number,
		ancestorKeys: readonly string[],
	) => {
		const children = sortedChildren(directory);
		for (let index = 0; index < children.length; index++) {
			const child = children[index];
			const base = {
				key: child.key,
				depth,
				ancestorKeys,
				posInSet: index + 1,
				setSize: children.length,
			};
			if (child.kind === "file") {
				rows.push({
					...base,
					kind: "file",
					segments: [child.name],
					item: child.item,
					containsChange: false,
					isExpanded: false,
				});
				continue;
			}
			const isExpanded = !collapsed.has(child.key);
			rows.push({
				...base,
				kind: "directory",
				segments: child.segments,
				item: null,
				containsChange: child.containsChange,
				isExpanded,
			});
			if (isExpanded) walk(child, depth + 1, [...ancestorKeys, child.key]);
		}
	};
	walk(model.root, 0, []);
	return rows;
}
