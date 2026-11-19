import type {
	SessionDetailTurnSummary,
	SessionFileChanges,
	SessionSetupFile,
	SessionSetupRun,
} from "@rudel/api-routes";
import { mcpTool } from "../model/session-reader-mcp-tool";
import {
	railLineKey,
	subagentIdsOf,
} from "../rail/session-reader-turn-rail-row";
import { findMcpSetupFile } from "../session-places";

export type SetupReceipt = Omit<SessionSetupRun, "agentId" | "startedAt">;

export type SetupRun = {
	key: string;
	agentId: string;
	startedAt: string;
	turnId: string | null;
	receipts: SetupReceipt[];
};

export type SetupTurn = {
	turnId: string | null;
	number: number | null;
	prompt: string | null;
	main: SetupRun | null;
	subagents: SetupRun[];
};

function setupRunKey(run: { agentId: string; startedAt: string }) {
	return `${run.agentId}@${run.startedAt}`;
}

export function getSetupRuns(
	rows: readonly SessionSetupRun[],
	turns: readonly SessionDetailTurnSummary[],
	launches: ReadonlyMap<string, string>,
): SetupRun[] {
	const byStart = new Map(
		turns.flatMap((turn) =>
			turn.startedAt
				? [[Date.parse(turn.startedAt), turn.turnId] as const]
				: [],
		),
	);
	const runs = new Map<string, SetupRun>();
	for (const { agentId, startedAt, ...receipt } of rows) {
		const key = setupRunKey({ agentId, startedAt });
		let run = runs.get(key);
		if (!run) {
			run = {
				agentId,
				key,
				receipts: [],
				startedAt,
				turnId:
					(agentId === ""
						? byStart.get(Date.parse(startedAt))
						: launches.get(agentId)) ?? null,
			};
			runs.set(key, run);
		}
		run.receipts.push(receipt);
	}
	return [...runs.values()];
}

export function groupSetupRuns(
	runs: readonly SetupRun[],
	turns: readonly SessionDetailTurnSummary[],
): SetupTurn[] {
	const order = new Map(turns.map((turn, index) => [turn.turnId, index]));
	const groups = new Map<string | null, SetupTurn>();
	for (const run of runs) {
		const groupKey = run.turnId ?? (run.agentId === "" ? run.key : null);
		let group = groups.get(groupKey);
		if (!group) {
			const index = run.turnId === null ? undefined : order.get(run.turnId);
			group = {
				main: null,
				number: index === undefined ? null : index + 1,
				prompt:
					index === undefined ? null : (turns[index]?.userPreview ?? null),
				subagents: [],
				turnId: run.turnId,
			};
			groups.set(groupKey, group);
		}
		if (run.agentId === "") group.main = run;
		else group.subagents.push(run);
	}
	return [...groups.values()].sort(
		(a, b) =>
			(a.number ?? Number.POSITIVE_INFINITY) -
			(b.number ?? Number.POSITIVE_INFINITY),
	);
}

export function runsOfSetupFile(
	runs: readonly SetupRun[],
	setupFile: string,
): SetupRun[] {
	return runs.flatMap((run) => {
		const receipts = run.receipts.filter(
			(receipt) => receipt.setupFile === setupFile,
		);
		return receipts.length > 0 ? [{ ...run, receipts }] : [];
	});
}

export function getSetupUsedBy(
	setup: readonly SessionSetupFile[] | undefined,
	runs: readonly SetupRun[],
	changeRuns: SessionFileChanges["runs"] | undefined,
): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	const use = (setupFile: string, key: string) => {
		const keys = out.get(setupFile) ?? new Set<string>();
		out.set(setupFile, keys);
		keys.add(key);
	};
	const skills = new Set(
		(setup ?? [])
			.filter((file) => file.kind === "skill_body")
			.map((file) => file.setupFile),
	);
	for (const each of runs)
		for (const receipt of each.receipts)
			if (each.turnId && !receipt.carried && skills.has(receipt.setupFile))
				use(receipt.setupFile, railLineKey(each.turnId, each.agentId || null));
	for (const each of changeRuns ?? [])
		for (const step of each.steps) {
			const server = step.tool ? mcpTool(step.tool)?.server : undefined;
			const file = server && setup ? findMcpSetupFile(setup, server) : null;
			if (file) use(file, railLineKey(each.turnId, step.agentId || null));
		}
	return out;
}

export function getSetupIdleLines(
	usedBy: ReadonlyMap<string, ReadonlySet<string>>,
	changeRuns: SessionFileChanges["runs"] | undefined,
	turns: readonly SessionDetailTurnSummary[],
): Set<string> {
	const used = new Set([...usedBy.values()].flatMap((keys) => [...keys]));
	for (const each of changeRuns ?? [])
		for (const step of each.steps)
			if (step.tool && mcpTool(step.tool))
				used.add(railLineKey(each.turnId, step.agentId || null));
	const out = new Set<string>();
	for (const turn of turns)
		for (const subagentId of [null, ...subagentIdsOf(turn)]) {
			const key = railLineKey(turn.turnId, subagentId);
			if (!used.has(key)) out.add(key);
		}
	return out;
}
