import type { SessionFile, SessionFileChange } from "@rudel/api-routes";
import type {
	FileTreeItem,
	FileTreeStatus,
} from "@/components/pierre/file-tree";
import type { DiffHunk } from "@/components/pierre/line-diff";

export type RunTouch = {
	changed: ReadonlySet<string>;
	read: ReadonlySet<string>;
	subagents: ReadonlySet<string>;
};
export type RunFiles = ReadonlyMap<string, RunTouch>;

export function getRunFiles(files: readonly SessionFile[]): RunFiles {
	const byRun = new Map<
		string,
		{ changed: Set<string>; read: Set<string>; subagents: Set<string> }
	>();
	const of = (turnId: string) => {
		const found = byRun.get(turnId);
		if (found) return found;
		const created = {
			changed: new Set<string>(),
			read: new Set<string>(),
			subagents: new Set<string>(),
		};
		byRun.set(turnId, created);
		return created;
	};
	for (const file of files) {
		for (const change of file.changes) {
			if (!change.turnId) continue;
			of(change.turnId).changed.add(file.path);
			if (change.agentId) of(change.turnId).subagents.add(change.agentId);
		}
		for (const turnId of file.readTurns) of(turnId).read.add(file.path);
		for (const { agentId, turnId } of file.readBy)
			if (agentId) of(turnId).subagents.add(agentId);
	}
	return byRun;
}

function statusOf(changes: readonly SessionFileChange[]): FileTreeStatus {
	const done = changes.filter((change) => !change.failed);
	if (done.length === 0) return "read";
	if (done.at(-1)?.operation === "deleted") return "deleted";
	return done.some((change) => change.operation === "created")
		? "added"
		: "modified";
}

export function wholeText(text: string, start = 1): DiffHunk[] {
	const lines = text.replace(/\n$/u, "").split("\n");
	return [
		{
			lines: lines.map((line, index) => ({
				kind: "context",
				newNumber: start + index,
				oldNumber: start + index,
				text: line,
			})),
			newLines: lines.length,
			newStart: start,
			oldLines: lines.length,
			oldStart: start,
		},
	];
}

export function subagentsOf(
	file: SessionFile,
	turnId: string | null,
): { changed: boolean; id: string }[] {
	const byAgent = new Map<string, boolean>();
	for (const change of file.changes)
		if (change.agentId && (turnId === null || change.turnId === turnId))
			byAgent.set(change.agentId, true);
	for (const { agentId, turnId: readIn } of file.readBy)
		if (
			agentId &&
			(turnId === null || readIn === turnId) &&
			!byAgent.has(agentId)
		)
			byAgent.set(agentId, false);
	return [...byAgent].map(([id, changed]) => ({ changed, id }));
}

export function treeItems(
	files: readonly SessionFile[],
	{
		agent = null,
		dimOutside,
		run,
	}: {
		agent?: string | null;
		dimOutside?: RunTouch;
		run: string | null;
	},
): FileTreeItem[] {
	return files.map((file) => {
		const changes = changesOf(file, run, agent);
		return {
			badge: changes.length > 1 ? String(changes.length) : undefined,
			dimmed:
				dimOutside !== undefined &&
				!dimOutside.changed.has(file.path) &&
				!dimOutside.read.has(file.path),
			path: file.path,
			status: statusOf(changes),
		};
	});
}

export function changesOf(
	file: SessionFile,
	turnId: string | null,
	agent: string | null = null,
): SessionFileChange[] {
	if (turnId === null) return file.changes;
	return file.changes.filter(
		(change) =>
			change.turnId === turnId && (agent === null || change.agentId === agent),
	);
}

export function touchOf(
	files: readonly SessionFile[],
	runFiles: RunFiles,
	turnId: string,
	agent: string | null,
): RunTouch | undefined {
	if (agent === null) return runFiles.get(turnId);
	const changed = new Set<string>();
	const read = new Set<string>();
	for (const file of files) {
		if (changesOf(file, turnId, agent).length > 0) changed.add(file.path);
		if (
			file.readBy.some(
				(entry) => entry.turnId === turnId && entry.agentId === agent,
			)
		)
			read.add(file.path);
	}
	return { changed, read, subagents: new Set([agent]) };
}
