import { pullRequestKey } from "@/features/sessions/reader/session-places";

export type PullCostSession = {
	sessionId: string;
	share: number;
	cost: number;
	pulls: number;
};

export type PullCost = {
	cost: number;
	shared: boolean;
	sessions: PullCostSession[];
};

export type PullCosts = { byKey: Map<string, PullCost>; total: number };

type CostedPull = {
	repository: string;
	number: number;
	headRef: string | null;
	sessions: readonly string[];
};

type CostedSession = {
	estimated_cost?: number | null;
	git_branch?: string | null;
};

export function getPullCosts(
	pullRequests: readonly CostedPull[],
	sessionOf: ReadonlyMap<string, CostedSession>,
): PullCosts {
	const onBranch = new Map<string, string[]>();
	for (const [id, session] of sessionOf)
		if (session.git_branch)
			onBranch.set(session.git_branch, [
				...(onBranch.get(session.git_branch) ?? []),
				id,
			]);
	const ownersOf = (pull: CostedPull) =>
		pull.headRef === null
			? []
			: [
					...new Set([
						...pull.sessions.filter(
							(id) => sessionOf.get(id)?.git_branch === pull.headRef,
						),
						...(onBranch.get(pull.headRef) ?? []),
					]),
				];
	const owned = new Map<string, number>();
	for (const pull of pullRequests)
		for (const id of ownersOf(pull)) owned.set(id, (owned.get(id) ?? 0) + 1);
	const named = new Map<string, number>();
	const orphaned = new Map<string, number>();
	const isOrphan = (pull: CostedPull) =>
		ownersOf(pull).length === 0 &&
		pull.sessions.length > 0 &&
		pull.sessions.every((id) => owned.has(id));
	for (const pull of pullRequests) {
		if (ownersOf(pull).length > 0) continue;
		for (const id of pull.sessions)
			if (!owned.has(id)) named.set(id, (named.get(id) ?? 0) + 1);
			else if (isOrphan(pull)) orphaned.set(id, (orphaned.get(id) ?? 0) + 1);
	}
	const claims = (id: string) =>
		owned.has(id)
			? (owned.get(id) ?? 0) + (orphaned.get(id) ?? 0)
			: (named.get(id) ?? 1);
	const byKey = new Map<string, PullCost>();
	const counted = new Set<string>();
	let total = 0;
	for (const pull of pullRequests) {
		const owners = ownersOf(pull);
		const payers = (
			owners.length > 0
				? owners
				: isOrphan(pull)
					? pull.sessions
					: pull.sessions.filter((id) => !owned.has(id))
		).map((id) => [id, claims(id)] as const);
		const sessions = payers.map(([sessionId, pulls]) => {
			const cost = sessionOf.get(sessionId)?.estimated_cost ?? 0;
			if (!counted.has(sessionId)) {
				counted.add(sessionId);
				total += cost;
			}
			return { sessionId, share: cost / pulls, cost, pulls };
		});
		byKey.set(pullRequestKey(pull.repository, pull.number), {
			cost: sessions.reduce((sum, each) => sum + each.share, 0),
			shared: sessions.some((each) => each.pulls > 1),
			sessions,
		});
	}
	return { byKey, total };
}
