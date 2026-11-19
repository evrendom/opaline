import {
	type RunCiRun,
	SESSION_GIT_ACTIONS,
	SESSION_TURN_STEP_KINDS,
	type SessionDetailOverview,
	type SessionDetailTurnSummary,
	type SessionFile,
	type SessionRunCiRun,
	type SessionSetupFile,
} from "@rudel/api-routes";
import type { FileTreeItem } from "@/components/pierre/file-tree";
import { countChanges, diffLines } from "@/components/pierre/line-diff";
import { shortRunId } from "@/features/sessions/run-id";
import { changesOf } from "../files/session-files-model";

type Turn = SessionDetailTurnSummary;

const STEP_COUNT_KEYS = [...SESSION_TURN_STEP_KINDS, ...SESSION_GIT_ACTIONS];

export type SummaryPlace = { agent?: string; turnId: string };

export type SummarySkill = {
	name: string;
	uses: number;
	turns: string[];
	subagents: boolean;
};

export type SummaryFile = {
	path: string;
	created: number;
	edited: number;
	read: number;
	turns: string[];
	changedTurns: string[];
};

export type SummaryCiRun = RunCiRun & {
	places: SummaryPlace[];
};

export type SummarySubagent = SessionDetailOverview["subagents"][number] & {
	turnId: string | null;
};

export type SummaryActivity = {
	compactions: number;
	errors: number;
	slashCommands: string[];
	stepKinds: Required<NonNullable<Turn["stepKinds"]>>;
	toolCalls: number;
};

function skillNameOfPath(path: string): string | null {
	const parts = path.split("/").filter(Boolean);
	return parts.at(-1)?.toLowerCase() === "skill.md"
		? (parts.at(-2) ?? null)
		: null;
}

function pushOnce(list: string[], value: string) {
	if (!list.includes(value)) list.push(value);
}

export function getSummarySkills(
	turns: readonly Turn[],
	setup: readonly SessionSetupFile[],
): SummarySkill[] {
	const byName = new Map<string, SummarySkill>();
	const skill = (name: string) => {
		const found = byName.get(name);
		if (found) return found;
		const created: SummarySkill = {
			name,
			subagents: false,
			turns: [],
			uses: 0,
		};
		byName.set(name, created);
		return created;
	};
	for (const turn of turns) {
		const loads = turn.skillEvents.length > 0 ? turn.skillEvents : null;
		if (loads)
			for (const event of loads) {
				const entry = skill(event.skill);
				entry.uses += 1;
				pushOnce(entry.turns, turn.turnId);
			}
		else
			for (const name of turn.skills) {
				const entry = skill(name);
				entry.uses += 1;
				pushOnce(entry.turns, turn.turnId);
			}
	}
	for (const file of setup) {
		if (file.kind !== "skill_body") continue;
		const name = skillNameOfPath(file.path);
		if (!name) continue;
		const entry = skill(name);
		if (file.subagents) entry.subagents = true;
	}
	return [...byName.values()].sort(
		(a, b) => b.uses - a.uses || a.name.localeCompare(b.name),
	);
}

export function getSummaryFiles(
	turns: readonly Turn[],
	sessionFiles: SessionDetailOverview["context"]["files"],
): SummaryFile[] {
	const byPath = new Map<string, SummaryFile>();
	const file = (path: string) => {
		const found = byPath.get(path);
		if (found) return found;
		const created: SummaryFile = {
			changedTurns: [],
			created: 0,
			edited: 0,
			path,
			read: 0,
			turns: [],
		};
		byPath.set(path, created);
		return created;
	};
	for (const turn of turns) {
		const events = (turn.fileEvents ?? []).filter((event) => event.path);
		if (events.length > 0)
			for (const event of events) {
				const entry = file(event.path as string);
				entry[event.operation] += event.count;
				pushOnce(entry.turns, turn.turnId);
				if (event.operation !== "read")
					pushOnce(entry.changedTurns, turn.turnId);
			}
		else
			for (const path of turn.editedFiles) {
				const entry = file(path);
				entry.edited += 1;
				pushOnce(entry.turns, turn.turnId);
				pushOnce(entry.changedTurns, turn.turnId);
			}
	}
	for (const { operation, path } of sessionFiles) {
		const entry = byPath.get(path);
		if (!entry) file(path)[operation] = 1;
	}
	return sortSummaryFiles([...byPath.values()]);
}

function sortSummaryFiles(files: SummaryFile[]): SummaryFile[] {
	const changes = (entry: SummaryFile) => entry.created + entry.edited;
	return files.sort(
		(a, b) =>
			Number(changes(b) > 0) - Number(changes(a) > 0) ||
			changes(b) - changes(a) ||
			b.read - a.read ||
			a.path.localeCompare(b.path),
	);
}

export function getSummaryFilesOfChanges(
	files: readonly SessionFile[],
	run: string | null,
): SummaryFile[] {
	const out: SummaryFile[] = [];
	for (const file of files) {
		const changes = changesOf(file, run).filter((change) => !change.failed);
		const readTurns = run
			? file.readTurns.filter((turnId) => turnId === run)
			: file.readTurns;
		const read = run ? readTurns.length : file.reads;
		if (changes.length === 0 && read === 0) continue;
		const changedTurns: string[] = [];
		for (const change of changes)
			if (change.turnId) pushOnce(changedTurns, change.turnId);
		const turns = [...changedTurns];
		for (const turnId of readTurns) pushOnce(turns, turnId);
		const created = changes.filter(
			(change) => change.operation === "created",
		).length;
		out.push({
			changedTurns,
			created,
			edited: changes.length - created,
			path: file.path,
			read,
			turns,
		});
	}
	return sortSummaryFiles(out);
}

export type SummaryChanges = {
	added: number;
	deleted: number;
	edited: number;
	linesAdded: number;
	linesRemoved: number;
};

export function getSummaryChanges(
	files: readonly SessionFile[],
	run: string | null,
): SummaryChanges {
	const out: SummaryChanges = {
		added: 0,
		deleted: 0,
		edited: 0,
		linesAdded: 0,
		linesRemoved: 0,
	};
	for (const file of files) {
		const changes = changesOf(file, run).filter((change) => !change.failed);
		if (changes.length === 0) continue;
		const last = changes.at(-1)?.operation;
		if (last === "deleted") out.deleted += 1;
		else if (changes.some((change) => change.operation === "created"))
			out.added += 1;
		else out.edited += 1;
		for (const change of changes) {
			const counted = countChanges(
				diffLines(change.before, change.after, {
					lineOffset: change.line ?? 1,
				}),
			);
			out.linesAdded += counted.added;
			out.linesRemoved += counted.removed;
		}
	}
	return out;
}

export function getSummaryTreeItems(
	files: readonly SummaryFile[],
): FileTreeItem[] {
	return files.map((file) => {
		const changes = file.created + file.edited;
		return {
			badge: changes > 1 ? String(changes) : undefined,
			path: file.path,
			status: file.created > 0 ? "added" : changes > 0 ? "modified" : "read",
			tags: file.turns.map((turnId) => ({
				changed: file.changedTurns.includes(turnId),
				id: turnId,
				label: shortRunId(turnId),
			})),
		};
	});
}

export function getSubagentLaunches(
	turns: readonly Turn[],
): Map<string, string> {
	const launches = new Map<string, string>();
	for (const turn of turns)
		for (const event of turn.subagentEvents ?? [])
			if (event.subagentId && !launches.has(event.subagentId))
				launches.set(event.subagentId, turn.turnId);
	return launches;
}

export function getSummarySubagents(
	subagents: SessionDetailOverview["subagents"],
	launches: ReadonlyMap<string, string>,
	turns: readonly Turn[],
): SummarySubagent[] {
	const order = new Map(turns.map((turn, index) => [turn.turnId, index]));
	const at = (subagent: SummarySubagent) =>
		subagent.turnId === null
			? Number.POSITIVE_INFINITY
			: (order.get(subagent.turnId) ?? Number.POSITIVE_INFINITY);
	return subagents
		.map((subagent) => ({
			...subagent,
			turnId: launches.get(subagent.subagentId) ?? null,
		}))
		.sort((a, b) => at(a) - at(b));
}

export function getSummaryCi(
	runs: readonly SessionRunCiRun[],
	turns: readonly Turn[],
	launches: ReadonlyMap<string, string>,
): SummaryCiRun[] {
	const byStart = new Map(
		turns.flatMap((turn) =>
			turn.startedAt
				? [[Date.parse(turn.startedAt), turn.turnId] as const]
				: [],
		),
	);
	const byId = new Map<string, SummaryCiRun>();
	for (const run of runs) {
		const turnId =
			run.agentId === ""
				? byStart.get(Date.parse(run.startedAt))
				: launches.get(run.agentId);
		for (const ci of run.ci) {
			const entry = byId.get(ci.ciRunId) ?? { ...ci, places: [] };
			byId.set(ci.ciRunId, entry);
			if (ci.link === "exact") entry.link = "exact";
			if (
				turnId &&
				!entry.places.some(
					(place) =>
						place.turnId === turnId &&
						place.agent === (run.agentId || undefined),
				)
			)
				entry.places.push({
					turnId,
					...(run.agentId ? { agent: run.agentId } : {}),
				});
		}
	}
	return [...byId.values()].sort((a, b) =>
		a.createdAt.localeCompare(b.createdAt),
	);
}

export function getSummaryActivity(turns: readonly Turn[]): SummaryActivity {
	const stepKinds = Object.fromEntries(
		STEP_COUNT_KEYS.map((key) => [key, 0]),
	) as SummaryActivity["stepKinds"];
	const slashCommands: string[] = [];
	let compactions = 0;
	let errors = 0;
	let toolCalls = 0;
	for (const turn of turns) {
		for (const key of STEP_COUNT_KEYS)
			stepKinds[key] += turn.stepKinds?.[key] ?? 0;
		for (const command of turn.slashCommands) pushOnce(slashCommands, command);
		compactions += turn.compactions ?? 0;
		errors += turn.errorCount;
		toolCalls += turn.toolCallCount;
	}
	return { compactions, errors, slashCommands, stepKinds, toolCalls };
}

export function groupSetupFiles(setup: readonly SessionSetupFile[]): {
	harness: SessionSetupFile[];
	instructions: SessionSetupFile[];
	mcp: SessionSetupFile[];
} {
	return {
		harness: setup.filter(
			(file) => file.kind === "system_prompt" || file.kind === "developer",
		),
		instructions: setup.filter((file) =>
			["instructions", "agents_md", "nested_memory"].includes(file.kind),
		),
		mcp: setup.filter((file) => file.kind === "mcp_instructions"),
	};
}
