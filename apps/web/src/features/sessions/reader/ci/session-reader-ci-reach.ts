import type {
	RunCiLink,
	SessionDetailTurnSummary,
	SessionRunCiRun,
	SessionRunStep,
} from "@rudel/api-routes";
import { pullRequestKey } from "../session-places";
import type { SummaryCiRun } from "../summary/session-summary-model";

export type CiReachLink = {
	link: RunCiLink;
	relations: string[];
	pullRequests: number[];
};

export type CiReacher = {
	agent: string | null;
	index: number;
	key: string;
	links: Map<string, CiReachLink>;
	prompt: string | null;
	task: string | null;
	turnId: string;
};

export type CiReachTurn = {
	index: number;
	main: CiReacher | null;
	prompt: string | null;
	subagents: CiReacher[];
	turnId: string;
};

export type CiReachOf = { link: CiReachLink; reacher: CiReacher };

export type CiReach = {
	byCi: Map<string, CiReachOf[]>;
	turns: CiReachTurn[];
	unplaced: number;
};

export const reacherKey = (turnId: string, agent: string | null) =>
	agent ? `${turnId}/${agent}` : turnId;

export function getCiReach(
	runs: readonly SessionRunCiRun[],
	turns: readonly SessionDetailTurnSummary[],
	launches: ReadonlyMap<string, string>,
	tasks: ReadonlyMap<string, string>,
): CiReach {
	const byStart = new Map<number, number>();
	turns.forEach((turn, index) => {
		if (turn.startedAt) byStart.set(Date.parse(turn.startedAt), index);
	});
	const order = new Map(turns.map((turn, index) => [turn.turnId, index]));
	const reachers = new Map<string, CiReacher>();
	let unplaced = 0;
	for (const run of runs) {
		const agent = run.agentId || null;
		const index = agent
			? order.get(launches.get(agent) ?? "")
			: byStart.get(Date.parse(run.startedAt));
		const turn = index === undefined ? undefined : turns[index];
		if (!turn || index === undefined) {
			unplaced += 1;
			continue;
		}
		const key = reacherKey(turn.turnId, agent);
		const reacher = reachers.get(key) ?? {
			agent,
			index,
			key,
			links: new Map(),
			prompt: turn.userPreview ?? null,
			task: agent ? (tasks.get(agent) ?? null) : null,
			turnId: turn.turnId,
		};
		reachers.set(key, reacher);
		for (const ci of run.ci) {
			const had = reacher.links.get(ci.ciRunId);
			reacher.links.set(ci.ciRunId, {
				link: had?.link === "exact" || ci.link === "exact" ? "exact" : ci.link,
				pullRequests: union(had?.pullRequests, ci.pullRequests),
				relations: union(had?.relations, ci.relations),
			});
		}
	}
	const sorted = [...reachers.values()].sort(
		(a, b) =>
			a.index - b.index ||
			Number(a.agent !== null) - Number(b.agent !== null) ||
			(a.agent ?? "").localeCompare(b.agent ?? ""),
	);
	const byCi = new Map<string, CiReachOf[]>();
	const byTurn = new Map<string, CiReachTurn>();
	for (const reacher of sorted) {
		for (const [ciRunId, link] of reacher.links)
			byCi.set(ciRunId, [...(byCi.get(ciRunId) ?? []), { link, reacher }]);
		const turn = byTurn.get(reacher.turnId) ?? {
			index: reacher.index,
			main: null,
			prompt: reacher.prompt,
			subagents: [],
			turnId: reacher.turnId,
		};
		byTurn.set(reacher.turnId, turn);
		if (reacher.agent) turn.subagents.push(reacher);
		else turn.main = reacher;
	}
	return { byCi, turns: [...byTurn.values()], unplaced };
}

export function subagentTasks(
	runs: readonly { steps: readonly SessionRunStep[] }[] | undefined,
): Map<string, string> {
	const tasks = new Map<string, string>();
	for (const run of runs ?? [])
		for (const step of run.steps)
			if (step.launched && step.label && !tasks.has(step.launched))
				tasks.set(step.launched, step.label);
	return tasks;
}

function union<T>(had: readonly T[] | undefined, more: readonly T[]): T[] {
	return [...new Set([...(had ?? []), ...more])].sort();
}

export function withReachedPulls(
	ci: readonly SummaryCiRun[],
	reach: CiReach,
): SummaryCiRun[] {
	return ci.map((run) => {
		const numbers = union(
			run.pullRequests,
			(reach.byCi.get(run.ciRunId) ?? []).flatMap(
				(each) => each.link.pullRequests,
			),
		);
		return numbers.length === run.pullRequests.length
			? run
			: { ...run, pullRequests: numbers };
	});
}

export function ciOfPick(
	turn: CiReachTurn,
	agent: string | null,
): Map<string, CiReachLink> {
	const own = agent
		? turn.subagents.filter((each) => each.agent === agent)
		: [...(turn.main ? [turn.main] : []), ...turn.subagents];
	const links = new Map<string, CiReachLink>();
	for (const reacher of own)
		for (const [ciRunId, link] of reacher.links) {
			const had = links.get(ciRunId);
			if (!had || (had.link !== "exact" && link.link === "exact"))
				links.set(ciRunId, link);
		}
	return links;
}

const CAUSE: Record<string, number> = {
	ci_named: 2,
	commit_pushed: 4,
	pr_branch_head: 3,
	pr_named: 1,
};

const causeOf = (link: CiReachLink) =>
	Math.max(0, ...link.relations.map((relation) => CAUSE[relation] ?? 0));

export function ciOwners(reach: CiReach): Map<string, string[]> {
	const owners = new Map<string, string[]>();
	for (const [ciRunId, reachers] of reach.byCi) {
		let best: CiReachOf | undefined;
		for (const each of reachers) {
			const rank =
				best === undefined
					? 1
					: causeOf(each.link) - causeOf(best.link) ||
						each.reacher.index - best.reacher.index ||
						Number(each.reacher.agent !== null) -
							Number(best.reacher.agent !== null);
			if (rank > 0) best = each;
		}
		if (!best) continue;
		const key = best.reacher.key;
		owners.set(key, [...(owners.get(key) ?? []), ciRunId]);
	}
	return owners;
}

export function reachWords(link: CiReachLink): { full: string; short: string } {
	const has = (relation: string) => link.relations.includes(relation);
	if (link.link === "exact") {
		if (has("commit_pushed") && has("ci_named"))
			return {
				full: "Exact: the run pushed the commit it ran on, and named this CI run.",
				short: "pushed its commit, named it",
			};
		if (has("commit_pushed"))
			return {
				full: "Exact: the run pushed the commit this CI run ran on.",
				short: "pushed the commit it ran on",
			};
		return {
			full: "Exact: the run named this CI run, printing or asking for its id.",
			short: "named this CI run",
		};
	}
	const what =
		has("pr_named") && has("pr_branch_head")
			? "named the PR and pushed its branch"
			: has("pr_branch_head")
				? "pushed the PR's branch"
				: "named the PR";
	return {
		full: `Inferred from the PR's time window: the run ${what}, and GitHub started this CI run while the run was going. Someone else's push to the PR then would look the same.`,
		short: `${what}; CI started during the run`,
	};
}

export type PullToucher = {
	reacher: CiReacher;
	ways: string[];
};

const TOUCH_WORDS = [
	["pr_named", "named it"],
	["pr_branch_head", "pushed its branch"],
	["commit_pushed", "pushed a commit its CI ran on"],
	["ci_named", "named one of its CI runs"],
] as const;

export function pullTouchers(
	pullKey: string,
	runs: readonly SummaryCiRun[],
	reach: CiReach,
): PullToucher[] {
	const ways = new Map<string, { reacher: CiReacher; ways: Set<string> }>();
	for (const run of runs)
		for (const { link, reacher } of reach.byCi.get(run.ciRunId) ?? []) {
			const entry = ways.get(reacher.key) ?? { reacher, ways: new Set() };
			ways.set(reacher.key, entry);
			const forThis = link.pullRequests.some(
				(number) => pullRequestKey(run.repository, number) === pullKey,
			);
			for (const [relation, words] of TOUCH_WORDS)
				if (
					link.relations.includes(relation) &&
					(forThis || !relation.startsWith("pr_"))
				)
					entry.ways.add(words);
		}
	return [...ways.values()]
		.sort(
			(a, b) =>
				a.reacher.index - b.reacher.index ||
				Number(a.reacher.agent !== null) - Number(b.reacher.agent !== null),
		)
		.map((entry) => ({
			reacher: entry.reacher,
			ways: TOUCH_WORDS.flatMap(([, words]) =>
				entry.ways.has(words) ? [words] : [],
			),
		}));
}
