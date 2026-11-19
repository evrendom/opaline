import {
	REPOSITORY_RUNS_PATH_LIMIT,
	type RepositoryFileActivityPath,
	type RepositoryTreeEntry,
} from "@rudel/api-routes";
import type { FileTreeItem } from "@/components/pierre/file-tree";

export interface RepoFileTouch {
	reads: number;
	changes: number;
	sessions: number;
	added: boolean;
	lastAt: string;
	paths: readonly string[];
}

export type RepoFilesKept = "changed" | "read" | "all";

export function repoTreeItems(
	files: ReadonlyMap<string, RepoFileTouch>,
	kept: RepoFilesKept,
): FileTreeItem[] {
	const items: FileTreeItem[] = [];
	for (const [path, touch] of files) {
		const changed = touch.changes > 0;
		if (kept !== "all" && changed !== (kept === "changed")) continue;
		items.push({
			path,
			status: touch.added ? "added" : changed ? "modified" : "read",
		});
	}
	return items;
}

export function matchRepoFileActivity(
	entries: readonly RepositoryTreeEntry[],
	paths: readonly RepositoryFileActivityPath[],
): ReadonlyMap<string, RepoFileTouch> {
	const tree = new Set<string>();
	const byName = new Map<string, string[]>();
	for (const entry of entries) {
		if (entry.type !== "file") continue;
		tree.add(entry.path);
		const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
		const named = byName.get(name);
		if (named) named.push(entry.path);
		else byName.set(name, [entry.path]);
	}
	const files = new Map<string, RepoFileTouch>();
	for (const activity of paths) {
		const path = treePathOf(activity.path, tree, byName);
		if (!path) continue;
		const touch = files.get(path);
		files.set(
			path,
			touch
				? {
						reads: touch.reads + activity.reads,
						changes: touch.changes + activity.changes,
						sessions: Math.max(touch.sessions, activity.sessions),
						added: touch.added || activity.added,
						lastAt:
							touch.lastAt > activity.lastAt ? touch.lastAt : activity.lastAt,
						paths:
							touch.paths.length < REPOSITORY_RUNS_PATH_LIMIT
								? [...touch.paths, activity.path]
								: touch.paths,
					}
				: {
						reads: activity.reads,
						changes: activity.changes,
						sessions: activity.sessions,
						added: activity.added,
						lastAt: activity.lastAt,
						paths: [activity.path],
					},
		);
	}
	return files;
}

function treePathOf(
	recorded: string,
	tree: ReadonlySet<string>,
	byName: ReadonlyMap<string, readonly string[]>,
): string | null {
	const segments = recorded
		.split("/")
		.filter((segment) => segment !== "" && segment !== ".");
	if (segments.length === 0 || segments.includes("..")) return null;
	for (let start = 0; start < segments.length; start++) {
		const candidate = segments.slice(start).join("/");
		if (tree.has(candidate)) return candidate;
	}
	if (recorded.startsWith("/") || recorded.startsWith("~")) return null;
	const tail = `/${segments.join("/")}`;
	const named = (byName.get(segments.at(-1) ?? "") ?? []).filter((path) =>
		path.endsWith(tail),
	);
	return named.length === 1 ? (named[0] ?? null) : null;
}
